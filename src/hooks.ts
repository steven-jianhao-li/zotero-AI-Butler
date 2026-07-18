/**
 * ================================================================
 * AI-Butler 插件生命周期钩子函数模块
 * ================================================================
 *
 * 本模块定义了插件在各个生命周期阶段的行为处理函数
 *
 * 主要职责:
 * 1. 插件启动初始化 - 加载国际化资源、注册UI组件、初始化配置
 * 2. 主窗口生命周期管理 - 处理Zotero主窗口的加载和卸载事件
 * 3. 用户交互处理 - 响应右键菜单点击、快捷键等用户操作
 * 4. 偏好设置管理 - 初始化和持久化用户配置
 * 5. 清理资源 - 在插件关闭时正确释放资源
 *
 * 架构设计:
 * - 采用异步初始化确保所有依赖项准备就绪
 * - 分离关注点,将不同职责的逻辑封装在独立函数中
 * - 使用 Zotero 提供的 Promise API 协调异步操作
 * - 统一的错误处理和用户反馈机制
 *
 * @module hooks
 * @author AI-Butler Team
 */

import { getString, initLocale, getLocaleID } from "./utils/locale";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { createZToolkit } from "./utils/ztoolkit";
import { TaskQueueManager } from "./modules/taskQueue";
import {
  registerLibraryStatusColumn,
  unregisterLibraryStatusColumn,
} from "./modules/libraryStatusColumn";
import {
  CollectionAiNoteCleaner,
  type CleanableAiNoteType,
  type CollectionAiNoteCleanAction,
  type CollectionAiNoteCleanPlan,
  type CollectionAiNoteCleanScope,
  type RegeneratableAiNoteType,
} from "./modules/collectionAiNoteCleaner";
import { MainWindow } from "./modules/views/MainWindow";
import { AutoScanManager } from "./modules/autoScanManager";
import { AutoNoteExportManager } from "./modules/autoNoteExportManager";
import {
  CONTEXT_MENU_ITEMS,
  DEFAULT_CONTEXT_MENU_COLLAPSED,
  DEFAULT_CONTEXT_MENU_ITEM_ORDER_PREF,
  DEFAULT_CONTEXT_MENU_ITEM_VISIBILITY_PREF,
  DEFAULT_SIDEBAR_MODULE_ORDER_PREF,
  DEFAULT_SIDEBAR_MODULE_VISIBILITY_PREF,
  getContextMenuItemOrder,
  isContextMenuCollapsed,
  isContextMenuItemEnabled,
  isTableFeatureEnabled,
  type ContextMenuItemId,
} from "./modules/uiCustomization";
import { config } from "../package.json";
import { getPref, setPref } from "./utils/prefs";
import { LLMEndpointManager } from "./modules/llmEndpointManager";
import { promptLegacyAiNoteRenameIfNeeded } from "./modules/legacyAiNoteMigration";
import {
  getDefaultSummaryPrompt,
  PROMPT_VERSION,
  shouldUpdatePrompt,
} from "./utils/prompts";
import { maybeOpenOnboardingTutorialOnStartup } from "./modules/onboarding";

/**
 * 插件启动钩子函数
 *
 * 在 Zotero 完成基础初始化后执行,负责插件的完整启动流程
 *
 * 执行流程:
 * 1. 等待 Zotero 核心服务就绪(初始化、解锁、UI就绪)
 * 2. 加载国际化资源,支持多语言界面
 * 3. 初始化用户配置,确保所有配置项都有合理的默认值
 * 4. 注册偏好设置面板,允许用户自定义插件行为
 * 5. 为所有打开的主窗口加载插件 UI 组件
 * 6. 标记插件初始化完成
 *
 * @returns Promise<void> 异步初始化完成的承诺
 */
async function onStartup() {
  // 等待 Zotero 核心服务完全就绪
  // 这确保了插件代码可以安全地访问 Zotero API
  await Promise.all([
    Zotero.initializationPromise, // Zotero 核心初始化
    Zotero.unlockPromise, // 数据库解锁
    Zotero.uiReadyPromise, // 用户界面准备就绪
  ]);

  // 初始化国际化资源,加载翻译文本
  initLocale();

  // 初始化插件默认配置
  // 确保即使用户首次使用,也能有合理的默认设置
  initializeDefaultPrefsOnStartup();

  // 注册插件偏好设置面板
  // 用户可以通过 Zotero 设置界面访问和修改插件配置
  registerPrefsPane();

  // 为所有已打开的 Zotero 主窗口加载插件界面组件
  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  // 注册 PDF 阅读器工具栏按钮
  // 用户可以在阅读 PDF 时快速访问 AI 追问功能
  registerReaderToolbarButton();

  // 注册条目面板自定义区块
  // 用户可以在浏览文献库时快速访问 AI 追问功能
  registerItemPaneSection();

  // 注册文献库 AI 精读状态列
  registerLibraryStatusColumn();

  // 启动自动扫描管理器
  const autoScanManager = AutoScanManager.getInstance();
  autoScanManager.start();

  AutoNoteExportManager.getInstance().start();

  // 标记插件初始化完成
  // 某些功能依赖此标志来判断插件是否已准备好
  addon.data.initialized = true;

  void maybeOpenOnboardingTutorialOnStartup();
}

/**
 * 主窗口加载钩子函数
 *
 * 当 Zotero 主窗口加载时执行,为该窗口初始化插件的UI组件和菜单
 *
 * 执行流程:
 * 1. 为当前窗口创建独立的工具包实例
 * 2. 注入国际化资源文件(FTL),支持本地化UI文本
 * 3. 注册右键菜单项,提供快捷操作入口
 * 4. 显示启动提示,向用户确认插件已成功加载
 *
 * 注意事项:
 * - 每个窗口都有独立的工具包实例,避免状态混乱
 * - FTL 文件按需注入,提高加载效率
 *
 * @param win Zotero 主窗口对象
 * @returns Promise<void> 窗口初始化完成的承诺
 */
async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  // 为当前窗口创建专用的工具包实例
  // 每个窗口独立的工具包确保UI操作不会相互干扰
  addon.data.ztoolkit = createZToolkit();

  // 注入插件主窗口的国际化资源
  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-addon.ftl`,
  );
  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );

  // 注入偏好设置窗口的国际化资源
  // 即使主窗口尚未打开偏好设置,也预先加载资源文件
  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-preferences.ftl`,
  );

  // 注册右键上下文菜单
  // 为用户提供快速访问插件功能的入口
  registerContextMenuItem();
  bindUICustomizationRefreshEvent(win);

  // 注册文献库工具栏按钮
  // 用户可以在文献库界面快速访问 AI 管家
  registerLibraryToolbarButton(win);

  // 显示启动成功提示（仅一次）
  if (!(addon.data as any).startupPopupShown) {
    (addon.data as any).startupPopupShown = true;
    const popupWin = new ztoolkit.ProgressWindow(addon.data.config.addonName, {
      closeOnClick: true,
      closeTime: -1,
    })
      .createLine({
        text: "" + getString("startup-begin"),
        type: "default",
        progress: 100,
      })
      .show();
    popupWin.startCloseTimer(3000);
  }
}

/**
 * 注册插件偏好设置面板
 *
 * 在 Zotero 设置界面中添加插件专属的配置页面
 * 用户可以通过此面板管理 API 密钥、提示词等设置
 *
 * 技术实现:
 * - 使用 Zotero.PreferencePanes API 注册设置面板
 * - 配置页面加载自 preferences.xhtml
 * - 支持国际化标题和图标定制
 */
function registerPrefsPane() {
  const prefOptions = {
    pluginID: config.addonID, // 插件唯一标识
    src: rootURI + "content/preferences.xhtml", // 配置页面 XHTML 文件路径
    label: getString("prefs-title"), // 国际化的面板标题
    image: `chrome://${config.addonRef}/content/icons/favicon.png`, // 面板图标
    defaultXUL: true, // 使用默认 XUL 布局
    // 在偏好设置窗格中加载外部脚本,用于触发 onPrefsEvent('load')
    scripts: [rootURI + `content/scripts/${config.addonRef}-prefs.js`],
  };
  Zotero.PreferencePanes.register(prefOptions);
}

/**
 * 插件启动时初始化默认配置
 *
 * 在插件首次加载或配置缺失时,设置合理的默认值
 * 确保插件在任何情况下都有可用的基础配置
 *
 * 处理逻辑:
 * 1. 定义所有配置项的默认值
 * 2. 逐项检查当前配置是否存在
 * 3. 对于缺失或空值的配置,应用默认值
 * 4. 特殊处理提示词版本升级逻辑
 *
 * 配置项说明:
 * - openaiApiKey: API 访问密钥(敏感信息,默认为空)
 * - openaiApiUrl: 大模型 API 端点地址
 * - openaiApiModel: 使用的模型名称
 * - temperature: 模型温度参数(控制输出随机性)
 * - stream: 是否启用流式输出
 * - summaryPrompt: 论文总结提示词模板
 * - promptVersion: 提示词版本号(用于版本升级)
 */
function initializeDefaultPrefsOnStartup() {
  // 定义所有配置项的默认值
  const defaults: Record<string, any> = {
    openaiApiKey: "", // API 密钥默认为空,需用户配置
    openaiApiUrl: "https://api.openai.com/v1/responses", // 默认使用 OpenAI API 端点
    openaiApiModel: "gpt-5", // 默认模型
    // OpenAI 兼容（旧 Chat Completions）默认
    openaiCompatApiUrl: "https://api.openai.com/v1/chat/completions",
    openaiCompatApiKey: "",
    openaiCompatModel: "gpt-3.5-turbo",
    // OpenRouter 默认
    openRouterApiUrl: "https://openrouter.ai/api/v1/chat/completions",
    openRouterApiKey: "",
    openRouterModel: "google/gemma-3-27b-it",
    ollamaApiUrl: "http://localhost:11434",
    ollamaApiKey: "",
    ollamaModel: "llama3.2",
    llmEndpoints: "[]",
    llmRoutingStrategy: "priority",
    llmRoundRobinCursor: "",
    multiModelSummaryEnabled: false,
    multiModelSummaryEndpointIds: "[]",
    // 备用 API 密钥列表（JSON 数组格式）
    openaiApiKeysFallback: "[]",
    openaiCompatApiKeysFallback: "[]",
    geminiApiKeysFallback: "[]",
    anthropicApiKeysFallback: "[]",
    openRouterApiKeysFallback: "[]",
    volcanoArkApiKeysFallback: "[]",
    ollamaApiKeysFallback: "[]",
    // API 轮换配置
    maxApiSwitchCount: "3", // 最大切换次数
    failedKeyCooldown: "300000", // 失败密钥冷却时间(毫秒)，默认5分钟
    temperature: "0.7", // 默认温度参数,平衡创造性和准确性
    reasoningEffort: "default",
    stream: true, // 默认启用流式输出,提供更好的用户体验
    summaryPrompt: getDefaultSummaryPrompt(), // 加载默认提示词模板
    promptVersion: PROMPT_VERSION, // 当前提示词版本号
    contextMenuCollapsed: DEFAULT_CONTEXT_MENU_COLLAPSED,
    contextMenuItemVisibility: DEFAULT_CONTEXT_MENU_ITEM_VISIBILITY_PREF,
    contextMenuItemOrder: DEFAULT_CONTEXT_MENU_ITEM_ORDER_PREF,
    sidebarModuleVisibility: DEFAULT_SIDEBAR_MODULE_VISIBILITY_PREF,
    sidebarModuleOrder: DEFAULT_SIDEBAR_MODULE_ORDER_PREF,
    openTaskPanelOnSummon: false,
    autoScanSummaryEnabled: true,
    autoScanDeepReadEnabled: false,
    noteExportEnabled: false,
    noteExportRootPath: "",
    noteExportWatchedCollections: "[]",
    noteExportIncludeSubcollections: true,
    noteExportFormats:
      '{"summaryDocx":true,"deepReadDocx":true,"summaryMd":true,"deepReadMd":true}',
    noteExportConflictStrategy: "skip",
    noteExportSuppressDirectoryPrompt: false,
    onboardingTutorialSeenVersion: "",
  };

  // 遍历所有配置项,确保每项都有有效值
  for (const [key, defaultValue] of Object.entries(defaults)) {
    try {
      // 读取当前配置值
      const currentValue = getPref(key as any);

      // 特殊处理:检查提示词是否需要升级
      if (key === "summaryPrompt") {
        const currentPromptVersion = getPref("promptVersion" as any) as
          | number
          | undefined;
        const currentPrompt = currentValue as string | undefined;

        // 如果提示词版本过时,自动升级到最新版本
        if (shouldUpdatePrompt(currentPromptVersion, currentPrompt)) {
          setPref("summaryPrompt" as any, defaultValue);
          setPref("promptVersion" as any, PROMPT_VERSION);
          continue;
        }
      }

      // 如果配置项不存在,设置默认值
      if (currentValue === undefined || currentValue === null) {
        setPref(key as any, defaultValue);
      }
      // 如果配置项为空字符串,也重置为默认值
      else if (
        typeof defaultValue === "string" &&
        typeof currentValue === "string" &&
        !currentValue.trim()
      ) {
        setPref(key as any, defaultValue);
      }
    } catch (error) {
      // 配置读取失败时记录错误
      ztoolkit.log(`[AI-Butler] 启动时初始化配置失败: ${key}`, error);

      // 尝试强制设置默认值
      try {
        setPref(key as any, defaultValue);
      } catch (e) {
        ztoolkit.log(`[AI-Butler] 启动时强制设置配置失败: ${key}`, e);
      }
    }
  }

  LLMEndpointManager.getEndpoints();
}

/**
 * 统一打开 AI 管家仪表盘
 *
 * 工具栏 🤖 与右键菜单“AI 管家仪表盘”必须共用同一入口，
 * 避免不同入口落到不同面板或不同状态上下文。
 */
async function openAIButlerDashboardFromUnifiedEntry(): Promise<void> {
  const mainWin = MainWindow.getInstance();
  await mainWin.open("dashboard");
}

const UI_CUSTOMIZATION_CHANGED_EVENT = "ai-butler-ui-customization-changed";

const CONTEXT_MENU_DOM_IDS: Record<ContextMenuItemId, string> = {
  generateSummary: "zotero-itemmenu-ai-butler-summary",
  multiRoundReanalyze: "zotero-itemmenu-ai-butler-multi-round",
  dashboard: "zotero-itemmenu-ai-butler-dashboard",
  imageSummary: "zotero-itemmenu-ai-butler-image-summary",
  mindmap: "zotero-itemmenu-ai-butler-mindmap",
  chatWithAI: "zotero-itemmenu-ai-butler-chat",
  literatureReview: "zotero-collectionmenu-ai-butler-literature-review",
  clearCollectionAiNotes:
    "zotero-collectionmenu-ai-butler-clear-collection-ai-notes",
  exportCollectionNotes: "zotero-collectionmenu-ai-butler-export-notes",
};

type ContextMenuScope = "item" | "collection";
type ContextMenuDefinition = {
  scope: ContextMenuScope;
  options: any;
};

const CONTEXT_MENU_ROOT_DOM_IDS: Record<ContextMenuScope, string> = {
  item: "zotero-itemmenu-ai-butler-root",
  collection: "zotero-collectionmenu-ai-butler-root",
};

function unregisterContextMenuItems(menu: {
  unregister?: (menuId: string) => void;
}): void {
  if (typeof menu.unregister !== "function") return;
  for (const menuId of Object.values(CONTEXT_MENU_ROOT_DOM_IDS)) {
    menu.unregister(menuId);
  }
  for (const item of CONTEXT_MENU_ITEMS) {
    menu.unregister(CONTEXT_MENU_DOM_IDS[item.id]);
  }
}

async function isContextMenuOptionVisible(
  option: any,
  ev: Event,
): Promise<boolean> {
  try {
    if (option.hidden) return false;
    if (typeof option.isHidden === "function") {
      return (await option.isHidden(undefined, ev)) !== true;
    }
    if (typeof option.getVisibility === "function") {
      return (await option.getVisibility(undefined, ev)) !== false;
    }
    return true;
  } catch (error) {
    ztoolkit.log("[AI-Butler] 判断右键菜单项可见性失败:", error);
    return false;
  }
}

export function refreshAIButlerContextMenuItems(): void {
  registerContextMenuItem();
}

function bindUICustomizationRefreshEvent(win: Window): void {
  const flagKey = "__aiButlerUICustomizationRefreshBound";
  if ((win as any)[flagKey]) return;
  (win as any)[flagKey] = true;

  win.addEventListener(UI_CUSTOMIZATION_CHANGED_EVENT, () => {
    refreshAIButlerContextMenuItems();
  });
}

function showAIButlerToast(
  text: string,
  type: "default" | "success" | "error" | "warning" = "default",
  closeTime: number = 3000,
): void {
  new ztoolkit.ProgressWindow("AI Butler", {
    closeOnClick: true,
    closeTime,
  })
    .createLine({ text, type })
    .show();
}

async function pickFolderPath(title: string): Promise<string | null> {
  const { pickFolder } = await import("./modules/folderPicker");
  return pickFolder(title);
}

function createModalButton(
  doc: Document,
  label: string,
  color: string,
): HTMLButtonElement {
  const button = doc.createElement("button");
  button.type = "button";
  button.textContent = label;
  Object.assign(button.style, {
    minWidth: "92px",
    border: `1px solid ${color}`,
    borderRadius: "5px",
    padding: "7px 12px",
    background: color,
    color: "#fff",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: "600",
  });
  return button;
}

function createModalShell(title: string): {
  doc: Document;
  win: Window;
  overlay: HTMLElement;
  body: HTMLElement;
  actions: HTMLElement;
  close: () => void;
} {
  const doc = Zotero.getMainWindow().document;
  const win = doc.defaultView || Zotero.getMainWindow();
  const overlay = doc.createElement("div");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    background: "rgba(0, 0, 0, 0.35)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: "2147483647",
  });

  const panel = doc.createElement("div");
  Object.assign(panel.style, {
    width: "600px",
    maxWidth: "92vw",
    maxHeight: "88vh",
    overflow: "auto",
    borderRadius: "8px",
    background: "var(--ai-surface, #fff)",
    color: "var(--ai-text, #222)",
    boxShadow: "0 14px 40px rgba(0, 0, 0, 0.28)",
    padding: "20px",
    border: "1px solid rgba(128, 128, 128, 0.24)",
  });
  overlay.appendChild(panel);

  const heading = doc.createElement("div");
  heading.textContent = title;
  Object.assign(heading.style, {
    fontSize: "18px",
    fontWeight: "700",
    marginBottom: "14px",
  });
  panel.appendChild(heading);

  const body = doc.createElement("div");
  Object.assign(body.style, {
    display: "grid",
    gap: "12px",
    fontSize: "13px",
    lineHeight: "1.55",
  });
  panel.appendChild(body);

  const actions = doc.createElement("div");
  Object.assign(actions.style, {
    display: "flex",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: "10px",
    marginTop: "18px",
    paddingTop: "14px",
    borderTop: "1px solid rgba(128, 128, 128, 0.18)",
  });
  panel.appendChild(actions);

  const parent = doc.body || doc.documentElement;
  if (!parent) {
    throw new Error(getString("dialog-error-create-confirmation-failed"));
  }
  parent.appendChild(overlay);

  return {
    doc,
    win,
    overlay,
    body,
    actions,
    close: () => overlay.remove(),
  };
}

function truncateForDialog(value: string, maxLength: number = 42): string {
  return value.length > maxLength
    ? `${value.slice(0, maxLength - 3)}...`
    : value;
}

function getPlanTotalNotes(plan: CollectionAiNoteCleanPlan): number {
  return plan.notes.length;
}

function getRegenerationCounts(
  plan: CollectionAiNoteCleanPlan,
): Record<RegeneratableAiNoteType, number> {
  const counts: Record<RegeneratableAiNoteType, number> = {
    summary: 0,
    deepRead: 0,
    imageSummary: 0,
    mindmap: 0,
    tableFill: 0,
  };

  for (const itemPlan of plan.itemPlans) {
    for (const type of itemPlan.types) {
      if (!isRegeneratableDialogType(type)) continue;
      counts[type] += 1;
    }
  }

  return counts;
}

function isRegeneratableDialogType(
  type: CleanableAiNoteType,
): type is RegeneratableAiNoteType {
  return (
    type === "summary" ||
    type === "imageSummary" ||
    type === "mindmap" ||
    type === "tableFill"
  );
}

function getCleanTypeLabel(type: CleanableAiNoteType): string {
  return CollectionAiNoteCleaner.getTypeLabel(type);
}

function formatLocalizedList(parts: string[]): string {
  return parts.join(getString("collection-clean-list-separator"));
}

function formatCleanScope(plan: CollectionAiNoteCleanPlan): string {
  if (plan.scope === "summary") {
    return getString("collection-clean-scope-summary");
  }

  return plan.includeChat
    ? getString("collection-clean-scope-all-with-chat")
    : getString("collection-clean-scope-all");
}

function formatPlanTypeCounts(plan: CollectionAiNoteCleanPlan): string {
  const parts = (Object.keys(plan.counts) as CleanableAiNoteType[])
    .filter((type) => plan.counts[type] > 0)
    .map((type) =>
      getString("collection-clean-plan-type-count", {
        args: { count: plan.counts[type], type: getCleanTypeLabel(type) },
      }),
    );
  return formatLocalizedList(parts);
}

function formatRegenerationCounts(plan: CollectionAiNoteCleanPlan): string {
  const counts = getRegenerationCounts(plan);
  const parts = [
    counts.summary > 0
      ? getString("collection-clean-regen-summary-count", {
          args: { count: counts.summary },
        })
      : "",
    counts.imageSummary > 0
      ? getString("collection-clean-regen-image-count", {
          args: { count: counts.imageSummary },
        })
      : "",
    counts.mindmap > 0
      ? getString("collection-clean-regen-mindmap-count", {
          args: { count: counts.mindmap },
        })
      : "",
    counts.tableFill > 0
      ? getString("collection-clean-regen-table-count", {
          args: { count: counts.tableFill },
        })
      : "",
  ].filter(Boolean);

  return parts.length > 0
    ? formatLocalizedList(parts)
    : getString("collection-clean-regen-none");
}

function formatNonRegeneratableCleanCounts(
  plan: CollectionAiNoteCleanPlan,
): string {
  const chatCount = plan.counts.chat || 0;
  return chatCount > 0
    ? getString("collection-clean-chat-not-regenerated", {
        args: { count: chatCount },
      })
    : "";
}

function buildPlanExamples(plan: CollectionAiNoteCleanPlan): string[] {
  return plan.itemPlans.slice(0, 3).map((itemPlan) => {
    const typeText = formatLocalizedList(
      itemPlan.types.map((type) => getCleanTypeLabel(type)),
    );
    return getString("collection-clean-plan-example", {
      args: { title: truncateForDialog(itemPlan.itemTitle), types: typeText },
    });
  });
}

function showCollectionCleanChoiceDialog(collectionName: string): Promise<{
  scope: CollectionAiNoteCleanScope;
  includeChat: boolean;
  action: CollectionAiNoteCleanAction;
} | null> {
  return new Promise((resolve) => {
    const { doc, overlay, body, actions, close } = createModalShell(
      getString("collection-clean-dialog-title"),
    );
    let settled = false;
    const finish = (
      value: {
        scope: CollectionAiNoteCleanScope;
        includeChat: boolean;
        action: CollectionAiNoteCleanAction;
      } | null,
    ) => {
      if (settled) return;
      settled = true;
      close();
      resolve(value);
    };

    const message = doc.createElement("div");
    message.textContent = getString("collection-clean-choice-message", {
      args: { collection: collectionName },
    });
    Object.assign(message.style, {
      color: "var(--ai-text-muted, #555)",
      lineHeight: "1.6",
    });
    body.appendChild(message);

    const scopeWrap = doc.createElement("div");
    Object.assign(scopeWrap.style, {
      display: "grid",
      gap: "10px",
    });

    const options: Array<{
      value: CollectionAiNoteCleanScope;
      label: string;
      checked: boolean;
    }> = [
      {
        value: "summary",
        label: getString("collection-clean-option-summary-title"),
        checked: true,
      },
      {
        value: "all",
        label: getString("collection-clean-option-all-title"),
        checked: false,
      },
    ];
    for (const option of options) {
      const label = doc.createElement("label");
      Object.assign(label.style, {
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gap: "10px",
        alignItems: "start",
        padding: "11px 12px",
        border: option.checked
          ? "1px solid rgba(89, 192, 188, 0.68)"
          : "1px solid rgba(128, 128, 128, 0.22)",
        borderRadius: "7px",
        background: option.checked
          ? "rgba(89, 192, 188, 0.1)"
          : "rgba(128, 128, 128, 0.04)",
        cursor: "pointer",
      });
      const input = doc.createElement("input");
      input.type = "radio";
      input.name = "ai-butler-clean-scope";
      input.value = option.value;
      input.checked = option.checked;
      Object.assign(input.style, {
        marginTop: "2px",
      });
      label.appendChild(input);

      const textWrap = doc.createElement("div");
      const title = doc.createElement("div");
      title.textContent = option.label;
      Object.assign(title.style, {
        fontWeight: "650",
        color: "var(--ai-text, #222)",
      });
      const desc = doc.createElement("div");
      desc.textContent =
        option.value === "summary"
          ? getString("collection-clean-option-summary-description")
          : getString("collection-clean-option-all-description");
      Object.assign(desc.style, {
        marginTop: "3px",
        fontSize: "12px",
        color: "var(--ai-text-muted, #666)",
        lineHeight: "1.45",
      });
      textWrap.appendChild(title);
      textWrap.appendChild(desc);
      label.appendChild(textWrap);
      scopeWrap.appendChild(label);

      input.addEventListener("change", () => {
        updateChoiceLayout();
      });
    }
    body.appendChild(scopeWrap);

    const chatRow = doc.createElement("label");
    Object.assign(chatRow.style, {
      display: "none",
      gridTemplateColumns: "auto 1fr",
      gap: "10px",
      alignItems: "start",
      padding: "10px 12px",
      borderRadius: "7px",
      border: "1px dashed rgba(194, 65, 12, 0.42)",
      background: "rgba(194, 65, 12, 0.07)",
      cursor: "pointer",
    });
    const chatCheckbox = doc.createElement("input");
    chatCheckbox.type = "checkbox";
    chatCheckbox.id = "ai-butler-clean-chat-records";
    chatCheckbox.checked = false;
    Object.assign(chatCheckbox.style, {
      marginTop: "2px",
    });
    const chatText = doc.createElement("div");
    const chatTitle = doc.createElement("div");
    chatTitle.textContent = getString("collection-clean-chat-title");
    Object.assign(chatTitle.style, {
      fontWeight: "650",
      color: "var(--ai-text, #222)",
    });
    const chatDesc = doc.createElement("div");
    chatDesc.textContent = getString("collection-clean-chat-description");
    Object.assign(chatDesc.style, {
      marginTop: "3px",
      fontSize: "12px",
      color: "var(--ai-text-muted, #666)",
      lineHeight: "1.45",
    });
    chatText.appendChild(chatTitle);
    chatText.appendChild(chatDesc);
    chatRow.appendChild(chatCheckbox);
    chatRow.appendChild(chatText);
    body.appendChild(chatRow);

    const cancelBtn = createModalButton(
      doc,
      getString("dialog-button-cancel"),
      "#8a8f98",
    );
    const confirmBtn = createModalButton(
      doc,
      getString("dialog-button-confirm"),
      "#d97706",
    );
    const regenBtn = createModalButton(
      doc,
      getString("collection-clean-button-delete-and-regenerate"),
      "#c2410c",
    );
    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    actions.appendChild(regenBtn);

    const getScope = (): CollectionAiNoteCleanScope => {
      const selected = body.querySelector(
        'input[name="ai-butler-clean-scope"]:checked',
      ) as HTMLInputElement | null;
      return selected?.value === "all" ? "all" : "summary";
    };
    const getChoice = (action: CollectionAiNoteCleanAction) => {
      const scope = getScope();
      return {
        scope,
        includeChat: scope === "all" && chatCheckbox.checked,
        action,
      };
    };
    const updateChoiceLayout = () => {
      const scope = getScope();
      chatRow.style.display = scope === "all" ? "grid" : "none";
      const rows = scopeWrap.querySelectorAll("label");
      rows.forEach((row: Element) => {
        const input = row.querySelector("input") as HTMLInputElement | null;
        Object.assign((row as HTMLElement).style, {
          border:
            input?.checked === true
              ? "1px solid rgba(89, 192, 188, 0.68)"
              : "1px solid rgba(128, 128, 128, 0.22)",
          background:
            input?.checked === true
              ? "rgba(89, 192, 188, 0.1)"
              : "rgba(128, 128, 128, 0.04)",
        });
      });
    };

    cancelBtn.addEventListener("click", () => finish(null));
    confirmBtn.addEventListener("click", () => finish(getChoice("delete")));
    regenBtn.addEventListener("click", () =>
      finish(getChoice("deleteAndRegenerate")),
    );
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(null);
    });
    updateChoiceLayout();
  });
}

function showDelayedConfirmDialog(params: {
  title: string;
  message: string;
  details: string[];
  confirmLabel: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const { doc, win, overlay, body, actions, close } = createModalShell(
      params.title,
    );
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      close();
      resolve(value);
    };

    const message = doc.createElement("div");
    message.textContent = params.message;
    Object.assign(message.style, { fontWeight: "600" });
    body.appendChild(message);

    const list = doc.createElement("ul");
    Object.assign(list.style, {
      margin: "0",
      paddingLeft: "18px",
      display: "grid",
      gap: "5px",
    });
    for (const detail of params.details) {
      const item = doc.createElement("li");
      item.textContent = detail;
      list.appendChild(item);
    }
    body.appendChild(list);

    const warning = doc.createElement("div");
    warning.textContent = getString("dialog-warning-irreversible");
    Object.assign(warning.style, {
      padding: "9px 10px",
      borderRadius: "6px",
      background: "rgba(220, 38, 38, 0.1)",
      color: "#b91c1c",
      fontWeight: "600",
    });
    body.appendChild(warning);

    const cancelBtn = createModalButton(
      doc,
      getString("dialog-button-cancel"),
      "#8a8f98",
    );
    const confirmBtn = createModalButton(
      doc,
      `${params.confirmLabel} (1)`,
      "#dc2626",
    );
    confirmBtn.disabled = true;
    Object.assign(confirmBtn.style, {
      opacity: "0.58",
      cursor: "not-allowed",
    });
    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);

    win.setTimeout(() => {
      if (settled) return;
      confirmBtn.disabled = false;
      confirmBtn.textContent = params.confirmLabel;
      Object.assign(confirmBtn.style, {
        opacity: "1",
        cursor: "pointer",
      });
    }, 1000);

    cancelBtn.addEventListener("click", () => finish(false));
    confirmBtn.addEventListener("click", () => {
      if (!confirmBtn.disabled) finish(true);
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(false);
    });
  });
}

function buildFinalConfirmDetails(
  plan: CollectionAiNoteCleanPlan,
  action: CollectionAiNoteCleanAction,
): string[] {
  const details = [
    getString("collection-clean-confirm-detail-scope", {
      args: { scope: formatCleanScope(plan) },
    }),
    getString("collection-clean-confirm-detail-found", {
      args: {
        scanned: plan.scannedItemCount,
        notes: getPlanTotalNotes(plan),
        counts: formatPlanTypeCounts(plan),
      },
    }),
    getString("collection-clean-confirm-detail-clear-queue"),
  ];
  const nonRegeneratableText = formatNonRegeneratableCleanCounts(plan);
  if (nonRegeneratableText) {
    details.push(nonRegeneratableText);
  }

  if (action === "deleteAndRegenerate") {
    details.push(
      getString("collection-clean-confirm-detail-regenerate", {
        args: { counts: formatRegenerationCounts(plan) },
      }),
    );
    details.push(getString("collection-clean-confirm-detail-token-cost"));
  }

  const examples = buildPlanExamples(plan);
  if (examples.length > 0) {
    details.push(
      getString("collection-clean-confirm-detail-examples", {
        args: {
          examples: examples.join(
            getString("collection-clean-example-separator"),
          ),
        },
      }),
    );
  }

  return details;
}

async function maybeOpenTaskPanelAfterQueue(): Promise<void> {
  if (getPref("openTaskPanelOnSummon") !== true) {
    return;
  }

  const mainWin = MainWindow.getInstance();
  await mainWin.open("tasks");
  try {
    mainWin.getTaskQueueView().refresh();
  } catch (e) {
    ztoolkit.log("[AI-Butler] 刷新任务队列视图失败:", e);
  }
}

/**
 * 注册右键上下文菜单项
 *
 * 在 Zotero 文献列表的右键菜单中添加插件功能入口
 * 用户可以通过右键选中的文献条目快速生成 AI 总结
 *
 * 菜单配置:
 * - 显示条件:仅当选中的是常规条目(非附件、笔记等)时显示
 * - 点击行为:调用 AI 总结生成流程
 * - 视觉样式:显示插件图标和国际化文本
 *
 * 技术实现:
 * - 使用 ztoolkit.Menu API 注册菜单项
 * - getVisibility 动态控制菜单项的显示状态
 * - commandListener 处理用户点击事件
 */
function registerContextMenuItem() {
  // 获取插件图标路径,用于菜单项显示
  const menuIcon = `chrome://${config.addonRef}/content/icons/favicon.png`;
  const menu = (ztoolkit as any).Menu as {
    register: (scope: ContextMenuScope, options: any) => void;
    unregister?: (menuId: string) => void;
  };

  unregisterContextMenuItems(menu);

  const isRegularItemSelection = () => {
    const selectedItems = Zotero.getActiveZoteroPane().getSelectedItems();
    return (
      selectedItems?.every((item: Zotero.Item) => item.isRegularItem()) || false
    );
  };

  const menuDefinitions: Record<ContextMenuItemId, ContextMenuDefinition> = {
    generateSummary: {
      scope: "item",
      options: {
        tag: "menuitem",
        id: CONTEXT_MENU_DOM_IDS.generateSummary,
        label: getString("menuitem-generateSummary"),
        icon: menuIcon,
        commandListener: (_ev: Event) => {
          handleGenerateSummary();
        },
        getVisibility: () =>
          isContextMenuItemEnabled("generateSummary") &&
          isRegularItemSelection(),
      },
    },
    multiRoundReanalyze: {
      scope: "item",
      options: {
        tag: "menuitem",
        id: CONTEXT_MENU_DOM_IDS.multiRoundReanalyze,
        label: getString("menuitem-multiRoundReanalyze"),
        icon: menuIcon,
        commandListener: () => handleMultiRoundSummary(),
        getVisibility: () =>
          isContextMenuItemEnabled("multiRoundReanalyze") &&
          isRegularItemSelection(),
      },
    },
    dashboard: {
      scope: "item",
      options: {
        tag: "menuitem",
        id: CONTEXT_MENU_DOM_IDS.dashboard,
        label: getString("menuitem-dashboard"),
        icon: menuIcon,
        commandListener: async (_ev: Event) => {
          await openAIButlerDashboardFromUnifiedEntry();
        },
        getVisibility: () => isContextMenuItemEnabled("dashboard"),
      },
    },
    imageSummary: {
      scope: "item",
      options: {
        tag: "menuitem",
        id: CONTEXT_MENU_DOM_IDS.imageSummary,
        label: getString("menuitem-imageSummary"),
        icon: menuIcon,
        commandListener: async () => {
          await handleImageSummary();
        },
        getVisibility: () =>
          isContextMenuItemEnabled("imageSummary") && isRegularItemSelection(),
      },
    },
    mindmap: {
      scope: "item",
      options: {
        tag: "menuitem",
        id: CONTEXT_MENU_DOM_IDS.mindmap,
        label: getString("menuitem-mindmap"),
        icon: menuIcon,
        commandListener: async () => {
          await handleMindmapGeneration();
        },
        getVisibility: () =>
          isContextMenuItemEnabled("mindmap") && isRegularItemSelection(),
      },
    },
    chatWithAI: {
      scope: "item",
      options: {
        tag: "menuitem",
        id: CONTEXT_MENU_DOM_IDS.chatWithAI,
        label: getString("menuitem-chatWithAI"),
        icon: menuIcon,
        commandListener: async () => {
          const selectedItems = Zotero.getActiveZoteroPane().getSelectedItems();
          const item = selectedItems?.[0];
          if (item?.isRegularItem()) {
            await handleOpenAIChat(item.id);
          }
        },
        getVisibility: () =>
          isContextMenuItemEnabled("chatWithAI") &&
          Zotero.getActiveZoteroPane().getSelectedItems()?.length === 1 &&
          isRegularItemSelection(),
      },
    },
    literatureReview: {
      scope: "collection",
      options: {
        tag: "menuitem",
        id: CONTEXT_MENU_DOM_IDS.literatureReview,
        label: getString("menuitem-literatureReview"),
        icon: menuIcon,
        commandListener: async () => {
          await handleLiteratureReview();
        },
        getVisibility: () => isContextMenuItemEnabled("literatureReview"),
      },
    },
    clearCollectionAiNotes: {
      scope: "collection",
      options: {
        tag: "menuitem",
        id: CONTEXT_MENU_DOM_IDS.clearCollectionAiNotes,
        label: getString("menuitem-clearCollectionAiNotes"),
        icon: menuIcon,
        commandListener: async () => {
          await handleClearCollectionAiNotes();
        },
        getVisibility: () => isContextMenuItemEnabled("clearCollectionAiNotes"),
      },
    },
    exportCollectionNotes: {
      scope: "collection",
      options: {
        tag: "menuitem",
        id: CONTEXT_MENU_DOM_IDS.exportCollectionNotes,
        label: getString("collection-export-menuitem"),
        icon: menuIcon,
        commandListener: async () => {
          await handleExportCollectionNotes();
        },
        getVisibility: () => isContextMenuItemEnabled("exportCollectionNotes"),
      },
    },
  };

  const orderedDefinitions = getContextMenuItemOrder()
    .map((itemId) => menuDefinitions[itemId])
    .filter((definition): definition is ContextMenuDefinition =>
      Boolean(definition),
    );

  if (isContextMenuCollapsed()) {
    for (const scope of ["item", "collection"] as const) {
      const children = orderedDefinitions
        .filter((definition) => definition.scope === scope)
        .map((definition) => definition.options);
      if (!children.length) continue;

      menu.register(scope, {
        tag: "menu",
        id: CONTEXT_MENU_ROOT_DOM_IDS[scope],
        label: getString("menu-root-ai-butler"),
        icon: menuIcon,
        children,
        getVisibility: async (_elem: XUL.Menu, ev: Event) => {
          for (const child of children) {
            if (await isContextMenuOptionVisible(child, ev)) return true;
          }
          return false;
        },
      });
    }
    return;
  }

  for (const definition of orderedDefinitions) {
    menu.register(definition.scope, definition.options);
  }
}

/**
 * 注册文献库工具栏按钮
 *
 * 在 Zotero 主窗口的文献库工具栏中添加"AI 管家"按钮
 * 用户点击后可以打开 AI 管家主界面
 *
 * 技术实现:
 * - 在 onMainWindowLoad 时创建按钮并添加到工具栏
 * - 使用唯一 ID 防止重复创建
 * - 点击后打开 AI 管家仪表盘
 */
function registerLibraryToolbarButton(win: Window) {
  try {
    const doc = win.document;
    const buttonId = "ai-butler-library-toolbar-btn";

    // 若已存在旧按钮，先移除后重建，确保与右键入口绑定到同一逻辑
    const existing = doc.getElementById(buttonId);
    if (existing) {
      existing.remove();
    }

    // 获取 Zotero 工具栏区域
    // zotero-items-toolbar 是文献列表上方的工具栏
    const toolbar = doc.getElementById("zotero-items-toolbar");
    if (!toolbar) {
      ztoolkit.log("[AI-Butler] 找不到文献库工具栏");
      return;
    }

    // 创建按钮容器
    const buttonContainer = doc.createXULElement("hbox") as XULElement;
    buttonContainer.id = buttonId;
    buttonContainer.setAttribute("align", "center");
    (buttonContainer as any).style.cssText = `
      margin-left: 4px;
      margin-right: 4px;
    `;

    // 创建按钮
    const button = doc.createXULElement("toolbarbutton") as XULElement;
    button.setAttribute("label", "🤖");
    button.setAttribute("tooltiptext", getString("library-toolbar-ai-butler"));
    button.setAttribute("class", "zotero-tb-button");
    (button as any).style.cssText = `
      font-size: 16px;
      cursor: pointer;
    `;

    // 点击事件
    button.addEventListener("click", async () => {
      try {
        await openAIButlerDashboardFromUnifiedEntry();
      } catch (error: any) {
        ztoolkit.log("[AI-Butler] 打开 AI 管家失败:", error);
        new ztoolkit.ProgressWindow("AI Butler", {
          closeOnClick: true,
          closeTime: 3000,
        })
          .createLine({
            text: getString("reader-toolbar-error-open-failed", {
              args: { error: error.message || error },
            }),
            type: "error",
          })
          .show();
      }
    });

    buttonContainer.appendChild(button);
    toolbar.appendChild(buttonContainer);

    ztoolkit.log("[AI-Butler] 文献库工具栏按钮已添加");
  } catch (error) {
    ztoolkit.log("[AI-Butler] 注册文献库工具栏按钮失败:", error);
  }
}

/**

 * 注册 PDF 阅读器工具栏按钮
 *
 * 在 PDF 阅读器顶部工具栏中添加"AI 追问"按钮
 * 用户点击后可以快速打开 AI 追问界面
 *
 * 技术实现:
 * - 使用 Zotero.Reader.registerEventListener("renderToolbar") API
 * - 动态注入按钮到工具栏
 * - 点击后获取当前文献并打开追问窗口
 * - 同时处理已打开的 Reader（插件启动时）
 */
function registerReaderToolbarButton() {
  const pluginID = config.addonID;

  /**
   * 创建并返回工具栏按钮
   */
  const createToolbarButton = (doc: Document, reader: any) => {
    // 创建按钮容器
    const buttonContainer = doc.createElement("div");
    buttonContainer.className = "ai-butler-toolbar-container";
    buttonContainer.style.cssText = `
      display: flex;
      align-items: center;
      margin-left: 8px;
    `;

    // 创建按钮 - 使用图标而非文字以适应窄工具栏
    const button = doc.createElement("button");
    button.className = "toolbar-button ai-butler-reader-chat-btn";
    button.innerHTML = `🤖`;
    button.title = getString("reader-toolbar-chat-title");
    button.style.cssText = `
      padding: 4px 8px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font-size: 16px;
      transition: all 0.2s ease;
    `;

    // 悬停效果
    button.addEventListener("mouseenter", () => {
      button.style.background = "rgba(0, 0, 0, 0.08)";
    });
    button.addEventListener("mouseleave", () => {
      button.style.background = "transparent";
    });

    // 点击事件
    button.addEventListener("click", async () => {
      try {
        const readerItem = reader._item;
        if (!readerItem) {
          new ztoolkit.ProgressWindow("AI Butler", {
            closeOnClick: true,
            closeTime: 3000,
          })
            .createLine({
              text: getString("reader-toolbar-error-no-item"),
              type: "error",
            })
            .show();
          return;
        }

        // 获取正确的父条目 ID
        // reader._item 可能是 PDF 附件，也可能是父条目
        let targetItemId: number;
        if (readerItem.isAttachment()) {
          // 是附件，获取父条目 ID
          const parentId = readerItem.parentItemID;
          if (!parentId) {
            new ztoolkit.ProgressWindow("AI Butler", {
              closeOnClick: true,
              closeTime: 3000,
            })
              .createLine({
                text: getString("reader-toolbar-error-no-parent"),
                type: "error",
              })
              .show();
            return;
          }
          targetItemId = parentId;
        } else {
          // 是父条目，直接使用
          targetItemId = readerItem.id;
        }

        await handleOpenAIChat(targetItemId);
      } catch (error: any) {
        ztoolkit.log("[AI-Butler] Reader 工具栏按钮点击失败:", error);
        new ztoolkit.ProgressWindow("AI Butler", {
          closeOnClick: true,
          closeTime: 3000,
        })
          .createLine({
            text: getString("reader-toolbar-error-open-failed", {
              args: { error: error.message || error },
            }),
            type: "error",
          })
          .show();
      }
    });

    buttonContainer.appendChild(button);
    return buttonContainer;
  };

  try {
    // 注册事件监听器，处理新打开的 Reader
    (Zotero as any).Reader.registerEventListener(
      "renderToolbar",
      (event: any) => {
        const { reader, doc, append } = event;
        const buttonContainer = createToolbarButton(doc, reader);
        append(buttonContainer);
      },
      pluginID,
    );

    // 处理已打开的 Reader（插件启动时）
    // 延迟执行，确保 Zotero.Reader._readers 已经初始化
    setTimeout(() => {
      try {
        const readers = (Zotero as any).Reader._readers || [];
        for (const reader of readers) {
          if (!reader?._iframeWindow?.document) continue;
          const doc = reader._iframeWindow.document;
          const toolbar = doc.querySelector(".toolbar");
          if (!toolbar) continue;

          // 检查是否已经添加过按钮
          if (toolbar.querySelector(".ai-butler-toolbar-container")) continue;

          // 创建并添加按钮
          const buttonContainer = createToolbarButton(doc, reader);
          toolbar.appendChild(buttonContainer);
        }
        ztoolkit.log(
          `[AI-Butler] 已为 ${readers.length} 个已打开的 Reader 添加工具栏按钮`,
        );
      } catch (err) {
        ztoolkit.log("[AI-Butler] 处理已打开的 Reader 失败:", err);
      }
    }, 1000);

    ztoolkit.log("[AI-Butler] Reader 工具栏按钮已注册");
  } catch (error) {
    ztoolkit.log("[AI-Butler] 注册 Reader 工具栏按钮失败:", error);
  }
}

/**
 * 注册条目面板自定义区块
 *
 * 在 Zotero 右侧条目面板中添加"AI 追问"区块
 * 提供两个入口：完整追问（保存记录）和快速提问（临时）
 *
 * 技术实现:
 * - 使用 Zotero.ItemPaneManager.registerSection() API
 * - 区块显示当前文献状态和操作按钮
 * - 内嵌临时聊天功能
 *
 * 已重构到 modules/ItemPaneSection.ts
 */
async function registerItemPaneSection() {
  try {
    const { registerItemPaneSection: registerSection } =
      await import("./modules/ItemPaneSection");
    registerSection(handleOpenAIChat);
  } catch (error) {
    ztoolkit.log("[AI-Butler] 注册条目面板区块失败:", error);
  }
}

/**
 * 打开 AI 追问界面
 *
 * 统一的入口函数,用于从 Reader 工具栏按钮或条目面板打开追问界面
 *
 * @param itemId 文献条目 ID
 */
async function handleOpenAIChat(itemId: number): Promise<void> {
  try {
    // 打开主窗口并切换到摘要视图
    const mainWin = MainWindow.getInstance();
    await mainWin.open("summary");

    // 获取 SummaryView 并加载文献
    const summaryView = mainWin.getSummaryView();
    if (summaryView) {
      // 调用 loadItemForChat 方法加载文献并显示聊天界面
      await (summaryView as any).loadItemForChat(itemId);
    }
  } catch (error: any) {
    ztoolkit.log("[AI-Butler] 打开 AI 追问失败:", error);
    new ztoolkit.ProgressWindow("AI Butler", {
      closeOnClick: true,
      closeTime: 3000,
    })
      .createLine({
        text: getString("chat-open-error", {
          args: { error: error.message || error },
        }),
        type: "error",
      })
      .show();
  }
}

/**
 * 处理生成 AI 总结的核心逻辑
 *
 * 当用户通过右键菜单触发时执行,负责协调整个总结生成流程
 *
 * 执行流程:
 * 1. 验证 API 配置完整性
 * 2. 获取用户选中的文献条目
 * 3. 创建进度反馈窗口
 * 4. 调用笔记生成器逐个处理文献
 * 5. 实时更新处理进度和状态
 * 6. 汇总并展示最终结果
 *
 * 错误处理:
 * - API 未配置:提示用户前往设置
 * - 未选中条目:提示用户先选择文献
 * - 处理失败:记录详细错误信息供调试
 *
 * 用户体验优化:
 * - 提供实时进度反馈
 * - 区分成功和失败的条目
 * - 汇总显示批量处理统计
 */
async function handleGenerateSummary() {
  // 第一步:验证 API 配置
  // 新版本以用户配置的 endpoint 列表作为主路由来源。
  let enabledEndpoints = LLMEndpointManager.getEnabledEndpoints();
  let hasUsableEndpoint = enabledEndpoints.some((endpoint) =>
    LLMEndpointManager.isEndpointUsable(endpoint),
  );
  if (!hasUsableEndpoint) {
    LLMEndpointManager.syncLegacyPrimaryEndpointFromPrefs();
    enabledEndpoints = LLMEndpointManager.getEnabledEndpoints();
    hasUsableEndpoint = enabledEndpoints.some((endpoint) =>
      LLMEndpointManager.isEndpointUsable(endpoint),
    );
  }

  if (!hasUsableEndpoint) {
    const endpointDetails =
      enabledEndpoints.length > 0
        ? enabledEndpoints
            .map((endpoint) => {
              const missing = LLMEndpointManager.validateEndpoint(endpoint);
              return getString("summary-endpoint-missing-line", {
                args: {
                  name: endpoint.name,
                  provider: LLMEndpointManager.providerLabel(
                    endpoint.providerType,
                  ),
                  missing:
                    missing.join(", ") ||
                    getString("summary-endpoint-missing-unknown"),
                },
              });
            })
            .join("\n")
        : getString("summary-endpoint-none-enabled");
    // API 未配置,显示友好的错误提示
    new ztoolkit.ProgressWindow("AI Butler", {
      closeOnClick: true,
      closeTime: 5000, // 5秒后自动关闭
    })
      .createLine({
        text: getString("summary-error-no-usable-endpoint", {
          args: { details: endpointDetails },
        }),
        type: "error",
      })
      .show();
    return;
  }

  // 第二步:获取用户选中的文献条目
  const items = Zotero.getActiveZoteroPane().getSelectedItems();

  if (items.length === 0) {
    // 未选中任何条目,提示用户
    new ztoolkit.ProgressWindow("AI Butler", {
      closeOnClick: true,
      closeTime: 3000,
    })
      .createLine({
        text: getString("summary-error-no-items"),
        type: "error",
      })
      .show();
    return;
  }

  // 第三步:单篇优先入队，多选按普通队列遵守批次设置
  const progressWin = new ztoolkit.ProgressWindow("AI Butler", {
    closeOnClick: true,
    closeTime: 4000,
  });

  try {
    const manager = TaskQueueManager.getInstance();
    const priority = items.length === 1;
    await manager.addTasks(items, priority);
    await maybeOpenTaskPanelAfterQueue();

    progressWin
      .createLine({
        text: priority
          ? getString("summary-queue-priority-added")
          : getString("summary-queue-normal-added", {
              args: { count: items.length },
            }),
        type: "success",
      })
      .show();
  } catch (error: any) {
    ztoolkit.log("[AI-Butler] 入队失败:", error);
    progressWin
      .createLine({
        text: getString("summary-queue-failed", {
          args: { error: error.message || error },
        }),
        type: "error",
      })
      .show();
  }
}

/**
 * 主窗口卸载钩子函数
 *
 * 当 Zotero 主窗口关闭时执行清理操作
 * 确保插件不会留下内存泄漏或无效的资源引用
 *
 * 清理内容:
 * - 注销所有注册的UI组件(菜单项、工具栏按钮等)
 * - 关闭所有打开的对话框窗口
 *
 * @param win 即将卸载的窗口对象
 * @returns Promise<void> 清理完成的承诺
 */
async function onMainWindowUnload(win: Window): Promise<void> {
  // 移除文献库工具栏按钮
  try {
    const button = win.document.getElementById("ai-butler-library-toolbar-btn");
    if (button) {
      button.remove();
    }
  } catch (e) {
    // 忽略清理错误
  }

  // 注销所有工具包注册的UI组件
  // 包括菜单项、键盘快捷键、工具栏按钮等
  ztoolkit.unregisterAll();

  // 关闭插件创建的对话框窗口
  // 防止窗口对象悬空导致内存泄漏
  addon.data.dialog?.window?.close();
}

/**
 * 插件关闭钩子函数
 *
 * 当插件完全关闭或被禁用时执行
 * 执行全面的资源清理和状态重置
 *
 * 清理内容:
 * 1. 注销所有注册的UI组件
 * 2. 关闭所有打开的窗口
 * 3. 标记插件为非活动状态
 * 4. 从 Zotero 全局对象中移除插件实例
 *
 * 注意事项:
 * - 此函数执行后,插件将完全停止运行
 * - 所有插件功能将不可用
 * - 需要重启 Zotero 才能重新加载插件
 */
function onShutdown(): void {
  AutoNoteExportManager.getInstance().stop();

  // 注销文献库 AI 精读状态列和相关监听
  unregisterLibraryStatusColumn();

  // 注销所有UI组件
  ztoolkit.unregisterAll();

  // 关闭对话框窗口
  addon.data.dialog?.window?.close();

  // 标记插件为非活动状态
  // 其他代码可以通过检查此标志判断插件是否还在运行
  addon.data.alive = false;

  // 从 Zotero 全局对象中移除插件实例
  // 确保插件对象不会被错误地访问
  // @ts-expect-error - Zotero 全局对象的插件实例属性未在类型定义中声明
  delete Zotero[addon.data.config.addonInstance];
}

/**
 * Zotero 通知事件处理器
 *
 * 响应 Zotero 内部事件,如条目创建、修改、删除等
 * 当前为占位实现,预留给未来功能扩展
 *
 * 可能的应用场景:
 * - 监听新条目添加,自动触发总结生成
 * - 监听条目修改,更新相关笔记
 * - 监听条目删除,清理相关资源
 *
 * @param event 事件类型(add, modify, delete等)
 * @param type 对象类型(item, collection等)
 * @param ids 受影响对象的ID数组
 * @param extraData 附加数据
 * @returns Promise<void> 事件处理完成的承诺
 */
async function onNotify(
  event: string,
  type: string,
  ids: Array<string | number>,
  extraData: { [key: string]: any },
) {
  // 预留给未来的自动化功能
  // 例如:自动检测新添加的文献并生成总结
}

/**
 * 偏好设置事件处理器
 *
 * 响应偏好设置面板的加载和交互事件
 * 负责初始化设置界面和处理用户配置变更
 *
 * @param type 事件类型(load, change等)
 * @param data 事件数据,包含窗口对象等信息
 * @returns Promise<void> 事件处理完成的承诺
 */
async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      // 偏好设置窗口加载完成
      // 注册设置脚本,绑定UI事件和数据
      registerPrefsScripts(data.window);
      break;
    default:
      // 其他事件暂不处理
      return;
  }
}

/**
 * 快捷键事件处理器
 *
 * 响应用户定义的键盘快捷键
 * 当前为占位实现,预留给未来功能
 *
 * 可能的应用场景:
 * - 快捷键快速生成当前选中文献的总结
 * - 快捷键打开插件设置面板
 * - 快捷键显示历史总结记录
 *
 * @param type 快捷键类型或标识
 */
function onShortcuts(type: string) {
  // 预留给快捷键功能
}
/**
 * 处理一图总结请求
 *
 * 为选中的文献条目生成学术概念海报图片并保存到笔记中
 */
async function handleImageSummary() {
  // 1. 获取选中条目
  const items = Zotero.getActiveZoteroPane().getSelectedItems();
  if (!items || items.length === 0) {
    new ztoolkit.ProgressWindow("AI Butler", {
      closeOnClick: true,
      closeTime: 3000,
    })
      .createLine({
        text: getString("task-error-no-paper-selected"),
        type: "error",
      })
      .show();
    return;
  }

  // 只处理第一个选中的条目
  const item = items[0];
  if (!item.isRegularItem()) {
    new ztoolkit.ProgressWindow("AI Butler", {
      closeOnClick: true,
      closeTime: 3000,
    })
      .createLine({
        text: getString("task-error-select-regular-item"),
        type: "error",
      })
      .show();
    return;
  }

  try {
    // 添加到任务队列
    const { TaskQueueManager } = await import("./modules/taskQueue");
    const manager = TaskQueueManager.getInstance();
    await manager.addImageSummaryTask(item);

    // 显示开始提示
    new ztoolkit.ProgressWindow("AI Butler", {
      closeOnClick: true,
      closeTime: 3000,
    })
      .createLine({
        text: getString("image-summary-queue-added"),
        type: "success",
      })
      .show();
  } catch (error: any) {
    ztoolkit.log("[AI-Butler] 添加一图总结任务失败:", error);
    new ztoolkit.ProgressWindow("AI Butler", {
      closeOnClick: true,
      closeTime: 5000,
    })
      .createLine({
        text: getString("task-queue-add-failed", {
          args: { error: error.message || error },
        }),
        type: "error",
      })
      .show();
  }
}

/**
 * 处理思维导图生成请求
 *
 * 为选中的文献条目生成思维导图并保存到笔记中
 */
async function handleMindmapGeneration() {
  // 1. 获取选中条目
  const items = Zotero.getActiveZoteroPane().getSelectedItems();
  if (!items || items.length === 0) {
    new ztoolkit.ProgressWindow("AI Butler", {
      closeOnClick: true,
      closeTime: 3000,
    })
      .createLine({
        text: getString("task-error-no-paper-selected"),
        type: "error",
      })
      .show();
    return;
  }

  // 只处理第一个选中的条目
  const item = items[0];
  if (!item.isRegularItem()) {
    new ztoolkit.ProgressWindow("AI Butler", {
      closeOnClick: true,
      closeTime: 3000,
    })
      .createLine({
        text: getString("task-error-select-regular-item"),
        type: "error",
      })
      .show();
    return;
  }

  try {
    // 添加到任务队列
    const { TaskQueueManager } = await import("./modules/taskQueue");
    const manager = TaskQueueManager.getInstance();
    await manager.addMindmapTask(item);

    // 显示开始提示
    new ztoolkit.ProgressWindow("AI Butler", {
      closeOnClick: true,
      closeTime: 3000,
    })
      .createLine({
        text: getString("mindmap-queue-added"),
        type: "success",
      })
      .show();
  } catch (error: any) {
    ztoolkit.log("[AI-Butler] 添加思维导图任务失败:", error);
    new ztoolkit.ProgressWindow("AI Butler", {
      closeOnClick: true,
      closeTime: 5000,
    })
      .createLine({
        text: getString("task-queue-add-failed", {
          args: { error: error.message || error },
        }),
        type: "error",
      })
      .show();
  }
}

/**
 * 处理文献综述生成

 *
 * 当用户在分类上右键点击"AI管家文献综述"时触发
 * 获取当前选中的分类，打开综述配置界面
 */
async function handleLiteratureReview() {
  try {
    // 获取当前选中的分类
    const zoteroPane = Zotero.getActiveZoteroPane();
    const collection = zoteroPane.getSelectedCollection();

    if (!collection) {
      new ztoolkit.ProgressWindow("AI Butler", {
        closeOnClick: true,
        closeTime: 3000,
      })
        .createLine({
          text: getString("collection-error-no-collection"),
          type: "error",
        })
        .show();
      return;
    }

    // 打开主窗口并切换到文献综述视图
    const mainWin = MainWindow.getInstance();
    await mainWin.open("literature-review");

    // 获取综述视图并设置当前分类
    const reviewView = mainWin.getLiteratureReviewView();
    if (reviewView) {
      await reviewView.setCollection(collection);
    }
  } catch (error: any) {
    ztoolkit.log("[AI-Butler] 打开文献综述失败:", error);
    new ztoolkit.ProgressWindow("AI Butler", {
      closeOnClick: true,
      closeTime: 5000,
    })
      .createLine({
        text: getString("literature-review-open-failed", {
          args: { error: error.message || error },
        }),
        type: "error",
      })
      .show();
  }
}

/**
 * 清空当前分类及子分类中的 AI 管家笔记，可选择按原类型重新入普通队列。
 */
async function handleClearCollectionAiNotes() {
  try {
    const zoteroPane = Zotero.getActiveZoteroPane();
    const collection = zoteroPane.getSelectedCollection();

    if (!collection) {
      showAIButlerToast(getString("collection-error-no-collection"), "error");
      return;
    }

    const choice = await showCollectionCleanChoiceDialog(collection.name);
    if (!choice) return;

    showAIButlerToast(
      getString("collection-clean-toast-scanning"),
      "default",
      1800,
    );
    const plan = await CollectionAiNoteCleaner.inspectCollection(
      collection,
      choice.scope,
      { includeChat: choice.includeChat },
    );

    if (plan.notes.length === 0) {
      showAIButlerToast(
        getString("collection-clean-toast-none-found", {
          args: { collection: collection.name },
        }),
        "warning",
        3500,
      );
      return;
    }

    const confirmed = await showDelayedConfirmDialog({
      title:
        choice.action === "deleteAndRegenerate"
          ? getString("collection-clean-confirm-title-regenerate")
          : getString("collection-clean-confirm-title-delete"),
      message:
        choice.action === "deleteAndRegenerate"
          ? getString("collection-clean-confirm-message-regenerate")
          : getString("collection-clean-confirm-message-delete"),
      details: buildFinalConfirmDetails(plan, choice.action),
      confirmLabel:
        choice.action === "deleteAndRegenerate"
          ? getString("collection-clean-confirm-label-regenerate")
          : getString("collection-clean-confirm-label-delete"),
    });
    if (!confirmed) return;

    const result = await CollectionAiNoteCleaner.applyPlan(plan, choice.action);
    const queuedText =
      choice.action === "deleteAndRegenerate"
        ? getString("collection-clean-toast-queued", {
            args: { counts: formatRegenerationCounts(plan) },
          })
        : "";
    const failedText =
      result.failedDeletes > 0
        ? getString("collection-clean-toast-failed-deletes", {
            args: { count: result.failedDeletes },
          })
        : "";

    showAIButlerToast(
      getString("collection-clean-toast-complete", {
        args: {
          deleted: result.deletedNotes,
          tasks: result.clearedTasks,
          queued: queuedText,
          failed: failedText,
        },
      }),
      result.failedDeletes > 0 ? "warning" : "success",
      5200,
    );
  } catch (error: any) {
    ztoolkit.log("[AI-Butler] Failed to clear collection AI notes:", error);
    showAIButlerToast(
      getString("collection-clean-toast-failed", {
        args: { error: error.message || error },
      }),
      "error",
      5000,
    );
  }
}

type CollectionExportDialogChoice = {
  rootPath: string;
  suppressDirectoryPrompt: boolean;
  addToAutoWatch: boolean;
  conflictStrategy: "skip" | "overwrite";
};

async function handleExportCollectionNotes() {
  try {
    const collection = Zotero.getActiveZoteroPane().getSelectedCollection();
    if (!collection) {
      showAIButlerToast(getString("collection-error-no-collection"), "error");
      return;
    }

    const { getNoteExportConfig, setNoteExportConfig, addWatchedCollection } =
      await import("./modules/noteExportConfig");
    const { NoteExportService } = await import("./modules/noteExportService");
    const config = getNoteExportConfig();
    let rootPath = config.rootPath;
    let conflictStrategy = config.conflictStrategy;

    if (!rootPath || !config.suppressDirectoryPrompt) {
      const choice = await showCollectionExportDialog(collection.name, config);
      if (!choice) return;
      rootPath = choice.rootPath;
      conflictStrategy = choice.conflictStrategy;
      setNoteExportConfig({
        rootPath,
        conflictStrategy,
        suppressDirectoryPrompt: choice.suppressDirectoryPrompt,
      });
      if (choice.addToAutoWatch) {
        addWatchedCollection(collection.id);
        showAIButlerToast(
          getString("collection-export-toast-auto-watch-added"),
          "success",
          2200,
        );
      }
    }

    const progressWindow = new ztoolkit.ProgressWindow(
      getString("collection-export-progress-title"),
      {
        closeOnClick: true,
        closeTime: 6000,
      },
    );
    progressWindow
      .createLine({
        text: getString("collection-export-progress-start", {
          args: { collection: collection.name },
        }),
        type: "default",
      })
      .show();

    const result = await NoteExportService.exportCollection({
      collection,
      rootPath,
      conflictStrategy,
      config: { ...config, rootPath, conflictStrategy },
    });

    showAIButlerToast(
      getString("collection-export-toast-complete", {
        args: {
          exportedItems: result.exportedItems,
          skippedItems: result.skippedItems,
          failedItems: result.failedItems,
          exportedFiles: result.exportedFiles,
          skippedFiles: result.skippedFiles,
        },
      }),
      result.failedItems > 0 ? "warning" : "success",
      7000,
    );
    if (result.warnings.length) {
      ztoolkit.log(
        "[AI-Butler][NoteExport] 分类导出警告/失败详情:",
        result.warnings,
      );
      showAIButlerToast(
        getString("collection-export-toast-warnings", {
          args: {
            details: result.warnings
              .slice(0, 2)
              .join(getString("collection-clean-list-separator")),
            more:
              result.warnings.length > 2
                ? getString("collection-export-toast-warnings-more")
                : "",
          },
        }),
        "warning",
        9000,
      );
    }
  } catch (error: any) {
    ztoolkit.log("[AI-Butler] 分类 AI 笔记导出失败:", error);
    showAIButlerToast(
      getString("collection-export-toast-failed", {
        args: { error: error?.message || error },
      }),
      "error",
      7000,
    );
  }
}

function showCollectionExportDialog(
  collectionName: string,
  config: {
    rootPath: string;
    conflictStrategy: "skip" | "overwrite";
  },
): Promise<CollectionExportDialogChoice | null> {
  return new Promise((resolve) => {
    const shell = createModalShell(getString("collection-export-dialog-title"));
    const { doc, body, actions, close } = shell;

    Object.assign(body.style, {
      gap: "16px",
      color: "#1f2937",
    });
    Object.assign(actions.style, {
      marginTop: "22px",
      paddingTop: "18px",
      borderTop: "1px solid #e5e7eb",
    });

    const descriptionCard = doc.createElement("div");
    Object.assign(descriptionCard.style, {
      display: "flex",
      gap: "12px",
      alignItems: "flex-start",
      padding: "14px 16px",
      borderRadius: "12px",
      background: "linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%)",
      border: "1px solid #dbeafe",
    });
    const descriptionIcon = doc.createElement("div");
    descriptionIcon.textContent = "📦";
    Object.assign(descriptionIcon.style, {
      width: "32px",
      height: "32px",
      borderRadius: "10px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#dbeafe",
      fontSize: "17px",
      flex: "0 0 auto",
    });
    const descriptionText = doc.createElement("div");
    descriptionText.innerHTML = getString(
      "collection-export-dialog-description",
      {
        args: { collection: escapeHtmlForDialog(collectionName) },
      },
    );
    Object.assign(descriptionText.style, {
      fontSize: "13px",
      lineHeight: "1.65",
      color: "#334155",
    });
    descriptionCard.appendChild(descriptionIcon);
    descriptionCard.appendChild(descriptionText);
    body.appendChild(descriptionCard);

    const directorySection = doc.createElement("div");
    Object.assign(directorySection.style, {
      display: "grid",
      gap: "8px",
    });
    const directoryLabel = doc.createElement("div");
    directoryLabel.textContent = getString("collection-export-directory-label");
    Object.assign(directoryLabel.style, {
      fontSize: "12px",
      fontWeight: "700",
      color: "#475569",
      letterSpacing: "0.02em",
    });
    const pathRow = doc.createElement("div");
    Object.assign(pathRow.style, {
      display: "flex",
      gap: "10px",
      alignItems: "center",
    });
    const pathInput = doc.createElement("input");
    pathInput.type = "text";
    pathInput.value = config.rootPath || "";
    pathInput.placeholder = getString(
      "collection-export-directory-placeholder",
    );
    Object.assign(pathInput.style, {
      flex: "1",
      minWidth: "0",
      height: "38px",
      boxSizing: "border-box",
      padding: "0 12px",
      border: "1px solid #cbd5e1",
      borderRadius: "10px",
      outline: "none",
      background: "#fff",
      boxShadow: "inset 0 1px 2px rgba(15, 23, 42, 0.04)",
      fontSize: "13px",
      lineHeight: "38px",
    });
    pathInput.addEventListener("focus", () => {
      pathInput.style.borderColor = "#3b82f6";
      pathInput.style.boxShadow = "0 0 0 3px rgba(59, 130, 246, 0.16)";
    });
    pathInput.addEventListener("blur", () => {
      pathInput.style.borderColor = "#cbd5e1";
      pathInput.style.boxShadow = "inset 0 1px 2px rgba(15, 23, 42, 0.04)";
    });
    const browseButton = createModalButton(
      doc,
      getString("collection-export-button-browse"),
      "#2563eb",
    );
    Object.assign(browseButton.style, {
      height: "38px",
      boxSizing: "border-box",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "0 0 auto",
      borderRadius: "10px",
      padding: "0 18px",
      lineHeight: "1",
      boxShadow: "0 6px 14px rgba(37, 99, 235, 0.2)",
    });
    browseButton.addEventListener("click", async () => {
      try {
        const selected = await pickFolderPath(
          getString("collection-export-folder-picker-title"),
        );
        if (selected) pathInput.value = selected;
      } catch (error) {
        ztoolkit.log("[AI-Butler] Failed to choose export directory:", error);
        showAIButlerToast(
          getString("collection-export-toast-browse-failed"),
          "error",
        );
      }
    });
    pathRow.appendChild(pathInput);
    pathRow.appendChild(browseButton);
    directorySection.appendChild(directoryLabel);
    directorySection.appendChild(pathRow);
    body.appendChild(directorySection);

    const optionsCard = doc.createElement("div");
    Object.assign(optionsCard.style, {
      display: "grid",
      gap: "10px",
      padding: "12px 14px",
      borderRadius: "12px",
      background: "#f8fafc",
      border: "1px solid #e2e8f0",
    });
    const suppressLabel = createDialogCheckbox(
      doc,
      getString("collection-export-option-suppress-directory-prompt"),
      false,
    );
    styleExportDialogCheckbox(suppressLabel.wrapper, suppressLabel.checkbox);
    optionsCard.appendChild(suppressLabel.wrapper);
    const watchLabel = createDialogCheckbox(
      doc,
      getString("collection-export-option-auto-watch"),
      false,
    );
    styleExportDialogCheckbox(watchLabel.wrapper, watchLabel.checkbox);
    optionsCard.appendChild(watchLabel.wrapper);
    body.appendChild(optionsCard);

    const strategyCard = doc.createElement("div");
    Object.assign(strategyCard.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "12px",
      padding: "12px 14px",
      borderRadius: "12px",
      background: "#fff",
      border: "1px solid #e5e7eb",
    });
    const strategyText = doc.createElement("div");
    strategyText.textContent = getString("collection-export-conflict-label");
    Object.assign(strategyText.style, {
      fontSize: "13px",
      color: "#334155",
      fontWeight: "600",
    });
    const strategySelect = doc.createElement("select");
    for (const [value, label] of [
      ["skip", getString("collection-export-conflict-skip")],
      ["overwrite", getString("collection-export-conflict-overwrite")],
    ] as const) {
      const option = doc.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = value === config.conflictStrategy;
      strategySelect.appendChild(option);
    }
    Object.assign(strategySelect.style, {
      minWidth: "132px",
      height: "38px",
      boxSizing: "border-box",
      padding: "0 10px",
      border: "1px solid #cbd5e1",
      borderRadius: "9px",
      background: "#f8fafc",
      color: "#0f172a",
      fontSize: "13px",
      fontWeight: "600",
      lineHeight: "38px",
    });
    strategyCard.appendChild(strategyText);
    strategyCard.appendChild(strategySelect);
    body.appendChild(strategyCard);

    const cancelButton = createModalButton(
      doc,
      getString("dialog-button-cancel"),
      "#9ca3af",
    );
    Object.assign(cancelButton.style, {
      height: "32px",
      boxSizing: "border-box",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      borderColor: "#9ca3af",
      background: "#9ca3af",
      borderRadius: "9px",
      padding: "0 18px",
      lineHeight: "1",
    });
    cancelButton.addEventListener("click", () => {
      close();
      resolve(null);
    });
    const confirmButton = createModalButton(
      doc,
      getString("collection-export-button-start"),
      "#16a34a",
    );
    Object.assign(confirmButton.style, {
      height: "32px",
      boxSizing: "border-box",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      borderColor: "#16a34a",
      background: "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)",
      borderRadius: "9px",
      padding: "0 20px",
      lineHeight: "1",
      boxShadow: "0 6px 14px rgba(22, 163, 74, 0.2)",
    });
    confirmButton.addEventListener("click", () => {
      const rootPath = pathInput.value.trim();
      if (!rootPath) {
        showAIButlerToast(
          getString("collection-export-toast-directory-required"),
          "warning",
        );
        return;
      }
      close();
      resolve({
        rootPath,
        suppressDirectoryPrompt: suppressLabel.checkbox.checked,
        addToAutoWatch: watchLabel.checkbox.checked,
        conflictStrategy:
          strategySelect.value === "overwrite" ? "overwrite" : "skip",
      });
    });
    actions.appendChild(cancelButton);
    actions.appendChild(confirmButton);
  });
}

function styleExportDialogCheckbox(
  wrapper: HTMLLabelElement,
  checkbox: HTMLInputElement,
): void {
  Object.assign(wrapper.style, {
    gap: "10px",
    padding: "6px 4px",
    color: "#334155",
    fontSize: "13px",
    cursor: "pointer",
  });
  Object.assign(checkbox.style, {
    width: "15px",
    height: "15px",
    accentColor: "#2563eb",
    cursor: "pointer",
  });
}

function escapeHtmlForDialog(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function createDialogCheckbox(
  doc: Document,
  label: string,
  checked: boolean,
): { wrapper: HTMLLabelElement; checkbox: HTMLInputElement } {
  const wrapper = doc.createElement("label");
  Object.assign(wrapper.style, {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  });
  const checkbox = doc.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = checked;
  wrapper.appendChild(checkbox);
  wrapper.appendChild(doc.createTextNode(label));
  return { wrapper, checkbox };
}

/**
 * 处理填表请求
 *
 * 当用户在文献右键点击"AI管家填表"时触发
 * 为选中文献的 PDF 附件进行填表
 */
async function handleFillTable() {
  if (!isTableFeatureEnabled()) {
    new ztoolkit.ProgressWindow("AI Butler", {
      closeOnClick: true,
      closeTime: 3000,
    })
      .createLine({
        text: getString("table-fill-disabled"),
        type: "default",
      })
      .show();
    return;
  }

  const items = Zotero.getActiveZoteroPane().getSelectedItems();
  if (!items || items.length === 0) {
    new ztoolkit.ProgressWindow("AI Butler", {
      closeOnClick: true,
      closeTime: 3000,
    })
      .createLine({
        text: getString("table-fill-error-no-items"),
        type: "error",
      })
      .show();
    return;
  }

  try {
    const { TaskQueueManager } = await import("./modules/taskQueue");
    const manager = TaskQueueManager.getInstance();

    for (const item of items) {
      if (!item.isRegularItem()) continue;
      await manager.addTableFillTask(item);
    }

    // 打开主窗口并切换到任务队列标签页
    const mainWin = MainWindow.getInstance();
    await mainWin.open("tasks");
    try {
      mainWin.getTaskQueueView().refresh();
    } catch (e) {
      ztoolkit.log("[AI-Butler] 刷新任务队列视图失败:", e);
    }

    new ztoolkit.ProgressWindow("AI Butler", {
      closeOnClick: true,
      closeTime: 4000,
    })
      .createLine({
        text: getString("table-fill-queue-added", {
          args: { count: items.length },
        }),
        type: "success",
      })
      .show();
  } catch (error: any) {
    ztoolkit.log("[AI-Butler] 填表失败:", error);
    new ztoolkit.ProgressWindow("AI Butler", {
      closeOnClick: true,
      closeTime: 5000,
    })
      .createLine({
        text: getString("table-fill-failed", {
          args: { error: error.message || error },
        }),
        type: "error",
      })
      .show();
  }
}

/**
 * 处理 AI 精读任务
 */
async function handleMultiRoundSummary() {
  // 1. 验证 API 配置 (简略版，主要依赖后续流程的检查)
  const provider =
    (Zotero.Prefs.get(`${config.prefsPrefix}.provider`, true) as string) ||
    "openai";

  // 2. 获取选中条目
  const items = Zotero.getActiveZoteroPane().getSelectedItems();
  if (!items || items.length === 0) {
    new ztoolkit.ProgressWindow("AI Butler", {
      closeOnClick: true,
      closeTime: 3000,
    })
      .createLine({
        text: getString("task-error-no-paper-selected"),
        type: "error",
      })
      .show();
    return;
  }

  // 3. 加入队列并强制覆盖
  try {
    const { TaskQueueManager } = await import("./modules/taskQueue");
    const taskQueue = TaskQueueManager.getInstance();
    const priority = items.length === 1;

    // 批量添加任务，遵守“已有 AI 总结 / AI 精读时的策略”。
    // 若设置为 skip 且已有完整 AI 精读，任务队列会跳过；若精读半成品，仍会补跑未完成轮次。
    for (const item of items) {
      await taskQueue.addDeepReadTask(item, priority, {
        summaryMode: "deepRead",
      });
    }

    new ztoolkit.ProgressWindow("AI Butler", {
      closeOnClick: true,
      closeTime: 3000,
    })
      .createLine({
        text: priority
          ? getString("deep-read-queue-priority-added")
          : getString("deep-read-queue-normal-added", {
              args: { count: items.length },
            }),
        type: "success",
      })
      .show();
  } catch (error: any) {
    ztoolkit.log("[AI Butler] 加入重分析队列失败:", error);
    new ztoolkit.ProgressWindow("AI Butler", {
      closeOnClick: true,
      closeTime: 5000,
    })
      .createLine({
        text: getString("queue-add-failed", {
          args: { error: error.message || error },
        }),
        type: "error",
      })
      .show();
  }
}

/**
 * 关于页面事件处理器
 *
 * 响应插件创建的对话框窗口的事件
 * 当前为占位实现,预留给未来的对话框交互
 *
 * @param type 对话框事件类型
 */
function onDialogEvents(type: string) {
  // 预留给对话框交互功能
}

/**
 * 导出插件生命周期钩子函数集合
 *
 * 这些函数会被插件框架在适当的时机自动调用
 * 开发者不需要手动调用这些函数
 */
export default {
  onStartup, // 插件启动
  onShutdown, // 插件关闭
  onMainWindowLoad, // 主窗口加载
  onMainWindowUnload, // 主窗口卸载
  onNotify, // 通知事件
  onPrefsEvent, // 偏好设置事件
  onShortcuts, // 快捷键事件
  onDialogEvents, // 对话框事件
};
