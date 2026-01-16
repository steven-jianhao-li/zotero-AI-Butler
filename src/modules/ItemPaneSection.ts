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
import katex from "katex";

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

// 当前聊天状态
let currentChatState: ChatState = {
  itemId: null,
  pdfContent: "",
  isBase64: false,
  conversationHistory: [],
  isChatting: false,
  savedPairIds: new Set(),
};

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
      savedPairIds: new Set(),
    };
  }

  // 渲染各个区块
  renderActionButtons(body, doc, item, handleOpenAIChat);
  renderNoteSection(body, doc, item);
  renderImageSummarySection(body, doc, item);
  renderChatArea(body, doc, item);
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

  // 刷新按钮
  const refreshBtn = doc.createElement("button");
  refreshBtn.id = "ai-butler-refresh-btn";
  refreshBtn.title = "刷新AI笔记和一图总结";
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
      const noteContent = doc.getElementById(
        "ai-butler-note-content",
      ) as HTMLElement | null;
      if (noteContent) {
        noteContent.innerHTML = `<div style="color: #999; text-align: center; padding: 10px;">正在刷新...</div>`;
        await loadNoteContent(doc, item, noteContent);
      }
      // 刷新一图总结
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
    } catch (err: any) {
      ztoolkit.log("[AI-Butler] 刷新失败:", err);
    } finally {
      // 恢复按钮状态
      refreshBtn.textContent = "🔄";
      refreshBtn.style.pointerEvents = "auto";
    }
  });

  btnContainer.appendChild(fullChatBtn);
  btnContainer.appendChild(quickChatBtn);
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
 * 渲染聊天区域
 */
function renderChatArea(
  body: HTMLElement,
  doc: Document,
  item: Zotero.Item,
): void {
  const chatArea = doc.createElement("div");
  chatArea.id = "ai-butler-inline-chat";
  chatArea.style.cssText = `
    display: none;
    flex-direction: column;
    border: 1px solid rgba(128, 128, 128, 0.3);
    border-radius: 6px;
    overflow: hidden;
    background: transparent;
  `;

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
  chatArea.appendChild(messagesArea);
  chatArea.appendChild(inputArea);
  body.appendChild(chatArea);

  // 快速提问按钮点击事件 - 打开时加载 PDF 内容
  const quickChatBtn = body.querySelector(
    "#ai-butler-quick-chat-btn",
  ) as HTMLButtonElement;
  if (quickChatBtn) {
    quickChatBtn.addEventListener("click", async () => {
      if (chatArea.style.display === "none") {
        chatArea.style.display = "flex";
        quickChatBtn.style.background = "rgba(89, 192, 188, 0.15)";
        quickChatBtn.style.borderColor = "#4db6ac";
        inputBox.focus();

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
      } else {
        chatArea.style.display = "none";
        quickChatBtn.style.background = "transparent";
        quickChatBtn.style.borderColor = "#59c0bc";
      }
    });
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

    // Pre-render LaTeX formulas BEFORE XML validation
    // This prevents LaTeX syntax (like \begin{cases}) from causing XML parsing errors
    const renderLatexFormulas = (content: string): string => {
      let result = content;

      // Render block formulas $$...$$
      result = result.replace(
        /\$\$([\s\S]*?)\$\$/g,
        (_match: string, formula: string) => {
          try {
            const rendered = katex.renderToString(formula.trim(), {
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

      // Render inline formulas $...$
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
            const rendered = katex.renderToString(formula.trim(), {
              throwOnError: false,
              displayMode: false,
              output: "html",
              trust: true,
              strict: false,
            });
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
      // Just use the sanitized content directly
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
      fullImg.src = imgSrc;
      fullImg.style.cssText = `
        max-width: 95%;
        max-height: 95%;
        object-fit: contain;
      `;

      overlay.appendChild(fullImg);
      overlay.addEventListener("click", () => overlay.remove());
      if (doc.body) {
        doc.body.appendChild(overlay);
      } else if (doc.documentElement) {
        doc.documentElement.appendChild(overlay);
      }
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

export default { registerItemPaneSection };
