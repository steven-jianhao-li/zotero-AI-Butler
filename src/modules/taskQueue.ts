/**
 * ================================================================
 * 任务队列管理器
 * ================================================================
 *
 * 本模块提供文献处理任务的队列管理功能
 *
 * 主要职责:
 * 1. 任务入队/出队管理
 * 2. 任务状态跟踪 (待处理/处理中/已完成/失败)
 * 3. 优先级调度
 * 4. 并发控制
 * 5. 失败重试机制
 * 6. 持久化存储
 * 7. 任务进度回调
 *
 * 任务执行流程:
 * 1. 用户添加任务到队列
 * 2. 任务按优先级和创建时间排序
 * 3. 后台执行器按并发数限制处理任务
 * 4. 任务完成/失败后更新状态
 * 5. 失败任务可重试或移除
 *
 * @module taskQueue
 * @author AI-Butler Team
 */

import { getPref } from "../utils/prefs";
import { NoteGenerator } from "./noteGenerator";
import { PDFExtractor } from "./pdfExtractor";
import type { LLMAbortSignal } from "./llmproviders/types";
import {
  LLM_REQUEST_ABORT_MESSAGE,
  isAbortError,
} from "./llmproviders/shared/requestAbort";
import { TaskArtifacts, type FixedTaskArtifactType } from "./taskArtifacts";
import { isTableFeatureEnabled } from "./uiCustomization";

function logTaskQueue(...args: Parameters<ZToolkit["log"]>): void {
  try {
    if (typeof ztoolkit !== "undefined") {
      ztoolkit.log(...args);
    }
  } catch {
    // Logging is best-effort and must not affect queue state transitions.
  }
}

/** 无 PDF 附件错误标识 */
const NO_PDF_ERROR_MSG =
  "该条目没有 PDF 附件，无法进行 AI 分析。请先为该文献添加 PDF 文件。";
const TASK_ABORT_DETAIL = "该总结任务已由用户手动终止。";

type TaskAbortController = {
  signal: LLMAbortSignal;
  abort(reason?: unknown): void;
};

class SimpleAbortSignal implements LLMAbortSignal {
  public aborted = false;
  public reason?: unknown;
  private listeners: Set<() => void> = new Set();

  addEventListener(type: "abort", listener: () => void): void {
    if (type === "abort") this.listeners.add(listener);
  }

  removeEventListener(type: "abort", listener: () => void): void {
    if (type === "abort") this.listeners.delete(listener);
  }

  abort(reason?: unknown): void {
    if (this.aborted) return;
    this.aborted = true;
    this.reason = reason;
    const listeners = Array.from(this.listeners);
    this.listeners.clear();
    for (const listener of listeners) {
      listener();
    }
  }

  throwIfAborted(): void {
    if (!this.aborted) return;
    throw new Error(
      typeof this.reason === "string" ? this.reason : LLM_REQUEST_ABORT_MESSAGE,
    );
  }
}

class SimpleAbortController implements TaskAbortController {
  public readonly signal = new SimpleAbortSignal();

  abort(reason?: unknown): void {
    this.signal.abort(reason);
  }
}

function createTaskAbortController(): TaskAbortController {
  const NativeAbortController = (
    globalThis as unknown as {
      AbortController?: new () => TaskAbortController;
    }
  ).AbortController;
  return NativeAbortController
    ? new NativeAbortController()
    : new SimpleAbortController();
}

/**
 * 任务状态枚举
 */
export enum TaskStatus {
  PENDING = "pending", // 待处理
  PROCESSING = "processing", // 处理中
  COMPLETED = "completed", // 已完成
  FAILED = "failed", // 失败
  PRIORITY = "priority", // 优先处理
}

/**
 * 任务类型枚举
 */
export type TaskType =
  | "summary"
  | "deepRead"
  | "imageSummary"
  | "mindmap"
  | "tableFill"
  | "review"
  | "targetedQuestion";

/**
 * 任务项接口
 */
export interface TaskItem {
  id: string; // 任务唯一ID (使用 Zotero Item ID)
  itemId: number; // Zotero 文献条目 ID
  title: string; // 文献标题
  status: TaskStatus; // 当前状态
  progress: number; // 进度百分比 (0-100)
  createdAt: Date; // 创建时间
  startedAt?: Date; // 开始处理时间
  completedAt?: Date; // 完成时间
  error?: string; // 错误信息
  errorDetails?: string; // 可复制的完整错误诊断信息
  retryCount: number; // 已重试次数
  maxRetries: number; // 最大重试次数
  duration?: number; // 处理耗时(秒)
  /** 任务类型: summary(默认) 或 imageSummary(一图总结) 或 mindmap(思维导图) */
  taskType?: TaskType;
  /** 工作流阶段 (一图总结专用) */
  workflowStage?: string;
  options?: {
    summaryMode?: string;
    forceOverwrite?: boolean;
  };
  /** 综述任务参数 */
  collectionId?: number;
  pdfAttachmentIds?: number[];
  reviewName?: string;
  tableTemplate?: string;
  /** 针对性提问任务参数 */
  targetedPrompt?: string;
  targetedNoteTitle?: string;
  targetedSelectedTableEntries?: string[];
  targetedAppendedTableEntries?: string[];
}

export function getSummaryTaskId(itemId: number): string {
  return `summary-task-${itemId}`;
}

export function getDeepReadTaskId(itemId: number): string {
  return `deepread-task-${itemId}`;
}

export function getLegacySummaryTaskId(itemId: number): string {
  return `task-${itemId}`;
}

export function getEffectiveTaskType(
  task: Pick<TaskItem, "taskType">,
): TaskType {
  return task.taskType || "summary";
}

/**
 * 任务队列统计信息
 */
export interface QueueStats {
  total: number; // 总任务数
  pending: number; // 待处理数
  priority: number; // 优先处理数
  processing: number; // 处理中数
  completed: number; // 已完成数
  failed: number; // 失败数
  successRate: number; // 成功率(%)
}

/**
 * 任务进度回调类型
 */
export type TaskProgressCallback = (
  taskId: string,
  progress: number,
  message: string,
) => void;

/**
 * 任务完成回调类型
 */
export type TaskCompleteCallback = (
  taskId: string,
  success: boolean,
  error?: string,
) => void;

/**
 * 任务流式事件回调类型
 */
export type TaskStreamCallback = (
  taskId: string,
  event: {
    type: "start" | "chunk" | "finish" | "error";
    chunk?: string;
    title?: string;
  },
) => void;

/**
 * 任务队列管理器类
 */
export class TaskQueueManager {
  /** 单例实例 */
  private static instance: TaskQueueManager | null = null;

  /** 任务队列 */
  private tasks: Map<string, TaskItem> = new Map();

  /** 当前正在处理的任务ID集合 */
  private processingTasks: Set<string> = new Set();

  /** 正在执行的总结任务中断控制器 */
  private taskAbortControllers: Map<string, TaskAbortController> = new Map();

  /** 已请求终止但底层请求尚未结束的任务 */
  private abortingTasks: Set<string> = new Set();

  /** 任务进度回调函数集合 */
  private progressCallbacks: Set<TaskProgressCallback> = new Set();

  /** 任务完成回调函数集合 */
  private completeCallbacks: Set<TaskCompleteCallback> = new Set();

  /** 任务流式事件回调函数集合 */
  private streamCallbacks: Set<TaskStreamCallback> = new Set();

  /** 队列执行器定时器ID */
  private executorTimerId: number | null = null;

  /** 最近一次加载到的持久化快照时间 */
  private lastLoadedSnapshotAt: string | null = null;

  /** 最大并发数 */
  private maxConcurrency: number = 1;

  /** 每批次处理的任务数量 */
  private batchSize: number = 1;

  /** 当前是否正在执行批次 */
  private isBatchRunning: boolean = false;

  /** 执行间隔(毫秒) */
  private executionInterval: number = 60000; // 默认60秒

  /** 是否正在运行 */
  private isRunning: boolean = false;

  /**
   * 私有构造函数(单例模式)
   */
  private constructor() {
    this.loadFromStorage(true);
    this.loadSettings();
  }

  /**
   * 获取单例实例
   */
  public static getInstance(): TaskQueueManager {
    if (!TaskQueueManager.instance) {
      TaskQueueManager.instance = new TaskQueueManager();
    }
    return TaskQueueManager.instance;
  }

  private async requeueExistingFixedTask(
    task: TaskItem,
    item: Zotero.Item,
    artifactType: FixedTaskArtifactType,
    priority: boolean,
    options?: TaskItem["options"],
    workflowStage?: string,
  ): Promise<boolean> {
    if (task.status === TaskStatus.PROCESSING) {
      logTaskQueue(`任务正在执行，跳过重复入队: ${task.id}`);
      return false;
    }

    if (task.status === TaskStatus.COMPLETED) {
      const shouldRegenerate = await this.shouldRegenerateCompletedTask(
        task,
        item,
        artifactType,
        options,
      );
      if (!shouldRegenerate) {
        logTaskQueue(`任务已完成且真实产物仍可用，跳过入队: ${task.id}`);
        return false;
      }

      logTaskQueue(`任务已完成但需要重新生成，重新入队: ${task.id}`);
      this.resetTaskForEnqueue(task, priority, options, workflowStage);
      await this.saveToStorage();
      if (artifactType === "summary" || artifactType === "deepRead") {
        this.notifySummaryTaskEnqueued(task);
      }
      return true;
    }

    if (task.status === TaskStatus.FAILED) {
      if (
        await this.shouldSkipNewFixedTaskForExistingArtifact(
          item,
          artifactType,
          options,
        )
      ) {
        logTaskQueue(
          `失败任务已有可用产物且当前策略为跳过，标记完成: ${task.id}`,
        );
        task.status = TaskStatus.COMPLETED;
        task.progress = 100;
        task.error = undefined;
        task.errorDetails = undefined;
        task.retryCount = 0;
        task.startedAt = undefined;
        task.completedAt = new Date();
        task.duration = 0;
        task.options = options;
        task.workflowStage = "已存在，跳过生成";
        await this.saveToStorage();
        this.notifyProgress(
          task.id,
          100,
          "AI artifact already exists; skipped",
        );
        this.notifyComplete(task.id, true);
        return false;
      }

      logTaskQueue(`失败任务重新入队: ${task.id}`);
      this.resetTaskForEnqueue(task, priority, options, workflowStage);
      await this.saveToStorage();
      if (artifactType === "summary" || artifactType === "deepRead") {
        this.notifySummaryTaskEnqueued(task);
      }
      return true;
    }

    task.status =
      priority || task.status === TaskStatus.PRIORITY
        ? TaskStatus.PRIORITY
        : TaskStatus.PENDING;
    task.options = options;
    task.createdAt = new Date();
    if (workflowStage !== undefined) {
      task.workflowStage = workflowStage;
    }
    await this.saveToStorage();
    logTaskQueue(`更新已排队任务: ${task.id}`);
    return true;
  }

  private async shouldRegenerateCompletedTask(
    task: TaskItem,
    item: Zotero.Item,
    artifactType: FixedTaskArtifactType,
    options?: TaskItem["options"],
  ): Promise<boolean> {
    const artifact = await TaskArtifacts.probe(artifactType, item);
    const policyRequiresRegeneration = this.shouldRegenerateWhenArtifactExists(
      artifactType,
      options,
    );

    if (artifact.probeFailed) {
      logTaskQueue(
        `[AI-Butler] 任务 ${task.id} 产物探测失败，按策略决定是否重新生成: ${artifact.reason || "unknown"}`,
      );
      return policyRequiresRegeneration;
    }

    if (!artifact.exists) {
      logTaskQueue(
        `[AI-Butler] 任务 ${task.id} 的真实产物缺失，重新生成: ${artifact.reason || "missing"}`,
      );
      return true;
    }

    return policyRequiresRegeneration;
  }

  private shouldRegenerateWhenArtifactExists(
    artifactType: FixedTaskArtifactType,
    options?: TaskItem["options"],
  ): boolean {
    if (artifactType === "summary" || artifactType === "deepRead") {
      if (options?.forceOverwrite) {
        return true;
      }
      const policy = (
        (getPref("noteStrategy" as any) as string) || "skip"
      ).toLowerCase();
      return policy === "overwrite" || policy === "append";
    }

    if (artifactType === "tableFill") {
      const policy = (
        (getPref("tableStrategy" as any) as string) || "skip"
      ).toLowerCase();
      return policy === "overwrite";
    }

    return false;
  }

  private async shouldSkipNewFixedTaskForExistingArtifact(
    item: Zotero.Item,
    artifactType: FixedTaskArtifactType,
    options?: TaskItem["options"],
  ): Promise<boolean> {
    const artifact = await TaskArtifacts.probe(artifactType, item);
    if (artifact.probeFailed || !artifact.exists) {
      return false;
    }

    return !this.shouldRegenerateWhenArtifactExists(artifactType, options);
  }

  private async recordSkippedCompletedTask(
    task: TaskItem,
    message: string,
  ): Promise<void> {
    this.tasks.set(task.id, task);
    await this.saveToStorage();
    this.notifyProgress(task.id, 100, message);
    this.notifyComplete(task.id, true);
  }

  private resetTaskForEnqueue(
    task: TaskItem,
    priority: boolean,
    options?: TaskItem["options"],
    workflowStage?: string,
  ): void {
    task.status = priority ? TaskStatus.PRIORITY : TaskStatus.PENDING;
    task.options = options;
    task.progress = 0;
    task.error = undefined;
    task.errorDetails = undefined;
    task.retryCount = 0;
    task.startedAt = undefined;
    task.completedAt = undefined;
    task.duration = undefined;
    task.createdAt = new Date();
    if (workflowStage !== undefined) {
      task.workflowStage = workflowStage;
    }
  }

  private notifySummaryTaskEnqueued(task: TaskItem): void {
    if (task.taskType && task.taskType !== "summary") {
      return;
    }
    if (!this.progressCallbacks) {
      return;
    }
    this.notifyProgress(task.id, task.progress, "AI summary queued");
  }

  // ==================== 任务管理 ====================

  /**
   * 添加单个任务到队列
   *
   * @param item Zotero 文献条目
   * @param priority 是否优先处理
   * @returns 任务ID
   */
  public async addTask(
    item: Zotero.Item,
    priority: boolean = false,
    options?: { summaryMode?: string; forceOverwrite?: boolean },
  ): Promise<string> {
    if (options?.summaryMode && options.summaryMode !== "single") {
      return this.addDeepReadTask(item, priority, options);
    }

    const taskId = getSummaryTaskId(item.id);
    const legacyTaskId = getLegacySummaryTaskId(item.id);
    if (!this.tasks.has(taskId) && this.tasks.has(legacyTaskId)) {
      const legacyTask = this.tasks.get(legacyTaskId)!;
      this.tasks.delete(legacyTaskId);
      legacyTask.id = taskId;
      legacyTask.taskType = "summary";
      this.tasks.set(taskId, legacyTask);
    }

    // 检查是否已存在
    if (this.tasks.has(taskId)) {
      const existingTask = this.tasks.get(taskId)!;
      const shouldRun = await this.requeueExistingFixedTask(
        existingTask,
        item,
        "summary",
        priority,
        options,
      );
      if (!shouldRun) {
        return taskId;
      }

      if (!this.isRunning) {
        this.start();
      }
      if (priority) {
        this.executeTask(taskId).catch((e) => {
          logTaskQueue(`优先任务立即执行失败: ${e}`);
        });
      }
      return taskId;
    }

    if (
      await this.shouldSkipNewFixedTaskForExistingArtifact(
        item,
        "summary",
        options,
      )
    ) {
      logTaskQueue(`AI 总结已存在且当前策略为跳过，跳过入队: ${taskId}`);
      await this.recordSkippedCompletedTask(
        {
          id: taskId,
          itemId: item.id,
          title: item.getField("title") as string,
          status: TaskStatus.COMPLETED,
          progress: 100,
          createdAt: new Date(),
          completedAt: new Date(),
          retryCount: 0,
          maxRetries: parseInt(getPref("maxRetries") as string) || 3,
          taskType: "summary",
          workflowStage: "已存在，跳过生成",
          options,
          duration: 0,
        },
        "AI summary already exists; skipped",
      );
      return taskId;
    }

    // 创建任务项
    const task: TaskItem = {
      id: taskId,
      itemId: item.id,
      title: item.getField("title") as string,
      status: priority ? TaskStatus.PRIORITY : TaskStatus.PENDING,
      progress: 0,
      createdAt: new Date(),
      retryCount: 0,
      maxRetries: parseInt(getPref("maxRetries") as string) || 3,
      taskType: "summary",
      workflowStage: "等待 AI 总结",
      options,
    };

    this.tasks.set(taskId, task);
    await this.saveToStorage();
    this.notifySummaryTaskEnqueued(task);

    logTaskQueue(`添加任务: ${task.title} (${taskId})`);

    // 如果执行器未运行,启动它
    if (!this.isRunning) {
      this.start();
    }

    // 如果是优先任务，立即执行（不等待批处理周期）
    if (priority) {
      this.executeTask(taskId).catch((e) => {
        logTaskQueue(`优先任务立即执行失败: ${e}`);
      });
    }

    return taskId;
  }

  public async addDeepReadTask(
    item: Zotero.Item,
    priority: boolean = false,
    options?: { summaryMode?: string; forceOverwrite?: boolean },
  ): Promise<string> {
    const taskId = getDeepReadTaskId(item.id);
    const deepReadOptions = {
      ...(options || {}),
      summaryMode: "deepRead",
    };

    if (this.tasks.has(taskId)) {
      const existingTask = this.tasks.get(taskId)!;
      const shouldRun = await this.requeueExistingFixedTask(
        existingTask,
        item,
        "deepRead",
        priority,
        deepReadOptions,
        "等待 AI 精读",
      );
      if (!shouldRun) return taskId;

      if (!this.isRunning) this.start();
      if (priority) {
        this.executeTask(taskId).catch((e) => {
          logTaskQueue(`AI 精读优先任务立即执行失败: ${e}`);
        });
      }
      return taskId;
    }

    if (
      await this.shouldSkipNewFixedTaskForExistingArtifact(
        item,
        "deepRead",
        deepReadOptions,
      )
    ) {
      logTaskQueue(`AI 精读已存在且当前策略为跳过，跳过入队: ${taskId}`);
      await this.recordSkippedCompletedTask(
        {
          id: taskId,
          itemId: item.id,
          title: item.getField("title") as string,
          status: TaskStatus.COMPLETED,
          progress: 100,
          createdAt: new Date(),
          completedAt: new Date(),
          retryCount: 0,
          maxRetries: parseInt(getPref("maxRetries") as string) || 3,
          taskType: "deepRead",
          workflowStage: "已存在，跳过生成",
          options: deepReadOptions,
          duration: 0,
        },
        "AI deep read already exists; skipped",
      );
      return taskId;
    }

    const task: TaskItem = {
      id: taskId,
      itemId: item.id,
      title: item.getField("title") as string,
      status: priority ? TaskStatus.PRIORITY : TaskStatus.PENDING,
      progress: 0,
      createdAt: new Date(),
      retryCount: 0,
      maxRetries: parseInt(getPref("maxRetries") as string) || 3,
      taskType: "deepRead",
      workflowStage: "等待 AI 精读",
      options: deepReadOptions,
    };

    this.tasks.set(taskId, task);
    await this.saveToStorage();
    this.notifySummaryTaskEnqueued(task);

    logTaskQueue(`添加 AI 精读任务: ${task.title} (${taskId})`);

    if (!this.isRunning) this.start();
    if (priority) {
      this.executeTask(taskId).catch((e) => {
        logTaskQueue(`AI 精读优先任务立即执行失败: ${e}`);
      });
    }

    return taskId;
  }

  /**
   * 批量添加任务
   *
   * @param items Zotero 文献条目数组
   * @param priority 是否优先处理
   * @returns 任务ID数组
   */
  public async addTasks(
    items: Zotero.Item[],
    priority: boolean = false,
  ): Promise<string[]> {
    const taskIds: string[] = [];

    for (const item of items) {
      const taskId = await this.addTask(item, priority);
      taskIds.push(taskId);
    }

    return taskIds;
  }

  /**
   * 添加一图总结任务
   *
   * @param item Zotero 文献条目
   * @returns 任务ID
   */
  public async addImageSummaryTask(
    item: Zotero.Item,
    priority: boolean = true,
  ): Promise<string> {
    const taskId = `img-task-${item.id}`;

    // 检查是否已存在
    if (this.tasks.has(taskId)) {
      const existingTask = this.tasks.get(taskId)!;
      const shouldRun = await this.requeueExistingFixedTask(
        existingTask,
        item,
        "imageSummary",
        priority,
        undefined,
        "等待开始",
      );
      if (shouldRun) {
        if (!this.isRunning) {
          this.start();
        }
        if (priority) {
          this.executeImageSummaryTask(taskId).catch((e) => {
            logTaskQueue(`一图总结任务执行失败: ${e}`);
          });
        }
      }
      return taskId;
    }

    // 创建任务项
    const task: TaskItem = {
      id: taskId,
      itemId: item.id,
      title: item.getField("title") as string,
      status: priority ? TaskStatus.PRIORITY : TaskStatus.PENDING,
      progress: 0,
      createdAt: new Date(),
      retryCount: 0,
      maxRetries: 1, // 一图总结只重试1次
      taskType: "imageSummary",
      workflowStage: "等待开始",
    };

    this.tasks.set(taskId, task);
    await this.saveToStorage();

    logTaskQueue(`添加一图总结任务: ${task.title} (${taskId})`);

    if (!this.isRunning) {
      this.start();
    }

    if (priority) {
      this.executeImageSummaryTask(taskId).catch((e) => {
        logTaskQueue(`一图总结任务执行失败: ${e}`);
      });
    }

    return taskId;
  }

  /**
   * 执行一图总结任务
   *
   * @param taskId 任务ID
   */
  private async executeImageSummaryTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || task.taskType !== "imageSummary") {
      return;
    }

    // 防止重复执行
    if (
      task.status === TaskStatus.PROCESSING ||
      task.status === TaskStatus.COMPLETED
    ) {
      return;
    }

    // 更新任务状态
    task.status = TaskStatus.PROCESSING;
    task.startedAt = new Date();
    task.progress = 0;
    task.error = undefined;
    task.errorDetails = undefined;
    task.workflowStage = "正在初始化";
    this.processingTasks.add(taskId);
    await this.saveToStorage();

    logTaskQueue(`开始执行一图总结任务: ${task.title}`);

    try {
      // 获取 Zotero Item
      const item = await Zotero.Items.getAsync(task.itemId);
      if (!item) {
        throw new Error("文献条目不存在");
      }

      // 动态导入 ImageSummaryService
      const { ImageSummaryService } = await import("./imageSummaryService");

      // 执行一图总结
      await ImageSummaryService.generateForItem(
        item,
        (stage, message, progress) => {
          // 更新任务进度
          task.progress = progress;
          task.workflowStage = message;
          this.notifyProgress(taskId, progress, message);
          // 保存进度（但不要太频繁）
          if (progress % 20 === 0 || progress === 100) {
            this.saveToStorage().catch(() => {});
          }
        },
      );

      // 任务成功完成
      task.status = TaskStatus.COMPLETED;
      task.progress = 100;
      task.workflowStage = "完成";
      task.completedAt = new Date();
      task.duration = Math.floor(
        (task.completedAt.getTime() - task.startedAt!.getTime()) / 1000,
      );

      logTaskQueue(`一图总结任务完成: ${task.title} (耗时${task.duration}秒)`);
      this.notifyComplete(taskId, true);
    } catch (error: any) {
      // 任务失败
      task.error = this.getTaskErrorMessage(error);
      task.errorDetails = this.buildTaskErrorDetails(task, error);
      task.workflowStage = "失败";
      const suppressTaskRetry = this.shouldSuppressTaskRetry(error, task);

      task.retryCount++;
      if (!suppressTaskRetry && task.retryCount < task.maxRetries) {
        task.status = TaskStatus.PENDING;
        task.progress = 0;
        logTaskQueue(
          `一图总结任务失败,将重试 (${task.retryCount}/${task.maxRetries}): ${task.title}`,
        );
      } else {
        task.status = TaskStatus.FAILED;
        task.completedAt = new Date();
        logTaskQueue(`一图总结任务最终失败: ${task.title} - ${task.error}`);
      }

      this.notifyComplete(taskId, false, task.error);
    } finally {
      this.processingTasks.delete(taskId);
      await this.saveToStorage();
    }
  }

  /**
   * 获取一图总结任务
   */
  public getImageSummaryTasks(): TaskItem[] {
    return this.getAllTasks().filter((t) => t.taskType === "imageSummary");
  }

  /**
   * 添加思维导图任务
   *
   * @param item Zotero 文献条目
   * @returns 任务ID
   */
  public async addMindmapTask(
    item: Zotero.Item,
    priority: boolean = true,
  ): Promise<string> {
    const taskId = `mindmap-task-${item.id}`;

    // 检查是否已存在
    if (this.tasks.has(taskId)) {
      const existingTask = this.tasks.get(taskId)!;
      const shouldRun = await this.requeueExistingFixedTask(
        existingTask,
        item,
        "mindmap",
        priority,
        undefined,
        "等待开始",
      );
      if (shouldRun) {
        if (!this.isRunning) {
          this.start();
        }
        if (priority) {
          this.executeMindmapTask(taskId).catch((e) => {
            logTaskQueue(`思维导图任务执行失败: ${e}`);
          });
        }
      }
      return taskId;
    }

    // 创建任务项
    const task: TaskItem = {
      id: taskId,
      itemId: item.id,
      title: item.getField("title") as string,
      status: priority ? TaskStatus.PRIORITY : TaskStatus.PENDING,
      progress: 0,
      createdAt: new Date(),
      retryCount: 0,
      maxRetries: 2,
      taskType: "mindmap",
      workflowStage: "等待开始",
    };

    this.tasks.set(taskId, task);
    await this.saveToStorage();

    logTaskQueue(`添加思维导图任务: ${task.title} (${taskId})`);

    if (!this.isRunning) {
      this.start();
    }

    if (priority) {
      this.executeMindmapTask(taskId).catch((e) => {
        logTaskQueue(`思维导图任务执行失败: ${e}`);
      });
    }

    return taskId;
  }

  /**
   * 执行思维导图任务
   *
   * @param taskId 任务ID
   */
  private async executeMindmapTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || task.taskType !== "mindmap") {
      return;
    }

    // 防止重复执行
    if (
      task.status === TaskStatus.PROCESSING ||
      task.status === TaskStatus.COMPLETED
    ) {
      return;
    }

    // 更新任务状态
    task.status = TaskStatus.PROCESSING;
    task.startedAt = new Date();
    task.progress = 0;
    task.error = undefined;
    task.errorDetails = undefined;
    task.workflowStage = "正在初始化";
    this.processingTasks.add(taskId);
    await this.saveToStorage();

    logTaskQueue(`开始执行思维导图任务: ${task.title}`);

    try {
      // 获取 Zotero Item
      const item = await Zotero.Items.getAsync(task.itemId);
      if (!item) {
        throw new Error("文献条目不存在");
      }

      // 动态导入 MindmapService
      const { MindmapService } = await import("./mindmapService");

      // 执行思维导图生成
      await MindmapService.generateForItem(item, (stage, message, progress) => {
        // 更新任务进度
        task.progress = progress;
        task.workflowStage = message;
        this.notifyProgress(taskId, progress, message);
        // 保存进度（但不要太频繁）
        if (progress % 20 === 0 || progress === 100) {
          this.saveToStorage().catch(() => {});
        }
      });

      // 任务成功完成
      task.status = TaskStatus.COMPLETED;
      task.progress = 100;
      task.workflowStage = "完成";
      task.completedAt = new Date();
      task.duration = Math.floor(
        (task.completedAt.getTime() - task.startedAt!.getTime()) / 1000,
      );

      logTaskQueue(`思维导图任务完成: ${task.title} (耗时${task.duration}秒)`);
      this.notifyComplete(taskId, true);
    } catch (error: any) {
      // 任务失败
      task.error = this.getTaskErrorMessage(error);
      task.errorDetails = this.buildTaskErrorDetails(task, error);
      task.workflowStage = "失败";
      const suppressTaskRetry = this.shouldSuppressTaskRetry(error, task);

      task.retryCount++;
      if (!suppressTaskRetry && task.retryCount < task.maxRetries) {
        task.status = TaskStatus.PENDING;
        task.progress = 0;
        logTaskQueue(
          `思维导图任务失败,将重试 (${task.retryCount}/${task.maxRetries}): ${task.title}`,
        );
      } else {
        task.status = TaskStatus.FAILED;
        task.completedAt = new Date();
        logTaskQueue(`思维导图任务最终失败: ${task.title} - ${task.error}`);
      }

      this.notifyComplete(taskId, false, task.error);
    } finally {
      this.processingTasks.delete(taskId);
      await this.saveToStorage();
    }
  }

  /**
   * 获取思维导图任务
   */
  public getMindmapTasks(): TaskItem[] {
    return this.getAllTasks().filter((t) => t.taskType === "mindmap");
  }

  /**
   * 添加填表任务
   */
  public async addTableFillTask(
    item: Zotero.Item,
    priority: boolean = true,
  ): Promise<string> {
    if (!isTableFeatureEnabled()) {
      throw new Error("表格功能已在设置中关闭");
    }

    const taskId = `table-task-${item.id}`;

    if (this.tasks.has(taskId)) {
      const existingTask = this.tasks.get(taskId)!;
      const shouldRun = await this.requeueExistingFixedTask(
        existingTask,
        item,
        "tableFill",
        priority,
        undefined,
        "等待开始",
      );
      if (shouldRun) {
        if (!this.isRunning) {
          this.start();
        }
        if (priority) {
          this.executeTableFillTask(taskId).catch((e) => {
            logTaskQueue(`填表任务执行失败: ${e}`);
          });
        }
      }
      return taskId;
    }

    const task: TaskItem = {
      id: taskId,
      itemId: item.id,
      title: item.getField("title") as string,
      status: priority ? TaskStatus.PRIORITY : TaskStatus.PENDING,
      progress: 0,
      createdAt: new Date(),
      retryCount: 0,
      maxRetries: 2,
      taskType: "tableFill",
      workflowStage: "等待开始",
    };

    this.tasks.set(taskId, task);
    await this.saveToStorage();

    logTaskQueue(`添加填表任务: ${task.title} (${taskId})`);

    if (!this.isRunning) {
      this.start();
    }

    if (priority) {
      this.executeTableFillTask(taskId).catch((e) => {
        logTaskQueue(`填表任务执行失败: ${e}`);
      });
    }

    return taskId;
  }

  /**
   * 执行填表任务
   */
  private async executeTableFillTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || task.taskType !== "tableFill") return;

    if (!isTableFeatureEnabled()) {
      task.status = TaskStatus.FAILED;
      task.error = "表格功能已在设置中关闭";
      task.errorDetails = task.error;
      task.workflowStage = "已关闭";
      task.completedAt = new Date();
      this.notifyComplete(taskId, false, task.error);
      await this.saveToStorage();
      return;
    }

    if (
      task.status === TaskStatus.PROCESSING ||
      task.status === TaskStatus.COMPLETED
    )
      return;

    task.status = TaskStatus.PROCESSING;
    task.startedAt = new Date();
    task.progress = 0;
    task.error = undefined;
    task.errorDetails = undefined;
    task.workflowStage = "正在初始化";
    this.processingTasks.add(taskId);
    await this.saveToStorage();

    try {
      const item = await Zotero.Items.getAsync(task.itemId);
      if (!item) throw new Error("文献条目不存在");

      const { LiteratureReviewService } =
        await import("./literatureReviewService");
      const { getPref } = await import("../utils/prefs");
      const { DEFAULT_TABLE_TEMPLATE, DEFAULT_TABLE_FILL_PROMPT } =
        await import("../utils/prompts");

      const tableTemplate =
        (getPref("tableTemplate" as any) as string) || DEFAULT_TABLE_TEMPLATE;
      const fillPrompt =
        (getPref("tableFillPrompt" as any) as string) ||
        DEFAULT_TABLE_FILL_PROMPT;

      task.workflowStage = "正在提取 PDF";
      task.progress = 20;
      this.notifyProgress(taskId, 20, "正在提取 PDF");

      // 找到 PDF 附件
      const attachmentIDs = (item as any).getAttachments?.() || [];
      let pdfAtt: Zotero.Item | null = null;
      for (const attId of attachmentIDs) {
        const att = await Zotero.Items.getAsync(attId);
        if (att && (att as any).isPDFAttachment?.()) {
          pdfAtt = att;
          break;
        }
      }

      if (!pdfAtt) throw new Error("该条目没有 PDF 附件");

      task.workflowStage = "正在 AI 填表";
      task.progress = 40;
      this.notifyProgress(taskId, 40, "正在 AI 填表");

      const tableContent = await LiteratureReviewService.fillTableForSinglePDF(
        item,
        pdfAtt,
        tableTemplate,
        fillPrompt,
      );

      task.workflowStage = "正在保存";
      task.progress = 80;
      this.notifyProgress(taskId, 80, "正在保存");

      await LiteratureReviewService.saveTableNote(item, tableContent);

      task.status = TaskStatus.COMPLETED;
      task.progress = 100;
      task.workflowStage = "完成";
      task.completedAt = new Date();
      task.duration = Math.floor(
        (task.completedAt.getTime() - task.startedAt!.getTime()) / 1000,
      );

      logTaskQueue(`填表任务完成: ${task.title} (耗时${task.duration}秒)`);
      this.notifyComplete(taskId, true);
    } catch (error: any) {
      task.error = this.getTaskErrorMessage(error);
      task.errorDetails = this.buildTaskErrorDetails(task, error);
      task.workflowStage = "失败";
      const suppressTaskRetry = this.shouldSuppressTaskRetry(error, task);
      task.retryCount++;
      if (!suppressTaskRetry && task.retryCount < task.maxRetries) {
        task.status = TaskStatus.PENDING;
        task.progress = 0;
      } else {
        task.status = TaskStatus.FAILED;
        task.completedAt = new Date();
      }
      this.notifyComplete(taskId, false, task.error);
    } finally {
      this.processingTasks.delete(taskId);
      await this.saveToStorage();
    }
  }

  /**
   * 添加综述任务
   */
  public async addReviewTask(
    collection: Zotero.Collection,
    pdfAttachments: Zotero.Item[],
    reviewName: string,
    prompt?: string,
    tableTemplate?: string,
  ): Promise<string> {
    const taskId = `review-task-${collection.id}`;

    // 若已存在则更新
    if (this.tasks.has(taskId)) {
      const existing = this.tasks.get(taskId)!;
      if (existing.status === TaskStatus.PROCESSING) {
        logTaskQueue(`综述任务正在执行: ${taskId}`);
        return taskId;
      }
      this.tasks.delete(taskId);
    }

    const task: TaskItem = {
      id: taskId,
      itemId: collection.id,
      title: reviewName,
      status: TaskStatus.PRIORITY,
      progress: 0,
      createdAt: new Date(),
      retryCount: 0,
      maxRetries: 1,
      taskType: "review",
      workflowStage: "等待开始",
      collectionId: collection.id,
      pdfAttachmentIds: pdfAttachments.map((p) => p.id),
      reviewName,
      tableTemplate,
    };

    this.tasks.set(taskId, task);
    await this.saveToStorage();

    logTaskQueue(`添加综述任务: ${task.title} (${taskId})`);

    // 立即执行
    this.executeReviewTask(taskId, prompt).catch((e) => {
      logTaskQueue(`综述任务执行失败: ${e}`);
    });

    return taskId;
  }

  /**
   * 执行综述任务
   */
  private async executeReviewTask(
    taskId: string,
    prompt?: string,
  ): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || task.taskType !== "review") return;

    if (
      task.status === TaskStatus.PROCESSING ||
      task.status === TaskStatus.COMPLETED
    )
      return;

    task.status = TaskStatus.PROCESSING;
    task.startedAt = new Date();
    task.progress = 0;
    task.error = undefined;
    task.errorDetails = undefined;
    task.workflowStage = "正在初始化";
    this.processingTasks.add(taskId);
    await this.saveToStorage();

    try {
      if (!task.collectionId || !task.pdfAttachmentIds?.length) {
        throw new Error("综述任务参数不完整");
      }

      const collection = Zotero.Collections.get(
        task.collectionId,
      ) as Zotero.Collection;
      if (!collection) throw new Error("分类不存在");

      // 加载 PDF 附件
      const pdfAttachments: Zotero.Item[] = [];
      for (const attId of task.pdfAttachmentIds) {
        const att = await Zotero.Items.getAsync(attId);
        if (att) pdfAttachments.push(att);
      }

      if (pdfAttachments.length === 0) throw new Error("没有可用的 PDF 附件");

      const { LiteratureReviewService } =
        await import("./literatureReviewService");

      const reviewName =
        task.reviewName || `综述 ${new Date().toISOString().slice(2, 10)}`;

      await LiteratureReviewService.generateReview(
        collection,
        pdfAttachments,
        reviewName,
        prompt || "",
        task.tableTemplate || "",
        (message: string, progress: number) => {
          task.progress = progress;
          task.workflowStage = message;
          this.notifyProgress(taskId, progress, message);
          if (progress % 20 === 0 || progress === 100) {
            this.saveToStorage().catch(() => {});
          }
        },
      );

      task.status = TaskStatus.COMPLETED;
      task.progress = 100;
      task.workflowStage = "完成";
      task.completedAt = new Date();
      task.duration = Math.floor(
        (task.completedAt.getTime() - task.startedAt!.getTime()) / 1000,
      );

      logTaskQueue(`综述任务完成: ${task.title} (耗时${task.duration}秒)`);
      this.notifyComplete(taskId, true);
    } catch (error: any) {
      task.error = this.getTaskErrorMessage(error);
      task.errorDetails = this.buildTaskErrorDetails(task, error);
      task.workflowStage = "失败";
      task.status = TaskStatus.FAILED;
      task.completedAt = new Date();
      this.notifyComplete(taskId, false, task.error);
    } finally {
      this.processingTasks.delete(taskId);
      await this.saveToStorage();
    }
  }

  /**
   * 获取填表任务
   */
  public getTableFillTasks(): TaskItem[] {
    return this.getAllTasks().filter((t) => t.taskType === "tableFill");
  }

  /**
   * 获取综述任务
   */
  public getReviewTasks(): TaskItem[] {
    return this.getAllTasks().filter((t) => t.taskType === "review");
  }

  /**
   * 添加针对性提问任务
   */
  public async addTargetedQuestionTask(
    collection: Zotero.Collection,
    pdfAttachments: Zotero.Item[],
    noteTitle: string,
    targetedPrompt: string,
    tableTemplate?: string,
    options?: {
      selectedTableEntries?: string[];
      appendedTableEntries?: string[];
    },
  ): Promise<string> {
    const taskId = `targeted-task-${collection.id}-${Date.now()}-${Math.floor(
      Math.random() * 1000,
    )}`;

    const task: TaskItem = {
      id: taskId,
      itemId: collection.id,
      title: noteTitle,
      status: TaskStatus.PRIORITY,
      progress: 0,
      createdAt: new Date(),
      retryCount: 0,
      maxRetries: 1,
      taskType: "targetedQuestion",
      workflowStage: "等待开始",
      collectionId: collection.id,
      pdfAttachmentIds: pdfAttachments.map((p) => p.id),
      tableTemplate,
      targetedPrompt,
      targetedNoteTitle: noteTitle,
      targetedSelectedTableEntries: options?.selectedTableEntries || [],
      targetedAppendedTableEntries: options?.appendedTableEntries || [],
    };

    this.tasks.set(taskId, task);
    await this.saveToStorage();

    logTaskQueue(`添加针对性提问任务: ${task.title} (${taskId})`);

    // 立即执行
    this.executeTargetedQuestionTask(taskId).catch((e) => {
      logTaskQueue(`针对性提问任务执行失败: ${e}`);
    });

    return taskId;
  }

  /**
   * 执行针对性提问任务
   */
  private async executeTargetedQuestionTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || task.taskType !== "targetedQuestion") return;

    if (
      task.status === TaskStatus.PROCESSING ||
      task.status === TaskStatus.COMPLETED
    )
      return;

    task.status = TaskStatus.PROCESSING;
    task.startedAt = new Date();
    task.progress = 0;
    task.error = undefined;
    task.errorDetails = undefined;
    task.workflowStage = "正在初始化";
    this.processingTasks.add(taskId);
    await this.saveToStorage();

    try {
      if (
        !task.collectionId ||
        !task.pdfAttachmentIds?.length ||
        !task.targetedPrompt
      ) {
        throw new Error("针对性提问任务参数不完整");
      }

      const collection = Zotero.Collections.get(
        task.collectionId,
      ) as Zotero.Collection;
      if (!collection) throw new Error("分类不存在");

      const pdfAttachments: Zotero.Item[] = [];
      for (const attId of task.pdfAttachmentIds) {
        const att = await Zotero.Items.getAsync(attId);
        if (att) pdfAttachments.push(att);
      }
      if (pdfAttachments.length === 0) throw new Error("没有可用的 PDF 附件");

      const { LiteratureReviewService } =
        await import("./literatureReviewService");
      const noteTitle =
        task.targetedNoteTitle ||
        `针对性提问 ${new Date().toISOString().slice(2, 10)}`;

      await LiteratureReviewService.generateTargetedAnswer(
        collection,
        pdfAttachments,
        noteTitle,
        task.targetedPrompt,
        task.tableTemplate || "",
        {
          selectedTableEntries: task.targetedSelectedTableEntries || [],
          appendedTableEntries: task.targetedAppendedTableEntries || [],
        },
        (message: string, progress: number) => {
          task.progress = progress;
          task.workflowStage = message;
          this.notifyProgress(taskId, progress, message);
          if (progress % 20 === 0 || progress === 100) {
            this.saveToStorage().catch(() => {});
          }
        },
      );

      task.status = TaskStatus.COMPLETED;
      task.progress = 100;
      task.workflowStage = "完成";
      task.completedAt = new Date();
      task.duration = Math.floor(
        (task.completedAt.getTime() - task.startedAt!.getTime()) / 1000,
      );

      logTaskQueue(
        `针对性提问任务完成: ${task.title} (耗时${task.duration}秒)`,
      );
      this.notifyComplete(taskId, true);
    } catch (error: any) {
      task.error = this.getTaskErrorMessage(error);
      task.errorDetails = this.buildTaskErrorDetails(task, error);
      task.workflowStage = "失败";
      task.status = TaskStatus.FAILED;
      task.completedAt = new Date();
      this.notifyComplete(taskId, false, task.error);
    } finally {
      this.processingTasks.delete(taskId);
      await this.saveToStorage();
    }
  }

  /**
   * 获取针对性提问任务
   */
  public getTargetedQuestionTasks(): TaskItem[] {
    return this.getAllTasks().filter((t) => t.taskType === "targetedQuestion");
  }

  /**
   * 清空指定文献和任务类型对应的队列记录。
   *
   * 用于批量删除 AI 管家笔记时同步移除旧任务，再按需要重新入普通队列。
   */
  public async clearTasksForItems(
    itemIds: Iterable<number>,
    taskTypes?: Iterable<TaskType>,
  ): Promise<number> {
    const itemIdSet = new Set(itemIds);
    if (itemIdSet.size === 0) {
      return 0;
    }

    const taskTypeSet = taskTypes ? new Set(taskTypes) : null;
    let removedCount = 0;

    for (const [taskId, task] of Array.from(this.tasks.entries())) {
      if (!itemIdSet.has(task.itemId)) continue;

      const taskType = task.taskType || "summary";
      if (taskTypeSet && !taskTypeSet.has(taskType)) continue;

      if (
        task.status === TaskStatus.PROCESSING &&
        (taskType === "summary" || taskType === "deepRead")
      ) {
        const controller = this.taskAbortControllers.get(taskId);
        controller?.abort(LLM_REQUEST_ABORT_MESSAGE);
      }

      this.tasks.delete(taskId);
      this.processingTasks.delete(taskId);
      this.taskAbortControllers.delete(taskId);
      this.abortingTasks.delete(taskId);
      removedCount += 1;
    }

    if (removedCount > 0) {
      await this.saveToStorage();
      logTaskQueue(`清空指定文献队列任务: ${removedCount} 个`);

      const hasPending = this.getAllTasks().some(
        (task) =>
          task.status === TaskStatus.PRIORITY ||
          task.status === TaskStatus.PENDING,
      );
      if (!hasPending && this.processingTasks.size === 0) {
        this.stop();
      }
    }

    return removedCount;
  }

  /**
   * 移除任务
   *
   * @param taskId 任务ID
   */
  public async removeTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return;
    }

    if (task.status === TaskStatus.PROCESSING) {
      this.abortingTasks.add(taskId);
      const controller = this.taskAbortControllers.get(taskId);
      controller?.abort(LLM_REQUEST_ABORT_MESSAGE);
    }

    this.tasks.delete(taskId);
    this.processingTasks.delete(taskId);
    this.taskAbortControllers.delete(taskId);
    await this.saveToStorage();

    logTaskQueue(`删除任务: ${taskId}`);
  }

  /**
   * 清空已完成的任务
   */
  public async clearCompleted(): Promise<void> {
    const completedTasks = Array.from(this.tasks.values()).filter(
      (task) => task.status === TaskStatus.COMPLETED,
    );

    for (const task of completedTasks) {
      this.tasks.delete(task.id);
    }

    await this.saveToStorage();
    logTaskQueue(`清空已完成任务: ${completedTasks.length} 个`);
  }

  /**
   * 清空所有任务
   */
  public async clearAll(): Promise<void> {
    // 停止执行器
    this.stop();

    this.taskAbortControllers.forEach((controller) => {
      controller.abort(LLM_REQUEST_ABORT_MESSAGE);
    });
    this.taskAbortControllers.clear();
    this.abortingTasks.clear();

    // 清空队列
    this.tasks.clear();
    this.processingTasks.clear();

    await this.saveToStorage();
    logTaskQueue("清空所有任务");
  }

  /**
   * 设置任务优先级
   *
   * @param taskId 任务ID
   * @param priority 是否优先
   */
  public async setTaskPriority(
    taskId: string,
    priority: boolean,
  ): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return;
    }

    // 只有待处理或失败的任务可以调整优先级
    if (
      task.status === TaskStatus.PENDING ||
      task.status === TaskStatus.FAILED
    ) {
      task.status = priority ? TaskStatus.PRIORITY : TaskStatus.PENDING;
      await this.saveToStorage();
      logTaskQueue(`任务 ${taskId} 优先级已更新: ${priority}`);
    }
  }

  /**
   * 重试失败任务
   *
   * @param taskId 任务ID
   */
  public async retryTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== TaskStatus.FAILED) {
      return;
    }

    // 重置任务状态
    task.status = TaskStatus.PRIORITY; // 优先重试
    task.progress = 0;
    task.error = undefined;
    task.errorDetails = undefined;
    task.retryCount = 0;
    task.startedAt = undefined;
    task.completedAt = undefined;
    task.duration = undefined;
    task.createdAt = new Date();
    this.abortingTasks.delete(taskId);

    await this.saveToStorage();
    logTaskQueue(`重试任务: ${taskId}`);

    // 确保执行器正在运行
    if (!this.isRunning) {
      this.start();
    }
  }

  /**
   * 终止正在执行的 AI 总结 / AI 精读任务
   *
   * @param taskId 任务ID
   */
  public async abortTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== TaskStatus.PROCESSING) {
      return;
    }

    const taskType = task.taskType || "summary";
    if (taskType !== "summary" && taskType !== "deepRead") {
      throw new Error("当前只支持终止 AI 总结/AI 精读任务");
    }

    this.abortingTasks.add(taskId);
    const completedAt = new Date();
    task.status = TaskStatus.FAILED;
    task.workflowStage = "已终止";
    task.error = LLM_REQUEST_ABORT_MESSAGE;
    task.errorDetails = TASK_ABORT_DETAIL;
    task.completedAt = completedAt;
    if (task.startedAt) {
      task.duration = Math.floor(
        (completedAt.getTime() - task.startedAt.getTime()) / 1000,
      );
    }

    const controller = this.taskAbortControllers.get(taskId);
    if (controller) {
      controller.abort(LLM_REQUEST_ABORT_MESSAGE);
    }

    await this.saveToStorage();
    this.notifyProgress(taskId, task.progress, "已终止");
    logTaskQueue(`用户终止任务: ${task.title} (${taskId})`);
  }

  // ==================== 队列查询 ====================

  /**
   * 获取所有任务
   */
  public getAllTasks(): TaskItem[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 按状态筛选任务
   *
   * @param status 任务状态
   */
  public getTasksByStatus(status: TaskStatus): TaskItem[] {
    return this.getAllTasks().filter((task) => task.status === status);
  }

  /**
   * 获取排序后的任务列表
   *
   * 排序规则:
   * 1. 优先处理
   * 2. 处理中
   * 3. 待处理
   * 4. 失败
   * 5. 已完成
   *
   * 同状态内按创建时间升序
   */
  public getSortedTasks(): TaskItem[] {
    const statusOrder = {
      [TaskStatus.PRIORITY]: 1,
      [TaskStatus.PROCESSING]: 2,
      [TaskStatus.PENDING]: 3,
      [TaskStatus.FAILED]: 4,
      [TaskStatus.COMPLETED]: 5,
    };

    return this.getAllTasks().sort((a, b) => {
      // 先按状态排序
      const statusDiff = statusOrder[a.status] - statusOrder[b.status];
      if (statusDiff !== 0) {
        return statusDiff;
      }

      // 同状态按创建时间排序
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  }

  /**
   * 获取队列统计信息
   */
  public getStats(): QueueStats {
    const tasks = this.getAllTasks();
    const total = tasks.length;
    const pending = tasks.filter((t) => t.status === TaskStatus.PENDING).length;
    const priority = tasks.filter(
      (t) => t.status === TaskStatus.PRIORITY,
    ).length;
    const processing = tasks.filter(
      (t) => t.status === TaskStatus.PROCESSING,
    ).length;
    const completed = tasks.filter(
      (t) => t.status === TaskStatus.COMPLETED,
    ).length;
    const failed = tasks.filter((t) => t.status === TaskStatus.FAILED).length;

    const successRate =
      total > 0
        ? Math.round((completed / (completed + failed)) * 100) || 0
        : 100;

    return {
      total,
      pending,
      priority,
      processing,
      completed,
      failed,
      successRate,
    };
  }

  /**
   * 获取单个任务
   *
   * @param taskId 任务ID
   */
  public getTask(taskId: string): TaskItem | undefined {
    return this.tasks.get(taskId);
  }

  // ==================== 执行器控制 ====================

  /**
   * 启动队列执行器
   */
  public start(): void {
    if (this.isRunning) {
      logTaskQueue("队列执行器已在运行");
      return;
    }

    this.isRunning = true;
    logTaskQueue("启动队列执行器");

    // 立即执行一次
    this.executeNextBatch();

    // 设置定时器
    this.executorTimerId = setInterval(() => {
      this.executeNextBatch();
    }, this.executionInterval) as any as number;
  }

  /**
   * 停止队列执行器
   */
  public stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    this.isBatchRunning = false;

    if (this.executorTimerId !== null) {
      clearInterval(this.executorTimerId);
      this.executorTimerId = null;
    }

    logTaskQueue("停止队列执行器");
  }

  /**
   * 更新执行器设置
   *
   * @param maxConcurrency 最大并发数
   * @param intervalSeconds 执行间隔(秒)
   */
  public updateSettings(batchSize: number, intervalSeconds: number): void {
    this.batchSize = Math.max(1, Math.floor(batchSize));
    this.maxConcurrency = Math.max(1, this.batchSize);
    this.executionInterval = Math.max(1, Math.floor(intervalSeconds)) * 1000;

    // 如果正在运行,重启以应用新设置
    if (this.isRunning) {
      this.stop();
      this.start();
    }

    logTaskQueue(
      `更新执行器设置: 批次大小=${this.batchSize}, 间隔=${intervalSeconds}秒`,
    );
  }

  // ==================== 任务执行 ====================

  /**
   * 执行下一批任务
   *
   * 并行执行 batchSize 个任务，所有任务完成后再进入下一个间隔周期
   */
  private async executeNextBatch(): Promise<void> {
    if (this.isBatchRunning) {
      return;
    }

    this.isBatchRunning = true;

    try {
      // 获取待处理任务
      const pendingTasks = this.getAllTasks()
        .filter(
          (task) =>
            task.status === TaskStatus.PRIORITY ||
            task.status === TaskStatus.PENDING,
        )
        .sort((a, b) => {
          if (
            a.status === TaskStatus.PRIORITY &&
            b.status !== TaskStatus.PRIORITY
          ) {
            return -1;
          }
          if (
            a.status !== TaskStatus.PRIORITY &&
            b.status === TaskStatus.PRIORITY
          ) {
            return 1;
          }
          return a.createdAt.getTime() - b.createdAt.getTime();
        });

      if (pendingTasks.length === 0) {
        logTaskQueue("没有待处理的任务");
        return;
      }

      // 选取本批次要执行的任务（最多 batchSize 个）
      const tasksToExecute = pendingTasks.slice(0, this.batchSize);

      logTaskQueue(
        `开始并行执行批次任务: ${tasksToExecute.length} 个 (批次大小=${this.batchSize})`,
      );

      // 并行执行所有任务
      const taskPromises = tasksToExecute.map(async (task) => {
        logTaskQueue(`启动任务: ${task.title}`);
        const wasQuickFail = await this.executeTask(task.id);
        return { taskId: task.id, title: task.title, wasQuickFail };
      });

      // 等待所有任务完成
      const results = await Promise.all(taskPromises);

      // 统计结果
      const llmTasksProcessed = results.filter((r) => !r.wasQuickFail).length;
      const quickFailCount = results.filter((r) => r.wasQuickFail).length;

      logTaskQueue(
        `批次执行完成，实际处理 ${llmTasksProcessed} 个任务，快速失败 ${quickFailCount} 个`,
      );
    } finally {
      this.isBatchRunning = false;

      const hasPending = this.getAllTasks().some(
        (task) =>
          task.status === TaskStatus.PRIORITY ||
          task.status === TaskStatus.PENDING,
      );

      if (!hasPending && this.processingTasks.size === 0 && this.isRunning) {
        this.stop();
      }
    }
  }

  /**
   * 执行单个任务
   *
   * @param taskId 任务ID
   * @returns 是否为快速失败（无 PDF 附件），用于批次配额判断
   */
  private async executeTask(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }

    // 非普通总结任务转交到各自执行器，避免误走默认总结流程
    if (
      task.taskType &&
      task.taskType !== "summary" &&
      task.taskType !== "deepRead"
    ) {
      if (task.taskType === "imageSummary") {
        await this.executeImageSummaryTask(taskId);
        return false;
      }
      if (task.taskType === "mindmap") {
        await this.executeMindmapTask(taskId);
        return false;
      }
      if (task.taskType === "tableFill") {
        await this.executeTableFillTask(taskId);
        return false;
      }
      if (task.taskType === "review") {
        await this.executeReviewTask(taskId);
        return false;
      }
      if (task.taskType === "targetedQuestion") {
        await this.executeTargetedQuestionTask(taskId);
        return false;
      }
    }

    // 防止任务被重复执行（竞态条件保护）
    // 如果任务已在处理中或已完成，跳过执行
    if (
      task.status === TaskStatus.PROCESSING ||
      task.status === TaskStatus.COMPLETED
    ) {
      logTaskQueue(`任务已在处理中或已完成，跳过重复执行: ${taskId}`);
      return false;
    }

    // 更新任务状态为处理中
    task.status = TaskStatus.PROCESSING;
    task.startedAt = new Date();
    task.progress = 0;
    task.error = undefined;
    task.errorDetails = undefined;
    task.workflowStage = undefined;
    this.processingTasks.add(taskId);
    this.abortingTasks.delete(taskId);
    const abortController = createTaskAbortController();
    this.taskAbortControllers.set(taskId, abortController);
    await this.saveToStorage();
    const isDeepReadTask = task.taskType === "deepRead";
    task.workflowStage = isDeepReadTask ? "正在 AI 精读" : "正在 AI 总结";
    this.notifyProgress(
      taskId,
      task.progress,
      isDeepReadTask ? "AI deep read started" : "AI summary started",
    );

    logTaskQueue(`开始执行任务: ${task.title} (${taskId})`);

    try {
      // 获取 Zotero Item
      const item = await Zotero.Items.getAsync(task.itemId);
      if (!item) {
        throw new Error("文献条目不存在");
      }

      // 检查是否有 PDF 附件
      const hasPdf = await PDFExtractor.hasPDFAttachment(item);
      if (!hasPdf) {
        throw new Error(NO_PDF_ERROR_MSG);
      }

      // 调用 NoteGenerator 生成笔记
      await NoteGenerator.generateNoteForItem(
        item,
        undefined, // 不使用输出窗口,通过流式回调转发
        (message: string, progress: number) => {
          // 更新任务进度
          task.progress = progress;
          this.notifyProgress(taskId, progress, message);
        },
        (chunk: string) => {
          if (this.abortingTasks.has(taskId)) {
            return;
          }
          // 将增量内容广播给监听者
          try {
            // 首次到来时发送 start 事件
            if (task.progress === 0) {
              this.notifyStream(taskId, { type: "start", title: task.title });
            }
            this.notifyStream(taskId, { type: "chunk", chunk });
          } catch (e) {
            logTaskQueue(`流式内容广播失败: ${e}`);
          }
        },
        { ...(task.options || {}), abortSignal: abortController.signal },
      );

      const artifactType: FixedTaskArtifactType =
        task.taskType === "deepRead" ? "deepRead" : "summary";
      const artifact = await TaskArtifacts.probe(artifactType, item);
      if (!artifact.exists) {
        throw new Error(
          artifactType === "deepRead"
            ? `AI 精读尚未完整生成（${artifact.reason || "incomplete"}），已重新加入队列补全未完成轮次`
            : `AI 总结尚未完整生成（${artifact.reason || "incomplete"}）`,
        );
      }

      if (this.abortingTasks.has(taskId) || abortController.signal.aborted) {
        throw new Error(LLM_REQUEST_ABORT_MESSAGE);
      }

      // 任务成功完成
      task.status = TaskStatus.COMPLETED;
      task.progress = 100;
      task.completedAt = new Date();
      task.duration = Math.floor(
        (task.completedAt.getTime() - task.startedAt!.getTime()) / 1000,
      );

      logTaskQueue(`任务完成: ${task.title} (耗时${task.duration}秒)`);
      this.notifyComplete(taskId, true);
      // 发送结束事件
      this.notifyStream(taskId, { type: "finish" });
      // 自动触发一图总结（如果设置已启用且是普通总结任务）
      if (!task.taskType || task.taskType === "summary") {
        this.maybeAutoTriggerImageSummary(task.itemId);
      }
      return false; // 非快速失败，计入批次
    } catch (error: any) {
      // 任务失败
      const isTaskAborted =
        this.abortingTasks.has(taskId) ||
        abortController.signal.aborted ||
        isAbortError(error, abortController.signal);
      task.error = isTaskAborted
        ? LLM_REQUEST_ABORT_MESSAGE
        : this.getTaskErrorMessage(error);
      task.errorDetails = isTaskAborted
        ? TASK_ABORT_DETAIL
        : this.buildTaskErrorDetails(task, error);
      const suppressTaskRetry = this.shouldSuppressTaskRetry(error, task);

      // 无 PDF 附件错误直接标记失败，不重试（用户需要手动添加 PDF）
      const isNoPdfError = task.error === NO_PDF_ERROR_MSG;
      if (isTaskAborted || isNoPdfError || suppressTaskRetry) {
        task.status = TaskStatus.FAILED;
        task.completedAt = new Date();
        logTaskQueue(
          isTaskAborted
            ? `任务已终止: ${task.title}`
            : isNoPdfError
              ? `任务失败（无 PDF 附件）: ${task.title}`
              : `任务失败（API 尝试已用尽，不再进行队列重试）: ${task.title}`,
        );
      } else {
        task.retryCount++;
        // 检查是否需要重试
        if (task.retryCount < task.maxRetries) {
          // 重置为待处理状态,等待重试
          task.status = TaskStatus.PENDING;
          task.progress = 0;
          logTaskQueue(
            `任务失败,将重试 (${task.retryCount}/${task.maxRetries}): ${task.title}`,
          );
        } else {
          // 超过最大重试次数,标记为失败
          task.status = TaskStatus.FAILED;
          task.completedAt = new Date();
          logTaskQueue(`任务最终失败: ${task.title} - ${task.error}`);
        }
      }

      this.notifyComplete(taskId, false, task.error);
      this.notifyStream(taskId, { type: "error" });
      return isNoPdfError; // 无 PDF 错误时返回 true，表示快速失败
    } finally {
      // 移除处理中标记
      this.processingTasks.delete(taskId);
      this.taskAbortControllers.delete(taskId);
      this.abortingTasks.delete(taskId);
      await this.saveToStorage();
    }
  }

  private getTaskErrorMessage(error: unknown): string {
    const withDetails = error as
      | {
          details?: { errorMessage?: string };
          message?: string;
        }
      | undefined;
    return (
      withDetails?.details?.errorMessage ||
      withDetails?.message ||
      String(error || "未知错误")
    );
  }

  private shouldSuppressTaskRetry(error: unknown, task?: TaskItem): boolean {
    const value = error as
      | {
          name?: string;
          suppressTaskRetry?: boolean;
        }
      | undefined;
    return (
      value?.suppressTaskRetry === true ||
      value?.name === "LLMApiCallError" ||
      value?.name === "LLMApiExhaustedError" ||
      this.isLikelyApiFailure(error, task)
    );
  }

  private isLikelyApiFailure(error: unknown, task?: TaskItem): boolean {
    const message = this.getTaskErrorMessage(error);
    const stack =
      typeof (error as { stack?: unknown })?.stack === "string"
        ? String((error as { stack?: string }).stack)
        : "";
    const text = `${message}\n${stack}`.toLowerCase();

    if (
      /\bhttp\s*(4\d\d|5\d\d)\b/.test(text) ||
      /\b(400|401|403|404|408|409|429|500|502|503|504)\b/.test(text)
    ) {
      return true;
    }

    if (
      text.includes("api") ||
      text.includes("responses") ||
      text.includes("chat/completions") ||
      text.includes("openai") ||
      text.includes("gemini") ||
      text.includes("anthropic") ||
      text.includes("openrouter") ||
      text.includes("volcano") ||
      text.includes("networkerror") ||
      text.includes("timeout") ||
      text.includes("xhr") ||
      text.includes("fetch") ||
      text.includes("request failed") ||
      text.includes("请求失败") ||
      text.includes("连接失败") ||
      text.includes("请求超过")
    ) {
      return true;
    }

    // Summary tasks report 40% right before entering the model call. If an
    // error happens after that point, a queue-level retry would just multiply
    // real API requests beyond the model-platform attempt cap.
    return (
      (!task?.taskType || task.taskType === "summary") &&
      (task?.progress || 0) >= 40
    );
  }

  private buildTaskErrorDetails(task: TaskItem, error: unknown): string {
    const errorInfo = error as
      | {
          name?: string;
          message?: string;
          stack?: string;
          diagnosticText?: string;
          details?: unknown;
          attempts?: number;
          endpointId?: string;
          endpointName?: string;
          providerId?: string;
          suppressTaskRetry?: boolean;
        }
      | undefined;
    const runtime = this.getRuntimeDebugInfo();
    const lines = [
      "AI-Butler task error details",
      `generatedAt: ${new Date().toISOString()}`,
      `taskId: ${task.id}`,
      `taskType: ${task.taskType || "summary"}`,
      `itemId: ${task.itemId}`,
      `title: ${task.title}`,
      `status: ${task.status}`,
      `retryCount: ${task.retryCount}`,
      `maxRetries: ${task.maxRetries}`,
      `workflowStage: ${task.workflowStage || "none"}`,
      `zoteroVersion: ${runtime.zoteroVersion || "unknown"}`,
      `platform: ${runtime.platform || "unknown"}`,
      `userAgent: ${runtime.userAgent || "unknown"}`,
      `errorName: ${errorInfo?.name || "unknown"}`,
      `errorMessage: ${this.getTaskErrorMessage(error)}`,
      `suppressTaskRetry: ${this.shouldSuppressTaskRetry(error, task)}`,
      `likelyApiFailure: ${this.isLikelyApiFailure(error, task)}`,
    ];

    if (errorInfo?.attempts !== undefined) {
      lines.push(`apiAttempts: ${errorInfo.attempts}`);
    }
    if (errorInfo?.endpointName || errorInfo?.endpointId) {
      lines.push(`endpointName: ${errorInfo.endpointName || "unknown"}`);
      lines.push(`endpointId: ${errorInfo.endpointId || "unknown"}`);
      lines.push(`providerId: ${errorInfo.providerId || "unknown"}`);
    }

    if (errorInfo?.diagnosticText) {
      lines.push("", "--- diagnosticText ---", errorInfo.diagnosticText);
    }
    if (errorInfo?.details) {
      lines.push(
        "",
        "--- error.details ---",
        this.stringifyDebugValue(errorInfo.details),
      );
    }
    if (errorInfo?.stack) {
      lines.push("", "--- stack ---", errorInfo.stack);
    }

    return lines.join("\n");
  }

  private getRuntimeDebugInfo(): {
    zoteroVersion?: string;
    platform?: string;
    userAgent?: string;
  } {
    try {
      const win = Zotero.getMainWindow?.();
      return {
        zoteroVersion: (Zotero as unknown as { version?: string }).version,
        platform: win?.navigator?.platform,
        userAgent: win?.navigator?.userAgent,
      };
    } catch {
      return {
        zoteroVersion: (Zotero as unknown as { version?: string }).version,
      };
    }
  }

  private stringifyDebugValue(value: unknown): string {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  // ==================== 回调管理 ====================

  /**
   * 注册进度回调
   *
   * @param callback 回调函数
   */
  public onProgress(callback: TaskProgressCallback): () => void {
    this.progressCallbacks.add(callback);

    // 返回取消注册的函数
    return () => {
      this.progressCallbacks.delete(callback);
    };
  }

  /**
   * 注册完成回调
   *
   * @param callback 回调函数
   */
  public onComplete(callback: TaskCompleteCallback): () => void {
    this.completeCallbacks.add(callback);

    // 返回取消注册的函数
    return () => {
      this.completeCallbacks.delete(callback);
    };
  }

  /**
   * 注册流式事件回调
   */
  public onStream(callback: TaskStreamCallback): () => void {
    this.streamCallbacks.add(callback);
    return () => this.streamCallbacks.delete(callback);
  }

  /**
   * 通知进度回调
   */
  private notifyProgress(
    taskId: string,
    progress: number,
    message: string,
  ): void {
    this.progressCallbacks.forEach((callback) => {
      try {
        callback(taskId, progress, message);
      } catch (error) {
        logTaskQueue(`进度回调执行失败: ${error}`);
      }
    });
  }

  /**
   * 通知完成回调
   */
  private notifyComplete(
    taskId: string,
    success: boolean,
    error?: string,
  ): void {
    this.completeCallbacks.forEach((callback) => {
      try {
        callback(taskId, success, error);
      } catch (error) {
        logTaskQueue(`完成回调执行失败: ${error}`);
      }
    });
  }

  /** 通知流式事件 */
  private notifyStream(
    taskId: string,
    event: {
      type: "start" | "chunk" | "finish" | "error";
      chunk?: string;
      title?: string;
    },
  ): void {
    this.streamCallbacks.forEach((cb) => {
      try {
        cb(taskId, event);
      } catch (e) {
        logTaskQueue(`流式回调执行失败: ${e}`);
      }
    });
  }

  /**
   * 检查是否应该自动触发一图总结
   * 只有当设置启用且任务是普通总结任务时才触发
   */
  private async maybeAutoTriggerImageSummary(itemId: number): Promise<void> {
    try {
      const { getPref } = await import("../utils/prefs");
      const autoTrigger =
        (getPref("autoImageSummaryOnComplete" as any) as boolean) || false;

      if (!autoTrigger) {
        return;
      }

      // 获取 Zotero Item
      const item = await Zotero.Items.getAsync(itemId);
      if (!item) {
        return;
      }

      logTaskQueue(`[AI-Butler] 自动触发一图总结: ${item.getField("title")}`);
      await this.addImageSummaryTask(item);
    } catch (error) {
      logTaskQueue(`[AI-Butler] 自动触发一图总结失败:`, error);
    }
  }

  // ==================== 持久化 ====================

  /**
   * 从持久化存储加载任务队列
   *
   * @param resetProcessingTasks 是否将处理中任务重置为待处理
   */
  private loadFromStorage(resetProcessingTasks: boolean): void {
    try {
      const stored = Zotero.Prefs.get(
        "extensions.zotero.aibutler.taskQueue",
        true,
      ) as string;
      if (!stored) {
        return;
      }

      const data = JSON.parse(stored);
      const snapshotAt =
        typeof data?.savedAt === "string" ? data.savedAt : undefined;

      // 快照未变化时无需重复覆盖内存状态
      if (
        snapshotAt &&
        this.lastLoadedSnapshotAt &&
        snapshotAt === this.lastLoadedSnapshotAt
      ) {
        return;
      }

      // 恢复任务数据
      this.tasks.clear();
      for (const taskData of data.tasks || []) {
        const task: TaskItem = {
          ...taskData,
          createdAt: new Date(taskData.createdAt),
          startedAt: taskData.startedAt
            ? new Date(taskData.startedAt)
            : undefined,
          completedAt: taskData.completedAt
            ? new Date(taskData.completedAt)
            : undefined,
        };

        // 插件重启恢复时，处理中任务无法继续执行，改为待处理重新排队
        if (resetProcessingTasks && task.status === TaskStatus.PROCESSING) {
          task.status = TaskStatus.PENDING;
          task.progress = 0;
        }

        this.tasks.set(task.id, task);
      }

      this.lastLoadedSnapshotAt = snapshotAt || null;

      logTaskQueue(`从存储加载 ${this.tasks.size} 个任务`);
    } catch (error) {
      logTaskQueue(`加载任务队列失败: ${error}`);
    }
  }

  /**
   * 主动从持久化存储刷新任务数据
   *
   * 用于跨窗口上下文读取最新快照；若本上下文正在执行任务，则以内存状态为准。
   */
  public refreshFromStorage(): void {
    if (this.processingTasks.size > 0) {
      return;
    }
    this.loadFromStorage(false);
  }

  /**
   * 保存任务队列到 localStorage
   */
  private async saveToStorage(): Promise<void> {
    try {
      const savedAt = new Date().toISOString();
      const data = {
        tasks: Array.from(this.tasks.values()),
        savedAt,
      };

      Zotero.Prefs.set(
        "extensions.zotero.aibutler.taskQueue",
        JSON.stringify(data),
        true,
      );
      this.lastLoadedSnapshotAt = savedAt;
    } catch (error) {
      logTaskQueue(`保存任务队列失败: ${error}`);
    }
  }

  /**
   * 从配置加载设置
   */
  private loadSettings(): void {
    const rawBatchSize = parseInt(getPref("batchSize") as string) || 1;
    this.batchSize = Math.max(1, rawBatchSize);
    this.maxConcurrency = Math.max(1, this.batchSize);
    this.executionInterval =
      (parseInt(getPref("batchInterval") as string) || 60) * 1000;
  }

  // ==================== 今日统计 ====================

  /**
   * 获取今日完成的任务数
   */
  public getTodayCompletedCount(): number {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return this.getAllTasks().filter(
      (task) =>
        task.status === TaskStatus.COMPLETED &&
        task.completedAt &&
        task.completedAt >= today,
    ).length;
  }

  /**
   * 获取今日失败的任务数
   */
  public getTodayFailedCount(): number {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return this.getAllTasks().filter(
      (task) =>
        task.status === TaskStatus.FAILED &&
        task.completedAt &&
        task.completedAt >= today,
    ).length;
  }
}
