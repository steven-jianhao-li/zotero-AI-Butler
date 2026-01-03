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
    // OpenRouter 默认
    openRouterApiUrl: "https://openrouter.ai/api/v1/chat/completions",
    openRouterApiKey: "",
    openRouterModel: "google/gemma-3-27b-it",
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

    getVisibility: () => {
      const selectedItems = Zotero.getActiveZoteroPane().getSelectedItems();
      return (
        selectedItems?.every((item: Zotero.Item) => item.isRegularItem()) ||
        false
      );
    },
  });

  // 注册"AI管家多轮对话重新精读"菜单项 (包含子菜单)
  ztoolkit.Menu.register("item", {
    tag: "menu", // 使用 menu 标签创建子菜单
    label: getString("menuitem-multiRoundReanalyze" as any),
    icon: menuIcon,
    children: [
      {
        tag: "menuitem",
        label: getString("menuitem-multiRoundConcat" as any),
        commandListener: () => handleMultiRoundSummary("multi_concat"),
      },
      {
        tag: "menuitem",
        label: getString("menuitem-multiRoundSummary" as any),
        commandListener: () => handleMultiRoundSummary("multi_summarize"),
      },
    ],
    getVisibility: () => {
      // 与生成总结的可见性逻辑相同
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

  // 注册"召唤AI管家一图总结"菜单项
  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    label: getString("menuitem-imageSummary"),
    icon: menuIcon,

    commandListener: async () => {
      await handleImageSummary();
    },

    getVisibility: () => {
      const selectedItems = Zotero.getActiveZoteroPane().getSelectedItems();
      return (
        selectedItems?.every((item: Zotero.Item) => item.isRegularItem()) ||
        false
      );
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
  } else if (pLower === "openrouter") {
    selectedApiKey = Zotero.Prefs.get(
      `${config.prefsPrefix}.openRouterApiKey`,
      true,
    ) as string;
    providerName = "OpenRouter";
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
      .createLine({ text: "请先选择要处理的文献", type: "error" })
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
      .createLine({ text: "请选择一个文献条目", type: "error" })
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
      .createLine({ text: "🖼️ 一图总结任务已加入队列", type: "success" })
      .show();
  } catch (error: any) {
    ztoolkit.log("[AI-Butler] 添加一图总结任务失败:", error);
    new ztoolkit.ProgressWindow("AI Butler", {
      closeOnClick: true,
      closeTime: 5000,
    })
      .createLine({
        text: `❌ 添加任务失败: ${error.message || error}`,
        type: "error",
      })
      .show();
  }
}

/**
 * 处理多轮对话重新精读
 *
 * @param mode 多轮对话模式
 */
async function handleMultiRoundSummary(
  mode: "multi_concat" | "multi_summarize",
) {
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
      .createLine({ text: "请先选择要处理的文献", type: "error" })
      .show();
    return;
  }

  // 3. 加入队列并强制覆盖
  try {
    const { TaskQueueManager } = await import("./modules/taskQueue");
    const taskQueue = TaskQueueManager.getInstance();

    // 批量添加任务，带有特定选项
    for (const item of items) {
      await taskQueue.addTask(item, true, {
        summaryMode: mode,
        forceOverwrite: true,
      });
    }

    new ztoolkit.ProgressWindow("AI Butler", {
      closeOnClick: true,
      closeTime: 3000,
    })
      .createLine({
        text: `已将 ${items.length} 个重分析任务加入高优队列`,
        type: "success",
      })
      .show();
  } catch (error: any) {
    ztoolkit.log("[AI Butler] 加入重分析队列失败:", error);
    new ztoolkit.ProgressWindow("AI Butler", {
      closeOnClick: true,
      closeTime: 5000,
    })
      .createLine({ text: "加入队列失败: " + error.message, type: "error" })
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
