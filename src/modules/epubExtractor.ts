import { getString } from "../utils/locale";
import type { LLMAbortSignal } from "./llmproviders/types";
import { throwIfAborted } from "./llmproviders/shared/requestAbort";

interface NativeEPUB {
  getSectionDocuments(): AsyncIterable<{ href: string; doc: Document }>;
  close(): void;
}

type NativeEPUBConstructor = {
  new (path: string): NativeEPUB;
  prototype: NativeEPUB;
};

type EPUBModuleLoader = {
  importESModule?: (uri: string) => { EPUB?: unknown };
  import?: (uri: string) => { EPUB?: unknown };
};

export class EPUBExtractionError extends Error {
  public readonly suppressTaskRetry = true;

  constructor(message: string) {
    super(message);
    this.name = "EPUBExtractionError";
  }
}

/** Read EPUB sections with Zotero's native parser, without opening a reader or indexing the library. */
export class EPUBExtractor {
  private static nativeEPUB: NativeEPUBConstructor | null | undefined;

  public static isSupported(): boolean {
    return this.getNativeEPUB() !== null;
  }

  public static isEpubAttachment(attachment: Zotero.Item): boolean {
    if (!attachment?.isAttachment?.()) return false;
    if (
      typeof attachment.isFileAttachment === "function" &&
      !attachment.isFileAttachment()
    ) {
      return false;
    }
    // Do not require isEPUBAttachment(), which is absent on older Zotero hosts.
    return (
      String(attachment.attachmentContentType || "").toLowerCase() ===
        "application/epub+zip" ||
      String(attachment.attachmentFilename || "")
        .toLowerCase()
        .endsWith(".epub")
    );
  }

  public static async getOldestEpubAttachment(
    item: Zotero.Item,
  ): Promise<Zotero.Item | null> {
    const attachments = await Promise.all(
      (item.getAttachments?.() || []).map((id) => Zotero.Items.getAsync(id)),
    );
    const epubAttachments = attachments.filter(
      (attachment): attachment is Zotero.Item =>
        !!attachment && this.isEpubAttachment(attachment),
    );
    const addedAt = (attachment: Zotero.Item) => {
      const time = new Date(attachment.dateAdded || "").getTime();
      return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
    };
    epubAttachments.sort((a, b) => addedAt(a) - addedAt(b) || a.id - b.id);
    return epubAttachments[0] || null;
  }

  public static async extractTextFromAttachment(
    attachment: Zotero.Item,
    abortSignal?: LLMAbortSignal,
  ): Promise<string> {
    throwIfAborted(abortSignal);
    if (!this.isEpubAttachment(attachment)) {
      throw new EPUBExtractionError(getString("epub-error-not-epub"));
    }
    const NativeReader = this.getNativeEPUB();
    if (!NativeReader) {
      throw new EPUBExtractionError(getString("epub-error-unavailable"));
    }

    let reader: NativeEPUB | undefined;
    const sections: string[] = [];
    try {
      const path =
        (await attachment.getFilePathAsync?.()) || attachment.getFilePath?.();
      throwIfAborted(abortSignal);
      const exists =
        path &&
        (typeof IOUtils === "undefined" || (await IOUtils.exists(path)));
      throwIfAborted(abortSignal);
      if (!path || !exists) {
        throw new EPUBExtractionError(getString("epub-error-file-unavailable"));
      }
      reader = new NativeReader(path);
      // Zotero follows the EPUB spine, not ZIP entry or filename order.
      for await (const { doc } of reader.getSectionDocuments()) {
        throwIfAborted(abortSignal);
        const body = doc.body;
        if (!body) continue;
        body
          .querySelectorAll("script, style, noscript, template")
          .forEach((node: Element) => node.remove());
        const text = (body.innerText || body.textContent || "").trim();
        if (text) sections.push(text);
      }
      throwIfAborted(abortSignal);
    } catch (error) {
      throwIfAborted(abortSignal);
      if (error instanceof EPUBExtractionError) throw error;
      throw new EPUBExtractionError(
        getString("epub-error-extraction-failed", {
          args: {
            message: error instanceof Error ? error.message : String(error),
          },
        }),
      );
    } finally {
      if (reader) {
        try {
          reader.close();
        } catch (error) {
          ztoolkit.log(
            "[EPUBExtractor] Failed to close native EPUB reader:",
            error,
          );
        }
      }
    }

    const text = sections.join("\n\n");
    if (!text) {
      throw new EPUBExtractionError(getString("epub-error-no-readable-text"));
    }
    return text;
  }

  private static getNativeEPUB(): NativeEPUBConstructor | null {
    if (this.nativeEPUB !== undefined) return this.nativeEPUB;
    this.nativeEPUB = null;
    // Zotero 6 has no EPUB support. Probe a native capability before importing
    // optional chrome modules; never load them during plugin initialization.
    if (
      typeof Zotero.Fulltext?.indexEPUB !== "function" ||
      typeof ChromeUtils === "undefined"
    ) {
      return null;
    }

    const loader = ChromeUtils as unknown as EPUBModuleLoader;
    const loadModules = [
      () => loader.importESModule?.("chrome://zotero/content/EPUB.mjs"),
      () => loader.import?.("chrome://zotero/content/EPUB.jsm"),
    ];
    for (const load of loadModules) {
      try {
        const Reader = load()?.EPUB as NativeEPUBConstructor | undefined;
        if (
          typeof Reader === "function" &&
          typeof Reader.prototype?.getSectionDocuments === "function" &&
          typeof Reader.prototype?.close === "function"
        ) {
          this.nativeEPUB = Reader;
          break;
        }
      } catch {
        // Zotero 7 uses JSM; newer hosts use ESM. Either module may be absent.
      }
    }
    if (!this.nativeEPUB) {
      ztoolkit.log(
        "[EPUBExtractor] Native EPUB module unavailable; EPUB analysis disabled.",
      );
    }
    return this.nativeEPUB;
  }
}
