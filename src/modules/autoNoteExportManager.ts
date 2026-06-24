import { getNoteExportConfig } from "./noteExportConfig";
import { NoteExportService } from "./noteExportService";
import { getEffectiveTaskType, TaskQueueManager } from "./taskQueue";

export class AutoNoteExportManager {
  private static instance: AutoNoteExportManager | null = null;

  private unsubscribeTaskComplete: (() => void) | null = null;
  private pendingTimers: Map<number, number> = new Map();

  public static getInstance(): AutoNoteExportManager {
    if (!AutoNoteExportManager.instance) {
      AutoNoteExportManager.instance = new AutoNoteExportManager();
    }
    return AutoNoteExportManager.instance;
  }

  public start(): void {
    if (this.unsubscribeTaskComplete) return;
    const queue = TaskQueueManager.getInstance();
    this.unsubscribeTaskComplete = queue.onComplete((taskId, success) => {
      if (!success) return;
      const task = queue.getTask(taskId);
      if (!task) return;
      const taskType = getEffectiveTaskType(task);
      if (taskType !== "summary" && taskType !== "deepRead") return;
      this.scheduleItemExport(task.itemId);
    });
  }

  public stop(): void {
    this.unsubscribeTaskComplete?.();
    this.unsubscribeTaskComplete = null;
    for (const timerId of this.pendingTimers.values()) {
      clearTimeout(timerId);
    }
    this.pendingTimers.clear();
  }

  public reload(): void {
    this.stop();
    this.start();
  }

  public scheduleItemExport(itemId: number): void {
    const existing = this.pendingTimers.get(itemId);
    if (existing) clearTimeout(existing);

    const timerId = setTimeout(() => {
      this.pendingTimers.delete(itemId);
      this.exportIfEligible(itemId).catch((error) => {
        ztoolkit.log("[AI-Butler][AutoNoteExport] 自动导出失败:", error);
      });
    }, 1200) as any as number;
    this.pendingTimers.set(itemId, timerId);
  }

  public async exportIfEligible(itemId: number): Promise<boolean> {
    const config = getNoteExportConfig();
    if (!config.enabled || !config.rootPath.trim()) return false;

    const item = await Zotero.Items.getAsync(itemId);
    if (!item || !(item as any).isRegularItem?.()) return false;

    const collectionPath =
      await NoteExportService.findWatchedCollectionPathForItem(
        item as Zotero.Item,
        config,
      );
    if (!collectionPath) return false;

    if (
      !(await NoteExportService.isReadyForAutomaticExport(item as Zotero.Item))
    ) {
      return false;
    }

    const result = await NoteExportService.exportItem({
      item: item as Zotero.Item,
      collectionPath,
      config,
      requireBothNotes: true,
    });
    ztoolkit.log(
      `[AI-Butler][AutoNoteExport] 自动导出完成: ${result.title}, exported=${result.exportedFiles}, skipped=${result.skippedFiles}`,
    );
    return result.success;
  }
}
