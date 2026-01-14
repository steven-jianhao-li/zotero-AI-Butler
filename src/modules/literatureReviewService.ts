/**
 * ================================================================
 * 文献综述服务
 * ================================================================
 *
 * 本模块提供文献综述生成的核心服务
 *
 * 主要职责:
 * 1. 创建报告条目
 * 2. 将选中的 PDF 作为附件添加到报告
 * 3. 提取多个 PDF 内容并发送给 LLM
 * 4. 生成 AI 笔记并关联到报告条目
 *
 * @module literatureReviewService
 * @author AI-Butler Team
 */

import { PDFExtractor } from "./pdfExtractor";
import { NoteGenerator } from "./noteGenerator";
import LLMClient from "./llmClient";
import { getPref } from "../utils/prefs";
import { ProviderRegistry } from "./llmproviders/ProviderRegistry";
import { PdfFileInfo } from "./llmproviders/ILlmProvider";

/**
 * PDF 文件信息（带文件路径）
 */
interface PdfFileData {
  title: string;
  filePath: string;
  content: string;
  isBase64: boolean;
}

/**
 * 文献综述服务类
 */
export class LiteratureReviewService {
  /**
   * 生成文献综述
   *
   * @param collection 目标分类
   * @param pdfAttachments 选中的 PDF 附件
   * @param reviewName 综述名称
   * @param prompt 用户自定义提示词
   * @param progressCallback 进度回调
   * @returns 创建的报告条目
   */
  static async generateReview(
    collection: Zotero.Collection,
    pdfAttachments: Zotero.Item[],
    reviewName: string,
    prompt: string,
    progressCallback?: (message: string, progress: number) => void,
  ): Promise<Zotero.Item> {
    progressCallback?.("正在创建报告条目...", 10);

    // 1. 创建报告条目
    const reportItem = await this.createReportItem(collection, reviewName);

    progressCallback?.("正在添加 PDF 附件...", 20);

    // 2. 将选中的 PDF 作为链接附件添加到报告条目
    await this.attachPdfsToReport(reportItem, pdfAttachments);

    progressCallback?.("正在提取 PDF 内容...", 30);

    // 3. 提取所有 PDF 内容（包括文件路径）
    const pdfContents = await this.extractPDFContentsFromAttachments(
      pdfAttachments,
      progressCallback,
    );

    progressCallback?.("正在生成综述...", 50);

    // 4. 调用 LLM 生成综述
    const summaryContent = await this.generateSummaryFromMultiplePDFs(
      pdfContents,
      prompt,
      progressCallback,
    );

    progressCallback?.("正在创建笔记...", 90);

    // 5. 创建 AI 笔记并关联到报告条目
    await this.createReviewNote(reportItem, reviewName, summaryContent);

    progressCallback?.("完成!", 100);

    return reportItem;
  }

  /**
   * 创建报告条目
   */
  static async createReportItem(
    collection: Zotero.Collection,
    reportName: string,
  ): Promise<Zotero.Item> {
    const item = new Zotero.Item("report");
    item.setField("title", reportName);
    item.libraryID = collection.libraryID;

    // 使用事务包装保存和添加到分类操作
    await Zotero.DB.executeTransaction(async () => {
      await item.save();
      await collection.addItem(item.id);
    });

    return item;
  }

  /**
   * 将 PDF 附件添加到报告条目
   *
   * 创建链接附件，将原始 PDF 链接到报告条目下
   * 附件命名格式：论文标题前N位 + 原附件名称
   * 优化：缓存父条目标题，避免重复查询
   */
  static async attachPdfsToReport(
    reportItem: Zotero.Item,
    pdfAttachments: Zotero.Item[],
  ): Promise<void> {
    const TITLE_PREFIX_LENGTH = 30; // 论文标题前缀长度

    // 缓存父条目标题
    const parentTitleCache = new Map<number, string>();

    for (const pdfAtt of pdfAttachments) {
      try {
        // 获取原始 PDF 文件路径
        const filePath = await pdfAtt.getFilePathAsync();
        if (!filePath) {
          ztoolkit.log(`[AI-Butler] PDF 附件无文件路径: ${pdfAtt.id}`);
          continue;
        }

        // 获取原始附件的标题
        const originalTitle = (pdfAtt.getField("title") as string) || "PDF";

        // 获取父条目（论文）的标题（带缓存）
        let paperTitle = "";
        const parentID = pdfAtt.parentID;
        if (parentID) {
          if (parentTitleCache.has(parentID)) {
            paperTitle = parentTitleCache.get(parentID) || "";
          } else {
            const parentItem = await Zotero.Items.getAsync(parentID);
            if (parentItem) {
              paperTitle = (
                (parentItem.getField("title") as string) || ""
              ).trim();
              parentTitleCache.set(parentID, paperTitle);
            }
          }
        }

        // 构建新的附件标题：论文标题前N位 + 原附件名称
        let newTitle = originalTitle;
        if (paperTitle) {
          const titlePrefix =
            paperTitle.length > TITLE_PREFIX_LENGTH
              ? paperTitle.substring(0, TITLE_PREFIX_LENGTH) + "..."
              : paperTitle;
          newTitle = `[${titlePrefix}] ${originalTitle}`;
        }

        // 创建链接附件
        await Zotero.Attachments.linkFromFile({
          file: filePath,
          parentItemID: reportItem.id,
          title: newTitle,
        });
      } catch (error) {
        ztoolkit.log(`[AI-Butler] 添加 PDF 附件失败:`, error);
        // 继续处理其他附件
      }
    }
  }

  /**
   * 从 PDF 附件提取内容（包括文件路径）
   * 优化：缓存父条目信息，避免重复查询
   */
  static async extractPDFContentsFromAttachments(
    pdfAttachments: Zotero.Item[],
    progressCallback?: (message: string, progress: number) => void,
  ): Promise<PdfFileData[]> {
    const contents: PdfFileData[] = [];
    const total = pdfAttachments.length;

    // 缓存父条目标题，避免重复查询
    const parentTitleCache = new Map<number, string>();
    // 统计每个父条目有多少个 PDF，用于判断是否需要显示附件名
    const parentPdfCount = new Map<number, number>();

    // 第一遍：统计每个父条目的 PDF 数量
    for (const pdfAtt of pdfAttachments) {
      const parentID = pdfAtt.parentID;
      if (parentID) {
        parentPdfCount.set(parentID, (parentPdfCount.get(parentID) || 0) + 1);
      }
    }

    for (let i = 0; i < pdfAttachments.length; i++) {
      const pdfAtt = pdfAttachments[i];
      const attachmentTitle =
        (pdfAtt.getField("title") as string) || `PDF ${i + 1}`;
      const progress = 30 + Math.floor((i / total) * 20);
      progressCallback?.(
        `正在提取 (${i + 1}/${total}): ${attachmentTitle.slice(0, 30)}...`,
        progress,
      );

      try {
        // 获取文件路径
        const filePath = await pdfAtt.getFilePathAsync();
        if (!filePath) {
          ztoolkit.log(`[AI-Butler] PDF 附件无文件路径: ${pdfAtt.id}`);
          continue;
        }

        // 获取父条目标题（带缓存）
        let paperTitle = "";
        const parentID = pdfAtt.parentID;
        if (parentID) {
          if (parentTitleCache.has(parentID)) {
            paperTitle = parentTitleCache.get(parentID) || "";
          } else {
            const parentItem = await Zotero.Items.getAsync(parentID);
            if (parentItem) {
              paperTitle = (
                (parentItem.getField("title") as string) || ""
              ).trim();
              parentTitleCache.set(parentID, paperTitle);
            }
          }
        }

        // 构建显示标题：如果同一论文有多个 PDF，则显示 "论文标题 - 附件名"
        let displayTitle = paperTitle || attachmentTitle;
        const pdfCountForParent = parentID
          ? parentPdfCount.get(parentID) || 1
          : 1;
        if (pdfCountForParent > 1 && paperTitle) {
          displayTitle = `${paperTitle} - ${attachmentTitle}`;
        }

        // 尝试读取 Base64 内容
        let base64Content = "";
        try {
          const fileData = await IOUtils.read(filePath);
          // 使用分块方式转换为 base64，避免大文件导致 "too many function arguments" 错误
          base64Content = this.arrayBufferToBase64(fileData);
        } catch (e) {
          ztoolkit.log(`[AI-Butler] 读取 PDF 文件失败: ${filePath}`, e);
        }

        contents.push({
          title: displayTitle,
          filePath,
          content: base64Content,
          isBase64: true,
        });
      } catch (error) {
        ztoolkit.log(
          `[AI-Butler] 提取 PDF 内容失败: ${attachmentTitle}`,
          error,
        );
        // 继续处理其他文献
      }
    }

    return contents;
  }

  /**
   * 使用 LLM 从多个 PDF 生成综述
   */
  static async generateSummaryFromMultiplePDFs(
    pdfContents: PdfFileData[],
    prompt: string,
    progressCallback?: (message: string, progress: number) => void,
  ): Promise<string> {
    if (pdfContents.length === 0) {
      throw new Error("没有可用的 PDF 内容");
    }

    // 检查当前使用的 API 提供商
    const providerName = (getPref("provider") as string) || "google";
    const provider = ProviderRegistry.get(providerName);

    // 检查 provider 是否支持多文件处理
    const supportsMultiFile =
      provider && typeof provider.generateMultiFileSummary === "function";

    // 判断是否是 Gemini 提供商（支持 google 和 gemini 两种名称）
    const isGemini =
      providerName === "google" ||
      providerName.toLowerCase().includes("gemini");

    if (supportsMultiFile && isGemini) {
      // 使用 Gemini 多文件模式 (inline_data)
      return await this.generateWithGeminiFileAPI(
        pdfContents,
        prompt,
        progressCallback,
      );
    } else {
      // 回退到合并文本模式
      return await this.generateWithMergedText(
        pdfContents,
        prompt,
        progressCallback,
      );
    }
  }

  /**
   * 使用 Gemini File API 生成综述
   */
  private static async generateWithGeminiFileAPI(
    pdfContents: PdfFileData[],
    prompt: string,
    progressCallback?: (message: string, progress: number) => void,
  ): Promise<string> {
    progressCallback?.("正在上传 PDF 文件到 Gemini...", 55);

    // 获取 Gemini provider（支持 google 和 gemini 两种名称）
    let provider = ProviderRegistry.get("google");
    if (!provider) {
      provider = ProviderRegistry.get("gemini");
    }
    if (!provider || typeof provider.generateMultiFileSummary !== "function") {
      throw new Error("Gemini provider 不支持多文件处理");
    }

    // 构建 PDF 文件信息列表
    const pdfFiles: PdfFileInfo[] = pdfContents.map((pdf, index) => ({
      filePath: pdf.filePath,
      displayName: `${index + 1}_${pdf.title.slice(0, 50)}`,
      base64Content: pdf.content,
    }));

    // 获取 LLM 选项
    const options = LLMClient.getLLMOptions();

    progressCallback?.("正在调用 AI 生成综述...", 65);

    // 调用 Gemini 多文件处理
    const result = await provider.generateMultiFileSummary(
      pdfFiles,
      prompt,
      options,
    );

    return result;
  }

  /**
   * 使用合并文本模式生成综述
   */
  private static async generateWithMergedText(
    pdfContents: PdfFileData[],
    prompt: string,
    progressCallback?: (message: string, progress: number) => void,
  ): Promise<string> {
    progressCallback?.("正在调用 AI 生成综述 (文本模式)...", 60);

    // 如果有 Base64 内容但 provider 不支持多文件，尝试提取文本
    let combinedContent = "";
    let hasBase64 = false;
    let firstBase64Content = "";

    for (const pdf of pdfContents) {
      if (pdf.isBase64 && pdf.content) {
        if (!hasBase64) {
          hasBase64 = true;
          firstBase64Content = pdf.content;
        }
        combinedContent += `\n\n=== 论文: ${pdf.title} ===\n[PDF 内容]\n`;
      } else {
        combinedContent += `\n\n=== 论文: ${pdf.title} ===\n${pdf.content}\n`;
      }
    }

    // 如果有 Base64 内容，使用第一个 PDF 的 Base64
    if (hasBase64 && firstBase64Content) {
      const fullPrompt = `${prompt}\n\n以下是需要综述的论文列表:\n${pdfContents.map((p, i) => `${i + 1}. ${p.title}`).join("\n")}\n\n请基于上传的 PDF 内容生成综述。`;

      const result = await LLMClient.generateSummaryWithRetry(
        firstBase64Content,
        true,
        fullPrompt,
      );
      return result;
    }

    // 纯文本模式
    if (!combinedContent.trim()) {
      throw new Error("当前 API 不支持多文件处理，且无法提取 PDF 文本内容");
    }

    const fullPrompt = `${prompt}\n\n以下是需要综述的论文内容:\n${combinedContent}`;

    const result = await LLMClient.generateSummaryWithRetry(
      combinedContent,
      false,
      fullPrompt,
    );

    return result;
  }

  /**
   * 创建综述笔记
   */
  static async createReviewNote(
    reportItem: Zotero.Item,
    reviewName: string,
    content: string,
  ): Promise<Zotero.Item> {
    // 使用 NoteGenerator 的格式化方法
    const formattedContent = NoteGenerator.formatNoteContent(
      reviewName,
      content,
    );

    // 创建笔记
    const note = await NoteGenerator.createNote(reportItem, formattedContent);

    return note;
  }

  /**
   * 将 ArrayBuffer 转换为 Base64 字符串
   * 使用分块处理避免 "too many function arguments" 错误
   */
  private static arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
    const bytes =
      buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const chunkSize = 0x8000; // 32KB chunks
    let result = "";

    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
      result += String.fromCharCode.apply(null, Array.from(chunk));
    }

    return btoa(result);
  }
}
