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
import { MainWindow } from "./modules/views/MainWindow";
import { AutoScanManager } from "./modules/autoScanManager";
import { config } from "../package.json";
import { getPref, setPref } from "./utils/prefs";
import {
  getDefaultSummaryPrompt,
  PROMPT_VERSION,
  shouldUpdatePrompt,
} from "./utils/prompts";

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

  // 启动自动扫描管理器
  const autoScanManager = AutoScanManager.getInstance();
  autoScanManager.start();

  // 标记插件初始化完成
  // 某些功能依赖此标志来判断插件是否已准备好
  addon.data.initialized = true;
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
    temperature: "0.7", // 默认温度参数,平衡创造性和准确性
    stream: true, // 默认启用流式输出,提供更好的用户体验
    summaryPrompt: getDefaultSummaryPrompt(), // 加载默认提示词模板
    promptVersion: PROMPT_VERSION, // 当前提示词版本号
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

  // 注册"生成AI总结"菜单项
  ztoolkit.Menu.register("item", {
    tag: "menuitem", // HTML 元素类型
    label: getString("menuitem-generateSummary"), // 国际化的菜单文本
    icon: menuIcon, // 菜单项图标

    // 点击事件监听器
    commandListener: (ev) => {
      handleGenerateSummary();
    },

    // 动态控制菜单项可见性
    // 仅当选中的所有条目都是常规条目时显示
    getVisibility: () => {
      const selectedItems = Zotero.getActiveZoteroPane().getSelectedItems();
      return (
        selectedItems?.every((item: Zotero.Item) => item.isRegularItem()) ||
        false
      );
    },
  });

  // 注册"AI 管家仪表盘"菜单项
  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    label: "AI 管家仪表盘",
    icon: menuIcon,

    commandListener: async (ev) => {
      const mainWin = MainWindow.getInstance();
      await mainWin.open("dashboard");
    },

    getVisibility: () => {
      return true; // 始终显示
    },
  });

  // 注册"AI 管家-后续追问"菜单项
  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    label: getString("menuitem-chatWithAI"),
    icon: menuIcon,

    commandListener: async (ev) => {
      await handleChatWithAI();
    },

    // 仅当选中单个 AI 笔记时显示
    getVisibility: () => {
      const selectedItems = Zotero.getActiveZoteroPane().getSelectedItems();
      if (!selectedItems || selectedItems.length !== 1) {
        return false;
      }

      const item = selectedItems[0];
      // 判断是否是 AI 笔记
      if (!item.isNote()) {
        return false;
      }

      const tags: Array<{ tag: string }> = (item as any).getTags?.() || [];
      const hasTag = tags.some((t: any) => t.tag === "AI-Generated");
      const noteHtml: string = (item as any).getNote?.() || "";
      const titleMatch = /<h2>\s*AI 管家\s*-/.test(noteHtml);

      return hasTag || titleMatch;
    },
  });
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
    button.title = "AI 管家 - 与 AI 对话讨论当前论文";
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
              text: "无法获取当前文献信息",
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
                text: "该 PDF 没有关联的父条目",
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
            text: `打开失败: ${error.message || error}`,
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
 */
function registerItemPaneSection() {
  const pluginID = config.addonID;

  // 存储侧边栏聊天状态
  let currentChatState: {
    itemId: number | null;
    pdfContent: string;
    isBase64: boolean;
    conversationHistory: Array<{ role: string; content: string }>;
    isChatting: boolean;
  } = {
    itemId: null,
    pdfContent: "",
    isBase64: false,
    conversationHistory: [],
    isChatting: false,
  };

  try {
    (Zotero as any).ItemPaneManager.registerSection({
      paneID: "ai-butler-chat-section",
      pluginID: pluginID,
      header: {
        l10nID: getLocaleID("itempane-ai-section-header" as any),
        icon: rootURI + "content/icons/icon24.png",
      },
      sidenav: {
        l10nID: getLocaleID("itempane-ai-section-sidenav" as any),
        icon: rootURI + "content/icons/icon24.png",
      },
      onRender: ({ body, item, editable, tabType }: any) => {
        // 清空已有内容
        body.innerHTML = "";
        const doc = body.ownerDocument;

        // 容器样式
        body.style.cssText = `
          padding: 10px;
          font-family: system-ui, -apple-system, sans-serif;
          font-size: 13px;
        `;

        // 检查是否有有效的文献条目
        if (!item || !item.isRegularItem()) {
          const hint = doc.createElement("div");
          hint.style.cssText = `
            color: #9e9e9e;
            font-size: 12px;
            text-align: center;
            padding: 12px;
          `;
          hint.textContent = getString("itempane-ai-no-item");
          body.appendChild(hint);
          return;
        }

        // 重置聊天状态（如果切换了条目）
        if (currentChatState.itemId !== item.id) {
          currentChatState = {
            itemId: item.id,
            pdfContent: "",
            isBase64: false,
            conversationHistory: [],
            isChatting: false,
          };
        }

        // ========== 按钮容器（放在笔记区域上方） ==========
        const btnContainer = doc.createElement("div");
        btnContainer.style.cssText = `
          display: flex;
          gap: 8px;
          margin-bottom: 10px;
        `;

        // 通用按钮样式函数
        const createButton = (text: string, isPrimary: boolean) => {
          const btn = doc.createElement("button");
          btn.textContent = text;
          btn.style.cssText = `
            flex: 1;
            padding: 8px 12px;
            border: ${isPrimary ? "none" : "1px solid #59c0bc"};
            border-radius: 4px;
            background: ${isPrimary ? "#59c0bc" : "transparent"};
            color: ${isPrimary ? "white" : "#59c0bc"};
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            transition: all 0.15s ease;
            display: flex;
            align-items: center;
            justify-content: center;
          `;
          btn.addEventListener("mouseenter", () => {
            if (isPrimary) {
              btn.style.background = "#4db6ac";
            } else {
              btn.style.background = "rgba(89, 192, 188, 0.1)";
            }
          });
          btn.addEventListener("mouseleave", () => {
            btn.style.background = isPrimary ? "#59c0bc" : "transparent";
          });
          return btn;
        };

        // 完整追问按钮
        const fullChatBtn = createButton(getString("itempane-ai-open-chat"), true);
        fullChatBtn.addEventListener("click", async () => {
          try {
            await handleOpenAIChat(item.id);
          } catch (error: any) {
            ztoolkit.log("[AI-Butler] 完整追问按钮点击失败:", error);
          }
        });

        // 快速提问按钮
        const quickChatBtn = createButton(getString("itempane-ai-temp-chat"), false);

        btnContainer.appendChild(fullChatBtn);
        btnContainer.appendChild(quickChatBtn);
        body.appendChild(btnContainer);

        // ========== AI 笔记展示区域 ==========
        const noteSection = doc.createElement("div");
        noteSection.className = "ai-butler-note-section";
        noteSection.style.cssText = `
          margin-bottom: 12px;
          border: 1px solid #e0e0e0;
          border-radius: 6px;
          overflow: hidden;
          background: white;
        `;

        // 笔记标题栏（可折叠）
        const noteHeader = doc.createElement("div");
        noteHeader.className = "ai-butler-note-header";
        noteHeader.style.cssText = `
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 10px;
          background: linear-gradient(135deg, #f8f9fa, #f0f2f4);
          cursor: pointer;
          user-select: none;
          border-bottom: 1px solid #e0e0e0;
        `;

        const noteTitle = doc.createElement("span");
        noteTitle.style.cssText = `
          font-weight: 500;
          font-size: 12px;
          color: #333;
          display: flex;
          align-items: center;
          gap: 6px;
        `;
        noteTitle.innerHTML = `📄 <span>AI 笔记</span>`;

        // 字体大小控制
        const fontSizeControl = doc.createElement("div");
        fontSizeControl.style.cssText = `
          display: flex;
          align-items: center;
          gap: 4px;
          margin-left: auto;
          margin-right: 8px;
        `;
        fontSizeControl.addEventListener("click", (e: Event) => e.stopPropagation()); // 防止触发折叠

        // 从设置加载字体大小，默认12px
        let currentFontSize = parseInt((getPref("sidebarNoteFontSize" as any) as string) || "12", 10);
        if (isNaN(currentFontSize) || currentFontSize < 10 || currentFontSize > 20) {
          currentFontSize = 12;
        }

        const fontSizeLabel = doc.createElement("span");
        fontSizeLabel.textContent = `${currentFontSize}px`;
        fontSizeLabel.style.cssText = `
          font-size: 10px;
          color: #666;
          min-width: 28px;
          text-align: center;
        `;

        const createFontBtn = (text: string, delta: number) => {
          const btn = doc.createElement("button");
          btn.textContent = text;
          btn.style.cssText = `
            width: 20px;
            height: 20px;
            border: 1px solid #ddd;
            border-radius: 3px;
            background: white;
            cursor: pointer;
            font-size: 12px;
            line-height: 1;
            color: #666;
            display: flex;
            align-items: center;
            justify-content: center;
          `;
          btn.addEventListener("mouseenter", () => {
            btn.style.background = "#f0f0f0";
          });
          btn.addEventListener("mouseleave", () => {
            btn.style.background = "white";
          });
          btn.addEventListener("click", () => {
            currentFontSize = Math.max(10, Math.min(20, currentFontSize + delta));
            fontSizeLabel.textContent = `${currentFontSize}px`;
            noteContent.style.fontSize = `${currentFontSize}px`;
            // 保存到设置
            setPref("sidebarNoteFontSize" as any, String(currentFontSize) as any);
          });
          return btn;
        };

        fontSizeControl.appendChild(createFontBtn("−", -1));
        fontSizeControl.appendChild(fontSizeLabel);
        fontSizeControl.appendChild(createFontBtn("+", 1));

        // 主题选择器
        const themeSelect = doc.createElement("select");
        themeSelect.style.cssText = `
          margin-left: 8px;
          padding: 2px 4px;
          font-size: 10px;
          border: 1px solid #ddd;
          border-radius: 3px;
          background: white;
          cursor: pointer;
          color: #666;
        `;
        themeSelect.addEventListener("click", (e: Event) => e.stopPropagation());

        // 添加内置主题选项
        const themes = [
          { id: "github", name: "GitHub" },
          { id: "redstriking", name: "红印" },
        ];
        const currentTheme = ((getPref("markdownTheme" as any) as string) || "github").toString();
        themes.forEach(t => {
          const opt = doc.createElement("option");
          opt.value = t.id;
          opt.textContent = t.name;
          if (t.id === currentTheme) opt.selected = true;
          themeSelect.appendChild(opt);
        });

        themeSelect.addEventListener("change", async () => {
          const newTheme = themeSelect.value;
          setPref("markdownTheme" as any, newTheme as any);
          // 重新加载主题
          const { themeManager } = await import("./modules/themeManager");
          themeManager.setCurrentTheme(newTheme);
          themeManager.clearCache();
          const themeCss = await themeManager.loadThemeCss();
          const adaptedCss = themeManager.adaptCssForSidebar(themeCss);
          let styleEl = doc.getElementById("ai-butler-note-theme") as HTMLStyleElement;
          if (styleEl) {
            styleEl.textContent = adaptedCss;
          }
        });
        fontSizeControl.appendChild(themeSelect);

        const toggleIcon = doc.createElement("span");
        toggleIcon.textContent = "▼";
        toggleIcon.style.cssText = `
          font-size: 10px;
          color: #666;
          transition: transform 0.2s ease;
        `;

        noteHeader.appendChild(noteTitle);
        noteHeader.appendChild(fontSizeControl);
        noteHeader.appendChild(toggleIcon);

        // 笔记内容区域（可滚动、可调高度）
        const DEFAULT_NOTE_HEIGHT = 200;
        let savedNoteHeight = parseInt((getPref("sidebarNoteHeight" as any) as string) || String(DEFAULT_NOTE_HEIGHT), 10);
        if (isNaN(savedNoteHeight) || savedNoteHeight < 50) {
          savedNoteHeight = DEFAULT_NOTE_HEIGHT;
        }

        const noteContentWrapper = doc.createElement("div");
        noteContentWrapper.className = "ai-butler-note-content-wrapper";
        noteContentWrapper.style.cssText = `
          position: relative;
          height: ${savedNoteHeight}px;
          min-height: 50px;
          overflow-y: auto;
          transition: height 0.2s ease;
        `;

        const noteContent = doc.createElement("div");
        noteContent.className = "ai-butler-note-content markdown-body";
        noteContent.style.cssText = `
          padding: 10px;
          padding-bottom: 20px;
          font-size: ${currentFontSize}px;
          line-height: 1.6;
        `;

        // 高度调节手柄（移到 wrapper 外面，固定在底部）
        const resizeHandle = doc.createElement("div");
        resizeHandle.className = "ai-butler-resize-handle";
        resizeHandle.style.cssText = `
          height: 10px;
          background: linear-gradient(to bottom, transparent, rgba(0,0,0,0.03));
          cursor: ns-resize;
          display: flex;
          justify-content: center;
          align-items: center;
          border-top: 1px solid #eee;
        `;
        resizeHandle.innerHTML = `<span style="width: 30px; height: 3px; background: #ccc; border-radius: 2px;"></span>`;

        // 拖拽调整高度
        let isResizing = false;
        let startY = 0;
        let startHeight = 0;

        resizeHandle.addEventListener("mousedown", (e: MouseEvent) => {
          isResizing = true;
          startY = e.clientY;
          startHeight = noteContentWrapper.offsetHeight;
          if (doc.body) doc.body.style.cursor = "ns-resize";
          e.preventDefault();
        });

        doc.addEventListener("mousemove", (e: MouseEvent) => {
          if (!isResizing) return;
          const deltaY = e.clientY - startY;
          // 最小50px，无上限
          const newHeight = Math.max(50, startHeight + deltaY);
          noteContentWrapper.style.height = `${newHeight}px`;
        });

        doc.addEventListener("mouseup", () => {
          if (isResizing) {
            isResizing = false;
            if (doc.body) doc.body.style.cursor = "";
            // 保存高度到设置
            const currentHeight = noteContentWrapper.offsetHeight;
            setPref("sidebarNoteHeight" as any, String(currentHeight) as any);
          }
        });

        // 阻止滚动冒泡到父级侧边栏
        noteContentWrapper.addEventListener("wheel", (e: WheelEvent) => {
          const { scrollTop, scrollHeight, clientHeight } = noteContentWrapper;
          const isAtTop = scrollTop === 0;
          const isAtBottom = scrollTop + clientHeight >= scrollHeight;

          // 如果在顶部往上滚或在底部往下滚，阻止冒泡
          if ((isAtTop && e.deltaY < 0) || (isAtBottom && e.deltaY > 0)) {
            e.preventDefault();
          }
          e.stopPropagation();
        }, { passive: false });

        noteContentWrapper.appendChild(noteContent);

        // 恢复默认高度按钮（添加到 fontSizeControl 旁边）
        const resetHeightBtn = doc.createElement("button");
        resetHeightBtn.textContent = "↕";
        resetHeightBtn.title = "恢复默认高度";
        resetHeightBtn.style.cssText = `
          width: 20px;
          height: 20px;
          border: 1px solid #ddd;
          border-radius: 3px;
          background: white;
          cursor: pointer;
          font-size: 12px;
          color: #666;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-left: 8px;
        `;
        resetHeightBtn.addEventListener("click", (e: Event) => {
          e.stopPropagation();
          savedNoteHeight = DEFAULT_NOTE_HEIGHT;
          noteContentWrapper.style.height = `${DEFAULT_NOTE_HEIGHT}px`;
          setPref("sidebarNoteHeight" as any, String(DEFAULT_NOTE_HEIGHT) as any);
        });
        resetHeightBtn.addEventListener("mouseenter", () => {
          resetHeightBtn.style.background = "#f0f0f0";
        });
        resetHeightBtn.addEventListener("mouseleave", () => {
          resetHeightBtn.style.background = "white";
        });
        fontSizeControl.appendChild(resetHeightBtn);

        // 折叠/展开功能
        let isCollapsed = false;
        noteHeader.addEventListener("click", () => {
          isCollapsed = !isCollapsed;
          if (isCollapsed) {
            noteContentWrapper.style.height = "0px";
            noteContentWrapper.style.overflow = "hidden";
            resizeHandle.style.display = "none";
            toggleIcon.style.transform = "rotate(-90deg)";
          } else {
            // 使用保存的高度
            const restoreHeight = parseInt((getPref("sidebarNoteHeight" as any) as string) || String(DEFAULT_NOTE_HEIGHT), 10);
            noteContentWrapper.style.height = `${restoreHeight}px`;
            noteContentWrapper.style.overflowY = "auto";
            resizeHandle.style.display = "flex";
            toggleIcon.style.transform = "rotate(0deg)";
          }
        });

        noteSection.appendChild(noteHeader);
        noteSection.appendChild(noteContentWrapper);
        noteSection.appendChild(resizeHandle);
        body.appendChild(noteSection);

        // 加载 AI 笔记内容
        (async () => {
          try {
            // 获取正确的父条目（如果当前是附件，则获取其父条目）
            let targetItem: any = item;
            if (item.isAttachment && item.isAttachment()) {
              const parentId = item.parentItemID;
              if (parentId) {
                targetItem = await Zotero.Items.getAsync(parentId);
              }
            }

            // 查找 AI 生成的笔记（参照 SummaryView 的检测逻辑）
            const noteIDs = (targetItem as any).getNotes?.() || [];
            let aiNoteContent = "";
            let aiNoteFound = false;
            let targetNote: any = null;

            for (const nid of noteIDs) {
              try {
                const n = await Zotero.Items.getAsync(nid);
                if (!n) continue;
                const tags: Array<{ tag: string }> = (n as any).getTags?.() || [];
                const noteHtml: string = (n as any).getNote?.() || "";

                // 检查是否是 AI-Butler 生成的摘要笔记（排除 Chat 笔记）
                const isChatNote =
                  tags.some((t) => t.tag === "AI-Butler-Chat") ||
                  /<h2>\s*AI 管家\s*-\s*后续追问\s*-/.test(noteHtml);
                const isAiSummaryNote =
                  tags.some((t) => t.tag === "AI-Generated") ||
                  (/<h2>\s*AI 管家\s*-/.test(noteHtml) && !isChatNote) ||
                  noteHtml.includes("[AI-Butler]");

                if (isAiSummaryNote) {
                  if (!targetNote) {
                    targetNote = n;
                  } else {
                    // 选择最新修改的笔记
                    const a = (targetNote as any).dateModified || 0;
                    const b = (n as any).dateModified || 0;
                    if (b > a) targetNote = n;
                  }
                }
              } catch (e) {
                continue;
              }
            }

            if (targetNote) {
              aiNoteContent = (targetNote as any).getNote?.() || "";
              aiNoteFound = true;
            }

            if (!aiNoteFound) {
              // 创建生成笔记按钮
              const generateBtn = doc.createElement("button");
              generateBtn.textContent = "🤖 召唤 AI 管家生成笔记";
              generateBtn.style.cssText = `
                width: 100%;
                padding: 10px;
                margin-top: 8px;
                border: none;
                border-radius: 4px;
                background: linear-gradient(135deg, #59c0bc, #4db6ac);
                color: white;
                cursor: pointer;
                font-size: 12px;
                font-weight: 500;
                transition: all 0.2s ease;
                display: flex;
                align-items: center;
                justify-content: center;
              `;
              generateBtn.addEventListener("mouseenter", () => {
                generateBtn.style.background = "linear-gradient(135deg, #4db6ac, #26a69a)";
              });
              generateBtn.addEventListener("mouseleave", () => {
                generateBtn.style.background = "linear-gradient(135deg, #59c0bc, #4db6ac)";
              });
              generateBtn.addEventListener("click", async () => {
                try {
                  generateBtn.disabled = true;
                  generateBtn.textContent = "正在加入队列...";
                  const { TaskQueueManager } = await import("./modules/taskQueue");
                  const queueManager = TaskQueueManager.getInstance();
                  await queueManager.addTask(item, true); // 优先处理
                  generateBtn.textContent = "✅ 已加入队列";
                  // 启动队列处理
                  queueManager.start();
                } catch (err: any) {
                  generateBtn.textContent = "❌ 失败: " + err.message;
                  generateBtn.disabled = false;
                }
              });

              noteContent.innerHTML = `
                <div style="text-align: center; color: #9e9e9e; padding: 16px;">
                  <div style="font-size: 24px; margin-bottom: 8px;">📝</div>
                  <div>暂无 AI 笔记</div>
                </div>
              `;
              noteContent.appendChild(generateBtn);
              return;
            }

            // 加载主题 CSS
            const { themeManager } = await import("./modules/themeManager");
            const themeCss = await themeManager.loadThemeCss();
            const adaptedCss = themeManager.adaptCssForSidebar(themeCss);

            // 注入样式（使用 body 或父元素，因为 XUL 文档没有 head）
            let styleEl = doc.getElementById("ai-butler-note-theme") as HTMLStyleElement;
            if (!styleEl) {
              styleEl = doc.createElement("style");
              styleEl.id = "ai-butler-note-theme";
              // 尝试添加到 body，如果不存在则添加到 noteSection
              const insertTarget = doc.body || doc.documentElement || noteSection;
              insertTarget.appendChild(styleEl);
            }
            styleEl.textContent = adaptedCss;

            // Zotero 笔记本身就是 HTML 格式（有 <h2>、<strong> 等标签）
            // 直接显示 HTML 内容并应用 CSS 样式即可
            noteContent.innerHTML = aiNoteContent;
          } catch (err: any) {
            ztoolkit.log("[AI-Butler] 加载笔记失败:", err);
            noteContent.innerHTML = `<div style="color: #d32f2f; padding: 10px;">加载笔记失败: ${err.message}</div>`;
          }
        })();

        // 内嵌聊天区域容器
        const chatArea = doc.createElement("div");
        chatArea.id = "ai-butler-inline-chat";
        chatArea.style.cssText = `
          display: none;
          flex-direction: column;
          border: 1px solid #e0e0e0;
          border-radius: 6px;
          overflow: hidden;
          background: #fafafa;
        `;

        // 聊天消息显示区
        const messagesArea = doc.createElement("div");
        messagesArea.style.cssText = `
          max-height: 200px;
          overflow-y: auto;
          padding: 8px;
          font-size: 12px;
          line-height: 1.5;
        `;

        // 输入区域
        const inputArea = doc.createElement("div");
        inputArea.style.cssText = `
          display: flex;
          gap: 6px;
          padding: 8px;
          border-top: 1px solid #e0e0e0;
          background: white;
        `;

        const inputBox = doc.createElement("textarea");
        inputBox.placeholder = "输入问题...";
        inputBox.style.cssText = `
          flex: 1;
          min-height: 36px;
          max-height: 80px;
          padding: 6px 8px;
          border: 1px solid #ddd;
          border-radius: 4px;
          resize: none;
          font-size: 12px;
          font-family: inherit;
        `;

        const sendBtn = doc.createElement("button");
        sendBtn.textContent = "发送";
        sendBtn.style.cssText = `
          padding: 6px 12px;
          background: #59c0bc;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          align-self: flex-end;
        `;

        // 发送消息处理
        const handleSend = async () => {
          const question = inputBox.value.trim();
          if (!question || currentChatState.isChatting) return;

          // 如果还没有加载 PDF 内容，先加载
          if (!currentChatState.pdfContent) {
            try {
              sendBtn.textContent = "加载中...";
              sendBtn.disabled = true;
              const { PDFExtractor } = await import("./modules/pdfExtractor");
              const prefMode = (getPref("pdfProcessMode") as string) || "base64";
              currentChatState.isBase64 = prefMode === "base64";

              if (currentChatState.isBase64) {
                currentChatState.pdfContent = await PDFExtractor.extractBase64FromItem(item);
              } else {
                currentChatState.pdfContent = await PDFExtractor.extractTextFromItem(item);
              }
            } catch (err: any) {
              messagesArea.innerHTML += `<div style="color: #d32f2f; padding: 4px 0;">❌ 无法加载 PDF: ${err.message}</div>`;
              sendBtn.textContent = "发送";
              sendBtn.disabled = false;
              return;
            }
          }

          currentChatState.isChatting = true;
          inputBox.value = "";
          sendBtn.textContent = "思考中...";
          sendBtn.disabled = true;

          // 显示用户消息
          messagesArea.innerHTML += `<div style="background: #e3f2fd; padding: 6px 8px; border-radius: 4px; margin-bottom: 6px;"><strong>👤 您:</strong> ${question}</div>`;
          messagesArea.scrollTop = messagesArea.scrollHeight;

          // 添加到历史
          currentChatState.conversationHistory.push({ role: "user", content: question });

          // 显示 AI 回复占位
          const aiMsgDiv = doc.createElement("div");
          aiMsgDiv.style.cssText = "background: #f5f5f5; padding: 6px 8px; border-radius: 4px; margin-bottom: 6px;";
          aiMsgDiv.innerHTML = "<strong>🤖 AI:</strong> <em>思考中...</em>";
          messagesArea.appendChild(aiMsgDiv);
          messagesArea.scrollTop = messagesArea.scrollHeight;

          try {
            const { default: LLMClient } = await import("./modules/llmClient");
            let fullResponse = "";

            await LLMClient.chat(
              currentChatState.pdfContent,
              currentChatState.isBase64,
              currentChatState.conversationHistory,
              (chunk: string) => {
                fullResponse += chunk;
                aiMsgDiv.innerHTML = `<strong>🤖 AI:</strong> ${fullResponse.substring(0, 500)}${fullResponse.length > 500 ? "..." : ""}`;
                messagesArea.scrollTop = messagesArea.scrollHeight;
              },
            );

            currentChatState.conversationHistory.push({ role: "assistant", content: fullResponse });
            aiMsgDiv.innerHTML = `<strong>🤖 AI:</strong> ${fullResponse}`;
          } catch (err: any) {
            aiMsgDiv.innerHTML = `<strong>🤖 AI:</strong> <span style="color: #d32f2f;">❌ 错误: ${err.message}</span>`;
            currentChatState.conversationHistory.pop(); // 移除失败的用户消息
          } finally {
            currentChatState.isChatting = false;
            sendBtn.textContent = "发送";
            sendBtn.disabled = false;
            messagesArea.scrollTop = messagesArea.scrollHeight;
          }
        };

        sendBtn.addEventListener("click", handleSend);
        inputBox.addEventListener("keydown", (e: KeyboardEvent) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        });

        inputArea.appendChild(inputBox);
        inputArea.appendChild(sendBtn);
        chatArea.appendChild(messagesArea);
        chatArea.appendChild(inputArea);
        body.appendChild(chatArea);

        // 快速提问按钮点击：显示/隐藏内嵌聊天
        quickChatBtn.addEventListener("click", () => {
          if (chatArea.style.display === "none") {
            chatArea.style.display = "flex";
            quickChatBtn.style.background = "rgba(89, 192, 188, 0.15)";
            quickChatBtn.style.borderColor = "#4db6ac";
            inputBox.focus();
          } else {
            chatArea.style.display = "none";
            quickChatBtn.style.background = "transparent";
            quickChatBtn.style.borderColor = "#59c0bc";
          }
        });
      },
    });

    ztoolkit.log("[AI-Butler] 条目面板区块已注册");
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
        text: `打开 AI 追问失败: ${error.message || error}`,
        type: "error",
      })
      .show();
  }
}

/**
 * 处理 AI 笔记的后续追问
 *
 * 当用户在 AI 笔记上右键点击"后续追问"时触发
 *
 * 执行流程:
 * 1. 获取选中的 AI 笔记
 * 2. 找到笔记对应的父文献条目
 * 3. 打开主窗口并切换到摘要视图
 * 4. 加载该文献的 AI 笔记并显示聊天界面
 *
 * 错误处理:
 * - 笔记无父条目:提示用户笔记已损坏
 * - 找不到父条目:提示用户数据异常
 */
async function handleChatWithAI() {
  try {
    const selectedItems = Zotero.getActiveZoteroPane().getSelectedItems();
    if (!selectedItems || selectedItems.length !== 1) {
      new ztoolkit.ProgressWindow("AI Butler", {
        closeOnClick: true,
        closeTime: 3000,
      })
        .createLine({
          text: "请选择一个 AI 笔记",
          type: "error",
        })
        .show();
      return;
    }

    const note = selectedItems[0];
    const parentItemID = (note as any).parentItemID;

    if (!parentItemID) {
      new ztoolkit.ProgressWindow("AI Butler", {
        closeOnClick: true,
        closeTime: 3000,
      })
        .createLine({
          text: "找不到笔记对应的文献条目",
          type: "error",
        })
        .show();
      return;
    }

    const parentItem = await Zotero.Items.getAsync(parentItemID);
    if (!parentItem) {
      new ztoolkit.ProgressWindow("AI Butler", {
        closeOnClick: true,
        closeTime: 3000,
      })
        .createLine({
          text: "无法加载文献条目",
          type: "error",
        })
        .show();
      return;
    }

    // 打开主窗口并切换到摘要视图
    const mainWin = MainWindow.getInstance();
    await mainWin.open("summary");

    // 通过 SummaryView 加载该文献的笔记(会自动显示聊天界面)
    const summaryView = mainWin.getSummaryView();
    if (summaryView) {
      // 调用 showSavedNoteForItem 需要传入条目ID
      await (summaryView as any).showSavedNoteForItem(parentItemID);
    }
  } catch (error: any) {
    ztoolkit.log("[AI-Butler] 打开聊天失败:", error);
    new ztoolkit.ProgressWindow("AI Butler", {
      closeOnClick: true,
      closeTime: 3000,
    })
      .createLine({
        text: `打开聊天失败: ${error.message || error}`,
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
  // 根据当前选择的 provider 检查相应的 API 密钥
  const provider =
    (Zotero.Prefs.get(`${config.prefsPrefix}.provider`, true) as string) ||
    "openai";
  let selectedApiKey: string | undefined;
  let providerName: string;

  const pLower = (provider || "").toLowerCase();
  if (provider === "google" || pLower.includes("gemini")) {
    selectedApiKey = Zotero.Prefs.get(
      `${config.prefsPrefix}.geminiApiKey`,
      true,
    ) as string;
    providerName = "Gemini";
  } else if (provider === "anthropic" || pLower.includes("claude")) {
    selectedApiKey = Zotero.Prefs.get(
      `${config.prefsPrefix}.anthropicApiKey`,
      true,
    ) as string;
    providerName = "Anthropic";
  } else if (pLower === "openai-compat") {
    // 支持 OpenAI 兼容接口 (旧 /v1/chat/completions)，优先读取专用密钥，回退到 OpenAI 密钥
    selectedApiKey =
      (Zotero.Prefs.get(
        `${config.prefsPrefix}.openaiCompatApiKey`,
        true,
      ) as string) ||
      (Zotero.Prefs.get(`${config.prefsPrefix}.openaiApiKey`, true) as string);
    providerName = "OpenAI 兼容"; // 提示更明确
  } else {
    selectedApiKey = Zotero.Prefs.get(
      `${config.prefsPrefix}.openaiApiKey`,
      true,
    ) as string;
    providerName = "OpenAI";
  }

  if (!selectedApiKey) {
    // API 未配置,显示友好的错误提示
    new ztoolkit.ProgressWindow("AI Butler", {
      closeOnClick: true,
      closeTime: 5000, // 5秒后自动关闭
    })
      .createLine({
        text: `请先在设置中配置 ${providerName} API Key`,
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
        text: "请先选择要处理的条目",
        type: "error",
      })
      .show();
    return;
  }

  // 第三步:将条目加入任务队列(优先处理)并提示用户
  const progressWin = new ztoolkit.ProgressWindow("AI Butler", {
    closeOnClick: true,
    closeTime: 4000,
  });

  try {
    const manager = TaskQueueManager.getInstance();
    await manager.addTasks(items, true); // 右键触发,默认优先处理

    // 打开主窗口并切换到任务队列标签页（使用单例）
    const mainWin = MainWindow.getInstance();
    await mainWin.open("tasks");
    // 立即刷新一次，确保用户看到刚入队的任务，避免“空白”误解
    try {
      mainWin.getTaskQueueView().refresh();
    } catch (e) {
      // 安全兜底，不影响后续流程
      ztoolkit.log("[AI-Butler] 刷新任务队列视图失败:", e);
    }

    progressWin
      .createLine({
        text: `已加入队列: ${items.length} 篇文献，开始处理...`,
        type: "success",
      })
      .show();
  } catch (error: any) {
    ztoolkit.log("[AI-Butler] 入队失败:", error);
    progressWin
      .createLine({
        text: `入队失败: ${error.message || error}`,
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
 * 对话框事件处理器
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
