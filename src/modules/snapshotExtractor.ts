import { PDFExtractor } from "./pdfExtractor";

/**
 * 网页快照内容提取器。
 *
 * 只负责识别 Zotero 网页快照附件并将 HTML 快照解析为可供 LLM 使用的文本。
 */
export class SnapshotExtractor {
  private static htmlDomParser: DOMParser | null = null;
  private static readonly WEB_SNAPSHOT_CONTENT_TYPES = new Set([
    "text/html",
    "application/xhtml+xml",
  ]);
  private static readonly WEB_SNAPSHOT_EXTENSIONS = [".html", ".htm", ".xhtml"];
  private static readonly HTML_BLOCK_TAGS = new Set([
    "address",
    "article",
    "aside",
    "blockquote",
    "body",
    "br",
    "caption",
    "dd",
    "div",
    "dl",
    "dt",
    "figcaption",
    "figure",
    "footer",
    "form",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "hr",
    "li",
    "main",
    "nav",
    "ol",
    "p",
    "pre",
    "section",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "tr",
    "ul",
  ]);

  public static async hasWebSnapshotAttachment(
    item: Zotero.Item,
  ): Promise<boolean> {
    try {
      return (await this.getOldestWebSnapshotAttachment(item)) !== null;
    } catch (error) {
      ztoolkit.log("[SnapshotExtractor] 检查网页快照附件时出错:", error);
      return false;
    }
  }

  public static async getOldestWebSnapshotAttachment(
    item: Zotero.Item,
  ): Promise<Zotero.Item | null> {
    const attachments = await this.getSortedAttachments(item);
    for (const attachment of attachments) {
      if (await this.isWebSnapshotAttachment(attachment)) {
        return attachment;
      }
    }
    return null;
  }

  public static async isWebSnapshotAttachment(
    attachment: Zotero.Item,
  ): Promise<boolean> {
    const contentType = this.getAttachmentContentType(attachment);
    if (this.WEB_SNAPSHOT_CONTENT_TYPES.has(contentType)) {
      return !!(await this.getAttachmentFilePath(attachment));
    }

    const filePath = await this.getAttachmentFilePath(attachment);
    if (!filePath) {
      return false;
    }

    return this.WEB_SNAPSHOT_EXTENSIONS.some((extension) =>
      filePath.toLowerCase().endsWith(extension),
    );
  }

  public static async extractTextFromWebSnapshot(
    snapshotAttachment: Zotero.Item,
  ): Promise<string> {
    if (!(await this.isWebSnapshotAttachment(snapshotAttachment))) {
      throw new Error("Attachment is not a web snapshot");
    }

    const snapshotPath = await this.getAttachmentFilePath(snapshotAttachment);
    if (!snapshotPath) {
      throw new Error("Failed to get web snapshot file path");
    }

    const htmlContent = await Zotero.File.getContentsAsync(snapshotPath);
    const htmlText =
      typeof htmlContent === "string"
        ? htmlContent
        : new TextDecoder().decode(htmlContent as BufferSource);

    if (!htmlText || htmlText.trim().length === 0) {
      throw new Error("Web snapshot file is empty or cannot be read");
    }

    const text = PDFExtractor.truncateText(
      PDFExtractor.cleanText(this.htmlToText(htmlText)),
    );
    if (!text || text.trim().length === 0) {
      throw new Error(
        "Failed to extract text from web snapshot or snapshot is empty",
      );
    }

    return text;
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

  private static getAttachmentContentType(attachment: Zotero.Item): string {
    return String(
      (attachment as any).attachmentContentType ||
        (attachment as any).attachmentMIMEType ||
        "",
    ).toLowerCase();
  }

  private static async getAttachmentFilePath(
    attachment: Zotero.Item,
  ): Promise<string> {
    const asyncPath = await (attachment as any).getFilePathAsync?.();
    if (asyncPath) {
      return String(asyncPath);
    }

    const syncPath = (attachment as any).getFilePath?.();
    return syncPath ? String(syncPath) : "";
  }

  private static htmlToText(html: string): string {
    try {
      const doc = this.getHtmlDomParser().parseFromString(html, "text/html");
      const body = doc.body || doc.documentElement;
      if (!body) {
        return this.fallbackHtmlToText(html);
      }

      body
        .querySelectorAll("script, style, noscript, template")
        .forEach((node: Element) => node.remove());

      body.querySelectorAll("li").forEach((node: Element) => {
        if (!this.elementTextStartsWithBullet(node)) {
          const bullet = doc.createTextNode("• ");
          if (node.firstChild) {
            node.insertBefore(bullet, node.firstChild);
          } else {
            node.appendChild(bullet);
          }
        }
      });

      const text = this.readHtmlNodeText(body);
      return text || this.fallbackHtmlToText(html);
    } catch (error) {
      ztoolkit.log("[SnapshotExtractor] 解析网页快照 HTML 时出错:", error);
      return this.fallbackHtmlToText(html);
    }
  }

  private static readHtmlNodeText(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || "";
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    const element = node as Element;
    const tagName = element.tagName.toLowerCase();
    if (tagName === "br") {
      return "\n";
    }

    const isBlock = this.HTML_BLOCK_TAGS.has(tagName);
    let text = "";
    for (let i = 0; i < element.childNodes.length; i++) {
      const childNode = element.childNodes.item(i);
      if (childNode) {
        text += this.readHtmlNodeText(childNode);
      }
    }

    if (tagName === "a") {
      const href = element.getAttribute("href");
      if (href && text.trim().length === 0) {
        text = href;
      }
    }

    if (!isBlock) {
      return text;
    }

    if (tagName === "li") {
      return `${text}\n`;
    }

    return `\n${text}\n`;
  }

  private static fallbackHtmlToText(html: string): string {
    const decodeNumericEntity = (raw: string): string => {
      const codePoint =
        raw.startsWith("x") || raw.startsWith("X")
          ? parseInt(raw.slice(1), 16)
          : parseInt(raw, 10);
      if (
        !Number.isFinite(codePoint) ||
        codePoint < 0 ||
        codePoint > 0x10ffff
      ) {
        return "";
      }
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return "";
      }
    };

    const stripped = html
      .replace(/<head\b[^>]*>[\s\S]*?<\/head\b[^>]*>/gi, " ")
      .replace(/<title\b[^>]*>[\s\S]*?<\/title\b[^>]*>/gi, " ")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\b[^>]*>/gi, " ")
      .replace(/<template\b[^>]*>[\s\S]*?<\/template\b[^>]*>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(
        /<\/(article|aside|blockquote|div|figure|figcaption|footer|h[1-6]|header|li|main|nav|ol|p|section|table|tr|ul)>/gi,
        "\n",
      )
      .replace(/<li\b[^>]*>/gi, "\n• ")
      .replace(/<[^>]+>/g, " ");

    return stripped.replace(
      /&(#x?[0-9a-f]+|[a-z]+);/gi,
      (entity: string, rawEntity: string) => {
        const normalized = rawEntity.toLowerCase();
        if (normalized === "nbsp") return " ";
        if (normalized === "lt") return "<";
        if (normalized === "gt") return ">";
        if (normalized === "amp") return "&";
        if (normalized === "quot") return '"';
        if (normalized === "apos") return "'";
        if (normalized.startsWith("#")) {
          return decodeNumericEntity(normalized.slice(1));
        }
        return entity;
      },
    );
  }

  private static getHtmlDomParser(): DOMParser {
    if (!this.htmlDomParser) {
      this.htmlDomParser = new DOMParser();
    }
    return this.htmlDomParser;
  }

  private static elementTextStartsWithBullet(element: Element): boolean {
    return (element.textContent || "").trimStart().startsWith("• ");
  }

  private static getAttachmentSortTime(attachment: Zotero.Item): number {
    const timestamp = new Date(attachment.dateAdded || "").getTime();
    return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
  }
}
