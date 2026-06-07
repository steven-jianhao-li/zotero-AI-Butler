import {
  classifyAiButlerNote,
  type AiButlerNoteType,
  type NoteTag,
} from "./aiNoteClassifier";
import { TaskQueueManager, type TaskType } from "./taskQueue";

export type CollectionAiNoteCleanScope = "summary" | "all";
export type CollectionAiNoteCleanAction = "delete" | "deleteAndRegenerate";

export type RegeneratableAiNoteType =
  | "summary"
  | "deepRead"
  | "imageSummary"
  | "mindmap"
  | "tableFill";
export type CleanableAiNoteType = RegeneratableAiNoteType | "chat";

export interface CollectionAiNoteRecord {
  noteId: number;
  itemId: number;
  itemTitle: string;
  type: CleanableAiNoteType;
}

export interface CollectionAiNoteItemPlan {
  itemId: number;
  itemTitle: string;
  types: CleanableAiNoteType[];
}

export interface CollectionAiNoteCleanPlan {
  collectionId: number;
  collectionName: string;
  scope: CollectionAiNoteCleanScope;
  includeChat: boolean;
  scannedItemCount: number;
  notes: CollectionAiNoteRecord[];
  itemPlans: CollectionAiNoteItemPlan[];
  counts: Record<CleanableAiNoteType, number>;
}

export interface CollectionAiNoteCleanResult {
  deletedNotes: number;
  failedDeletes: number;
  clearedTasks: number;
  queued: Record<RegeneratableAiNoteType, number>;
}

const REGENERATABLE_NOTE_TYPES: RegeneratableAiNoteType[] = [
  "summary",
  "deepRead",
  "imageSummary",
  "mindmap",
  "tableFill",
];

const CLEANABLE_NOTE_TYPES: CleanableAiNoteType[] = [
  ...REGENERATABLE_NOTE_TYPES,
  "chat",
];

const EMPTY_COUNTS: Record<CleanableAiNoteType, number> = {
  summary: 0,
  deepRead: 0,
  imageSummary: 0,
  mindmap: 0,
  tableFill: 0,
  chat: 0,
};

const EMPTY_REGENERATABLE_COUNTS: Record<RegeneratableAiNoteType, number> = {
  summary: 0,
  deepRead: 0,
  imageSummary: 0,
  mindmap: 0,
  tableFill: 0,
};

function isRegeneratableNoteType(
  type: AiButlerNoteType | null,
): type is RegeneratableAiNoteType {
  return (
    type === "summary" ||
    type === "deepRead" ||
    type === "imageSummary" ||
    type === "mindmap" ||
    type === "tableFill"
  );
}

function isCleanableNoteType(
  type: AiButlerNoteType | null,
): type is CleanableAiNoteType {
  return (
    type === "summary" ||
    type === "deepRead" ||
    type === "imageSummary" ||
    type === "mindmap" ||
    type === "tableFill" ||
    type === "chat"
  );
}

function getScopeTypes(
  scope: CollectionAiNoteCleanScope,
  includeChat: boolean,
): Set<CleanableAiNoteType> {
  if (scope === "summary") {
    return new Set(["summary"]);
  }

  return new Set(
    includeChat
      ? CLEANABLE_NOTE_TYPES
      : (REGENERATABLE_NOTE_TYPES as CleanableAiNoteType[]),
  );
}

function getItemTitle(item: Zotero.Item): string {
  return String(item.getField("title") || "未命名文献");
}

export class CollectionAiNoteCleaner {
  public static readonly TYPE_LABELS: Record<CleanableAiNoteType, string> = {
    summary: "AI 总结",
    deepRead: "AI 精读",
    imageSummary: "一图总结",
    mindmap: "思维导图",
    tableFill: "填表笔记",
    chat: "后续追问记录",
  };

  public static async inspectCollection(
    collection: Zotero.Collection,
    scope: CollectionAiNoteCleanScope,
    options: { includeChat?: boolean } = {},
  ): Promise<CollectionAiNoteCleanPlan> {
    const items = await this.collectRegularItemsFromCollectionTree(collection);
    const includeChat = scope === "all" && options.includeChat === true;
    const cleanableTypes = getScopeTypes(scope, includeChat);
    const notes: CollectionAiNoteRecord[] = [];
    const itemTypeMap = new Map<number, CollectionAiNoteItemPlan>();
    const counts = { ...EMPTY_COUNTS };

    for (const item of items) {
      const noteIds =
        (item as { getNotes?: () => number[] }).getNotes?.() || [];
      const itemTitle = getItemTitle(item);

      for (const noteId of noteIds) {
        const note = await Zotero.Items.getAsync(noteId);
        if (!note) continue;

        const tags: NoteTag[] =
          (note as { getTags?: () => NoteTag[] }).getTags?.() || [];
        const noteHtml = (note as { getNote?: () => string }).getNote?.() || "";
        const noteType = classifyAiButlerNote(tags, noteHtml);

        if (!isCleanableNoteType(noteType) || !cleanableTypes.has(noteType)) {
          continue;
        }

        notes.push({
          noteId,
          itemId: item.id,
          itemTitle,
          type: noteType,
        });
        counts[noteType] += 1;

        const itemPlan =
          itemTypeMap.get(item.id) ||
          ({
            itemId: item.id,
            itemTitle,
            types: [],
          } satisfies CollectionAiNoteItemPlan);
        if (!itemPlan.types.includes(noteType)) {
          itemPlan.types.push(noteType);
        }
        itemTypeMap.set(item.id, itemPlan);
      }
    }

    return {
      collectionId: collection.id,
      collectionName: collection.name,
      scope,
      includeChat,
      scannedItemCount: items.length,
      notes,
      itemPlans: Array.from(itemTypeMap.values()).map((plan) => ({
        ...plan,
        types: this.sortTypes(plan.types),
      })),
      counts,
    };
  }

  public static async applyPlan(
    plan: CollectionAiNoteCleanPlan,
    action: CollectionAiNoteCleanAction,
  ): Promise<CollectionAiNoteCleanResult> {
    const manager = TaskQueueManager.getInstance();
    let clearedTasks = 0;
    for (const itemPlan of plan.itemPlans) {
      const affectedTaskTypes = this.sortTypes(
        itemPlan.types.filter(isRegeneratableNoteType),
      ) as TaskType[];
      if (affectedTaskTypes.length === 0) continue;
      clearedTasks += await manager.clearTasksForItems(
        [itemPlan.itemId],
        affectedTaskTypes,
      );
    }

    let deletedNotes = 0;
    let failedDeletes = 0;

    for (const noteRecord of plan.notes) {
      try {
        const note = await Zotero.Items.getAsync(noteRecord.noteId);
        if (!note) continue;

        const eraseTx = (
          note as unknown as { eraseTx?: () => Promise<boolean | void> }
        ).eraseTx;
        if (!eraseTx) {
          throw new Error(`笔记 ${noteRecord.noteId} 不支持删除`);
        }
        await eraseTx.call(note);
        deletedNotes += 1;
      } catch (error) {
        failedDeletes += 1;
        ztoolkit.log(
          `[AI-Butler] 删除 AI 管家笔记失败: ${noteRecord.noteId}`,
          error,
        );
      }
    }

    const queued = { ...EMPTY_REGENERATABLE_COUNTS };
    if (action === "deleteAndRegenerate") {
      for (const itemPlan of plan.itemPlans) {
        const item = await Zotero.Items.getAsync(itemPlan.itemId);
        if (!item || !item.isRegularItem()) continue;

        for (const type of itemPlan.types) {
          if (!isRegeneratableNoteType(type)) continue;
          await this.enqueueRegeneration(manager, item, type);
          queued[type] += 1;
        }
      }
    }

    return {
      deletedNotes,
      failedDeletes,
      clearedTasks,
      queued,
    };
  }

  private static async collectRegularItemsFromCollectionTree(
    root: Zotero.Collection,
  ): Promise<Zotero.Item[]> {
    const items: Zotero.Item[] = [];
    const seenItems = new Set<number>();
    const seenCollections = new Set<number>();
    const queue: Zotero.Collection[] = [root];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (seenCollections.has(current.id)) continue;
      seenCollections.add(current.id);

      for (const item of current.getChildItems()) {
        if (!item.isRegularItem() || seenItems.has(item.id)) continue;
        seenItems.add(item.id);
        items.push(item);
      }

      const children = Zotero.Collections.getByParent(current.id) || [];
      for (const child of children) {
        queue.push(child as Zotero.Collection);
      }
    }

    return items;
  }

  private static async enqueueRegeneration(
    manager: TaskQueueManager,
    item: Zotero.Item,
    type: RegeneratableAiNoteType,
  ): Promise<void> {
    switch (type) {
      case "summary":
        await manager.addTask(item, false, {
          summaryMode: "single",
          forceOverwrite: true,
        });
        break;
      case "deepRead":
        await manager.addDeepReadTask(item, false, {
          summaryMode: "deepRead",
          forceOverwrite: true,
        });
        break;
      case "imageSummary":
        await manager.addImageSummaryTask(item, false);
        break;
      case "mindmap":
        await manager.addMindmapTask(item, false);
        break;
      case "tableFill":
        await manager.addTableFillTask(item, false);
        break;
    }
  }

  private static sortTypes(
    types: Iterable<CleanableAiNoteType>,
  ): CleanableAiNoteType[] {
    const typeSet = new Set(types);
    return CLEANABLE_NOTE_TYPES.filter((type) => typeSet.has(type));
  }
}

export default CollectionAiNoteCleaner;
