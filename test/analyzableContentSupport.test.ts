import { expect } from "chai";
import { ContentExtractor } from "../src/modules/contentExtractor";
import { PDFExtractor } from "../src/modules/pdfExtractor";
import { SnapshotExtractor } from "../src/modules/snapshotExtractor";

function getTempPath(fileName: string): string {
  const os = (globalThis as any).OS;
  const pathUtils = (globalThis as any).PathUtils;
  const tmpDir = os?.Constants?.Path?.tmpDir || os?.Constants?.Path?.profileDir;
  if (pathUtils?.join && tmpDir) {
    return pathUtils.join(tmpDir, fileName);
  }
  return fileName;
}

describe("analyzable content source support", function () {
  let originalGetAsync: typeof Zotero.Items.getAsync;
  let originalHasPDFAttachment: typeof PDFExtractor.hasPDFAttachment;
  let originalGetAllPdfAttachments: typeof PDFExtractor.getAllPdfAttachments;
  let originalExtractBase64FromItem: typeof PDFExtractor.extractBase64FromItem;
  let originalExtractTextFromItem: typeof PDFExtractor.extractTextFromItem;
  let originalExtractTextFromAttachment: typeof PDFExtractor.extractTextFromAttachment;
  let originalGetContentsAsync: typeof Zotero.File.getContentsAsync;
  let snapshotPath: string;

  beforeEach(function () {
    snapshotPath = getTempPath("zotero-ai-butler-snapshot-test.xhtml");
    originalGetAsync = Zotero.Items.getAsync;
    originalHasPDFAttachment = PDFExtractor.hasPDFAttachment;
    originalGetAllPdfAttachments = PDFExtractor.getAllPdfAttachments;
    originalExtractBase64FromItem = PDFExtractor.extractBase64FromItem;
    originalExtractTextFromItem = PDFExtractor.extractTextFromItem;
    originalExtractTextFromAttachment = PDFExtractor.extractTextFromAttachment;
    originalGetContentsAsync = Zotero.File.getContentsAsync;
  });

  afterEach(async function () {
    Zotero.Items.getAsync = originalGetAsync;
    PDFExtractor.hasPDFAttachment = originalHasPDFAttachment;
    PDFExtractor.getAllPdfAttachments = originalGetAllPdfAttachments;
    PDFExtractor.extractBase64FromItem = originalExtractBase64FromItem;
    PDFExtractor.extractTextFromItem = originalExtractTextFromItem;
    PDFExtractor.extractTextFromAttachment = originalExtractTextFromAttachment;
    Zotero.File.getContentsAsync = originalGetContentsAsync;
    try {
      await Zotero.File.removeIfExists(snapshotPath);
    } catch {
      // Ignore cleanup failures in platform-specific Zotero test profiles.
    }
  });

  it("uses the oldest web snapshot when no PDF exists", async function () {
    const attachments = new Map<number, Zotero.Item>();
    const olderSnapshot = {
      id: 1,
      dateAdded: "2024-01-01T00:00:00Z",
      attachmentContentType: "",
      isAttachment: () => true,
      getField: () => "Older Snapshot",
      getFilePathAsync: async () => snapshotPath,
    } as Zotero.Item;
    const newerSnapshot = {
      id: 2,
      dateAdded: "2024-02-01T00:00:00Z",
      attachmentContentType: "text/html",
      isAttachment: () => true,
      getField: () => "Newer Snapshot",
      getFilePathAsync: async () => getTempPath("zotero-ai-butler-newer.html"),
    } as Zotero.Item;
    attachments.set(1, olderSnapshot);
    attachments.set(2, newerSnapshot);

    const item = { getAttachments: () => [2, 1] } as Zotero.Item;
    Zotero.Items.getAsync = (async (id: number) => attachments.get(id)) as any;
    PDFExtractor.getAllPdfAttachments = async () => [];
    PDFExtractor.hasPDFAttachment = async () => false;

    Zotero.File.getContentsAsync = (async () =>
      "<html><head><title>ignore me</title><script>ignore()</script></head><body><h1>Older &amp; Better</h1><p>Hello snapshot.</p><ul><li>First point</li></ul></body></html>") as any;

    expect(await SnapshotExtractor.hasWebSnapshotAttachment(item)).to.equal(
      true,
    );
    expect(await ContentExtractor.hasAnalyzableAttachment(item)).to.equal(true);

    const extracted = await ContentExtractor.extractAnalyzableContentFromItem(
      item,
      true,
      "base64",
    );

    expect(extracted.kind).to.equal("web-snapshot");
    expect(extracted.isBase64).to.equal(false);
    expect(extracted.content).to.contain("Older & Better");
    expect(extracted.content).to.contain("Hello snapshot.");
    expect(extracted.content).to.contain("First point");
    expect(extracted.content).not.to.contain("ignore me");

    const analyzable =
      await ContentExtractor.getPreferredAnalyzableAttachments(item);
    expect(analyzable.map((att) => att.id)).to.deep.equal([1]);
  });

  it("keeps PDF priority when a PDF exists", async function () {
    const pdf = {
      id: 10,
      dateAdded: "2024-03-01T00:00:00Z",
      attachmentContentType: "application/pdf",
      isAttachment: () => true,
      getField: () => "PDF",
      getFilePathAsync: async () => getTempPath("paper.pdf"),
    } as Zotero.Item;
    const item = { getAttachments: () => [10] } as Zotero.Item;

    PDFExtractor.getAllPdfAttachments = async () => [pdf];
    PDFExtractor.hasPDFAttachment = async () => true;
    PDFExtractor.extractBase64FromItem = async () => "PDF_BASE64";
    PDFExtractor.extractTextFromItem = async () => "PDF_TEXT";

    const preferred =
      await ContentExtractor.getPreferredAnalyzableAttachments(item);
    expect(preferred.map((att) => att.id)).to.deep.equal([10]);

    const base64 = await ContentExtractor.extractAnalyzableContentFromItem(
      item,
      true,
      "base64",
    );
    expect(base64).to.include({
      content: "PDF_BASE64",
      isBase64: true,
      kind: "pdf",
    });

    const text = await ContentExtractor.extractAnalyzableContentFromItem(
      item,
      false,
      "text",
    );
    expect(text).to.include({
      content: "PDF_TEXT",
      isBase64: false,
      kind: "pdf",
    });
  });
});
