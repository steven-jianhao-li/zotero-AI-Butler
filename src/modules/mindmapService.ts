/**
 * ================================================================
 * 思维导图生成服务模块
 * ================================================================
 *
 * 整合完整的思维导图生成工作流：
 * 1. 提取论文 PDF 内容
 * 2. 调用 LLM 生成 Markdown 结构化列表
 * 3. 将结果保存到 Zotero 笔记（使用 markmap 代码块包裹）
 *
 * @module mindmapService
 * @author AI-Butler Team
 */

import { PDFExtractor } from "./pdfExtractor";
import { LLMClient } from "./llmClient";
import { getPref } from "../utils/prefs";
import { getDefaultMindmapPrompt } from "../utils/prompts";

/**
 * 工作流阶段类型
 */
export type MindmapWorkflowStage =
  | "extracting" // 提取 PDF
  | "generating" // 生成思维导图
  | "saving" // 保存笔记
  | "completed" // 完成
  | "failed"; // 失败

/**
 * 工作流进度回调
 */
export type MindmapProgressCallback = (
  stage: MindmapWorkflowStage,
  message: string,
  progress: number,
) => void;

/**
 * 思维导图生成服务类
 */
export class MindmapService {
  /**
   * 为文献条目生成思维导图
   *
   * @param item Zotero 文献条目
   * @param progressCallback 进度回调
   * @returns 创建的笔记对象
   */
  public static async generateForItem(
    item: Zotero.Item,
    progressCallback?: MindmapProgressCallback,
  ): Promise<Zotero.Item> {
    const itemTitle = item.getField("title") as string;

    try {
      // ========== 阶段 1: 获取论文内容 ==========
      progressCallback?.("extracting", "正在提取论文内容...", 10);

      // 检查 PDF 文件大小限制
      const enableSizeLimit =
        (getPref("enablePdfSizeLimit" as any) as boolean) ?? false;
      if (enableSizeLimit) {
        const maxPdfSizeMB = parseFloat(
          (getPref("maxPdfSizeMB" as any) as string) || "50",
        );
        const fileSizeMB = await PDFExtractor.getPdfFileSize(item);
        if (fileSizeMB > maxPdfSizeMB) {
          throw new Error(
            `PDF 文件过大 (${fileSizeMB.toFixed(1)} MB)，超过设置的阈值 ${maxPdfSizeMB} MB`,
          );
        }
      }

      const { pdfContent, isBase64 } = await this.extractPdfContent(item);

      // ========== 阶段 2: 生成思维导图 Markdown ==========
      progressCallback?.("generating", "正在生成思维导图...", 40);

      const mindmapMarkdown = await this.generateMindmapMarkdown(
        pdfContent,
        isBase64,
        itemTitle,
      );

      ztoolkit.log(
        `[AI-Butler] 思维导图生成完成，长度: ${mindmapMarkdown.length}`,
      );

      // ========== 阶段 3: 保存笔记 ==========
      progressCallback?.("saving", "正在保存思维导图笔记...", 80);

      const note = await this.createMindmapNote(item, mindmapMarkdown);

      progressCallback?.("completed", "思维导图生成完成！", 100);

      return note;
    } catch (error: any) {
      progressCallback?.("failed", `生成失败: ${error.message}`, 0);

      ztoolkit.log("[AI-Butler] 思维导图生成失败:", error);

      throw error;
    }
  }

  /**
   * 提取 PDF 内容
   */
  private static async extractPdfContent(
    item: Zotero.Item,
  ): Promise<{ pdfContent: string; isBase64: boolean }> {
    const prefMode = (getPref("pdfProcessMode") as string) || "base64";

    if (prefMode === "base64") {
      const pdfContent = await PDFExtractor.extractBase64FromItem(item);
      return { pdfContent, isBase64: true };
    } else {
      const fullText = await PDFExtractor.extractTextFromItem(item);
      const cleanedText = PDFExtractor.cleanText(fullText);
      const pdfContent = PDFExtractor.truncateText(cleanedText);
      return { pdfContent, isBase64: false };
    }
  }

  /**
   * 生成思维导图 Markdown
   */
  private static async generateMindmapMarkdown(
    pdfContent: string,
    isBase64: boolean,
    itemTitle: string,
  ): Promise<string> {
    // 获取思维导图提示词
    const prompt =
      (getPref("mindmapPrompt" as any) as string) || getDefaultMindmapPrompt();

    // 调用 LLM 生成思维导图 Markdown
    const mindmapContent = await LLMClient.generateSummaryWithRetry(
      pdfContent,
      isBase64,
      prompt,
    );

    return mindmapContent;
  }

  /**
   * 创建思维导图笔记
   *
   * @param item 父文献条目
   * @param mindmapMarkdown 思维导图 Markdown 内容
   * @returns 创建的笔记条目
   */
  private static async createMindmapNote(
    item: Zotero.Item,
    mindmapMarkdown: string,
  ): Promise<Zotero.Item> {
    // 查找并删除已有的思维导图笔记
    const existingNote = await this.findExistingMindmapNote(item);
    if (existingNote) {
      await existingNote.eraseTx();
    }

    // 构建笔记标题（限制长度）
    const itemTitle = item.getField("title") as string;
    const maxTitleLength = 50;
    const truncatedTitle =
      itemTitle.length > maxTitleLength
        ? itemTitle.substring(0, maxTitleLength) + "..."
        : itemTitle;
    const noteTitle = `AI 管家思维导图 - ${truncatedTitle}`;

    // 将 Markdown 包裹在 markmap 代码块中
    // 注意：不要对 markmap 代码块进行 HTML 转义，否则侧边栏正则无法匹配
    const wrappedContent = `\`\`\`markmap\n${mindmapMarkdown}\n\`\`\``;

    // 构建笔记 HTML
    // 使用 <pre> 标签保留格式，但不转义内部内容以便侧边栏解析
    const noteHtml = `<h2>${this.escapeHtml(noteTitle)}</h2>
<div data-schema-version="8">
<pre>${wrappedContent}</pre>
</div>`;

    // 创建新笔记
    const note = new Zotero.Item("note");
    note.parentID = item.id;
    note.setNote(noteHtml);

    // 添加标签 - 只使用 AI-Mindmap 标签，不添加 AI-Generated 避免与普通笔记混淆
    note.addTag("AI-Mindmap", 0);

    await note.saveTx();

    ztoolkit.log(`[AI-Butler] 思维导图笔记已创建: ${noteTitle}`);

    return note;
  }

  /**
   * 查找已有的思维导图笔记
   */
  private static async findExistingMindmapNote(
    item: Zotero.Item,
  ): Promise<Zotero.Item | null> {
    const noteIds = item.getNotes();
    for (const noteId of noteIds) {
      const note = await Zotero.Items.getAsync(noteId);
      if (!note) continue;

      const tags: Array<{ tag: string }> = (note as any).getTags?.() || [];
      const hasTag = tags.some((t) => t.tag === "AI-Mindmap");

      if (hasTag) {
        return note;
      }

      // 也检查笔记标题
      const noteHtml: string = (note as any).getNote?.() || "";
      if (noteHtml.includes("AI管家思维导图 -")) {
        return note;
      }
    }

    return null;
  }

  /**
   * HTML 转义
   */
  private static escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}

export default MindmapService;
