/**
 * ================================================================
 * 仪表盘视图
 * ================================================================
 *
 * 本模块提供插件工作状态的可视化概览
 *
 * 主要职责:
 * 1. 展示管家工作状态 (工作中/休息中)
 * 2. 显示实时统计数据和图表
 * 3. 展示最近处理的文献列表
 * 4. 提供快速操作入口
 * 5. 显示系统健康状态
 *
 * 显示内容:
 * - 管家状态卡片
 * - 统计数据总览
 * - 处理趋势图表
 * - 最近活动列表
 * - 快捷操作按钮
 *
 * @module DashboardView
 * @author AI-Butler Team
 */

import { BaseView } from "./BaseView";
import { TaskQueueManager, QueueStats, TaskStatus } from "../taskQueue";
import { MainWindow } from "./MainWindow";
import { AutoScanManager } from "../autoScanManager";
import { LLMEndpointManager, type LLMEndpoint } from "../llmEndpointManager";
import { getPref, setPref } from "../../utils/prefs";
import { createCard, createStyledButton } from "./ui/components";

const DEEPSEEK_PRESET_ENDPOINT_ID = "endpoint-preset-deepseek";
const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions";
const DEEPSEEK_MODEL = "deepseek-chat";

interface DeepSeekPresetChange {
  label: string;
  before: string;
  after: string;
}

/**
 * 管家状态枚举
 */
export enum ButlerStatus {
  WORKING = "working", // 工作中
  IDLE = "idle", // 休息中
  ERROR = "error", // 错误状态
}

/**
 * 统计数据接口
 */
export interface DashboardStats {
  totalProcessed: number; // 总处理数
  todayProcessed: number; // 今日处理数
  pendingCount: number; // 待处理数
  failedCount: number; // 失败数
  successRate: number; // 成功率
  averageTime: number; // 平均处理时间(秒)
}

/**
 * 最近活动接口
 */
export interface RecentActivity {
  id: string;
  title: string;
  status: "success" | "failed";
  timestamp: Date;
  duration: number; // 秒
}

/**
 * 仪表盘视图类
 */
export class DashboardView extends BaseView {
  /** 当前管家状态 */
  private butlerStatus: ButlerStatus = ButlerStatus.IDLE;

  /** 统计数据 */
  private stats: DashboardStats = {
    totalProcessed: 0,
    todayProcessed: 0,
    pendingCount: 0,
    failedCount: 0,
    successRate: 100,
    averageTime: 0,
  };

  /** 最近活动列表 */
  private recentActivities: RecentActivity[] = [];

  /** 状态卡片容器 */
  private statusCard: HTMLElement | null = null;

  /** 统计卡片容器 */
  private statsContainer: HTMLElement | null = null;

  /** 活动列表容器 */
  private activityContainer: HTMLElement | null = null;

  /** 任务队列管理器 */
  private taskQueueManager: TaskQueueManager;

  /** 数据刷新定时器 */
  private refreshTimerId: number | null = null;

  /** 进度回调取消函数 */
  private unsubscribeProgress: (() => void) | null = null;

  /** 完成回调取消函数 */
  private unsubscribeComplete: (() => void) | null = null;

  /**
   * 构造函数
   */
  constructor() {
    super("dashboard-view");
    this.taskQueueManager = TaskQueueManager.getInstance();
  }

  /**
   * 视图挂载时的回调
   * 注册任务队列事件监听器并启动数据刷新
   *
   * @protected
   */
  protected onMount(): void {
    super.onMount();

    // 注册任务进度回调
    this.unsubscribeProgress = this.taskQueueManager.onProgress(
      (taskId, progress, message) => {
        this.handleTaskProgress(taskId, progress, message);
      },
    );

    // 注册任务完成回调
    this.unsubscribeComplete = this.taskQueueManager.onComplete(
      (taskId, success, error) => {
        this.handleTaskComplete(taskId, success, error);
      },
    );

    // 启动定时刷新
    this.startRefreshTimer();

    // 立即刷新一次数据
    this.refreshData();

    // 应用主题
    this.applyTheme();
  }

  /**
   * 视图销毁时的回调
   * 清理事件监听器和定时器
   *
   * @protected
   */
  protected onDestroy(): void {
    // 取消任务队列回调
    if (this.unsubscribeProgress) {
      this.unsubscribeProgress();
      this.unsubscribeProgress = null;
    }

    if (this.unsubscribeComplete) {
      this.unsubscribeComplete();
      this.unsubscribeComplete = null;
    }

    // 停止定时刷新
    this.stopRefreshTimer();

    super.onDestroy();
  }

  /**
   * 渲染视图内容
   *
   * @protected
   */
  protected renderContent(): HTMLElement {
    const container = this.createElement("div", {
      id: "ai-butler-dashboard-view",
      styles: {
        position: "relative",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        fontFamily: "system-ui, -apple-system, sans-serif",
        overflow: "auto",
      },
    });

    // 头部区域
    const header = this.createHeader();

    // 管家状态卡片
    this.statusCard = this.createStatusCard();

    // 统计数据区域
    this.statsContainer = this.createStatsSection();

    // 快捷操作区域
    const quickActions = this.createQuickActions();

    // 最近活动区域
    this.activityContainer = this.createRecentActivities();

    container.appendChild(header);
    container.appendChild(this.statusCard);
    container.appendChild(this.statsContainer);
    container.appendChild(quickActions);
    container.appendChild(this.activityContainer);

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
          innerHTML: "📊 仪表盘",
        }),
      ],
    });
  }

  /**
   * 创建管家状态卡片
   *
   * @private
   */
  private createStatusCard(): HTMLElement {
    const card = this.createElement("div", {
      id: "butler-status-card",
      styles: {
        margin: "0 20px 20px 20px",
        padding: "30px",
        background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
        borderRadius: "12px",
        color: "#fff",
        boxShadow: "0 4px 6px rgba(0,0,0,0.1)",
      },
    });

    const statusIcon = this.createElement("div", {
      id: "status-icon",
      styles: {
        fontSize: "48px",
        marginBottom: "15px",
      },
      textContent: "😴",
    });

    const statusText = this.createElement("div", {
      id: "status-text",
      styles: {
        fontSize: "24px",
        fontWeight: "700",
        marginBottom: "10px",
      },
      textContent: "AI 管家正在休息",
    });

    const statusDetail = this.createElement("div", {
      id: "status-detail",
      styles: {
        fontSize: "14px",
        opacity: "0.9",
      },
      textContent: "管家已为您总结 0 篇文献",
    });

    card.appendChild(statusIcon);
    card.appendChild(statusText);
    card.appendChild(statusDetail);

    return card;
  }

  /**
   * 创建统计数据区域
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
        this.createStatCard("total", "总处理数", "0", "#2196f3", "📚"),
        this.createStatCard("today", "今日处理", "0", "#4caf50", "📅"),
        this.createStatCard("pending", "待处理", "0", "#ff9800", "⏳"),
        this.createStatCard("success-rate", "成功率", "100%", "#9c27b0", "✨"),
        this.createStatCard("avg-time", "平均用时", "0s", "#607d8b", "⚡"),
        this.createStatCard("failed", "失败数", "0", "#f44336", "❌"),
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
    color: string,
    icon: string,
  ): HTMLElement {
    const card = createCard("stat", label, undefined, {
      accentColor: color,
      value,
      icon,
      classes: ["stat-card"],
    });
    // 设置元素 id，便于后续更新
    card.id = `stat-${id}`;
    return card;
  }

  /**
   * 创建快捷操作区域
   *
   * @private
   */
  private createQuickActions(): HTMLElement {
    const section = this.createElement("div", {
      styles: {
        padding: "0 20px 20px 20px",
      },
    });

    const title = this.createElement("h3", {
      styles: {
        margin: "0 0 15px 0",
        fontSize: "16px",
        color: "var(--ai-text)",
      },
      textContent: "⚡ 快捷操作",
    });

    const actionsGrid = this.createElement("div", {
      styles: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        gap: "12px",
      },
    });

    const actions = [
      { icon: "🔍", label: "扫描未分析论文", color: "#2196f3" },
      { icon: "🚀", label: "开始自动扫描", color: "#4caf50" },
      { icon: "⏸️", label: "暂停自动扫描", color: "#ff9800" },
      { icon: "📋", label: "查看任务队列", color: "#9c27b0" },
      { icon: "🗑️", label: "清除已完成", color: "#9e9e9e" },
      { icon: "⚙️", label: "打开设置", color: "#607d8b" },
      { icon: "🧭", label: "一键初始化配置", color: "#00a67e" },
    ];

    actions.forEach((action) => {
      const button = createStyledButton(
        `<span style="font-size: 20px;">${action.icon}</span> ${action.label}`,
        action.color,
        "large",
      );

      button.addEventListener("click", () => {
        this.handleQuickAction(action.label);
      });

      actionsGrid.appendChild(button);
    });

    section.appendChild(title);
    section.appendChild(actionsGrid);

    return section;
  }

  /**
   * 创建最近活动区域
   *
   * @private
   */
  private createRecentActivities(): HTMLElement {
    const section = this.createElement("div", {
      styles: {
        padding: "0 20px 20px 20px",
        flex: "1",
      },
    });

    const title = this.createElement("h3", {
      styles: {
        margin: "0 0 15px 0",
        fontSize: "16px",
        color: "var(--ai-text)",
      },
      textContent: "🕒 最近活动",
    });

    const activityList = this.createElement("div", {
      id: "activity-list",
      styles: {
        backgroundColor: "rgba(89, 192, 188, 0.03)",
        borderRadius: "8px",
        padding: "15px",
        maxHeight: "300px",
        overflow: "auto",
      },
    });

    if (this.recentActivities.length === 0) {
      const emptyMsg = this.createElement("div", {
        styles: {
          textAlign: "center",
          padding: "40px 20px",
          color: "#9e9e9e",
          fontSize: "14px",
        },
        textContent: "暂无最近活动",
      });
      activityList.appendChild(emptyMsg);
    }

    section.appendChild(title);
    section.appendChild(activityList);

    return section;
  }

  /**
   * 更新管家状态
   *
   * @param status 状态
   * @param currentItem 当前处理的文献标题
   * @param remaining 剩余数量
   */
  public updateButlerStatus(
    status: ButlerStatus,
    currentItem?: string,
    remaining?: number,
  ): void {
    this.butlerStatus = status;

    if (!this.statusCard) return;

    const statusIcon = this.statusCard.querySelector("#status-icon");
    const statusText = this.statusCard.querySelector("#status-text");
    const statusDetail = this.statusCard.querySelector("#status-detail");

    if (!statusIcon || !statusText || !statusDetail) return;

    switch (status) {
      case ButlerStatus.WORKING:
        statusIcon.textContent = "🧐";
        statusText.textContent = "AI 管家正在废寝忘食地工作";
        statusDetail.textContent = currentItem
          ? `正在阅读: ${currentItem}${remaining ? ` (还剩 ${remaining} 篇)` : ""}`
          : "正在处理文献...";
        this.statusCard.style.background =
          "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)";
        break;

      case ButlerStatus.IDLE:
        statusIcon.textContent = "😴";
        statusText.textContent = "AI 管家正在休息";
        statusDetail.textContent = `管家已为您总结 ${this.stats.totalProcessed} 篇文献`;
        this.statusCard.style.background =
          "linear-gradient(135deg, #667eea 0%, #764ba2 100%)";
        break;

      case ButlerStatus.ERROR:
        statusIcon.textContent = "😵";
        statusText.textContent = "AI 管家遇到了问题";
        statusDetail.textContent = "请检查配置或查看错误日志";
        this.statusCard.style.background =
          "linear-gradient(135deg, #ff6b6b 0%, #ee5a6f 100%)";
        break;
    }
  }

  /**
   * 更新统计数据
   *
   * @param stats 统计数据
   */
  public updateStats(stats: Partial<DashboardStats>): void {
    this.stats = { ...this.stats, ...stats };

    if (!this.statsContainer) return;

    // 更新各个统计卡片
    this.updateStatValue("total", this.stats.totalProcessed.toString());
    this.updateStatValue("today", this.stats.todayProcessed.toString());
    this.updateStatValue("pending", this.stats.pendingCount.toString());
    this.updateStatValue(
      "success-rate",
      `${this.stats.successRate.toFixed(1)}%`,
    );
    this.updateStatValue("avg-time", `${this.stats.averageTime.toFixed(0)}s`);
    this.updateStatValue("failed", this.stats.failedCount.toString());
  }

  /**
   * 更新单个统计值
   *
   * @private
   */
  private updateStatValue(id: string, value: string): void {
    const statCard = this.statsContainer?.querySelector(`#stat-${id}`);
    if (statCard) {
      const valueElement = statCard.querySelector(".stat-value");
      if (valueElement) {
        valueElement.textContent = value;
      }
    }
  }

  /**
   * 添加最近活动
   *
   * @param activity 活动数据
   */
  public addRecentActivity(activity: RecentActivity): void {
    this.recentActivities.unshift(activity);

    // 只保留最近 20 条
    if (this.recentActivities.length > 20) {
      this.recentActivities = this.recentActivities.slice(0, 20);
    }

    this.renderRecentActivities();
  }

  /**
   * 渲染最近活动列表
   *
   * @private
   */
  private renderRecentActivities(): void {
    const activityList =
      this.activityContainer?.querySelector("#activity-list");
    if (!activityList) return;

    activityList.innerHTML = "";

    if (this.recentActivities.length === 0) {
      const emptyMsg = this.createElement("div", {
        styles: {
          textAlign: "center",
          padding: "40px 20px",
          color: "#9e9e9e",
          fontSize: "14px",
        },
        textContent: "暂无最近活动",
      });
      activityList.appendChild(emptyMsg);
      return;
    }

    this.recentActivities.forEach((activity) => {
      const activityItem = this.createElement("div", {
        className: "activity-item",
        styles: {
          padding: "12px",
          marginBottom: "8px",
          borderRadius: "6px",
          borderLeft: `3px solid ${activity.status === "success" ? "#4caf50" : "#f44336"}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        },
      });

      const leftContent = this.createElement("div", {
        styles: {
          flex: "1",
        },
      });

      const title = this.createElement("div", {
        styles: {
          fontSize: "13px",
          fontWeight: "600",
          marginBottom: "4px",
          color: "var(--ai-text)",
        },
        textContent: activity.title,
      });

      const time = this.createElement("div", {
        styles: {
          fontSize: "11px",
          color: "var(--ai-text-muted)",
        },
        textContent: this.formatTime(activity.timestamp),
      });

      leftContent.appendChild(title);
      leftContent.appendChild(time);

      const rightContent = this.createElement("div", {
        styles: {
          display: "flex",
          alignItems: "center",
          gap: "10px",
        },
      });

      const duration = this.createElement("span", {
        styles: {
          fontSize: "11px",
          color: "var(--ai-text-muted)",
        },
        textContent: `${activity.duration}s`,
      });

      const statusIcon = this.createElement("span", {
        styles: {
          fontSize: "16px",
        },
        textContent: activity.status === "success" ? "✅" : "❌",
      });

      rightContent.appendChild(duration);
      rightContent.appendChild(statusIcon);

      activityItem.appendChild(leftContent);
      activityItem.appendChild(rightContent);

      activityList.appendChild(activityItem);
    });
  }

  /**
   * 格式化时间
   *
   * @private
   */
  private formatTime(date: Date): string {
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diff < 60) return "刚刚";
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
    if (diff < 604800) return `${Math.floor(diff / 86400)} 天前`;

    return date.toLocaleDateString("zh-CN");
  }

  /**
   * 处理快捷操作
   *
   * @private
   */
  private async handleQuickAction(action: string): Promise<void> {
    ztoolkit.log(`[AI Butler] 快捷操作: ${action}`);

    switch (action) {
      case "一键初始化配置":
        this.showDeepSeekSetupWizard();
        break;

      case "扫描未分析论文":
        // 切换到库扫描视图
        MainWindow.getInstance().switchTab("scanner");
        break;

      case "开始自动扫描":
        setPref("autoScan", true);
        AutoScanManager.getInstance().start();
        new ztoolkit.ProgressWindow("AI Butler")
          .createLine({ text: "✅ 已启动自动扫描", type: "success" })
          .show();
        break;

      case "暂停自动扫描":
        setPref("autoScan", false);
        AutoScanManager.getInstance().stop();
        new ztoolkit.ProgressWindow("AI Butler")
          .createLine({ text: "⏸️ 已暂停自动扫描", type: "default" })
          .show();
        break;

      case "查看任务队列":
        // 切换到任务队列标签页
        MainWindow.getInstance().switchTab("tasks");
        break;

      case "清除已完成":
        this.taskQueueManager.clearCompleted();
        new ztoolkit.ProgressWindow("AI Butler")
          .createLine({ text: "🗑️ 已清除已完成任务", type: "success" })
          .show();
        this.refreshData();
        break;

      case "打开设置":
        // 切换到设置标签页
        MainWindow.getInstance().switchTab("settings");
        break;

      default:
        new ztoolkit.ProgressWindow("AI Butler")
          .createLine({ text: `功能开发中: ${action}`, type: "default" })
          .show();
    }
  }

  private showDeepSeekSetupWizard(): void {
    const doc =
      this.container?.ownerDocument || Zotero.getMainWindow().document;
    const overlay = this.createElement(
      "div",
      {
        styles: {
          position: "fixed",
          inset: "0",
          zIndex: "2147483647",
          backgroundColor: "rgba(0, 0, 0, 0.45)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
        },
      },
      doc,
    );

    const modal = this.createElement(
      "div",
      {
        styles: {
          width: "min(760px, 96vw)",
          maxHeight: "88vh",
          overflow: "auto",
          backgroundColor: "var(--ai-bg, #fff)",
          color: "var(--ai-text, #222)",
          borderRadius: "14px",
          boxShadow: "0 18px 50px rgba(0,0,0,0.28)",
          border: "1px solid rgba(89, 192, 188, 0.28)",
        },
      },
      doc,
    );

    overlay.appendChild(modal);
    const root = doc.body || doc.documentElement || this.container;
    if (!root) return;
    root.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });

    this.renderPresetSelectionStep(modal, close);
  }

  private renderPresetSelectionStep(
    modal: HTMLElement,
    close: () => void,
  ): void {
    modal.innerHTML = "";
    const nextButton = createStyledButton("下一步", "#00a67e", "medium");
    nextButton.addEventListener("click", () =>
      this.renderDeepSeekGuideStep(modal, close),
    );

    const cancelButton = createStyledButton("取消", "#9e9e9e", "medium");
    cancelButton.addEventListener("click", close);

    modal.appendChild(
      this.createWizardShell(
        "🧭 一键初始化配置",
        "选择一个适合新安装插件的预设，按教程填入 API Key 后即可自动完成常用设置。",
        [
          this.createPresetCard(
            "DeepSeek",
            "适合国内网络环境，价格低，作为 OpenAI 兼容接口接入。",
          ),
        ],
        [cancelButton, nextButton],
        close,
      ),
    );
  }

  private renderDeepSeekGuideStep(modal: HTMLElement, close: () => void): void {
    modal.innerHTML = "";
    const keyInput = this.createElement("input", {
      attributes: {
        type: "password",
        placeholder: "粘贴 DeepSeek API Key，例如 sk-...",
        autocomplete: "off",
      },
      styles: {
        width: "100%",
        boxSizing: "border-box",
        padding: "12px 14px",
        border: "1px solid #cfd8dc",
        borderRadius: "8px",
        fontSize: "14px",
        marginTop: "10px",
      },
    }) as HTMLInputElement;

    const showKeyRow = this.createElement("label", {
      styles: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        marginTop: "10px",
        fontSize: "13px",
        color: "var(--ai-text-muted, #666)",
      },
    });
    const showKeyBox = this.createElement("input", {
      attributes: { type: "checkbox" },
    }) as HTMLInputElement;
    showKeyBox.addEventListener("change", () => {
      keyInput.type = showKeyBox.checked ? "text" : "password";
    });
    showKeyRow.appendChild(showKeyBox);
    showKeyRow.appendChild(docText("显示密钥"));

    const content = this.createElement("div", {
      children: [
        this.createGuideList([
          {
            title: "打开 DeepSeek 开放平台",
            detail: "登录后进入用量页，确认账户有可用余额。",
            url: "https://platform.deepseek.com/usage",
          },
          {
            title: "创建 API Key",
            detail:
              "进入 API Keys 页面，新建密钥并立刻复制；密钥通常只展示一次。",
            url: "https://platform.deepseek.com/api_keys",
          },
          {
            title: "粘贴 API Key",
            detail: "把刚复制的密钥粘贴到下方输入框，然后继续下一步。",
          },
        ]),
        keyInput,
        showKeyRow,
      ],
    });

    const backButton = createStyledButton("上一步", "#607d8b", "medium");
    backButton.addEventListener("click", () =>
      this.renderPresetSelectionStep(modal, close),
    );
    const nextButton = createStyledButton("下一步", "#00a67e", "medium");
    nextButton.addEventListener("click", () => {
      const apiKey = keyInput.value.trim();
      if (!apiKey) {
        keyInput.focus();
        new ztoolkit.ProgressWindow("一键初始化配置", { closeTime: 2200 })
          .createLine({ text: "请先填写 DeepSeek API Key", type: "fail" })
          .show();
        return;
      }
      this.renderDeepSeekConfirmStep(modal, close, apiKey);
    });

    modal.appendChild(
      this.createWizardShell(
        "DeepSeek 配置教程",
        "只需要完成充值/创建密钥/粘贴密钥这几步，剩下的插件设置会自动处理。",
        [content],
        [backButton, nextButton],
        close,
      ),
    );

    function docText(text: string): Text {
      return Zotero.getMainWindow().document.createTextNode(text);
    }
  }

  private renderDeepSeekConfirmStep(
    modal: HTMLElement,
    close: () => void,
    apiKey: string,
  ): void {
    modal.innerHTML = "";
    const changes = this.getDeepSeekPresetChanges(apiKey);
    const list = this.createElement("div", {
      styles: {
        border: "1px solid rgba(89, 192, 188, 0.25)",
        borderRadius: "10px",
        overflow: "hidden",
      },
    });

    changes.forEach((change, index) => {
      const row = this.createElement("div", {
        styles: {
          display: "grid",
          gridTemplateColumns: "1.1fr 1fr 1fr",
          gap: "10px",
          padding: "12px 14px",
          borderTop:
            index === 0 ? "none" : "1px solid rgba(89, 192, 188, 0.18)",
          fontSize: "13px",
          alignItems: "center",
        },
      });
      row.appendChild(
        this.createElement("strong", { textContent: change.label }),
      );
      row.appendChild(this.createMutedCell(change.before));
      row.appendChild(this.createElement("div", { textContent: change.after }));
      list.appendChild(row);
    });

    const warning = this.createElement("div", {
      textContent:
        "确认后会立即保存这些设置，并启动自动扫描。原有其它模型端点会保留在 DeepSeek 后面。",
      styles: {
        marginTop: "14px",
        padding: "12px 14px",
        backgroundColor: "rgba(255, 152, 0, 0.1)",
        border: "1px solid rgba(255, 152, 0, 0.25)",
        borderRadius: "8px",
        color: "#8a5a00",
        fontSize: "13px",
        lineHeight: "1.5",
      },
    });

    const backButton = createStyledButton("上一步", "#607d8b", "medium");
    backButton.addEventListener("click", () =>
      this.renderDeepSeekGuideStep(modal, close),
    );
    const applyButton = createStyledButton("确认并应用", "#00a67e", "medium");
    applyButton.addEventListener("click", () => {
      this.applyDeepSeekPreset(apiKey);
      close();
    });

    modal.appendChild(
      this.createWizardShell(
        "保存并应用配置",
        "请检查即将修改的配置清单。确认后，插件会切换到 DeepSeek 新手推荐配置。",
        [list, warning],
        [backButton, applyButton],
        close,
      ),
    );
  }

  private createWizardShell(
    title: string,
    subtitle: string,
    content: HTMLElement[],
    actions: HTMLButtonElement[],
    close: () => void,
  ): HTMLElement {
    const shell = this.createElement("div", {
      styles: {
        padding: "24px",
      },
    });
    const closeButton = createStyledButton("×", "#9e9e9e", "small");
    Object.assign(closeButton.style, {
      width: "34px",
      height: "34px",
      padding: "0",
      fontSize: "20px",
    });
    closeButton.addEventListener("click", close);

    const header = this.createElement("div", {
      styles: {
        position: "relative",
        display: "flex",
        justifyContent: "space-between",
        gap: "16px",
        alignItems: "flex-start",
        marginBottom: "18px",
      },
      children: [
        this.createElement("div", {
          children: [
            this.createElement("h2", {
              textContent: title,
              styles: {
                margin: "0 0 8px 0",
                color: "#00a67e",
                fontSize: "22px",
              },
            }),
            this.createElement("div", {
              textContent: subtitle,
              styles: {
                color: "var(--ai-text-muted, #666)",
                fontSize: "14px",
                lineHeight: "1.6",
              },
            }),
          ],
        }),
        closeButton,
      ],
    });

    const body = this.createElement("div", {
      styles: {
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
      },
      children: content,
    });

    const footer = this.createElement("div", {
      styles: {
        position: "relative",
        display: "flex",
        justifyContent: "flex-end",
        gap: "10px",
        marginTop: "22px",
      },
      children: actions,
    });

    shell.appendChild(header);
    shell.appendChild(body);
    shell.appendChild(footer);
    return shell;
  }

  private createPresetCard(title: string, description: string): HTMLElement {
    return this.createElement("div", {
      styles: {
        padding: "18px",
        border: "2px solid #00a67e",
        borderRadius: "12px",
        backgroundColor: "rgba(0, 166, 126, 0.08)",
      },
      children: [
        this.createElement("div", {
          textContent: `✅ ${title}`,
          styles: {
            fontSize: "18px",
            fontWeight: "700",
            marginBottom: "8px",
          },
        }),
        this.createElement("div", {
          textContent: description,
          styles: {
            color: "var(--ai-text-muted, #666)",
            fontSize: "14px",
            lineHeight: "1.6",
          },
        }),
      ],
    });
  }

  private createGuideList(
    items: Array<{ title: string; detail: string; url?: string }>,
  ): HTMLElement {
    const list = this.createElement("div", {
      styles: {
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      },
    });
    items.forEach((item, index) => {
      const row = this.createElement("div", {
        styles: {
          display: "grid",
          gridTemplateColumns: "34px 1fr auto",
          gap: "12px",
          alignItems: "center",
          padding: "12px",
          border: "1px solid rgba(89, 192, 188, 0.2)",
          borderRadius: "10px",
        },
      });
      row.appendChild(
        this.createElement("div", {
          textContent: String(index + 1),
          styles: {
            width: "30px",
            height: "30px",
            borderRadius: "999px",
            backgroundColor: "#00a67e",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: "700",
          },
        }),
      );
      row.appendChild(
        this.createElement("div", {
          children: [
            this.createElement("div", {
              textContent: item.title,
              styles: { fontWeight: "700", marginBottom: "4px" },
            }),
            this.createElement("div", {
              textContent: item.detail,
              styles: {
                fontSize: "13px",
                color: "var(--ai-text-muted, #666)",
                lineHeight: "1.5",
              },
            }),
          ],
        }),
      );
      if (item.url) {
        const link = this.createElement("button", {
          textContent: "打开",
          styles: {
            border: "none",
            background: "transparent",
            color: "#00a67e",
            fontWeight: "700",
            textDecoration: "none",
            cursor: "pointer",
            padding: "6px 8px",
          },
        });
        link.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.openExternalUrl(item.url!);
        });
        row.appendChild(link);
      } else {
        row.appendChild(this.createElement("span"));
      }
      list.appendChild(row);
    });
    return list;
  }

  private openExternalUrl(url: string): void {
    try {
      if ((Zotero as any).launchURL) {
        (Zotero as any).launchURL(url);
        return;
      }
      const win = Zotero.getMainWindow() as any;
      if (win?.ZoteroPane?.loadURI) {
        win.ZoteroPane.loadURI(url);
        return;
      }
      if (win?.openTrustedLinkIn) {
        win.openTrustedLinkIn(url, "tab");
        return;
      }
      win?.open?.(url, "_blank");
    } catch (error) {
      ztoolkit.log("[AI-Butler] 打开外部链接失败:", error);
      new ztoolkit.ProgressWindow("一键初始化配置", { closeTime: 3000 })
        .createLine({ text: `无法打开链接：${url}`, type: "fail" })
        .show();
    }
  }
  private createMutedCell(text: string): HTMLElement {
    return this.createElement("div", {
      textContent: text,
      styles: {
        color: "var(--ai-text-muted, #777)",
        overflow: "hidden",
        textOverflow: "ellipsis",
      },
    });
  }

  private getDeepSeekPresetChanges(apiKey: string): DeepSeekPresetChange[] {
    const endpoints = LLMEndpointManager.getEndpoints();
    const currentTop = endpoints[0]?.name || "未配置";
    const maskedKey = this.maskApiKey(apiKey);
    return [
      {
        label: "模型平台",
        before: String(getPref("provider") || "未配置"),
        after: "OpenAI 兼容 / DeepSeek",
      },
      {
        label: "DeepSeek API 地址",
        before: String(getPref("openaiCompatApiUrl") || "空"),
        after: DEEPSEEK_API_URL,
      },
      {
        label: "DeepSeek 模型",
        before: String(getPref("openaiCompatModel") || "空"),
        after: DEEPSEEK_MODEL,
      },
      { label: "API Key", before: "本地已有值会被替换", after: maskedKey },
      { label: "端点优先级", before: currentTop, after: "DeepSeek 排在第一位" },
      {
        label: "PDF 处理",
        before: String(getPref("pdfProcessMode") || "base64"),
        after: "文本提取",
      },
      {
        label: "自动扫描",
        before: getPref("autoScan") ? "已开启" : "已关闭",
        after: "开启",
      },
      {
        label: "追问保存",
        before: getPref("saveChatHistory") ? "已开启" : "已关闭",
        after: "开启",
      },
      {
        label: "温度参数",
        before: getPref("enableTemperature") ? "发送" : "不发送",
        after: "不发送",
      },
      {
        label: "Max Tokens 参数",
        before: getPref("enableMaxTokens") ? "发送" : "不发送",
        after: "不发送",
      },
      {
        label: "Top P 参数",
        before: getPref("enableTopP") ? "发送" : "不发送",
        after: "不发送",
      },
    ];
  }

  private applyDeepSeekPreset(apiKey: string): void {
    const trimmedKey = apiKey.trim();
    const timestamp = new Date().toISOString();
    const deepSeekEndpoint: LLMEndpoint = {
      id: DEEPSEEK_PRESET_ENDPOINT_ID,
      name: "DeepSeek",
      providerType: "openai-compat",
      apiUrl: DEEPSEEK_API_URL,
      apiKey: trimmedKey,
      model: DEEPSEEK_MODEL,
      reasoningEffort: "default",
      pdfProcessMode: "text",
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const endpoints = LLMEndpointManager.getEndpoints().filter(
      (endpoint) => endpoint.id !== DEEPSEEK_PRESET_ENDPOINT_ID,
    );

    setPref("provider", "openai-compat");
    setPref("openaiCompatApiUrl", DEEPSEEK_API_URL);
    setPref("openaiCompatApiKey", trimmedKey);
    setPref("openaiCompatModel", DEEPSEEK_MODEL);
    setPref("llmRoutingStrategy", "priority");
    setPref("pdfProcessMode", "text");
    setPref("autoScan", true);
    setPref("saveChatHistory", true as any);
    setPref("enableTemperature", false as any);
    setPref("enableMaxTokens", false as any);
    setPref("enableTopP", false as any);
    LLMEndpointManager.saveEndpoints([deepSeekEndpoint, ...endpoints]);
    AutoScanManager.getInstance().start();

    new ztoolkit.ProgressWindow("一键初始化配置", { closeTime: 3000 })
      .createLine({
        text: "✅ DeepSeek 配置已应用，可以开始使用了",
        type: "success",
      })
      .show();
  }

  private maskApiKey(apiKey: string): string {
    const trimmed = apiKey.trim();
    if (trimmed.length <= 10) return "已填写";
    return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
  }

  /**
   * 获取主窗口实例
   *
   * @private
   */
  private getMainWindow(): MainWindow | null {
    // 从全局存储获取主窗口实例
    const win = Zotero.getMainWindow();
    return ((win as any).__aiButlerMainWindow as MainWindow) || null;
  }

  // ==================== 数据刷新 ====================

  /**
   * 启动定时刷新
   *
   * @private
   */
  private startRefreshTimer(): void {
    if (this.refreshTimerId !== null) {
      return;
    }

    // 每5秒刷新一次
    this.refreshTimerId = setInterval(() => {
      this.refreshData();
    }, 5000) as any as number;
  }

  /**
   * 停止定时刷新
   *
   * @private
   */
  private stopRefreshTimer(): void {
    if (this.refreshTimerId !== null) {
      clearInterval(this.refreshTimerId);
      this.refreshTimerId = null;
    }
  }

  /**
   * 刷新所有数据
   *
   * @private
   */
  private refreshData(): void {
    this.taskQueueManager.refreshFromStorage();

    // 获取队列统计数据
    const queueStats = this.taskQueueManager.getStats();

    // 计算管家状态
    const butlerStatus = this.calculateButlerStatus(queueStats);

    // 获取当前处理的任务
    const processingTask = this.taskQueueManager.getTasksByStatus(
      TaskStatus.PROCESSING,
    )[0];

    // 更新管家状态
    this.updateButlerStatus(
      butlerStatus,
      processingTask?.title,
      queueStats.pending + queueStats.priority,
    );

    // 计算平均处理时间
    const completedTasks = this.taskQueueManager
      .getAllTasks()
      .filter((t) => t.status === "completed" && t.duration);
    const avgTime =
      completedTasks.length > 0
        ? completedTasks.reduce((sum, t) => sum + (t.duration || 0), 0) /
          completedTasks.length
        : 0;

    // 更新统计数据
    this.updateStats({
      totalProcessed: queueStats.completed,
      todayProcessed: this.taskQueueManager.getTodayCompletedCount(),
      pendingCount: queueStats.pending + queueStats.priority,
      failedCount: queueStats.failed,
      successRate: queueStats.successRate,
      averageTime: avgTime,
    });

    // 从队列加载最近活动
    this.loadRecentActivitiesFromQueue();
  }

  /**
   * 计算管家状态
   *
   * @private
   */
  private calculateButlerStatus(stats: QueueStats): ButlerStatus {
    if (stats.processing > 0) {
      return ButlerStatus.WORKING;
    }

    if (stats.failed > 0 && stats.pending === 0 && stats.priority === 0) {
      return ButlerStatus.ERROR;
    }

    return ButlerStatus.IDLE;
  }

  /**
   * 从任务队列加载最近活动
   *
   * @private
   */
  private loadRecentActivitiesFromQueue(): void {
    const allTasks = this.taskQueueManager.getAllTasks();

    // 筛选已完成和失败的任务
    const finishedTasks = allTasks
      .filter((t) => t.status === "completed" || t.status === "failed")
      .filter((t) => t.completedAt)
      .sort((a, b) => {
        const aTime = a.completedAt?.getTime() || 0;
        const bTime = b.completedAt?.getTime() || 0;
        return bTime - aTime;
      })
      .slice(0, 20);

    // 转换为活动记录
    this.recentActivities = finishedTasks.map((task) => ({
      id: task.id,
      title: task.title,
      status:
        task.status === "completed"
          ? ("success" as const)
          : ("failed" as const),
      timestamp: task.completedAt!,
      duration: task.duration || 0,
    }));

    this.renderRecentActivities();
  }

  // ==================== 任务队列事件处理 ====================

  /**
   * 处理任务进度更新
   *
   * @private
   */
  private handleTaskProgress(
    taskId: string,
    progress: number,
    message: string,
  ): void {
    ztoolkit.log(`任务进度: ${taskId} - ${progress}% - ${message}`);

    // 刷新数据以更新状态
    this.refreshData();
  }

  /**
   * 处理任务完成
   *
   * @private
   */
  private handleTaskComplete(
    taskId: string,
    success: boolean,
    error?: string,
  ): void {
    ztoolkit.log(`任务完成: ${taskId} - 成功=${success}`);

    // 获取任务信息
    const task = this.taskQueueManager.getTask(taskId);
    if (task) {
      // 添加到最近活动
      this.addRecentActivity({
        id: task.id,
        title: task.title,
        status: success ? "success" : "failed",
        timestamp: new Date(),
        duration: task.duration || 0,
      });
    }

    // 刷新数据
    this.refreshData();

    // 显示通知
    if (success) {
      new ztoolkit.ProgressWindow("AI Butler", {
        closeTime: 3000,
      })
        .createLine({ text: `✅ 已完成: ${task?.title}`, type: "success" })
        .show();
    } else {
      new ztoolkit.ProgressWindow("AI Butler", {
        closeTime: 5000,
      })
        .createLine({ text: `❌ 处理失败: ${task?.title}`, type: "fail" })
        .createLine({ text: error || "未知错误", type: "default" })
        .show();
    }
  }

  /**
   * 视图显示时的回调
   *
   * @protected
   */
  protected onShow(): void {
    this.refreshData();
  }
}
