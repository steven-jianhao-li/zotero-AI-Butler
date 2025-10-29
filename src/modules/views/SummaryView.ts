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
import { marked } from "marked";
import { getPref } from "../../utils/prefs";
import { config } from "../../../package.json";

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

  /** 停止按钮回调函数 */
  private onStopCallback: (() => void) | null = null;

  /** 停止按钮元素 */
  private stopButton: HTMLElement | null = null;

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
        width: "100%",  // 明确宽度
        overflow: "hidden",  // 防止容器本身滚动
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
            borderBottom: "2px solid #59c0bc",
            paddingBottom: "10px",
          },
          innerHTML: "AI 总结输出",
        }),
      ],
    });

    // 可滚动内容区域
    this.scrollContainer = this.createElement("div", {
      styles: {
        flex: "1 1 0",  // 关键:基准值为0,强制从 flex 分配获取高度
        minHeight: "0",  // 允许 flex 项目缩小
        overflow: "hidden",  // 外层不滚动
      },
    });

    // 创建实际的滚动区域 - 使用 100% 高度而不是 flex
    const scrollArea = this.createElement("div", {
      styles: {
        height: "100%",  // 关键:明确设置100%高度
        width: "100%",
        overflowY: "auto",  // 启用纵向滚动
        overflowX: "hidden",  // 禁止横向滚动
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
        wordWrap: "break-word",  // 确保长文本换行
        overflowWrap: "break-word",  // 兼容性换行
      },
    });

    // 创建初始提示
    this.showInitialHint();

    contentWrapper.appendChild(this.outputContainer);
    scrollArea.appendChild(contentWrapper);
    this.scrollContainer.appendChild(scrollArea);

    // 保存 scrollArea 的引用,用于滚动控制
    this.scrollArea = scrollArea;

    // 底部按钮区域
    this.stopButton = this.createElement("button", {
      id: "ai-butler-stop-button",
      styles: {
        fontSize: "16px",
        fontWeight: "700",
        padding: "12px 32px",
        backgroundColor: "#ff5722",
        color: "#ffffff",
        border: "none",
        borderRadius: "6px",
        cursor: "pointer",
        transition: "all 0.2s ease",
        minWidth: "140px",
        boxShadow: "0 2px 4px rgba(0,0,0,0.15)",
      },
      innerHTML: "🛑 停止后续条目的AI总结",
    });

    const footer = this.createElement("div", {
      styles: {
        padding: "15px 20px 20px 20px",
        borderTop: "1px solid rgba(89, 192, 188, 0.3)",
        textAlign: "center",
        flexShrink: "0",
      },
      children: [this.stopButton],
    });

    container.appendChild(header);
    container.appendChild(this.scrollContainer);
    container.appendChild(footer);

    return container;
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
      for (const nid of noteIDs) {
        try {
          const n = await Zotero.Items.getAsync(nid);
          if (!n) continue;
          const tags: Array<{ tag: string }> = (n as any).getTags?.() || [];
          const hasTag = tags.some(t => t.tag === "AI-Generated");
          const noteHtml: string = (n as any).getNote?.() || "";
          const titleMatch = /<h2>\s*AI 管家\s*-/.test(noteHtml);
          if (hasTag || titleMatch) {
            if (!targetNote) {
              targetNote = n;
            } else {
              // 选择修改时间更新的那个
              const a = (targetNote as any).dateModified || 0;
              const b = (n as any).dateModified || 0;
              if (b > a) targetNote = n;
            }
          }
        } catch {}
      }

      this.hideLoading();

      if (!targetNote) {
        // 没有找到匹配的 AI 笔记
        this.startItem(title);
        this.appendContent("未找到已保存的 AI 总结笔记。");
        this.finishItem();
        return;
      }

      // 渲染 HTML 内容
      const html = (targetNote as any).getNote?.() || "";
      this.startItem(title);
      const contentElement = this.currentItemContainer?.querySelector(
        ".item-content"
      ) as HTMLElement | null;
      if (contentElement) {
        contentElement.innerHTML = html;
      }
      this.finishItem();
    } catch (err) {
      this.hideLoading();
      this.startItem("加载失败");
      this.appendContent("无法加载该条目的已保存总结。");
      this.finishItem();
    }
  }

  /**
   * 视图挂载后的初始化
   * 
   * @protected
   */
  protected onMount(): void {
    // 绑定停止按钮事件
    if (this.stopButton) {
      this.stopButton.addEventListener("click", (e: Event) => {
        e.preventDefault();
        e.stopPropagation();

        // 更新按钮状态
        if (this.stopButton) {
          (this.stopButton as HTMLButtonElement).disabled = true;
          this.stopButton.innerHTML = "✓ 已停止";
          this.stopButton.style.backgroundColor = "#9e9e9e";
          this.stopButton.style.cursor = "not-allowed";
          this.stopButton.style.opacity = "0.8";
        }

        // 调用停止回调
        if (this.onStopCallback) {
          this.onStopCallback();
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
      const fontSize = parseInt(((getPref as any)("fontSize") as string) || "14", 10) || 14;
      if (this.container) {
        (this.container as HTMLElement).style.fontSize = `${fontSize}px`;
      }
      const auto = (getPref as any)("autoScroll") as boolean;
      this.autoScrollEnabled = (auto === undefined || auto === null) ? true : !!auto;
    } catch {}
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
    if (!this.scrollArea || this.userHasScrolled || !this.autoScrollEnabled) return;

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
  private showLoading(message: string = "正在请求 AI 分析", startedAt?: Date): void {
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
            border: "4px solid rgba(89, 192, 188, 0.2)",
            borderTop: "4px solid #59c0bc",
            borderRadius: "50%",
            animation: "spin 1s linear infinite",
          },
        }),
        // 加载消息
        this.createElement("div", {
          className: "loading-message",
          styles: {
            fontSize: "16px",
            color: "#59c0bc",
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
  public showLoadingState(message: string = "正在请求 AI 分析", startedAt?: Date): void {
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
        color: "#59c0bc",
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
      },
    });

    this.currentItemContainer.appendChild(titleElement);
    this.currentItemContainer.appendChild(contentElement);
    this.outputContainer.appendChild(this.currentItemContainer);

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
      ".item-content"
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
          `[AI Butler] 滚动状态 - scrollHeight: ${scrollHeight}, clientHeight: ${clientHeight}, hasScroll: ${hasScroll}`
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
        backgroundColor: "rgba(76, 175, 80, 0.1)",
        borderRadius: "6px",
        textAlign: "center",
        color: "#4caf50",
        fontWeight: "600",
      },
      textContent: message,
    });

    this.outputContainer.appendChild(completeElement);
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
    notProcessed: number
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
    this.scrollToBottom();
  }

  /**
   * 设置停止回调
   * 
   * @param callback 停止按钮点击时的回调函数
   */
  public setOnStop(callback: () => void): void {
    this.onStopCallback = callback;
  }

  /**
   * 禁用停止按钮
   * 
   * @param isStopped 是否为停止状态
   */
  public disableStopButton(isStopped: boolean): void {
    if (!this.stopButton) return;

    (this.stopButton as HTMLButtonElement).disabled = true;

    if (isStopped) {
      this.stopButton.innerHTML = "⏸️ 已停止";
      this.stopButton.style.backgroundColor = "#9e9e9e";
    } else {
      this.stopButton.innerHTML = "✓ 已完成";
      this.stopButton.style.backgroundColor = "#4caf50";
    }

    this.stopButton.style.cursor = "not-allowed";
    this.stopButton.style.opacity = "0.8";
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
    html = html.replace(/ⒻⓄⓇⓂⓊⓁⒶ_(BLOCK|INLINE)_(\d+)/g, (match, type, index) => {
      const formula = formulas[parseInt(index)];
      return formula || match;
    });

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
    this.stopButton = null;
    this.scrollContainer = null;
    this.scrollArea = null;
    this.onStopCallback = null;
    this.loadingContainer = null;
  }
}
