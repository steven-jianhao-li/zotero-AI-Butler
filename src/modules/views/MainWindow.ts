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
import { LiteratureReviewView } from "./LiteratureReviewView";
import { BaseView } from "./BaseView";
import {
  createMainWindowScaffold,
  type MainTabDescriptor,
  type MainWindowScaffoldRefs,
} from "./layout/windowScaffold";
// 移除对窗口尺寸偏好的依赖,窗口/内容区域使用 100% 填充

/**
 * 标签页类型
 */
export type TabType =
  | "dashboard"
  | "summary"
  | "tasks"
  | "settings"
  | "scanner"
  | "literature-review";

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
  /** 是否正在打开窗口（防抖并发 open）*/
  private isOpening: boolean = false;

  /** UI 初始化重试次数（用于等待异步渲染完成）*/
  private initAttempts = 0;
  /** UI 初始化最大重试次数 */
  private readonly maxInitAttempts = 60; // ~3s 若按 50ms 重试，提升慢机稳定性

  /** UI 是否已成功初始化（完成注入样式、创建按钮与渲染视图）*/
  private uiInitialized: boolean = false;
  /** 是否正在执行初始化，避免并发重复渲染 */
  private uiInitializing: boolean = false;

  /** 当前激活的标签页 */
  private activeTab: TabType = "dashboard";

  /** 视图容器 */
  private viewContainer: HTMLElement | null = null;

  /** 标签页按钮容器 */
  private tabBar: HTMLElement | null = null;

  /** 固定式主窗口脚手架 */
  private scaffold: MainWindowScaffoldRefs<TabType> | null = null;

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

  /** 文献综述视图 */
  private literatureReviewView: LiteratureReviewView;

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
    this.literatureReviewView = new LiteratureReviewView();

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
    this.views.set("literature-review", this.literatureReviewView);
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

    // 防止并发重复打开
    if (this.isOpening) {
      this.activeTab = initialTab;
      return;
    }
    this.isOpening = true;

    this.activeTab = initialTab;

    const dialogData: { [key: string]: any } = {
      loadCallback: () => {
        this.onLoad();
        // 确保在窗口真正完成加载后再初始化 UI
        try {
          this.initAttempts = 0;
          this.initializeUI();
          // 初始化主题根类与暗色切换
          try {
            const root = this.dialog?.window?.document?.getElementById(
              "ai-butler-main-window",
            );
            if (root && !root.classList.contains("ai-butler-root")) {
              root.classList.add("ai-butler-root");
            }
            let isDark = false;
            try {
              isDark = Services.prefs.getBoolPref("zotero.theme.dark", false);
            } catch {
              // Ignored
            }
            if (!isDark) {
              try {
                isDark = Services.prefs.getBoolPref(
                  "ui.systemUsesDarkTheme",
                  false,
                );
              } catch {
                // Ignored
              }
            }
            const win = Zotero.getMainWindow();
            if (!isDark && win && typeof win.matchMedia === "function") {
              try {
                const mq = win.matchMedia("(prefers-color-scheme: dark)");
                if (mq) {
                  isDark = mq.matches;
                }
              } catch {
                // Ignored
              }
            }
            if (root) {
              if (isDark) root.classList.add("ai-butler-dark");
              else root.classList.remove("ai-butler-dark");
            }
          } catch (e2) {
            ztoolkit.log("[AI Butler] 初始化主题类失败", e2);
          }
        } catch (e) {
          ztoolkit.log("[AI Butler] 初始化 UI 异常:", e);
        }
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
          minHeight: "0",
          overflow: "hidden",
          position: "relative",
          backgroundColor: "var(--ai-bg)",
          boxSizing: "border-box",
        },
      })
      .setDialogData(dialogData)
      .open("AI Butler - 智能文献管家", {
        width: defaultW,
        height: defaultH,
        centerscreen: true,
        resizable: true,
      });

    this.isOpen = true;
    this.isOpening = false;

    // 额外兜底：某些环境下 loadCallback 可能过早触发/或渲染延迟，这里再轻量兜底一次
    await Zotero.Promise.delay(150);
    if (
      this.dialog &&
      this.dialog.window &&
      !this.uiInitialized &&
      (!this.tabBar || !this.viewContainer)
    ) {
      this.initAttempts = 0;
      this.initializeUI();
    }
  }

  /**
   * 初始化 UI
   *
   * @private
   */
  private initializeUI(): void {
    // 已初始化或正在初始化则直接返回，避免并发/重复
    if (this.uiInitialized || this.uiInitializing) return;
    this.uiInitializing = true;

    const doc = this.dialog.window.document;
    const tryInit = () => {
      const host = doc.getElementById("ai-butler-main-window") as HTMLElement;

      if (!host) {
        // 如果容器还未渲染出来，重试；达到上限后进行兜底创建
        if (this.initAttempts < this.maxInitAttempts) {
          this.initAttempts++;
          setTimeout(tryInit, 50);
          return;
        }

        ztoolkit.log("[AI Butler] 无法找到主窗口脚手架宿主元素");
        this.uiInitializing = false;
        return;
      }

      // 注入 CSS（只在首次完成时执行）
      this.injectStyles();

      // 创建冻结式窗口脚手架
      const tabs: Array<MainTabDescriptor<TabType>> = [
        { id: "dashboard", label: "仪表盘", icon: "📊" },
        { id: "summary", label: "AI 总结", icon: "📝" },
        { id: "tasks", label: "任务队列", icon: "📋" },
        { id: "settings", label: "快捷设置", icon: "⚙️" },
      ];
      this.scaffold = createMainWindowScaffold(host, tabs, (tabId) => {
        this.switchTab(tabId);
      });
      this.tabBar = this.scaffold.topNav;
      this.viewContainer = this.scaffold.viewPort;

      // 渲染所有视图（只在首次完成时执行）
      this.renderViews();

      // 切换到初始标签页(强制显示)
      this.switchTab(this.activeTab, true);

      // 标记完成
      this.uiInitialized = true;
      this.uiInitializing = false;
    };

    // 启动首次尝试
    this.initAttempts = 0;
    tryInit();
  }

  /**
   * 注入样式
   *
   * @private
   */
  private injectStyles(): void {
    if (!this.dialog || !this.dialog.window) return;
    const doc = this.dialog.window.document;
    if (doc.documentElement) {
      doc.documentElement.style.height = "100%";
    }
    if (doc.body) {
      doc.body.style.height = "100%";
      doc.body.style.margin = "0";
    }

    const baseLink = doc.createElement("link");
    baseLink.rel = "stylesheet";
    baseLink.href = `chrome://${config.addonRef}/content/outputWindow.css`;
    doc.head.appendChild(baseLink);
    if (!doc.getElementById("ai-butler-theme-css")) {
      const themeLink = doc.createElement("link");
      themeLink.id = "ai-butler-theme-css";
      themeLink.rel = "stylesheet";
      themeLink.href = `chrome://${config.addonRef}/content/aiButlerTheme.css`;
      doc.head.appendChild(themeLink);
    }
  }

  /**
   * 渲染所有视图
   *
   * @private
   */
  private renderViews(): void {
    if (!this.viewContainer) return;

    this.views.forEach((view) => {
      const viewElement = view.render();
      // 页面层绝对定位，避免内容高度推动顶部导航或窗口外层滚动
      viewElement.style.position = "absolute";
      viewElement.style.inset = "0";
      viewElement.style.width = "100%";
      viewElement.style.height = "100%";
      viewElement.style.minHeight = "0";
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

    // 如果是 scanner 或 literature-review 视图,隐藏标签栏
    this.scaffold?.setMainNavVisible(
      tabId !== "scanner" && tabId !== "literature-review",
    );

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
    this.scaffold?.setActiveTab(this.activeTab);
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
    this.isOpening = false;

    // 重置初始化相关状态，防止下次打开复用旧引用
    this.uiInitialized = false;
    this.uiInitializing = false;
    this.initAttempts = 0;
    this.tabBar = null;
    this.viewContainer = null;
    this.scaffold = null;

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

  /**
   * 获取文献综述视图
   *
   * @returns 文献综述视图实例
   */
  public getLiteratureReviewView(): LiteratureReviewView {
    return this.literatureReviewView;
  }
}
