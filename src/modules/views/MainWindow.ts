/**
 * ================================================================
 * 主窗口容器
 * ================================================================
 *
 * 本模块是插件主界面的容器,整合所有子视图
 *
 * 主要职责:
 * 1. 创建和管理对话框窗口
 * 2. 提供标签页导航功能
 * 3. 管理多个子视图的切换
 * 4. 统一的窗口生命周期管理
 * 5. 子视图间的通信协调
 *
 * 子视图列表:
 * - DashboardView: 仪表盘概览
 * - SummaryView: AI 总结输出
 * - TaskQueueView: 任务队列管理
 * - SettingsView: 快捷设置面板
 *
 * 技术实现:
 * - 使用 ztoolkit.Dialog 创建对话框
 * - 标签页切换显示不同视图
 * - 响应式布局适配不同窗口大小
 *
 * @module MainWindow
 * @author AI-Butler Team
 */

import { config } from "../../../package.json";
import { DashboardView } from "./DashboardView";
import { SummaryView } from "./SummaryView";
import { TaskQueueView } from "./TaskQueueView";
import { SettingsView } from "./SettingsView";
import { LibraryScannerView } from "./LibraryScannerView";
import { BaseView } from "./BaseView";
// 移除对窗口尺寸偏好的依赖,窗口/内容区域使用 100% 填充

/**
 * 标签页类型
 */
export type TabType =
  | "dashboard"
  | "summary"
  | "tasks"
  | "settings"
  | "scanner";

/**
 * 主窗口类
 *
 * 管理插件的主界面,提供多标签页视图切换
 */
export class MainWindow {
  /** 单例实例 */
  private static _instance: MainWindow | null = null;
  /** 对话框实例 */
  private dialog: any;

  /** 窗口是否打开 */
  private isOpen: boolean = false;

  /** 当前激活的标签页 */
  private activeTab: TabType = "dashboard";

  /** 视图容器 */
  private viewContainer: HTMLElement | null = null;

  /** 标签页按钮容器 */
  private tabBar: HTMLElement | null = null;

  /** 所有视图实例 */
  private views: Map<TabType, BaseView> = new Map();

  /** 仪表盘视图 */
  private dashboardView: DashboardView;

  /** AI 总结视图 */
  private summaryView: SummaryView;

  /** 任务队列视图 */
  private taskQueueView: TaskQueueView;

  /** 设置视图 */
  private settingsView: SettingsView;

  /** 库扫描视图 */
  private libraryScannerView: LibraryScannerView;

  /**
   * 构造函数
   */
  private constructor() {
    // 初始化各个视图
    this.dashboardView = new DashboardView();
    this.summaryView = new SummaryView();
    this.taskQueueView = new TaskQueueView();
    this.settingsView = new SettingsView();
    this.libraryScannerView = new LibraryScannerView();

    // 为总结视图设置默认的“返回任务队列”行为，避免未设置回调时按钮无效
    // 当外部未覆盖回调时，点击按钮将直接切换到任务队列标签页
    this.summaryView.setQueueButtonHandler(() => {
      this.switchTab("tasks");
    });

    // 注册视图
    this.views.set("dashboard", this.dashboardView);
    this.views.set("summary", this.summaryView);
    this.views.set("tasks", this.taskQueueView);
    this.views.set("settings", this.settingsView);
    this.views.set("scanner", this.libraryScannerView);
  }

  /** 获取主窗口单例 */
  public static getInstance(): MainWindow {
    if (!MainWindow._instance) {
      MainWindow._instance = new MainWindow();
    }
    return MainWindow._instance;
  }

  /**
   * 打开主窗口
   *
   * @param initialTab 初始显示的标签页,默认为 dashboard
   */
  public async open(initialTab: TabType = "dashboard"): Promise<void> {
    if (this.isOpen) {
      // 如果窗口已打开,只切换标签页
      this.switchTab(initialTab);
      try {
        this.dialog?.window?.focus?.();
      } catch (e) {
        ztoolkit.log("[AI Butler] 聚焦已打开窗口失败:", e);
      }
      return;
    }

    this.activeTab = initialTab;

    const dialogData: { [key: string]: any } = {
      loadCallback: () => {
        this.onLoad();
      },
      unloadCallback: () => {
        this.onUnload();
      },
    };

    // 创建对话框（使用固定默认尺寸，内部容器100%填充）
    const defaultW = 950;
    const defaultH = 750;

    this.dialog = new ztoolkit.Dialog(1, 1)
      .addCell(0, 0, {
        tag: "div",
        id: "ai-butler-main-window",
        styles: {
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          fontFamily: "system-ui, -apple-system, sans-serif",
          backgroundColor: "#f5f5f5",
        },
        children: [
          // 标签页导航栏
          {
            tag: "div",
            id: "tab-bar",
            styles: {
              display: "flex",
              backgroundColor: "#fff",
              borderBottom: "2px solid #e0e0e0",
              flexShrink: "0",
            },
          },
          // 视图容器
          {
            tag: "div",
            id: "view-container",
            styles: {
              flex: "1",
              overflow: "hidden",
              backgroundColor: "#fff",
              // 移除 position: relative，让子视图使用正常布局
              display: "flex",
              flexDirection: "column",
            },
          },
        ],
      })
      .setDialogData(dialogData)
      .open("AI Butler - 智能文献管家", {
        width: defaultW,
        height: defaultH,
        centerscreen: true,
        resizable: true,
      });

    this.isOpen = true;

    // 等待 DOM 完全加载
    await Zotero.Promise.delay(100);

    // 初始化界面
    if (this.dialog && this.dialog.window) {
      this.initializeUI();
    }
  }

  /**
   * 初始化 UI
   *
   * @private
   */
  private initializeUI(): void {
    const doc = this.dialog.window.document;

    // 获取容器引用
    this.tabBar = doc.getElementById("tab-bar");
    this.viewContainer = doc.getElementById("view-container");

    if (!this.tabBar || !this.viewContainer) {
      ztoolkit.log("[AI Butler] 无法找到容器元素");
      return;
    }

    // 注入 CSS
    this.injectStyles();

    // 创建标签页按钮
    this.createTabButtons();

    // 渲染所有视图
    this.renderViews();

    // 切换到初始标签页(强制显示)
    this.switchTab(this.activeTab, true);
  }

  /**
   * 注入样式
   *
   * @private
   */
  private injectStyles(): void {
    if (!this.dialog || !this.dialog.window) return;

    const cssLink = this.dialog.window.document.createElement("link");
    cssLink.rel = "stylesheet";
    cssLink.href = `chrome://${config.addonRef}/content/outputWindow.css`;
    this.dialog.window.document.head.appendChild(cssLink);
  }

  /**
   * 创建标签页按钮
   *
   * @private
   */
  private createTabButtons(): void {
    if (!this.tabBar) return;

    const tabs: Array<{ id: TabType; label: string; icon: string }> = [
      { id: "dashboard", label: "仪表盘", icon: "📊" },
      { id: "summary", label: "AI 总结", icon: "📝" },
      { id: "tasks", label: "任务队列", icon: "📋" },
      { id: "settings", label: "快捷设置", icon: "⚙️" },
    ];

    tabs.forEach((tab) => {
      const button = this.dialog.window.document.createElement("button");
      button.id = `tab-${tab.id}`;
      button.className = "tab-button";
      button.innerHTML = `${tab.icon} ${tab.label}`;

      Object.assign(button.style, {
        flex: "1",
        padding: "12px 20px", // 恢复均衡的内边距
        border: "none",
        backgroundColor: "transparent",
        color: "#666",
        fontSize: "14px",
        fontWeight: "600",
        cursor: "pointer",
        transition: "all 0.2s",
        borderBottom: "3px solid transparent",
        display: "flex", // 使用 flex 布局
        alignItems: "center", // 垂直居中
        justifyContent: "center", // 水平居中
        boxSizing: "border-box", // 包含边框在内的盒模型
      });

      button.addEventListener("click", () => {
        this.switchTab(tab.id);
      });

      button.addEventListener("mouseenter", () => {
        if (this.activeTab !== tab.id) {
          button.style.backgroundColor = "rgba(89, 192, 188, 0.05)";
        }
      });

      button.addEventListener("mouseleave", () => {
        if (this.activeTab !== tab.id) {
          button.style.backgroundColor = "transparent";
        }
      });

      this.tabBar!.appendChild(button);
    });
  }

  /**
   * 渲染所有视图
   *
   * @private
   */
  private renderViews(): void {
    if (!this.viewContainer) return;

    this.views.forEach((view, key) => {
      const viewElement = view.render();
      // 使用 flex 布局而非 absolute 定位，让滚动正常工作
      viewElement.style.width = "100%";
      viewElement.style.height = "100%";
      viewElement.style.flex = "1";
      viewElement.style.minHeight = "0"; // 关键：允许 flex 子元素正确计算滚动高度
      viewElement.style.display = "none"; // 初始隐藏
      this.viewContainer!.appendChild(viewElement);
    });
  }

  /**
   * 切换标签页
   *
   * @param tabId 标签页 ID
   * @param force 强制切换(即使已是当前标签)
   */
  public switchTab(tabId: TabType, force: boolean = false): void {
    if (this.activeTab === tabId && !force) return;

    // 隐藏当前视图
    const currentView = this.views.get(this.activeTab);
    if (currentView && this.activeTab !== tabId) {
      currentView.hide();
    }

    // 更新激活状态
    this.activeTab = tabId;

    // 如果是 scanner 视图,隐藏标签栏
    if (this.tabBar) {
      this.tabBar.style.display = tabId === "scanner" ? "none" : "flex";
    }

    // 更新标签按钮样式
    this.updateTabButtons();

    // 显示新视图
    const newView = this.views.get(tabId);
    if (newView) {
      newView.show();
    } else {
      // 视图未实现,显示占位符
      this.showPlaceholder(tabId);
    }
  }

  /**
   * 更新标签按钮样式
   *
   * @private
   */
  private updateTabButtons(): void {
    if (!this.tabBar) return;

    const buttons = this.tabBar.querySelectorAll(".tab-button");
    buttons.forEach((button: Element) => {
      const btn = button as HTMLElement;
      const tabId = btn.id.replace("tab-", "") as TabType;

      if (tabId === this.activeTab) {
        btn.style.color = "#59c0bc";
        btn.style.backgroundColor = "rgba(89, 192, 188, 0.1)";
        btn.style.borderBottomColor = "#59c0bc";
      } else {
        btn.style.color = "#666";
        btn.style.backgroundColor = "transparent";
        btn.style.borderBottomColor = "transparent";
      }
    });
  }

  /**
   * 显示占位符
   *
   * @private
   */
  private showPlaceholder(tabId: TabType): void {
    if (!this.viewContainer) return;

    // 隐藏所有视图
    this.views.forEach((view) => view.hide());

    // 创建临时占位符
    const placeholder = this.viewContainer.querySelector(".placeholder");
    if (placeholder) {
      placeholder.remove();
    }

    const placeholderDiv = this.dialog.window.document.createElement("div");
    placeholderDiv.className = "placeholder";
    Object.assign(placeholderDiv.style, {
      width: "100%",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      color: "#9e9e9e",
      fontSize: "16px",
    });

    placeholderDiv.innerHTML = `
      <div style="font-size: 64px; margin-bottom: 20px;">🚧</div>
      <div>该功能正在开发中...</div>
      <div style="font-size: 12px; margin-top: 10px; opacity: 0.7;">敬请期待</div>
    `;

    this.viewContainer.appendChild(placeholderDiv);
  }

  /**
   * 关闭窗口
   */
  public close(): void {
    if (this.dialog) {
      this.dialog.window.close();
    }
  }

  /**
   * 窗口加载完成回调
   *
   * @private
   */
  private onLoad(): void {
    ztoolkit.log("[AI Butler] 主窗口已加载");
  }

  /**
   * 窗口卸载回调
   *
   * @private
   */
  private onUnload(): void {
    this.isOpen = false;

    // 销毁所有视图
    this.views.forEach((view) => {
      view.destroy();
    });

    ztoolkit.log("[AI Butler] 主窗口已关闭");
  }

  /**
   * 获取仪表盘视图
   *
   * @returns 仪表盘视图实例
   */
  public getDashboardView(): DashboardView {
    return this.dashboardView;
  }

  /**
   * 获取 AI 总结视图
   *
   * @returns AI 总结视图实例
   */
  public getSummaryView(): SummaryView {
    return this.summaryView;
  }

  /**
   * 获取任务队列视图
   *
   * @returns 任务队列视图实例
   */
  public getTaskQueueView(): TaskQueueView {
    return this.taskQueueView;
  }

  /**
   * 检查窗口是否打开
   *
   * @returns 是否打开
   */
  public isWindowOpen(): boolean {
    return this.isOpen;
  }
}
