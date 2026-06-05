import { config } from "../../package.json";
import {
  isDeepReadNote,
  isRegularSummaryNote,
  type NoteTag,
} from "./aiNoteClassifier";
import { TaskQueueManager, TaskStatus, type TaskItem } from "./taskQueue";

const COLUMN_DATA_KEY = "aiButlerSummaryStatus";
const COLUMN_LABEL = "AI 状态";
const DEFAULT_STATUS_JSON = JSON.stringify({
  status: "idle",
  progress: 0,
  tooltip: "未精读",
} satisfies LibraryStatusColumnData);

type SummaryColumnStatus =
  | "idle"
  | "queued"
  | "processing"
  | "completed"
  | "failed";

export interface LibraryStatusColumnData {
  status: SummaryColumnStatus;
  progress: number;
  tooltip: string;
}

export type SummaryTaskLike = Pick<
  TaskItem,
  | "id"
  | "itemId"
  | "status"
  | "progress"
  | "createdAt"
  | "completedAt"
  | "error"
  | "taskType"
>;

let registeredDataKey: string | null = null;
let notifierID: string | null = null;
let unsubscribeProgress: (() => void) | null = null;
let unsubscribeComplete: (() => void) | null = null;
let refreshTimer: number | null = null;
const pendingRefreshItemIDs = new Set<number>();
let forceRefreshAll = false;
const summaryNoteCache = new Map<number, boolean>();
const deepReadNoteCache = new Map<number, boolean>();

function logLibraryStatusColumn(...args: Parameters<ZToolkit["log"]>): void {
  try {
    if (typeof ztoolkit !== "undefined") {
      ztoolkit.log(...args);
    }
  } catch {
    // UI refresh logging is best-effort.
  }
}

export function isSummaryTask(task: SummaryTaskLike): boolean {
  return !task.taskType || task.taskType === "summary";
}

export function isDeepReadTask(task: SummaryTaskLike): boolean {
  return task.taskType === "deepRead";
}

export function resolveSummaryStatusFromTasks(
  tasks: SummaryTaskLike[],
  hasSummaryNote: boolean,
): LibraryStatusColumnData {
  const summaryTasks = tasks.filter(isSummaryTask);
  const activeTask = pickLatestTaskByStatus(summaryTasks, [
    TaskStatus.PROCESSING,
    TaskStatus.PRIORITY,
    TaskStatus.PENDING,
  ]);

  if (activeTask) {
    if (activeTask.status === TaskStatus.PROCESSING) {
      const progress = clampProgress(activeTask.progress);
      return {
        status: "processing",
        progress,
        tooltip: `正在精读：${progress}%`,
      };
    }

    return {
      status: "queued",
      progress: clampProgress(activeTask.progress),
      tooltip:
        activeTask.status === TaskStatus.PRIORITY
          ? "等待精读（优先）"
          : "等待精读",
    };
  }

  if (hasSummaryNote) {
    return {
      status: "completed",
      progress: 100,
      tooltip: "已精读",
    };
  }

  const completedTask = pickLatestTaskByStatus(summaryTasks, [
    TaskStatus.COMPLETED,
  ]);
  if (completedTask) {
    return {
      status: "completed",
      progress: 100,
      tooltip: "已精读",
    };
  }

  const failedTask = pickLatestTaskByStatus(summaryTasks, [TaskStatus.FAILED]);
  if (failedTask) {
    return {
      status: "failed",
      progress: clampProgress(failedTask.progress),
      tooltip: failedTask.error ? `精读失败：${failedTask.error}` : "精读失败",
    };
  }

  return {
    status: "idle",
    progress: 0,
    tooltip: "未精读",
  };
}

export function resolveCombinedAiStatusFromTasks(
  tasks: SummaryTaskLike[],
  hasSummaryNote: boolean,
  hasDeepReadNote: boolean,
): LibraryStatusColumnData {
  const summary = resolveKindStatus(
    tasks,
    hasSummaryNote,
    "summary",
    "AI 总结",
  );
  const deepRead = resolveKindStatus(
    tasks,
    hasDeepReadNote,
    "deepRead",
    "AI 精读",
  );
  const parts = [summary.tooltip, deepRead.tooltip];

  if (summary.status === "processing" || deepRead.status === "processing") {
    const active = summary.status === "processing" ? summary : deepRead;
    return {
      status: "processing",
      progress: active.progress,
      tooltip: parts.join("?"),
    };
  }
  if (summary.status === "queued" || deepRead.status === "queued") {
    const active = summary.status === "queued" ? summary : deepRead;
    return {
      status: "queued",
      progress: active.progress,
      tooltip: parts.join("?"),
    };
  }
  if (summary.status === "failed" || deepRead.status === "failed") {
    const active = summary.status === "failed" ? summary : deepRead;
    return {
      status: "failed",
      progress: active.progress,
      tooltip: parts.join("?"),
    };
  }
  if (summary.status === "completed" && deepRead.status === "completed") {
    return { status: "completed", progress: 100, tooltip: parts.join("?") };
  }
  return { status: "idle", progress: 0, tooltip: parts.join("?") };
}

function resolveKindStatus(
  tasks: SummaryTaskLike[],
  hasNote: boolean,
  taskType: "summary" | "deepRead",
  label: string,
): LibraryStatusColumnData {
  const kindTasks = tasks.filter((task) =>
    taskType === "summary" ? isSummaryTask(task) : isDeepReadTask(task),
  );
  const activeTask = pickLatestTaskByStatus(kindTasks, [
    TaskStatus.PROCESSING,
    TaskStatus.PRIORITY,
    TaskStatus.PENDING,
  ]);
  if (activeTask) {
    const progress = clampProgress(activeTask.progress);
    if (activeTask.status === TaskStatus.PROCESSING) {
      return {
        status: "processing",
        progress,
        tooltip: `${label}处理中 ${progress}%`,
      };
    }
    return {
      status: "queued",
      progress,
      tooltip:
        activeTask.status === TaskStatus.PRIORITY
          ? `${label}排队（优先）`
          : `${label}排队`,
    };
  }
  if (hasNote || pickLatestTaskByStatus(kindTasks, [TaskStatus.COMPLETED])) {
    return { status: "completed", progress: 100, tooltip: `${label}已完成` };
  }
  const failedTask = pickLatestTaskByStatus(kindTasks, [TaskStatus.FAILED]);
  if (failedTask) {
    return {
      status: "failed",
      progress: clampProgress(failedTask.progress),
      tooltip: failedTask.error
        ? `${label}失败：${failedTask.error}`
        : `${label}失败`,
    };
  }
  return { status: "idle", progress: 0, tooltip: `? ${label}` };
}

export function serializeStatusData(data: LibraryStatusColumnData): string {
  return JSON.stringify(data);
}

export function registerLibraryStatusColumn(): void {
  if (registeredDataKey || typeof Zotero === "undefined") {
    return;
  }

  try {
    const result = Zotero.ItemTreeManager.registerColumn({
      dataKey: COLUMN_DATA_KEY,
      label: COLUMN_LABEL,
      pluginID: config.addonID,
      enabledTreeIDs: ["main"],
      width: "42",
      minWidth: 32,
      fixedWidth: true,
      staticWidth: true,
      showInColumnPicker: true,
      columnPickerSubMenu: true,
      zoteroPersist: ["width", "hidden"],
      dataProvider: provideStatusData,
      renderCell: renderStatusCell,
    });

    if (!result) {
      logLibraryStatusColumn("[AI-Butler] AI 状态列注册失败");
      return;
    }

    registeredDataKey = result;
    bindQueueRefreshCallbacks();
    bindNoteRefreshNotifier();
    logLibraryStatusColumn("[AI-Butler] AI 状态列已注册", registeredDataKey);
  } catch (error) {
    logLibraryStatusColumn("[AI-Butler] AI 状态列注册失败", error);
  }
}

export function unregisterLibraryStatusColumn(): void {
  if (refreshTimer !== null) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  unsubscribeProgress?.();
  unsubscribeProgress = null;
  unsubscribeComplete?.();
  unsubscribeComplete = null;

  if (notifierID) {
    try {
      Zotero.Notifier.unregisterObserver(notifierID);
    } catch (error) {
      logLibraryStatusColumn("[AI-Butler] 注销 AI 状态列监听失败", error);
    }
    notifierID = null;
  }

  if (registeredDataKey) {
    try {
      Zotero.ItemTreeManager.unregisterColumn(registeredDataKey);
    } catch (error) {
      logLibraryStatusColumn("[AI-Butler] 注销 AI 状态列失败", error);
    }
    registeredDataKey = null;
  }

  pendingRefreshItemIDs.clear();
  forceRefreshAll = false;
  summaryNoteCache.clear();
  deepReadNoteCache.clear();
}

function provideStatusData(item: Zotero.Item): string {
  try {
    const itemId = getRegularItemId(item);
    if (!itemId) {
      return serializeStatusData({
        status: "idle",
        progress: 0,
        tooltip: "",
      });
    }

    const manager = TaskQueueManager.getInstance();
    const tasks = manager
      .getAllTasks()
      .filter((task) => task.itemId === itemId);
    const data = resolveCombinedAiStatusFromTasks(
      tasks,
      hasRegularSummaryNote(item, itemId),
      hasDeepReadNote(item, itemId),
    );
    return serializeStatusData(data);
  } catch (error) {
    logLibraryStatusColumn("[AI-Butler] 读取 AI 状态列失败", error);
    return DEFAULT_STATUS_JSON;
  }
}

function renderStatusCell(
  _index: number,
  data: string,
  column: _ZoteroTypes.ItemTreeManager.ItemTreeColumnOptions & {
    className: string;
  },
  _isFirstColumn: boolean,
  doc: Document,
): HTMLElement {
  const parsed = parseStatusData(data);
  const cell = doc.createElement("span");
  cell.className = `cell ${column.className}`;
  if (parsed.status === "idle") {
    cell.title = "";
    return cell;
  }

  cell.title = parsed.tooltip;
  cell.setAttribute("aria-label", parsed.tooltip);
  cell.style.display = "flex";
  cell.style.alignItems = "center";
  cell.style.justifyContent = "center";
  cell.style.width = "100%";
  cell.style.height = "100%";

  const circle = doc.createElement("span");
  circle.style.width = "12px";
  circle.style.height = "12px";
  circle.style.borderRadius = "50%";
  circle.style.boxSizing = "border-box";
  circle.style.display = "inline-block";
  circle.style.flex = "0 0 auto";

  applyCircleStyle(circle, parsed);
  cell.appendChild(circle);
  return cell;
}

function applyCircleStyle(
  circle: HTMLElement,
  data: LibraryStatusColumnData,
): void {
  const progress = clampProgress(data.progress);

  if (data.status === "completed") {
    circle.style.background = "#34a853";
    circle.style.border = "none";
    circle.style.boxShadow = "inset 0 0 0 1px rgba(0, 0, 0, 0.12)";
    return;
  }

  if (data.status === "processing") {
    const visibleProgress = Math.max(progress, 10);
    circle.style.background = `radial-gradient(circle at center, Canvas 0 48%, transparent 50%), conic-gradient(#4f8df7 ${visibleProgress}%, rgba(79, 141, 247, 0.22) 0)`;
    circle.style.border = "none";
    return;
  }

  if (data.status === "queued") {
    circle.style.background = "#8ab4f8";
    circle.style.border = "none";
    circle.style.boxShadow = "inset 0 0 0 1px rgba(26, 88, 180, 0.18)";
    return;
  }

  if (data.status === "failed") {
    circle.style.background = "#f85149";
    circle.style.border = "none";
    circle.style.boxShadow = "inset 0 0 0 1px rgba(0, 0, 0, 0.12)";
    return;
  }

  circle.style.display = "none";
}

function parseStatusData(data: string): LibraryStatusColumnData {
  try {
    const parsed = JSON.parse(data) as Partial<LibraryStatusColumnData>;
    const status = parsed.status || "idle";
    if (
      !["idle", "queued", "processing", "completed", "failed"].includes(status)
    ) {
      return JSON.parse(DEFAULT_STATUS_JSON) as LibraryStatusColumnData;
    }
    return {
      status,
      progress: clampProgress(parsed.progress || 0),
      tooltip: parsed.tooltip || "未精读",
    };
  } catch {
    return JSON.parse(DEFAULT_STATUS_JSON) as LibraryStatusColumnData;
  }
}

function hasRegularSummaryNote(item: Zotero.Item, itemId: number): boolean {
  return hasAiNoteKind(item, itemId, "summary", summaryNoteCache);
}

function hasDeepReadNote(item: Zotero.Item, itemId: number): boolean {
  return hasAiNoteKind(item, itemId, "deepRead", deepReadNoteCache);
}

function hasAiNoteKind(
  item: Zotero.Item,
  itemId: number,
  kind: "summary" | "deepRead",
  cache: Map<number, boolean>,
): boolean {
  const cached = cache.get(itemId);
  if (cached !== undefined) return cached;

  const noteIDs = getNoteIds(item);
  for (const noteID of noteIDs) {
    try {
      const note = Zotero.Items.get(noteID);
      if (!note?.isNote?.()) continue;

      const tags = ((note as any).getTags?.() || []) as NoteTag[];
      const noteHtml = ((note as any).getNote?.() || "") as string;
      const matches =
        kind === "summary"
          ? isRegularSummaryNote(tags, noteHtml)
          : isDeepReadNote(tags, noteHtml);
      if (matches) {
        cache.set(itemId, true);
        return true;
      }
    } catch {
      continue;
    }
  }

  cache.set(itemId, false);
  return false;
}

function getNoteIds(item: Zotero.Item): number[] {
  const noteIDs = ((item as any).getNotes?.() || []) as Array<number | string>;
  return noteIDs
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);
}

function getRegularItemId(item: Zotero.Item): number | null {
  if (!item?.isRegularItem?.()) {
    return null;
  }
  return Number.isInteger(item.id) && item.id > 0 ? item.id : null;
}

function bindQueueRefreshCallbacks(): void {
  const manager = TaskQueueManager.getInstance();
  unsubscribeProgress = manager.onProgress((taskId) => {
    refreshTaskRow(taskId);
  });
  unsubscribeComplete = manager.onComplete((taskId) => {
    refreshTaskRow(taskId);
  });
}

function bindNoteRefreshNotifier(): void {
  notifierID = Zotero.Notifier.registerObserver(
    {
      notify: async (event, type, ids) => {
        if (!["add", "modify", "delete", "trash", "remove"].includes(event)) {
          return;
        }

        if (type === "item-tag") {
          summaryNoteCache.clear();
          deepReadNoteCache.clear();
          scheduleRefreshAll();
          return;
        }

        if (type !== "item") {
          return;
        }

        const itemIDs = ids.map((id) => Number(id)).filter(Number.isInteger);
        await refreshItemsAndParents(itemIDs);
      },
    },
    ["item", "item-tag"],
    "ai-butler-library-status-column",
  );
}

function refreshTaskRow(taskId: string): void {
  const task = TaskQueueManager.getInstance().getTask(taskId);
  if (!task || (!isSummaryTask(task) && !isDeepReadTask(task))) {
    return;
  }
  summaryNoteCache.delete(task.itemId);
  deepReadNoteCache.delete(task.itemId);
  scheduleItemRefresh(task.itemId);
}

async function refreshItemsAndParents(itemIDs: number[]): Promise<void> {
  if (!itemIDs.length) {
    return;
  }

  for (const itemID of itemIDs) {
    summaryNoteCache.delete(itemID);
    deepReadNoteCache.delete(itemID);
    try {
      const item = await Zotero.Items.getAsync(itemID);
      const parentID = Number(
        (item as any)?.parentID || (item as any)?.parentItemID,
      );
      if (Number.isInteger(parentID) && parentID > 0) {
        summaryNoteCache.delete(parentID);
        deepReadNoteCache.delete(parentID);
        scheduleItemRefresh(parentID);
      }
      if (item?.isRegularItem?.()) {
        scheduleItemRefresh(itemID);
      }
    } catch {
      scheduleRefreshAll();
    }
  }
}

function scheduleItemRefresh(itemId: number): void {
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return;
  }
  pendingRefreshItemIDs.add(itemId);
  scheduleFlushRefresh();
}

function scheduleRefreshAll(): void {
  forceRefreshAll = true;
  scheduleFlushRefresh();
}

function scheduleFlushRefresh(): void {
  if (refreshTimer !== null) {
    return;
  }
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void flushRefresh();
  }, 80) as unknown as number;
}

async function flushRefresh(): Promise<void> {
  const itemIDs = Array.from(pendingRefreshItemIDs);
  pendingRefreshItemIDs.clear();
  const shouldRefreshAll = forceRefreshAll;
  forceRefreshAll = false;

  try {
    if (!shouldRefreshAll && itemIDs.length) {
      await Zotero.Notifier.trigger("redraw", "item", itemIDs, {}, true);
    }
  } catch (error) {
    logLibraryStatusColumn("[AI-Butler] AI 状态列单行刷新失败", error);
  }

  try {
    Zotero.ItemTreeManager.refreshColumns();
  } catch (error) {
    logLibraryStatusColumn("[AI-Butler] AI 状态列刷新失败", error);
  }

  invalidateOpenItemTrees();
}

function invalidateOpenItemTrees(): void {
  try {
    for (const pane of Zotero.getZoteroPanes?.() || []) {
      const itemsView = pane.itemsView as
        | false
        | {
            invalidate?: () => void;
            refresh?: () => void;
            treeInstance?: { invalidate?: () => void };
          };
      if (!itemsView) {
        continue;
      }
      if (typeof itemsView.invalidate === "function") {
        itemsView.invalidate();
        continue;
      }
      if (typeof itemsView.treeInstance?.invalidate === "function") {
        itemsView.treeInstance.invalidate();
        continue;
      }
      if (typeof itemsView.refresh === "function") {
        itemsView.refresh();
      }
    }
  } catch (error) {
    logLibraryStatusColumn(
      "[AI-Butler] AI status column item tree invalidation failed",
      error,
    );
  }
}

function pickLatestTaskByStatus(
  tasks: SummaryTaskLike[],
  statuses: TaskStatus[],
): SummaryTaskLike | undefined {
  const statusSet = new Set(statuses);
  return tasks
    .filter((task) => statusSet.has(task.status))
    .sort((a, b) => getTaskTime(b) - getTaskTime(a))[0];
}

function getTaskTime(task: SummaryTaskLike): number {
  return (
    normalizeDate(task.completedAt)?.getTime() ||
    normalizeDate(task.createdAt)?.getTime() ||
    0
  );
}

function normalizeDate(value: Date | string | undefined): Date | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(progress)));
}
