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
import LLMService from "./llmService";
import {
  LLMNoteMetadataService,
  type LLMNoteMetadata,
} from "./llmNoteMetadata";
import type { LLMAbortSignal, LLMResponse } from "./llmproviders/types";
import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";
import { getConfiguredMindmapPrompt } from "../utils/prompts";

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
    abortSignal?: LLMAbortSignal,
  ): Promise<Zotero.Item> {
    const itemTitle = item.getField("title") as string;

    try {
      // ========== 阶段 1: 获取论文内容 ==========
      progressCallback?.(
        "extracting",
        getString("mindmap-progress-extracting"),
        10,
      );

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
            getString("mindmap-error-pdf-too-large", {
              args: { size: fileSizeMB.toFixed(1), max: maxPdfSizeMB },
            }),
          );
        }
      }

      // ========== 阶段 2: 生成思维导图 Markdown ==========
      progressCallback?.(
        "generating",
        getString("mindmap-progress-generating"),
        40,
      );

      const mindmapResult = await this.generateMindmapMarkdown(
        item,
        itemTitle,
        abortSignal,
      );
      const mindmapMarkdown = mindmapResult.markdown;

      ztoolkit.log(
        `[AI-Butler] 思维导图生成完成，长度: ${mindmapMarkdown.length}`,
      );

      // ========== 阶段 3: 保存笔记 ==========
      progressCallback?.("saving", getString("mindmap-progress-saving"), 80);

      const note = await this.createMindmapNote(
        item,
        mindmapMarkdown,
        LLMNoteMetadataService.fromResponse("mindmap", mindmapResult.response),
      );

      progressCallback?.(
        "completed",
        getString("mindmap-progress-completed"),
        100,
      );

      return note;
    } catch (error: any) {
      progressCallback?.(
        "failed",
        getString("mindmap-progress-failed", {
          args: { message: error.message },
        }),
        0,
      );

      ztoolkit.log("[AI-Butler] 思维导图生成失败:", error);

      throw error;
    }
  }

  /**
   * 生成思维导图 Markdown
   */
  private static async generateMindmapMarkdown(
    item: Zotero.Item,
    itemTitle: string,
    abortSignal?: LLMAbortSignal,
  ): Promise<{ markdown: string; response: LLMResponse }> {
    // 获取思维导图提示词
    const prompt = getConfiguredMindmapPrompt(
      getPref("mindmapPrompt" as any) as string,
    );

    // 调用 LLM 生成思维导图 Markdown
    const response = await LLMService.generate({
      task: "mindmap",
      prompt,
      content: {
        kind: "zotero-item",
        item,
      },
      output: { format: "markdown" },
      transport: { abortSignal },
    });
    const mindmapContent = response.text;

    // 校验返回内容是否有效
    const trimmedContent = mindmapContent.trim();
    if (!trimmedContent) {
      const errorInfo = this.buildErrorDebugInfo(
        getString("mindmap-debug-empty-content"),
        mindmapContent,
        itemTitle,
        false,
        prompt,
      );
      throw new Error(
        getString("mindmap-error-empty-llm-response", {
          args: { details: errorInfo },
        }),
      );
    }

    // 检查是否包含有效的 Markdown 列表结构 (至少有一个 # 或 - 或 * 开头的行)
    const hasValidStructure = /^[#\-*]/m.test(trimmedContent);
    if (!hasValidStructure) {
      const errorInfo = this.buildErrorDebugInfo(
        getString("mindmap-debug-invalid-format"),
        mindmapContent,
        itemTitle,
        false,
        prompt,
      );
      ztoolkit.log(
        "[AI-Butler] 思维导图内容格式异常:",
        trimmedContent.substring(0, 500),
      );
      throw new Error(
        getString("mindmap-error-invalid-format", {
          args: { details: errorInfo },
        }),
      );
    }

    return { markdown: mindmapContent, response };
  }

  /**
   * 构建错误调试信息（用于笔记记录和日志）
   */
  private static buildErrorDebugInfo(
    errorType: string,
    llmResponse: string,
    pdfContent: string,
    isBase64: boolean,
    prompt: string,
  ): string {
    // 截断 LLM 响应（最多 500 字符）
    const truncatedResponse =
      llmResponse.length > 500
        ? llmResponse.substring(0, 500) + getString("mindmap-debug-truncated")
        : llmResponse || getString("mindmap-debug-empty-content");

    // 截断请求内容（如果是 base64 只显示前 100 字符）
    let truncatedRequest: string;
    if (isBase64) {
      truncatedRequest = getString("mindmap-debug-base64-truncated", {
        args: {
          content: pdfContent.substring(0, 100),
          length: pdfContent.length,
        },
      });
    } else {
      truncatedRequest =
        pdfContent.length > 300
          ? pdfContent.substring(0, 300) + getString("mindmap-debug-truncated")
          : pdfContent;
    }

    // 截断 prompt
    const truncatedPrompt =
      prompt.length > 200
        ? prompt.substring(0, 200) + getString("mindmap-debug-truncated")
        : prompt;

    return [
      getString("mindmap-debug-heading"),
      getString("mindmap-debug-error-type", { args: { type: errorType } }),
      "",
      getString("mindmap-debug-llm-response-heading"),
      truncatedResponse,
      "",
      getString("mindmap-debug-prompt-heading"),
      truncatedPrompt,
      "",
      getString("mindmap-debug-request-content-heading"),
      truncatedRequest,
    ].join("\n");
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
    metadata?: LLMNoteMetadata | null,
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
    const noteTitle = getString("mindmap-note-title", {
      args: { title: truncatedTitle },
    });

    // 将 Markdown 包裹在 markmap 代码块中
    // 注意：不要对 markmap 代码块进行 HTML 转义，否则侧边栏正则无法匹配
    const wrappedContent = `\`\`\`markmap\n${mindmapMarkdown}\n\`\`\``;

    // 构建笔记 HTML
    // 使用 <pre> 标签保留格式，但不转义内部内容以便侧边栏解析
    const noteHtmlRaw = `<h2>${this.escapeHtml(noteTitle)}</h2>
<div data-schema-version="8">
<pre>${wrappedContent}</pre>
</div>`;
    const noteHtml = metadata
      ? LLMNoteMetadataService.wrapHtml(noteHtmlRaw, metadata)
      : noteHtmlRaw;

    // 创建新笔记
    const note = new Zotero.Item("note");
    note.libraryID = item.libraryID;
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
  public static async findExistingMindmapNote(
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
      if (/<h2>\s*AI\s*管家思维导图\s*-/.test(noteHtml)) {
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
