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

// 侧边栏聊天状态类型
interface ChatState {
  itemId: number | null;
  pdfContent: string;
  isBase64: boolean;
  conversationHistory: Array<{ role: string; content: string }>;
  isChatting: boolean;
}

// 当前聊天状态
let currentChatState: ChatState = {
  itemId: null,
  pdfContent: "",
  isBase64: false,
  conversationHistory: [],
  isChatting: false,
};

// 侧边栏锁定状态（从偏好设置加载）
function isSidebarLocked(): boolean {
  return (getPref("sidebarLocked" as any) as boolean) === true;
}

function setSidebarLocked(locked: boolean): void {
  setPref("sidebarLocked" as any, locked as any);
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

  // 渲染各个区块
  renderActionButtons(body, doc, item, handleOpenAIChat);
  renderNoteSection(body, doc, item);
  renderImageSummarySection(body, doc, item);
  renderChatArea(body, doc, item);

  // 如果侧边栏锁定，调用 Zotero 内部 API 实现置顶效果
  if (isSidebarLocked()) {
    // 使用 setTimeout 确保 DOM 已更新
    setTimeout(() => {
      try {
        // 根据 Zotero 内部逻辑，需要找到 container 并调用 scrollToPane
        // container 是 item-pane-content 或类似的元素
        
        // 方法1：通过 body 向上查找 container 元素（带有 scrollToPane 方法）
        let container: any = body.parentElement;
        while (container) {
          if (typeof container.scrollToPane === "function") {
            container.scrollToPane("ai-butler-chat-section", "smooth");
            ztoolkit.log("[AI-Butler] 已通过 container.scrollToPane 置顶");
            return;
          }
          container = container.parentElement;
        }
        
        // 方法2：查找 item-pane 相关元素
        const itemPane = doc.querySelector("item-pane, #zotero-item-pane-content, .item-pane-content") as any;
        if (itemPane && typeof itemPane.scrollToPane === "function") {
          itemPane.scrollToPane("ai-butler-chat-section", "smooth");
          ztoolkit.log("[AI-Butler] 已通过 itemPane.scrollToPane 置顶");
          return;
        }
        
        // 方法3：通过 Zotero API 获取 itemPane
        const zoteroPane = (Zotero as any).getActiveZoteroPane?.();
        if (zoteroPane?.itemPane?.container?.scrollToPane) {
          zoteroPane.itemPane.container.scrollToPane("ai-butler-chat-section", "smooth");
          ztoolkit.log("[AI-Butler] 已通过 Zotero.getActiveZoteroPane().itemPane.container 置顶");
          return;
        }
        
        // 方法4：直接查找 custom element
        const itemPaneContent = doc.querySelector("item-pane-content, vbox.item-pane-content") as any;
        if (itemPaneContent && typeof itemPaneContent.scrollToPane === "function") {
          itemPaneContent.scrollToPane("ai-butler-chat-section", "smooth");
          ztoolkit.log("[AI-Butler] 已通过 item-pane-content 置顶");
          return;
        }
        
        // 降级方案
        ztoolkit.log("[AI-Butler] 未找到 scrollToPane 方法，使用降级方案");
        body.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (err) {
        ztoolkit.log("[AI-Butler] 自动滚动失败:", err);
        body.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 150);
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
  const fullChatBtn = createButton(doc, getString("itempane-ai-open-chat"), true);
  fullChatBtn.addEventListener("click", async () => {
    try {
      await handleOpenAIChat(item.id);
    } catch (error: any) {
      ztoolkit.log("[AI-Butler] 完整追问按钮点击失败:", error);
    }
  });

  // 快速提问按钮
  const quickChatBtn = createButton(doc, getString("itempane-ai-temp-chat"), false);
  quickChatBtn.id = "ai-butler-quick-chat-btn";

  // 锁定按钮
  const lockBtn = doc.createElement("button");
  const isLocked = isSidebarLocked();
  lockBtn.textContent = isLocked ? "🔒" : "🔓";
  lockBtn.title = isLocked ? "已锁定：切换论文时自动滚动到此处，点击解锁" : "未锁定：点击锁定侧边栏位置";
  lockBtn.style.cssText = `
    padding: 8px 10px;
    border: 1px solid ${isLocked ? "#59c0bc" : "#ccc"};
    border-radius: 4px;
    background: ${isLocked ? "rgba(89, 192, 188, 0.15)" : "transparent"};
    color: ${isLocked ? "#59c0bc" : "#666"};
    cursor: pointer;
    font-size: 14px;
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    justify-content: center;
  `;
  lockBtn.addEventListener("mouseenter", () => {
    lockBtn.style.background = isSidebarLocked() ? "rgba(89, 192, 188, 0.25)" : "rgba(0, 0, 0, 0.05)";
  });
  lockBtn.addEventListener("mouseleave", () => {
    lockBtn.style.background = isSidebarLocked() ? "rgba(89, 192, 188, 0.15)" : "transparent";
  });
  lockBtn.addEventListener("click", () => {
    const newLocked = !isSidebarLocked();
    setSidebarLocked(newLocked);
    lockBtn.textContent = newLocked ? "🔒" : "🔓";
    lockBtn.title = newLocked ? "已锁定：切换论文时自动滚动到此处，点击解锁" : "未锁定：点击锁定侧边栏位置";
    lockBtn.style.borderColor = newLocked ? "#59c0bc" : "#ccc";
    lockBtn.style.color = newLocked ? "#59c0bc" : "#666";
    lockBtn.style.background = newLocked ? "rgba(89, 192, 188, 0.15)" : "transparent";
    
    // 显示提示
    new ztoolkit.ProgressWindow("AI Butler", {
      closeOnClick: true,
      closeTime: 2000,
    }).createLine({ 
      text: newLocked ? "侧边栏已锁定" : "侧边栏已解锁", 
      type: "success" 
    }).show();
  });

  btnContainer.appendChild(fullChatBtn);
  btnContainer.appendChild(quickChatBtn);
  btnContainer.appendChild(lockBtn);
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
    (getPref("sidebarNoteHeight" as any) as string) || String(DEFAULT_NOTE_HEIGHT),
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
    transition: height 0.2s ease;
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
    overflow-x: auto;
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
  const currentTheme = ((getPref("markdownTheme" as any) as string) || "github").toString();
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
    const styleEl = doc.getElementById("ai-butler-note-theme") as HTMLStyleElement;
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
  const resizeHandle = createResizeHandle(doc, noteContentWrapper, "sidebarNoteHeight");

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
      const restoreHeight = parseInt(
        (getPref("sidebarNoteHeight" as any) as string) || String(DEFAULT_NOTE_HEIGHT),
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
    color: #9c27b0;
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
  imageBtnContainer.addEventListener("click", (e: Event) => e.stopPropagation());

  const imageToggleIcon = doc.createElement("span");
  imageToggleIcon.textContent = "▼";
  imageToggleIcon.style.cssText = `
    font-size: 10px;
    color: #9c27b0;
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
    background: #fafafa;
    min-height: 80px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  `;

  // 折叠功能
  let isImageCollapsed = false;
  imageSummaryHeader.addEventListener("click", () => {
    isImageCollapsed = !isImageCollapsed;
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
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    overflow: hidden;
    background: #fafafa;
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

  inputArea.appendChild(inputBox);
  inputArea.appendChild(sendBtn);
  chatArea.appendChild(messagesArea);
  chatArea.appendChild(inputArea);
  body.appendChild(chatArea);

  // 快速提问按钮点击事件
  const quickChatBtn = body.querySelector("#ai-butler-quick-chat-btn") as HTMLButtonElement;
  if (quickChatBtn) {
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
  }

  // 发送消息处理 (简化版，实际逻辑在 hooks.ts 中)
  sendBtn.addEventListener("click", () => {
    const question = inputBox.value.trim();
    if (!question) return;
    // TODO: 调用 LLM 处理
    inputBox.value = "";
  });
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
    let styleEl = doc.getElementById("ai-butler-note-theme") as HTMLStyleElement;
    if (!styleEl) {
      styleEl = doc.createElement("style");
      styleEl.id = "ai-butler-note-theme";
      const insertTarget = doc.body || doc.documentElement;
      if (insertTarget) {
        insertTarget.appendChild(styleEl);
      }
    }
    styleEl.textContent = katexCss + "\n" + adaptedCss;

    noteContent.innerHTML = aiNoteContent;
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
    const imageNote = await ImageNoteGenerator.findExistingImageNote(targetItem);

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
      max-width: 100%;
      height: auto;
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
          const ext = mimeType.split("/")[1] || "png";

          const desktopDir = Services.dirsvc.get("Desk", Ci.nsIFile);
          const filename = `一图总结_${targetItem.getField("title").substring(0, 20).replace(/[\\/:*?"<>|]/g, "_")}.${ext}`;
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
          }).createLine({ text: `图片已保存到桌面: ${filename}`, type: "success" }).show();
        } else {
          new ztoolkit.ProgressWindow("AI Butler", {
            closeOnClick: true,
            closeTime: 3000,
          }).createLine({ text: "仅支持 data URI 格式的图片", type: "error" }).show();
        }
      } catch (err: any) {
        ztoolkit.log("[AI-Butler] 下载图片失败:", err);
        new ztoolkit.ProgressWindow("AI Butler", {
          closeOnClick: true,
          closeTime: 3000,
        }).createLine({ text: `下载失败: ${err.message}`, type: "error" }).show();
      }
    });
    imageBtnContainer.appendChild(downloadBtn);

    imageContainer.innerHTML = "";
    imageContainer.appendChild(imgElement);
  } catch (err: any) {
    ztoolkit.log("[AI-Butler] 加载一图总结失败:", err);
    imageContainer.innerHTML = `<div style="color: #d32f2f; font-size: 12px;">加载失败: ${err.message}</div>`;
  }
}

export default { registerItemPaneSection };
