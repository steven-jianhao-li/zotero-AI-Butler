/**
 * ================================================================
 * 任务队列视图
 * ================================================================
 * 
 * 本模块提供任务队列管理的可视化界面
 * 
 * 主要职责:
 * 1. 显示所有待处理/处理中/已完成/失败的文献任务
 * 2. 提供任务状态筛选和排序功能
 * 3. 支持手动操作任务(重试/删除/优先级调整)
 * 4. 实时更新任务进度和状态
 * 5. 显示任务详细信息和错误日志
 * 
 * 任务状态:
 * - pending: 待处理 (灰色)
 * - processing: 处理中 (蓝色)
 * - completed: 已完成 (绿色)
 * - failed: 失败 (红色)
 * - priority: 优先处理 (橙色)
 * 
 * 显示顺序:
 * 1. 优先处理
 * 2. 处理中
 * 3. 待处理
 * 4. 失败
 * 5. 已完成
 * 
 * @module TaskQueueView
 * @author AI-Butler Team
 */

import { BaseView } from "./BaseView";
import { MainWindow } from "./MainWindow";
import { TaskQueueManager, TaskItem, TaskStatus } from "../taskQueue";

// 使用任务队列模块中定义的类型,避免重复定义导致的偏差

/**
 * 任务队列视图类
 */
export class TaskQueueView extends BaseView {
  /** 任务列表数据 */
  private tasks: TaskItem[] = [];

  /** 任务列表容器 */
  private taskListContainer: HTMLElement | null = null;

  /** 当前筛选状态 */
  private filterStatus: TaskStatus | "all" = "all";

  /** 文本搜索关键字 */
  private searchQuery: string = "";

  /** 队列管理器实例 */
  private manager: TaskQueueManager | null = null;

  /** 取消注册回调的函数 */
  private unsubscribeProgress?: () => void;
  private unsubscribeComplete?: () => void;

  /** 定时刷新(兜底) */
  private refreshTimerId: number | null = null;

  /** 统计信息容器 */
  private statsContainer: HTMLElement | null = null;

  /** 详情按钮的流式订阅取消函数 - 防止重复订阅 */
  private detailStreamUnsubscribe?: () => void;

  /**
   * 构造函数
   */
  constructor() {
    super("task-queue-view");
  }

  /**
   * 渲染视图内容
   * 
   * @protected
   */
  protected renderContent(): HTMLElement {
    const container = this.createElement("div", {
      id: "ai-butler-task-queue-view",
      styles: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        // 关键: 允许子元素(任务列表)在 flex 布局中正确计算可滚动高度
        minHeight: "0",
        fontFamily: "system-ui, -apple-system, sans-serif",
        // 确保容器本身不滚动，滚动由内部 taskListContainer 处理
        overflow: "hidden",
      },
    });

    // 头部包装,整体置顶吸附,形成"冻结表头"
    const headerWrapper = this.createElement("div", {
      id: "task-header-wrapper",
      styles: {
        position: "sticky",  // 使用 sticky 定位实现冻结效果
        top: "0",            // 固定在容器顶部
        flexShrink: "0",     // 不允许收缩
        backgroundColor: "#fff",
        // 防止下方滚动内容透出
        boxShadow: "0 2px 4px rgba(0,0,0,0.08)",
        zIndex: "10",        // 提高层级确保在滚动内容之上
      },
    });

    // 头部区域
    const header = this.createHeader();
    // 统计信息区域
    this.statsContainer = this.createStatsSection();
    // 筛选和操作按钮区域
    const filterBar = this.createFilterBar();
    headerWrapper.appendChild(header);
    headerWrapper.appendChild(this.statsContainer);
    headerWrapper.appendChild(filterBar);

    // 任务列表区域
    this.taskListContainer = this.createElement("div", {
      id: "task-list-container",
      styles: {
        flex: "1",
        // 关键: 允许该容器在父 flex 容器中变为可滚动区域
        minHeight: "0",
        overflow: "auto",
        padding: "0 20px 20px 20px",
      },
    });

  container.appendChild(headerWrapper);
    container.appendChild(this.taskListContainer);

    return container;
  }

  /**
   * 创建头部区域
   * 
   * @private
   */
  private createHeader(): HTMLElement {
    return this.createElement("div", {
      styles: {
        padding: "20px 20px 0 20px",
        flexShrink: "0",
      },
      children: [
        this.createElement("h2", {
          styles: {
            margin: "0 0 20px 0",
            fontSize: "20px",
            borderBottom: "2px solid #59c0bc",
            paddingBottom: "10px",
          },
          innerHTML: "📋 任务队列管理",
        }),
      ],
    });
  }

  /**
   * 创建统计信息区域
   * 
   * @private
   */
  private createStatsSection(): HTMLElement {
    return this.createElement("div", {
      id: "stats-section",
      styles: {
        padding: "0 20px 20px 20px",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        gap: "15px",
      },
      children: [
        this.createStatCard("total", "总任务", "0", "#607d8b"),
        this.createStatCard("priority", "优先处理", "0", "#ff9800"),
        this.createStatCard("processing", "处理中", "0", "#2196f3"),
        this.createStatCard("pending", "待处理", "0", "#9e9e9e"),
        this.createStatCard("completed", "已完成", "0", "#4caf50"),
        this.createStatCard("failed", "失败", "0", "#f44336"),
      ],
    });
  }

  /**
   * 创建统计卡片
   * 
   * @private
   */
  private createStatCard(
    id: string,
    label: string,
    value: string,
    color: string
  ): HTMLElement {
    return this.createElement("div", {
      id: `stat-${id}`,
      className: "stat-card",
      styles: {
        padding: "15px",
        backgroundColor: "rgba(89, 192, 188, 0.05)",
        borderRadius: "8px",
        borderLeft: `4px solid ${color}`,
      },
      children: [
        this.createElement("div", {
          styles: {
            fontSize: "12px",
            color: "#666",
            marginBottom: "5px",
          },
          textContent: label,
        }),
        this.createElement("div", {
          className: "stat-value",
          styles: {
            fontSize: "24px",
            fontWeight: "700",
            color: color,
          },
          textContent: value,
        }),
      ],
    });
  }

  /**
   * 创建筛选栏
   * 
   * @private
   */
  private createFilterBar(): HTMLElement {
    const filterBar = this.createElement("div", {
      styles: {
        padding: "0 20px 15px 20px",
        display: "flex",
        gap: "10px",
        alignItems: "center",
        flexWrap: "wrap",
      },
    });

    // 筛选按钮
    const filterButtons = [
      { label: "全部", value: "all" },
      { label: "优先处理", value: TaskStatus.PRIORITY },
      { label: "处理中", value: TaskStatus.PROCESSING },
      { label: "待处理", value: TaskStatus.PENDING },
      { label: "失败", value: TaskStatus.FAILED },
      { label: "已完成", value: TaskStatus.COMPLETED },
    ];

    filterButtons.forEach((btn) => {
      const isActive = btn.value === this.filterStatus;
      const button = this.createElement("button", {
        className: `filter-btn ${btn.value === this.filterStatus ? "active" : ""}`,
        styles: {
          padding: "8px 16px",
          border: "1px solid #59c0bc",
          borderRadius: "4px",
          backgroundColor: isActive ? "#59c0bc" : "transparent",
          color: isActive ? "#062d75ff" : "#59c0bc",
          fontWeight: isActive ? "1000" : "600",
          cursor: "pointer",
          transition: "all 0.2s",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        },
        textContent: btn.label,
      });

      // 标记状态值以便后续激活逻辑精确匹配
      (button as HTMLElement).setAttribute("data-status", String(btn.value));

      // 悬停交互：不改变颜色，仅加粗，避免出现“白字白底”看不见
      button.addEventListener("mouseenter", () => {
        (button as HTMLElement).style.fontWeight = "700";
      });
      button.addEventListener("mouseleave", () => {
        (button as HTMLElement).style.fontWeight = "600";
      });

      button.addEventListener("click", () => {
        this.filterTasks(btn.value as TaskStatus | "all");
      });

      filterBar.appendChild(button);
    });

    // 搜索框
    const searchInput = this.createElement("input", {
      styles: {
        flex: "1",
        minWidth: "200px",
        padding: "8px 12px",
        border: "1px solid #ddd",
        borderRadius: "4px",
        fontSize: "12px",
      },
      attributes: {
        placeholder: "搜索标题...",
      },
    }) as HTMLInputElement;
    searchInput.value = this.searchQuery;
    searchInput.addEventListener("input", () => {
      this.searchQuery = searchInput.value.trim();
      this.renderTaskList();
    });
    filterBar.appendChild(searchInput);

    // 操作按钮
    const clearCompletedBtn = this.createElement("button", {
      styles: {
        marginLeft: "auto",
        padding: "8px 16px",
        border: "1px solid #9e9e9e",
        borderRadius: "4px",
        backgroundColor: "transparent",
        color: "#9e9e9e",
        cursor: "pointer",
        transition: "all 0.2s",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      },
      textContent: "🗑️ 清除已完成",
    });

    clearCompletedBtn.addEventListener("click", async () => {
      await this.clearCompletedTasks();
    });

    filterBar.appendChild(clearCompletedBtn);

    return filterBar;
  }

  /**
   * 渲染任务列表
   * 
   * @private
   */
  private renderTaskList(): void {
    if (!this.taskListContainer) return;

    this.taskListContainer.innerHTML = "";

    // 筛选任务
    let filteredTasks = this.tasks;
    if (this.filterStatus !== "all") {
      filteredTasks = this.tasks.filter((task) => task.status === this.filterStatus);
    }

    // 文本搜索
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      filteredTasks = filteredTasks.filter(t => (t.title || "").toLowerCase().includes(q));
    }

    // 排序任务
    filteredTasks.sort((a, b) => {
      const statusOrder = {
        [TaskStatus.PRIORITY]: 0,
        [TaskStatus.PROCESSING]: 1,
        [TaskStatus.PENDING]: 2,
        [TaskStatus.FAILED]: 3,
        [TaskStatus.COMPLETED]: 4,
      };

      const orderA = statusOrder[a.status];
      const orderB = statusOrder[b.status];

      if (orderA !== orderB) {
        return orderA - orderB;
      }

      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    // 渲染任务项
    if (filteredTasks.length === 0) {
      const emptyMsg = this.createElement("div", {
        styles: {
          textAlign: "center",
          padding: "40px",
          color: "#9e9e9e",
          fontSize: "14px",
        },
        textContent: "暂无任务",
      });
      this.taskListContainer!.appendChild(emptyMsg);
    } else {
      filteredTasks.forEach((task) => {
        const taskElement = this.createTaskElement(task);
        this.taskListContainer!.appendChild(taskElement);
      });
    }
  }

  /**
   * 创建任务元素
   * 
   * @private
   */
  private createTaskElement(task: TaskItem): HTMLElement {
    const statusColors = {
      [TaskStatus.PENDING]: "#9e9e9e",
      [TaskStatus.PROCESSING]: "#2196f3",
      [TaskStatus.COMPLETED]: "#4caf50",
      [TaskStatus.FAILED]: "#f44336",
      [TaskStatus.PRIORITY]: "#ff9800",
    };

    const statusLabels = {
      [TaskStatus.PENDING]: "⏳ 待处理",
      [TaskStatus.PROCESSING]: "⚙️ 处理中",
      [TaskStatus.COMPLETED]: "✅ 已完成",
      [TaskStatus.FAILED]: "❌ 失败",
      [TaskStatus.PRIORITY]: "🔥 优先处理",
    };

    const taskItem = this.createElement("div", {
      className: "task-item",
      styles: {
        padding: "15px",
        marginBottom: "10px",
        backgroundColor: "rgba(89, 192, 188, 0.05)",
        borderRadius: "8px",
        borderLeft: `4px solid ${statusColors[task.status]}`,
      },
    });

    // 任务头部
    const taskHeader = this.createElement("div", {
      styles: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "10px",
      },
    });

    const taskTitle = this.createElement("div", {
      styles: {
        fontWeight: "600",
        fontSize: "14px",
        flex: "1",
      },
      textContent: task.title,
    });

    const taskStatus = this.createElement("span", {
      styles: {
        fontSize: "12px",
        padding: "4px 12px",
        borderRadius: "12px",
        backgroundColor: statusColors[task.status],
        color: "#fff",
      },
      textContent: statusLabels[task.status],
    });

    taskHeader.appendChild(taskTitle);
    taskHeader.appendChild(taskStatus);

    // 任务信息
    const taskInfo = this.createElement("div", {
      styles: {
        fontSize: "12px",
        color: "#666",
        marginBottom: "10px",
      },
      innerHTML: `
        创建时间: ${task.createdAt.toLocaleString("zh-CN")}
        ${task.completedAt ? `<br/>完成时间: ${task.completedAt.toLocaleString("zh-CN")}` : ""}
        ${task.error ? `<br/><span style="color: #f44336;">错误: ${task.error}</span>` : ""}
        ${task.retryCount > 0 ? `<br/>重试次数: ${task.retryCount}` : ""}
      `,
    });

    // 进度条 (仅处理中时显示)
    let progressBar: HTMLElement | null = null;
    if (task.status === TaskStatus.PROCESSING) {
      progressBar = this.createElement("div", {
        styles: {
          height: "4px",
          backgroundColor: "rgba(33, 150, 243, 0.2)",
          borderRadius: "2px",
          overflow: "hidden",
          marginBottom: "10px",
        },
        children: [
          this.createElement("div", {
            styles: {
              height: "100%",
              width: `${task.progress}%`,
              backgroundColor: "#2196f3",
              transition: "width 0.3s",
            },
          }),
        ],
      });
    }

    // 操作按钮
    const actions = this.createElement("div", {
      styles: {
        display: "flex",
        gap: "10px",
      },
    });

  // 详情按钮：打开 AI 总结面板并展示本次调用的流式结果
    const detailBtn = this.createElement("button", {
      styles: {
        padding: "6px 12px",
        border: "1px solid #59c0bc",
        borderRadius: "4px",
        backgroundColor: "transparent",
        color: "#59c0bc",
        cursor: "pointer",
        fontSize: "12px",
      },
      textContent: "🔍 详情",
    });
    detailBtn.addEventListener("click", async () => {
      // 先取消之前的流式订阅，避免重复
      if (this.detailStreamUnsubscribe) {
        this.detailStreamUnsubscribe();
        this.detailStreamUnsubscribe = undefined;
      }

      const win = MainWindow.getInstance();
      await win.open("summary");
      const view = win.getSummaryView();
      view.clear();
      // 使用任务的 startedAt 作为计时起点，避免每次进入都从 0 开始
      const startedAt = task.startedAt || undefined;
      view.showLoadingState(`正在分析「${task.title}」`, startedAt);

      // 若任务已完成,无法再接收流，回退展示已保存笔记
      if (task.status === TaskStatus.COMPLETED) {
        await view.showSavedNoteForItem(task.itemId);
        return;
      }

      // 注册一次性流式订阅，仅监听该 taskId
      if (!this.manager) this.manager = TaskQueueManager.getInstance();
      // 确保执行器已启动，尽快进入处理
      try { this.manager.start(); } catch {}
      let started = false;
      this.detailStreamUnsubscribe = this.manager.onStream((taskId, event) => {
        if (taskId !== task.id) return;
        if (event.type === "start") {
          if (!started) {
            view.startItem(task.title);
            started = true;
          }
        } else if (event.type === "chunk" && event.chunk) {
          if (!started) {
            view.startItem(task.title);
            started = true;
          }
          view.appendContent(event.chunk);
        } else if (event.type === "finish") {
          view.finishItem();
          if (this.detailStreamUnsubscribe) {
            this.detailStreamUnsubscribe();
            this.detailStreamUnsubscribe = undefined;
          }
        } else if (event.type === "error") {
          view.showError(task.title, task.error || "");
          if (this.detailStreamUnsubscribe) {
            this.detailStreamUnsubscribe();
            this.detailStreamUnsubscribe = undefined;
          }
        }
      });
    });
    actions.appendChild(detailBtn);

    if (task.status === TaskStatus.FAILED) {
      const retryBtn = this.createElement("button", {
        styles: {
          padding: "6px 12px",
          border: "1px solid #2196f3",
          borderRadius: "4px",
          backgroundColor: "transparent",
          color: "#2196f3",
          cursor: "pointer",
          fontSize: "12px",
        },
        textContent: "🔄 重试",
      });

      retryBtn.addEventListener("click", () => {
        this.retryTask(task.id);
      });

      actions.appendChild(retryBtn);
    }

    if (
      task.status === TaskStatus.PENDING ||
      task.status === TaskStatus.FAILED
    ) {
      const priorityBtn = this.createElement("button", {
        styles: {
          padding: "6px 12px",
          border: "1px solid #ff9800",
          borderRadius: "4px",
          backgroundColor: "transparent",
          color: "#ff9800",
          cursor: "pointer",
          fontSize: "12px",
        },
        textContent: "⚡ 优先处理",
      });

      priorityBtn.addEventListener("click", () => {
        this.prioritizeTask(task.id);
      });

      actions.appendChild(priorityBtn);
    }

    const deleteBtn = this.createElement("button", {
      styles: {
        padding: "6px 12px",
        border: "1px solid #f44336",
        borderRadius: "4px",
        backgroundColor: "transparent",
        color: "#f44336",
        cursor: "pointer",
        fontSize: "12px",
      },
      textContent: "🗑️ 删除",
    });

    deleteBtn.addEventListener("click", () => {
      this.deleteTask(task.id);
    });

    actions.appendChild(deleteBtn);

    // 组装任务项
    taskItem.appendChild(taskHeader);
    taskItem.appendChild(taskInfo);
    if (progressBar) {
      taskItem.appendChild(progressBar);
    }
    taskItem.appendChild(actions);

    return taskItem;
  }

  /**
   * 更新统计信息
   * 
   * @private
   */
  private updateStats(): void {
    if (!this.statsContainer) return;

    const stats = {
      total: this.tasks.length,
      priority: this.tasks.filter((t) => t.status === TaskStatus.PRIORITY).length,
      processing: this.tasks.filter((t) => t.status === TaskStatus.PROCESSING).length,
      pending: this.tasks.filter((t) => t.status === TaskStatus.PENDING).length,
      completed: this.tasks.filter((t) => t.status === TaskStatus.COMPLETED).length,
      failed: this.tasks.filter((t) => t.status === TaskStatus.FAILED).length,
    };

    Object.entries(stats).forEach(([key, value]) => {
      const statCard = this.statsContainer!.querySelector(`#stat-${key}`);
      if (statCard) {
        const valueElement = statCard.querySelector(".stat-value");
        if (valueElement) {
          valueElement.textContent = value.toString();
        }
      }
    });
  }

  /**
   * 筛选任务
   * 
   * @param status 任务状态
   */
  public filterTasks(status: TaskStatus | "all"): void {
    this.filterStatus = status;

    // 更新按钮样式
    const filterButtons = this.container?.querySelectorAll(".filter-btn");
    if (filterButtons) {
      filterButtons.forEach((btn: Element) => {
        const el = btn as HTMLElement;
        const s = el.getAttribute("data-status");
        const active = String(status) === String(s);
        if (active) {
          el.classList.add("active");
          el.style.backgroundColor = "#59c0bc";
          el.style.color = "#062d75ff";
          el.style.fontWeight = "1000";
          el.style.display = "flex";
          el.style.alignItems = "center";
          el.style.justifyContent = "center";
        } else {
          el.classList.remove("active");
          el.style.backgroundColor = "transparent";
          el.style.color = "#59c0bc";
          el.style.fontWeight = "600";
          el.style.display = "flex";
          el.style.alignItems = "center";
          el.style.justifyContent = "center";
        }
      });
    }

    this.renderTaskList();
  }

  /**
   * 添加任务
   * 
   * @param task 任务数据
   */
  public addTask(task: TaskItem): void {
    this.tasks.push(task);
    this.updateStats();
    this.renderTaskList();
  }

  /**
   * 更新任务
   * 
   * @param taskId 任务 ID
   * @param updates 更新数据
   */
  public updateTask(
    taskId: string,
    updates: Partial<Omit<TaskItem, "id">>
  ): void {
    const task = this.tasks.find((t) => t.id === taskId);
    if (task) {
      Object.assign(task, updates);
      this.updateStats();
      this.renderTaskList();
    }
  }

  /**
   * 删除任务
   * 
   * @param taskId 任务 ID
   */
  public deleteTask(taskId: string): void {
    this.removeTaskInternal(taskId);
  }

  private async removeTaskInternal(taskId: string): Promise<void> {
    try {
      if (this.manager) {
        await this.manager.removeTask(taskId);
      }
    } finally {
      // 本地视图同步
      const index = this.tasks.findIndex((t) => t.id === taskId);
      if (index !== -1) {
        this.tasks.splice(index, 1);
      }
      this.updateStats();
      this.renderTaskList();
    }
  }

  /**
   * 重试任务
   * 
   * @param taskId 任务 ID
   */
  public async retryTask(taskId: string): Promise<void> {
    try {
      if (this.manager) {
        await this.manager.retryTask(taskId);
      }
    } finally {
      this.syncFromManager();
    }
  }

  /**
   * 优先处理任务
   * 
   * @param taskId 任务 ID
   */
  public async prioritizeTask(taskId: string): Promise<void> {
    try {
      if (this.manager) {
        await this.manager.setTaskPriority(taskId, true);
      }
    } finally {
      this.syncFromManager();
    }
  }

  /**
   * 清除已完成任务
   */
  public async clearCompletedTasks(): Promise<void> {
    if (this.manager) {
      await this.manager.clearCompleted();
    }
    this.syncFromManager();
  }

  /**
   * 获取所有任务
   * 
   * @returns 任务列表
   */
  public getTasks(): TaskItem[] {
    return this.tasks;
  }

  /**
   * 清空所有任务
   */
  public clearAll(): void {
    if (this.manager) {
      this.manager.clearAll();
    }
    this.tasks = [];
    this.updateStats();
    this.renderTaskList();
  }

  /**
   * 视图显示时的回调
   * 
   * @protected
   */
  protected onShow(): void {
    this.attachToManager();
    this.updateStats();
    this.renderTaskList();
  }

  /**
   * 附着到队列管理器,注册回调,并进行初始同步
   */
  private attachToManager(): void {
    if (!this.manager) {
      this.manager = TaskQueueManager.getInstance();
    }

    // 初始同步
    this.syncFromManager();

    // 取消旧回调
    this.unsubscribeProgress?.();
    this.unsubscribeComplete?.();

    // 注册回调
    this.unsubscribeProgress = this.manager.onProgress((taskId, progress) => {
      const t = this.tasks.find(t => t.id === taskId);
      if (t) {
        t.status = TaskStatus.PROCESSING;
        t.progress = progress;
        this.renderTaskList();
      }
    });

    this.unsubscribeComplete = this.manager.onComplete((taskId, success, error) => {
      const t = this.tasks.find(t => t.id === taskId);
      if (t) {
        t.status = success ? TaskStatus.COMPLETED : TaskStatus.FAILED;
        t.error = success ? undefined : (error || t.error);
        t.completedAt = new Date();
        t.progress = 100;
        this.updateStats();
        this.renderTaskList();
      } else {
        // 不在视图内,做一次全量同步
        this.syncFromManager();
      }
    });

    // 兜底定时刷新(5s)
    if (this.refreshTimerId) {
      clearInterval(this.refreshTimerId);
    }
    this.refreshTimerId = setInterval(() => this.syncFromManager(), 5000) as unknown as number;
  }

  /** 从管理器同步任务到视图 */
  private syncFromManager(): void {
    if (!this.manager) return;
    this.tasks = this.manager.getAllTasks();
    this.updateStats();
    this.renderTaskList();
  }

  /** 视图销毁时清理回调和计时器 */
  protected onDestroy(): void {
    if (this.refreshTimerId) {
      clearInterval(this.refreshTimerId);
      this.refreshTimerId = null;
    }
    this.unsubscribeProgress?.();
    this.unsubscribeComplete?.();
    // 清理详情按钮的流式订阅
    if (this.detailStreamUnsubscribe) {
      this.detailStreamUnsubscribe();
      this.detailStreamUnsubscribe = undefined;
    }
    super.onDestroy();
  }
}
