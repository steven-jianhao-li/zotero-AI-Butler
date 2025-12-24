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

import { getPref, setPref } from "../utils/prefs";
import { NoteGenerator } from "./noteGenerator";

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
  retryCount: number; // 已重试次数
  maxRetries: number; // 最大重试次数
  duration?: number; // 处理耗时(秒)
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

  /** 任务进度回调函数集合 */
  private progressCallbacks: Set<TaskProgressCallback> = new Set();

  /** 任务完成回调函数集合 */
  private completeCallbacks: Set<TaskCompleteCallback> = new Set();

  /** 任务流式事件回调函数集合 */
  private streamCallbacks: Set<TaskStreamCallback> = new Set();

  /** 队列执行器定时器ID */
  private executorTimerId: number | null = null;

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
    this.loadFromStorage();
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
  ): Promise<string> {
    const taskId = `task-${item.id}`;

    // 检查是否已存在
    if (this.tasks.has(taskId)) {
      ztoolkit.log(`任务已存在: ${taskId}`);
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
    };

    this.tasks.set(taskId, task);
    await this.saveToStorage();

    ztoolkit.log(`添加任务: ${task.title} (${taskId})`);

    // 如果执行器未运行,启动它
    if (!this.isRunning) {
      this.start();
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
   * 移除任务
   *
   * @param taskId 任务ID
   */
  public async removeTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return;
    }

    // 不能删除处理中的任务
    if (task.status === TaskStatus.PROCESSING) {
      throw new Error("无法删除处理中的任务");
    }

    this.tasks.delete(taskId);
    await this.saveToStorage();

    ztoolkit.log(`删除任务: ${taskId}`);
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
    ztoolkit.log(`清空已完成任务: ${completedTasks.length} 个`);
  }

  /**
   * 清空所有任务
   */
  public async clearAll(): Promise<void> {
    // 停止执行器
    this.stop();

    // 清空队列
    this.tasks.clear();
    this.processingTasks.clear();

    await this.saveToStorage();
    ztoolkit.log("清空所有任务");
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
      ztoolkit.log(`任务 ${taskId} 优先级已更新: ${priority}`);
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
    task.retryCount = 0;

    await this.saveToStorage();
    ztoolkit.log(`重试任务: ${taskId}`);

    // 确保执行器正在运行
    if (!this.isRunning) {
      this.start();
    }
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
      ztoolkit.log("队列执行器已在运行");
      return;
    }

    this.isRunning = true;
    ztoolkit.log("启动队列执行器");

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

    ztoolkit.log("停止队列执行器");
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

    ztoolkit.log(
      `更新执行器设置: 批次大小=${this.batchSize}, 间隔=${intervalSeconds}秒`,
    );
  }

  // ==================== 任务执行 ====================

  /**
   * 执行下一批任务
   */
  private async executeNextBatch(): Promise<void> {
    if (this.isBatchRunning) {
      return;
    }

    // 获取待处理任务(优先、待处理)
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
      if (this.processingTasks.size === 0 && this.isRunning) {
        this.stop();
      }
      return;
    }

    const tasksForBatch = pendingTasks.slice(0, this.batchSize);
    if (tasksForBatch.length === 0) {
      return;
    }

    this.isBatchRunning = true;
    ztoolkit.log(`开始执行批次, 计划处理 ${tasksForBatch.length} 个任务`);

    try {
      let index = 0;
      while (index < tasksForBatch.length) {
        const remaining = tasksForBatch.length - index;
        const chunkSize = Math.max(1, Math.min(this.maxConcurrency, remaining));
        const chunk = tasksForBatch.slice(index, index + chunkSize);
        await Promise.allSettled(
          chunk.map((task) => this.executeTask(task.id)),
        );
        index += chunk.length;
      }
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
   */
  private async executeTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return;
    }

    // 防止任务被重复执行（竞态条件保护）
    // 如果任务已在处理中或已完成，跳过执行
    if (
      task.status === TaskStatus.PROCESSING ||
      task.status === TaskStatus.COMPLETED
    ) {
      ztoolkit.log(`任务已在处理中或已完成，跳过重复执行: ${taskId}`);
      return;
    }

    // 更新任务状态为处理中
    task.status = TaskStatus.PROCESSING;
    task.startedAt = new Date();
    task.progress = 0;
    this.processingTasks.add(taskId);
    await this.saveToStorage();

    ztoolkit.log(`开始执行任务: ${task.title} (${taskId})`);

    try {
      // 获取 Zotero Item
      const item = await Zotero.Items.getAsync(task.itemId);
      if (!item) {
        throw new Error("文献条目不存在");
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
          // 将增量内容广播给监听者
          try {
            // 首次到来时发送 start 事件
            if (task.progress === 0) {
              this.notifyStream(taskId, { type: "start", title: task.title });
            }
            this.notifyStream(taskId, { type: "chunk", chunk });
          } catch (e) {
            ztoolkit.log(`流式内容广播失败: ${e}`);
          }
        },
      );

      // 任务成功完成
      task.status = TaskStatus.COMPLETED;
      task.progress = 100;
      task.completedAt = new Date();
      task.duration = Math.floor(
        (task.completedAt.getTime() - task.startedAt!.getTime()) / 1000,
      );

      ztoolkit.log(`任务完成: ${task.title} (耗时${task.duration}秒)`);
      this.notifyComplete(taskId, true);
      // 发送结束事件
      this.notifyStream(taskId, { type: "finish" });
    } catch (error: any) {
      // 任务失败
      task.error = error.message || "未知错误";
      task.retryCount++;

      // 检查是否需要重试
      if (task.retryCount < task.maxRetries) {
        // 重置为待处理状态,等待重试
        task.status = TaskStatus.PENDING;
        task.progress = 0;
        ztoolkit.log(
          `任务失败,将重试 (${task.retryCount}/${task.maxRetries}): ${task.title}`,
        );
      } else {
        // 超过最大重试次数,标记为失败
        task.status = TaskStatus.FAILED;
        task.completedAt = new Date();
        ztoolkit.log(`任务最终失败: ${task.title} - ${task.error}`);
      }

      this.notifyComplete(taskId, false, task.error);
      this.notifyStream(taskId, { type: "error" });
    } finally {
      // 移除处理中标记
      this.processingTasks.delete(taskId);
      await this.saveToStorage();
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
        ztoolkit.log(`进度回调执行失败: ${error}`);
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
        ztoolkit.log(`完成回调执行失败: ${error}`);
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
        ztoolkit.log(`流式回调执行失败: ${e}`);
      }
    });
  }

  // ==================== 持久化 ====================

  /**
   * 从 localStorage 加载任务队列
   */
  private loadFromStorage(): void {
    try {
      const stored = Zotero.Prefs.get(
        "extensions.zotero.aibutler.taskQueue",
        true,
      ) as string;
      if (!stored) {
        return;
      }

      const data = JSON.parse(stored);

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

        // 重置处理中的任务为待处理
        if (task.status === TaskStatus.PROCESSING) {
          task.status = TaskStatus.PENDING;
          task.progress = 0;
        }

        this.tasks.set(task.id, task);
      }

      ztoolkit.log(`从存储加载 ${this.tasks.size} 个任务`);
    } catch (error) {
      ztoolkit.log(`加载任务队列失败: ${error}`);
    }
  }

  /**
   * 保存任务队列到 localStorage
   */
  private async saveToStorage(): Promise<void> {
    try {
      const data = {
        tasks: Array.from(this.tasks.values()),
        savedAt: new Date().toISOString(),
      };

      Zotero.Prefs.set(
        "extensions.zotero.aibutler.taskQueue",
        JSON.stringify(data),
        true,
      );
    } catch (error) {
      ztoolkit.log(`保存任务队列失败: ${error}`);
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
