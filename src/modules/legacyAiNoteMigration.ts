import { getPref, setPref } from "../utils/prefs";
import { getString } from "../utils/locale";
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
            item.getField("title") ||
              getString("legacy-ai-note-migration-untitled-paper"),
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
  const more = getString(
    records.length > MAX_EXAMPLE_TITLES
      ? "legacy-ai-note-migration-more-count"
      : "legacy-ai-note-migration-total-count",
    { args: { count: records.length } },
  );

  return Services.prompt.confirm(
    Zotero.getMainWindow() as any,
    getString("legacy-ai-note-migration-confirm-title"),
    getString("legacy-ai-note-migration-confirm-message", {
      args: { examples, more },
    }),
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
    `<h2>${getString("legacy-ai-note-migration-renamed-heading-prefix")}`,
  );
}

function showRenameResult(renamed: number, total: number): void {
  try {
    new ztoolkit.ProgressWindow("AI Butler", {
      closeOnClick: true,
      closeTime: 5000,
    })
      .createLine({
        text: getString("legacy-ai-note-migration-renamed-count", {
          args: { renamed, total },
        }),
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
