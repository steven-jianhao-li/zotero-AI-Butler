/**
 * ================================================================
 * 一图总结服务模块
 * ================================================================
 *
 * 整合完整的一图总结工作流：
 * 1. 提取论文 PDF 内容
 * 2. 调用 LLM 生成视觉摘要
 * 3. 调用 Gemini 生成学术概念海报
 * 4. 将图片保存到 Zotero 笔记
 *
 * @module imageSummaryService
 * @author AI-Butler Team
 */

import { PDFExtractor } from "./pdfExtractor";
import LLMService from "./llmService";
import { ImageClient, ImageGenerationError } from "./imageClient";
import { ImageNoteGenerator } from "./imageNoteGenerator";
import { NoteGenerator } from "./noteGenerator";
import { getPref } from "../utils/prefs";
import { getString } from "../utils/locale";
import type { LLMPdfProcessMode } from "./llmEndpointManager";
import type { LLMAbortSignal } from "./llmproviders/types";
import {
  getConfiguredImageSummaryPrompt,
  getConfiguredImageGenerationPrompt,
} from "../utils/prompts";

/**
 * 工作流阶段类型
 */
export type WorkflowStage =
  | "extracting" // 提取 PDF
  | "summarizing" // 生成视觉摘要
  | "generating" // 生成图片
  | "saving" // 保存笔记
  | "completed" // 完成
  | "failed"; // 失败

/**
 * 工作流进度回调
 */
export type WorkflowProgressCallback = (
  stage: WorkflowStage,
  message: string,
  progress: number,
) => void;

/**
 * 一图总结服务类
 */
export class ImageSummaryService {
  /**
   * 为文献条目生成一图总结
   *
   * @param item Zotero 文献条目
   * @param progressCallback 进度回调
   * @returns 创建的笔记对象
   */
  public static async generateForItem(
    item: Zotero.Item,
    progressCallback?: WorkflowProgressCallback,
    abortSignal?: LLMAbortSignal,
  ): Promise<Zotero.Item> {
    const itemTitle = item.getField("title") as string;

    try {
      // ========== 阶段 1: 获取论文内容 ==========
      progressCallback?.(
        "extracting",
        getString("image-summary-progress-extracting"),
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
            getString("image-summary-error-pdf-too-large", {
              args: { size: fileSizeMB.toFixed(1), max: maxPdfSizeMB },
            }),
          );
        }
      }

      let pdfContent: string;
      let isBase64 = false;
      const pdfMode = LLMService.getEffectivePdfProcessMode();

      // 检查是否使用已有 AI 总结
      const useExistingNote =
        (getPref("imageSummaryUseExistingNote" as any) as boolean) || false;

      if (useExistingNote) {
        // 尝试获取已有的 AI 总结内容
        const existingNote = await NoteGenerator.findExistingNote(item);
        if (existingNote) {
          const noteHtml = (existingNote as any).getNote?.() || "";
          // 简单地去除 HTML 标签
          pdfContent = noteHtml
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          ztoolkit.log(
            `[AI-Butler] 使用已有 AI 总结，长度: ${pdfContent.length}`,
          );
        } else {
          // 没有已有笔记，回退到 PDF 提取
          ztoolkit.log("[AI-Butler] 未找到已有 AI 总结，使用 PDF 提取");
          pdfContent = await this.extractPdfContent(item, pdfMode);
          isBase64 = pdfMode === "base64";
        }
      } else {
        // 直接从 PDF 提取
        pdfContent = await this.extractPdfContent(item, pdfMode);
        isBase64 = pdfMode === "base64";
      }

      // ========== 阶段 2: 生成视觉摘要 ==========
      progressCallback?.(
        "summarizing",
        getString("image-summary-progress-summarizing"),
        30,
      );

      const visualSummary = await this.generateVisualSummary(
        pdfContent,
        isBase64,
        itemTitle,
        abortSignal,
      );

      ztoolkit.log(
        `[AI-Butler] 视觉摘要生成完成，长度: ${visualSummary.length}`,
      );

      // ========== 阶段 3: 生成学术概念海报 ==========
      progressCallback?.(
        "generating",
        getString("image-summary-progress-generating"),
        60,
      );

      const imagePrompt = this.buildImagePrompt(visualSummary, itemTitle);

      const imageResult = await ImageClient.generateImage(imagePrompt, {
        abortSignal,
      });

      ztoolkit.log(
        `[AI-Butler] 图片生成完成，大小: ${Math.round(imageResult.imageBase64.length / 1024)} KB`,
      );

      // ========== 阶段 4: 保存笔记 ==========
      progressCallback?.(
        "saving",
        getString("image-summary-progress-saving"),
        90,
      );

      const note = await ImageNoteGenerator.createImageNote(
        item,
        imageResult.imageBase64,
        imageResult.mimeType,
      );

      progressCallback?.(
        "completed",
        getString("image-summary-progress-completed"),
        100,
      );

      return note;
    } catch (error: any) {
      progressCallback?.(
        "failed",
        getString("image-summary-progress-failed", {
          args: { message: error.message },
        }),
        0,
      );

      // 记录详细错误日志
      if (error instanceof ImageGenerationError) {
        ztoolkit.log(
          "[AI-Butler] 一图总结生成失败:",
          ImageClient.formatError(error),
        );
      } else {
        ztoolkit.log("[AI-Butler] 一图总结生成失败:", error);
      }

      throw error;
    }
  }

  /**
   * 提取 PDF 内容
   */
  private static async extractPdfContent(
    item: Zotero.Item,
    mode: LLMPdfProcessMode,
  ): Promise<string> {
    if (mode === "base64") {
      return await PDFExtractor.extractBase64FromItem(item);
    } else {
      const fullText = await PDFExtractor.extractTextFromItem(item, mode);
      const cleanedText = PDFExtractor.cleanText(fullText);
      return PDFExtractor.truncateText(cleanedText);
    }
  }

  /**
   * 生成视觉摘要
   */
  private static async generateVisualSummary(
    pdfContent: string,
    isBase64: boolean,
    itemTitle: string,
    abortSignal?: LLMAbortSignal,
  ): Promise<string> {
    // 获取视觉提取提示词
    let prompt = getConfiguredImageSummaryPrompt(
      getPref("imageSummaryPrompt" as any) as string,
    );

    // 替换变量
    prompt = prompt.replace(
      /\$\{context\}/g,
      isBase64 ? "[PDF 文件内容]" : pdfContent.substring(0, 5000),
    );
    prompt = prompt.replace(/\$\{title\}/g, itemTitle);

    // 调用 LLM 生成视觉摘要 (使用带重试的方法，支持 API 密钥轮换)
    const summary = await LLMService.generateText({
      task: "image-summary",
      prompt,
      content: {
        kind: "legacy",
        content: pdfContent,
        isBase64,
        policy: isBase64 ? "pdf-base64" : "text",
      },
      transport: { abortSignal },
    });

    return summary;
  }

  /**
   * 构建生图提示词
   */
  private static buildImagePrompt(
    visualSummary: string,
    itemTitle: string,
  ): string {
    // 获取生图提示词模板
    let prompt = getConfiguredImageGenerationPrompt(
      getPref("imageSummaryImagePrompt" as any) as string,
    );

    // 获取语言设置
    const language =
      (getPref("imageSummaryLanguage" as any) as string) ||
      getString("settings-image-summary-default-language");

    // 替换变量
    prompt = prompt.replace(/\$\{summaryForImage\}/g, visualSummary);
    prompt = prompt.replace(/\$\{title\}/g, itemTitle);
    prompt = prompt.replace(/\$\{language\}/g, language);

    return prompt;
  }
}

export default ImageSummaryService;
