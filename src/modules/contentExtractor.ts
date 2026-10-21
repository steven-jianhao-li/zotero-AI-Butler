import { getString } from "../utils/locale";
import {
  PDFExtractor,
  type PdfExtractionProgressCallback,
} from "./pdfExtractor";
import { SnapshotExtractor } from "./snapshotExtractor";
import { EPUBExtractor, EPUBExtractionError } from "./epubExtractor";
import type { LLMPdfProcessMode } from "./llmEndpointManager";
import type { LLMAbortSignal } from "./llmproviders/types";
import { throwIfAborted } from "./llmproviders/shared/requestAbort";

export type AnalyzableContentKind = "pdf" | "epub" | "web-snapshot";

export type ResolvedAnalyzableContent = {
  content: string;
  isBase64: boolean;
  kind: AnalyzableContentKind;
  attachment?: Zotero.Item;
};

/**
 * 统一的可分析内容源入口。
 *
 * 优先使用 PDF，其次是宿主支持的 EPUB，最后使用网页快照文本。
 * EPUB 始终通过 Zotero 原生解析器读取文字，不改变用户选择的 PDF 处理模式。
 */
export class ContentExtractor {
  public static async hasAnalyzableAttachment(
    item: Zotero.Item,
  ): Promise<boolean> {
    return (await this.getPreferredAnalyzableAttachments(item)).length > 0;
  }

  /**
   * 返回当前默认策略会使用的内容源附件。
   *
   * 注意：这不是“所有”可分析附件。为了不影响已有流程，存在 PDF 时只返回 PDF；
   * 没有 PDF 时返回最早的 EPUB（需宿主支持），再回退到最早的网页快照。
   */
  public static async getPreferredAnalyzableAttachments(
    item: Zotero.Item,
  ): Promise<Zotero.Item[]> {
    const pdfAttachments = await PDFExtractor.getAllPdfAttachments(item);
    if (pdfAttachments.length > 0) {
      return pdfAttachments;
    }

    const epub = await EPUBExtractor.getOldestEpubAttachment(item);
    if (epub && EPUBExtractor.isSupported()) return [epub];

    const snapshot =
      await SnapshotExtractor.getOldestWebSnapshotAttachment(item);
    return snapshot ? [snapshot] : [];
  }

  /**
   * 兼容旧命名。实际语义为 getPreferredAnalyzableAttachments()。
   */
  public static async getAllAnalyzableAttachments(
    item: Zotero.Item,
  ): Promise<Zotero.Item[]> {
    return this.getPreferredAnalyzableAttachments(item);
  }

  public static async hasUsableAnalyzableAttachment(
    item: Zotero.Item,
  ): Promise<boolean> {
    const attachments = await this.getPreferredAnalyzableAttachments(item);
    for (const attachment of attachments) {
      if (await this.isAttachmentFileAvailable(attachment)) {
        return true;
      }
    }
    return false;
  }

  /** Explain unavailable EPUB support when a manual request has no usable source. */
  public static async getUnavailableAttachmentMessage(
    items: readonly Zotero.Item[],
  ): Promise<string> {
    for (const item of items) {
      const epub = await EPUBExtractor.getOldestEpubAttachment(item);
      if (
        epub &&
        !EPUBExtractor.isSupported() &&
        (await this.getPreferredAnalyzableAttachments(item)).length === 0
      ) {
        return getString("epub-error-unavailable");
      }
    }
    return getString("content-error-no-usable-attachment");
  }

  public static async extractAnalyzableContentFromItem(
    item: Zotero.Item,
    preferBase64: boolean,
    pdfProcessMode?: LLMPdfProcessMode,
    progressCallback?: PdfExtractionProgressCallback,
    options: { persist?: boolean; abortSignal?: LLMAbortSignal } = {},
  ): Promise<ResolvedAnalyzableContent> {
    throwIfAborted(options.abortSignal);
    const pdfAttachments = await PDFExtractor.getAllPdfAttachments(item);
    throwIfAborted(options.abortSignal);
    if (pdfAttachments.length > 0) {
      if (preferBase64) {
        return {
          content: await PDFExtractor.extractBase64FromItem(
            item,
            progressCallback,
            options.abortSignal,
          ),
          isBase64: true,
          kind: "pdf",
          attachment: pdfAttachments[0],
        };
      }

      return {
        content: await PDFExtractor.extractTextFromItem(
          item,
          pdfProcessMode || "text",
          progressCallback,
          options,
        ),
        isBase64: false,
        kind: "pdf",
        attachment: pdfAttachments[0],
      };
    }

    const epub = await EPUBExtractor.getOldestEpubAttachment(item);
    throwIfAborted(options.abortSignal);
    if (epub && EPUBExtractor.isSupported()) {
      progressCallback?.(getString("epub-progress-extracting"), 25);
      const content = await EPUBExtractor.extractTextFromAttachment(
        epub,
        options.abortSignal,
      );
      progressCallback?.(getString("epub-progress-extracted"), 38);
      return { content, isBase64: false, kind: "epub", attachment: epub };
    }

    const snapshot =
      await SnapshotExtractor.getOldestWebSnapshotAttachment(item);
    throwIfAborted(options.abortSignal);
    if (!snapshot) {
      if (epub) {
        throw new EPUBExtractionError(getString("epub-error-unavailable"));
      }
      throw new Error(getString("content-error-no-analyzable-attachment"));
    }

    return {
      content: await SnapshotExtractor.extractTextFromWebSnapshot(snapshot),
      isBase64: false,
      kind: "web-snapshot",
      attachment: snapshot,
    };
  }

  public static async extractTextFromItem(
    item: Zotero.Item,
    pdfProcessMode?: LLMPdfProcessMode,
    progressCallback?: PdfExtractionProgressCallback,
  ): Promise<string> {
    const result = await this.extractAnalyzableContentFromItem(
      item,
      false,
      pdfProcessMode,
      progressCallback,
    );
    return result.content;
  }

  public static async extractTextFromAnalyzableAttachment(
    attachment: Zotero.Item,
    abortSignal?: LLMAbortSignal,
  ): Promise<string> {
    throwIfAborted(abortSignal);
    if (PDFExtractor.isPdfAttachment(attachment)) {
      return PDFExtractor.extractTextFromAttachment(attachment, abortSignal);
    }

    if (EPUBExtractor.isEpubAttachment(attachment)) {
      return EPUBExtractor.extractTextFromAttachment(attachment, abortSignal);
    }

    if (await SnapshotExtractor.isWebSnapshotAttachment(attachment)) {
      return SnapshotExtractor.extractTextFromWebSnapshot(attachment);
    }

    throw new Error(getString("content-error-unsupported-attachment"));
  }

  public static async isAttachmentFileAvailable(
    attachment: Zotero.Item,
  ): Promise<boolean> {
    try {
      // getFile() 返回文件句柄并不保证文件存在，尤其是已删除的链接附件。
      const filePath =
        (await attachment.getFilePathAsync?.()) ||
        attachment.getFilePath?.() ||
        "";
      if (!filePath) return false;
      return typeof IOUtils !== "undefined"
        ? await IOUtils.exists(String(filePath))
        : true;
    } catch (error) {
      ztoolkit.log("[ContentExtractor] 检查附件文件可用性时出错:", error);
      return false;
    }
  }
}
