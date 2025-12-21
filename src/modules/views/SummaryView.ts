/**
 * ================================================================
 * AI 总结视图
 * ================================================================
 *
 * 本模块提供流式 AI 输出的展示界面
 *
 * 主要职责:
 * 1. 显示 AI 生成的实时输出内容
 * 2. 支持 Markdown 渲染和数学公式显示
 * 3. 管理多条目的分段显示
 * 4. 提供停止按钮控制生成过程
 * 5. 自动滚动和主题切换
 *
 * 技术特点:
 * - 流式输出:实时追加 AI 返回的增量文本
 * - Markdown 支持:使用 marked 库渲染格式
 * - 数学公式:集成 MathJax 渲染 LaTeX 公式
 * - 自动滚动:智能判断用户滚动行为
 * - 主题适配:支持 Zotero 深色/浅色主题
 *
 * @module SummaryView
 * @author AI-Butler Team
 */

import { BaseView } from "./BaseView";
import { MainWindow } from "./MainWindow";
import { marked } from "marked";
import { getPref } from "../../utils/prefs";
import { createStyledButton } from "./ui/components";

/**
 * AI 总结视图类
 *
 * 专门用于显示流式 AI 输出的视图组件
 * 继承自 BaseView,实现特定的渲染和交互逻辑
 */
export class SummaryView extends BaseView {
  /** 输出内容容器 */
  private outputContainer: HTMLElement | null = null;

  /** 当前条目的容器 */
  private currentItemContainer: HTMLElement | null = null;

  /** 当前条目的内容缓冲区 */
  private currentItemBuffer: string = "";

  /** 返回任务队列按钮回调函数 (支持 Promise, 以便外部执行异步逻辑) */
  private onQueueButtonCallback: (() => void | Promise<void>) | null = null;

  /** 返回任务队列按钮元素 */
  private queueButton: HTMLButtonElement | null = null;

  /** MathJax 是否就绪 */
  private mathJaxReady: boolean = false;

  /** 公式渲染节流定时器 */
  private renderMathTimer: ReturnType<typeof setTimeout> | null = null;

  /** 用户是否手动滚动过 */
  private userHasScrolled: boolean = false;

  /** 是否启用自动滚动 */
  private autoScrollEnabled: boolean = true;

  /** 上次滚动位置 */
  private lastScrollTop: number = 0;

  /** 滚动容器元素 */
  private scrollContainer: HTMLElement | null = null;

  /** 实际的滚动区域元素 */
  private scrollArea: HTMLElement | null = null;

  /** 加载状态容器 */
  private loadingContainer: HTMLElement | null = null;

  /** 加载计时器 */
  private loadingTimer: ReturnType<typeof setInterval> | null = null;

  /** 加载开始时间 */
  private loadingStartTime: number = 0;

  /** 当前论文的item ID (用于追问功能) */
  private currentItemId: number | null = null;

  /** 当前论文的PDF内容 (Base64或文本) */
  private currentPdfContent: string = "";

  /** 当前PDF是否为Base64编码 */
  private currentIsBase64: boolean = false;

  /** 对话历史 */
  private conversationHistory: Array<{ role: string; content: string }> = [];

  /** 追问容器 */
  private chatContainer: HTMLElement | null = null;

  /** 追问输入框 */
  private chatInput: HTMLTextAreaElement | null = null;

  /** 追问发送按钮 */
  private chatSendButton: HTMLButtonElement | null = null;

  /** 是否正在处理追问 */
  private isChatting: boolean = false;

  /** 已保存的追问对（仅限后续追问，不含首轮“提示词+总结”） */
  private chatPairs: Array<{ id: string; user: string; assistant: string }> =
    [];

  /** 递增的对话对 ID 计数器 */
  private pairIdCounter: number = 0;

  /**
   * 构造函数
   */
  constructor() {
    super("summary-view");
  }

  /**
   * 渲染视图内容
   *
   * @protected
   * @returns 视图的根元素
   */
  protected renderContent(): HTMLElement {
    const container = this.createElement("div", {
      id: "ai-butler-summary-view",
      styles: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%", // 明确宽度
        overflow: "hidden", // 防止容器本身滚动
        fontFamily: "system-ui, -apple-system, sans-serif",
      },
    });

    // 标题区域
    const header = this.createElement("div", {
      styles: {
        padding: "20px 20px 0 20px",
        flexShrink: "0",
      },
      children: [
        this.createElement("h2", {
          styles: {
            margin: "0 0 20px 0",
            fontSize: "20px",
            borderBottom: "2px solid var(--ai-accent)",
            paddingBottom: "10px",
            color: "var(--ai-text)",
          },
          innerHTML: "AI 总结输出",
        }),
      ],
    });

    // 可滚动内容区域
    this.scrollContainer = this.createElement("div", {
      styles: {
        flex: "1 1 0", // 关键:基准值为0,强制从 flex 分配获取高度
        minHeight: "0", // 允许 flex 项目缩小
        overflow: "hidden", // 外层不滚动
      },
    });

    // 创建实际的滚动区域 - 使用 100% 高度而不是 flex
    const scrollArea = this.createElement("div", {
      styles: {
        height: "100%", // 关键:明确设置100%高度
        width: "100%",
        overflowY: "auto", // 启用纵向滚动
        overflowX: "hidden", // 禁止横向滚动
        boxSizing: "border-box",
      },
    });

    // 创建带 padding 的内容包装器
    const contentWrapper = this.createElement("div", {
      styles: {
        padding: "0 20px 20px 20px",
        boxSizing: "border-box",
      },
    });

    // 创建输出容器
    this.outputContainer = this.createElement("div", {
      id: "ai-butler-output-content",
      styles: {
        fontSize: "14px",
        lineHeight: "1.6",
        wordWrap: "break-word", // 确保长文本换行
        overflowWrap: "break-word", // 兼容性换行
        userSelect: "text", // 确保文本可以被选择
        cursor: "text", // 鼠标样式提示可选择
      },
    });

    // 允许容器可获取焦点，提升 Ctrl+C 复制的可靠性
    try {
      (this.outputContainer as any).setAttribute("tabindex", "0");
      this.outputContainer.addEventListener("mousedown", () => {
        // 鼠标在输出区域操作时，移除输入框的焦点，避免快捷键落到 textarea 上
        try {
          this.chatInput?.blur();
        } catch (e) {
          // 忽略失焦失败
          void 0;
        }
      });
      this.outputContainer.addEventListener("mouseup", () => {
        try {
          (this.outputContainer as any).focus();
        } catch (e) {
          // 忽略聚焦失败
          void 0;
        }
      });
      // 全局复制快捷键兜底：若外层把焦点留在输入框，也尝试复制被选中文本
      const copyHandler = (e: KeyboardEvent) => {
        if (
          (e.ctrlKey || (e as any).metaKey) &&
          (e.key === "c" || e.key === "C")
        ) {
          try {
            const win: any =
              Zotero && (Zotero as any).getMainWindow
                ? (Zotero as any).getMainWindow()
                : (globalThis as any);
            const sel = win?.getSelection ? win.getSelection() : null;
            const text = sel ? String(sel) : "";
            if (text && text.trim()) {
              // 优先使用主窗口的剪贴板能力
              if (win?.navigator?.clipboard?.writeText) {
                win.navigator.clipboard.writeText(text).catch((err: any) => {
                  // 忽略剪贴板写入失败
                  void 0;
                });
              } else if (win?.document?.execCommand) {
                try {
                  win.document.execCommand("copy");
                } catch (e) {
                  // 忽略旧式复制失败
                  void 0;
                }
              }
            }
          } catch (e) {
            // 忽略复制兜底逻辑异常
            void 0;
          }
        }
      };
      // 采用捕获阶段，尽量在 textarea 之前处理
      const winAny: any =
        Zotero && (Zotero as any).getMainWindow
          ? (Zotero as any).getMainWindow()
          : (globalThis as any);
      try {
        winAny.addEventListener("keydown", copyHandler, true);
      } catch (e) {
        // 忽略事件绑定失败
        void 0;
      }
    } catch (e) {
      // 忽略初始化复制相关事件失败
      void 0;
    }

    // 创建初始提示
    this.showInitialHint();

    contentWrapper.appendChild(this.outputContainer);
    scrollArea.appendChild(contentWrapper);
    this.scrollContainer.appendChild(scrollArea);

    // 保存 scrollArea 的引用,用于滚动控制
    this.scrollArea = scrollArea;

    // 底部按钮区域：统一使用 createStyledButton，适配明暗主题
    const queueButton = createStyledButton(
      "📋 返回任务队列",
      "#59c0bc",
      "medium",
    );
    queueButton.id = "ai-butler-queue-button";
    Object.assign(queueButton.style, {
      fontSize: "16px",
      minWidth: "180px",
    });
    this.queueButton = queueButton as HTMLButtonElement;
    this.updateQueueButton("ready");

    const footer = this.createElement("div", {
      styles: {
        padding: "15px 20px 20px 20px",
        borderTop: "1px solid var(--ai-border)",
        textAlign: "center",
        flexShrink: "0",
      },
      children: [queueButton],
    });

    // 创建追问容器 (默认隐藏)
    this.chatContainer = this.createChatContainer();

    container.appendChild(header);
    container.appendChild(this.scrollContainer);
    container.appendChild(this.chatContainer);
    container.appendChild(footer);

    return container;
  }

  /**
   * 创建追问容器
   * @private
   */
  private createChatContainer(): HTMLElement {
    const container = this.createElement("div", {
      id: "ai-butler-chat-container",
      styles: {
        display: "none", // 默认隐藏
        flexDirection: "column",
        padding: "15px 20px",
        borderTop: "1px solid var(--ai-border)",
        backgroundColor: "var(--ai-surface-2)",
        flexShrink: "0",
      },
    });

    // 追问按钮 - 使用统一的按钮组件
    const chatButton = createStyledButton("💬 后续追问", "#667eea", "medium");
    chatButton.id = "ai-butler-chat-toggle-button";
    Object.assign(chatButton.style, {
      marginBottom: "12px",
    });

    chatButton.addEventListener("click", () => {
      const inputArea = container.querySelector(
        "#ai-butler-chat-input-area",
      ) as HTMLElement;
      if (inputArea) {
        if (inputArea.style.display === "none" || !inputArea.style.display) {
          inputArea.style.display = "flex";
          chatButton.innerHTML = "🔽 收起追问";
        } else {
          inputArea.style.display = "none";
          chatButton.innerHTML = "💬 后续追问";
        }
      }
    });

    // 输入区域
    const inputArea = this.createElement("div", {
      id: "ai-butler-chat-input-area",
      styles: {
        display: "none", // 默认收起
        flexDirection: "column",
        gap: "10px",
      },
    });

    // 输入框
    this.chatInput = this.createElement("textarea", {
      id: "ai-butler-chat-input",
      styles: {
        width: "100%",
        minHeight: "80px",
        maxHeight: "300px",
        padding: "10px",
        fontSize: "14px",
        border: "1px solid var(--ai-input-border)",
        borderRadius: "4px",
        boxSizing: "border-box",
        resize: "vertical",
        fontFamily: "system-ui, -apple-system, sans-serif",
        backgroundColor: "var(--ai-input-bg)",
        color: "var(--ai-input-text)",
      },
    }) as HTMLTextAreaElement;
    this.chatInput.placeholder = "在这里输入您的问题...";

    // 自动调整高度
    this.chatInput.addEventListener("input", () => {
      if (this.chatInput) {
        this.chatInput.style.height = "auto";
        this.chatInput.style.height =
          Math.min(this.chatInput.scrollHeight, 300) + "px";
      }
    });

    // 发送按钮 - 使用统一的按钮组件
    this.chatSendButton = createStyledButton("📤 发送", "#4caf50", "medium");
    this.chatSendButton.id = "ai-butler-chat-send";
    Object.assign(this.chatSendButton.style, {
      alignSelf: "flex-end",
    });

    this.chatSendButton.addEventListener("click", () => {
      this.handleChatSend();
    });

    // Enter发送, Shift+Enter换行
    this.chatInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.handleChatSend();
      }
    });

    inputArea.appendChild(this.chatInput);
    inputArea.appendChild(this.chatSendButton);

    container.appendChild(chatButton);
    container.appendChild(inputArea);

    return container;
  }

  /**
   * 处理追问发送
   * @private
   */
  private async handleChatSend(): Promise<void> {
    if (!this.chatInput || !this.chatSendButton) return;
    if (this.isChatting) return;

    const userMessage = this.chatInput.value.trim();
    if (!userMessage) {
      new ztoolkit.ProgressWindow("追问", { closeTime: 2000 })
        .createLine({ text: "请输入问题内容", type: "default" })
        .show();
      return;
    }

    // 检查是否有PDF内容
    if (!this.currentPdfContent) {
      new ztoolkit.ProgressWindow("追问", { closeTime: 3000 })
        .createLine({ text: "没有可用的论文上下文,请先生成总结", type: "fail" })
        .show();
      return;
    }

    this.isChatting = true;
    this.chatSendButton.disabled = true;
    this.chatSendButton.innerHTML = "⏳ 发送中...";
    this.chatSendButton.style.backgroundColor = "#9e9e9e";
    this.chatInput.disabled = true;

    // 添加用户消息到历史
    this.conversationHistory.push({
      role: "user",
      content: userMessage,
    });

    // 显示用户消息（先单独渲染，后续会与助手回复一起包装成卡片）
    const userMessageElement = this.appendChatMessage("user", userMessage);

    // 清空输入框
    this.chatInput.value = "";
    this.chatInput.style.height = "80px";

    // 创建助手消息容器
    const assistantMessageContainer = this.appendChatMessage("assistant", "");

    // 将“用户+助手”两条消息包装为一张卡片，便于整体删除与管理
    let pairContainer: HTMLElement | null = null;
    const pairId = this.generatePairId();
    if (
      this.outputContainer &&
      userMessageElement &&
      assistantMessageContainer
    ) {
      pairContainer = this.createElement("div", {
        className: "ai-butler-chat-pair",
        styles: {
          position: "relative",
          marginBottom: "18px",
          padding: "4px 8px 8px 8px",
          border: "1px solid var(--ai-border)",
          borderRadius: "10px",
          backgroundColor: "var(--ai-surface-2)",
        },
      });
      (pairContainer as any).setAttribute("data-pair-id", pairId);

      // 删除按钮
      const deleteBtn = this.createElement("button", {
        styles: {
          position: "absolute",
          top: "6px",
          right: "8px",
          border: "none",
          background: "transparent",
          color: "#d32f2f",
          cursor: "pointer",
          fontSize: "14px",
        },
        innerHTML: "🗑️",
      }) as HTMLButtonElement;
      deleteBtn.title = "删除该提问-响应对";
      deleteBtn.addEventListener("click", async () => {
        await this.deleteChatPair(pairId);
      });

      // 将刚刚渲染的两条消息移动到卡片中（折叠时仅折叠 AI 输出，用户请求子卡片常显）
      try {
        // 先将“用户请求”直接挂到卡片容器（常显）
        pairContainer.appendChild(userMessageElement);

        // 再创建仅包含“AI 输出”的可折叠区域
        const asstBody = this.createElement("div", {
          className: "ai-butler-card-body",
        });
        asstBody.appendChild(assistantMessageContainer);

        // 折叠按钮
        const collapseBtn = this.createElement("button", {
          styles: {
            position: "absolute",
            top: "6px",
            right: "36px",
            border: "none",
            background: "transparent",
            color: "var(--ai-text-muted)",
            cursor: "pointer",
            fontSize: "14px",
          },
          innerHTML: "▾",
        }) as HTMLButtonElement;
        collapseBtn.title = "折叠/展开";
        collapseBtn.addEventListener("click", () => {
          if ((asstBody as HTMLElement).style.display === "none") {
            (asstBody as HTMLElement).style.display = "block";
            collapseBtn.innerHTML = "▾";
          } else {
            (asstBody as HTMLElement).style.display = "none";
            collapseBtn.innerHTML = "▸";
          }
        });

        pairContainer.appendChild(collapseBtn);
        pairContainer.appendChild(deleteBtn);
        pairContainer.appendChild(asstBody);
        this.outputContainer.appendChild(pairContainer);
      } catch (e) {
        ztoolkit.log("[AI-Butler] 包装聊天卡片失败:", e);
      }
    }

    try {
      // 导入 LLMClient
      const { default: LLMClient } = await import("../llmClient");

      // 调用chat方法
      let fullResponse = "";
      await LLMClient.chat(
        this.currentPdfContent,
        this.currentIsBase64,
        this.conversationHistory,
        (chunk: string) => {
          fullResponse += chunk;
          // 更新助手消息显示
          if (assistantMessageContainer) {
            const contentDiv = assistantMessageContainer.querySelector(
              ".chat-message-content",
            ) as HTMLElement;
            if (contentDiv) {
              contentDiv.innerHTML =
                SummaryView.convertMarkdownToHTMLCore(fullResponse);
            }
          }
          // 自动滚动
          this.scrollToBottom();
        },
      );

      // 添加助手回复到历史
      this.conversationHistory.push({
        role: "assistant",
        content: fullResponse,
      });

      // 记录该追问对（不含首轮“提示词+总结”）
      this.chatPairs.push({
        id: pairId,
        user: userMessage,
        assistant: fullResponse,
      });

      // 如果开启了保存对话历史,保存到笔记
      if (getPref("saveChatHistory") && this.currentItemId) {
        await this.saveChatPairToSeparateNote(
          pairId,
          userMessage,
          fullResponse,
        );
      }
    } catch (error: any) {
      // 显示错误
      if (assistantMessageContainer) {
        const contentDiv = assistantMessageContainer.querySelector(
          ".chat-message-content",
        ) as HTMLElement;
        if (contentDiv) {
          contentDiv.innerHTML = `<p style="color: #d32f2f;">❌ 错误: ${error?.message || String(error)}</p>`;
        }
      }
    } finally {
      this.isChatting = false;
      if (this.chatSendButton) {
        this.chatSendButton.disabled = false;
        this.chatSendButton.innerHTML = "📤 发送";
        this.chatSendButton.style.backgroundColor = "var(--ai-accent)";
        this.chatSendButton.style.color = "#ffffff";
      }
      if (this.chatInput) {
        this.chatInput.disabled = false;
        this.chatInput.focus();
      }
    }
  }

  /**
   * 添加聊天消息到显示区域
   * @private
   */
  private appendChatMessage(role: string, content: string): HTMLElement | null {
    if (!this.outputContainer) return null;

    const messageDiv = this.createElement("div", {
      className: role === "user" ? "ai-msg-user" : "ai-msg-assistant",
      styles: {
        marginBottom: "16px",
        padding: "12px",
        borderRadius: "8px",
        borderLeft: `4px solid var(--ai-accent)`,
      },
    });

    const roleLabel = this.createElement("div", {
      styles: {
        fontWeight: "bold",
        marginBottom: "8px",
        color: "var(--ai-text)",
      },
      innerHTML: role === "user" ? "👤 您" : "🤖 AI管家",
    });

    const contentDiv = this.createElement("div", {
      className: "chat-message-content",
      styles: {
        fontSize: "14px",
        lineHeight: "1.6",
        userSelect: "text", // 确保文本可以被选择
        cursor: "text", // 鼠标样式提示可选择
      },
      innerHTML: content
        ? SummaryView.convertMarkdownToHTMLCore(content)
        : "<em>思考中...</em>",
    });

    messageDiv.appendChild(roleLabel);
    messageDiv.appendChild(contentDiv);
    this.outputContainer.appendChild(messageDiv);

    // 应用主题到新添加的元素
    this.applyTheme();

    this.scrollToBottom();

    return messageDiv;
  }

  /**
   * 保存对话到笔记
   * @private
   */
  private async saveChatToNote(
    userMessage: string,
    assistantMessage: string,
  ): Promise<void> {
    // 为兼容旧方法保留，但不再使用。后续追问改为保存到独立笔记。
    if (!this.currentItemId) return;
    try {
      await this.saveChatPairToSeparateNote(
        this.generatePairId(),
        userMessage,
        assistantMessage,
      );
    } catch (error) {
      ztoolkit.log("[AI-Butler] 兼容保存对话到独立笔记失败:", error);
    }
  }

  /**
   * 生成唯一的对话对 ID
   */
  private generatePairId(): string {
    this.pairIdCounter += 1;
    return `pair_${Date.now()}_${this.pairIdCounter}`;
  }

  /**
   * 获取或创建“AI管家-后续追问-论文名”独立笔记
   */
  private async getOrCreateChatNote(item: Zotero.Item): Promise<Zotero.Item> {
    const title = (item.getField("title") as string) || "文献";

    // 查找已有的聊天笔记：条件为包含我们约定的标题标识或带有专属标签
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
    const header = `<h2>AI 管家 - 后续追问 - ${this.escapeHtml(title)}</h2>`;
    note.setNote(header);
    note.addTag("AI-Butler-Chat");
    await note.saveTx();
    return note;
  }

  /**
   * 将对话对追加到独立笔记（带可解析标记，便于恢复）
   */
  private async saveChatPairToSeparateNote(
    pairId: string,
    userMessage: string,
    assistantMessage: string,
  ): Promise<void> {
    if (!this.currentItemId) return;
    try {
      const item = await Zotero.Items.getAsync(this.currentItemId);
      if (!item) return;
      const note = await this.getOrCreateChatNote(item);
      let noteHtml = (note as any).getNote?.() || "";

      const jsonMarker = `<!-- AI_BUTLER_CHAT_JSON: ${JSON.stringify({ id: pairId, user: userMessage, assistant: assistantMessage })} -->`;
      const block = `
<!-- AI_BUTLER_CHAT_PAIR_START id=${this.escapeHtml(pairId)} -->
${jsonMarker}
<div id="ai-butler-pair-${this.escapeHtml(pairId)}" style="margin-top:14px; padding-top:8px; border-top:1px dashed #ccc;">
  <div style="background-color:#e3f2fd; padding:10px; border-radius:6px; margin-bottom:8px;"><strong>👤 用户:</strong> ${this.escapeHtml(userMessage)}</div>
  <div style="background-color:#f5f5f5; padding:10px; border-radius:6px;"><strong>🤖 AI管家:</strong><br/>${SummaryView.convertMarkdownToHTMLCore(assistantMessage)}</div>
  <div style="font-size:11px; color:#999; margin-top:6px;">保存时间: ${new Date().toLocaleString("zh-CN")}</div>
</div>
<!-- AI_BUTLER_CHAT_PAIR_END id=${this.escapeHtml(pairId)} -->
`;

      noteHtml += block;
      (note as any).setNote(noteHtml);
      await (note as any).saveTx();
      ztoolkit.log("[AI-Butler] 追问对已保存到独立笔记");
    } catch (e) {
      ztoolkit.log("[AI-Butler] 保存追问对到独立笔记失败:", e);
    }
  }

  /**
   * 从独立笔记中删除指定 pairId 的对话对
   */
  private async removeChatPairFromSeparateNote(pairId: string): Promise<void> {
    if (!this.currentItemId) return;
    try {
      const item = await Zotero.Items.getAsync(this.currentItemId);
      if (!item) return;
      const note = await this.getOrCreateChatNote(item);
      let noteHtml = (note as any).getNote?.() || "";

      // 使用标记区间删除
      const startMarker = `<!-- AI_BUTLER_CHAT_PAIR_START id=${pairId} -->`;
      const endMarker = `<!-- AI_BUTLER_CHAT_PAIR_END id=${pairId} -->`;
      const startIdx = noteHtml.indexOf(startMarker);
      const endIdx = noteHtml.indexOf(endMarker);
      if (startIdx !== -1 && endIdx !== -1) {
        const removeUntil = endIdx + endMarker.length;
        noteHtml = noteHtml.slice(0, startIdx) + noteHtml.slice(removeUntil);
        (note as any).setNote(noteHtml);
        await (note as any).saveTx();
      }
    } catch (e) {
      ztoolkit.log("[AI-Butler] 从独立笔记删除追问对失败:", e);
    }
  }

  /**
   * 追加一张“AI 总结”卡片（可折叠，仅展示助手内容，不参与对话历史与持久化）
   */
  private appendSummaryCard(aiSummary: string): void {
    if (!this.outputContainer) return;

    const card = this.createElement("div", {
      className: "ai-butler-chat-pair",
      styles: {
        position: "relative",
        marginBottom: "18px",
        padding: "4px 8px 8px 8px",
        border: "1px solid var(--ai-border)",
        borderRadius: "10px",
        backgroundColor: "var(--ai-surface-2)",
      },
    });

    // 头部（标题 + 摘要预览）
    const header = this.createElement("div", {
      styles: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "6px 2px 4px 2px",
      },
    });
    const titleEl = this.createElement("div", {
      styles: {
        fontWeight: "600",
        color: "var(--ai-accent)",
      },
      textContent: "📘 AI管家笔记",
    });
    // 预览：取前100字符，去掉换行
    const previewText = (aiSummary || "").replace(/\s+/g, " ").slice(0, 100);
    const previewEl = this.createElement("div", {
      styles: {
        fontSize: "12px",
        color: "var(--ai-text-muted)",
        flex: "1",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      },
      textContent: previewText
        ? `摘要：${previewText}${aiSummary.length > 100 ? "…" : ""}`
        : "",
    }) as HTMLElement;
    header.appendChild(titleEl);
    header.appendChild(previewEl);

    // 内容主体（仅助手）
    const body = this.createElement("div", {
      className: "ai-butler-card-body",
    });
    const collapseBtn = this.createElement("button", {
      styles: {
        position: "absolute",
        top: "6px",
        right: "8px",
        border: "none",
        background: "transparent",
        color: "#555",
        cursor: "pointer",
        fontSize: "14px",
      },
      innerHTML: "▾",
    }) as HTMLButtonElement;
    collapseBtn.title = "折叠/展开";
    collapseBtn.addEventListener("click", () => {
      if ((body as HTMLElement).style.display === "none") {
        (body as HTMLElement).style.display = "block";
        collapseBtn.innerHTML = "▾";
        // 展开时隐藏摘要预览
        if (previewEl) previewEl.style.display = "none";
      } else {
        (body as HTMLElement).style.display = "none";
        collapseBtn.innerHTML = "▸";
        // 折叠时显示摘要预览
        if (previewEl) previewEl.style.display = "inline";
      }
    });

    // 内容（仅助手）
    const assistantDiv = this.appendChatMessage("assistant", "") as HTMLElement;
    const contentDiv = assistantDiv.querySelector(
      ".chat-message-content",
    ) as HTMLElement | null;
    if (contentDiv) {
      contentDiv.innerHTML = SummaryView.convertMarkdownToHTMLCore(aiSummary);
    }
    body.appendChild(assistantDiv);

    // 初始：展开状态，隐藏预览
    (body as HTMLElement).style.display = "block";
    if (previewEl) previewEl.style.display = "none";

    card.appendChild(header);
    card.appendChild(collapseBtn);
    card.appendChild(body);
    this.outputContainer.appendChild(card);

    // 应用主题到新添加的总结卡片
    this.applyTheme();
  }

  /**
   * 删除一张提问-响应卡片（UI + 内存 + 笔记）
   */
  private async deleteChatPair(pairId: string): Promise<void> {
    // 1) UI 移除
    try {
      const pairNode = this.outputContainer?.querySelector(
        `.ai-butler-chat-pair[data-pair-id="${pairId}"]`,
      ) as HTMLElement | null;
      if (pairNode && this.outputContainer) {
        this.outputContainer.removeChild(pairNode);
      }
    } catch (e) {
      ztoolkit.log("[AI-Butler] 移除聊天卡片 UI 失败:", e);
    }

    // 2) 内存数据移除
    this.chatPairs = this.chatPairs.filter((p) => p.id !== pairId);

    // 3) 重建 conversationHistory：保留首轮（若存在），然后拼接剩余对
    const base: Array<{ role: string; content: string }> = [];
    if (this.conversationHistory.length >= 2) {
      base.push(this.conversationHistory[0], this.conversationHistory[1]);
    }
    for (const p of this.chatPairs) {
      base.push({ role: "user", content: p.user });
      base.push({ role: "assistant", content: p.assistant });
    }
    this.conversationHistory = base;

    // 4) 从独立笔记移除
    await this.removeChatPairFromSeparateNote(pairId);
  }

  /**
   * HTML转义
   * @private
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * 设置当前论文上下文 (用于追问)
   * @param itemId 文献条目ID
   * @param pdfContent PDF内容(Base64或文本)
   * @param isBase64 是否为Base64编码
   * @param aiSummary 已生成的AI总结内容(可选)
   */
  public setCurrentPaperContext(
    itemId: number,
    pdfContent: string,
    isBase64: boolean,
    aiSummary?: string,
  ): void {
    this.currentItemId = itemId;
    this.currentPdfContent = pdfContent;
    this.currentIsBase64 = isBase64;

    // 初始化对话历史:第一轮是用户提示词和AI回复
    this.conversationHistory = [];

    // 如果提供了AI总结内容,将其作为第一轮对话
    if (aiSummary && aiSummary.trim()) {
      // 获取用户的提示词
      const summaryPrompt =
        (getPref("summaryPrompt") as string) || "请分析这篇论文";

      this.conversationHistory.push({
        role: "user",
        content: summaryPrompt,
      });

      this.conversationHistory.push({
        role: "assistant",
        content: aiSummary,
      });
    }

    // 显示追问容器
    if (this.chatContainer) {
      this.chatContainer.style.display = "flex";
    }
  }

  /**
   * 清除论文上下文
   */
  public clearPaperContext(): void {
    this.currentItemId = null;
    this.currentPdfContent = "";
    this.currentIsBase64 = false;
    this.conversationHistory = [];

    // 隐藏追问容器
    if (this.chatContainer) {
      this.chatContainer.style.display = "none";
    }
  }

  /**
   * 从外部加载指定文献的追问界面
   *
   * 用于 Reader 工具栏按钮和条目面板的快捷入口
   * 会自动提取 PDF 内容并设置论文上下文
   *
   * @param itemId 文献条目 ID
   */
  public async loadItemForChat(itemId: number): Promise<void> {
    try {
      // 清空并显示加载提示
      this.clear();
      this.showLoadingState("正在加载文献...");

      const item = await Zotero.Items.getAsync(itemId);
      if (!item) {
        this.hideLoading();
        new ztoolkit.ProgressWindow("AI Butler", {
          closeOnClick: true,
          closeTime: 3000,
        })
          .createLine({
            text: "无法加载该文献",
            type: "error",
          })
          .show();
        return;
      }

      const title = (item.getField("title") as string) || "文献";

      // 显示标题
      this.startItem(title);
      this.finishItem();

      // 查找已有的 AI 总结笔记
      const noteIDs = (item as any).getNotes?.() || [];
      let aiSummaryText = "";
      let targetNote: any = null;

      for (const nid of noteIDs) {
        try {
          const n = await Zotero.Items.getAsync(nid);
          if (!n) continue;
          const tags: Array<{ tag: string }> = (n as any).getTags?.() || [];
          const noteHtml: string = (n as any).getNote?.() || "";
          const isChatNote =
            tags.some((t) => t.tag === "AI-Butler-Chat") ||
            /<h2>\s*AI 管家\s*-\s*后续追问\s*-/.test(noteHtml);
          const isAiSummaryNote =
            tags.some((t) => t.tag === "AI-Generated") ||
            (/<h2>\s*AI 管家\s*-/.test(noteHtml) && !isChatNote);

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

      // 提取 AI 总结内容
      if (targetNote) {
        const html = (targetNote as any).getNote?.() || "";
        aiSummaryText = html
          .replace(/<style[^>]*>.*?<\/style>/gis, "")
          .replace(/<script[^>]*>.*?<\/script>/gis, "")
          .replace(/<[^>]+>/g, "")
          .replace(/&nbsp;/g, " ")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&")
          .trim();
      }

      // 获取 PDF 内容以支持追问
      try {
        const { PDFExtractor } = await import("../pdfExtractor");
        const prefMode =
          ((getPref as any)("pdfProcessMode") as string) || "base64";
        const isBase64 = prefMode === "base64";

        let pdfContent = "";
        if (isBase64) {
          pdfContent = await PDFExtractor.extractBase64FromItem(item);
        } else {
          pdfContent = await PDFExtractor.extractTextFromItem(item);
        }

        this.hideLoading();

        if (pdfContent) {
          // 设置论文上下文
          this.setCurrentPaperContext(
            itemId,
            pdfContent,
            isBase64,
            aiSummaryText,
          );

          // 如果有 AI 总结，显示总结卡片
          if (aiSummaryText) {
            try {
              this.appendSummaryCard(aiSummaryText);
            } catch (e) {
              ztoolkit.log("[AI-Butler] 渲染 AI 总结卡片失败:", e);
            }
          } else {
            // 没有已有总结，显示欢迎提示
            if (this.outputContainer) {
              const welcomeHint = Zotero.getMainWindow().document.createElement(
                "div",
              );
              welcomeHint.style.cssText = `
                padding: 20px;
                margin: 10px 0;
                background: linear-gradient(135deg, rgba(89, 192, 188, 0.1), rgba(89, 192, 188, 0.05));
                border-radius: 8px;
                border-left: 4px solid #59c0bc;
                color: var(--ai-text);
              `;
              welcomeHint.innerHTML = `
                <div style="font-size: 15px; font-weight: 600; margin-bottom: 8px; color: #59c0bc;">
                  🤖 准备好开始追问了！
                </div>
                <div style="font-size: 13px; color: var(--ai-text-muted); line-height: 1.6;">
                  该文献尚未生成 AI 总结。您可以直接在下方输入问题与 AI 对话，
                  或者先右键该文献选择"召唤 AI 管家进行分析"生成完整总结。
                </div>
              `;
              this.outputContainer.appendChild(welcomeHint);
            }
          }

          // 加载已有的追问历史
          try {
            await this.loadExistingChatPairs(item);
          } catch (e) {
            ztoolkit.log("[AI-Butler] 加载历史追问失败:", e);
          }

          // 自动展开追问输入区域
          const inputArea = this.chatContainer?.querySelector(
            "#ai-butler-chat-input-area",
          ) as HTMLElement;
          const toggleBtn = this.chatContainer?.querySelector(
            "#ai-butler-chat-toggle-button",
          ) as HTMLElement;
          if (inputArea && toggleBtn) {
            inputArea.style.display = "flex";
            toggleBtn.innerHTML = "🔽 收起追问";
          }

          // 聚焦输入框
          if (this.chatInput) {
            setTimeout(() => {
              this.chatInput?.focus();
            }, 100);
          }
        } else {
          this.hideLoading();
          // 没有 PDF 内容
          new ztoolkit.ProgressWindow("AI Butler", {
            closeOnClick: true,
            closeTime: 3000,
          })
            .createLine({
              text: "该文献没有可用的 PDF 附件",
              type: "error",
            })
            .show();
          this.clearPaperContext();
        }
      } catch (err) {
        this.hideLoading();
        ztoolkit.log("[AI-Butler] 获取 PDF 内容失败:", err);
        new ztoolkit.ProgressWindow("AI Butler", {
          closeOnClick: true,
          closeTime: 3000,
        })
          .createLine({
            text: "获取 PDF 内容失败",
            type: "error",
          })
          .show();
        this.clearPaperContext();
      }
    } catch (err) {
      this.hideLoading();
      ztoolkit.log("[AI-Butler] loadItemForChat 失败:", err);
      this.clearPaperContext();
    }
  }

  /**
   * 显示已保存的笔记内容(来自 Zotero 笔记,HTML 直接渲染)
   *
   * @param itemId 文献条目ID
   */
  public async showSavedNoteForItem(itemId: number): Promise<void> {
    try {
      // 清空并显示加载提示
      this.clear();
      this.showLoadingState("正在加载已保存的总结...");

      const item = await Zotero.Items.getAsync(itemId);
      if (!item) {
        this.hideLoading();
        return;
      }

      const title = (item.getField("title") as string) || "文献";

      // 获取子笔记ID列表
      const noteIDs = (item as any).getNotes?.() || [];
      let targetNote: any = null;

      // 遍历寻找带有 AI-Generated 标签或标题包含“AI 管家”的最新笔记
      // 注意：应排除“后续追问”聊天笔记，避免把聊天内容直接渲染到总结区
      for (const nid of noteIDs) {
        try {
          const n = await Zotero.Items.getAsync(nid);
          if (!n) continue;
          const tags: Array<{ tag: string }> = (n as any).getTags?.() || [];
          const noteHtml: string = (n as any).getNote?.() || "";
          const isChatNote =
            tags.some((t) => t.tag === "AI-Butler-Chat") ||
            /<h2>\s*AI 管家\s*-\s*后续追问\s*-/.test(noteHtml);
          const isAiSummaryNote =
            tags.some((t) => t.tag === "AI-Generated") ||
            (/<h2>\s*AI 管家\s*-/.test(noteHtml) && !isChatNote);

          if (isAiSummaryNote) {
            if (!targetNote) {
              targetNote = n;
            } else {
              // 选择修改时间更新的那个
              const a = (targetNote as any).dateModified || 0;
              const b = (n as any).dateModified || 0;
              if (b > a) targetNote = n;
            }
          }
        } catch (e) {
          // 忽略异常的子笔记，继续查找
          continue;
        }
      }

      this.hideLoading();

      if (!targetNote) {
        // 没有找到匹配的 AI 笔记
        this.startItem(title);
        this.appendContent("未找到已保存的 AI 总结笔记。");
        this.finishItem();
        return;
      }

      // 读取 HTML 内容，提取纯文本作为“AI 总结”卡片展示（不直接把整段 HTML 塞进总结区）
      const html = (targetNote as any).getNote?.() || "";
      this.startItem(title);
      // 不直接渲染 html 到 item-content，改为在下方追加可折叠的“AI 总结”卡片
      this.finishItem();

      // 提取AI总结的纯文本内容(去除HTML标签)
      const aiSummaryText = html
        .replace(/<style[^>]*>.*?<\/style>/gis, "")
        .replace(/<script[^>]*>.*?<\/script>/gis, "")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .trim();

      // 获取PDF内容以支持后续追问
      try {
        const { PDFExtractor } = await import("../pdfExtractor");
        // 尊重用户的 PDF 处理模式选择（不再根据 Provider 强制联动）
        const prefMode =
          ((getPref as any)("pdfProcessMode") as string) || "base64";
        const isBase64 = prefMode === "base64";

        let pdfContent = "";
        if (isBase64) {
          pdfContent = await PDFExtractor.extractBase64FromItem(item);
        } else {
          pdfContent = await PDFExtractor.extractTextFromItem(item);
        }

        if (pdfContent) {
          // 设置论文上下文，传入AI总结内容
          this.setCurrentPaperContext(
            itemId,
            pdfContent,
            isBase64,
            aiSummaryText,
          );

          // 在对话区域追加一张“AI 总结”卡片，默认可折叠
          try {
            this.appendSummaryCard(aiSummaryText);
          } catch (e) {
            ztoolkit.log("[AI-Butler] 渲染AI总结卡片失败:", e);
          }

          // 载入并渲染已有的“后续追问”历史（如有），恢复为原生对话格式
          try {
            const itemObj = await Zotero.Items.getAsync(itemId);
            if (itemObj) {
              await this.loadExistingChatPairs(itemObj);
            }
          } catch (e) {
            ztoolkit.log("[AI-Butler] 加载历史追问失败:", e);
          }
        } else {
          // 没有PDF内容，不显示追问按钮
          this.clearPaperContext();
        }
      } catch (err) {
        ztoolkit.log("[AI-Butler] 获取PDF内容失败，无法启用追问功能:", err);
        this.clearPaperContext();
      }
    } catch (err) {
      this.hideLoading();
      this.startItem("加载失败");
      this.appendContent("无法加载该条目的已保存总结。");
      this.finishItem();
      this.clearPaperContext();
    }
  }

  /**
   * 从独立笔记读取已保存的追问对，并恢复为卡片与会话历史
   */
  private async loadExistingChatPairs(item: Zotero.Item): Promise<void> {
    try {
      const note = await this.getOrCreateChatNote(item);
      const html: string = (note as any).getNote?.() || "";
      // 提取 JSON 标记
      const regex = /<!--\s*AI_BUTLER_CHAT_JSON:\s*(\{[\s\S]*?\})\s*-->/g;
      let m: RegExpExecArray | null;
      const pairs: Array<{ id: string; user: string; assistant: string }> = [];
      while ((m = regex.exec(html)) !== null) {
        try {
          const obj = JSON.parse(m[1]);
          if (
            obj &&
            obj.id &&
            obj.user !== undefined &&
            obj.assistant !== undefined
          ) {
            pairs.push({
              id: String(obj.id),
              user: String(obj.user),
              assistant: String(obj.assistant),
            });
          }
        } catch (e) {
          // 跳过解析失败的块
          continue;
        }
      }

      if (pairs.length === 0) return;

      // 渲染到 UI，并重建 chatPairs 与 conversationHistory（保留首轮）
      const base: Array<{ role: string; content: string }> = [];
      if (this.conversationHistory.length >= 2) {
        base.push(this.conversationHistory[0], this.conversationHistory[1]);
      }

      for (const p of pairs) {
        // 渲染为卡片
        const userEl = this.appendChatMessage("user", p.user);
        const asstEl = this.appendChatMessage("assistant", p.assistant);
        if (this.outputContainer && userEl && asstEl) {
          const pairDiv = this.createElement("div", {
            className: "ai-butler-chat-pair",
            styles: {
              position: "relative",
              marginBottom: "18px",
              padding: "4px 8px 8px 8px",
              border: "1px solid var(--ai-border)",
              borderRadius: "10px",
              backgroundColor: "var(--ai-surface-2)",
            },
          });
          (pairDiv as any).setAttribute("data-pair-id", p.id);

          const deleteBtn = this.createElement("button", {
            styles: {
              position: "absolute",
              top: "6px",
              right: "8px",
              border: "none",
              background: "transparent",
              color: "#d32f2f",
              cursor: "pointer",
              fontSize: "14px",
            },
            innerHTML: "🗑️",
          }) as HTMLButtonElement;
          deleteBtn.title = "删除该提问-响应对";
          deleteBtn.addEventListener("click", async () => {
            await this.deleteChatPair(p.id);
          });

          // 结构：用户请求常显；AI 输出可折叠
          pairDiv.appendChild(userEl);
          const asstBody = this.createElement("div", {
            className: "ai-butler-card-body",
          });
          asstBody.appendChild(asstEl);
          const collapseBtn = this.createElement("button", {
            styles: {
              position: "absolute",
              top: "6px",
              right: "36px",
              border: "none",
              background: "transparent",
              color: "#555",
              cursor: "pointer",
              fontSize: "14px",
            },
            innerHTML: "▾",
          }) as HTMLButtonElement;
          collapseBtn.title = "折叠/展开";
          collapseBtn.addEventListener("click", () => {
            if ((asstBody as HTMLElement).style.display === "none") {
              (asstBody as HTMLElement).style.display = "block";
              collapseBtn.innerHTML = "▾";
            } else {
              (asstBody as HTMLElement).style.display = "none";
              collapseBtn.innerHTML = "▸";
            }
          });

          try {
            pairDiv.appendChild(collapseBtn);
            pairDiv.appendChild(deleteBtn);
            pairDiv.appendChild(asstBody);
            this.outputContainer.appendChild(pairDiv);
          } catch (e) {
            ztoolkit.log("[AI-Butler] 渲染历史聊天卡片失败:", e);
          }
        }

        this.chatPairs.push({ id: p.id, user: p.user, assistant: p.assistant });
        base.push({ role: "user", content: p.user });
        base.push({ role: "assistant", content: p.assistant });
      }

      this.conversationHistory = base;

      // 应用主题到新加载的历史聊天卡片
      this.applyTheme();
    } catch (e) {
      ztoolkit.log("[AI-Butler] 读取并恢复历史追问失败:", e);
    }
  }

  /**
   * 视图挂载后的初始化
   *
   * @protected
   */
  protected onMount(): void {
    // 绑定停止按钮事件
    if (this.queueButton) {
      this.queueButton.addEventListener("click", (e: Event) => {
        e.preventDefault();
        e.stopPropagation();

        const button = this.queueButton;
        if (button) {
          button.disabled = true;
          button.innerHTML = "⏳ 正在打开任务队列...";
          button.style.backgroundColor = "#9e9e9e";
          button.style.cursor = "not-allowed";
          button.style.opacity = "0.8";
        }

        // 尝试执行外部注册的回调(可能是同步或异步)
        let p: void | Promise<void> | undefined;
        try {
          if (this.onQueueButtonCallback) {
            p = this.onQueueButtonCallback();
          }
        } catch (err) {
          ztoolkit.log("[AI Butler] 返回任务队列回调执行异常:", err);
        }

        // 兜底强制导航：避免在流式大输出/渲染阻塞下标签未切换
        const ensureNavigate = () => {
          try {
            const mw = MainWindow.getInstance();
            // 若当前活动标签仍是 summary 或任务视图未显示，则强制切换
            const taskContainer = mw.getTaskQueueView().getContainer();
            const taskVisible =
              !!taskContainer && taskContainer.style.display !== "none";
            if (!taskVisible) {
              mw.switchTab("tasks", true);
            }
          } catch (e) {
            ztoolkit.log("[AI Butler] 兜底导航失败:", e);
          }
        };

        // 主动安排两个时间点的兜底，兼顾同步与异步/渲染阻塞场景
        setTimeout(ensureNavigate, 60); // 短延时：等待可能的同步 DOM 操作完成
        setTimeout(ensureNavigate, 600); // 次级延时：处理潜在的长时间流式/重绘阻塞

        // 若回调是 Promise，完成后再尝试更新按钮状态
        if (p && typeof (p as any).then === "function") {
          (p as Promise<void>)
            .then(() => {
              this.updateQueueButton("ready");
            })
            .catch((err) => {
              ztoolkit.log("[AI Butler] 返回任务队列异步回调失败:", err);
              this.updateQueueButton("error");
            });
        } else {
          // 同步情况：立即交还按钮可用状态(回调内部也可能已调用 updateQueueButton 改写)
          setTimeout(() => {
            // 若外部没有特别状态更新，则恢复 ready
            if (this.queueButton && this.queueButton.disabled) {
              this.updateQueueButton("ready");
            }
          }, 120);
        }
      });
    }

    // 绑定滚动监听
    if (this.scrollArea) {
      this.scrollArea.addEventListener("scroll", () => {
        this.handleScroll();
      });
    }

    // 初始化 MathJax
    this.initMathJax();

    // 应用主题
    this.applyTheme();

    // 应用用户首选项: 字号与自动滚动
    try {
      const fontSize =
        parseInt(((getPref as any)("fontSize") as string) || "14", 10) || 14;
      if (this.container) {
        (this.container as HTMLElement).style.fontSize = `${fontSize}px`;
      }
      const auto = (getPref as any)("autoScroll") as boolean;
      this.autoScrollEnabled =
        auto === undefined || auto === null ? true : !!auto;
    } catch (e) {
      ztoolkit.log("[AI Butler] 应用字体或滚动首选项失败:", e);
    }
  }

  /**
   * 初始化 MathJax
   *
   * @private
   */
  private initMathJax(): void {
    // MathJax 初始化逻辑
    // 注意:在 Zotero 环境中需要特殊处理
    this.mathJaxReady = false;

    // TODO: 实现 MathJax 加载逻辑
    // 当前简化处理
    setTimeout(() => {
      this.mathJaxReady = true;
    }, 1000);
  }

  /**
   * 处理滚动事件
   *
   * @private
   */
  private handleScroll(): void {
    if (!this.scrollArea) return;

    const currentScrollTop = this.scrollArea.scrollTop;
    const scrollHeight = this.scrollArea.scrollHeight;
    const clientHeight = this.scrollArea.clientHeight;

    // 检测用户是否手动向上滚动
    if (currentScrollTop < this.lastScrollTop) {
      this.userHasScrolled = true;
    }

    // 如果用户滚到最底部,重置标记
    if (scrollHeight - currentScrollTop - clientHeight < 50) {
      this.userHasScrolled = false;
    }

    this.lastScrollTop = currentScrollTop;
  }

  /**
   * 自动滚动到底部
   *
   * @private
   */
  private scrollToBottom(): void {
    if (!this.scrollArea || this.userHasScrolled || !this.autoScrollEnabled)
      return;

    const area = this.scrollArea;

    // 使用 setTimeout 确保在 DOM 更新后滚动
    setTimeout(() => {
      if (area) {
        area.scrollTop = area.scrollHeight;
      }
    }, 0);
  }

  /**
   * 显示初始提示信息
   *
   * @private
   */
  private showInitialHint(): void {
    if (!this.outputContainer) return;

    const hintContainer = this.createElement("div", {
      className: "initial-hint",
      styles: {
        padding: "40px 20px",
        textAlign: "center",
        color: "#999",
      },
      children: [
        this.createElement("div", {
          styles: {
            fontSize: "48px",
            marginBottom: "20px",
          },
          textContent: "📝",
        }),
        this.createElement("h3", {
          styles: {
            fontSize: "18px",
            color: "#666",
            marginBottom: "10px",
          },
          textContent: "等待 AI 总结",
        }),
        this.createElement("p", {
          styles: {
            fontSize: "14px",
            lineHeight: "1.6",
          },
          textContent: "右键点击文献条目,选择「AI 管家分析」开始生成总结",
        }),
      ],
    });

    this.outputContainer.appendChild(hintContainer);
  }

  /**
   * 显示加载状态
   *
   * @param message 加载消息
   * @private
   */
  private showLoading(
    message: string = "正在请求 AI 分析",
    startedAt?: Date,
  ): void {
    // 清空初始提示
    if (this.outputContainer) {
      const hint = this.outputContainer.querySelector(".initial-hint");
      if (hint) {
        hint.remove();
      }
    }

    // 创建加载提示
    this.loadingContainer = this.createElement("div", {
      className: "loading-container",
      styles: {
        padding: "30px 20px",
        textAlign: "center",
      },
      children: [
        // 加载动画
        this.createElement("div", {
          className: "loading-spinner",
          styles: {
            width: "40px",
            height: "40px",
            margin: "0 auto 20px",
            border: "4px solid var(--ai-accent-tint)",
            borderTop: "4px solid var(--ai-accent)",
            borderRadius: "50%",
            animation: "spin 1s linear infinite",
          },
        }),
        // 加载消息
        this.createElement("div", {
          className: "loading-message",
          styles: {
            fontSize: "16px",
            color: "var(--ai-accent)",
            marginBottom: "10px",
            fontWeight: "600",
          },
          textContent: message,
        }),
        // 计时器
        this.createElement("div", {
          className: "loading-timer",
          styles: {
            fontSize: "14px",
            color: "#999",
          },
          textContent: "已请求: 0 秒",
        }),
      ],
    });

    if (this.outputContainer) {
      this.outputContainer.appendChild(this.loadingContainer);
    }

    // 添加旋转动画样式
    this.injectSpinnerStyle();

    // 启动计时器（如果提供 startedAt，则以其为起点）
    this.loadingStartTime = startedAt ? startedAt.getTime() : Date.now();
    this.loadingTimer = setInterval(() => {
      this.updateLoadingTimer();
    }, 100);
  }

  /**
   * 显示加载状态(公开方法)
   *
   * @param message 加载消息
   */
  public showLoadingState(
    message: string = "正在请求 AI 分析",
    startedAt?: Date,
  ): void {
    this.showLoading(message, startedAt);
  }

  /**
   * 注入旋转动画样式
   *
   * @private
   */
  private injectSpinnerStyle(): void {
    if (!this.container) return;

    const doc = this.container.ownerDocument;
    if (!doc || !doc.head) return;

    // 检查是否已添加
    if (doc.getElementById("ai-butler-spinner-style")) return;

    const style = doc.createElement("style");
    style.id = "ai-butler-spinner-style";
    style.textContent = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    doc.head.appendChild(style);
  }

  /**
   * 更新加载计时器
   *
   * @private
   */
  private updateLoadingTimer(): void {
    if (!this.loadingContainer) return;

    const timerElement = this.loadingContainer.querySelector(".loading-timer");
    if (!timerElement) return;

    const elapsed = Math.floor((Date.now() - this.loadingStartTime) / 1000);
    timerElement.textContent = `已请求: ${elapsed} 秒`;
  }

  /**
   * 隐藏加载状态
   *
   * @private
   */
  private hideLoading(): void {
    if (this.loadingTimer) {
      clearInterval(this.loadingTimer);
      this.loadingTimer = null;
    }

    if (this.loadingContainer) {
      this.loadingContainer.remove();
      this.loadingContainer = null;
    }
  }

  /**
   * 开始显示新条目
   *
   * @param itemTitle 条目标题
   */
  public startItem(itemTitle: string): void {
    if (!this.outputContainer) return;

    // 隐藏加载状态(如果存在)
    this.hideLoading();

    // 创建新的条目容器
    this.currentItemContainer = this.createElement("div", {
      className: "item-output",
      styles: {
        marginBottom: "30px",
        paddingBottom: "20px",
        borderBottom: "1px solid rgba(89, 192, 188, 0.2)",
      },
    });

    // 添加标题
    const titleElement = this.createElement("h3", {
      styles: {
        color: "var(--ai-accent)",
        marginBottom: "15px",
        fontSize: "16px",
      },
      textContent: itemTitle,
    });

    // 添加内容容器
    const contentElement = this.createElement("div", {
      className: "item-content",
      styles: {
        whiteSpace: "pre-wrap",
        wordWrap: "break-word",
        userSelect: "text", // 确保文本可以被选择
        cursor: "text", // 鼠标样式提示可选择
      },
    });

    this.currentItemContainer.appendChild(titleElement);
    this.currentItemContainer.appendChild(contentElement);
    this.outputContainer.appendChild(this.currentItemContainer);

    // 应用主题到新添加的元素
    this.applyTheme();

    // 重置缓冲区
    this.currentItemBuffer = "";

    // 滚动到底部
    this.scrollToBottom();
  }

  /**
   * 追加内容到当前条目
   *
   * @param chunk 增量文本
   */
  public appendContent(chunk: string): void {
    if (!this.currentItemContainer) return;

    // 累积内容
    this.currentItemBuffer += chunk;

    // 获取内容容器
    const contentElement = this.currentItemContainer.querySelector(
      ".item-content",
    ) as HTMLElement;

    if (contentElement) {
      // 渲染 Markdown
      const html = this.convertMarkdownToHTML(this.currentItemBuffer);
      contentElement.innerHTML = html;

      // 调试信息:检查滚动容器状态
      if (this.scrollArea) {
        const scrollHeight = this.scrollArea.scrollHeight;
        const clientHeight = this.scrollArea.clientHeight;
        const hasScroll = scrollHeight > clientHeight;

        // 输出调试信息到控制台
        ztoolkit.log(
          `[AI Butler] 滚动状态 - scrollHeight: ${scrollHeight}, clientHeight: ${clientHeight}, hasScroll: ${hasScroll}`,
        );
      }

      // 节流渲染数学公式
      this.scheduleRenderMath();

      // 滚动到底部
      this.scrollToBottom();
    }
  }

  /**
   * 完成当前条目
   */
  public finishItem(): void {
    if (!this.currentItemContainer) return;

    // 最终渲染一次数学公式
    this.renderMath();

    // 清空引用
    this.currentItemContainer = null;
    this.currentItemBuffer = "";
  }

  /**
   * 显示错误信息
   *
   * @param itemTitle 条目标题
   * @param errorMessage 错误消息
   */
  public showError(itemTitle: string, errorMessage: string): void {
    if (!this.outputContainer) return;

    // 隐藏加载状态(如果存在)
    this.hideLoading();

    const errorContainer = this.createElement("div", {
      className: "item-output error",
      styles: {
        marginBottom: "30px",
        paddingBottom: "20px",
        borderBottom: "1px solid rgba(255, 87, 34, 0.3)",
      },
      children: [
        this.createElement("h3", {
          styles: {
            color: "#ff5722",
            marginBottom: "15px",
            fontSize: "16px",
          },
          textContent: `❌ ${itemTitle}`,
        }),
        this.createElement("div", {
          styles: {
            color: "#f44336",
            fontSize: "13px",
            padding: "10px",
            backgroundColor: "rgba(255, 87, 34, 0.1)",
            borderRadius: "4px",
          },
          textContent: `错误: ${errorMessage}`,
        }),
      ],
    });

    this.outputContainer.appendChild(errorContainer);

    // 应用主题到新添加的元素
    this.applyTheme();

    this.scrollToBottom();
  }

  /**
   * 显示完成消息
   *
   * @param successCount 成功数量
   * @param totalCount 总数量
   */
  public showComplete(successCount: number, totalCount: number): void {
    if (!this.outputContainer) return;

    const message =
      successCount === totalCount
        ? `✅ 所有 ${totalCount} 个条目处理完成！`
        : `✅ 完成 ${successCount}/${totalCount} 个条目`;

    const completeElement = this.createElement("div", {
      styles: {
        marginTop: "20px",
        padding: "15px",
        backgroundColor: "var(--ai-accent-tint)",
        borderRadius: "6px",
        textAlign: "center",
        color: "var(--ai-accent)",
        fontWeight: "600",
      },
      textContent: message,
    });

    this.outputContainer.appendChild(completeElement);

    // 应用主题到新添加的元素
    this.applyTheme();

    this.scrollToBottom();
  }

  /**
   * 显示停止消息
   *
   * @param successCount 成功数量
   * @param failedCount 失败数量
   * @param notProcessed 未处理数量
   */
  public showStopped(
    successCount: number,
    failedCount: number,
    notProcessed: number,
  ): void {
    if (!this.outputContainer) return;

    const message = `⏸️ 已停止处理 - 成功: ${successCount}, 失败: ${failedCount}, 未处理: ${notProcessed}`;

    const stoppedElement = this.createElement("div", {
      styles: {
        marginTop: "20px",
        padding: "15px",
        backgroundColor: "rgba(158, 158, 158, 0.1)",
        borderRadius: "6px",
        textAlign: "center",
        color: "#9e9e9e",
        fontWeight: "600",
      },
      textContent: message,
    });

    this.outputContainer.appendChild(stoppedElement);

    // 应用主题到新添加的元素
    this.applyTheme();
    this.scrollToBottom();
  }

  /**
   * 设置停止回调
   *
   * @param callback 停止按钮点击时的回调函数
   */
  /**
   * 设置返回任务队列按钮的回调
   */
  public setQueueButtonHandler(callback: () => void | Promise<void>): void {
    this.onQueueButtonCallback = callback;
  }

  /**
   * 为兼容旧调用保留的别名
   */
  public setOnStop(callback: () => void | Promise<void>): void {
    this.setQueueButtonHandler(callback);
  }

  /**
   * 更新导航按钮状态
   */
  public updateQueueButton(
    state: "ready" | "stopped" | "completed" | "error",
  ): void {
    if (!this.queueButton) {
      return;
    }

    const button = this.queueButton;
    button.disabled = false;
    button.style.cursor = "pointer";
    button.style.opacity = "1";

    switch (state) {
      case "stopped":
        button.innerHTML = "⏹️ 已中断, 查看任务队列";
        button.style.backgroundColor = "var(--ai-accent-tint)";
        button.style.color = "var(--ai-accent)";
        break;
      case "completed":
        button.innerHTML = "✅ 查看任务队列";
        button.style.backgroundColor = "var(--ai-accent-tint)";
        button.style.color = "var(--ai-accent)";
        break;
      case "error":
        button.innerHTML = "⚠️ 查看任务队列";
        button.style.backgroundColor = "var(--ai-accent-tint)";
        button.style.color = "var(--ai-accent)";
        break;
      case "ready":
      default:
        button.innerHTML = "📋 返回任务队列";
        button.style.backgroundColor = "var(--ai-accent)";
        button.style.color = "var(--ai-accent)";
        break;
    }
  }

  /**
   * 将 Markdown 转换为 HTML（实例方法，简化版）
   *
   * @param markdown Markdown 文本
   * @returns HTML 字符串
   * @private
   */
  private convertMarkdownToHTML(markdown: string): string {
    // 使用 marked 转换 Markdown
    return marked.parse(markdown) as string;
  }

  /**
   * 静态方法：将 Markdown 转换为 HTML（带公式处理）
   *
   * 这是核心的 Markdown 转换逻辑,支持 LaTeX 数学公式
   *
   * 处理流程:
   * 1. 保护所有公式(避免被 marked 误处理)
   *    - 块级公式: \[...\] 和 $$...$$
   *    - 行内公式: \(...\) 和 $...$
   * 2. 使用 marked 解析 Markdown 语法
   * 3. 恢复所有公式到最终 HTML
   *
   * 公式占位符格式:
   * - 块级: ⒻⓄⓇⓂⓊⓁⒶ_BLOCK_<index>
   * - 行内: ⒻⓄⓇⓂⓊⓁⒶ_INLINE_<index>
   *
   * 错误处理:
   * - 如果 marked 解析失败,返回 HTML 转义的原文
   *
   * @param markdown Markdown 源文本
   * @returns 转换后的 HTML 字符串
   *
   * @example
   * ```typescript
   * const html = SummaryView.convertMarkdownToHTMLCore(
   *   "公式: $E=mc^2$\n\n块级公式:\n$$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$$"
   * );
   * ```
   */
  public static convertMarkdownToHTMLCore(markdown: string): string {
    // ===== 步骤 1: 保护公式，避免被 marked 误处理 =====
    const formulas: string[] = [];
    let html = markdown;

    // 转换并保护 LaTeX 块级公式: \[...\] → $$...$$
    html = html.replace(/\\\[([\s\S]*?)\\\]/g, (match, formula) => {
      const placeholder = `ⒻⓄⓇⓂⓊⓁⒶ_BLOCK_${formulas.length}`;
      formulas.push(`$$${formula.trim()}$$`);
      return placeholder;
    });

    // 保护已有的 $$ $$ 块级公式
    html = html.replace(/\$\$([\s\S]*?)\$\$/g, (match) => {
      const placeholder = `ⒻⓄⓇⓂⓊⓁⒶ_BLOCK_${formulas.length}`;
      formulas.push(match);
      return placeholder;
    });

    // 转换并保护 LaTeX 行内公式: \(...\) → $...$
    html = html.replace(/\\\((.*?)\\\)/g, (match, formula) => {
      const placeholder = `ⒻⓄⓇⓂⓊⓁⒶ_INLINE_${formulas.length}`;
      formulas.push(`$${formula}$`);
      return placeholder;
    });

    // 保护已有的 $ $ 行内公式
    // eslint-disable-next-line no-useless-escape
    html = html.replace(/\$([^\$\n]+?)\$/g, (match) => {
      const placeholder = `ⒻⓄⓇⓂⓊⓁⒶ_INLINE_${formulas.length}`;
      formulas.push(match);
      return placeholder;
    });

    // ===== 步骤 2: 使用 marked 转换 Markdown 为 HTML =====
    try {
      html = marked.parse(html) as string;
    } catch (error) {
      ztoolkit.log("[AI-Butler][SummaryView] Markdown 解析错误:", error);
      // 如果解析失败，返回 HTML 转义的原文
      html = `<p>${SummaryView.escapeHtml(html)}</p>`;
    }

    // ===== 步骤 3: 恢复所有公式 =====
    html = html.replace(
      /ⒻⓄⓇⓂⓊⓁⒶ_(BLOCK|INLINE)_(\d+)/g,
      (match, type, index) => {
        const formula = formulas[parseInt(index)];
        return formula || match;
      },
    );

    return html;
  }

  /**
   * HTML 转义工具方法（静态）
   *
   * 防止 XSS 攻击和 HTML 注入
   *
   * @param text 待转义的文本
   * @returns 转义后的文本
   * @private
   */
  private static escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * 节流渲染数学公式
   *
   * @private
   */
  private scheduleRenderMath(): void {
    if (this.renderMathTimer) {
      clearTimeout(this.renderMathTimer);
    }

    this.renderMathTimer = setTimeout(() => {
      this.renderMath();
    }, 500);
  }

  /**
   * 渲染数学公式
   *
   * @private
   */
  private renderMath(): void {
    if (!this.mathJaxReady || !this.outputContainer) return;

    // TODO: 实现 MathJax 渲染逻辑
    // 当前简化处理
  }

  /**
   * 清空输出内容
   */
  public clear(): void {
    // 清理加载状态
    this.hideLoading();

    if (this.outputContainer) {
      this.outputContainer.innerHTML = "";
      // 重新显示初始提示
      this.showInitialHint();
    }
    this.currentItemContainer = null;
    this.currentItemBuffer = "";
    this.userHasScrolled = false;
    this.updateQueueButton("ready");
  }

  /**
   * 视图销毁前的清理
   *
   * @protected
   */
  protected onDestroy(): void {
    // 清理计时器
    if (this.renderMathTimer) {
      clearTimeout(this.renderMathTimer);
      this.renderMathTimer = null;
    }

    if (this.loadingTimer) {
      clearInterval(this.loadingTimer);
      this.loadingTimer = null;
    }

    this.outputContainer = null;
    this.currentItemContainer = null;
    this.queueButton = null;
    this.scrollContainer = null;
    this.scrollArea = null;
    this.onQueueButtonCallback = null;
    this.loadingContainer = null;
  }
}
