import {
  EPUBExtractor,
  EPUBExtractionError,
} from "../src/modules/epubExtractor";
import { getString } from "../src/utils/locale";

/** Called only inside the isolated host-test profile with a generated EPUB fixture. */
export async function runEpubHostChecks(
  path: string,
  assert: (condition: boolean, label: string) => void,
): Promise<void> {
  const attachment = await Zotero.Attachments.importFromFile({ file: path });
  assert(
    EPUBExtractor.isEpubAttachment(attachment),
    "epubAttachmentRecognized",
  );
  if (typeof Zotero.Fulltext.indexEPUB !== "function") {
    assert(!EPUBExtractor.isSupported(), "epubUnsupportedSafe");
    let rejectedSafely = false;
    try {
      await EPUBExtractor.extractTextFromAttachment(attachment);
    } catch (error) {
      rejectedSafely =
        error instanceof EPUBExtractionError &&
        error.message === getString("epub-error-unavailable");
    }
    assert(rejectedSafely, "epubCompatibility");
    return;
  }

  assert(EPUBExtractor.isSupported(), "epubNativeModule");
  const text = await EPUBExtractor.extractTextFromAttachment(attachment);
  assert(
    text.includes("第一章") &&
      text.includes("FIRST_SECTION") &&
      text.indexOf("FIRST_SECTION") < text.indexOf("SECOND_SECTION") &&
      !text.includes("HIDDEN_STYLE") &&
      !text.includes("HIDDEN_SCRIPT"),
    "epubNativeExtraction",
  );
  assert(
    (await EPUBExtractor.extractTextFromAttachment(attachment)) === text,
    "epubCompatibility",
  );
}
