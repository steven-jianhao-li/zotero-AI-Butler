/**
 * ================================================================
 * 条目面板侧边栏区块模块
 * ================================================================
 *
 * 在 Zotero 右侧条目面板中添加"AI 管家"区块
 * 提供 AI 笔记预览、一图总结展示和快速对话功能
 *
 * @module ItemPaneSection
 * @author AI-Butler Team
 */

import { config } from "../../package.json";
import { getString, getLocaleID } from "../utils/locale";
import { getPref, setPref } from "../utils/prefs";
import {
  getSidebarModuleOrder,
  isSidebarModuleEnabled,
  type SidebarModuleId,
} from "./uiCustomization";
import katex from "katex";
// 注意: 不在主进程中直接 import 思维导图库（如 markmap-view、simple-mind-map）
// 这些库在加载时会访问 document/window，而 Zotero Background 进程没有 DOM 环境
// 改用 iframe 架构：在独立 HTML 页面中加载这些库

// 侧边栏聊天状态类型
interface ChatState {
  itemId: number | null;
  pdfContent: string;
  isBase64: boolean;
  conversationHistory: Array<{ role: string; content: string }>;
  isChatting: boolean;
  savedPairIds: Set<string>; // 已保存的对话对 ID，防止重复保存
}

// 递增的对话对 ID 计数器
let quickChatPairIdCounter = 0;

/**
 * 内联公式转块级公式的阈值（渲染后HTML字符数）
 * 当内联公式渲染后的HTML长度超过此阈值时，自动转换为可滚动的块级公式
 * 调整此值可控制何时触发转换，详见 doc/DevelopmentGuide.md
 */
const INLINE_FORMULA_TO_BLOCK_THRESHOLD = 2000;

// 当前聊天状态
let currentChatState: ChatState = {
  itemId: null,
  pdfContent: "",
  isBase64: false,
  conversationHistory: [],
  isChatting: false,
  savedPairIds: new Set(),
};

type SidebarAutoRefreshTarget =
  | "summary"
  | "imageSummary"
  | "mindmap"
  | "table";

let sidebarContext: {
  doc: Document;
  item: Zotero.Item;
  itemId: number;
} | null = null;

let sidebarRenderContext: {
  body: HTMLElement;
  item: Zotero.Item;
  itemId: number;
  handleOpenAIChat: (itemId: number) => Promise<void>;
} | null = null;

let sidebarAutoRefreshBound = false;
let sidebarRefreshTimer: number | null = null;
const pendingSidebarRefreshTargets = new Set<SidebarAutoRefreshTarget>();
const quickChatToggleListeners = new WeakMap<HTMLElement, EventListener>();

function setSidebarContext(doc: Document, item: Zotero.Item | null): void {
  sidebarContext = item
    ? {
        doc,
        item,
        itemId: item.id,
      }
    : null;

  // Lazy-init listeners on first successful render
  void ensureSidebarAutoRefresh();
}

function parseTaskTarget(taskId: string): {
  itemId: number;
  target: SidebarAutoRefreshTarget;
} | null {
  const match = /^(task|img-task|mindmap-task|table-task)-(\d+)$/.exec(taskId);
  if (!match) return null;
  const itemId = Number(match[2]);
  if (!Number.isFinite(itemId)) return null;

  const target: SidebarAutoRefreshTarget =
    match[1] === "img-task"
      ? "imageSummary"
      : match[1] === "mindmap-task"
        ? "mindmap"
        : match[1] === "table-task"
          ? "table"
          : "summary";

  return { itemId, target };
}

function scheduleSidebarRefresh(target: SidebarAutoRefreshTarget): void {
  pendingSidebarRefreshTargets.add(target);
  if (sidebarRefreshTimer) {
    clearTimeout(sidebarRefreshTimer);
  }
  // Debounce: allow Zotero to finish saving notes/attachments
  sidebarRefreshTimer = setTimeout(() => {
    void runSidebarRefresh().catch((e) => {
      ztoolkit.log("[AI-Butler] Sidebar auto-refresh failed:", e);
    });
  }, 500) as any as number;
}

async function runSidebarRefresh(): Promise<void> {
  if (!sidebarContext) return;

  const { doc, itemId } = sidebarContext;
  const targets = Array.from(pendingSidebarRefreshTargets);
  pendingSidebarRefreshTargets.clear();

  let item: Zotero.Item = sidebarContext.item;
  try {
    item = await Zotero.Items.getAsync(itemId);
  } catch {
    // ignore and use cached item instance
  }

  if (!sidebarContext || sidebarContext.itemId !== itemId) return;

  if (targets.includes("summary")) {
    const noteContent = doc.getElementById(
      "ai-butler-note-content",
    ) as HTMLElement | null;
    if (noteContent) {
      noteContent.innerHTML = `<div style="color: #999; text-align: center; padding: 10px;">正在刷新...</div>`;
      await loadNoteContent(doc, item, noteContent);
    }
  }

  if (targets.includes("imageSummary")) {
    const imageContainer = doc.getElementById(
      "ai-butler-image-container",
    ) as HTMLElement | null;
    const imageBtnContainer = doc.getElementById(
      "ai-butler-image-btn-container",
    ) as HTMLElement | null;
    if (imageContainer && imageBtnContainer) {
      imageContainer.innerHTML = `<div style="color: #999; text-align: center; padding: 10px;">正在刷新...</div>`;
      await loadImageSummary(doc, item, imageContainer, imageBtnContainer);
    }
  }

  if (targets.includes("mindmap")) {
    const mindmapContainer = doc.getElementById(
      "ai-butler-mindmap-container",
    ) as HTMLElement | null;
    if (mindmapContainer) {
      mindmapContainer.innerHTML = `<div style="color: #999; text-align: center; padding: 10px;">正在刷新...</div>`;
      await loadMindmapContent(doc, item, mindmapContainer);
    }
  }

  if (targets.includes("table")) {
    const tableContent = doc.getElementById(
      "ai-butler-table-content",
    ) as HTMLElement | null;
    if (tableContent) {
      tableContent.innerHTML = `<div style="color: #999; text-align: center; padding: 10px;">正在刷新...</div>`;
      await loadTableContent(item, tableContent);
    }
  }
}

async function ensureSidebarAutoRefresh(): Promise<void> {
  if (sidebarAutoRefreshBound) return;
  sidebarAutoRefreshBound = true;

  try {
    const { TaskQueueManager } = await import("./taskQueue");
    const manager = TaskQueueManager.getInstance();

    manager.onComplete((taskId, success) => {
      if (!success) return;
      const parsed = parseTaskTarget(taskId);
      if (!parsed) return;
      if (!sidebarContext || sidebarContext.itemId !== parsed.itemId) return;
      scheduleSidebarRefresh(parsed.target);
    });
  } catch (error) {
    ztoolkit.log("[AI-Butler] Sidebar auto-refresh bind failed:", error);
  }
}

/**
 * 注册条目面板侧边栏区块
 *
 * @param handleOpenAIChat 打开 AI 追问的回调函数
 */
export function registerItemPaneSection(
  handleOpenAIChat: (itemId: number) => Promise<void>,
): void {
  const pluginID = config.addonID;
  const rootURI = `chrome://${config.addonRef}/content/`;

  try {
    (Zotero as any).ItemPaneManager.registerSection({
      paneID: "ai-butler-chat-section",
      pluginID: pluginID,
      header: {
        l10nID: getLocaleID("itempane-ai-section-header" as any),
        label: "AI 管家",
        icon: rootURI + "icons/icon24.png",
      },
      sidenav: {
        l10nID: getLocaleID("itempane-ai-section-sidenav" as any),
        tooltiptext: "AI 管家",
        icon: rootURI + "icons/icon24.png",
      },
      onRender: ({ body, item, editable, tabType }: any) => {
        renderItemPaneSection(body, item, handleOpenAIChat);
      },
    });

    ztoolkit.log("[AI-Butler] 条目面板区块已注册");
  } catch (error) {
    ztoolkit.log("[AI-Butler] 注册条目面板区块失败:", error);
  }
}

/**
 * 立即重绘当前条目侧边栏区块。
 *
 * 设置页保存侧边栏显示/排序后调用，避免用户需要重新选择文献才能看到变化。
 */
export async function refreshCurrentItemPaneSection(): Promise<void> {
  if (!sidebarRenderContext) return;

  const { body, itemId, handleOpenAIChat } = sidebarRenderContext;
  if (!body.isConnected) {
    sidebarRenderContext = null;
    return;
  }

  let item = sidebarRenderContext.item;
  try {
    item = await Zotero.Items.getAsync(itemId);
  } catch {
    // 使用缓存的 item 继续刷新
  }

  if (!item) return;
  renderItemPaneSection(body, item, handleOpenAIChat);
}

/**
 * 渲染条目面板侧边栏内容
 */
function renderItemPaneSection(
  body: HTMLElement,
  item: Zotero.Item,
  handleOpenAIChat: (itemId: number) => Promise<void>,
): void {
  body.innerHTML = "";
  const doc = body.ownerDocument;

  // 安全检查 doc
  if (!doc) {
    ztoolkit.log("[AI-Butler] 无法获取 ownerDocument");
    return;
  }

  // 容器样式
  body.style.cssText = `
    padding: 10px;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 13px;
    width: 100%;
    max-width: 100%;
    overflow-x: hidden;
    box-sizing: border-box;
  `;

  // 检查是否有有效的文献条目
  if (!item || !item.isRegularItem()) {
    setSidebarContext(doc, null);
    sidebarRenderContext = null;
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

  setSidebarContext(doc, item);
  sidebarRenderContext = {
    body,
    item,
    itemId: item.id,
    handleOpenAIChat,
  };

  // 重置聊天状态（如果切换了条目）
  if (currentChatState.itemId !== item.id) {
    currentChatState = {
      itemId: item.id,
      pdfContent: "",
      isBase64: false,
      conversationHistory: [],
      isChatting: false,
      savedPairIds: new Set(),
    };
  }

  // 按用户配置的顺序渲染侧边栏功能区块
  const renderers: Record<SidebarModuleId, () => void> = {
    actionButtons: () => renderActionButtons(body, doc, item, handleOpenAIChat),
    note: () => renderNoteSection(body, doc, item),
    table: () => renderTableSection(body, doc, item),
    imageSummary: () => renderImageSummarySection(body, doc, item),
    mindmap: () => renderMindmapSection(body, doc, item),
    quickChat: () =>
      renderChatArea(body, doc, item, !isSidebarModuleEnabled("actionButtons")),
  };

  for (const moduleId of getSidebarModuleOrder()) {
    if (isSidebarModuleEnabled(moduleId)) {
      renderers[moduleId]();
    }
  }
}

/**
 * 创建通用按钮
 */
function createButton(
  doc: Document,
  text: string,
  isPrimary: boolean,
): HTMLButtonElement {
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
}

/**
 * 渲染操作按钮区域
 */
function renderActionButtons(
  body: HTMLElement,
  doc: Document,
  item: Zotero.Item,
  handleOpenAIChat: (itemId: number) => Promise<void>,
): void {
  const btnContainer = doc.createElement("div");
  btnContainer.style.cssText = `
    display: flex;
    gap: 8px;
    margin-bottom: 10px;
  `;

  // 完整追问按钮
  const fullChatBtn = createButton(
    doc,
    getString("itempane-ai-open-chat"),
    true,
  );
  fullChatBtn.addEventListener("click", async () => {
    try {
      await handleOpenAIChat(item.id);
    } catch (error: any) {
      ztoolkit.log("[AI-Butler] 完整追问按钮点击失败:", error);
    }
  });

  // 快速提问按钮
  const quickChatBtn = createButton(
    doc,
    getString("itempane-ai-temp-chat"),
    false,
  );
  quickChatBtn.id = "ai-butler-quick-chat-btn";
  quickChatBtn.addEventListener("click", () => {
    const ToggleEvent = doc.defaultView?.CustomEvent || CustomEvent;
    body.dispatchEvent(
      new ToggleEvent("ai-butler-toggle-inline-chat", {
        detail: { button: quickChatBtn },
      }),
    );
  });

  // 刷新按钮
  const refreshBtn = doc.createElement("button");
  refreshBtn.id = "ai-butler-refresh-btn";
  refreshBtn.title = "刷新当前显示的 AI 管家侧边栏内容";
  refreshBtn.textContent = "🔄";
  refreshBtn.style.cssText = `
    padding: 8px 12px;
    border: 1px solid #59c0bc;
    border-radius: 4px;
    background: transparent;
    color: #59c0bc;
    cursor: pointer;
    font-size: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
    flex-shrink: 0;
  `;
  refreshBtn.addEventListener("mouseenter", () => {
    refreshBtn.style.background = "rgba(89, 192, 188, 0.1)";
  });
  refreshBtn.addEventListener("mouseleave", () => {
    refreshBtn.style.background = "transparent";
  });
  refreshBtn.addEventListener("click", async () => {
    // 显示刷新中状态
    refreshBtn.textContent = "⏳";
    refreshBtn.style.pointerEvents = "none";
    try {
      // 刷新 AI 笔记
      if (isSidebarModuleEnabled("note")) {
        const noteContent = doc.getElementById(
          "ai-butler-note-content",
        ) as HTMLElement | null;
        if (noteContent) {
          noteContent.innerHTML = `<div style="color: #999; text-align: center; padding: 10px;">正在刷新...</div>`;
          await loadNoteContent(doc, item, noteContent);
        }
      }
      // 刷新表格归纳
      if (isSidebarModuleEnabled("table")) {
        const tableContent = doc.getElementById(
          "ai-butler-table-content",
        ) as HTMLElement | null;
        if (tableContent) {
          tableContent.innerHTML = `<div style="color: #999; text-align: center; padding: 10px;">正在刷新...</div>`;
          await loadTableContent(item, tableContent);
        }
      }
      // 刷新一图总结
      if (isSidebarModuleEnabled("imageSummary")) {
        const imageContainer = doc.getElementById(
          "ai-butler-image-container",
        ) as HTMLElement | null;
        const imageBtnContainer = doc.getElementById(
          "ai-butler-image-btn-container",
        ) as HTMLElement | null;
        if (imageContainer && imageBtnContainer) {
          imageContainer.innerHTML = `<div style="color: #999; text-align: center; padding: 10px;">正在刷新...</div>`;
          imageBtnContainer.innerHTML = "";
          await loadImageSummary(doc, item, imageContainer, imageBtnContainer);
        }
      }
      // 刷新思维导图
      if (isSidebarModuleEnabled("mindmap")) {
        const mindmapContainer = doc.getElementById(
          "ai-butler-mindmap-container",
        ) as HTMLElement | null;
        if (mindmapContainer) {
          mindmapContainer.innerHTML = `<div style="color: #999; text-align: center; padding: 10px;">正在刷新...</div>`;
          await loadMindmapContent(doc, item, mindmapContainer);
        }
      }
    } catch (err: any) {
      ztoolkit.log("[AI-Butler] 刷新失败:", err);
    } finally {
      // 恢复按钮状态
      refreshBtn.textContent = "🔄";
      refreshBtn.style.pointerEvents = "auto";
    }
  });

  btnContainer.appendChild(fullChatBtn);
  if (isSidebarModuleEnabled("quickChat")) {
    btnContainer.appendChild(quickChatBtn);
  }
  btnContainer.appendChild(refreshBtn);
  body.appendChild(btnContainer);
}

/**
 * 渲染 AI 笔记区域
 */
function renderNoteSection(
  body: HTMLElement,
  doc: Document,
  item: Zotero.Item,
): void {
  const noteSection = doc.createElement("div");
  noteSection.className = "ai-butler-note-section";
  noteSection.style.cssText = `
    margin-bottom: 12px;
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    overflow: hidden;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
  `;

  // 笔记标题栏（可折叠）- 使用继承颜色以支持暗色模式
  const noteHeader = doc.createElement("div");
  noteHeader.className = "ai-butler-note-header";
  noteHeader.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    background: rgba(128, 128, 128, 0.1);
    cursor: pointer;
    user-select: none;
    border-bottom: 1px solid rgba(128, 128, 128, 0.2);
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    overflow: hidden;
  `;

  const noteTitle = doc.createElement("span");
  noteTitle.style.cssText = `
    font-weight: 500;
    font-size: 12px;
    color: inherit;
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
  fontSizeControl.addEventListener("click", (e: Event) => e.stopPropagation());

  // 从设置加载字体大小，默认12px
  let currentFontSize = parseInt(
    (getPref("sidebarNoteFontSize" as any) as string) || "12",
    10,
  );
  if (isNaN(currentFontSize) || currentFontSize < 10 || currentFontSize > 20) {
    currentFontSize = 12;
  }

  const fontSizeLabel = doc.createElement("span");
  fontSizeLabel.textContent = `${currentFontSize}px`;
  fontSizeLabel.style.cssText = `
    font-size: 10px;
    color: inherit;
    opacity: 0.7;
    min-width: 28px;
    text-align: center;
  `;

  // 高度控制
  const DEFAULT_NOTE_HEIGHT = 200;
  let savedNoteHeight = parseInt(
    (getPref("sidebarNoteHeight" as any) as string) ||
      String(DEFAULT_NOTE_HEIGHT),
    10,
  );
  if (isNaN(savedNoteHeight) || savedNoteHeight < 50) {
    savedNoteHeight = DEFAULT_NOTE_HEIGHT;
  }

  // 笔记内容区域
  const noteContentWrapper = doc.createElement("div");
  noteContentWrapper.className = "ai-butler-note-content-wrapper";
  noteContentWrapper.style.cssText = `
    position: relative;
    height: ${savedNoteHeight}px;
    min-height: 50px;
    overflow-y: auto;
    overflow-x: hidden;
    transition: height 0.2s ease;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
  `;

  const noteContent = doc.createElement("div");
  noteContent.className = "ai-butler-note-content markdown-body";
  noteContent.id = "ai-butler-note-content";
  noteContent.style.cssText = `
    padding: 10px;
    padding-bottom: 20px;
    font-size: ${currentFontSize}px;
    line-height: 1.6;
    overflow-wrap: break-word;
    word-wrap: break-word;
    overflow-x: hidden;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    user-select: text;
    cursor: text;
  `;

  const createFontBtn = (text: string, delta: number) => {
    const btn = doc.createElement("button");
    btn.textContent = text;
    btn.style.cssText = `
      width: 20px;
      height: 20px;
      border: 1px solid currentColor;
      border-radius: 3px;
      background: transparent;
      cursor: pointer;
      font-size: 12px;
      line-height: 1;
      color: inherit;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0.7;
    `;
    btn.addEventListener("mouseenter", () => {
      btn.style.opacity = "1";
      btn.style.background = "rgba(128, 128, 128, 0.2)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.opacity = "0.7";
      btn.style.background = "transparent";
    });
    btn.addEventListener("click", () => {
      currentFontSize = Math.max(10, Math.min(20, currentFontSize + delta));
      fontSizeLabel.textContent = `${currentFontSize}px`;
      noteContent.style.fontSize = `${currentFontSize}px`;
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
    border: 1px solid currentColor;
    border-radius: 3px;
    background: inherit;
    cursor: pointer;
    color: inherit;
    opacity: 0.8;
  `;
  themeSelect.addEventListener("click", (e: Event) => e.stopPropagation());

  // 添加内置主题选项
  const themes = [
    { id: "github", name: "GitHub" },
    { id: "redstriking", name: "红印" },
  ];
  const currentTheme = (
    (getPref("markdownTheme" as any) as string) || "github"
  ).toString();
  themes.forEach((t) => {
    const opt = doc.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name;
    if (t.id === currentTheme) opt.selected = true;
    themeSelect.appendChild(opt);
  });

  themeSelect.addEventListener("change", async () => {
    const newTheme = themeSelect.value;
    setPref("markdownTheme" as any, newTheme as any);
    const { themeManager } = await import("./themeManager");
    themeManager.setCurrentTheme(newTheme);
    themeManager.clearCache();
    const themeCss = await themeManager.loadThemeCss();
    const katexCss = await themeManager.loadKatexCss();
    const adaptedCss = themeManager.adaptCssForSidebar(themeCss);
    const styleEl = doc.getElementById(
      "ai-butler-note-theme",
    ) as HTMLStyleElement;
    if (styleEl) {
      styleEl.textContent = katexCss + "\n" + adaptedCss;
    }
  });
  fontSizeControl.appendChild(themeSelect);

  // 恢复默认高度按钮
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

  // 复制 Markdown 按钮
  const copyBtn = doc.createElement("button");
  copyBtn.textContent = "📋";
  copyBtn.title = "复制为 Markdown";
  copyBtn.id = "ai-butler-copy-note-btn";
  copyBtn.style.cssText = `
    width: 20px;
    height: 20px;
    border: 1px solid currentColor;
    border-radius: 3px;
    background: transparent;
    cursor: pointer;
    font-size: 12px;
    color: inherit;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-left: 4px;
    opacity: 0.7;
  `;
  copyBtn.addEventListener("click", async (e: Event) => {
    e.stopPropagation();
    try {
      // 获取当前笔记的 Markdown 内容
      const markdownContent = await getNoteMarkdownContent(item);
      if (!markdownContent) {
        copyBtn.textContent = "❌";
        setTimeout(() => {
          copyBtn.textContent = "📋";
        }, 1500);
        return;
      }
      // 复制到剪贴板
      await copyToClipboard(doc, markdownContent);
      // 显示成功反馈
      copyBtn.textContent = "✓";
      copyBtn.style.color = "#4caf50";
      setTimeout(() => {
        copyBtn.textContent = "📋";
        copyBtn.style.color = "inherit";
      }, 1500);
    } catch (err) {
      ztoolkit.log("[AI-Butler] 复制笔记失败:", err);
      copyBtn.textContent = "❌";
      setTimeout(() => {
        copyBtn.textContent = "📋";
      }, 1500);
    }
  });
  copyBtn.addEventListener("mouseenter", () => {
    copyBtn.style.opacity = "1";
    copyBtn.style.background = "rgba(128, 128, 128, 0.2)";
  });
  copyBtn.addEventListener("mouseleave", () => {
    copyBtn.style.opacity = "0.7";
    copyBtn.style.background = "transparent";
  });
  fontSizeControl.appendChild(copyBtn);

  const toggleIcon = doc.createElement("span");
  toggleIcon.textContent = "▼";
  toggleIcon.style.cssText = `
    font-size: 10px;
    color: inherit;
    opacity: 0.6;
    transition: transform 0.2s ease;
  `;

  noteHeader.appendChild(noteTitle);
  noteHeader.appendChild(fontSizeControl);
  noteHeader.appendChild(toggleIcon);

  noteContentWrapper.appendChild(noteContent);

  // 拖拽调整高度的手柄
  const resizeHandle = createResizeHandle(
    doc,
    noteContentWrapper,
    "sidebarNoteHeight",
  );

  // 折叠/展开功能 - 从首选项读取初始状态
  let isCollapsed = getPref("sidebarNoteCollapsed" as any) === true;

  // 根据初始状态设置UI
  if (isCollapsed) {
    noteContentWrapper.style.height = "0px";
    noteContentWrapper.style.overflow = "hidden";
    resizeHandle.style.display = "none";
    toggleIcon.style.transform = "rotate(-90deg)";
  }

  noteHeader.addEventListener("click", () => {
    isCollapsed = !isCollapsed;
    // 保存折叠状态到首选项
    setPref("sidebarNoteCollapsed" as any, isCollapsed as any);
    if (isCollapsed) {
      noteContentWrapper.style.height = "0px";
      noteContentWrapper.style.overflow = "hidden";
      resizeHandle.style.display = "none";
      toggleIcon.style.transform = "rotate(-90deg)";
    } else {
      const restoreHeight = parseInt(
        (getPref("sidebarNoteHeight" as any) as string) ||
          String(DEFAULT_NOTE_HEIGHT),
        10,
      );
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

  // 异步加载笔记内容
  loadNoteContent(doc, item, noteContent);
}

/**
 * 加载文献表格内容
 */
async function loadTableContent(
  item: Zotero.Item,
  container: HTMLElement,
): Promise<void> {
  try {
    const { LiteratureReviewService } =
      await import("./literatureReviewService");
    const tableContent = await LiteratureReviewService.findTableNote(item);

    if (tableContent) {
      // 将 Markdown 表格简单渲染为 HTML
      const { marked } = await import("marked");
      marked.setOptions({ gfm: true, breaks: true });
      const html = marked.parse(tableContent) as string;
      container.innerHTML = html;
      // 适配表格样式
      const tables = container.querySelectorAll("table");
      tables.forEach((table: Element) => {
        (table as HTMLElement).style.cssText = `
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
          margin: 4px 0;
        `;
        table.querySelectorAll("th, td").forEach((cell: Element) => {
          (cell as HTMLElement).style.cssText = `
            border: 1px solid rgba(128, 128, 128, 0.3);
            padding: 4px 8px;
            text-align: left;
          `;
        });
        table.querySelectorAll("th").forEach((th: Element) => {
          (th as HTMLElement).style.fontWeight = "600";
          (th as HTMLElement).style.background = "rgba(128, 128, 128, 0.1)";
        });
      });
    } else {
      container.innerHTML = `<div style="color: #9e9e9e; font-size: 12px; text-align: center; padding: 12px;">暂无填表数据</div>`;
    }
  } catch (error) {
    ztoolkit.log("[AI-Butler] 加载表格内容失败:", error);
    container.innerHTML = `<div style="color: #9e9e9e; font-size: 12px; text-align: center; padding: 12px;">加载失败</div>`;
  }
}

/**
 * 渲染文献表格区域
 */
function renderTableSection(
  body: HTMLElement,
  doc: Document,
  item: Zotero.Item,
): void {
  const tableSection = doc.createElement("div");
  tableSection.className = "ai-butler-table-section";
  tableSection.style.cssText = `
    margin-bottom: 12px;
    margin-top: 12px;
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    overflow: hidden;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
  `;

  // 标题栏（可折叠）
  const tableHeader = doc.createElement("div");
  tableHeader.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    background: rgba(76, 175, 80, 0.1);
    cursor: pointer;
    user-select: none;
    border-bottom: 1px solid rgba(76, 175, 80, 0.2);
  `;

  const tableTitle = doc.createElement("span");
  tableTitle.style.cssText = `
    font-weight: 500;
    font-size: 12px;
    color: inherit;
    display: flex;
    align-items: center;
    gap: 6px;
  `;
  tableTitle.innerHTML = `📊 <span>表格归纳</span>`;

  // 异步加载综述状态徽章
  void (async () => {
    const itemTags: Array<{ tag: string }> = (item as any).getTags?.() || [];
    const isReviewed = itemTags.some(
      (t: { tag: string }) => t.tag === "AI-Reviewed",
    );

    let hasTable = false;
    const subNoteIDs: number[] = (item as any).getNotes?.() || [];
    for (const nid of subNoteIDs) {
      try {
        const n = await Zotero.Items.getAsync(nid);
        if (!n) continue;
        const nTags: Array<{ tag: string }> = (n as any).getTags?.() || [];
        if (nTags.some((t: { tag: string }) => t.tag === "AI-Table")) {
          hasTable = true;
          break;
        }
      } catch {
        // skip
      }
    }

    let badges = "";
    if (hasTable) {
      badges += `<span style="margin-left:6px;padding:1px 5px;border-radius:3px;font-size:9px;background:rgba(76,175,80,0.15);color:#4caf50;">📊 已填表</span>`;
    }
    if (isReviewed) {
      badges += `<span style="margin-left:4px;padding:1px 5px;border-radius:3px;font-size:9px;background:rgba(99,102,241,0.15);color:#6366f1;">✅ 已综述</span>`;
    }
    if (badges) {
      const titleSpan = tableTitle.querySelector("span");
      if (titleSpan) {
        titleSpan.innerHTML = `表格归纳${badges}`;
      }
    }
  })();

  // 操作按钮容器
  const tableBtnContainer = doc.createElement("div");
  tableBtnContainer.style.cssText = `
    display: flex;
    align-items: center;
    gap: 6px;
  `;
  tableBtnContainer.addEventListener("click", (e: Event) =>
    e.stopPropagation(),
  );

  // 重新填表按钮
  const refillBtn = doc.createElement("button");
  refillBtn.textContent = "🔄 重新生成";
  refillBtn.title = "重新填表";
  refillBtn.style.cssText = `
    padding: 2px 8px;
    border: 1px solid currentColor;
    border-radius: 3px;
    background: transparent;
    cursor: pointer;
    font-size: 11px;
    color: inherit;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.7;
    white-space: nowrap;
  `;
  refillBtn.addEventListener("mouseenter", () => {
    refillBtn.style.opacity = "1";
    refillBtn.style.background = "rgba(128, 128, 128, 0.2)";
  });
  refillBtn.addEventListener("mouseleave", () => {
    refillBtn.style.opacity = "0.7";
    refillBtn.style.background = "transparent";
  });
  refillBtn.addEventListener("click", async () => {
    refillBtn.textContent = "⏳ 生成中...";
    refillBtn.style.pointerEvents = "none";
    try {
      const { LiteratureReviewService } =
        await import("./literatureReviewService");
      const { DEFAULT_TABLE_TEMPLATE, DEFAULT_TABLE_FILL_PROMPT } =
        await import("../utils/prompts");

      const tableTemplate =
        (getPref("tableTemplate" as any) as string) || DEFAULT_TABLE_TEMPLATE;
      const fillPrompt =
        (getPref("tableFillPrompt" as any) as string) ||
        DEFAULT_TABLE_FILL_PROMPT;

      // 先删除已有 AI-Table 笔记
      const noteIDs = (item as any).getNotes?.() || [];
      for (const nid of noteIDs) {
        const note = await Zotero.Items.getAsync(nid);
        if (!note) continue;
        const tags: Array<{ tag: string }> = (note as any).getTags?.() || [];
        if (tags.some((t) => t.tag === "AI-Table")) {
          await note.eraseTx();
          break;
        }
      }

      // 找到 PDF 附件
      const attachmentIDs = (item as any).getAttachments?.() || [];
      for (const attId of attachmentIDs) {
        const att = await Zotero.Items.getAsync(attId);
        if (att && (att as any).isPDFAttachment?.()) {
          const table = await LiteratureReviewService.fillTableForSinglePDF(
            item,
            att,
            tableTemplate,
            fillPrompt,
          );
          await LiteratureReviewService.saveTableNote(item, table);
          break;
        }
      }

      // 刷新内容
      const tableContent = doc.getElementById(
        "ai-butler-table-content",
      ) as HTMLElement | null;
      if (tableContent) {
        await loadTableContent(item, tableContent);
      }
    } catch (err) {
      ztoolkit.log("[AI-Butler] 重新填表失败:", err);
    } finally {
      refillBtn.textContent = "🔄 重新生成";
      refillBtn.style.pointerEvents = "auto";
    }
  });
  tableBtnContainer.appendChild(refillBtn);

  const tableToggleIcon = doc.createElement("span");
  tableToggleIcon.textContent = "▼";
  tableToggleIcon.style.cssText = `
    font-size: 10px;
    color: inherit;
    opacity: 0.6;
    transition: transform 0.2s ease;
  `;

  tableHeader.appendChild(tableTitle);
  tableHeader.appendChild(tableBtnContainer);
  tableHeader.appendChild(tableToggleIcon);

  // 内容区域
  const DEFAULT_TABLE_HEIGHT = 150;
  let savedTableHeight = parseInt(
    (getPref("sidebarTableHeight" as any) as string) ||
      String(DEFAULT_TABLE_HEIGHT),
    10,
  );
  if (isNaN(savedTableHeight) || savedTableHeight < 50) {
    savedTableHeight = DEFAULT_TABLE_HEIGHT;
  }

  const tableContentWrapper = doc.createElement("div");
  tableContentWrapper.style.cssText = `
    position: relative;
    height: ${savedTableHeight}px;
    min-height: 50px;
    overflow-y: auto;
    overflow-x: hidden;
    transition: height 0.2s ease;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
  `;

  const tableContentEl = doc.createElement("div");
  tableContentEl.id = "ai-butler-table-content";
  tableContentEl.style.cssText = `
    padding: 10px;
    font-size: 12px;
    line-height: 1.5;
    overflow-wrap: break-word;
    overflow-x: hidden;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    user-select: text;
    cursor: text;
  `;

  tableContentWrapper.appendChild(tableContentEl);

  // 拖拽调整高度的手柄
  const tableResizeHandle = createResizeHandle(
    doc,
    tableContentWrapper,
    "sidebarTableHeight",
  );

  // 折叠/展开
  let isCollapsed = getPref("sidebarTableCollapsed" as any) === true;
  if (isCollapsed) {
    tableContentWrapper.style.height = "0px";
    tableContentWrapper.style.overflow = "hidden";
    tableResizeHandle.style.display = "none";
    tableToggleIcon.style.transform = "rotate(-90deg)";
  }

  tableHeader.addEventListener("click", () => {
    isCollapsed = !isCollapsed;
    setPref("sidebarTableCollapsed" as any, isCollapsed as any);
    if (isCollapsed) {
      tableContentWrapper.style.height = "0px";
      tableContentWrapper.style.overflow = "hidden";
      tableResizeHandle.style.display = "none";
      tableToggleIcon.style.transform = "rotate(-90deg)";
    } else {
      const restoreHeight = parseInt(
        (getPref("sidebarTableHeight" as any) as string) ||
          String(DEFAULT_TABLE_HEIGHT),
        10,
      );
      tableContentWrapper.style.height = `${restoreHeight}px`;
      tableContentWrapper.style.overflowY = "auto";
      tableResizeHandle.style.display = "flex";
      tableToggleIcon.style.transform = "rotate(0deg)";
    }
  });

  tableSection.appendChild(tableHeader);
  tableSection.appendChild(tableContentWrapper);
  tableSection.appendChild(tableResizeHandle);
  body.appendChild(tableSection);

  // 异步加载表格内容
  loadTableContent(item, tableContentEl);
}

/**
 * 渲染一图总结区域
 */
function renderImageSummarySection(
  body: HTMLElement,
  doc: Document,
  item: Zotero.Item,
): void {
  const imageSummarySection = doc.createElement("div");
  imageSummarySection.className = "ai-butler-image-summary-section";
  imageSummarySection.style.cssText = `
    margin-bottom: 12px;
    margin-top: 12px;
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    overflow: hidden;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
  `;

  // 标题栏
  const imageSummaryHeader = doc.createElement("div");
  imageSummaryHeader.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    background: rgba(156, 39, 176, 0.1);
    cursor: pointer;
    user-select: none;
    border-bottom: 1px solid rgba(156, 39, 176, 0.2);
  `;

  const imageSummaryTitle = doc.createElement("span");
  imageSummaryTitle.style.cssText = `
    font-weight: 500;
    font-size: 12px;
    color: inherit;
    display: flex;
    align-items: center;
    gap: 6px;
  `;
  imageSummaryTitle.innerHTML = `🖼️ <span>一图总结</span>`;

  // 按钮容器
  const imageBtnContainer = doc.createElement("div");
  imageBtnContainer.id = "ai-butler-image-btn-container";
  imageBtnContainer.style.cssText = `
    display: flex;
    align-items: center;
    gap: 6px;
  `;
  imageBtnContainer.addEventListener("click", (e: Event) =>
    e.stopPropagation(),
  );

  const imageToggleIcon = doc.createElement("span");
  imageToggleIcon.textContent = "▼";
  imageToggleIcon.style.cssText = `
    font-size: 10px;
    color: inherit;
    opacity: 0.6;
    transition: transform 0.2s ease;
  `;

  imageSummaryHeader.appendChild(imageSummaryTitle);
  imageSummaryHeader.appendChild(imageBtnContainer);
  imageSummaryHeader.appendChild(imageToggleIcon);

  // 图片容器
  const imageContainer = doc.createElement("div");
  imageContainer.id = "ai-butler-image-container";
  imageContainer.style.cssText = `
    padding: 10px;
    text-align: center;
    background: transparent;
    min-height: 80px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    overflow: hidden;
  `;

  // 折叠功能 - 从首选项读取初始状态
  let isImageCollapsed = getPref("sidebarImageCollapsed" as any) === true;

  // 根据初始状态设置UI
  if (isImageCollapsed) {
    imageContainer.style.display = "none";
    imageToggleIcon.style.transform = "rotate(-90deg)";
  }

  imageSummaryHeader.addEventListener("click", () => {
    isImageCollapsed = !isImageCollapsed;
    // 保存折叠状态到首选项
    setPref("sidebarImageCollapsed" as any, isImageCollapsed as any);
    if (isImageCollapsed) {
      imageContainer.style.display = "none";
      imageToggleIcon.style.transform = "rotate(-90deg)";
    } else {
      imageContainer.style.display = "flex";
      imageToggleIcon.style.transform = "rotate(0deg)";
    }
  });

  imageSummarySection.appendChild(imageSummaryHeader);
  imageSummarySection.appendChild(imageContainer);
  body.appendChild(imageSummarySection);

  // 异步加载一图总结
  loadImageSummary(doc, item, imageContainer, imageBtnContainer);
}

/**
 * 渲染思维导图区域
 */
function renderMindmapSection(
  body: HTMLElement,
  doc: Document,
  item: Zotero.Item,
): void {
  const mindmapSection = doc.createElement("div");
  mindmapSection.className = "ai-butler-mindmap-section";
  mindmapSection.style.cssText = `
    margin-bottom: 12px;
    margin-top: 12px;
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    overflow: hidden;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
  `;

  // 标题栏
  const mindmapHeader = doc.createElement("div");
  mindmapHeader.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    background: rgba(76, 175, 80, 0.1);
    cursor: pointer;
    user-select: none;
    border-bottom: 1px solid rgba(76, 175, 80, 0.2);
  `;

  const mindmapTitle = doc.createElement("span");
  mindmapTitle.style.cssText = `
    font-weight: 500;
    font-size: 12px;
    color: inherit;
    display: flex;
    align-items: center;
    gap: 6px;
  `;
  mindmapTitle.innerHTML = `🧠 <span>思维导图</span>`;

  const mindmapToggleIcon = doc.createElement("span");
  mindmapToggleIcon.textContent = "▼";
  mindmapToggleIcon.style.cssText = `
    font-size: 10px;
    color: inherit;
    opacity: 0.6;
    transition: transform 0.2s ease;
  `;

  mindmapHeader.appendChild(mindmapTitle);
  mindmapHeader.appendChild(mindmapToggleIcon);

  // 思维导图容器
  const mindmapContainer = doc.createElement("div");
  mindmapContainer.id = "ai-butler-mindmap-container";
  mindmapContainer.style.cssText = `
    padding: 10px;
    text-align: center;
    background: transparent;
    min-height: 300px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    overflow: hidden;
  `;

  // 折叠功能 - 从首选项读取初始状态
  let isMindmapCollapsed = getPref("sidebarMindmapCollapsed" as any) === true;

  // 根据初始状态设置UI
  if (isMindmapCollapsed) {
    mindmapContainer.style.display = "none";
    mindmapToggleIcon.style.transform = "rotate(-90deg)";
  }

  mindmapHeader.addEventListener("click", () => {
    isMindmapCollapsed = !isMindmapCollapsed;
    // 保存折叠状态到首选项
    setPref("sidebarMindmapCollapsed" as any, isMindmapCollapsed as any);
    if (isMindmapCollapsed) {
      mindmapContainer.style.display = "none";
      mindmapToggleIcon.style.transform = "rotate(-90deg)";
    } else {
      mindmapContainer.style.display = "flex";
      mindmapToggleIcon.style.transform = "rotate(0deg)";
    }
  });

  mindmapSection.appendChild(mindmapHeader);
  mindmapSection.appendChild(mindmapContainer);
  body.appendChild(mindmapSection);

  // 异步加载思维导图
  loadMindmapContent(doc, item, mindmapContainer);
}

/**
 * 异步加载思维导图内容
 */
async function loadMindmapContent(
  doc: Document,
  item: Zotero.Item,
  container: HTMLElement,
): Promise<void> {
  try {
    // Avoid accumulating message listeners across re-renders/refreshes
    const mindmapWin: any = doc.defaultView;
    if (mindmapWin?.__aiButlerMindmapMessageHandler) {
      try {
        mindmapWin.removeEventListener(
          "message",
          mindmapWin.__aiButlerMindmapMessageHandler,
        );
      } catch {
        // ignore
      }
      mindmapWin.__aiButlerMindmapMessageHandler = null;
    }

    // 获取正确的父条目
    let targetItem: any = item;
    if (item.isAttachment && item.isAttachment()) {
      const parentId = item.parentItemID;
      if (parentId) {
        targetItem = await Zotero.Items.getAsync(parentId);
      }
    }

    // 查找思维导图笔记
    const noteIDs = (targetItem as any).getNotes?.() || [];
    let mindmapNote: any = null;

    for (const nid of noteIDs) {
      try {
        const n = await Zotero.Items.getAsync(nid);
        if (!n) continue;
        const tags: Array<{ tag: string }> = (n as any).getTags?.() || [];
        const noteHtml: string = (n as any).getNote?.() || "";

        // 检查是否是思维导图笔记
        // 优先检查标签，其次检查标题（支持新旧格式）
        const isMindmapNote =
          tags.some((t) => t.tag === "AI-Mindmap") ||
          /AI\s*管家思维导图\s*-/.test(noteHtml);

        if (isMindmapNote) {
          if (!mindmapNote) {
            mindmapNote = n;
          } else {
            const a = (mindmapNote as any).dateModified || 0;
            const b = (n as any).dateModified || 0;
            if (b > a) mindmapNote = n;
          }
        }
      } catch (e) {
        continue;
      }
    }

    if (!mindmapNote) {
      const generateMindmapBtn = doc.createElement("button");
      generateMindmapBtn.textContent = "🧠 生成思维导图";
      generateMindmapBtn.style.cssText = `
        padding: 8px 16px;
        border: 1px solid #4caf50;
        border-radius: 4px;
        background: transparent;
        color: #4caf50;
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        transition: all 0.2s ease;
      `;
      generateMindmapBtn.addEventListener("mouseenter", () => {
        generateMindmapBtn.style.background = "rgba(76, 175, 80, 0.1)";
      });
      generateMindmapBtn.addEventListener("mouseleave", () => {
        generateMindmapBtn.style.background = "transparent";
      });
      generateMindmapBtn.addEventListener("click", async () => {
        try {
          generateMindmapBtn.disabled = true;
          generateMindmapBtn.textContent = "正在加入队列...";
          const { TaskQueueManager } = await import("./taskQueue");
          const queueManager = TaskQueueManager.getInstance();
          await queueManager.addMindmapTask(targetItem);
          generateMindmapBtn.textContent = "✅ 已加入队列";
        } catch (err: any) {
          generateMindmapBtn.textContent = "❌ 失败";
          setTimeout(() => {
            generateMindmapBtn.textContent = "🧠 生成思维导图";
            generateMindmapBtn.disabled = false;
          }, 2000);
        }
      });

      container.innerHTML = `
        <div style="text-align: center; color: #9e9e9e; padding: 16px;">
          <div style="font-size: 24px; margin-bottom: 8px;">🧠</div>
          <div style="font-size: 12px; margin-bottom: 8px;">暂无思维导图</div>
        </div>
      `;
      container.appendChild(generateMindmapBtn);
      return;
    }

    const noteHtml: string = (mindmapNote as any).getNote?.() || "";

    // 提取 markmap 代码块
    // 笔记 HTML 格式: <pre>```markmap\n[content]\n```</pre>
    // 注意: 换行符可能是 \n 或实际的换行
    const markmapRegex = /```markmap\s*\n([\s\S]*?)\n```/;
    const match = noteHtml.match(markmapRegex);

    ztoolkit.log("[AI-Butler] 思维导图笔记 HTML 长度:", noteHtml.length);
    ztoolkit.log(
      "[AI-Butler] 思维导图正则匹配结果:",
      match ? "匹配成功" : "匹配失败",
    );
    if (match) {
      ztoolkit.log("[AI-Butler] 匹配的内容长度:", match[1]?.length);
    } else {
      // 尝试调试：检查是否包含 markmap 关键字
      ztoolkit.log(
        "[AI-Butler] 笔记是否包含 markmap:",
        noteHtml.includes("markmap"),
      );
      ztoolkit.log("[AI-Butler] 笔记是否包含 ```:", noteHtml.includes("```"));
      // 尝试查找 markmap 位置
      const markmapIdx = noteHtml.indexOf("markmap");
      if (markmapIdx >= 0) {
        ztoolkit.log(
          "[AI-Butler] markmap 周围内容:",
          noteHtml.substring(Math.max(0, markmapIdx - 20), markmapIdx + 50),
        );
      }
    }

    if (!match) {
      container.innerHTML = `
        <div style="text-align: center; color: #9e9e9e; padding: 16px;">
          <div style="font-size: 24px; margin-bottom: 8px;">⚠️</div>
          <div>思维导图格式错误</div>
        </div>
      `;
      return;
    }

    // 解码 HTML 实体
    const encodedMarkdown = match[1];
    const markdownContent = normalizeMindmapMarkdown(
      decodeHtmlFragmentToText(doc, encodedMarkdown),
    );

    if (!markdownContent.trim()) {
      container.innerHTML = `
        <div style="text-align: center; color: #9e9e9e; padding: 16px;">
          <div style="font-size: 24px; margin-bottom: 8px;">📄</div>
          <div>思维导图内容为空</div>
        </div>
      `;
      return;
    }

    // 清空容器
    container.innerHTML = "";

    // 使用 iframe 架构渲染思维导图
    // mindmap.html 在完整的 DOM 环境中运行，可以使用 markmap 等 UI 库
    try {
      // 高度控制
      const DEFAULT_MINDMAP_HEIGHT = 400;
      let savedMindmapHeight = parseInt(
        (getPref("sidebarMindmapHeight" as any) as string) ||
          String(DEFAULT_MINDMAP_HEIGHT),
        10,
      );
      if (isNaN(savedMindmapHeight) || savedMindmapHeight < 100) {
        savedMindmapHeight = DEFAULT_MINDMAP_HEIGHT;
      }

      // 创建 iframe 容器
      const iframeWrapper = doc.createElement("div");
      iframeWrapper.id = "ai-butler-mindmap-wrapper";
      iframeWrapper.style.cssText = `
        width: 100%;
        height: ${savedMindmapHeight}px;
        min-height: 100px;
        border: 1px solid #e0e0e0;
        border-radius: 8px;
        overflow: hidden;
        background: #fafafa;
      `;

      // 创建 iframe
      const iframe = doc.createElement("iframe");
      iframe.id = "ai-butler-mindmap-iframe";
      iframe.style.cssText = `
        width: 100%;
        height: 100%;
        border: none;
      `;

      // 获取插件路径并构建 mindmap.html 的 URL
      // Zotero 7 使用 chrome:// 协议访问插件资源
      const rootURI = `chrome://${config.addonRef}/content/`;
      iframe.src = rootURI + "mindmap.html";

      // 保存 markdown 内容用于后续发送
      const mdContent = markdownContent;

      // 监听 iframe 的消息（ready 和 export）
      const messageHandler = async (event: MessageEvent) => {
        if (event.data && event.data.type === "mindmap-ready") {
          ztoolkit.log(
            "[AI-Butler] 收到 iframe ready 消息，发送 markdown 数据",
          );
          try {
            iframe.contentWindow?.postMessage(
              {
                type: "render-mindmap",
                markdown: mdContent,
              },
              "*",
            );
            ztoolkit.log("[AI-Butler] 已发送 markdown 数据到 iframe");
          } catch (e) {
            ztoolkit.log("[AI-Butler] 发送数据到 iframe 失败:", e);
          }
        }

        if (event.data && event.data.type === "open-mindmap-viewer") {
          ztoolkit.log("[AI-Butler] 收到打开思维导图预览窗口请求");
          try {
            await openMindmapViewerWindow(mdContent, targetItem);
          } catch (e) {
            ztoolkit.log("[AI-Butler] 打开思维导图预览窗口失败:", e);
            new ztoolkit.ProgressWindow("AI Butler", {
              closeOnClick: true,
              closeTime: 3000,
            })
              .createLine({
                text: "打开思维导图预览窗口失败",
                type: "error",
              })
              .show();
          }
        }

        // 处理导出请求
        if (event.data && event.data.type === "export-mindmap") {
          ztoolkit.log("[AI-Butler] 收到导出请求, 格式:", event.data.format);
          try {
            const format = event.data.format || "png";
            const filename = event.data.filename || `mindmap.${format}`;

            // 获取导出目录（优先使用用户配置，否则使用桌面）
            let downloadDir: string = "";
            const customPath =
              (getPref("mindmapExportPath" as any) as string) || "";

            if (customPath && customPath.trim()) {
              // 使用用户自定义路径
              downloadDir = customPath.trim();
              // 确保目录存在
              try {
                await IOUtils.makeDirectory(downloadDir, {
                  ignoreExisting: true,
                });
              } catch (e) {
                ztoolkit.log("[AI-Butler] 自定义目录创建失败，回退到桌面:", e);
                downloadDir = "";
              }
            }

            if (!downloadDir) {
              try {
                // 使用 Services.dirsvc 获取桌面目录
                const desktopDir = Services.dirsvc.get("Desk", Ci.nsIFile);
                downloadDir = desktopDir.path;
              } catch (e) {
                ztoolkit.log(
                  "[AI-Butler] 无法获取桌面目录，使用 Zotero 数据目录:",
                  e,
                );
                // 回退到 Zotero 数据目录
                const dataDir = Zotero.DataDirectory.dir;
                downloadDir = PathUtils.join(dataDir, "mindmaps");
                try {
                  await IOUtils.makeDirectory(downloadDir, {
                    ignoreExisting: true,
                  });
                } catch (e2) {
                  downloadDir = dataDir;
                }
              }
            }

            const filePath = PathUtils.join(downloadDir, filename);

            if (format === "png") {
              // PNG 导出
              const dataUrl = event.data.dataUrl;
              const base64Data = dataUrl.replace(
                /^data:image\/png;base64,/,
                "",
              );
              const binaryString = atob(base64Data);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              await IOUtils.write(filePath, bytes);
            } else if (format === "opml") {
              // OPML 导出
              const content = event.data.content;
              const encoder = new TextEncoder();
              const bytes = encoder.encode(content);
              await IOUtils.write(filePath, bytes);
            }

            ztoolkit.log("[AI-Butler] 思维导图已保存到:", filePath);

            // 显示通知
            new ztoolkit.ProgressWindow("思维导图已导出")
              .createLine({
                text: `已保存到桌面: ${filename}`,
                type: "success",
              })
              .show();

            // 打开文件
            try {
              Zotero.launchFile(filePath);
            } catch (e) {
              // 忽略打开文件失败
            }
          } catch (e) {
            ztoolkit.log("[AI-Butler] 保存思维导图失败:", e);
            new ztoolkit.ProgressWindow("导出失败")
              .createLine({
                text: `错误: ${e}`,
                type: "error",
              })
              .show();
          }
        }
      };

      if (mindmapWin) {
        mindmapWin.__aiButlerMindmapMessageHandler = messageHandler;
        mindmapWin.addEventListener("message", messageHandler);
      }

      // 监听 iframe 加载完成（备用方案）
      iframe.addEventListener("load", () => {
        ztoolkit.log("[AI-Butler] mindmap.html 加载完成");

        // 备用：如果 500ms 内没收到 ready 消息，直接发送
        setTimeout(() => {
          try {
            ztoolkit.log("[AI-Butler] 备用方案：直接发送数据");
            iframe.contentWindow?.postMessage(
              {
                type: "render-mindmap",
                markdown: mdContent,
              },
              "*",
            );
          } catch (e) {
            ztoolkit.log("[AI-Butler] 发送数据到 iframe 失败:", e);
          }
        }, 500);
      });

      iframeWrapper.appendChild(iframe);
      container.appendChild(iframeWrapper);

      // 创建高度调整手柄
      const resizeHandle = createResizeHandle(
        doc,
        iframeWrapper,
        "sidebarMindmapHeight",
      );
      container.appendChild(resizeHandle);

      ztoolkit.log("[AI-Butler] 思维导图 iframe 创建成功");
    } catch (renderError: any) {
      ztoolkit.log("[AI-Butler] 思维导图渲染失败:", renderError);

      // 回退显示格式化的 Markdown
      container.innerHTML = `
        <div style="text-align: left; padding: 15px; font-size: 12px; background: #fff; border-radius: 8px; overflow: auto; max-height: 400px; white-space: pre-wrap; font-family: monospace; line-height: 1.6;">${markdownContent.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
      `;
    }
  } catch (err: any) {
    ztoolkit.log("[AI-Butler] 加载思维导图失败:", err);
    container.innerHTML = `<div style="color: #d32f2f; padding: 10px;">加载思维导图失败: ${err.message}</div>`;
  }
}

/**
 * 渲染聊天区域

 */
function renderChatArea(
  body: HTMLElement,
  doc: Document,
  item: Zotero.Item,
  initiallyVisible = false,
): void {
  const chatArea = doc.createElement("div");
  chatArea.id = "ai-butler-inline-chat";
  chatArea.style.cssText = `
    display: ${initiallyVisible ? "flex" : "none"};
    flex-direction: column;
    border: 1px solid rgba(128, 128, 128, 0.3);
    border-radius: 6px;
    overflow: hidden;
    background: transparent;
    margin-bottom: 12px;
  `;

  const chatHeader = doc.createElement("div");
  chatHeader.style.cssText = `
    padding: 8px 10px;
    background: rgba(89, 192, 188, 0.1);
    border-bottom: 1px solid rgba(89, 192, 188, 0.2);
    font-size: 12px;
    font-weight: 500;
  `;
  chatHeader.textContent = "💬 快速提问";

  // 消息显示区
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
    border-top: 1px solid rgba(128, 128, 128, 0.2);
    background: transparent;
  `;

  const inputBox = doc.createElement("textarea");
  inputBox.placeholder = "输入问题...";
  inputBox.style.cssText = `
    flex: 1;
    min-height: 36px;
    max-height: 80px;
    padding: 6px 8px;
    border: 1px solid rgba(128, 128, 128, 0.3);
    border-radius: 4px;
    resize: none;
    font-size: 12px;
    font-family: inherit;
    color: inherit;
    background: transparent;
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

  inputArea.appendChild(inputBox);
  inputArea.appendChild(sendBtn);
  chatArea.appendChild(chatHeader);
  chatArea.appendChild(messagesArea);
  chatArea.appendChild(inputArea);
  body.appendChild(chatArea);

  const setQuickChatButtonActive = (
    quickChatBtn: HTMLButtonElement | undefined,
    active: boolean,
  ): void => {
    if (!quickChatBtn) return;
    quickChatBtn.style.background = active
      ? "rgba(89, 192, 188, 0.15)"
      : "transparent";
    quickChatBtn.style.borderColor = active ? "#4db6ac" : "#59c0bc";
  };

  const loadPdfContentIfNeeded = async (): Promise<void> => {
    // 如果尚未加载 PDF 内容，则加载
    if (!currentChatState.pdfContent && item) {
      try {
        const { PDFExtractor } = await import("./pdfExtractor");
        const prefMode =
          (getPref("pdfProcessMode" as any) as string) || "base64";
        const isBase64 = prefMode === "base64";

        messagesArea.innerHTML = `<div style="color: #999; text-align: center; padding: 10px;">📄 正在加载论文内容...</div>`;

        let pdfContent = "";
        if (isBase64) {
          pdfContent = await PDFExtractor.extractBase64FromItem(item);
        } else {
          pdfContent = await PDFExtractor.extractTextFromItem(item);
        }

        if (pdfContent) {
          currentChatState.pdfContent = pdfContent;
          currentChatState.isBase64 = isBase64;
          messagesArea.innerHTML = `<div style="color: #4caf50; text-align: center; padding: 10px;">✅ 论文内容已加载，可以开始提问！</div>`;
        } else {
          messagesArea.innerHTML = `<div style="color: #f44336; text-align: center; padding: 10px;">❌ 无法加载论文内容，请确保该文献有 PDF 附件</div>`;
        }
      } catch (err: any) {
        ztoolkit.log("[AI-Butler] 快速提问加载 PDF 失败:", err);
        messagesArea.innerHTML = `<div style="color: #f44336; text-align: center; padding: 10px;">❌ 加载失败: ${err?.message || "未知错误"}</div>`;
      }
    }
  };

  const showChatArea = async (
    quickChatBtn: HTMLButtonElement | undefined,
  ): Promise<void> => {
    chatArea.style.display = "flex";
    setQuickChatButtonActive(quickChatBtn, true);
    inputBox.focus();
    await loadPdfContentIfNeeded();
  };

  const hideChatArea = (quickChatBtn: HTMLButtonElement | undefined): void => {
    chatArea.style.display = "none";
    setQuickChatButtonActive(quickChatBtn, false);
  };

  const previousToggleListener = quickChatToggleListeners.get(body);
  if (previousToggleListener) {
    body.removeEventListener(
      "ai-butler-toggle-inline-chat",
      previousToggleListener,
    );
  }

  const toggleListener: EventListener = (event: Event) => {
    const detail = (
      event as CustomEvent<{ button?: HTMLButtonElement | undefined }>
    ).detail;
    const quickChatBtn = detail?.button;
    if (chatArea.style.display === "none") {
      void showChatArea(quickChatBtn);
    } else {
      hideChatArea(quickChatBtn);
    }
  };
  body.addEventListener("ai-butler-toggle-inline-chat", toggleListener);
  quickChatToggleListeners.set(body, toggleListener);

  if (initiallyVisible) {
    void loadPdfContentIfNeeded();
  }

  // 发送消息处理 - 快速提问（不保存历史，每次只发送论文+当前问题）
  sendBtn.addEventListener("click", async () => {
    const question = inputBox.value.trim();
    if (!question) return;

    // 检查是否正在聊天中
    if (currentChatState.isChatting) {
      return;
    }

    // 检查是否有 PDF 内容
    if (!currentChatState.pdfContent) {
      messagesArea.innerHTML = `<div style="color: #f44336; text-align: center; padding: 10px;">❌ 请先等待论文内容加载完成</div>`;
      return;
    }

    // 设置为正在聊天状态
    currentChatState.isChatting = true;
    sendBtn.textContent = "发送中...";
    sendBtn.style.background = "#9e9e9e";
    (sendBtn as HTMLButtonElement).disabled = true;
    (inputBox as HTMLTextAreaElement).disabled = true;

    // 生成唯一对话对 ID
    quickChatPairIdCounter++;
    const pairId = `quick_${Date.now()}_${quickChatPairIdCounter}`;

    // 创建对话对容器
    const pairWrapper = doc.createElement("div");
    pairWrapper.style.cssText = `
      margin-bottom: 12px;
      padding: 8px;
      border: 1px solid rgba(128, 128, 128, 0.2);
      border-radius: 8px;
      background: transparent;
    `;
    pairWrapper.setAttribute("data-pair-id", pairId);

    // 显示用户问题
    const userMsgDiv = doc.createElement("div");
    userMsgDiv.style.cssText = `
      margin-bottom: 8px;
      padding: 8px;
      background: rgba(89, 192, 188, 0.1);
      border-radius: 6px;
      border-left: 3px solid #59c0bc;
    `;
    userMsgDiv.innerHTML = `<strong>👤 您:</strong> ${escapeHtmlForChat(question)}`;
    pairWrapper.appendChild(userMsgDiv);

    // 创建 AI 回复区域
    const aiMsgDiv = doc.createElement("div");
    aiMsgDiv.style.cssText = `
      margin-bottom: 8px;
      padding: 8px;
      background: rgba(128, 128, 128, 0.05);
      border-radius: 6px;
      border-left: 3px solid #667eea;
    `;
    aiMsgDiv.innerHTML = `<strong>🤖 AI管家:</strong> <em style="color: #999;">思考中...</em>`;
    pairWrapper.appendChild(aiMsgDiv);

    // 创建保存按钮区域（初始隐藏）
    const saveArea = doc.createElement("div");
    saveArea.style.cssText = `
      display: none;
      justify-content: flex-end;
      margin-top: 4px;
    `;
    const saveBtn = doc.createElement("button");
    saveBtn.textContent = "💾 保存为笔记";
    saveBtn.style.cssText = `
      padding: 4px 10px;
      background: #667eea;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
    `;
    saveArea.appendChild(saveBtn);
    pairWrapper.appendChild(saveArea);

    messagesArea.appendChild(pairWrapper);

    // 清空输入框
    inputBox.value = "";

    // 滚动到底部
    messagesArea.scrollTop = messagesArea.scrollHeight;

    try {
      // 导入 LLMClient
      const { default: LLMClient } = await import("./llmClient");

      // 快速提问的关键：每次只发送论文+当前问题，不累积历史
      const conversationHistory = [{ role: "user", content: question }];

      let fullResponse = "";
      await LLMClient.chatWithRetry(
        currentChatState.pdfContent,
        currentChatState.isBase64,
        conversationHistory,
        (chunk: string) => {
          fullResponse += chunk;
          // 流式更新 AI 回复
          aiMsgDiv.innerHTML = `<strong>🤖 AI管家:</strong><br/>${escapeHtmlForChat(fullResponse)}`;
          // 滚动到底部
          messagesArea.scrollTop = messagesArea.scrollHeight;
        },
      );

      // 完成后最终更新
      aiMsgDiv.innerHTML = `<strong>🤖 AI管家:</strong><br/>${escapeHtmlForChat(fullResponse)}`;

      // 显示保存按钮
      saveArea.style.display = "flex";

      // 保存按钮点击事件
      saveBtn.addEventListener("click", async () => {
        // 检查是否已保存过
        if (currentChatState.savedPairIds.has(pairId)) {
          saveBtn.textContent = "✅ 已保存";
          return;
        }

        // 标记正在保存
        saveBtn.textContent = "💾 保存中...";
        saveBtn.style.background = "#9e9e9e";
        (saveBtn as HTMLButtonElement).disabled = true;

        try {
          await saveChatPairToNote(item, pairId, question, fullResponse);
          currentChatState.savedPairIds.add(pairId);
          saveBtn.textContent = "✅ 已保存";
          saveBtn.style.background = "#4caf50";
        } catch (err: any) {
          ztoolkit.log("[AI-Butler] 保存快速提问对话失败:", err);
          saveBtn.textContent = "❌ 保存失败";
          saveBtn.style.background = "#f44336";
          (saveBtn as HTMLButtonElement).disabled = false;
        }
      });
    } catch (err: any) {
      ztoolkit.log("[AI-Butler] 快速提问发送失败:", err);
      aiMsgDiv.innerHTML = `<strong>🤖 AI管家:</strong> <span style="color: #f44336;">❌ 错误: ${err?.message || "发送失败"}</span>`;
    } finally {
      // 恢复状态
      currentChatState.isChatting = false;
      sendBtn.textContent = "发送";
      sendBtn.style.background = "#59c0bc";
      (sendBtn as HTMLButtonElement).disabled = false;
      (inputBox as HTMLTextAreaElement).disabled = false;
      inputBox.focus();
    }
  });

  // Enter 发送，Shift+Enter 换行
  inputBox.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendBtn.click();
    }
  });
}

/**
 * 转义 HTML 字符（用于聊天显示）
 */
function escapeHtmlForChat(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/\n/g, "<br/>");
}

/**
 * 获取或创建"AI管家-后续追问"独立笔记
 */
async function getOrCreateChatNote(item: Zotero.Item): Promise<Zotero.Item> {
  const title = (item.getField("title") as string) || "文献";

  // 查找已有的聊天笔记
  const noteIDs = (item as any).getNotes?.() || [];
  for (const nid of noteIDs) {
    try {
      const n = await Zotero.Items.getAsync(nid);
      if (!n) continue;
      const tags: Array<{ tag: string }> = (n as any).getTags?.() || [];
      const hasChatTag = tags.some((t) => t.tag === "AI-Butler-Chat");
      const html: string = (n as any).getNote?.() || "";
      const titleMatch = /<h2>\s*AI 管家\s*-\s*后续追问\s*-/.test(html);
      if (hasChatTag || titleMatch) {
        return n as Zotero.Item;
      }
    } catch (e) {
      continue;
    }
  }

  // 创建新笔记
  const note = new Zotero.Item("note");
  note.libraryID = item.libraryID;
  note.parentID = item.id;
  const header = `<h2>AI 管家 - 后续追问 - ${escapeHtmlForNote(title)}</h2>`;
  note.setNote(header);
  note.addTag("AI-Butler-Chat");
  await note.saveTx();
  return note;
}

/**
 * 转义 HTML 字符（用于笔记保存）
 */
function escapeHtmlForNote(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * 将对话对保存到后续追问笔记
 */
async function saveChatPairToNote(
  item: Zotero.Item,
  pairId: string,
  userMessage: string,
  assistantMessage: string,
): Promise<void> {
  const note = await getOrCreateChatNote(item);
  let noteHtml = (note as any).getNote?.() || "";

  // 检查是否已存在相同 pairId 的对话对，防止重复保存
  if (noteHtml.includes(`AI_BUTLER_CHAT_PAIR_START id=${pairId}`)) {
    ztoolkit.log("[AI-Butler] 该对话对已保存过，跳过重复保存");
    return;
  }

  const jsonMarker = `<!-- AI_BUTLER_CHAT_JSON: ${JSON.stringify({ id: pairId, user: userMessage, assistant: assistantMessage })} -->`;
  const block = `
<!-- AI_BUTLER_CHAT_PAIR_START id=${escapeHtmlForNote(pairId)} -->
${jsonMarker}
<div id="ai-butler-pair-${escapeHtmlForNote(pairId)}" style="margin-top:14px; padding-top:8px; border-top:1px dashed #ccc;">
  <div style="background-color:#e3f2fd; padding:10px; border-radius:6px; margin-bottom:8px;"><strong>👤 用户:</strong> ${escapeHtmlForNote(userMessage)}</div>
  <div style="background-color:#f5f5f5; padding:10px; border-radius:6px;"><strong>🤖 AI管家:</strong><br/>${escapeHtmlForNote(assistantMessage).replace(/\n/g, "<br/>")}</div>
  <div style="font-size:11px; color:#999; margin-top:6px;">保存时间: ${new Date().toLocaleString("zh-CN")} (来自快速提问)</div>
</div>
<!-- AI_BUTLER_CHAT_PAIR_END id=${escapeHtmlForNote(pairId)} -->
`;

  noteHtml += block;
  (note as any).setNote(noteHtml);
  await (note as any).saveTx();
  ztoolkit.log("[AI-Butler] 快速提问对话已保存到笔记");
}

/**
 * 创建区块标题栏
 */
function createSectionHeader(
  doc: Document,
  title: string,
  color: string,
): HTMLElement {
  const header = doc.createElement("div");
  header.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    background: rgba(128, 128, 128, 0.1);
    cursor: pointer;
    user-select: none;
    border-bottom: 1px solid rgba(128, 128, 128, 0.2);
  `;

  const titleSpan = doc.createElement("span");
  titleSpan.style.cssText = `
    font-weight: 500;
    font-size: 12px;
    color: ${color};
    display: flex;
    align-items: center;
    gap: 6px;
  `;
  titleSpan.textContent = title;

  header.appendChild(titleSpan);
  return header;
}

/**
 * 创建高度调整手柄
 */
function createResizeHandle(
  doc: Document,
  target: HTMLElement,
  prefKey: string,
): HTMLElement {
  const resizeHandle = doc.createElement("div");
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

  let isResizing = false;
  let startY = 0;
  let startHeight = 0;

  resizeHandle.addEventListener("mousedown", (e: MouseEvent) => {
    isResizing = true;
    startY = e.clientY;
    startHeight = target.offsetHeight;
    if (doc.body) doc.body.style.cursor = "ns-resize";
    e.preventDefault();
  });

  doc.addEventListener("mousemove", (e: MouseEvent) => {
    if (!isResizing) return;
    const deltaY = e.clientY - startY;
    const newHeight = Math.max(50, startHeight + deltaY);
    target.style.height = `${newHeight}px`;
  });

  doc.addEventListener("mouseup", () => {
    if (isResizing) {
      isResizing = false;
      if (doc.body) doc.body.style.cursor = "";
      const currentHeight = target.offsetHeight;
      setPref(prefKey as any, String(currentHeight) as any);
    }
  });

  return resizeHandle;
}

/**
 * 异步加载笔记内容
 */
async function loadNoteContent(
  doc: Document,
  item: Zotero.Item,
  noteContent: HTMLElement,
): Promise<void> {
  try {
    // 获取正确的父条目
    let targetItem: any = item;
    if (item.isAttachment && item.isAttachment()) {
      const parentId = item.parentItemID;
      if (parentId) {
        targetItem = await Zotero.Items.getAsync(parentId);
      }
    }

    // 查找 AI 生成的笔记
    const noteIDs = (targetItem as any).getNotes?.() || [];
    let aiNoteContent = "";
    let targetNote: any = null;

    for (const nid of noteIDs) {
      try {
        const n = await Zotero.Items.getAsync(nid);
        if (!n) continue;
        const tags: Array<{ tag: string }> = (n as any).getTags?.() || [];
        const noteHtml: string = (n as any).getNote?.() || "";

        // 检查是否是 AI-Butler 生成的摘要笔记
        // 排除: 思维导图笔记、一图总结笔记、对话笔记
        const isMindmapNote =
          tags.some((t) => t.tag === "AI-Mindmap") ||
          /AI\s*管家思维导图\s*-/.test(noteHtml);
        const isImageSummaryNote =
          tags.some((t) => t.tag === "AI-Image-Summary") ||
          /AI\s*管家一图总结\s*-/.test(noteHtml);
        const isChatNote =
          tags.some((t) => t.tag === "AI-Butler-Chat") ||
          /<h2>\s*AI\s+管家\s*-\s*后续追问\s*-/.test(noteHtml);
        // 严格匹配: 必须满足以下条件之一
        // 1. 有 AI-Generated 标签 且 不是其他特殊类型
        // 2. 标题精确匹配 "<h2>AI 管家 - " 格式
        const hasAiGeneratedTag = tags.some((t) => t.tag === "AI-Generated");
        const isTableNote = tags.some((t) => t.tag === "AI-Table");
        const isAiSummaryNote =
          !isMindmapNote &&
          !isImageSummaryNote &&
          !isChatNote &&
          !isTableNote &&
          (hasAiGeneratedTag ||
            noteHtml.includes("<h2>AI 管家 - ") ||
            noteHtml.includes("[AI-Butler]"));

        if (isAiSummaryNote) {
          if (!targetNote) {
            targetNote = n;
          } else {
            const a = (targetNote as any).dateModified || 0;
            const b = (n as any).dateModified || 0;
            if (b > a) targetNote = n;
          }
        }
      } catch (e) {
        continue;
      }
    }

    if (!targetNote) {
      noteContent.innerHTML = `
        <div style="text-align: center; color: #9e9e9e; padding: 16px;">
          <div style="font-size: 24px; margin-bottom: 8px;">📝</div>
          <div>暂无 AI 笔记</div>
        </div>
      `;
      return;
    }

    aiNoteContent = (targetNote as any).getNote?.() || "";

    // 加载主题 CSS
    const { themeManager } = await import("./themeManager");
    const themeCss = await themeManager.loadThemeCss();
    const katexCss = await themeManager.loadKatexCss();
    const adaptedCss = themeManager.adaptCssForSidebar(themeCss);

    // 注入样式
    let styleEl = doc.getElementById(
      "ai-butler-note-theme",
    ) as HTMLStyleElement;
    if (!styleEl) {
      styleEl = doc.createElement("style");
      styleEl.id = "ai-butler-note-theme";
      const insertTarget = doc.body || doc.documentElement;
      if (insertTarget) {
        insertTarget.appendChild(styleEl);
      }
    }
    styleEl.textContent = katexCss + "\n" + adaptedCss;

    /**
     * 清理 LaTeX 公式中的 HTML 标签
     * LLM 有时会在公式中输出 <br> 等 HTML 标签，需要在渲染前移除
     */
    const cleanLatex = (latex: string): string => {
      return latex
        .replace(/<br\s*\/?>/gi, " ") // <br> or <br/> -> 空格
        .replace(/<[^>]+>/g, ""); // 移除其他 HTML 标签
    };

    // Pre-render LaTeX formulas BEFORE XML validation
    // This prevents LaTeX syntax (like \begin{cases}) from causing XML parsing errors
    const renderLatexFormulas = (content: string): string => {
      let result = content;

      // 1. Render Zotero native format: <span class="math">...</span> (contains $...$ or $$...$$)
      result = result.replace(
        /<span class="math">([\s\S]*?)<\/span>/g,
        (_match: string, innerContent: string) => {
          // content might be $x$ or $$x$$ or escaped HTML
          const unescaped = innerContent
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#039;/g, "'");

          const trimmed = unescaped.trim();

          // Check for block formula markers
          // 1. Double dollar signs $$...$$
          // 2. Single dollar sign with \displaystyle (Zotero native block format)
          const isDoubleDollar =
            trimmed.startsWith("$$") && trimmed.endsWith("$$");
          const isSingleDollar =
            trimmed.startsWith("$") && trimmed.endsWith("$");
          const hasDisplayStyle = trimmed.includes("\\displaystyle");

          const isBlock = isDoubleDollar || (isSingleDollar && hasDisplayStyle);

          if (isBlock) {
            // Removing delimiters
            let latex = "";
            if (isDoubleDollar) {
              latex = trimmed.slice(2, -2);
            } else {
              latex = trimmed.slice(1, -1);
            }

            try {
              const rendered = katex.renderToString(cleanLatex(latex), {
                throwOnError: false,
                displayMode: true,
                output: "html",
                trust: true,
                strict: false,
              });
              return `<div class="katex-scroll-container" style="width: 100%; overflow-x: auto; overflow-y: visible;"><div class="katex-display">${rendered}</div></div>`;
            } catch {
              return `<code>${innerContent}</code>`;
            }
          } else if (isSingleDollar) {
            const latex = trimmed.slice(1, -1);
            try {
              const rendered = katex.renderToString(cleanLatex(latex), {
                throwOnError: false,
                displayMode: false, // inline
                output: "html",
                trust: true,
                strict: false,
              });
              // 检查渲染后HTML长度，超过阈值则转为块级可滚动公式
              if (rendered.length > INLINE_FORMULA_TO_BLOCK_THRESHOLD) {
                return `<div class="katex-scroll-container" style="width: 100%; overflow-x: auto; overflow-y: visible;"><div class="katex-display">${rendered}</div></div>`;
              }
              return `<span class="katex-inline">${rendered}</span>`;
            } catch {
              return `<code>${innerContent}</code>`;
            }
          }

          // plain text inside span.math? just return as is
          return _match;
        },
      );

      // 3. Render legacy block formulas $$...$$ (backward compatibility)
      result = result.replace(
        /\$\$([\s\S]*?)\$\$/g,
        (_match: string, formula: string) => {
          try {
            const rendered = katex.renderToString(cleanLatex(formula.trim()), {
              throwOnError: false,
              displayMode: true,
              output: "html",
              trust: true,
              strict: false,
            });
            return `<div class="katex-scroll-container" style="width: 100%; overflow-x: auto; overflow-y: visible;"><div class="katex-display">${rendered}</div></div>`;
          } catch {
            // Render failed, escape the formula for safe display
            const escaped = formula
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;");
            return `<code>$$${escaped}$$</code>`;
          }
        },
      );

      // 4. Render legacy inline formulas $...$ (backward compatibility)
      // Use RegExp constructor to avoid ESLint escape warnings
      // In RegExp string: \\$ becomes \$ in pattern (matches literal $)
      const inlineRegex = new RegExp(
        "(?<!\\$)\\$(?!\\$)([^\\$\\n]+?)\\$(?!\\$)",
        "g",
      );
      result = result.replace(
        inlineRegex,
        (_match: string, formula: string) => {
          try {
            const rendered = katex.renderToString(cleanLatex(formula.trim()), {
              throwOnError: false,
              displayMode: false,
              output: "html",
              trust: true,
              strict: false,
            });
            // 检查渲染后HTML长度，超过阈值则转为块级可滚动公式
            if (rendered.length > INLINE_FORMULA_TO_BLOCK_THRESHOLD) {
              return `<div class="katex-scroll-container" style="width: 100%; overflow-x: auto; overflow-y: visible;"><div class="katex-display">${rendered}</div></div>`;
            }
            return `<span class="katex-inline">${rendered}</span>`;
          } catch {
            // Render failed, escape the formula for safe display
            const escaped = formula
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;");
            return `<code>$${escaped}$</code>`;
          }
        },
      );

      return result;
    };

    // Render LaTeX first (before XML validation)
    const latexRenderedContent = renderLatexFormulas(aiNoteContent);

    // Sanitize HTML for XHTML compatibility
    // 1. Convert void elements to self-closing
    const sanitizedContent = latexRenderedContent
      .replace(/<hr\s*(?:([^>/]*))?>/gi, "<hr $1/>")
      .replace(/<br\s*(?:([^>/]*))?>/gi, "<br $1/>")
      .replace(/<img\s+([^>]*)(?<!\/)>/gi, "<img $1/>")
      .replace(/<input\s+([^>]*)(?<!\/)>/gi, "<input $1/>")
      .replace(/<meta\s+([^>]*)(?<!\/)>/gi, "<meta $1/>")
      .replace(/<link\s+([^>]*)(?<!\/)>/gi, "<link $1/>")
      .replace(/\s+\/>/g, "/>")
      // 2. Escape < symbols that are not part of tags (e.g. math operators: A < B, p < 0)
      // Matches < followed by something that is NOT a letter, /, !, or ?
      // This allows <div... but matches < 0 or <1
      .replace(new RegExp("<(?=[^a-zA-Z/?!])", "g"), "&lt;");

    // 3. Validate with DOMParser
    const parser = new DOMParser();
    const docTest = parser.parseFromString(
      `<div>${sanitizedContent}</div>`,
      "application/xhtml+xml",
    );
    const parserError = docTest.querySelector("parsererror");

    if (parserError) {
      // Extract error details
      const errorText = parserError.textContent || "Unknown XML parsing error";
      const serializer = new XMLSerializer();
      const errorHtml = serializer.serializeToString(parserError);

      // Try to parse line and column from error message
      const locationMatch = errorHtml.match(/Line Number (\d+), Column (\d+)/i);
      let errorLocation = "";
      let errorContext = "";

      if (locationMatch) {
        const line = parseInt(locationMatch[1], 10);
        const col = parseInt(locationMatch[2], 10);
        errorLocation = `Line ${line}, Column ${col}`;

        const lines = sanitizedContent.split(/\r?\n/);
        const errorLineIndex = Math.max(0, line - 1);
        if (lines[errorLineIndex]) {
          errorContext = lines[errorLineIndex].substring(
            Math.max(0, col - 50),
            col + 50,
          );
        } else {
          errorContext = sanitizedContent.substring(
            Math.max(0, line * 50 + col - 50),
            line * 50 + col + 50,
          );
        }
      }

      ztoolkit.log(
        `[AI-Butler] XML Parsing Error: ${errorText}`,
        errorLocation,
      );

      // Helper to escape HTML special chars for safe display
      const escapeHtml = (text: string) =>
        text
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");

      noteContent.innerHTML = "";
      const errorContainer = doc.createElement("div");
      errorContainer.style.cssText = `
        padding: 8px;
        color: #d32f2f;
        background: #ffebee;
        border: 1px solid #ffcdd2;
        border-radius: 4px;
        font-family: monospace;
        font-size: 10px;
        width: 100%;
        box-sizing: border-box;
        overflow: hidden;
      `;

      // Error header with copy button
      const headerRow = doc.createElement("div");
      headerRow.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 5px;
        flex-wrap: wrap;
        gap: 4px;
      `;

      const headerText = doc.createElement("div");
      headerText.style.fontWeight = "bold";
      headerText.textContent = "⚠ 笔记渲染失败 (XML解析错误)";

      // Prepare full error text for copying
      const fullErrorText = `XML Parsing Error\n${errorText}\n\nLocation: ${errorLocation}\n\nContext:\n${errorContext}`;

      const copyBtn = doc.createElement("button");
      copyBtn.textContent = "📋 复制";
      copyBtn.style.cssText = `
        padding: 2px 6px;
        font-size: 12px;
        border: 1px solid #d32f2f;
        border-radius: 3px;
        background: transparent;
        color: #d32f2f;
        cursor: pointer;
        flex-shrink: 0;
      `;
      copyBtn.addEventListener("click", () => {
        try {
          // Use a temporary textarea to copy text
          const textarea = doc.createElement("textarea");
          textarea.value = fullErrorText;
          textarea.style.cssText = "position: fixed; left: -9999px;";
          const insertTarget = doc.body || doc.documentElement;
          if (insertTarget) {
            insertTarget.appendChild(textarea);
            textarea.select();
            doc.execCommand("copy");
            insertTarget.removeChild(textarea);
          }
          copyBtn.textContent = "✅ 已复制";
          setTimeout(() => {
            copyBtn.textContent = "📋 复制";
          }, 2000);
        } catch (e) {
          ztoolkit.log("[AI-Butler] Copy failed:", e);
          copyBtn.textContent = "❌ 失败";
          setTimeout(() => {
            copyBtn.textContent = "📋 复制";
          }, 2000);
        }
      });

      headerRow.appendChild(headerText);
      headerRow.appendChild(copyBtn);
      errorContainer.appendChild(headerRow);

      // Error location
      if (errorLocation) {
        const locationDiv = doc.createElement("div");
        locationDiv.style.cssText = "margin-bottom: 5px; opacity: 0.8;";
        locationDiv.textContent = `📍 ${errorLocation}`;
        errorContainer.appendChild(locationDiv);
      }

      // Full error content (no collapsible, direct display)
      const errorPre = doc.createElement("pre");
      errorPre.style.cssText = `
        margin: 0;
        padding: 6px;
        background: rgba(0,0,0,0.05);
        border-radius: 3px;
        white-space: pre-wrap;
        word-break: break-word;
        overflow-wrap: break-word;
        max-height: 200px;
        overflow-y: auto;
        font-size: 12px;
        line-height: 1.4;
      `;
      errorPre.textContent = errorText;
      errorContainer.appendChild(errorPre);

      noteContent.appendChild(errorContainer);
    } else {
      // LaTeX formulas already rendered before XML validation
      // Oversized inline formulas are already converted to block format during rendering
      // (see INLINE_FORMULA_TO_BLOCK_THRESHOLD constant)
      noteContent.innerHTML = sanitizedContent;
    }
  } catch (err: any) {
    ztoolkit.log("[AI-Butler] 加载笔记失败:", err);
    noteContent.innerHTML = `<div style="color: #d32f2f; padding: 10px;">加载笔记失败: ${err.message}</div>`;
  }
}

/**
 * 异步加载一图总结
 */
async function loadImageSummary(
  doc: Document,
  item: Zotero.Item,
  imageContainer: HTMLElement,
  imageBtnContainer: HTMLElement,
): Promise<void> {
  try {
    // Clear buttons to avoid duplicates on refresh
    imageBtnContainer.innerHTML = "";

    let targetItem: any = item;
    if (item.isAttachment && item.isAttachment()) {
      const parentId = item.parentItemID;
      if (parentId) {
        targetItem = await Zotero.Items.getAsync(parentId);
      }
    }

    // 查找一图总结笔记
    const { ImageNoteGenerator } = await import("./imageNoteGenerator");
    const imageNote =
      await ImageNoteGenerator.findExistingImageNote(targetItem);

    if (!imageNote) {
      // 显示生成按钮
      const generateImageBtn = doc.createElement("button");
      generateImageBtn.textContent = "🖼️ 生成一图总结";
      generateImageBtn.style.cssText = `
        padding: 8px 16px;
        border: 1px solid #9c27b0;
        border-radius: 4px;
        background: transparent;
        color: #9c27b0;
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        transition: all 0.2s ease;
      `;
      generateImageBtn.addEventListener("mouseenter", () => {
        generateImageBtn.style.background = "rgba(156, 39, 176, 0.1)";
      });
      generateImageBtn.addEventListener("mouseleave", () => {
        generateImageBtn.style.background = "transparent";
      });
      generateImageBtn.addEventListener("click", async () => {
        try {
          generateImageBtn.disabled = true;
          generateImageBtn.textContent = "正在加入队列...";
          const { TaskQueueManager } = await import("./taskQueue");
          const queueManager = TaskQueueManager.getInstance();
          await queueManager.addImageSummaryTask(targetItem);
          generateImageBtn.textContent = "✅ 已加入队列";
        } catch (err: any) {
          generateImageBtn.textContent = "❌ 失败";
          setTimeout(() => {
            generateImageBtn.textContent = "🖼️ 生成一图总结";
            generateImageBtn.disabled = false;
          }, 2000);
        }
      });

      imageContainer.innerHTML = `
        <div style="color: #9e9e9e; margin-bottom: 8px;">
          <div style="font-size: 24px; margin-bottom: 4px;">🖼️</div>
          <div style="font-size: 12px;">暂无一图总结</div>
        </div>
      `;
      imageContainer.appendChild(generateImageBtn);
      return;
    }

    // 使用新的提取方法获取图片（支持 data URI 和附件引用）
    const imgSrc = await ImageNoteGenerator.getImageFromNote(imageNote);

    if (!imgSrc) {
      imageContainer.innerHTML = `<div style="color: #9e9e9e; font-size: 12px;">笔记中未找到图片</div>`;
      return;
    }

    // 创建图片元素
    const imgElement = doc.createElement("img");
    imgElement.src = imgSrc;
    imgElement.alt = "一图总结";
    imgElement.style.cssText = `
      width: 100%;
      max-width: 100%;
      height: auto;
      object-fit: contain;
      border-radius: 4px;
      cursor: pointer;
      transition: transform 0.2s ease;
    `;
    imgElement.addEventListener("mouseenter", () => {
      imgElement.style.transform = "scale(1.02)";
    });
    imgElement.addEventListener("mouseleave", () => {
      imgElement.style.transform = "scale(1)";
    });

    // 点击放大
    imgElement.addEventListener("click", () => {
      void openImageSummaryViewerWindow(imgSrc, targetItem).catch((err) => {
        ztoolkit.log(
          "[AI-Butler] 打开一图总结预览窗口失败，回退到覆盖层:",
          err,
        );
        openImageOverlayFallback(doc, imgSrc);
      });
    });

    // 放大按钮
    const zoomBtn = doc.createElement("button");
    zoomBtn.textContent = "🔍";
    zoomBtn.title = "放大查看";
    zoomBtn.style.cssText = `
      padding: 4px 8px;
      border: 1px solid #9c27b0;
      border-radius: 4px;
      background: transparent;
      color: #9c27b0;
      cursor: pointer;
      font-size: 12px;
    `;
    zoomBtn.addEventListener("click", () => imgElement.click());
    imageBtnContainer.appendChild(zoomBtn);

    // 下载按钮
    const downloadBtn = doc.createElement("button");
    downloadBtn.textContent = "⬇️";
    downloadBtn.title = "下载图片";
    downloadBtn.style.cssText = `
      padding: 4px 8px;
      border: 1px solid #9c27b0;
      border-radius: 4px;
      background: transparent;
      color: #9c27b0;
      cursor: pointer;
      font-size: 12px;
    `;
    downloadBtn.addEventListener("click", async () => {
      try {
        if (imgSrc.startsWith("data:")) {
          const [header, base64Data] = imgSrc.split(",");
          const mimeMatch = header.match(/data:([^;]+)/);
          const mimeType = mimeMatch ? mimeMatch[1] : "image/png";
          // Map MIME type to common file extension (jpeg -> jpg)
          const mimeExt = mimeType.split("/")[1] || "png";
          const ext = mimeExt === "jpeg" ? "jpg" : mimeExt;

          const desktopDir = Services.dirsvc.get("Desk", Ci.nsIFile);
          const filename = `AI管家_一图总结_${targetItem
            .getField("title")
            .substring(0, 30)
            .replace(/[\\/:*?"<>|]/g, "_")}.${ext}`;
          const filePath = PathUtils.join(desktopDir.path, filename);

          const binary = atob(base64Data);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }

          await IOUtils.write(filePath, bytes);

          new ztoolkit.ProgressWindow("AI Butler", {
            closeOnClick: true,
            closeTime: 3000,
          })
            .createLine({
              text: `图片已保存到桌面: ${filename}`,
              type: "success",
            })
            .show();
        } else {
          new ztoolkit.ProgressWindow("AI Butler", {
            closeOnClick: true,
            closeTime: 3000,
          })
            .createLine({ text: "仅支持 data URI 格式的图片", type: "error" })
            .show();
        }
      } catch (err: any) {
        ztoolkit.log("[AI-Butler] 下载图片失败:", err);
        new ztoolkit.ProgressWindow("AI Butler", {
          closeOnClick: true,
          closeTime: 3000,
        })
          .createLine({ text: `下载失败: ${err.message}`, type: "error" })
          .show();
      }
    });
    imageBtnContainer.appendChild(downloadBtn);

    // 打开文件夹按钮
    const openFolderBtn = doc.createElement("button");
    openFolderBtn.textContent = "📂";
    openFolderBtn.title = "打开图片所在文件夹";
    openFolderBtn.style.cssText = `
      padding: 4px 8px;
      border: 1px solid #9c27b0;
      border-radius: 4px;
      background: transparent;
      color: #9c27b0;
      cursor: pointer;
      font-size: 12px;
    `;
    openFolderBtn.addEventListener("click", async () => {
      try {
        // 获取图片附件的文件路径
        const imagePath =
          await ImageNoteGenerator.getImageAttachmentPath(imageNote);

        if (imagePath) {
          // 使用 Zotero 的方法打开文件所在文件夹
          const file = Zotero.File.pathToFile(imagePath);
          if (file.exists()) {
            file.reveal();
            new ztoolkit.ProgressWindow("AI Butler", {
              closeOnClick: true,
              closeTime: 2000,
            })
              .createLine({ text: "已打开图片所在文件夹", type: "success" })
              .show();
          } else {
            new ztoolkit.ProgressWindow("AI Butler", {
              closeOnClick: true,
              closeTime: 3000,
            })
              .createLine({ text: "图片文件不存在", type: "error" })
              .show();
          }
        } else {
          new ztoolkit.ProgressWindow("AI Butler", {
            closeOnClick: true,
            closeTime: 3000,
          })
            .createLine({
              text: "未找到图片附件（可能是旧版内嵌图片）",
              type: "error",
            })
            .show();
        }
      } catch (err: any) {
        ztoolkit.log("[AI-Butler] 打开文件夹失败:", err);
        new ztoolkit.ProgressWindow("AI Butler", {
          closeOnClick: true,
          closeTime: 3000,
        })
          .createLine({ text: `打开失败: ${err.message}`, type: "error" })
          .show();
      }
    });
    imageBtnContainer.appendChild(openFolderBtn);

    imageContainer.innerHTML = "";
    imageContainer.appendChild(imgElement);
  } catch (err: any) {
    ztoolkit.log("[AI-Butler] 加载一图总结失败:", err);
    imageContainer.innerHTML = `<div style="color: #d32f2f; font-size: 12px;">加载失败: ${err.message}</div>`;
  }
}

async function openImageSummaryViewerWindow(
  imageDataUri: string,
  targetItem: any,
): Promise<void> {
  const mainWin: any =
    Zotero && (Zotero as any).getMainWindow
      ? (Zotero as any).getMainWindow()
      : (globalThis as any);

  if (typeof mainWin?.openDialog !== "function") {
    throw new Error("openDialog not available");
  }

  let itemTitle = "";
  try {
    const t = targetItem?.getField?.("title");
    itemTitle = typeof t === "string" ? t : "";
  } catch {
    // ignore
  }

  const screenObj: any = mainWin?.screen;
  const width = screenObj
    ? Math.max(800, Math.floor(screenObj.availWidth * 0.95))
    : 1000;
  const height = screenObj
    ? Math.max(600, Math.floor(screenObj.availHeight * 0.95))
    : 800;

  const title = itemTitle ? `一图总结 - ${itemTitle}` : "一图总结";
  const viewerURL = `chrome://${config.addonRef}/content/imageSummaryViewer.html`;

  const dialogWin: any = mainWin.openDialog(
    viewerURL,
    "",
    `chrome,centerscreen,resizable=yes,width=${width},height=${height}`,
    { imageDataUri, title },
  );

  if (!dialogWin) {
    throw new Error("Failed to open viewer window");
  }

  // Extra fallback channel in case window.arguments isn't available for some reason
  try {
    (dialogWin as any).__aiButlerImageDataUri = imageDataUri;
    (dialogWin as any).__aiButlerTitle = title;
  } catch {
    // ignore
  }

  try {
    dialogWin.focus();
  } catch {
    // ignore
  }
}

async function openMindmapViewerWindow(
  markdown: string,
  targetItem: any,
): Promise<void> {
  const mainWin: any =
    Zotero && (Zotero as any).getMainWindow
      ? (Zotero as any).getMainWindow()
      : (globalThis as any);

  if (typeof mainWin?.openDialog !== "function") {
    throw new Error("openDialog not available");
  }

  let itemTitle = "";
  try {
    const t = targetItem?.getField?.("title");
    itemTitle = typeof t === "string" ? t : "";
  } catch {
    // ignore
  }

  const screenObj: any = mainWin?.screen;
  const height = screenObj
    ? Math.max(800, Math.floor(screenObj.availHeight * 0.9))
    : 900;
  let width = Math.max(650, Math.floor(height * 0.75));
  if (screenObj) {
    width = Math.min(width, Math.floor(screenObj.availWidth * 0.9));
  }

  const title = itemTitle ? `思维导图 - ${itemTitle}` : "思维导图";
  const viewerURL = `chrome://${config.addonRef}/content/mindmapViewer.html`;

  const dialogWin: any = mainWin.openDialog(
    viewerURL,
    "",
    `chrome,centerscreen,resizable=yes,width=${width},height=${height}`,
    {
      markdown,
      title,
      prefsPrefix: config.prefsPrefix,
    },
  );

  if (!dialogWin) {
    throw new Error("Failed to open viewer window");
  }

  // Extra fallback channel in case window.arguments isn't available for some reason
  try {
    (dialogWin as any).__aiButlerMindmapMarkdown = markdown;
    (dialogWin as any).__aiButlerTitle = title;
    (dialogWin as any).__aiButlerPrefsPrefix = config.prefsPrefix;
  } catch {
    // ignore
  }

  try {
    dialogWin.focus();
  } catch {
    // ignore
  }
}

function openImageOverlayFallback(doc: Document, imageDataUri: string): void {
  const overlay = doc.createElement("div");
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.9);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    cursor: zoom-out;
  `;

  const fullImg = doc.createElement("img");
  fullImg.src = imageDataUri;
  fullImg.alt = "一图总结";
  fullImg.style.cssText = `
    max-width: 95%;
    max-height: 95%;
    object-fit: contain;
  `;

  overlay.appendChild(fullImg);

  const win: any = doc.defaultView;
  let disposed = false;

  const cleanup = (): void => {
    if (disposed) return;
    disposed = true;
    try {
      overlay.remove();
    } catch {
      // ignore
    }
    try {
      win?.removeEventListener("keydown", onKeyDown, true);
    } catch {
      // ignore
    }
    try {
      win?.removeEventListener("close", onWindowClose, true);
    } catch {
      // ignore
    }
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      cleanup();
    }
  };

  const onWindowClose = (e: any): any => {
    if (!overlay.isConnected) return;
    try {
      e.preventDefault?.();
      e.stopPropagation?.();
      e.stopImmediatePropagation?.();
      e.returnValue = false;
    } catch {
      // ignore
    }
    cleanup();
    return false;
  };

  overlay.addEventListener("click", () => cleanup());
  win?.addEventListener("keydown", onKeyDown, true);
  win?.addEventListener("close", onWindowClose, true);

  if (doc.body) {
    doc.body.appendChild(overlay);
  } else if (doc.documentElement) {
    doc.documentElement.appendChild(overlay);
  }
}

/**
 * 获取 AI 笔记的 Markdown 内容
 *
 * @param item 文献条目
 * @returns Markdown 格式的笔记内容，如果不存在则返回 null
 */
async function getNoteMarkdownContent(
  item: Zotero.Item,
): Promise<string | null> {
  try {
    // 获取正确的父条目
    let targetItem: any = item;
    if (item.isAttachment && item.isAttachment()) {
      const parentId = item.parentItemID;
      if (parentId) {
        targetItem = await Zotero.Items.getAsync(parentId);
      }
    }

    // 查找 AI 生成的笔记
    const noteIDs = (targetItem as any).getNotes?.() || [];
    let targetNote: any = null;

    for (const nid of noteIDs) {
      try {
        const n = await Zotero.Items.getAsync(nid);
        if (!n) continue;
        const tags: Array<{ tag: string }> = (n as any).getTags?.() || [];
        const noteHtml: string = (n as any).getNote?.() || "";

        // 检查是否是 AI-Butler 生成的摘要笔记
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
            const a = (targetNote as any).dateModified || 0;
            const b = (n as any).dateModified || 0;
            if (b > a) targetNote = n;
          }
        }
      } catch (e) {
        continue;
      }
    }

    if (!targetNote) {
      return null;
    }

    const noteHtml: string = (targetNote as any).getNote?.() || "";
    // 将 HTML 转换为 Markdown 文本
    return htmlToMarkdown(noteHtml);
  } catch (err) {
    ztoolkit.log("[AI-Butler] 获取笔记 Markdown 内容失败:", err);
    return null;
  }
}

/**
 * 将 HTML 转换为 Markdown 格式
 *
 * @param html HTML 字符串
 * @returns Markdown 格式的字符串
 */
function htmlToMarkdown(html: string): string {
  let result = html;

  // 移除 style 和 script 标签及其内容
  result = result.replace(/<style[^>]*>.*?<\/style>/gis, "");
  result = result.replace(/<script[^>]*>.*?<\/script>/gis, "");

  // 处理标题
  result = result.replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n\n");
  result = result.replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n\n");
  result = result.replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n\n");
  result = result.replace(/<h4[^>]*>(.*?)<\/h4>/gi, "#### $1\n\n");
  result = result.replace(/<h5[^>]*>(.*?)<\/h5>/gi, "##### $1\n\n");
  result = result.replace(/<h6[^>]*>(.*?)<\/h6>/gi, "###### $1\n\n");

  // 处理粗体和斜体
  result = result.replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**");
  result = result.replace(/<b[^>]*>(.*?)<\/b>/gi, "**$1**");
  result = result.replace(/<em[^>]*>(.*?)<\/em>/gi, "*$1*");
  result = result.replace(/<i[^>]*>(.*?)<\/i>/gi, "*$1*");

  // 处理代码
  result = result.replace(/<code[^>]*>(.*?)<\/code>/gi, "`$1`");
  result = result.replace(/<pre[^>]*>(.*?)<\/pre>/gis, "```\n$1\n```\n");

  // 处理链接
  result = result.replace(
    /<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi,
    "[$2]($1)",
  );

  // 处理列表项
  result = result.replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n");
  result = result.replace(/<ul[^>]*>(.*?)<\/ul>/gis, "$1\n");
  result = result.replace(/<ol[^>]*>(.*?)<\/ol>/gis, "$1\n");

  // 处理段落和换行
  result = result.replace(/<p[^>]*>(.*?)<\/p>/gis, "$1\n\n");
  result = result.replace(/<br\s*\/?>/gi, "\n");
  result = result.replace(/<hr\s*\/?>/gi, "\n---\n\n");

  // 处理 div 标签
  result = result.replace(/<div[^>]*>(.*?)<\/div>/gis, "$1\n");

  // 移除剩余的 HTML 标签
  result = result.replace(/<[^>]+>/g, "");

  // 解码 HTML 实体
  result = result
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");

  // 清理多余的空行
  result = result.replace(/\n{3,}/g, "\n\n");

  return result.trim();
}

function decodeHtmlFragmentToText(doc: Document, html: string): string {
  // Fast path: no tags or entities to decode
  if (!/[&<]/.test(html)) return html;

  try {
    // Use an HTML document to decode named entities like &nbsp; safely.
    // In XML/XUL documents, setting innerHTML with unknown HTML entities may throw.
    const mainWin: any =
      Zotero && (Zotero as any).getMainWindow
        ? (Zotero as any).getMainWindow()
        : (globalThis as any);

    const implementation: any =
      mainWin?.document?.implementation || doc.implementation;
    const createHTMLDocument: any = implementation?.createHTMLDocument;

    if (typeof createHTMLDocument === "function") {
      const htmlDoc: Document = createHTMLDocument.call(implementation, "");
      const container = htmlDoc.createElement("div");
      container.innerHTML = html;
      return (container as any).innerText || container.textContent || "";
    }

    // Fallback to DOMParser in HTML mode
    const parsed = new DOMParser().parseFromString(
      `<!doctype html><body>${html}`,
      "text/html",
    );
    const body = parsed.body;
    return (body as any)?.innerText || body?.textContent || "";
  } catch (e) {
    // Last resort: minimal decoding for common cases
    const decodeNumericEntity = (raw: string): string => {
      const codePoint =
        raw.startsWith("x") || raw.startsWith("X")
          ? parseInt(raw.slice(1), 16)
          : parseInt(raw, 10);
      if (
        !Number.isFinite(codePoint) ||
        codePoint < 0 ||
        codePoint > 0x10ffff
      ) {
        return "";
      }
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return "";
      }
    };

    return html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(div|p|pre)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&#39;/g, "'")
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => decodeNumericEntity(`x${hex}`))
      .replace(/&#(\d+);/g, (_, dec) => decodeNumericEntity(dec));
  }
}

function normalizeMindmapMarkdown(markdown: string): string {
  const normalized = markdown.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ");

  // Strip ASCII control characters except for tab and newline.
  let result = "";
  for (const ch of normalized) {
    const code = ch.charCodeAt(0);
    if (code === 0x09 || code === 0x0a) {
      result += ch;
      continue;
    }
    if (code < 0x20 || code === 0x7f) {
      continue;
    }
    result += ch;
  }

  return result;
}

/**
 * 复制文本到剪贴板
 *
 * @param doc Document 对象
 * @param text 要复制的文本
 */
async function copyToClipboard(doc: Document, text: string): Promise<void> {
  try {
    // 优先使用主窗口的剪贴板 API
    const win: any =
      Zotero && (Zotero as any).getMainWindow
        ? (Zotero as any).getMainWindow()
        : (globalThis as any);

    if (win?.navigator?.clipboard?.writeText) {
      await win.navigator.clipboard.writeText(text);
      return;
    }

    // 回退方案：使用 execCommand
    if (!doc.body) {
      throw new Error("Document body not available");
    }
    const textArea = doc.createElement("textarea");
    textArea.value = text;
    textArea.style.cssText = `
      position: fixed;
      left: -9999px;
      top: -9999px;
    `;
    doc.body.appendChild(textArea);
    textArea.select();

    try {
      doc.execCommand("copy");
    } finally {
      doc.body.removeChild(textArea);
    }
  } catch (err) {
    ztoolkit.log("[AI-Butler] 复制到剪贴板失败:", err);
    throw err;
  }
}

export default { registerItemPaneSection, refreshCurrentItemPaneSection };
