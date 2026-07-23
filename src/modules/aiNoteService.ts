import {
  DEEP_READ_NOTE_TAG,
  LEGACY_SUMMARY_NOTE_TAG,
  SUMMARY_NOTE_TAG,
  isDeepReadNote,
  isFollowUpChatNote,
  isMisTaggedDeepReadSummaryNote,
  isRegularSummaryNote,
  type NoteTag,
} from "./aiNoteClassifier";
import {
  buildFollowUpChatPairNoteHtml,
  normalizeFollowUpChatNoteHtml,
  removeFollowUpChatPairFromNoteHtml,
} from "./noteMarkdown";
import {
  LLMNoteMetadataService,
  type LLMNoteMetadata,
} from "./llmNoteMetadata";
import { getString } from "../utils/locale";

export type AiNoteKind = "summary" | "deepRead";

export interface AiNoteRecord {
  note: Zotero.Item;
  rawHtml: string;
}

const NOTE_KIND_TAG: Record<AiNoteKind, string> = {
  summary: SUMMARY_NOTE_TAG,
  deepRead: DEEP_READ_NOTE_TAG,
};

const NOTE_KIND_TITLE_KEY: Record<AiNoteKind, string> = {
  summary: "note-kind-summary",
  deepRead: "note-kind-deep-read",
};

export class AiNoteService {
  private static noteWriteLocks = new Map<string, Promise<void>>();

  public static getTitle(kind: AiNoteKind): string {
    return getString(NOTE_KIND_TITLE_KEY[kind]);
  }

  public static getTag(kind: AiNoteKind): string {
    return NOTE_KIND_TAG[kind];
  }

  public static async resolveParentItem(
    item: Zotero.Item,
  ): Promise<Zotero.Item | null> {
    const rawItem = item as any;
    if (rawItem.isAttachment?.() || rawItem.isNote?.()) {
      const parentId = rawItem.parentItemID || rawItem.parentID;
      return parentId
        ? ((await Zotero.Items.getAsync(parentId)) as Zotero.Item)
        : null;
    }
    return item;
  }

  public static async findNote(
    item: Zotero.Item,
    kind: AiNoteKind,
  ): Promise<Zotero.Item | null> {
    const record = await this.findNoteRecord(item, kind);
    return record?.note || null;
  }

  public static async findNoteRecord(
    item: Zotero.Item,
    kind: AiNoteKind,
  ): Promise<AiNoteRecord | null> {
    try {
      const parentItem = await this.resolveParentItem(item);
      if (!parentItem) return null;
      const noteIDs = (parentItem as any).getNotes?.() || [];
      let target: Zotero.Item | null = null;
      let rawHtml = "";

      for (const nid of noteIDs) {
        const note = await Zotero.Items.getAsync(nid);
        if (!note) continue;
        const tags: NoteTag[] = (note as any).getTags?.() || [];
        const noteHtml: string = (note as any).getNote?.() || "";
        const matches =
          kind === "summary"
            ? isRegularSummaryNote(tags, noteHtml)
            : isDeepReadNote(tags, noteHtml);
        if (!matches) continue;

        const shouldSelect = !target || compareModified(note, target) > 0;
        const normalizedHtml = await this.normalizeMatchedNote(
          note as Zotero.Item,
          kind,
          tags,
          noteHtml,
        );

        if (shouldSelect) {
          target = note as Zotero.Item;
          rawHtml = normalizedHtml;
        }
      }

      return target ? { note: target, rawHtml } : null;
    } catch (error) {
      ztoolkit.log(`[AI-Butler] find ${kind} note failed:`, error);
      return null;
    }
  }

  public static async hasNote(
    item: Zotero.Item,
    kind: AiNoteKind,
  ): Promise<boolean> {
    return !!(await this.findNote(item, kind));
  }

  public static async saveGeneratedNote(options: {
    item: Zotero.Item;
    kind: AiNoteKind;
    html: string;
    existing?: Zotero.Item | null;
    policy?: string;
  }): Promise<Zotero.Item> {
    const parentItem =
      (await this.resolveParentItem(options.item)) || options.item;
    return this.withNoteWriteLock(parentItem, options.kind, async () => {
      const tag = NOTE_KIND_TAG[options.kind];
      const liveExisting = await this.findNote(parentItem, options.kind);
      const existing = liveExisting || options.existing || null;

      if (existing) {
        if (options.policy === "skip") {
          this.ensureTag(existing, tag);
          if (options.kind === "summary") {
            this.ensureTag(existing, SUMMARY_NOTE_TAG);
          }
          await (existing as any).saveTx?.();
          return existing;
        }

        const oldHtml = (existing as any).getNote?.() || "";
        const finalHtml =
          options.policy === "append"
            ? `${oldHtml}\n<hr/>\n${options.html}`
            : options.html;
        (existing as any).setNote?.(finalHtml);
        this.ensureTag(existing, tag);
        if (options.kind === "summary") {
          this.ensureTag(existing, SUMMARY_NOTE_TAG);
        }
        await (existing as any).saveTx?.();
        return existing;
      }

      const note = new Zotero.Item("note");
      note.libraryID = parentItem.libraryID;
      note.parentID = parentItem.id;
      note.setNote(options.html);
      note.addTag(tag);
      await note.saveTx();
      return note;
    });
  }
  public static async appendFollowUpPair(options: {
    item: Zotero.Item;
    pairId: string;
    userMessage: string;
    assistantMessage: string;
    metadata?: LLMNoteMetadata | null;
    sourceLabel?: string;
  }): Promise<Zotero.Item> {
    const note = await this.getOrCreateDeepReadNote(options.item);
    const noteHtml = (note as any).getNote?.() || "";
    const normalizedNoteHtml = normalizeFollowUpChatNoteHtml(noteHtml);

    if (
      normalizedNoteHtml.includes(
        `AI_BUTLER_CHAT_PAIR_START id=${options.pairId}`,
      )
    ) {
      if (normalizedNoteHtml !== noteHtml) {
        (note as any).setNote(normalizedNoteHtml);
        await (note as any).saveTx();
      }
      return note;
    }

    const blockContent = buildFollowUpChatPairNoteHtml({
      pairId: options.pairId,
      userMessage: options.userMessage,
      assistantMessage: options.assistantMessage,
      sourceLabel: options.sourceLabel,
    });
    const block = options.metadata
      ? LLMNoteMetadataService.wrapHtml(blockContent, options.metadata)
      : blockContent;

    (note as any).setNote(`${normalizedNoteHtml}${block}`);
    this.ensureTag(note, DEEP_READ_NOTE_TAG);
    await (note as any).saveTx();
    return note;
  }

  public static async findLegacyChatNote(
    item: Zotero.Item,
  ): Promise<Zotero.Item | null> {
    try {
      const parentItem = await this.resolveParentItem(item);
      if (!parentItem) return null;
      const noteIDs = (parentItem as any).getNotes?.() || [];
      for (const nid of noteIDs) {
        const note = await Zotero.Items.getAsync(nid);
        if (!note) continue;
        const tags: NoteTag[] = (note as any).getTags?.() || [];
        const html: string = (note as any).getNote?.() || "";
        if (isFollowUpChatNote(tags, html)) return note as Zotero.Item;
      }
    } catch (error) {
      ztoolkit.log("[AI-Butler] 查找旧追问笔记失败:", error);
    }
    return null;
  }

  public static async removeFollowUpPair(
    item: Zotero.Item,
    pairId: string,
  ): Promise<void> {
    const notes = [
      await this.findNote(item, "deepRead"),
      await this.findLegacyChatNote(item),
    ].filter((note): note is Zotero.Item => !!note);

    for (const note of notes) {
      const html = (note as any).getNote?.() || "";
      const updatedHtml = removeFollowUpChatPairFromNoteHtml(html, pairId);
      if (updatedHtml === html) continue;
      (note as any).setNote(updatedHtml);
      await (note as any).saveTx();
    }
  }

  private static async getOrCreateDeepReadNote(
    item: Zotero.Item,
  ): Promise<Zotero.Item> {
    const parentItem = (await this.resolveParentItem(item)) || item;
    return this.withNoteWriteLock(parentItem, "deepRead", async () => {
      const existing = await this.findNote(parentItem, "deepRead");
      if (existing) return existing;

      const title =
        (parentItem.getField("title") as string) ||
        getString("common-paper-title");
      const note = new Zotero.Item("note");
      note.libraryID = parentItem.libraryID;
      note.parentID = parentItem.id;
      note.setNote(
        `<h1>${getString("deep-read-note-title", { args: { title: escapeHtml(title) } })}</h1>`,
      );
      note.addTag(DEEP_READ_NOTE_TAG);
      await note.saveTx();
      return note;
    });
  }

  private static async withNoteWriteLock<T>(
    parentItem: Zotero.Item,
    kind: AiNoteKind,
    work: () => Promise<T>,
  ): Promise<T> {
    const key = `${parentItem.libraryID || 0}:${parentItem.id}:${kind}`;
    const previous = this.noteWriteLocks.get(key) || Promise.resolve();
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const chained = previous.catch(() => undefined).then(() => current);
    this.noteWriteLocks.set(key, chained);

    await previous.catch(() => undefined);
    try {
      return await work();
    } finally {
      releaseCurrent();
      if (this.noteWriteLocks.get(key) === chained) {
        this.noteWriteLocks.delete(key);
      }
    }
  }
  private static ensureTag(note: Zotero.Item, tag: string): void {
    const tags: NoteTag[] = (note as any).getTags?.() || [];
    if (!tags.some((entry) => entry.tag === tag)) {
      note.addTag(tag);
    }
  }

  private static async normalizeMatchedNote(
    note: Zotero.Item,
    kind: AiNoteKind,
    tags: NoteTag[],
    noteHtml: string,
  ): Promise<string> {
    if (kind !== "summary") return noteHtml;

    let changed = false;
    let normalizedHtml = noteHtml;
    if (!tags.some((entry) => entry.tag === SUMMARY_NOTE_TAG)) {
      note.addTag(SUMMARY_NOTE_TAG);
      changed = true;
    }

    if (isMisTaggedDeepReadSummaryNote(tags, noteHtml)) {
      if (tags.some((entry) => entry.tag === DEEP_READ_NOTE_TAG)) {
        this.removeTag(note, DEEP_READ_NOTE_TAG, tags);
        changed = true;
      }

      normalizedHtml = this.renameLegacySummaryHeading(normalizedHtml);
      if (normalizedHtml !== noteHtml) {
        (note as any).setNote?.(normalizedHtml);
        changed = true;
      }
    }

    if (changed) {
      try {
        await (note as any).saveTx?.();
      } catch (error) {
        ztoolkit.log("[AI-Butler] normalize summary note failed:", error);
      }
    }
    return normalizedHtml;
  }

  private static removeTag(
    note: Zotero.Item,
    tag: string,
    currentTags: NoteTag[],
  ): void {
    const noteApi = note as any;
    if (typeof noteApi.removeTag === "function") {
      noteApi.removeTag(tag);
      return;
    }
    if (typeof noteApi.setTags === "function") {
      noteApi.setTags(currentTags.filter((entry) => entry.tag !== tag));
    }
  }

  private static renameLegacySummaryHeading(html: string): string {
    return html.replace(
      /<h2>\s*AI\s*\u7ba1\u5bb6\s*-\s*/,
      `<h2>${getString("note-kind-summary")} - `,
    );
  }
}

function compareModified(a: Zotero.Item, b: Zotero.Item): number {
  const aModified = Date.parse(String((a as any).dateModified || "")) || 0;
  const bModified = Date.parse(String((b as any).dateModified || "")) || 0;
  return aModified - bModified;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export default AiNoteService;
