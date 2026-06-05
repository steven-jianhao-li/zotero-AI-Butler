import { getPref, setPref } from "../utils/prefs";
import {
  isLegacySummaryNote,
  SUMMARY_NOTE_TAG,
  type NoteTag,
} from "./aiNoteClassifier";

const MIGRATION_ID = "ai-summary-deep-read-split-v1";
const MAX_EXAMPLE_TITLES = 3;

type PromptState = {
  migrationId?: string;
  legacyCount?: number;
  remindedAt?: string;
  completedAt?: string;
  dismissedAt?: string;
};

type LegacyAiNoteRecord = {
  itemId: number;
  noteId: number;
  title: string;
};

export async function promptLegacyAiNoteRenameIfNeeded(): Promise<void> {
  try {
    const state = readPromptState();
    if (state.completedAt || state.dismissedAt) return;

    const records = await findLegacyAiSummaryNotes();
    if (!records.length) {
      writePromptState({ ...state, completedAt: new Date().toISOString() });
      return;
    }

    if (
      state.migrationId === MIGRATION_ID &&
      state.legacyCount === records.length &&
      state.remindedAt
    ) {
      return;
    }

    const shouldRename = await confirmLegacyRename(records);
    const now = new Date().toISOString();
    if (!shouldRename) {
      writePromptState({
        migrationId: MIGRATION_ID,
        legacyCount: records.length,
        remindedAt: now,
      });
      return;
    }

    const renamed = await markLegacyNotesAsSummary(records);
    showRenameResult(renamed, records.length);
    writePromptState({
      migrationId: MIGRATION_ID,
      legacyCount: records.length,
      remindedAt: now,
      completedAt: now,
    });
  } catch (error) {
    ztoolkit.log(
      "[AI-Butler] Legacy AI note compatibility prompt failed:",
      error,
    );
  }
}

async function findLegacyAiSummaryNotes(): Promise<LegacyAiNoteRecord[]> {
  const records: LegacyAiNoteRecord[] = [];
  const seenNoteIds = new Set<number>();
  const libraries = getLibraries();

  for (const library of libraries) {
    const items = await getLibraryItems(library.libraryID);
    for (const item of items) {
      if (!item?.isRegularItem?.()) continue;
      const noteIds = (((item as any).getNotes?.() || []) as unknown[])
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0);

      for (const noteId of noteIds) {
        if (seenNoteIds.has(noteId)) continue;
        seenNoteIds.add(noteId);
        const note = await Zotero.Items.getAsync(noteId);
        if (!note?.isNote?.()) continue;

        const tags = ((note as any).getTags?.() || []) as NoteTag[];
        const html = String((note as any).getNote?.() || "");
        if (!isLegacySummaryNote(tags, html)) continue;

        records.push({
          itemId: item.id,
          noteId,
          title: String(
            item.getField("title") || "\u672a\u547d\u540d\u6587\u732e",
          ),
        });
      }
    }
  }

  return records;
}

function getLibraries(): Array<{ libraryID: number }> {
  try {
    const allLibraries = Zotero.Libraries.getAll?.() || [];
    if (allLibraries.length)
      return allLibraries as Array<{ libraryID: number }>;
  } catch {
    // Fall back to the user library below.
  }
  return [{ libraryID: Zotero.Libraries.userLibraryID }];
}

async function getLibraryItems(libraryID: number): Promise<Zotero.Item[]> {
  try {
    return (await Zotero.Items.getAll(libraryID)) as Zotero.Item[];
  } catch (error) {
    ztoolkit.log(
      "[AI-Butler] Failed to scan library " +
        libraryID +
        " for legacy AI notes:",
      error,
    );
    return [];
  }
}

async function confirmLegacyRename(
  records: LegacyAiNoteRecord[],
): Promise<boolean> {
  const examples = records
    .slice(0, MAX_EXAMPLE_TITLES)
    .map((record) => "\u2022 " + record.title)
    .join("\n");
  const more =
    records.length > MAX_EXAMPLE_TITLES
      ? "\n\u7b49\u5171 " +
        records.length +
        " \u6761\u65e7 AI \u7b14\u8bb0\u3002"
      : "\n\u5171 " + records.length + " \u6761\u65e7 AI \u7b14\u8bb0\u3002";

  return Services.prompt.confirm(
    Zotero.getMainWindow() as any,
    "AI \u7ba1\u5bb6\u7b14\u8bb0\u517c\u5bb9\u63d0\u793a",
    [
      "\u65b0\u7248 AI \u7ba1\u5bb6\u4f1a\u628a\u7b14\u8bb0\u5206\u6210\u201cAI \u603b\u7ed3\u201d\u548c\u201cAI \u7cbe\u8bfb\u201d\u3002",
      "\u68c0\u6d4b\u5230\u4f60\u5df2\u6709\u65e7\u7248\u201cAI \u7b14\u8bb0\u201d\uff0c\u5efa\u8bae\u73b0\u5728\u5c06\u5b83\u4eec\u6807\u8bb0/\u66f4\u540d\u4e3a\u201cAI \u603b\u7ed3\u201d\uff0c\u4ee5\u540e\u4ecd\u53ef\u6b63\u5e38\u8bfb\u53d6\u3002",
      "",
      examples + more,
      "",
      "\u70b9\u51fb\u201c\u786e\u5b9a\u201d\u540e\u4f1a\u4e3a\u65e7\u7b14\u8bb0\u6dfb\u52a0 AI-Summary \u6807\u8bb0\uff0c\u5e76\u5c3d\u91cf\u628a\u65e7\u6807\u9898\u524d\u7f00\u6539\u4e3a AI \u603b\u7ed3\uff1b\u4e0d\u4f1a\u5220\u9664\u539f\u6709\u5185\u5bb9\u3002",
    ].join("\n"),
  );
}

async function markLegacyNotesAsSummary(
  records: LegacyAiNoteRecord[],
): Promise<number> {
  let renamed = 0;
  for (const record of records) {
    try {
      const note = await Zotero.Items.getAsync(record.noteId);
      if (!note?.isNote?.()) continue;
      const tags = ((note as any).getTags?.() || []) as NoteTag[];
      const html = String((note as any).getNote?.() || "");
      if (!isLegacySummaryNote(tags, html)) continue;

      if (!tags.some((tag) => tag.tag === SUMMARY_NOTE_TAG)) {
        note.addTag(SUMMARY_NOTE_TAG);
      }
      const renamedHtml = renameLegacyHeading(html);
      if (renamedHtml !== html) {
        (note as any).setNote(renamedHtml);
      }
      await (note as any).saveTx?.();
      renamed += 1;
    } catch (error) {
      ztoolkit.log(
        "[AI-Butler] Failed to mark legacy AI note " +
          record.noteId +
          " as AI summary:",
        error,
      );
    }
  }
  return renamed;
}

function renameLegacyHeading(html: string): string {
  return html.replace(
    /<h2>\s*AI\s*\u7ba1\u5bb6\s*-\s*/,
    "<h2>AI \u603b\u7ed3 - ",
  );
}

function showRenameResult(renamed: number, total: number): void {
  try {
    new ztoolkit.ProgressWindow("AI Butler", {
      closeOnClick: true,
      closeTime: 5000,
    })
      .createLine({
        text:
          "\u5df2\u5c06 " +
          renamed +
          "/" +
          total +
          " \u6761\u65e7 AI \u7b14\u8bb0\u6807\u8bb0\u4e3a AI \u603b\u7ed3",
        type: renamed === total ? "success" : "warning",
      })
      .show();
  } catch {
    // Best-effort user feedback.
  }
}

function readPromptState(): PromptState {
  const raw = (getPref("legacyAiNoteRenamePromptState" as any) as string) || "";
  if (!raw) return {};
  try {
    return JSON.parse(raw) as PromptState;
  } catch {
    return {};
  }
}

function writePromptState(state: PromptState): void {
  setPref("legacyAiNoteRenamePromptState" as any, JSON.stringify(state) as any);
}
