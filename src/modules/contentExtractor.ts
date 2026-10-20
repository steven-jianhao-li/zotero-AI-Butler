import { getString } from "../utils/locale";
import {
  PDFExtractor,
  type PdfExtractionProgressCallback,
} from "./pdfExtractor";
import { SnapshotExtractor } from "./snapshotExtractor";
import type { LLMPdfProcessMode } from "./llmEndpointManager";
import type { LLMAbortSignal } from "./llmproviders/types";
import { throwIfAborted } from "./llmproviders/shared/requestAbort";

export type AnalyzableContentKind = "pdf" | "web-snapshot";

export type ResolvedAnalyzableContent = {
  content: string;
  isBase64: boolean;
  kind: AnalyzableContentKind;
  attachment?: Zotero.Item;
};

/**
 * 统一的可分析内容源入口。
 *
 * 策略刻意保守：有 PDF 时保持原有 PDF 优先行为；只有在没有 PDF 时，才回退到
 * Zotero 网页快照文本，避免改变既有用户对 PDF 处理模式的预期。
 */
export class ContentExtractor {
  public static async hasAnalyzableAttachment(
    item: Zotero.Item,
  ): Promise<boolean> {
    if (await PDFExtractor.hasPDFAttachment(item)) {
      return true;
    }
    return SnapshotExtractor.hasWebSnapshotAttachment(item);
  }

  /**
   * 返回当前默认策略会使用的内容源附件。
   *
   * 注意：这不是“所有”可分析附件。为了不影响已有流程，存在 PDF 时只返回 PDF；
   * 没有 PDF 时才返回最早的网页快照作为文本兜底。
   */
  public static async getPreferredAnalyzableAttachments(
    item: Zotero.Item,
  ): Promise<Zotero.Item[]> {
    const pdfAttachments = await PDFExtractor.getAllPdfAttachments(item);
    if (pdfAttachments.length > 0) {
      return pdfAttachments;
    }

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

    const snapshot =
      await SnapshotExtractor.getOldestWebSnapshotAttachment(item);
    throwIfAborted(options.abortSignal);
    if (!snapshot) {
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
  ): Promise<string> {
    if (PDFExtractor.isPdfAttachment(attachment)) {
      return PDFExtractor.extractTextFromAttachment(attachment);
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
