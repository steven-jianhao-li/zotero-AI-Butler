import { PDFExtractor } from "./pdfExtractor";
import { SnapshotExtractor } from "./snapshotExtractor";
import type { LLMPdfProcessMode } from "./llmEndpointManager";

export type ResolvedAnalyzableContent = {
  content: string;
  isBase64: boolean;
};

/**
 * 统一内容源入口。
 *
 * 根据 Zotero 条目或附件的类型调度到 PDF / 网页快照等具体 extractor，
 * 让业务模块只依赖“可分析内容源”这一抽象。
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

  public static async getAllAnalyzableAttachments(
    item: Zotero.Item,
  ): Promise<Zotero.Item[]> {
    const attachments = await this.getSortedAttachments(item);
    const pdfAttachments = attachments.filter((attachment) =>
      PDFExtractor.isPdfAttachment(attachment),
    );
    if (pdfAttachments.length > 0) {
      return pdfAttachments;
    }

    for (const attachment of attachments) {
      if (await SnapshotExtractor.isWebSnapshotAttachment(attachment)) {
        return [attachment];
      }
    }

    return [];
  }

  public static async extractAnalyzableContentFromItem(
    item: Zotero.Item,
    preferBase64: boolean,
    pdfProcessMode?: LLMPdfProcessMode,
  ): Promise<ResolvedAnalyzableContent> {
    if (preferBase64 && (await PDFExtractor.hasPDFAttachment(item))) {
      return {
        content: await PDFExtractor.extractBase64FromItem(item),
        isBase64: true,
      };
    }

    return {
      content: await this.extractTextFromItem(item, pdfProcessMode),
      isBase64: false,
    };
  }

  public static async extractTextFromItem(
    item: Zotero.Item,
    pdfProcessMode?: LLMPdfProcessMode,
  ): Promise<string> {
    if (await PDFExtractor.hasPDFAttachment(item)) {
      return PDFExtractor.extractTextFromItem(item, pdfProcessMode);
    }

    const snapshotAttachment =
      await SnapshotExtractor.getOldestWebSnapshotAttachment(item);
    if (!snapshotAttachment) {
      throw new Error("No analyzable attachment found for this item");
    }

    (globalThis as any).ztoolkit?.log?.(
      `[AI Butler] Selected web snapshot content source: ${snapshotAttachment.getField("title")} (Added: ${snapshotAttachment.dateAdded})`,
    );
    return SnapshotExtractor.extractTextFromWebSnapshot(snapshotAttachment);
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

    throw new Error("Attachment is not an analyzable content source");
  }

  private static async getSortedAttachments(
    item: Zotero.Item,
  ): Promise<Zotero.Item[]> {
    const attachments = item.getAttachments();
    if (attachments.length === 0) {
      return [];
    }

    const resolved = await Promise.all(
      attachments.map((attachmentID) => Zotero.Items.getAsync(attachmentID)),
    );
    return resolved
      .filter((attachment): attachment is Zotero.Item => !!attachment)
      .sort((a, b) => {
        const dateA = this.getAttachmentSortTime(a);
        const dateB = this.getAttachmentSortTime(b);
        return dateA - dateB;
      });
  }

  private static getAttachmentSortTime(attachment: Zotero.Item): number {
    const timestamp = new Date(attachment.dateAdded || "").getTime();
    return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
  }
}
