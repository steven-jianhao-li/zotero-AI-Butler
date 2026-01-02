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
import { LLMClient } from "./llmClient";
import { ImageClient, ImageGenerationError } from "./imageClient";
import { ImageNoteGenerator } from "./imageNoteGenerator";
import { NoteGenerator } from "./noteGenerator";
import { getPref } from "../utils/prefs";
import {
  getDefaultImageSummaryPrompt,
  getDefaultImageGenerationPrompt,
} from "../utils/prompts";

/**
 * 工作流阶段类型
 */
export type WorkflowStage =
  | "extracting"      // 提取 PDF
  | "summarizing"     // 生成视觉摘要
  | "generating"      // 生成图片
  | "saving"          // 保存笔记
  | "completed"       // 完成
  | "failed";         // 失败

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
  ): Promise<Zotero.Item> {
    const itemTitle = item.getField("title") as string;

    try {
      // ========== 阶段 1: 获取论文内容 ==========
      progressCallback?.("extracting", "正在提取论文内容...", 10);

      let pdfContent: string;
      let isBase64 = false;

      // 检查是否使用已有 AI 笔记
      const useExistingNote =
        (getPref("imageSummaryUseExistingNote" as any) as boolean) || false;

      if (useExistingNote) {
        // 尝试获取已有的 AI 笔记内容
        const existingNote = await NoteGenerator["findExistingNote"](item);
        if (existingNote) {
          const noteHtml = (existingNote as any).getNote?.() || "";
          // 简单地去除 HTML 标签
          pdfContent = noteHtml
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          ztoolkit.log(
            `[AI-Butler] 使用已有 AI 笔记，长度: ${pdfContent.length}`,
          );
        } else {
          // 没有已有笔记，回退到 PDF 提取
          ztoolkit.log("[AI-Butler] 未找到已有 AI 笔记，使用 PDF 提取");
          pdfContent = await this.extractPdfContent(item);
          isBase64 = this.isBase64Mode();
        }
      } else {
        // 直接从 PDF 提取
        pdfContent = await this.extractPdfContent(item);
        isBase64 = this.isBase64Mode();
      }

      // ========== 阶段 2: 生成视觉摘要 ==========
      progressCallback?.("summarizing", "正在生成视觉摘要...", 30);

      const visualSummary = await this.generateVisualSummary(
        pdfContent,
        isBase64,
        itemTitle,
      );

      ztoolkit.log(
        `[AI-Butler] 视觉摘要生成完成，长度: ${visualSummary.length}`,
      );

      // ========== 阶段 3: 生成学术概念海报 ==========
      progressCallback?.("generating", "正在生成学术概念海报...", 60);

      const imagePrompt = this.buildImagePrompt(
        visualSummary,
        itemTitle,
      );

      const imageResult = await ImageClient.generateImage(imagePrompt);

      ztoolkit.log(
        `[AI-Butler] 图片生成完成，大小: ${Math.round(imageResult.imageBase64.length / 1024)} KB`,
      );

      // ========== 阶段 4: 保存笔记 ==========
      progressCallback?.("saving", "正在保存一图总结笔记...", 90);

      const note = await ImageNoteGenerator.createImageNote(
        item,
        imageResult.imageBase64,
        imageResult.mimeType,
      );

      progressCallback?.("completed", "一图总结生成完成！", 100);

      return note;
    } catch (error: any) {
      progressCallback?.("failed", `生成失败: ${error.message}`, 0);

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
  ): Promise<string> {
    const prefMode = (getPref("pdfProcessMode") as string) || "base64";

    if (prefMode === "base64") {
      return await PDFExtractor.extractBase64FromItem(item);
    } else {
      const fullText = await PDFExtractor.extractTextFromItem(item);
      const cleanedText = PDFExtractor.cleanText(fullText);
      return PDFExtractor.truncateText(cleanedText);
    }
  }

  /**
   * 判断是否为 Base64 模式
   */
  private static isBase64Mode(): boolean {
    const prefMode = (getPref("pdfProcessMode") as string) || "base64";
    return prefMode === "base64";
  }

  /**
   * 生成视觉摘要
   */
  private static async generateVisualSummary(
    pdfContent: string,
    isBase64: boolean,
    itemTitle: string,
  ): Promise<string> {
    // 获取视觉提取提示词
    let prompt =
      (getPref("imageSummaryPrompt" as any) as string) ||
      getDefaultImageSummaryPrompt();

    // 替换变量
    prompt = prompt.replace(/\$\{context\}/g, isBase64 ? "[PDF 文件内容]" : pdfContent.substring(0, 5000));
    prompt = prompt.replace(/\$\{title\}/g, itemTitle);

    // 调用 LLM 生成视觉摘要
    const summary = await LLMClient.generateSummary(
      pdfContent,
      isBase64,
      prompt,
    );

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
    let prompt =
      (getPref("imageSummaryImagePrompt" as any) as string) ||
      getDefaultImageGenerationPrompt();

    // 获取语言设置
    const language =
      (getPref("imageSummaryLanguage" as any) as string) || "中文";

    // 替换变量
    prompt = prompt.replace(/\$\{summaryForImage\}/g, visualSummary);
    prompt = prompt.replace(/\$\{title\}/g, itemTitle);
    prompt = prompt.replace(/\$\{language\}/g, language);

    return prompt;
  }
}

export default ImageSummaryService;
