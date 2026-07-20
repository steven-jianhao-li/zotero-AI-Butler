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
  isTableFeatureEnabled,
  isSidebarModuleEnabled,
  type SidebarModuleId,
} from "./uiCustomization";
import {
  LLMNoteMetadataService,
  type LLMNoteMetadata,
} from "./llmNoteMetadata";
import {
  appendQuickChatTurn,
  buildQuickChatConversation,
  createChatAbortController,
  isChatAbortError,
  type ChatAbortControllerLike,
} from "./chatContext";
import {
  addZoteroNoteOverflowGuards,
  buildFollowUpChatPairNoteHtml,
  decodeMathHtmlEntities,
  normalizeFollowUpChatNoteHtml,
  normalizeLatexForKatex,
  requiresDisplayMath,
  stripMathDelimiters,
} from "./noteMarkdown";
import { AiNoteService, type AiNoteKind } from "./aiNoteService";
import { SummaryView } from "./views/SummaryView";
import katex from "katex";
// 注意: 不在主进程中直接 import 思维导图库（如 markmap-view、simple-mind-map）
// 这些库在加载时会访问 document/window，而 Zotero Background 进程没有 DOM 环境
// 改用 iframe 架构：在独立 HTML 页面中加载这些库

// 侧边栏聊天状态类型
interface ChatState {
  itemId: number | null;
  pdfContent: string;
  isBase64: boolean;
  conversationHistory: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  isChatting: boolean;
  abortController: ChatAbortControllerLike | null;
  savedPairIds: Set<string>; // 已保存的对话对 ID，防止重复保存
}

// 递增的对话对 ID 计数器
let quickChatPairIdCounter = 0;

function getSidebarNoteKindLabel(noteKind: AiNoteKind): string {
  return noteKind === "summary"
    ? getString("itempane-note-kind-summary")
    : getString("itempane-note-kind-deep-read");
}

const SIDEBAR_HEADING_TO_BLOCKQUOTE_TEXT_THRESHOLD = 36;
const SIDEBAR_NOTE_OVERFLOW_GUARD_CSS = `
.ai-butler-note-section,
.ai-butler-note-section *,
.ai-butler-note-content-wrapper,
.ai-butler-note-content-wrapper * {
  box-sizing: border-box;
}
.ai-butler-note-section,
.ai-butler-note-content-wrapper,
.ai-butler-note-content {
  min-width: 0;
  max-width: 100%;
}
.ai-butler-note-content,
.ai-butler-note-content p,
.ai-butler-note-content li,
.ai-butler-note-content blockquote,
.ai-butler-note-content h1,
.ai-butler-note-content h2,
.ai-butler-note-content h3,
.ai-butler-note-content h4,
.ai-butler-note-content h5,
.ai-butler-note-content h6,
.ai-butler-note-content td,
.ai-butler-note-content th {
  overflow-wrap: anywhere;
  word-break: break-word;
}
.ai-butler-note-content pre,
.ai-butler-note-content code,
.ai-butler-note-content .math-fallback {
  max-width: 100%;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.ai-butler-note-content pre,
.ai-butler-note-content table,
.ai-butler-note-content .katex-display,
.ai-butler-note-content .katex-scroll-container {
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
}
.ai-butler-note-content table {
  display: block;
  width: max-content;
  max-width: 100%;
  border-collapse: collapse;
}
.ai-butler-note-content img,
.ai-butler-note-content svg,
.ai-butler-note-content canvas,
.ai-butler-note-content video {
  max-width: 100%;
  height: auto;
}
`;

// 当前聊天状态
let currentChatState: ChatState = {
  itemId: null,
  pdfContent: "",
  isBase64: false,
  conversationHistory: [],
  isChatting: false,
  abortController: null,
  savedPairIds: new Set(),
};

type SidebarAutoRefreshTarget =
  | "summary"
  | "deepRead"
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

type SidebarSummaryNote = {
  note: Zotero.Item;
  rawHtml: string;
};

type SidebarNoteEditState = {
  itemId: number;
  noteId: number;
  noteKind: AiNoteKind;
  blockId: string | null;
  selectedBlockIndex: number;
  originalRawHtml: string;
  originalDateModified: string;
  isSaving: boolean;
};

let sidebarAutoRefreshBound = false;
let sidebarRefreshTimer: number | null = null;
let sidebarNoteEditState: SidebarNoteEditState | null = null;
const pendingSidebarRefreshTargets = new Set<SidebarAutoRefreshTarget>();
const quickChatToggleListeners = new WeakMap<HTMLElement, EventListener>();
const sidebarNoteEditEventCleanups = new WeakMap<HTMLElement, () => void>();
const SIDEBAR_SUMMARY_SELECTION_PREF = "sidebarSelectedSummaryBlockIds" as any;

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

function isSidebarNoteEditing(itemId?: number): boolean {
  return (
    !!sidebarNoteEditState &&
    (typeof itemId !== "number" || sidebarNoteEditState.itemId === itemId)
  );
}

function setSidebarNoteEditStatus(
  doc: Document,
  message: string,
  color = "rgba(128, 128, 128, 0.85)",
  kind: AiNoteKind = "summary",
): void {
  const status = doc.getElementById(
    getSidebarNoteElementId("ai-butler-note-edit-status", kind),
  ) as HTMLElement | null;
  if (!status) return;
  status.textContent = message;
  status.style.color = color;
}

function setButtonDisabled(btn: HTMLButtonElement | null, disabled: boolean) {
  if (!btn) return;
  btn.disabled = disabled;
  btn.style.opacity = disabled ? "0.45" : "0.75";
  btn.style.cursor = disabled ? "not-allowed" : "pointer";
}

function updateSidebarNoteEditControls(
  doc: Document,
  mode: "missing" | "preview" | "editing" | "saving",
  message = "",
  messageColor?: string,
  kind: AiNoteKind = "summary",
): void {
  const editBtn = doc.getElementById(
    getSidebarNoteElementId("ai-butler-edit-note-btn", kind),
  ) as HTMLButtonElement | null;
  const saveBtn = doc.getElementById(
    getSidebarNoteElementId("ai-butler-save-note-btn", kind),
  ) as HTMLButtonElement | null;
  const cancelBtn = doc.getElementById(
    getSidebarNoteElementId("ai-butler-cancel-note-btn", kind),
  ) as HTMLButtonElement | null;
  const copyBtn = doc.getElementById(
    getSidebarNoteElementId("ai-butler-copy-note-btn", kind),
  ) as HTMLButtonElement | null;
  const deleteBtn = doc.getElementById(
    getSidebarNoteElementId("ai-butler-delete-note-block-btn", kind),
  ) as HTMLButtonElement | null;
  const metadataSelector = doc.getElementById(
    getSidebarNoteElementId("ai-butler-note-metadata-selector", kind),
  ) as HTMLSelectElement | null;
  const metadataButton = doc.getElementById(
    getSidebarNoteElementId("ai-butler-note-metadata-button", kind),
  ) as HTMLButtonElement | null;

  const isEditing = mode === "editing" || mode === "saving";
  if (editBtn) {
    editBtn.style.display = isEditing ? "none" : "flex";
    setButtonDisabled(editBtn, mode !== "preview");
  }
  if (saveBtn) {
    saveBtn.style.display = isEditing ? "inline-flex" : "none";
    setButtonDisabled(saveBtn, mode === "saving");
  }
  if (cancelBtn) {
    cancelBtn.style.display = isEditing ? "inline-flex" : "none";
    setButtonDisabled(cancelBtn, mode === "saving");
  }
  setButtonDisabled(copyBtn, mode !== "preview");
  setButtonDisabled(deleteBtn, mode !== "preview");

  if (metadataSelector) {
    metadataSelector.disabled = isEditing;
  }
  if (metadataButton) {
    metadataButton.disabled = isEditing;
    metadataButton.style.opacity = isEditing ? "0.45" : "1";
    metadataButton.style.cursor = isEditing ? "not-allowed" : "pointer";
  }
  if (isEditing) {
    hideSidebarMetadataMenu(doc, kind);
  }

  setSidebarNoteEditStatus(doc, message, messageColor, kind);
}

function resetSidebarNoteContentEditMode(noteContent: HTMLElement): void {
  const cleanup = sidebarNoteEditEventCleanups.get(noteContent);
  if (cleanup) {
    cleanup();
    sidebarNoteEditEventCleanups.delete(noteContent);
  }
  noteContent.contentEditable = "false";
  delete noteContent.dataset.aiButlerEditMode;
  noteContent.style.outline = "";
  noteContent.style.background = "";
  noteContent.style.borderRadius = "";
  noteContent.style.minHeight = "";
}

function stopSidebarEditEvent(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
  (event as any).stopImmediatePropagation?.();
}

function isNodeInSidebarEditor(
  noteContent: HTMLElement,
  node: Node | null,
): boolean {
  return !!node && (node === noteContent || noteContent.contains(node));
}

function getSidebarEditorSelection(noteContent: HTMLElement): Selection | null {
  const doc = noteContent.ownerDocument;
  if (!doc) return null;
  const selection = doc.defaultView?.getSelection?.();
  if (!selection || selection.rangeCount === 0) return null;
  if (
    !isNodeInSidebarEditor(noteContent, selection.anchorNode) ||
    !isNodeInSidebarEditor(noteContent, selection.focusNode)
  ) {
    return null;
  }
  return selection;
}

function isSidebarEditorEventTarget(
  noteContent: HTMLElement,
  event: Event,
): boolean {
  const target = event.target as Node | null;
  return (
    isNodeInSidebarEditor(noteContent, target) ||
    !!getSidebarEditorSelection(noteContent)
  );
}

function deleteSidebarEditorSelection(
  noteContent: HTMLElement,
  direction: "backward" | "forward",
  granularity: "character" | "word" = "character",
): boolean {
  const selection = getSidebarEditorSelection(noteContent);
  if (!selection || selection.rangeCount === 0) return false;

  const originalRange = selection.getRangeAt(0).cloneRange();

  if (selection.isCollapsed) {
    const selectionWithModify = selection as Selection & {
      modify?: (
        alter: "move" | "extend",
        direction: "backward" | "forward",
        granularity: "character" | "word",
      ) => void;
    };

    if (typeof selectionWithModify.modify !== "function") {
      return true;
    }

    selectionWithModify.modify("extend", direction, granularity);
    if (
      selection.isCollapsed ||
      !isNodeInSidebarEditor(noteContent, selection.anchorNode) ||
      !isNodeInSidebarEditor(noteContent, selection.focusNode)
    ) {
      selection.removeAllRanges();
      selection.addRange(originalRange);
      return true;
    }
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  noteContent.normalize();
  return true;
}

function getSidebarEditorSelectionData(
  noteContent: HTMLElement,
): { html: string; text: string } | null {
  const selection = getSidebarEditorSelection(noteContent);
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const doc = noteContent.ownerDocument;
  if (!doc) return null;
  const wrapper = doc.createElement("div");
  wrapper.appendChild(range.cloneContents());
  return {
    html: String(wrapper.innerHTML),
    text: selection.toString(),
  };
}

function cutSidebarEditorSelection(
  noteContent: HTMLElement,
  event?: ClipboardEvent,
): boolean {
  const selectionData = getSidebarEditorSelectionData(noteContent);
  if (!selectionData) return true;

  if (event?.clipboardData) {
    event.clipboardData.setData("text/plain", selectionData.text);
    event.clipboardData.setData("text/html", selectionData.html);
  } else {
    const doc = noteContent.ownerDocument;
    if (doc) {
      void copyToClipboard(doc, selectionData.text).catch((err) => {
        ztoolkit.log("[AI-Butler] 剪切时复制到剪贴板失败:", err);
      });
    }
  }

  return deleteSidebarEditorSelection(noteContent, "forward");
}

function handleSidebarEditorCommandEvent(
  noteContent: HTMLElement,
  event: Event,
): boolean {
  if (noteContent.dataset.aiButlerEditMode !== "true") return false;
  if (!isSidebarEditorEventTarget(noteContent, event)) return false;

  if (event.type === "cut") {
    cutSidebarEditorSelection(noteContent, event as ClipboardEvent);
    stopSidebarEditEvent(event);
    return true;
  }

  if (event.type === "beforeinput") {
    const inputType = (event as InputEvent).inputType;
    if (inputType === "deleteContentBackward") {
      deleteSidebarEditorSelection(noteContent, "backward");
      stopSidebarEditEvent(event);
      return true;
    }
    if (inputType === "deleteContentForward") {
      deleteSidebarEditorSelection(noteContent, "forward");
      stopSidebarEditEvent(event);
      return true;
    }
    if (inputType === "deleteByCut") {
      cutSidebarEditorSelection(noteContent);
      stopSidebarEditEvent(event);
      return true;
    }
  }

  if (event.type === "keydown") {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.key === "Backspace" || keyboardEvent.key === "Delete") {
      const direction =
        keyboardEvent.key === "Backspace" ? "backward" : "forward";
      const granularity =
        keyboardEvent.ctrlKey || keyboardEvent.altKey ? "word" : "character";
      deleteSidebarEditorSelection(noteContent, direction, granularity);
      stopSidebarEditEvent(event);
      return true;
    }

    if (
      (keyboardEvent.ctrlKey || keyboardEvent.metaKey) &&
      keyboardEvent.key.toLowerCase() === "x"
    ) {
      cutSidebarEditorSelection(noteContent);
      stopSidebarEditEvent(event);
      return true;
    }
  }

  return false;
}

function bindSidebarNoteEditEventGuards(noteContent: HTMLElement): void {
  const existingCleanup = sidebarNoteEditEventCleanups.get(noteContent);
  if (existingCleanup) {
    existingCleanup();
  }
  const doc = noteContent.ownerDocument;
  if (!doc) return;
  const win = doc.defaultView;

  const stopEditingEvent = (event: Event): void => {
    if (noteContent.dataset.aiButlerEditMode !== "true") return;
    handleSidebarEditorCommandEvent(noteContent, event);
    if (event.defaultPrevented) return;
    event.stopPropagation();
    (event as any).stopImmediatePropagation?.();
  };
  const interceptCommandEvent = (event: Event): void => {
    handleSidebarEditorCommandEvent(noteContent, event);
  };

  const events = [
    "keydown",
    "keypress",
    "keyup",
    "beforeinput",
    "input",
    "cut",
    "copy",
    "paste",
    "compositionstart",
    "compositionupdate",
    "compositionend",
  ];
  const commandEvents = ["keydown", "beforeinput", "cut"];

  for (const eventName of events) {
    noteContent.addEventListener(eventName, stopEditingEvent, true);
  }
  for (const eventName of commandEvents) {
    doc.addEventListener(eventName, interceptCommandEvent, true);
    win?.addEventListener(eventName, interceptCommandEvent, true);
  }

  sidebarNoteEditEventCleanups.set(noteContent, () => {
    for (const eventName of events) {
      noteContent.removeEventListener(eventName, stopEditingEvent, true);
    }
    for (const eventName of commandEvents) {
      doc.removeEventListener(eventName, interceptCommandEvent, true);
      win?.removeEventListener(eventName, interceptCommandEvent, true);
    }
  });
}

function parseTaskTarget(taskId: string): {
  itemId: number;
  target: SidebarAutoRefreshTarget;
} | null {
  const match =
    /^(task|summary-task|deepread-task|img-task|mindmap-task|table-task)-(\d+)$/.exec(
      taskId,
    );
  if (!match) return null;
  const itemId = Number(match[2]);
  if (!Number.isFinite(itemId)) return null;

  const target: SidebarAutoRefreshTarget =
    match[1] === "img-task"
      ? "imageSummary"
      : match[1] === "deepread-task"
        ? "deepRead"
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
      getSidebarNoteElementId("ai-butler-note-content", "summary"),
    ) as HTMLElement | null;
    if (noteContent) {
      if (isSidebarNoteEditing(itemId)) {
        setSidebarNoteEditStatus(
          doc,
          getString("itempane-note-editing-skip-auto-refresh"),
          undefined,
          "summary",
        );
      } else {
        noteContent.innerHTML = `<div style="color: #999; text-align: center; padding: 10px;">${getString("itempane-status-refreshing")}</div>`;
        await loadNoteContent(doc, item, noteContent, "summary");
      }
    }
  }

  if (targets.includes("deepRead")) {
    const noteContent = doc.getElementById(
      getSidebarNoteElementId("ai-butler-note-content", "deepRead"),
    ) as HTMLElement | null;
    if (noteContent) {
      if (isSidebarNoteEditing(itemId)) {
        setSidebarNoteEditStatus(
          doc,
          getString("itempane-note-editing-skip-auto-refresh"),
          undefined,
          "deepRead",
        );
      } else {
        noteContent.innerHTML = `<div style="color: #999; text-align: center; padding: 10px;">${getString("itempane-status-refreshing")}</div>`;
        await loadNoteContent(doc, item, noteContent, "deepRead");
      }
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
      imageContainer.innerHTML = `<div style="color: #999; text-align: center; padding: 10px;">${getString("itempane-status-refreshing")}</div>`;
      await loadImageSummary(doc, item, imageContainer, imageBtnContainer);
    }
  }

  if (targets.includes("mindmap")) {
    const mindmapContainer = doc.getElementById(
      "ai-butler-mindmap-container",
    ) as HTMLElement | null;
    if (mindmapContainer) {
      mindmapContainer.innerHTML = `<div style="color: #999; text-align: center; padding: 10px;">${getString("itempane-status-refreshing")}</div>`;
      await loadMindmapContent(doc, item, mindmapContainer);
    }
  }

  if (targets.includes("table")) {
    const tableContent = doc.getElementById(
      "ai-butler-table-content",
    ) as HTMLElement | null;
    if (tableContent) {
      tableContent.innerHTML = `<div style="color: #999; text-align: center; padding: 10px;">${getString("itempane-status-refreshing")}</div>`;
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
        l10nID: getLocaleID("itempane-ai-section-header"),
        label: getString("aibutler-itempane-ai-section-header"),
        icon: rootURI + "icons/icon24.png",
      },
      sidenav: {
        l10nID: getLocaleID("itempane-ai-section-sidenav"),
        tooltiptext: getString("aibutler-itempane-ai-section-sidenav"),
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
  if (sidebarNoteEditState) {
    const doc = sidebarRenderContext.body.ownerDocument;
    if (doc) {
      setSidebarNoteEditStatus(
        doc,
        getString("itempane-note-editing-save-or-cancel"),
        undefined,
        sidebarNoteEditState.noteKind,
      );
    }
    return;
  }

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
    overflow-x: auto;
    box-sizing: border-box;
  `;

  // 检查是否有有效的文献条目
  if (!item || !item.isRegularItem()) {
    setSidebarContext(doc, null);
    sidebarRenderContext = null;
    sidebarNoteEditState = null;
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

  if (sidebarNoteEditState && sidebarNoteEditState.itemId !== item.id) {
    sidebarNoteEditState = null;
  }

  // 重置聊天状态（如果切换了条目）
  if (currentChatState.itemId !== item.id) {
    currentChatState.abortController?.abort(
      getString("itempane-quick-chat-abort-item-switched"),
    );
    currentChatState = {
      itemId: item.id,
      pdfContent: "",
      isBase64: false,
      conversationHistory: [],
      isChatting: false,
      abortController: null,
      savedPairIds: new Set(),
    };
  }

  // 按用户配置的顺序渲染侧边栏功能区块
  const renderers: Record<SidebarModuleId, () => void> = {
    actionButtons: () => renderActionButtons(body, doc, item, handleOpenAIChat),
    note: () => renderNoteSection(body, doc, item, "summary"),
    deepRead: () => renderNoteSection(body, doc, item, "deepRead"),
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
  const label = doc.createElement("span");
  label.textContent = text;
  label.style.cssText = `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    line-height: 1.2;
    text-align: center;
    overflow-wrap: anywhere;
  `;
  btn.appendChild(label);
  btn.style.cssText = `
    flex: 1 1 0;
    min-width: 0;
    max-width: 100%;
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
    align-content: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 6px;
    line-height: 1.2;
    text-align: center;
    white-space: normal;
    overflow-wrap: anywhere;
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

function createContextInfoIcon(doc: Document, tooltip: string): HTMLElement {
  const icon = doc.createElement("span");
  icon.textContent = "i";
  icon.title = tooltip;
  icon.setAttribute("aria-label", tooltip);
  icon.style.cssText = `
    width: 17px;
    height: 17px;
    border: 1px solid currentColor;
    border-radius: 50%;
    color: inherit;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
    cursor: help;
    flex: 0 0 auto;
    align-self: center;
    opacity: 0.85;
  `;
  return icon;
}

function appendContextInfoIconToButton(
  doc: Document,
  button: HTMLButtonElement,
  tooltip: string,
): void {
  button.style.minWidth = "0";
  button.appendChild(createContextInfoIcon(doc, tooltip));
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
    width: 100%;
    max-width: 100%;
    min-width: 0;
    gap: 8px;
    margin-bottom: 10px;
    box-sizing: border-box;
  `;

  // 完整追问按钮
  const fullChatBtn = createButton(
    doc,
    getString("itempane-ai-open-chat"),
    true,
  );
  appendContextInfoIconToButton(
    doc,
    fullChatBtn,
    getString("itempane-ai-open-chat-tooltip"),
  );
  fullChatBtn.addEventListener("click", async () => {
    try {
      await handleOpenAIChat(item.id);
    } catch (error: any) {
      ztoolkit.log("[AI-Butler] 完整追问按钮点击失败:", error);
    }
  });

  // 快速追问按钮
  const quickChatBtn = createButton(
    doc,
    getString("itempane-ai-temp-chat"),
    false,
  );
  appendContextInfoIconToButton(
    doc,
    quickChatBtn,
    getString("itempane-ai-temp-chat-tooltip"),
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
  refreshBtn.title = getString("itempane-refresh-tooltip");
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
    min-width: 0;
  `;
  refreshBtn.addEventListener("mouseenter", () => {
    refreshBtn.style.background = "rgba(89, 192, 188, 0.1)";
  });
  refreshBtn.addEventListener("mouseleave", () => {
    refreshBtn.style.background = "transparent";
  });
  refreshBtn.addEventListener("click", async () => {
    refreshBtn.textContent = "⏳";
    refreshBtn.style.pointerEvents = "none";
    try {
      await refreshCurrentItemPaneSection();
    } catch (err: any) {
      ztoolkit.log("[AI-Butler] 重新渲染侧边栏失败:", err);
    } finally {
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
  noteKind: AiNoteKind = "summary",
): void {
  const noteSection = doc.createElement("div");
  noteSection.className = "ai-butler-note-section";
  noteSection.style.cssText = `
    margin-bottom: 12px;
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    overflow: visible;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
  `;

  // 笔记标题栏（可折叠）- 使用继承颜色以支持暗色模式
  const noteHeader = doc.createElement("div");
  noteHeader.className = "ai-butler-note-header";
  noteHeader.style.cssText = `
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    padding: 8px 10px;
    background: rgba(128, 128, 128, 0.1);
    cursor: pointer;
    user-select: none;
    border-bottom: 1px solid rgba(128, 128, 128, 0.2);
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    overflow: visible;
  `;

  const noteTitle = doc.createElement("span");
  noteTitle.style.cssText = `
    flex: 1 1 auto;
    font-weight: 500;
    font-size: 12px;
    color: inherit;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    overflow-wrap: anywhere;
  `;
  const noteLabel = getSidebarNoteKindLabel(noteKind);
  noteTitle.innerHTML = `📄 <span>${noteLabel}</span>`;

  const headerTopRow = doc.createElement("div");
  headerTopRow.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    width: 100%;
    min-width: 0;
  `;

  const metadataPicker = doc.createElement("span");
  metadataPicker.id = getSidebarNoteElementId(
    "ai-butler-note-metadata-picker",
    noteKind,
  );
  metadataPicker.style.cssText = `
    display: none;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  `;
  metadataPicker.addEventListener("click", (e: Event) => e.stopPropagation());

  const metadataSelector = doc.createElement("select");
  metadataSelector.id = getSidebarNoteElementId(
    "ai-butler-note-metadata-selector",
    noteKind,
  );
  metadataSelector.style.display = "none";

  const metadataButton = doc.createElement("button");
  metadataButton.id = getSidebarNoteElementId(
    "ai-butler-note-metadata-button",
    noteKind,
  );
  metadataButton.type = "button";
  metadataButton.style.cssText = `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 22px;
    max-width: 92px;
    padding: 0 8px;
    border: 1px solid rgba(128, 128, 128, 0.35);
    border-radius: 999px;
    background: rgba(128, 128, 128, 0.08);
    color: inherit;
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
    cursor: pointer;
    overflow: hidden;
    white-space: nowrap;
  `;

  const metadataMenu = doc.createElement("div");
  metadataMenu.id = getSidebarNoteElementId(
    "ai-butler-note-metadata-menu",
    noteKind,
  );
  metadataMenu.style.cssText = `
    display: none;
    margin: 6px 8px 0;
    max-height: 240px;
    overflow-y: auto;
    padding: 6px;
    border: 1px solid rgba(128, 128, 128, 0.22);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.92);
    color: inherit;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  `;

  metadataButton.addEventListener("click", (e: Event) => {
    e.stopPropagation();
    if (metadataButton.disabled) return;
    metadataMenu.style.display =
      metadataMenu.style.display === "none" ? "block" : "none";
  });

  metadataPicker.appendChild(metadataSelector);
  metadataPicker.appendChild(metadataButton);
  noteTitle.appendChild(metadataPicker);

  const mainControls = doc.createElement("div");
  mainControls.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex: 0 1 auto;
    gap: 4px;
    margin-left: auto;
    margin-right: 8px;
    min-width: 0;
  `;
  mainControls.addEventListener("click", (e: Event) => e.stopPropagation());

  const personalizationRow = doc.createElement("div");
  personalizationRow.style.cssText = `
    display: none;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 6px;
    width: 100%;
    min-width: 0;
    padding-top: 2px;
  `;
  personalizationRow.addEventListener("click", (e: Event) =>
    e.stopPropagation(),
  );

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
  const noteHeightPrefKey = getSidebarNoteHeightPrefKey(noteKind);
  const noteCollapsedPrefKey = getSidebarNoteCollapsedPrefKey(noteKind);
  let savedNoteHeight = parseInt(
    (getPref(noteHeightPrefKey as any) as string) ||
      (noteKind === "summary"
        ? ""
        : (getPref("sidebarNoteHeight" as any) as string) || "") ||
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
  noteContent.id = getSidebarNoteElementId("ai-butler-note-content", noteKind);
  noteContent.dataset.aiNoteKind = noteKind;
  noteContent.style.cssText = `
    padding: 10px;
    padding-bottom: 20px;
    font-size: ${currentFontSize}px;
    line-height: 1.6;
    overflow-wrap: anywhere;
    word-wrap: break-word;
    word-break: break-word;
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

  personalizationRow.appendChild(createFontBtn("?", -1));
  personalizationRow.appendChild(fontSizeLabel);
  personalizationRow.appendChild(createFontBtn("+", 1));

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
    { id: "redstriking", name: getString("theme-redstriking-name") },
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
      styleEl.textContent =
        katexCss + "\n" + adaptedCss + "\n" + SIDEBAR_NOTE_OVERFLOW_GUARD_CSS;
    }
  });
  personalizationRow.appendChild(themeSelect);

  // 恢复默认高度按钮
  const resetHeightBtn = doc.createElement("button");
  resetHeightBtn.textContent = "?";
  resetHeightBtn.title = getString("itempane-note-reset-height");
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
    setPref(noteHeightPrefKey as any, String(DEFAULT_NOTE_HEIGHT) as any);
  });
  resetHeightBtn.addEventListener("mouseenter", () => {
    resetHeightBtn.style.background = "#f0f0f0";
  });
  resetHeightBtn.addEventListener("mouseleave", () => {
    resetHeightBtn.style.background = "white";
  });
  personalizationRow.appendChild(resetHeightBtn);

  const createNoteActionBtn = (text: string, title: string, minWidth = 20) => {
    const btn = doc.createElement("button");
    btn.textContent = text;
    btn.title = title;
    btn.style.cssText = `
      min-width: ${minWidth}px;
      height: 20px;
      padding: 0 6px;
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
      flex: 0 0 auto;
      opacity: 0.75;
    `;
    btn.addEventListener("click", (e: Event) => e.stopPropagation());
    btn.addEventListener("mouseenter", () => {
      if (btn.disabled) return;
      btn.style.opacity = "1";
      btn.style.background = "rgba(128, 128, 128, 0.2)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.opacity = btn.disabled ? "0.45" : "0.75";
      btn.style.background = "transparent";
    });
    return btn;
  };

  const editBtn = createNoteActionBtn(
    "✏️",
    noteKind === "summary"
      ? getString("itempane-note-edit-summary")
      : getString("itempane-note-edit-deep-read"),
  );
  editBtn.id = getSidebarNoteElementId("ai-butler-edit-note-btn", noteKind);
  editBtn.addEventListener("click", async (e: Event) => {
    e.stopPropagation();
    await startSidebarNoteEdit(doc, item, noteContent);
  });
  mainControls.appendChild(editBtn);

  const deleteBlockBtn = createNoteActionBtn(
    "🗑️",
    getString("itempane-note-delete-current-model-summary"),
  );
  deleteBlockBtn.id = getSidebarNoteElementId(
    "ai-butler-delete-note-block-btn",
    noteKind,
  );
  deleteBlockBtn.addEventListener("click", async (e: Event) => {
    e.stopPropagation();
    await deleteSidebarSummaryBlock(doc, item, noteContent);
  });
  metadataPicker.appendChild(deleteBlockBtn);

  const saveBtn = createNoteActionBtn(
    getString("itempane-note-save-button"),
    noteKind === "summary"
      ? getString("itempane-note-save-summary-tooltip")
      : getString("itempane-note-save-deep-read-tooltip"),
    42,
  );
  saveBtn.id = getSidebarNoteElementId("ai-butler-save-note-btn", noteKind);
  saveBtn.style.display = "none";
  saveBtn.addEventListener("click", async (e: Event) => {
    e.stopPropagation();
    await saveSidebarNoteEdit(doc, item, noteContent);
  });
  mainControls.appendChild(saveBtn);

  const cancelBtn = createNoteActionBtn(
    getString("itempane-note-cancel-button"),
    getString("itempane-note-cancel-tooltip"),
    42,
  );
  cancelBtn.id = getSidebarNoteElementId("ai-butler-cancel-note-btn", noteKind);
  cancelBtn.style.display = "none";
  cancelBtn.addEventListener("click", (e: Event) => {
    e.stopPropagation();
    cancelSidebarNoteEdit(doc, item, noteContent);
  });
  mainControls.appendChild(cancelBtn);

  const editStatus = doc.createElement("span");
  editStatus.id = getSidebarNoteElementId(
    "ai-butler-note-edit-status",
    noteKind,
  );
  editStatus.style.cssText = `
    flex: 1 1 72px;
    font-size: 10px;
    min-width: 0;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.85;
  `;
  mainControls.appendChild(editStatus);

  const personalizeBtn = doc.createElement("button");
  personalizeBtn.textContent = "🎛️";
  personalizeBtn.title = getString("itempane-note-personalize");
  personalizeBtn.type = "button";
  personalizeBtn.setAttribute(
    "aria-label",
    getString("itempane-note-personalize"),
  );
  personalizeBtn.style.cssText = `
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
  let isPersonalizationOpen = false;
  personalizeBtn.addEventListener("click", (e: Event) => {
    e.stopPropagation();
    isPersonalizationOpen = !isPersonalizationOpen;
    personalizationRow.style.display = isPersonalizationOpen ? "flex" : "none";
    personalizeBtn.style.background = isPersonalizationOpen
      ? "rgba(128, 128, 128, 0.2)"
      : "transparent";
    personalizeBtn.style.opacity = isPersonalizationOpen ? "1" : "0.7";
  });
  personalizeBtn.addEventListener("mouseenter", () => {
    personalizeBtn.style.opacity = "1";
    personalizeBtn.style.background = "rgba(128, 128, 128, 0.2)";
  });
  personalizeBtn.addEventListener("mouseleave", () => {
    personalizeBtn.style.opacity = isPersonalizationOpen ? "1" : "0.7";
    personalizeBtn.style.background = isPersonalizationOpen
      ? "rgba(128, 128, 128, 0.2)"
      : "transparent";
  });
  mainControls.appendChild(personalizeBtn);

  // 复制 Markdown 按钮
  const copyBtn = doc.createElement("button");
  copyBtn.textContent = "📋";
  copyBtn.title = getString("itempane-copy-markdown");
  copyBtn.id = getSidebarNoteElementId("ai-butler-copy-note-btn", noteKind);
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
    opacity: 0.7;
  `;
  copyBtn.addEventListener("click", async (e: Event) => {
    e.stopPropagation();
    try {
      // 获取当前笔记的 Markdown 内容
      const markdownContent = await getNoteMarkdownContent(item, noteKind);
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
      copyBtn.textContent = "✅";
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
  personalizationRow.appendChild(copyBtn);

  const toggleIcon = doc.createElement("span");
  toggleIcon.textContent = "▼";
  toggleIcon.style.cssText = `
    font-size: 10px;
    color: inherit;
    opacity: 0.6;
    transition: transform 0.2s ease;
  `;

  headerTopRow.appendChild(noteTitle);
  headerTopRow.appendChild(mainControls);
  headerTopRow.appendChild(toggleIcon);
  noteHeader.appendChild(headerTopRow);
  noteHeader.appendChild(personalizationRow);

  noteContentWrapper.appendChild(noteContent);

  // 拖拽调整高度的手柄
  const resizeHandle = createResizeHandle(
    doc,
    noteContentWrapper,
    noteHeightPrefKey,
  );

  // 折叠/展开功能 - 从首选项读取初始状态
  let isCollapsed = getPref(noteCollapsedPrefKey as any) === true;

  // 根据初始状态设置UI
  if (isCollapsed) {
    noteContentWrapper.style.height = "0px";
    noteContentWrapper.style.overflow = "hidden";
    resizeHandle.style.display = "none";
    toggleIcon.style.transform = "rotate(-90deg)";
  }

  noteHeader.addEventListener("click", () => {
    if (isSidebarNoteEditing(item.id)) {
      setSidebarNoteEditStatus(
        doc,
        getString("itempane-note-editing-save-or-cancel"),
        undefined,
        noteKind,
      );
      return;
    }
    isCollapsed = !isCollapsed;
    // 保存折叠状态到首选项
    setPref(noteCollapsedPrefKey as any, isCollapsed as any);
    if (isCollapsed) {
      noteContentWrapper.style.height = "0px";
      noteContentWrapper.style.overflow = "hidden";
      resizeHandle.style.display = "none";
      toggleIcon.style.transform = "rotate(-90deg)";
    } else {
      const restoreHeight = parseInt(
        (getPref(noteHeightPrefKey as any) as string) ||
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
  noteSection.appendChild(metadataMenu);
  noteSection.appendChild(noteContentWrapper);
  noteSection.appendChild(resizeHandle);
  body.appendChild(noteSection);

  updateSidebarNoteEditControls(doc, "missing", "", undefined, noteKind);

  // 异步加载笔记内容
  loadNoteContent(doc, item, noteContent, noteKind);
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
      container.innerHTML = `<div style="color: #9e9e9e; font-size: 12px; text-align: center; padding: 12px;">${getString("itempane-table-empty")}</div>`;
    }
  } catch (error) {
    ztoolkit.log("[AI-Butler] 加载表格内容失败:", error);
    container.innerHTML = `<div style="color: #9e9e9e; font-size: 12px; text-align: center; padding: 12px;">${getString("itempane-load-failed", { args: { error: escapeHtmlForChat(error instanceof Error ? error.message : String(error)) } })}</div>`;
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
  if (!isTableFeatureEnabled()) return;

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
  tableTitle.innerHTML = `📊 <span>${getString("itempane-table-title")}</span>`;

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
      badges += `<span style="margin-left:6px;padding:1px 5px;border-radius:3px;font-size:9px;background:rgba(76,175,80,0.15);color:#4caf50;">${getString("itempane-table-badge-filled")}</span>`;
    }
    if (isReviewed) {
      badges += `<span style="margin-left:4px;padding:1px 5px;border-radius:3px;font-size:9px;background:rgba(99,102,241,0.15);color:#6366f1;">${getString("itempane-table-badge-reviewed")}</span>`;
    }
    if (badges) {
      const titleSpan = tableTitle.querySelector("span");
      if (titleSpan) {
        titleSpan.innerHTML = `${getString("itempane-table-title")}${badges}`;
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
  refillBtn.textContent = getString("itempane-regenerate");
  refillBtn.title = getString("itempane-regenerate-table");
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
    refillBtn.textContent = getString("itempane-generating");
    refillBtn.style.pointerEvents = "none";
    try {
      const { LiteratureReviewService } =
        await import("./literatureReviewService");
      const { getConfiguredTableTemplate, getConfiguredTableFillPrompt } =
        await import("../utils/prompts");

      const tableTemplate = getConfiguredTableTemplate(
        getPref("tableTemplate" as any) as string,
      );
      const fillPrompt = getConfiguredTableFillPrompt(
        getPref("tableFillPrompt" as any) as string,
      );

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
      refillBtn.textContent = getString("itempane-regenerate");
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
  imageSummaryTitle.innerHTML = `🖼️ <span>${getString("itempane-image-title")}</span>`;

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
  mindmapTitle.innerHTML = `🧠 <span>${getString("itempane-mindmap-title")}</span>`;

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
      generateMindmapBtn.textContent = getString("itempane-generate-mindmap");
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
          generateMindmapBtn.textContent = getString(
            "itempane-adding-to-queue",
          );
          const { TaskQueueManager } = await import("./taskQueue");
          const queueManager = TaskQueueManager.getInstance();
          await queueManager.addMindmapTask(targetItem);
          generateMindmapBtn.textContent = getString("itempane-added-to-queue");
        } catch (err: any) {
          generateMindmapBtn.textContent = getString("itempane-failed");
          setTimeout(() => {
            generateMindmapBtn.textContent = getString(
              "itempane-generate-mindmap",
            );
            generateMindmapBtn.disabled = false;
          }, 2000);
        }
      });

      container.innerHTML = `
        <div style="text-align: center; color: #9e9e9e; padding: 16px;">
          <div style="font-size: 24px; margin-bottom: 8px;">🧠</div>
          <div style="font-size: 12px; margin-bottom: 8px;">${getString("itempane-no-mindmap")}</div>
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
          <div>${getString("itempane-mindmap-format-error")}</div>
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
          <div>${getString("itempane-mindmap-empty")}</div>
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
                text: getString("itempane-mindmap-open-viewer-failed"),
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
            new ztoolkit.ProgressWindow(
              getString("itempane-mindmap-exported-title"),
            )
              .createLine({
                text: getString("itempane-mindmap-exported-to-desktop", {
                  args: { filename },
                }),
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
            new ztoolkit.ProgressWindow(
              getString("itempane-mindmap-export-failed"),
            )
              .createLine({
                text: getString("itempane-mindmap-export-error", {
                  args: { message: String(e) },
                }),
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
    container.innerHTML = `<div style="color: #d32f2f; padding: 10px;">${getString("itempane-mindmap-load-failed", { args: { message: escapeHtmlForChat(err.message) } })}</div>`;
  }
}

/**
 * 渲染聊天区域

 */
async function ensureQuickChatKatexCss(doc: Document): Promise<void> {
  if (doc.getElementById("ai-butler-quick-chat-katex-style")) return;
  try {
    const { themeManager } = await import("./themeManager");
    const katexCss = await themeManager.loadKatexCss();
    const styleEl = doc.createElement("style");
    styleEl.id = "ai-butler-quick-chat-katex-style";
    styleEl.textContent = `${katexCss}
#ai-butler-inline-chat,
#ai-butler-inline-chat * {
  box-sizing: border-box;
}
#ai-butler-inline-chat .ai-butler-quick-chat-assistant,
#ai-butler-inline-chat .ai-butler-quick-chat-assistant * {
  min-width: 0;
  max-width: 100%;
  text-align: left;
  overflow-wrap: anywhere;
  word-break: break-word;
  white-space: normal;
}
#ai-butler-inline-chat .ai-butler-quick-chat-assistant p {
  margin: 0.35em 0;
  max-width: 100%;
  overflow-wrap: anywhere;
  word-break: break-word;
}
#ai-butler-inline-chat .ai-butler-quick-chat-assistant h1,
#ai-butler-inline-chat .ai-butler-quick-chat-assistant h2,
#ai-butler-inline-chat .ai-butler-quick-chat-assistant h3,
#ai-butler-inline-chat .ai-butler-quick-chat-assistant h4,
#ai-butler-inline-chat .ai-butler-quick-chat-assistant h5,
#ai-butler-inline-chat .ai-butler-quick-chat-assistant h6 {
  position: relative;
  margin: 0.9em 0 0.55em;
  line-height: 1.35;
  font-weight: 700;
  color: inherit;
}
#ai-butler-inline-chat .ai-butler-quick-chat-assistant h1 {
  font-size: 1.2em;
  text-align: center;
  padding-bottom: 0.25em;
  color: var(--main-10, inherit);
}
#ai-butler-inline-chat .ai-butler-quick-chat-assistant h1::after {
  content: "";
  display: block;
  margin: 0.2em auto 0;
  width: 72px;
  border-bottom: 2px solid #f22f27;
}
#ai-butler-inline-chat .ai-butler-quick-chat-assistant h2 {
  font-size: 1.12em;
  padding-bottom: 0.18em;
  border-bottom: 1px solid #f22f27;
}
#ai-butler-inline-chat .ai-butler-quick-chat-assistant h2::before {
  content: "# ";
  color: #f22f27;
}
#ai-butler-inline-chat .ai-butler-quick-chat-assistant h3 {
  font-size: 1.05em;
  padding-left: 9px;
  border-left: 5px solid #f22f27;
}
#ai-butler-inline-chat .ai-butler-quick-chat-assistant h4 {
  display: inline-block;
  font-size: 1em;
  padding: 0.1em 0.45em;
  border: 1px solid #f22f27;
  border-top: 4px solid #f22f27;
}
#ai-butler-inline-chat .ai-butler-quick-chat-assistant ul,
#ai-butler-inline-chat .ai-butler-quick-chat-assistant ol {
  margin: 0.35em 0 0.5em 1.35em;
  padding: 0;
}
#ai-butler-inline-chat .ai-butler-quick-chat-assistant li {
  margin: 0.2em 0;
  padding-left: 0.15em;
}
#ai-butler-inline-chat .ai-butler-quick-chat-assistant li > p {
  margin: 0.15em 0;
}
#ai-butler-inline-chat .ai-butler-quick-chat-assistant blockquote {
  margin: 0.5em 0;
  padding-left: 0.75em;
  border-left: 3px solid rgba(89, 192, 188, 0.45);
}
#ai-butler-inline-chat .ai-butler-quick-chat-assistant pre,
#ai-butler-inline-chat .ai-butler-quick-chat-assistant code,
#ai-butler-inline-chat .ai-butler-quick-chat-assistant .math-fallback {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}
#ai-butler-inline-chat .ai-butler-quick-chat-assistant table {
  display: block;
  width: max-content;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
}
#ai-butler-inline-chat .ai-butler-quick-chat-assistant .katex-display,
#ai-butler-inline-chat .ai-butler-quick-chat-assistant pre,
#ai-butler-inline-chat .ai-butler-quick-chat-assistant table {
  overflow-x: auto;
  overflow-y: hidden;
}
#ai-butler-inline-chat .ai-butler-quick-chat-assistant .katex-inline {
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}
#ai-butler-inline-chat .katex-display {
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
}
#ai-butler-inline-chat .katex-inline {
  overflow-wrap: normal;
  word-break: normal;
}`;
    const target = doc.head || doc.documentElement;
    if (target) {
      target.appendChild(styleEl);
    }
  } catch (err) {
    ztoolkit.log("[AI-Butler] 快速追问 KaTeX 样式加载失败:", err);
  }
}

function renderChatArea(
  body: HTMLElement,
  doc: Document,
  item: Zotero.Item,
  initiallyVisible = false,
): void {
  currentChatState.abortController?.abort(
    getString("itempane-quick-chat-abort-refreshed"),
  );
  currentChatState.conversationHistory = [];
  currentChatState.isChatting = false;
  currentChatState.abortController = null;
  currentChatState.savedPairIds = new Set();
  void ensureQuickChatKatexCss(doc);

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
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    background: rgba(89, 192, 188, 0.1);
    border-bottom: 1px solid rgba(89, 192, 188, 0.2);
    font-size: 12px;
    font-weight: 500;
  `;
  const chatTitle = doc.createElement("span");
  chatTitle.textContent = getString("itempane-quick-chat-title");
  chatHeader.appendChild(chatTitle);
  chatHeader.appendChild(
    createContextInfoIcon(doc, getString("itempane-ai-temp-chat-tooltip")),
  );

  let currentQuickChatFontSize = parseInt(
    (getPref("sidebarQuickChatFontSize" as any) as string) || "12",
    10,
  );
  if (
    isNaN(currentQuickChatFontSize) ||
    currentQuickChatFontSize < 10 ||
    currentQuickChatFontSize > 20
  ) {
    currentQuickChatFontSize = 12;
  }

  const DEFAULT_QUICK_CHAT_HEIGHT = 200;
  let currentQuickChatHeight = parseInt(
    (getPref("sidebarQuickChatHeight" as any) as string) ||
      String(DEFAULT_QUICK_CHAT_HEIGHT),
    10,
  );
  if (isNaN(currentQuickChatHeight) || currentQuickChatHeight < 100) {
    currentQuickChatHeight = DEFAULT_QUICK_CHAT_HEIGHT;
  }

  const chatControls = doc.createElement("div");
  chatControls.style.cssText = `
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
  `;
  chatControls.addEventListener("click", (event: Event) => {
    event.stopPropagation();
  });

  const quickFontLabel = doc.createElement("span");
  quickFontLabel.textContent = `${currentQuickChatFontSize}px`;
  quickFontLabel.style.cssText = `
    min-width: 28px;
    color: inherit;
    opacity: 0.75;
    font-size: 10px;
    text-align: center;
  `;

  const createQuickControlButton = (text: string, title: string) => {
    const button = doc.createElement("button");
    button.textContent = text;
    button.title = title;
    button.style.cssText = `
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
      opacity: 0.75;
    `;
    button.addEventListener("mouseenter", () => {
      if (button.disabled) return;
      button.style.opacity = "1";
      button.style.background = "rgba(128, 128, 128, 0.2)";
    });
    button.addEventListener("mouseleave", () => {
      button.style.opacity = button.disabled ? "0.45" : "0.75";
      button.style.background = "transparent";
    });
    return button;
  };

  const decreaseFontBtn = createQuickControlButton(
    "?",
    getString("itempane-quick-chat-decrease-font"),
  );
  const increaseFontBtn = createQuickControlButton(
    "+",
    getString("itempane-quick-chat-increase-font"),
  );
  const decreaseHeightBtn = createQuickControlButton(
    "?",
    getString("itempane-quick-chat-decrease-height"),
  );
  const increaseHeightBtn = createQuickControlButton(
    "?",
    getString("itempane-quick-chat-increase-height"),
  );
  const resetHeightBtn = createQuickControlButton(
    "?",
    getString("itempane-quick-chat-reset-height"),
  );

  chatControls.appendChild(decreaseFontBtn);
  chatControls.appendChild(quickFontLabel);
  chatControls.appendChild(increaseFontBtn);
  chatControls.appendChild(decreaseHeightBtn);
  chatControls.appendChild(increaseHeightBtn);
  chatControls.appendChild(resetHeightBtn);
  chatHeader.appendChild(chatControls);

  // 消息显示区
  const messagesArea = doc.createElement("div");
  messagesArea.style.cssText = `
    height: ${currentQuickChatHeight}px;
    min-height: 100px;
    max-height: 520px;
    overflow-y: auto;
    overflow-x: hidden;
    resize: vertical;
    padding: 8px;
    font-size: ${currentQuickChatFontSize}px;
    line-height: 1.5;
    user-select: text;
    cursor: text;
  `;

  const applyQuickChatFontSize = (nextSize: number): void => {
    currentQuickChatFontSize = Math.max(10, Math.min(20, nextSize));
    quickFontLabel.textContent = `${currentQuickChatFontSize}px`;
    messagesArea.style.fontSize = `${currentQuickChatFontSize}px`;
    setPref(
      "sidebarQuickChatFontSize" as any,
      String(currentQuickChatFontSize) as any,
    );
  };

  const applyQuickChatHeight = (nextHeight: number): void => {
    currentQuickChatHeight = Math.max(100, Math.min(520, nextHeight));
    messagesArea.style.height = `${currentQuickChatHeight}px`;
    setPref(
      "sidebarQuickChatHeight" as any,
      String(currentQuickChatHeight) as any,
    );
  };

  decreaseFontBtn.addEventListener("click", () => {
    applyQuickChatFontSize(currentQuickChatFontSize - 1);
  });
  increaseFontBtn.addEventListener("click", () => {
    applyQuickChatFontSize(currentQuickChatFontSize + 1);
  });
  decreaseHeightBtn.addEventListener("click", () => {
    applyQuickChatHeight(currentQuickChatHeight - 40);
  });
  increaseHeightBtn.addEventListener("click", () => {
    applyQuickChatHeight(currentQuickChatHeight + 40);
  });
  resetHeightBtn.addEventListener("click", () => {
    applyQuickChatHeight(DEFAULT_QUICK_CHAT_HEIGHT);
  });

  // 输入区域
  const isQuickChatAtBottom = (): boolean =>
    messagesArea.scrollHeight -
      messagesArea.scrollTop -
      messagesArea.clientHeight <
    8;
  let quickChatPinnedToBottom = true;
  messagesArea.addEventListener("scroll", () => {
    quickChatPinnedToBottom = isQuickChatAtBottom();
  });
  const scrollQuickChatToBottomIfPinned = (
    wasPinned = quickChatPinnedToBottom,
  ): void => {
    if (!wasPinned) return;
    messagesArea.scrollTop = messagesArea.scrollHeight;
    quickChatPinnedToBottom = true;
  };

  const inputArea = doc.createElement("div");
  inputArea.style.cssText = `
    display: flex;
    gap: 6px;
    padding: 8px;
    border-top: 1px solid rgba(128, 128, 128, 0.2);
    background: transparent;
  `;

  const inputBox = doc.createElement("textarea");
  inputBox.placeholder = getString("itempane-question-placeholder");
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
  sendBtn.textContent = getString("itempane-send");
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

  const stopBtn = doc.createElement("button");
  stopBtn.textContent = getString("itempane-stop");
  stopBtn.title = getString("itempane-stop-current");
  stopBtn.style.cssText = `
    display: none;
    padding: 6px 12px;
    background: #f44336;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    align-self: flex-end;
  `;
  stopBtn.addEventListener("click", () => {
    if (!currentChatState.isChatting) return;
    stopBtn.textContent = getString("itempane-stopping");
    stopBtn.style.background = "#9e9e9e";
    (stopBtn as HTMLButtonElement).disabled = true;
    currentChatState.abortController?.abort(getString("itempane-stop-current"));
  });

  inputArea.appendChild(inputBox);
  inputArea.appendChild(stopBtn);
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
    if (currentChatState.pdfContent) {
      if (!messagesArea.textContent?.trim()) {
        messagesArea.innerHTML = `<div style="color: #4caf50; text-align: center; padding: 10px;">${getString("itempane-chat-pdf-loaded")}</div>`;
      }
      return;
    }

    // 如果尚未加载 PDF 内容，则加载
    if (item) {
      try {
        const { ContentExtractor } = await import("./contentExtractor");
        const { default: LLMService } = await import("./llmService");
        const pdfMode = LLMService.getEffectivePdfProcessMode();

        messagesArea.innerHTML = `<div style="color: #999; text-align: center; padding: 10px;">${getString("itempane-chat-loading-pdf")}</div>`;

        const { content: pdfContent, isBase64 } =
          await ContentExtractor.extractAnalyzableContentFromItem(
            item,
            pdfMode === "base64",
            pdfMode,
          );

        if (pdfContent) {
          currentChatState.pdfContent = pdfContent;
          currentChatState.isBase64 = isBase64;
          messagesArea.innerHTML = `<div style="color: #4caf50; text-align: center; padding: 10px;">${getString("itempane-chat-pdf-loaded")}</div>`;
        } else {
          messagesArea.innerHTML = `<div style="color: #f44336; text-align: center; padding: 10px;">${getString("itempane-chat-pdf-load-unavailable")}</div>`;
        }
      } catch (err: any) {
        ztoolkit.log("[AI-Butler] 快速追问加载 PDF 失败:", err);
        messagesArea.innerHTML = `<div style="color: #f44336; text-align: center; padding: 10px;">${getString("itempane-chat-load-failed", { args: { message: escapeHtmlForChat(err?.message || getString("common-unknown-error")) } })}</div>`;
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

  // 发送消息处理 - 快速追问（上下文为论文 + 当前对话框内历史）
  sendBtn.addEventListener("click", async () => {
    const question = inputBox.value.trim();
    if (currentChatState.isChatting) return;

    if (!question) return;

    // 检查是否有 PDF 内容
    if (!currentChatState.pdfContent) {
      messagesArea.innerHTML = `<div style="color: #f44336; text-align: center; padding: 10px;">${getString("itempane-chat-wait-pdf-loaded")}</div>`;
      return;
    }

    // 设置为正在聊天状态
    currentChatState.isChatting = true;
    currentChatState.abortController = createChatAbortController();
    sendBtn.textContent = getString("itempane-generating-status");
    sendBtn.style.background = "#9e9e9e";
    (sendBtn as HTMLButtonElement).disabled = true;
    stopBtn.textContent = getString("itempane-stop");
    stopBtn.style.background = "#f44336";
    (stopBtn as HTMLButtonElement).disabled = false;
    stopBtn.style.display = "block";
    (inputBox as HTMLTextAreaElement).disabled = false;

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
      user-select: text;
      cursor: text;
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
      user-select: text;
      cursor: text;
    `;
    userMsgDiv.innerHTML = `<strong>${getString("itempane-user-label")}</strong> ${escapeHtmlForChat(question)}`;
    pairWrapper.appendChild(userMsgDiv);

    // 创建 AI 回复区域
    const aiMsgDiv = doc.createElement("div");
    aiMsgDiv.className = "ai-butler-quick-chat-assistant";
    aiMsgDiv.style.cssText = `
      margin-bottom: 8px;
      padding: 8px;
      background: rgba(128, 128, 128, 0.05);
      border-radius: 6px;
      border-left: 3px solid #667eea;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      overflow-x: hidden;
      overflow-wrap: anywhere;
      word-break: break-word;
      white-space: normal;
      user-select: text;
      cursor: text;
    `;
    aiMsgDiv.innerHTML = `<strong>${getString("itempane-assistant-label")}</strong> <em style="color: #999;">${getString("itempane-thinking")}</em>`;
    pairWrapper.appendChild(aiMsgDiv);

    // 创建保存按钮区域（初始隐藏）
    const saveArea = doc.createElement("div");
    saveArea.style.cssText = `
      display: none;
      justify-content: flex-end;
      margin-top: 4px;
    `;
    const saveBtn = doc.createElement("button");
    saveBtn.textContent = getString("itempane-save-note");
    saveBtn.style.cssText = `
      padding: 4px 10px;
      background: #667eea;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
    `;
    const copyBtn = doc.createElement("button");
    copyBtn.textContent = getString("itempane-copy-answer");
    copyBtn.style.cssText = `
      padding: 4px 10px;
      background: #59c0bc;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
      margin-right: 6px;
    `;
    copyBtn.addEventListener("click", async () => {
      const copied = await copyQuickChatText(doc, fullResponse || "");
      const originalText =
        copyBtn.textContent || getString("itempane-copy-answer");
      copyBtn.textContent = copied
        ? getString("itempane-copied")
        : getString("itempane-copy-failed");
      copyBtn.style.background = copied ? "#4caf50" : "#f44336";
      setTimeout(() => {
        copyBtn.textContent = originalText;
        copyBtn.style.background = "#59c0bc";
      }, 1500);
    });
    saveArea.appendChild(copyBtn);
    saveArea.appendChild(saveBtn);
    pairWrapper.appendChild(saveArea);

    const shouldFollowNewPair = quickChatPinnedToBottom;
    messagesArea.appendChild(pairWrapper);
    scrollQuickChatToBottomIfPinned(shouldFollowNewPair);

    // 清空输入框
    inputBox.value = "";
    let fullResponse = "";

    try {
      const { default: LLMService } = await import("./llmService");

      const conversationHistory = buildQuickChatConversation(
        currentChatState.conversationHistory,
        question,
      );

      let responseMetadata: LLMNoteMetadata | null = null;
      const response = await LLMService.chat({
        content: {
          kind: "legacy",
          content: currentChatState.pdfContent,
          isBase64: currentChatState.isBase64,
          policy: currentChatState.isBase64 ? "pdf-base64" : "text",
        },
        conversation: conversationHistory,
        transport: {
          abortSignal: currentChatState.abortController?.signal,
        },
        onProgress: (chunk: string) => {
          fullResponse += chunk;
          const shouldFollowStream = quickChatPinnedToBottom;
          // Update streaming AI response
          updateQuickChatAssistantMessage(aiMsgDiv, fullResponse);
          scrollQuickChatToBottomIfPinned(shouldFollowStream);
        },
      });
      fullResponse = response.text;
      responseMetadata = LLMNoteMetadataService.fromResponse("chat", response);

      // 完成后最终更新
      updateQuickChatAssistantMessage(aiMsgDiv, fullResponse);

      currentChatState.conversationHistory = appendQuickChatTurn(
        currentChatState.conversationHistory,
        question,
        fullResponse,
      );

      // 显示保存按钮
      saveArea.style.display = "flex";

      // 保存按钮点击事件
      saveBtn.addEventListener("click", async () => {
        // 检查是否已保存过
        if (currentChatState.savedPairIds.has(pairId)) {
          saveBtn.textContent = getString("itempane-saved");
          return;
        }

        // 标记正在保存
        saveBtn.textContent = getString("itempane-saving");
        saveBtn.style.background = "#9e9e9e";
        (saveBtn as HTMLButtonElement).disabled = true;

        try {
          await saveChatPairToNote(
            item,
            pairId,
            question,
            fullResponse,
            responseMetadata,
          );
          currentChatState.savedPairIds.add(pairId);
          saveBtn.textContent = getString("itempane-saved");
          saveBtn.style.background = "#4caf50";
        } catch (err: any) {
          ztoolkit.log("[AI-Butler] 保存快速追问对话失败:", err);
          saveBtn.textContent = getString("itempane-save-failed");
          saveBtn.style.background = "#f44336";
          (saveBtn as HTMLButtonElement).disabled = false;
        }
      });
    } catch (err: any) {
      if (isChatAbortError(err, currentChatState.abortController?.signal)) {
        if (fullResponse) {
          updateQuickChatAssistantMessage(
            aiMsgDiv,
            fullResponse,
            `<div style="color: #777; font-size: 11px; margin-top: 6px;">${getString("itempane-stopped-note")}</div>`,
          );
        } else {
          aiMsgDiv.innerHTML = `<strong>${getString("itempane-assistant-label")}</strong> <span style="color: #777;">${getString("itempane-stopped-empty")}</span>`;
        }
        return;
      }
      ztoolkit.log("[AI-Butler] 快速追问发送失败:", err);
      aiMsgDiv.innerHTML = `<strong>${getString("itempane-assistant-label")}</strong> <span style="color: #f44336;">${getString("itempane-error", { args: { error: err?.message || getString("itempane-send-failed") } })}</span>`;
    } finally {
      // 恢复状态
      currentChatState.isChatting = false;
      currentChatState.abortController = null;
      sendBtn.textContent = getString("itempane-send");
      sendBtn.style.background = "#59c0bc";
      (sendBtn as HTMLButtonElement).disabled = false;
      stopBtn.style.display = "none";
      (stopBtn as HTMLButtonElement).disabled = false;
      (inputBox as HTMLTextAreaElement).disabled = false;
      inputBox.focus();
    }
  });

  // Enter 发送，Shift+Enter 换行
  inputBox.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      if (currentChatState.isChatting) return;
      e.preventDefault();
      sendBtn.click();
    }
  });
}

/**
 * 转义 HTML 字符（用于聊天显示）
 */
function escapeHtmlForChat(text: string): string {
  return sanitizeQuickChatDomString(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/\n/g, "<br/>");
}

function sanitizeQuickChatDomString(text: string): string {
  let result = "";
  const input = String(text ?? "");
  for (let index = 0; index < input.length; index++) {
    const code = input.charCodeAt(index);
    const isUnsafeControl =
      code <= 8 ||
      (code >= 11 && code <= 12) ||
      (code >= 14 && code <= 31) ||
      (code >= 127 && code <= 159);
    if (isUnsafeControl) continue;

    const isUnicodeNonCharacter =
      (code >= 0xfdd0 && code <= 0xfdef) || code === 0xfffe || code === 0xffff;
    if (isUnicodeNonCharacter) continue;

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = input.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += input[index] + input[index + 1];
        index += 1;
      } else {
        result += "\uFFFD";
      }
      continue;
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      result += "\uFFFD";
      continue;
    }

    result += input[index];
  }
  return result;
}

function normalizeQuickChatXhtml(html: string): string {
  return html
    .replace(/&nbsp;/gi, "&#160;")
    .replace(
      /<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b([^>]*)>/gi,
      (match, tagName: string, attributes: string) => {
        if (match.endsWith("/>")) return match;
        return `<${tagName}${attributes.replace(/\s*\/?\s*$/, "")}/>`;
      },
    );
}

function normalizeQuickChatMarkdownStructure(markdown: string): string {
  return String(markdown ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(
      /(^|\n)(\d+)\.\s+\*\*([^*\n]{2,80})\*\*\s*:?\s*(?=\n|$)/g,
      (_match, prefix: string, index: string, title: string) =>
        `${prefix}\n### ${index}. ${title.trim()}\n`,
    )
    .replace(
      /(^|\n)\*\*([^*\n]{2,80})\*\*\s*:?\s*(?=\n|$)/g,
      (_match, prefix: string, title: string) =>
        `${prefix}\n### ${title.trim()}\n`,
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderQuickChatMarkdown(markdown: string): string {
  const safeMarkdown = sanitizeQuickChatDomString(
    normalizeQuickChatMarkdownStructure(markdown),
  );
  try {
    return normalizeQuickChatXhtml(
      sanitizeQuickChatDomString(
        SummaryView.convertMarkdownToHTMLCore(safeMarkdown),
      ),
    );
  } catch (error) {
    ztoolkit.log("[AI-Butler] 快速追问渲染失败，已降级为纯文本:", error);
    return `<p>${escapeHtmlForChat(safeMarkdown)}</p>`;
  }
}

function buildQuickChatAssistantHtml(
  markdown: string,
  suffixHtml = "",
): string {
  return `<strong>${getString("itempane-assistant-label")}</strong><br/>${renderQuickChatMarkdown(markdown)}${suffixHtml}`;
}

function updateQuickChatAssistantMessage(
  container: HTMLElement,
  markdown: string,
  suffixHtml = "",
): void {
  try {
    container.innerHTML = buildQuickChatAssistantHtml(markdown, suffixHtml);
  } catch (error) {
    ztoolkit.log(
      "[AI-Butler] 快速追问写入渲染结果失败，尝试清洗后重试:",
      error,
    );
    try {
      container.innerHTML = buildQuickChatAssistantHtml(
        sanitizeQuickChatDomString(markdown),
        sanitizeQuickChatDomString(suffixHtml),
      );
    } catch (retryError) {
      ztoolkit.log(
        "[AI-Butler] 快速追问清洗后仍写入失败，已降级为纯文本:",
        retryError,
      );
      container.textContent = `${getString("itempane-assistant-label")}\n${sanitizeQuickChatDomString(markdown)}`;
    }
  }
}

async function copyQuickChatText(
  doc: Document,
  text: string,
): Promise<boolean> {
  const safeText = sanitizeQuickChatDomString(text).trim();
  if (!safeText) return false;

  const win = doc.defaultView as any;
  try {
    if (win?.navigator?.clipboard?.writeText) {
      await win.navigator.clipboard.writeText(safeText);
      return true;
    }
  } catch (error) {
    ztoolkit.log("[AI-Butler] 快速追问 Clipboard API 复制失败:", error);
  }

  try {
    const textarea = doc.createElement("textarea");
    textarea.value = safeText;
    textarea.setAttribute("readonly", "readonly");
    textarea.style.cssText = `
      position: fixed;
      left: -9999px;
      top: 0;
      opacity: 0;
    `;
    const copyHost = doc.body || doc.documentElement;
    if (!copyHost) return false;
    copyHost.appendChild(textarea);
    textarea.select();
    const copied = Boolean((doc as any).execCommand?.("copy"));
    textarea.remove();
    return copied;
  } catch (error) {
    ztoolkit.log("[AI-Butler] 快速追问 fallback 复制失败:", error);
    return false;
  }
}

/**
 * 获取或创建"AI管家-后续追问"独立笔记
 */
async function getOrCreateChatNote(item: Zotero.Item): Promise<Zotero.Item> {
  const title =
    (item.getField("title") as string) || getString("common-paper-title");

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
  const header = `<h2>${getString("itempane-chat-note-title", { args: { title: escapeHtmlForNote(title) } })}</h2>`;
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
  metadata?: LLMNoteMetadata | null,
): Promise<void> {
  const note = await getOrCreateChatNote(item);
  let noteHtml = (note as any).getNote?.() || "";
  const normalizedNoteHtml = normalizeFollowUpChatNoteHtml(noteHtml);

  // 检查是否已存在相同 pairId 的对话对，防止重复保存
  if (normalizedNoteHtml.includes(`AI_BUTLER_CHAT_PAIR_START id=${pairId}`)) {
    if (normalizedNoteHtml !== noteHtml) {
      (note as any).setNote(normalizedNoteHtml);
      await (note as any).saveTx();
    }
    ztoolkit.log("[AI-Butler] 该对话对已保存过，跳过重复保存");
    return;
  }
  noteHtml = normalizedNoteHtml;

  const blockContent = buildFollowUpChatPairNoteHtml({
    pairId,
    userMessage,
    assistantMessage,
    sourceLabel: getString("itempane-quick-chat-source-label"),
  });
  const block = metadata
    ? LLMNoteMetadataService.wrapHtml(blockContent, metadata)
    : blockContent;

  noteHtml += block;
  (note as any).setNote(noteHtml);
  await (note as any).saveTx();
  ztoolkit.log("[AI-Butler] 快速追问对话已保存到笔记");
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

async function resolveSidebarSummaryNote(
  item: Zotero.Item,
  kind: AiNoteKind = "summary",
): Promise<SidebarSummaryNote | null> {
  const record = await AiNoteService.findNoteRecord(item, kind);
  return record ? { note: record.note, rawHtml: record.rawHtml } : null;
}

function getNoteKindFromElement(element: HTMLElement): AiNoteKind {
  return element.dataset.aiNoteKind === "deepRead" ? "deepRead" : "summary";
}

export function getSidebarNoteElementId(
  baseId: string,
  kind: AiNoteKind,
): string {
  return kind === "summary" ? baseId : `${baseId}-${kind}`;
}

export function getSidebarNoteHeightPrefKey(kind: AiNoteKind): string {
  return kind === "summary" ? "sidebarNoteHeight" : "sidebarDeepReadHeight";
}

export function getSidebarNoteCollapsedPrefKey(kind: AiNoteKind): string {
  return kind === "summary"
    ? "sidebarNoteCollapsed"
    : "sidebarDeepReadCollapsed";
}

export function getSidebarMetadataSelectionKey(
  itemId: number,
  noteId: number,
  kind: AiNoteKind,
): string {
  return `${kind}:${itemId}:${noteId}`;
}

function getSelectedMetadataBlockIndex(
  doc: Document,
  blockCount: number,
  kind: AiNoteKind = "summary",
): number {
  const metadataSelector = doc.getElementById(
    getSidebarNoteElementId("ai-butler-note-metadata-selector", kind),
  ) as HTMLSelectElement | null;
  const requested = Number(
    metadataSelector?.dataset.selectedIndex || metadataSelector?.value || "",
  );
  if (Number.isInteger(requested) && requested >= 0 && requested < blockCount) {
    return requested;
  }
  return Math.max(0, blockCount - 1);
}

function hideSidebarMetadataMenu(
  doc: Document,
  kind: AiNoteKind = "summary",
): void {
  const menu = doc.getElementById(
    getSidebarNoteElementId("ai-butler-note-metadata-menu", kind),
  ) as HTMLElement | null;
  if (menu) menu.style.display = "none";
}

function hideSidebarMetadataPicker(
  doc: Document,
  kind: AiNoteKind = "summary",
): void {
  const picker = doc.getElementById(
    getSidebarNoteElementId("ai-butler-note-metadata-picker", kind),
  ) as HTMLElement | null;
  const selector = doc.getElementById(
    getSidebarNoteElementId("ai-butler-note-metadata-selector", kind),
  ) as HTMLSelectElement | null;
  const menu = doc.getElementById(
    getSidebarNoteElementId("ai-butler-note-metadata-menu", kind),
  ) as HTMLElement | null;
  if (selector) {
    selector.innerHTML = "";
    selector.onchange = null;
    delete selector.dataset.selectedIndex;
  }
  if (menu) {
    menu.innerHTML = "";
    menu.style.display = "none";
  }
  if (picker) picker.style.display = "none";
}

function getSummaryBlockShortLabel(
  block: ReturnType<typeof LLMNoteMetadataService.parseSummaryBlocks>[number],
): string {
  if (!block.metadata) return getString("itempane-note-model-not-recorded");
  const provider =
    block.metadata.providerName || getString("llm-metadata-unknown-provider");
  const model =
    block.metadata.modelId || getString("llm-metadata-unknown-model");
  return `${provider} / ${model}`;
}

function updateSidebarMetadataButtonLabel(
  doc: Document,
  kind: AiNoteKind,
  selectedIndex: number,
  total: number,
  block: ReturnType<typeof LLMNoteMetadataService.parseSummaryBlocks>[number],
): void {
  const button = doc.getElementById(
    getSidebarNoteElementId("ai-butler-note-metadata-button", kind),
  ) as HTMLButtonElement | null;
  if (!button) return;

  button.textContent = getString("itempane-note-selector-label", {
    args: { current: selectedIndex + 1, total },
  });
  button.title = getSummaryBlockShortLabel(block);
}

function normalizeEditableNoteHtml(html: string): string {
  return html.trim();
}

function hasRenderableSidebarHtml(html: string): boolean {
  return (
    html
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<!--[^]*?-->/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&#160;/gi, " ")
      .replace(/\s+/g, "")
      .trim().length > 0
  );
}

function getDisplaySummaryBlocks(
  blocks: ReturnType<typeof LLMNoteMetadataService.parseSummaryBlocks>,
): ReturnType<typeof LLMNoteMetadataService.parseSummaryBlocks> {
  return blocks.filter(
    (block) =>
      block.kind === "metadata" || hasRenderableSidebarHtml(block.content),
  );
}

function readSidebarSummarySelectionMap(): Record<string, string> {
  try {
    const raw = String(getPref(SIDEBAR_SUMMARY_SELECTION_PREF) || "{}");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function getSavedSidebarSummaryBlockId(
  itemId: number,
  noteId: number,
  kind: AiNoteKind = "summary",
): string | null {
  const selections = readSidebarSummarySelectionMap();
  return (
    selections[getSidebarMetadataSelectionKey(itemId, noteId, kind)] ||
    (kind === "summary" ? selections[`${itemId}:${noteId}`] : null) ||
    null
  );
}

function saveSidebarSummaryBlockSelection(
  itemId: number,
  noteId: number,
  kind: AiNoteKind,
  blockId: string,
): void {
  try {
    const selections = readSidebarSummarySelectionMap();
    selections[getSidebarMetadataSelectionKey(itemId, noteId, kind)] = blockId;
    setPref(SIDEBAR_SUMMARY_SELECTION_PREF, JSON.stringify(selections) as any);
  } catch (err) {
    ztoolkit.log("[AI-Butler] Failed to save sidebar model selection:", err);
  }
}

function resolveDefaultSummaryBlockIndex(
  blocks: ReturnType<typeof LLMNoteMetadataService.parseSummaryBlocks>,
  savedBlockId: string | null,
): number {
  if (savedBlockId) {
    const savedIndex = blocks.findIndex(
      (block) => block.blockId === savedBlockId,
    );
    if (savedIndex >= 0) return savedIndex;
  }

  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].kind === "metadata") return i;
  }

  return Math.max(0, blocks.length - 1);
}

function repairHtmlFragmentWithHtmlParser(doc: Document, html: string): string {
  try {
    const mainWin: any =
      Zotero && (Zotero as any).getMainWindow
        ? (Zotero as any).getMainWindow()
        : (globalThis as any);
    const implementation: any =
      mainWin?.document?.implementation || doc.implementation;
    const createHTMLDocument: any = implementation?.createHTMLDocument;
    if (typeof createHTMLDocument !== "function") return html;

    const htmlDoc: Document = createHTMLDocument.call(implementation, "");
    const container = htmlDoc.createElement("div");
    container.innerHTML = html;
    return container.innerHTML;
  } catch (err) {
    ztoolkit.log("[AI-Butler] 修复侧边栏 HTML 片段失败:", err);
    return html;
  }
}

function normalizeHtmlFragmentForXhtml(doc: Document, html: string): string {
  const repaired = repairHtmlFragmentWithHtmlParser(doc, html);
  return repaired
    .replace(/<hr\s*(?:([^>/]*))?>/gi, "<hr $1/>")
    .replace(/<br\s*(?:([^>/]*))?>/gi, "<br $1/>")
    .replace(/<img\s+([^>]*)(?<!\/)>/gi, "<img $1/>")
    .replace(/<input\s+([^>]*)(?<!\/)>/gi, "<input $1/>")
    .replace(/<meta\s+([^>]*)(?<!\/)>/gi, "<meta $1/>")
    .replace(/<link\s+([^>]*)(?<!\/)>/gi, "<link $1/>")
    .replace(/\s+\/>/g, "/>")
    .replace(/&nbsp;/gi, "&#160;")
    .replace(new RegExp("<(?=[^a-zA-Z/?!])", "g"), "&lt;");
}

function getVisibleTextLength(text: string): number {
  return Array.from(text.replace(/\s+/g, "").trim()).length;
}

function demoteLongSidebarHeadingsToBlockquote(
  doc: Document,
  html: string,
): string {
  try {
    const mainWin: any =
      Zotero && (Zotero as any).getMainWindow
        ? (Zotero as any).getMainWindow()
        : (globalThis as any);
    const implementation: any =
      mainWin?.document?.implementation || doc.implementation;
    const createHTMLDocument: any = implementation?.createHTMLDocument;
    if (typeof createHTMLDocument !== "function") return html;

    const htmlDoc: Document = createHTMLDocument.call(implementation, "");
    const container = htmlDoc.createElement("div");
    container.innerHTML = html;

    container.querySelectorAll("h1, h2").forEach((heading: Element) => {
      const headingText = heading.textContent || "";
      if (
        getVisibleTextLength(headingText) <=
        SIDEBAR_HEADING_TO_BLOCKQUOTE_TEXT_THRESHOLD
      ) {
        return;
      }

      const blockquote = htmlDoc.createElement("blockquote");
      const paragraph = htmlDoc.createElement("p");
      while (heading.firstChild) {
        paragraph.appendChild(heading.firstChild);
      }
      blockquote.appendChild(paragraph);
      heading.replaceWith(blockquote);
    });

    return container.innerHTML;
  } catch (err) {
    ztoolkit.log("[AI-Butler] 降级侧边栏长一级标题失败:", err);
    return html;
  }
}

async function startSidebarNoteEdit(
  doc: Document,
  item: Zotero.Item,
  noteContent: HTMLElement,
): Promise<void> {
  try {
    if (sidebarNoteEditState?.isSaving) return;

    const noteKind = getNoteKindFromElement(noteContent);
    const resolvedNote = await resolveSidebarSummaryNote(item, noteKind);
    if (!resolvedNote) {
      updateSidebarNoteEditControls(
        doc,
        "missing",
        getString("itempane-note-no-editable-note"),
        undefined,
        noteKind,
      );
      return;
    }

    const rawNoteHtml = resolvedNote.rawHtml;
    const summaryBlocks = getDisplaySummaryBlocks(
      LLMNoteMetadataService.parseSummaryBlocks(rawNoteHtml),
    );
    const selectedBlockIndex =
      summaryBlocks.length > 0
        ? getSelectedMetadataBlockIndex(doc, summaryBlocks.length, noteKind)
        : -1;
    const selectedBlock =
      selectedBlockIndex >= 0 ? summaryBlocks[selectedBlockIndex] : null;
    const editableHtml = LLMNoteMetadataService.stripSidebarMetadata(
      selectedBlock ? selectedBlock.content : rawNoteHtml,
    );
    const safeEditableHtml = normalizeHtmlFragmentForXhtml(doc, editableHtml);

    sidebarNoteEditState = {
      itemId: item.id,
      noteId: resolvedNote.note.id,
      noteKind,
      blockId: selectedBlock?.blockId || null,
      selectedBlockIndex,
      originalRawHtml: rawNoteHtml,
      originalDateModified: String(
        (resolvedNote.note as any).dateModified || "",
      ),
      isSaving: false,
    };

    noteContent.innerHTML = safeEditableHtml || "<p><br/></p>";
    noteContent.contentEditable = "true";
    noteContent.dataset.aiButlerEditMode = "true";
    bindSidebarNoteEditEventGuards(noteContent);
    noteContent.style.outline = "1px solid rgba(89, 192, 188, 0.7)";
    noteContent.style.background = "rgba(89, 192, 188, 0.06)";
    noteContent.style.borderRadius = "4px";
    noteContent.style.minHeight = "100%";
    updateSidebarNoteEditControls(
      doc,
      "editing",
      getString("itempane-note-editing"),
      undefined,
      noteKind,
    );

    try {
      noteContent.focus();
    } catch {
      // ignore focus errors in Zotero/XUL documents
    }
  } catch (err: any) {
    ztoolkit.log("[AI-Butler] 进入侧边栏笔记编辑失败:", err);
    updateSidebarNoteEditControls(
      doc,
      "preview",
      getString("itempane-note-edit-failed", {
        args: { message: String(err?.message || err) },
      }),
      "#d32f2f",
      getNoteKindFromElement(noteContent),
    );
  }
}

async function saveSidebarNoteEdit(
  doc: Document,
  item: Zotero.Item,
  noteContent: HTMLElement,
): Promise<void> {
  const editState = sidebarNoteEditState;
  if (!editState || editState.itemId !== item.id || editState.isSaving) return;
  const noteKind = editState.noteKind;

  editState.isSaving = true;
  updateSidebarNoteEditControls(
    doc,
    "saving",
    getString("itempane-note-saving"),
    undefined,
    noteKind,
  );

  try {
    const latestNote = await Zotero.Items.getAsync(editState.noteId);
    if (!latestNote) {
      throw new Error(getString("itempane-note-edit-missing"));
    }

    const latestHtml: string = (latestNote as any).getNote?.() || "";
    const latestDateModified = String((latestNote as any).dateModified || "");
    if (latestHtml !== editState.originalRawHtml) {
      throw new Error(getString("itempane-note-stale-error"));
    }
    if (
      latestDateModified &&
      editState.originalDateModified &&
      latestDateModified !== editState.originalDateModified
    ) {
      ztoolkit.log(
        "[AI-Butler] AI note dateModified changed but HTML is unchanged; saving sidebar edits.",
      );
    }

    const editedHtml = normalizeEditableNoteHtml(String(noteContent.innerHTML));
    if (editState.blockId) {
      const latestBlocks = getDisplaySummaryBlocks(
        LLMNoteMetadataService.parseSummaryBlocks(latestHtml),
      );
      const expectedBlock = latestBlocks.find(
        (block) => block.blockId === editState.blockId,
      );
      if (!expectedBlock) {
        throw new Error(getString("itempane-note-edit-structure-changed"));
      }
    }

    const nextHtml = editState.blockId
      ? LLMNoteMetadataService.replaceSummaryBlockContent(
          latestHtml,
          editState.blockId,
          editedHtml,
        )
      : editedHtml;

    (latestNote as any).setNote(nextHtml);
    await (latestNote as any).saveTx();

    sidebarNoteEditState = null;
    resetSidebarNoteContentEditMode(noteContent);
    updateSidebarNoteEditControls(
      doc,
      "preview",
      getString("itempane-note-saved"),
      "#4caf50",
      noteKind,
    );
    noteContent.innerHTML = `<div style="color: #999; text-align: center; padding: 10px;">${getString("itempane-status-refreshing")}</div>`;
    await loadNoteContent(doc, item, noteContent, noteKind);
    setSidebarNoteEditStatus(
      doc,
      getString("itempane-note-saved"),
      "#4caf50",
      noteKind,
    );
    setTimeout(() => {
      if (!isSidebarNoteEditing(item.id)) {
        setSidebarNoteEditStatus(doc, "", undefined, noteKind);
      }
    }, 1500);
  } catch (err: any) {
    ztoolkit.log("[AI-Butler] 保存侧边栏笔记失败:", err);
    editState.isSaving = false;
    updateSidebarNoteEditControls(
      doc,
      "editing",
      err?.message || getString("itempane-note-save-failed"),
      "#d32f2f",
      noteKind,
    );
  }
}

function cancelSidebarNoteEdit(
  doc: Document,
  item: Zotero.Item,
  noteContent: HTMLElement,
): void {
  const editState = sidebarNoteEditState;
  if (!editState || editState.itemId !== item.id || editState.isSaving) return;
  const noteKind = editState.noteKind;

  sidebarNoteEditState = null;
  resetSidebarNoteContentEditMode(noteContent);
  updateSidebarNoteEditControls(
    doc,
    "preview",
    getString("itempane-note-cancelled"),
    undefined,
    noteKind,
  );
  noteContent.innerHTML = `<div style="color: #999; text-align: center; padding: 10px;">${getString("itempane-status-restoring")}</div>`;
  void loadNoteContent(doc, item, noteContent, noteKind);
}

async function deleteSidebarSummaryBlock(
  doc: Document,
  item: Zotero.Item,
  noteContent: HTMLElement,
): Promise<void> {
  if (isSidebarNoteEditing(item.id)) {
    setSidebarNoteEditStatus(
      doc,
      getString("itempane-note-editing-cannot-delete"),
      "#d32f2f",
      getNoteKindFromElement(noteContent),
    );
    return;
  }

  try {
    const noteKind = getNoteKindFromElement(noteContent);
    const resolvedNote = await resolveSidebarSummaryNote(item, noteKind);
    if (!resolvedNote) {
      updateSidebarNoteEditControls(
        doc,
        "missing",
        getString("itempane-note-no-deletable-note"),
        undefined,
        noteKind,
      );
      return;
    }

    const summaryBlocks = getDisplaySummaryBlocks(
      LLMNoteMetadataService.parseSummaryBlocks(resolvedNote.rawHtml),
    );
    if (summaryBlocks.length === 0) {
      updateSidebarNoteEditControls(
        doc,
        "missing",
        getString("itempane-note-no-deletable-summary"),
        undefined,
        noteKind,
      );
      return;
    }

    const selectedBlockIndex = getSelectedMetadataBlockIndex(
      doc,
      summaryBlocks.length,
      noteKind,
    );
    const selectedBlock = summaryBlocks[selectedBlockIndex];
    const label =
      LLMNoteMetadataService.formatSummaryBlockSelectorLabel(selectedBlock);
    const ok = Services.prompt.confirm(
      Zotero.getMainWindow() as any,
      getString("itempane-delete-summary-title"),
      getString("itempane-delete-summary-confirm", { args: { label } }),
    );
    if (!ok) return;

    const latestNote = await Zotero.Items.getAsync(resolvedNote.note.id);
    if (!latestNote) {
      throw new Error(getString("itempane-note-edit-missing"));
    }

    const latestHtml: string = (latestNote as any).getNote?.() || "";
    const latestBlocks = getDisplaySummaryBlocks(
      LLMNoteMetadataService.parseSummaryBlocks(latestHtml),
    );
    const latestBlock = latestBlocks.find(
      (block) => block.blockId === selectedBlock.blockId,
    );
    if (!latestBlock) {
      throw new Error(getString("itempane-note-delete-structure-changed"));
    }

    const nextHtml = LLMNoteMetadataService.removeSummaryBlock(
      latestHtml,
      selectedBlock.blockId,
    );
    if (!LLMNoteMetadataService.hasSummaryBlocks(nextHtml)) {
      await (latestNote as any).eraseTx?.();
      hideSidebarMetadataPicker(doc, noteKind);
      noteContent.innerHTML = `<div style="color: #999; text-align: center; padding: 10px;">${getString("itempane-status-refreshing")}</div>`;
      await loadNoteContent(doc, item, noteContent, noteKind);
      setSidebarNoteEditStatus(
        doc,
        getString("itempane-note-deleted-kind", {
          args: { kind: getSidebarNoteKindLabel(noteKind) },
        }),
        "#4caf50",
        noteKind,
      );
      return;
    }

    (latestNote as any).setNote(nextHtml);
    await (latestNote as any).saveTx();

    const remainingCount = getDisplaySummaryBlocks(
      LLMNoteMetadataService.parseSummaryBlocks(nextHtml),
    ).length;
    const selector = doc.getElementById(
      getSidebarNoteElementId("ai-butler-note-metadata-selector", noteKind),
    ) as HTMLSelectElement | null;
    if (selector) {
      selector.dataset.selectedIndex = String(
        Math.min(selectedBlockIndex, Math.max(0, remainingCount - 1)),
      );
    }

    noteContent.innerHTML = `<div style="color: #999; text-align: center; padding: 10px;">${getString("itempane-status-refreshing")}</div>`;
    await loadNoteContent(doc, item, noteContent, noteKind);
    setSidebarNoteEditStatus(
      doc,
      getString("itempane-note-deleted-current-summary"),
      "#4caf50",
      noteKind,
    );
  } catch (err: any) {
    ztoolkit.log("[AI-Butler] 删除侧边栏总结失败:", err);
    updateSidebarNoteEditControls(
      doc,
      "preview",
      err?.message || getString("itempane-note-delete-failed"),
      "#d32f2f",
      getNoteKindFromElement(noteContent),
    );
  }
}

/**
 * 异步加载笔记内容
 */
async function loadNoteContent(
  doc: Document,
  item: Zotero.Item,
  noteContent: HTMLElement,
  noteKind: AiNoteKind = "summary",
): Promise<void> {
  try {
    if (isSidebarNoteEditing(item.id)) {
      setSidebarNoteEditStatus(
        doc,
        getString("itempane-note-editing-skip-refresh"),
        undefined,
        noteKind,
      );
      return;
    }

    resetSidebarNoteContentEditMode(noteContent);
    let aiNoteContent = "";
    const resolvedNote = await resolveSidebarSummaryNote(item, noteKind);

    if (!resolvedNote) {
      hideSidebarMetadataPicker(doc, noteKind);
      noteContent.innerHTML = `
        <div style="text-align: center; color: #9e9e9e; padding: 16px;">
          <div style="font-size: 24px; margin-bottom: 8px;">📄</div>
          <div>${getString("itempane-note-empty-kind", { args: { kind: getSidebarNoteKindLabel(noteKind) } })}</div>
        </div>
      `;
      updateSidebarNoteEditControls(doc, "missing", "", undefined, noteKind);
      return;
    }

    updateSidebarNoteEditControls(doc, "preview", "", undefined, noteKind);
    let rawNoteHtml: string = resolvedNote.rawHtml;
    const guardedNoteHtml = addZoteroNoteOverflowGuards(rawNoteHtml);
    if (guardedNoteHtml !== rawNoteHtml) {
      rawNoteHtml = guardedNoteHtml;
      try {
        (resolvedNote.note as any).setNote?.(guardedNoteHtml);
        await (resolvedNote.note as any).saveTx?.();
      } catch (error) {
        ztoolkit.log("[AI-Butler] 修复 AI 笔记溢出样式失败:", error);
      }
    }
    const summaryBlocks = getDisplaySummaryBlocks(
      LLMNoteMetadataService.parseSummaryBlocks(rawNoteHtml),
    );
    let selectedBlockIndex = resolveDefaultSummaryBlockIndex(
      summaryBlocks,
      getSavedSidebarSummaryBlockId(item.id, resolvedNote.note.id, noteKind),
    );
    const metadataSelector = doc.getElementById(
      getSidebarNoteElementId("ai-butler-note-metadata-selector", noteKind),
    ) as HTMLSelectElement | null;
    if (metadataSelector && summaryBlocks.length > 0) {
      const metadataPicker = doc.getElementById(
        getSidebarNoteElementId("ai-butler-note-metadata-picker", noteKind),
      ) as HTMLElement | null;
      const metadataMenu = doc.getElementById(
        getSidebarNoteElementId("ai-butler-note-metadata-menu", noteKind),
      ) as HTMLElement | null;
      const requested = Number(metadataSelector.dataset.selectedIndex || "");
      if (
        Number.isInteger(requested) &&
        requested >= 0 &&
        requested < summaryBlocks.length
      ) {
        selectedBlockIndex = requested;
      }

      metadataSelector.innerHTML = "";
      metadataSelector.onchange = null;
      if (metadataMenu) {
        metadataMenu.innerHTML = "";
      }

      const selectSummaryBlock = (index: number) => {
        if (isSidebarNoteEditing(item.id)) {
          metadataSelector.value =
            metadataSelector.dataset.selectedIndex || metadataSelector.value;
          setSidebarNoteEditStatus(
            doc,
            getString("itempane-note-editing-cannot-switch-model"),
            undefined,
            noteKind,
          );
          return;
        }
        const selected = summaryBlocks[index];
        if (!selected) return;
        metadataSelector.value = String(index);
        metadataSelector.dataset.selectedIndex = String(index);
        saveSidebarSummaryBlockSelection(
          item.id,
          resolvedNote.note.id,
          noteKind,
          selected.blockId,
        );
        hideSidebarMetadataMenu(doc, noteKind);
        updateSidebarMetadataButtonLabel(
          doc,
          noteKind,
          index,
          summaryBlocks.length,
          selected,
        );
        const contentEl = doc.getElementById(
          getSidebarNoteElementId("ai-butler-note-content", noteKind),
        ) as HTMLElement | null;
        if (contentEl) {
          contentEl.innerHTML = `<div style="color: #999; text-align: center; padding: 10px;">${getString("itempane-note-switching-model")}</div>`;
          void loadNoteContent(
            doc,
            item,
            contentEl,
            getNoteKindFromElement(contentEl),
          );
        }
      };

      summaryBlocks.forEach((block, index) => {
        const label =
          LLMNoteMetadataService.formatSummaryBlockSelectorLabel(block);
        const tooltip = LLMNoteMetadataService.formatSummaryBlockTooltip(block);
        const option = doc.createElement("option");
        option.value = String(index);
        option.textContent = label;
        option.title = tooltip;
        metadataSelector.appendChild(option);

        if (metadataMenu) {
          const itemButton = doc.createElement("button");
          itemButton.type = "button";
          itemButton.title = tooltip;
          itemButton.style.cssText = `
            display: grid;
            grid-template-columns: auto 1fr;
            column-gap: 8px;
            align-items: center;
            width: 100%;
            padding: 6px 8px;
            border: 0;
            border-radius: 6px;
            background: ${index === selectedBlockIndex ? "rgba(89, 192, 188, 0.14)" : "transparent"};
            color: inherit;
            cursor: pointer;
            font-size: 12px;
            line-height: 1.35;
            text-align: left;
          `;

          const countLine = doc.createElement("span");
          countLine.textContent = `${index + 1}/${summaryBlocks.length}`;
          countLine.style.cssText = `
            min-width: 32px;
            font-weight: 700;
            color: #59c0bc;
          `;
          const labelLine = doc.createElement("span");
          labelLine.textContent = label;
          labelLine.style.cssText = `
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            opacity: 0.82;
          `;
          itemButton.appendChild(countLine);
          itemButton.appendChild(labelLine);
          itemButton.addEventListener("click", (event: Event) => {
            event.stopPropagation();
            selectSummaryBlock(index);
          });
          metadataMenu.appendChild(itemButton);
        }
      });

      metadataSelector.value = String(selectedBlockIndex);
      metadataSelector.dataset.selectedIndex = String(selectedBlockIndex);
      metadataSelector.title = LLMNoteMetadataService.formatSummaryBlockTooltip(
        summaryBlocks[selectedBlockIndex],
      );
      if (metadataPicker) {
        metadataPicker.style.display = "inline-flex";
      }
      updateSidebarMetadataButtonLabel(
        doc,
        noteKind,
        selectedBlockIndex,
        summaryBlocks.length,
        summaryBlocks[selectedBlockIndex],
      );
      saveSidebarSummaryBlockSelection(
        item.id,
        resolvedNote.note.id,
        noteKind,
        summaryBlocks[selectedBlockIndex].blockId,
      );
    } else {
      hideSidebarMetadataPicker(doc, noteKind);
    }

    aiNoteContent =
      summaryBlocks.length > 0
        ? summaryBlocks[selectedBlockIndex].content
        : rawNoteHtml;
    aiNoteContent = LLMNoteMetadataService.stripSidebarMetadata(aiNoteContent);

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
    styleEl.textContent =
      katexCss + "\n" + adaptedCss + "\n" + SIDEBAR_NOTE_OVERFLOW_GUARD_CSS;

    /**
     * 清理 LaTeX 公式中的 HTML 标签
     * LLM 有时会在公式中输出 <br> 等 HTML 标签，需要在渲染前移除
     */
    const cleanLatex = (latex: string): string => {
      return normalizeLatexForKatex(latex)
        .replace(/<br\s*\/?>/gi, " ") // <br> or <br/> -> 空格
        .replace(/<\/?(?:span|br|p|div|em|strong|code|sup|sub)\b[^>]*>/gi, ""); // 移除常见 HTML 标签，保留 LaTeX 比较符号
    };

    // Pre-render LaTeX formulas BEFORE XML validation
    // This prevents LaTeX syntax (like \begin{cases}) from causing XML parsing errors
    const renderLatexFormulas = (content: string): string => {
      let result = content;

      result = result.replace(
        /<p\b([^>]*)>\s*(<span\b([^>]*)class="[^"]*\bmath\b[^"]*"([^>]*)>)/g,
        (
          match: string,
          paragraphAttrs: string,
          spanOpen: string,
          beforeClassAttrs: string,
          afterClassAttrs: string,
        ) => {
          if (
            /text-align\s*:\s*center/i.test(paragraphAttrs) &&
            !/\bdata-ai-butler-display-math\s*=/i.test(spanOpen)
          ) {
            return match.replace(
              spanOpen,
              `<span${beforeClassAttrs}class="math"${afterClassAttrs} data-ai-butler-display-math="true">`,
            );
          }
          return match;
        },
      );

      result = result.replace(
        /<pre\b[^>]*class="[^"]*\bmath\b[^"]*"[^>]*>([\s\S]*?)<\/pre>/g,
        (_match: string, innerContent: string) => {
          const unescaped = decodeMathHtmlEntities(innerContent).trim();
          const latex = stripMathDelimiters(unescaped);
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
        },
      );

      // 1. Render Zotero native format: <span class="math">...</span> (contains $...$ or $$...$$)
      result = result.replace(
        /<span\b([^>]*)class="[^"]*\bmath\b[^"]*"([^>]*)>([\s\S]*?)<\/span>/g,
        (
          _match: string,
          beforeClassAttrs: string,
          afterClassAttrs: string,
          innerContent: string,
        ) => {
          // content might be $x$ or $$x$$ or escaped HTML
          const unescaped = decodeMathHtmlEntities(innerContent);

          const trimmed = unescaped.trim();
          const mathAttrs = `${beforeClassAttrs} ${afterClassAttrs}`;
          const isMarkedDisplay =
            /\bdata-ai-butler-display-math\s*=\s*["']true["']/i.test(mathAttrs);

          // Check for block formula markers
          // 1. Double dollar signs $$...$$
          // 2. Single dollar sign with \displaystyle (Zotero native block format)
          const isDoubleDollar =
            trimmed.startsWith("$$") && trimmed.endsWith("$$");
          const isSingleDollar =
            trimmed.startsWith("$") && trimmed.endsWith("$");
          const hasDisplayStyle = trimmed.includes("\\displaystyle");

          const rawLatex = stripMathDelimiters(trimmed);
          const isTaggedDisplay = requiresDisplayMath(rawLatex);
          const isBlock =
            isMarkedDisplay ||
            isDoubleDollar ||
            (isSingleDollar && (hasDisplayStyle || isTaggedDisplay));

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
            const isTaggedDisplay = requiresDisplayMath(latex);
            try {
              const rendered = katex.renderToString(cleanLatex(latex), {
                throwOnError: false,
                displayMode: isTaggedDisplay ? true : false, // inline
                output: "html",
                trust: true,
                strict: false,
              });
              if (isTaggedDisplay) {
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
            const rendered = katex.renderToString(
              cleanLatex(decodeMathHtmlEntities(formula.trim())),
              {
                throwOnError: false,
                displayMode: true,
                output: "html",
                trust: true,
                strict: false,
              },
            );
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
            const latex = decodeMathHtmlEntities(formula.trim());
            const isTaggedDisplay = requiresDisplayMath(latex);
            const rendered = katex.renderToString(cleanLatex(latex), {
              throwOnError: false,
              displayMode: isTaggedDisplay ? true : false,
              output: "html",
              trust: true,
              strict: false,
            });
            if (isTaggedDisplay) {
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

    const adjustedHeadingContent = demoteLongSidebarHeadingsToBlockquote(
      doc,
      aiNoteContent,
    );

    // Render LaTeX first (before XML validation)
    const latexRenderedContent = renderLatexFormulas(adjustedHeadingContent);

    const sanitizedContent = normalizeHtmlFragmentForXhtml(
      doc,
      latexRenderedContent,
    );

    // 3. Validate with DOMParser
    const parser = new DOMParser();
    const docTest = parser.parseFromString(
      `<div>${sanitizedContent}</div>`,
      "application/xhtml+xml",
    );
    const parserError = docTest.querySelector("parsererror");

    if (parserError) {
      // Extract error details
      const errorText =
        parserError.textContent || getString("itempane-note-xml-parse-unknown");
      const serializer = new XMLSerializer();
      const errorHtml = serializer.serializeToString(parserError);

      // Try to parse line and column from error message
      const locationMatch = errorHtml.match(/Line Number (\d+), Column (\d+)/i);
      let errorLocation = "";
      let errorContext = "";

      if (locationMatch) {
        const line = parseInt(locationMatch[1], 10);
        const col = parseInt(locationMatch[2], 10);
        errorLocation = getString("itempane-note-xml-location", {
          args: { line, column: col },
        });

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
      headerText.textContent = getString("itempane-note-render-failed");

      // Prepare full error text for copying
      const fullErrorText = [
        getString("itempane-note-xml-copy-title"),
        errorText,
        "",
        errorLocation
          ? getString("itempane-note-xml-copy-location", {
              args: { location: errorLocation },
            })
          : "",
        "",
        getString("itempane-note-xml-copy-context"),
        errorContext,
      ].join("\n");

      const copyBtn = doc.createElement("button");
      copyBtn.textContent = getString("itempane-copy");
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
          copyBtn.textContent = getString("itempane-copied");
          setTimeout(() => {
            copyBtn.textContent = getString("itempane-copy");
          }, 2000);
        } catch (e) {
          ztoolkit.log("[AI-Butler] Copy failed:", e);
          copyBtn.textContent = getString("itempane-failed");
          setTimeout(() => {
            copyBtn.textContent = getString("itempane-copy");
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
      noteContent.innerHTML = sanitizedContent;
    }
  } catch (err: any) {
    ztoolkit.log("[AI-Butler] 加载笔记失败:", err);
    noteContent.innerHTML = `<div style="color: #d32f2f; padding: 10px;">${getString("itempane-note-load-failed", { args: { message: escapeHtmlForChat(err.message) } })}</div>`;
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
      generateImageBtn.textContent = getString(
        "itempane-generate-image-summary",
      );
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
          generateImageBtn.textContent = getString("itempane-adding-to-queue");
          const { TaskQueueManager } = await import("./taskQueue");
          const queueManager = TaskQueueManager.getInstance();
          await queueManager.addImageSummaryTask(targetItem);
          generateImageBtn.textContent = getString("itempane-added-to-queue");
        } catch (err: any) {
          generateImageBtn.textContent = getString("itempane-failed");
          setTimeout(() => {
            generateImageBtn.textContent = getString(
              "itempane-generate-image-summary",
            );
            generateImageBtn.disabled = false;
          }, 2000);
        }
      });

      imageContainer.innerHTML = `
        <div style="color: #9e9e9e; margin-bottom: 8px;">
          <div style="font-size: 24px; margin-bottom: 4px;">🖼️</div>
          <div style="font-size: 12px;">${getString("itempane-no-image-summary")}</div>
        </div>
      `;
      imageContainer.appendChild(generateImageBtn);
      return;
    }

    // 使用新的提取方法获取图片（支持 data URI 和附件引用）
    const imgSrc = await ImageNoteGenerator.getImageFromNote(imageNote);

    if (!imgSrc) {
      imageContainer.innerHTML = `<div style="color: #9e9e9e; font-size: 12px;">${getString("itempane-image-not-found")}</div>`;
      return;
    }

    // 创建图片元素
    const imgElement = doc.createElement("img");
    imgElement.src = imgSrc;
    imgElement.alt = getString("itempane-image-title");
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
    zoomBtn.title = getString("itempane-zoom-image");
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
    downloadBtn.title = getString("itempane-download-image");
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
          const filename = `${getString("itempane-image-summary-filename-prefix")}_${targetItem
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
              text: getString("itempane-image-saved-desktop", {
                args: { filename },
              }),
              type: "success",
            })
            .show();
        } else {
          new ztoolkit.ProgressWindow("AI Butler", {
            closeOnClick: true,
            closeTime: 3000,
          })
            .createLine({
              text: getString("itempane-data-uri-only"),
              type: "error",
            })
            .show();
        }
      } catch (err: any) {
        ztoolkit.log("[AI-Butler] 下载图片失败:", err);
        new ztoolkit.ProgressWindow("AI Butler", {
          closeOnClick: true,
          closeTime: 3000,
        })
          .createLine({
            text: getString("itempane-download-failed", {
              args: { error: err.message },
            }),
            type: "error",
          })
          .show();
      }
    });
    imageBtnContainer.appendChild(downloadBtn);

    // 打开文件夹按钮
    const openFolderBtn = doc.createElement("button");
    openFolderBtn.textContent = "📂";
    openFolderBtn.title = getString("itempane-open-image-folder");
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
              .createLine({
                text: getString("itempane-folder-opened"),
                type: "success",
              })
              .show();
          } else {
            new ztoolkit.ProgressWindow("AI Butler", {
              closeOnClick: true,
              closeTime: 3000,
            })
              .createLine({
                text: getString("itempane-image-file-missing"),
                type: "error",
              })
              .show();
          }
        } else {
          new ztoolkit.ProgressWindow("AI Butler", {
            closeOnClick: true,
            closeTime: 3000,
          })
            .createLine({
              text: getString("itempane-image-attachment-missing"),
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
          .createLine({
            text: getString("itempane-open-failed", {
              args: { error: err.message },
            }),
            type: "error",
          })
          .show();
      }
    });
    imageBtnContainer.appendChild(openFolderBtn);

    imageContainer.innerHTML = "";
    imageContainer.appendChild(imgElement);
  } catch (err: any) {
    ztoolkit.log("[AI-Butler] 加载一图总结失败:", err);
    imageContainer.innerHTML = `<div style="color: #d32f2f; font-size: 12px;">${getString("itempane-load-failed", { args: { error: err.message } })}</div>`;
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
    throw new Error(getString("itempane-error-open-dialog-unavailable"));
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

  const title = itemTitle
    ? getString("itempane-image-summary-title-with-item", {
        args: { title: itemTitle },
      })
    : getString("itempane-image-summary-title");
  const viewerURL = `chrome://${config.addonRef}/content/imageSummaryViewer.html`;

  const dialogWin: any = mainWin.openDialog(
    viewerURL,
    "",
    `chrome,centerscreen,resizable=yes,width=${width},height=${height}`,
    { imageDataUri, title },
  );

  if (!dialogWin) {
    throw new Error(getString("itempane-error-viewer-window-failed"));
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
    throw new Error(getString("itempane-error-open-dialog-unavailable"));
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

  const title = itemTitle
    ? getString("itempane-mindmap-title-with-item", {
        args: { title: itemTitle },
      })
    : getString("itempane-mindmap-title");
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
    throw new Error(getString("itempane-error-viewer-window-failed"));
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
  fullImg.alt = getString("image-note-poster-alt");
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
  noteKind: AiNoteKind = "summary",
): Promise<string | null> {
  try {
    const resolvedNote = await resolveSidebarSummaryNote(item, noteKind);
    if (!resolvedNote) {
      return null;
    }

    const doc = Zotero.getMainWindow().document;
    const summaryBlocks = LLMNoteMetadataService.parseSummaryBlocks(
      resolvedNote.rawHtml,
    );
    const selectedBlockIndex =
      summaryBlocks.length > 0
        ? getSelectedMetadataBlockIndex(doc, summaryBlocks.length, noteKind)
        : -1;
    const selectedBlock =
      selectedBlockIndex >= 0 ? summaryBlocks[selectedBlockIndex] : null;
    const noteHtml: string = LLMNoteMetadataService.stripSidebarMetadata(
      selectedBlock ? selectedBlock.content : resolvedNote.rawHtml,
    );
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
      throw new Error(getString("itempane-error-document-body-unavailable"));
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
