/**
 * ================================================================
 * AI 笔记生成器模块
 * ================================================================
 *
 * 本模块是插件的核心功能实现,负责协调 PDF 提取、AI 分析和笔记创建的完整流程
 *
 * 主要职责:
 * 1. 统筹论文总结生成的完整工作流
 * 2. 协调 PDF 文本提取和 AI 模型调用
 * 3. 管理流式输出和用户界面更新
 * 4. 处理批量文献的队列执行
 * 5. 创建和管理 Zotero 笔记条目
 *
 * 工作流程:
 * PDF提取 -> 文本清理 -> AI分析 -> Markdown转换 -> 笔记保存
 *
 * 技术特点:
 * - 支持流式输出,实时反馈生成进度
 * - 智能错误处理和重试机制
 * - 批量处理支持用户中断
 * - Markdown 格式适配 Zotero 笔记系统
 *
 * @module noteGenerator
 * @author AI-Butler Team
 */

import { PDFExtractor } from "./pdfExtractor";
import { LLMClient } from "./llmClient";
import { SummaryView } from "./views/SummaryView";
import { getPref } from "../utils/prefs";
import { MainWindow } from "./views/MainWindow";

/**
 * AI 笔记生成器类
 *
 * 提供静态方法集合,封装论文笔记生成的核心逻辑
 * 采用静态方法设计,简化调用方式,无需实例化
 */
export class NoteGenerator {
  /**
   * 为单个文献条目生成 AI 总结笔记
   *
   * 这是单条目处理的核心函数,协调整个生成流程
   *
   * 执行流程:
   * 1. 从文献条目提取 PDF 文本
   * 2. 清理和预处理文本内容
   * 3. 调用 AI 模型生成总结
   * 4. 将 Markdown 格式转换为 Zotero 笔记格式
   * 5. 创建笔记并关联到文献条目
   *
   * 流式输出支持:
   * - 如果提供 outputWindow,会实时显示生成过程
   * - 通过 onProgress 回调函数传递 AI 输出的增量内容
   * - 用户可以在输出窗口中看到"打字机效果"
   *
   * 错误处理:
   * - PDF 提取失败:抛出明确的错误信息
   * - AI 调用失败:包含 API 错误详情
   * - 不创建包含错误信息的笔记,直接抛出异常由上层处理
   *
   * @param item Zotero 文献条目对象
   * @param outputWindow 可选的输出窗口,用于显示流式生成过程
   * @param progressCallback 可选的进度回调函数,接收处理状态消息和进度百分比
   * @returns 包含创建的笔记对象和完整内容的对象
   * @throws 当任何步骤失败时抛出错误
   */
  public static async generateNoteForItem(
    item: Zotero.Item,
    outputWindow?: SummaryView,
    progressCallback?: (message: string, progress: number) => void,
    streamCallback?: (chunk: string) => void,
  ): Promise<{ note: Zotero.Item; content: string }> {
    // 获取文献标题,用于日志和用户反馈
    const itemTitle = item.getField("title") as string;
    let note: Zotero.Item | null = null;
    let fullContent = "";

    try {
      // 笔记管理策略: skip/overwrite/append
      const policy = (
        (getPref("noteStrategy" as any) as string) || "skip"
      ).toLowerCase();
      const existing = await this.findExistingNote(item);
      if (existing) {
        if (policy === "skip") {
          progressCallback?.("已存在AI笔记，跳过", 100);
          return {
            note: existing,
            content: (existing as any).getNote?.() || "",
          };
        }
      }

      // 步骤 1: PDF 处理
      // 通知进度回调开始提取 (10% 完成)
      progressCallback?.("正在处理PDF...", 10);

      // 根据配置选择 PDF 处理模式
      const pdfMode = (getPref("pdfProcessMode") as string) || "base64";
      let pdfContent: string;
      let isBase64 = false;

      if (pdfMode === "base64") {
        // Base64 模式: 直接编码 PDF 文件
        pdfContent = await PDFExtractor.extractBase64FromItem(item);
        isBase64 = true;
      } else {
        // 文本模式: 提取并清理文本
        const fullText = await PDFExtractor.extractTextFromItem(item);
        const cleanedText = PDFExtractor.cleanText(fullText);
        pdfContent = PDFExtractor.truncateText(cleanedText);
        isBase64 = false;
      }

      // 步骤 2: AI 模型总结生成
      // 通知进度回调开始 AI 分析 (40% 完成)
      progressCallback?.("正在生成AI总结...", 40);

      // 如果有输出窗口,开始显示当前处理的条目
      if (outputWindow) {
        // 先显示加载状态
        outputWindow.showLoadingState(`正在分析「${itemTitle}」`);
      }

      // 定义流式输出回调函数
      // 每接收到 AI 返回的增量内容,就追加到 fullContent 和输出窗口
      const onProgress = async (chunk: string) => {
        fullContent += chunk;
        // 将增量通过外部 streamCallback 也广播出去(用于任务队列的流式详情)
        try {
          streamCallback?.(chunk);
        } catch (e) {
          // 避免空的 catch：记录并忽略外部回调错误
          ztoolkit.log("[AI Butler] streamCallback error:", e);
        }
        if (outputWindow) {
          // 第一次收到内容时,开始显示条目(会自动隐藏加载状态)
          if (fullContent === chunk) {
            outputWindow.startItem(itemTitle);
          }
          outputWindow.appendContent(chunk);
        }
      };

      // 调用 LLM 客户端生成总结
      const summary = await LLMClient.generateSummary(
        pdfContent,
        isBase64,
        undefined,
        onProgress,
      );

      // 确保使用完整的总结内容
      fullContent = summary;

      // 步骤 3: 创建/更新笔记
      // 通知进度回调开始创建笔记 (80% 完成)
      progressCallback?.("正在创建笔记...", 80);

      // 格式化笔记内容,添加标题和样式
      const noteContent = this.formatNoteContent(itemTitle, fullContent);

      if (existing) {
        // 覆盖或追加到已有笔记
        const oldHtml = (existing as any).getNote?.() || "";
        let finalHtml = noteContent;
        if (policy === "append") {
          finalHtml = `${oldHtml}\n<hr/>\n${noteContent}`;
        }
        (existing as any).setNote?.(finalHtml);
        await (existing as any).saveTx?.();
        note = existing;
      } else {
        // 创建新笔记
        note = await this.createNote(item, noteContent);
        await note.saveTx();
      }

      // 如果有输出窗口,标记当前条目完成
      if (outputWindow) {
        outputWindow.finishItem();
      }

      // 通知进度回调完成 (100%)
      progressCallback?.("完成！", 100);

      // 返回创建的笔记对象和内容
      return { note, content: fullContent };
    } catch (error: any) {
      // 记录错误日志
      ztoolkit.log(`[AI Butler] 为文献"${itemTitle}"生成笔记时出错:`, error);

      // 如果有输出窗口,显示错误信息
      if (outputWindow) {
        outputWindow.showError(itemTitle, error.message);
      }

      // 不创建包含错误信息的笔记,直接抛出异常由上层处理
      throw error;
    }
  }

  /** 查找已有的 AI 笔记(通过标签或标题标识) */
  private static async findExistingNote(
    item: Zotero.Item,
  ): Promise<Zotero.Item | null> {
    try {
      const noteIDs = (item as any).getNotes?.() || [];
      let target: any = null;
      for (const nid of noteIDs) {
        const n = await Zotero.Items.getAsync(nid);
        if (!n) continue;
        const tags: Array<{ tag: string }> = (n as any).getTags?.() || [];
        const hasTag = tags.some((t) => t.tag === "AI-Generated");
        const noteHtml: string = (n as any).getNote?.() || "";
        const titleMatch = /<h2>\s*AI 管家\s*-/.test(noteHtml);
        if (hasTag || titleMatch) {
          if (!target) target = n;
          else {
            const a = (target as any).dateModified || 0;
            const b = (n as any).dateModified || 0;
            if (b > a) target = n;
          }
        }
      }
      return target;
    } catch {
      return null;
    }
  }

  /**
   * 格式化笔记内容
   *
   * 为 AI 生成的总结添加标题头部,并转换为 Zotero 笔记兼容的 HTML 格式
   *
   * 处理步骤:
   * 1. 将 Markdown 格式的总结转换为 HTML
   * 2. 添加文献标题作为笔记标题 (并限制长度)
   * 3. 包装成完整的笔记结构
   *
   * @param itemTitle 文献条目标题
   * @param summary AI 生成的总结内容 (Markdown 格式)
   * @returns 格式化后的 HTML 内容,可直接保存到 Zotero 笔记
   *
   * @example
   * ```typescript
   * const formatted = formatNoteContent(
   *   "深度学习综述",
   *   "## 摘要\n这是一篇综述文章..."
   * );
   * // 返回: <h2>AI 管家 - 深度学习综述</h2><div>...</div>
   * ```
   */
  private static formatNoteContent(itemTitle: string, summary: string): string {
    // 将 Markdown 转换为笔记格式的 HTML
    const htmlContent = this.convertMarkdownToNoteHTML(summary);

    // 定义笔记标题中允许的文献标题最大长度,避免 Zotero 同步问题
    const maxTitleLength = 100;
    let truncatedTitle = itemTitle;

    // 如果原始标题超过长度限制,则进行截断并添加省略号
    if (truncatedTitle.length > maxTitleLength) {
      truncatedTitle = truncatedTitle.substring(0, maxTitleLength) + "...";
    }

    // 添加标题头部和内容包装
    return `<h2>AI 管家 - ${this.escapeHtml(truncatedTitle)}</h2>
<div>${htmlContent}</div>`;
  }

  /**
   * 将 Markdown 转换为适合 Zotero 笔记的 HTML 格式
   *
   * Zotero 笔记系统对 HTML 格式有特定要求:
   * 1. 不支持内联样式 (style 属性)
   * 2. 数学公式需要使用特定的 class 标记
   * 3. 块级公式用 <pre class="math">
   * 4. 行内公式用 <span class="math">
   *
   * 转换步骤:
   * 1. 使用 MainWindow 的核心方法将 Markdown 转换为 HTML
   * 2. 移除所有内联样式属性
   * 3. 将 MathJax 格式的公式转换为 Zotero 识别的格式
   *
   * 公式格式转换规则:
   * - `$$公式$$` -> `<pre class="math">$$公式$$</pre>` (块级)
   * - `$公式$` -> `<span class="math">$公式$</span>` (行内)
   *
   * @param markdown 原始 Markdown 文本
   * @returns 转换后的 HTML,适配 Zotero 笔记系统
   *
   * @example
   * ```typescript
   * const html = convertMarkdownToNoteHTML(
   *   "## 公式\n质能方程: $E=mc^2$\n\n$$\\frac{a}{b}$$"
   * );
   * // 返回格式化的 HTML,公式被正确标记
   * ```
   */
  private static convertMarkdownToNoteHTML(markdown: string): string {
    // 复用 SummaryView 的 Markdown 转换核心方法
    // 该方法会保护公式标记并转换基本 Markdown 语法
    let html = SummaryView.convertMarkdownToHTMLCore(markdown);

    // 移除所有内联样式,Zotero 笔记不支持 style 属性
    html = html.replace(/\s+style="[^"]*"/g, "");

    // 转换块级公式: $$...$$ → <pre class="math">$$...$$</pre>
    // Zotero 使用 <pre class="math"> 标签来渲染块级数学公式
    html = html.replace(
      /\$\$([\s\S]*?)\$\$/g,
      (_match: string, formula: string) => {
        return `<pre class="math">$$${formula}$$</pre>`;
      },
    );

    // 转换行内公式: $...$ → <span class="math">$...$</span>
    // Zotero 使用 <span class="math"> 标签来渲染行内数学公式
    // 注意: 公式内不能包含换行符或另一个 $
    html = html.replace(
      /\$([^$\n]+?)\$/g,
      (_match: string, formula: string) => {
        return `<span class="math">$${formula}$</span>`;
      },
    );

    return html;
  }

  /**
   * HTML 转义工具函数
   *
   * 将特殊字符转换为 HTML 实体,防止 XSS 攻击和格式错误
   *
   * 转义规则:
   * - & → &amp;
   * - < → &lt;
   * - > → &gt;
   * - " → &quot;
   * - ' → &#39;
   *
   * @param text 待转义的文本
   * @returns 转义后的安全 HTML 文本
   *
   * @example
   * ```typescript
   * escapeHtml('<script>alert("xss")</script>')
   * // 返回: "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"
   * ```
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
   * 创建新的 Zotero 笔记条目
   *
   * 在 Zotero 数据库中创建一个新的笔记,并关联到指定的文献条目
   *
   * 操作步骤:
   * 1. 实例化一个新的笔记对象
   * 2. 设置父条目 ID (关联到文献)
   * 3. 设置笔记内容 (HTML 格式)
   * 4. 添加标签 "AI-Generated"
   * 5. 保存到数据库
   *
   * 笔记特性:
   * - 自动关联到父文献条目
   * - 带有 "AI-Generated" 标签便于筛选
   * - 内容为 HTML 格式,支持富文本显示
   *
   * @param item 父文献条目对象
   * @param initialContent 初始笔记内容 (HTML 格式),默认为空字符串
   * @returns 创建并保存的笔记对象
   *
   * @example
   * ```typescript
   * const note = await createNote(
   *   parentItem,
   *   "<h2>总结</h2><p>这是AI生成的内容</p>"
   * );
   * console.log(note.id); // 新创建的笔记 ID
   * ```
   */
  private static async createNote(
    item: Zotero.Item,
    initialContent: string = "",
  ): Promise<Zotero.Item> {
    // 创建新的笔记对象
    const note = new Zotero.Item("note");

    // 设置父条目 ID,将笔记关联到文献
    note.parentID = item.id;

    // 设置笔记内容
    note.setNote(initialContent);

    // 添加 AI 生成标签,便于用户筛选和识别
    note.addTag("AI-Generated");

    // 保存到数据库
    await note.saveTx();

    return note;
  }

  /**
   * 为多个文献条目批量生成 AI 总结笔记
   *
   * 这是批量处理的核心函数,提供完整的用户交互和进度管理
   *
   * 功能特性:
   * 1. 自动创建输出窗口显示实时进度
   * 2. 支持用户中途停止处理
   * 3. 详细的成功/失败统计
   * 4. 每个条目独立处理,单个失败不影响后续条目
   *
   * 处理流程:
   * 1. 创建并打开主窗口
   * 2. 切换到 AI 总结视图
   * 3. 设置用户停止回调
   * 4. 依次处理每个条目
   * 5. 实时更新进度和统计
   * 6. 显示最终处理结果
   *
   * 错误处理策略:
   * - 单个条目失败:记录日志,继续处理下一个
   * - 用户停止:立即中断,显示已完成和未处理统计
   * - 系统错误:抛出异常,停止所有处理
   *
   * 进度回调参数说明:
   * - current: 当前处理到第几个条目 (1-based)
   * - total: 总共要处理的条目数
   * - progress: 当前条目的处理进度 (0-100)
   * - message: 进度描述消息
   *
   * @param items Zotero 文献条目数组
   * @param progressCallback 可选的进度回调函数
   *
   * @example
   * ```typescript
   * await generateNotesForItems(
   *   selectedItems,
   *   (current, total, progress, message) => {
   *     console.log(`[${current}/${total}] ${progress}% - ${message}`);
   *   }
   * );
   * ```
   */
  public static async generateNotesForItems(
    items: Zotero.Item[],
    progressCallback?: (
      current: number,
      total: number,
      progress: number,
      message: string,
    ) => void,
  ): Promise<void> {
    const total = items.length;
    let successCount = 0; // 成功处理计数
    let failedCount = 0; // 失败处理计数
    let stopped = false; // 用户停止标记
    let processingCompleted = false;

    // 创建并打开主窗口
    const mainWindow = MainWindow.getInstance();
    await mainWindow.open("summary");

    // 获取 AI 总结视图
    const summaryView = mainWindow.getSummaryView();
    summaryView.updateQueueButton("ready");

    // 设置返回任务队列按钮的回调函数
    summaryView.setQueueButtonHandler(() => {
      if (!stopped && !processingCompleted) {
        stopped = true;
        summaryView.updateQueueButton("stopped");
      }
      mainWindow.switchTab("tasks");
    });

    // 等待窗口完全初始化,避免渲染问题
    await Zotero.Promise.delay(200);

    try {
      // 依次处理每个文献条目
      for (let i = 0; i < total; i++) {
        // 检查用户是否点击了停止按钮
        if (stopped) {
          ztoolkit.log("[AI Butler] 用户停止了批量处理");
          break;
        }

        const item = items[i];
        const current = i + 1;
        const itemTitle = item.getField("title") as string;

        try {
          // 为当前条目生成笔记,带流式输出
          await this.generateNoteForItem(
            item,
            summaryView,
            (message, progress) => {
              // 转发进度信息到外层回调
              progressCallback?.(current, total, progress, message);
            },
          );

          // 成功计数加一
          successCount++;
        } catch (error: any) {
          // 记录失败,但继续处理下一个条目
          failedCount++;
          ztoolkit.log(`[AI Butler] 处理文献"${itemTitle}"失败:`, error);
        }
      }

      // 根据停止状态显示不同的完成消息
      if (stopped) {
        // 用户主动停止的情况
        const notProcessed = total - successCount - failedCount;
        summaryView.showStopped(successCount, failedCount, notProcessed);
        summaryView.updateQueueButton("stopped");
        processingCompleted = true;
        progressCallback?.(
          total,
          total,
          100,
          `已停止 (已完成 ${successCount} 个，失败 ${failedCount} 个，未处理 ${notProcessed} 个)`,
        );
      } else {
        // 正常完成的情况
        summaryView.showComplete(successCount, total);
        summaryView.updateQueueButton("completed");
        processingCompleted = true;

        // 根据成功/失败情况生成不同的完成消息
        if (failedCount === 0) {
          progressCallback?.(total, total, 100, "所有条目处理完成");
        } else if (successCount === 0) {
          progressCallback?.(total, total, 100, "所有条目处理失败");
        } else {
          progressCallback?.(
            total,
            total,
            100,
            `${successCount} 个成功，${failedCount} 个失败`,
          );
        }
      }
    } catch (error: any) {
      // 发生系统级错误时禁用停止按钮
      summaryView.updateQueueButton("error");
      processingCompleted = true;
      ztoolkit.log("[AI Butler] 批量处理过程中发生错误:", error);
      throw error;
    }
  }
}
