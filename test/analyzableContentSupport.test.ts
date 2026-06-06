import { expect } from "chai";
import { ContentExtractor } from "../src/modules/contentExtractor";
import LLMService from "../src/modules/llmService";
import { LiteratureReviewService } from "../src/modules/literatureReviewService";
import { NoteGenerator } from "../src/modules/noteGenerator";
import { PDFExtractor } from "../src/modules/pdfExtractor";
import { SnapshotExtractor } from "../src/modules/snapshotExtractor";
import {
  TaskQueueManager,
  TaskStatus,
  type TaskItem,
} from "../src/modules/taskQueue";
import type { LLMProviderCapabilities } from "../src/modules/llmproviders/types";

type QueueInternals = {
  tasks: Map<string, TaskItem>;
  processingTasks: Set<string>;
  abortingTasks: Set<string>;
  taskAbortControllers: Map<string, unknown>;
  executeTask(taskId: string): Promise<boolean>;
  saveToStorage(): Promise<void>;
  notifyComplete(): void;
  notifyProgress(): void;
  notifyStream(): void;
  maybeAutoTriggerImageSummary(): void;
};

function createTask(status: TaskStatus = TaskStatus.PENDING): TaskItem {
  return {
    id: "task-1",
    itemId: 1,
    title: "Snapshot Paper",
    status,
    progress: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    retryCount: 0,
    maxRetries: 3,
    taskType: "summary",
  };
}

function createQueueInternals(task: TaskItem): QueueInternals {
  const manager = Object.create(TaskQueueManager.prototype) as QueueInternals;
  manager.tasks = new Map([[task.id, task]]);
  manager.processingTasks = new Set();
  manager.abortingTasks = new Set();
  manager.taskAbortControllers = new Map();
  manager.saveToStorage = async () => {};
  manager.notifyComplete = () => {};
  manager.notifyProgress = () => {};
  manager.notifyStream = () => {};
  manager.maybeAutoTriggerImageSummary = () => {};
  return manager;
}

describe("analyzable content source support", function () {
  describe("ContentExtractor and SnapshotExtractor", function () {
    let originalGetAsync: typeof Zotero.Items.getAsync;
    let originalHasPDFAttachment: typeof PDFExtractor.hasPDFAttachment;
    let originalExtractBase64FromItem: typeof PDFExtractor.extractBase64FromItem;
    let originalExtractTextFromItem: typeof PDFExtractor.extractTextFromItem;
    let originalExtractTextFromAttachment: typeof PDFExtractor.extractTextFromAttachment;
    let originalHasWebSnapshotAttachment: typeof SnapshotExtractor.hasWebSnapshotAttachment;
    let originalGetOldestWebSnapshotAttachment: typeof SnapshotExtractor.getOldestWebSnapshotAttachment;
    let originalExtractTextFromWebSnapshot: typeof SnapshotExtractor.extractTextFromWebSnapshot;
    const olderSnapshotPath = "/tmp/zotero-ai-butler-older.xhtml";

    beforeEach(function () {
      originalGetAsync = Zotero.Items.getAsync;
      originalHasPDFAttachment = PDFExtractor.hasPDFAttachment;
      originalExtractBase64FromItem = PDFExtractor.extractBase64FromItem;
      originalExtractTextFromItem = PDFExtractor.extractTextFromItem;
      originalExtractTextFromAttachment =
        PDFExtractor.extractTextFromAttachment;
      originalHasWebSnapshotAttachment =
        SnapshotExtractor.hasWebSnapshotAttachment;
      originalGetOldestWebSnapshotAttachment =
        SnapshotExtractor.getOldestWebSnapshotAttachment;
      originalExtractTextFromWebSnapshot =
        SnapshotExtractor.extractTextFromWebSnapshot;
    });

    afterEach(async function () {
      Zotero.Items.getAsync = originalGetAsync;
      PDFExtractor.hasPDFAttachment = originalHasPDFAttachment;
      PDFExtractor.extractBase64FromItem = originalExtractBase64FromItem;
      PDFExtractor.extractTextFromItem = originalExtractTextFromItem;
      PDFExtractor.extractTextFromAttachment =
        originalExtractTextFromAttachment;
      SnapshotExtractor.hasWebSnapshotAttachment =
        originalHasWebSnapshotAttachment;
      SnapshotExtractor.getOldestWebSnapshotAttachment =
        originalGetOldestWebSnapshotAttachment;
      SnapshotExtractor.extractTextFromWebSnapshot =
        originalExtractTextFromWebSnapshot;
      await Zotero.File.removeIfExists(olderSnapshotPath);
    });

    it("uses the selected web snapshot content source and extracts readable text", async function () {
      const attachments = new Map<number, Zotero.Item>();

      const olderSnapshot = {
        id: 1,
        dateAdded: "2024-01-01T00:00:00Z",
        attachmentContentType: "",
        getField: () => "Older Snapshot",
        getFilePathAsync: async () => olderSnapshotPath,
      } as Zotero.Item;
      const newerSnapshot = {
        id: 2,
        dateAdded: "2024-02-01T00:00:00Z",
        attachmentContentType: "text/html",
        getField: () => "Newer Snapshot",
        getFilePathAsync: async () => "/tmp/newer.html",
      } as Zotero.Item;
      attachments.set(1, olderSnapshot);
      attachments.set(2, newerSnapshot);

      const item = {
        getAttachments: () => [2, 1],
      } as Zotero.Item;

      Zotero.Items.getAsync = (async (id: number) =>
        attachments.get(id)) as any;

      await Zotero.File.putContentsAsync(
        olderSnapshotPath,
        `
          <html>
            <head>
              <title>ignore me</title>
              <script>ignore me</script>
            </head>
            <body>
              <h1>Older &amp; Better</h1>
              <p>Hello snapshot.</p>
              <ul><li>First point</li></ul>
            </body>
          </html>
        `,
      );

      expect(await SnapshotExtractor.hasWebSnapshotAttachment(item)).to.equal(
        true,
      );
      expect(await ContentExtractor.hasAnalyzableAttachment(item)).to.equal(
        true,
      );

      const text = await ContentExtractor.extractTextFromItem(item);

      expect(text).to.contain("Older & Better");
      expect(text).to.contain("Hello snapshot.");
      expect(text).to.contain("First point");
      expect(text).not.to.contain("ignore me");
      expect(text).not.to.contain("Newer Snapshot");

      const analyzable =
        await ContentExtractor.getAllAnalyzableAttachments(item);
      expect(analyzable.map((att) => att.id)).to.deep.equal([1]);
    });

    it("resolves snapshot text when base64 is preferred but no PDF exists", async function () {
      PDFExtractor.hasPDFAttachment = async () => false;
      PDFExtractor.extractBase64FromItem = async () => {
        throw new Error("should not read PDF base64");
      };
      SnapshotExtractor.hasWebSnapshotAttachment = async () => true;
      SnapshotExtractor.getOldestWebSnapshotAttachment = async () =>
        ({
          id: 1,
          dateAdded: "2024-01-01T00:00:00Z",
          getField: () => "Snapshot",
        }) as Zotero.Item;
      SnapshotExtractor.extractTextFromWebSnapshot = async () =>
        "Snapshot source text";

      const result = await ContentExtractor.extractAnalyzableContentFromItem(
        {} as Zotero.Item,
        true,
      );

      expect(result).to.deep.equal({
        content: "Snapshot source text",
        isBase64: false,
      });
    });

    it("prefers PDF attachments over web snapshots for analyzable attachment lists", async function () {
      const attachments = new Map<number, Zotero.Item>();
      const pdf = {
        id: 1,
        dateAdded: "2024-02-01T00:00:00Z",
        attachmentContentType: "application/pdf",
      } as Zotero.Item;
      const snapshot = {
        id: 2,
        dateAdded: "2024-01-01T00:00:00Z",
        attachmentContentType: "text/html",
        getFilePathAsync: async () => "/tmp/snapshot.html",
      } as Zotero.Item;
      attachments.set(1, pdf);
      attachments.set(2, snapshot);
      Zotero.Items.getAsync = (async (id: number) =>
        attachments.get(id)) as any;

      const item = {
        getAttachments: () => [2, 1],
      } as Zotero.Item;

      const analyzable =
        await ContentExtractor.getAllAnalyzableAttachments(item);

      expect(analyzable.map((att) => att.id)).to.deep.equal([1]);
    });
  });

  describe("LLMService", function () {
    let originalHasPDFAttachment: typeof PDFExtractor.hasPDFAttachment;
    let originalHasWebSnapshotAttachment: typeof SnapshotExtractor.hasWebSnapshotAttachment;
    let originalExtractTextFromItem: typeof ContentExtractor.extractTextFromItem;
    let originalExtractBase64FromItem: typeof PDFExtractor.extractBase64FromItem;
    let originalExtractTextFromAnalyzableAttachment: typeof ContentExtractor.extractTextFromAnalyzableAttachment;

    beforeEach(function () {
      originalHasPDFAttachment = PDFExtractor.hasPDFAttachment;
      originalHasWebSnapshotAttachment =
        SnapshotExtractor.hasWebSnapshotAttachment;
      originalExtractTextFromItem = ContentExtractor.extractTextFromItem;
      originalExtractBase64FromItem = PDFExtractor.extractBase64FromItem;
      originalExtractTextFromAnalyzableAttachment =
        ContentExtractor.extractTextFromAnalyzableAttachment;
    });

    afterEach(function () {
      PDFExtractor.hasPDFAttachment = originalHasPDFAttachment;
      SnapshotExtractor.hasWebSnapshotAttachment =
        originalHasWebSnapshotAttachment;
      ContentExtractor.extractTextFromItem = originalExtractTextFromItem;
      PDFExtractor.extractBase64FromItem = originalExtractBase64FromItem;
      ContentExtractor.extractTextFromAnalyzableAttachment =
        originalExtractTextFromAnalyzableAttachment;
    });

    it("resolves a text content source when pdf-base64 is requested without a PDF", async function () {
      PDFExtractor.hasPDFAttachment = async () => false;
      SnapshotExtractor.hasWebSnapshotAttachment = async () => true;
      ContentExtractor.extractTextFromItem = async () => "Snapshot source text";
      PDFExtractor.extractBase64FromItem = async () => {
        throw new Error("should not read PDF base64");
      };

      const warnings: string[] = [];
      const capabilities: LLMProviderCapabilities = {
        supportsText: true,
        supportsStreaming: true,
        supportsPdfBase64: true,
        maxPdfFiles: 1,
        supportsSystemPrompt: true,
        supportedParams: [],
      };

      const resolved = await (LLMService as any).resolveZoteroItemContent(
        {} as any,
        { kind: "zotero-item", item: {} as Zotero.Item },
        "pdf-base64",
        capabilities,
        warnings,
        true,
      );

      expect(resolved).to.deep.include({
        mode: "single",
        content: "Snapshot source text",
        isBase64: false,
      });
      expect(warnings).to.deep.equal(["已使用网页快照文本作为本次分析内容。"]);
    });

    it("uses text for web snapshot attachment inputs even when pdf-base64 is requested", async function () {
      ContentExtractor.extractTextFromAnalyzableAttachment = async () =>
        "Snapshot attachment text";

      const warnings: string[] = [];
      const resolved = await (LLMService as any).resolvePdfAttachmentContent(
        {
          kind: "pdf-attachment",
          attachment: {
            attachmentContentType: "text/html",
            getFilePathAsync: async () => "/tmp/snapshot.html",
          } as Zotero.Item,
        },
        "pdf-base64",
        warnings,
      );

      expect(resolved).to.deep.include({
        mode: "single",
        content: "Snapshot attachment text",
        isBase64: false,
      });
      expect(warnings).to.deep.equal(["当前附件将按文本内容进行分析。"]);
    });
  });

  describe("LiteratureReviewService", function () {
    let originalIsPdfAttachment: typeof PDFExtractor.isPdfAttachment;
    let originalExtractTextFromAnalyzableAttachment: typeof ContentExtractor.extractTextFromAnalyzableAttachment;
    let originalGenerateText: typeof LLMService.generateText;

    beforeEach(function () {
      originalIsPdfAttachment = PDFExtractor.isPdfAttachment;
      originalExtractTextFromAnalyzableAttachment =
        ContentExtractor.extractTextFromAnalyzableAttachment;
      originalGenerateText = LLMService.generateText;
    });

    afterEach(function () {
      PDFExtractor.isPdfAttachment = originalIsPdfAttachment;
      ContentExtractor.extractTextFromAnalyzableAttachment =
        originalExtractTextFromAnalyzableAttachment;
      LLMService.generateText = originalGenerateText;
    });

    it("extracts web snapshot source contents as text instead of base64", async function () {
      PDFExtractor.isPdfAttachment = () => false;
      ContentExtractor.extractTextFromAnalyzableAttachment = async () =>
        "Snapshot literature review text";

      const contents =
        await LiteratureReviewService.extractSourceContentsFromAttachments([
          {
            id: 1,
            getField: () => "Snapshot Attachment",
            getFilePathAsync: async () => "/tmp/snapshot.xhtml",
          } as Zotero.Item,
        ]);

      expect(contents).to.have.length(1);
      expect(contents[0]).to.deep.include({
        title: "Snapshot Attachment",
        filePath: "/tmp/snapshot.xhtml",
        content: "Snapshot literature review text",
        isBase64: false,
      });
    });

    it("uses text content for multi-source summaries when any source is not base64", async function () {
      let capturedRequest: any = null;
      LLMService.generateText = (async (request: any) => {
        capturedRequest = request;
        return "Generated review";
      }) as any;

      const result =
        await LiteratureReviewService.generateSummaryFromMultipleSources(
          [
            {
              title: "PDF Paper",
              filePath: "/tmp/paper.pdf",
              content: "JVBERi0x",
              isBase64: true,
            },
            {
              title: "Snapshot Paper",
              filePath: "/tmp/snapshot.xhtml",
              content: "Snapshot readable text",
              isBase64: false,
            },
          ],
          "Write a review",
        );

      expect(result).to.equal("Generated review");
      expect(capturedRequest.content).to.deep.include({
        kind: "text",
        policy: "text",
      });
      expect(capturedRequest.content.text).to.contain("Snapshot Paper");
      expect(capturedRequest.content.text).to.contain("Snapshot readable text");
      expect(capturedRequest.content.text).to.contain("PDF Paper");
      expect(capturedRequest.content.text).not.to.contain("JVBERi0x");
    });
  });

  describe("TaskQueueManager", function () {
    let originalGetAsync: typeof Zotero.Items.getAsync;
    let originalHasAnalyzableAttachment: typeof ContentExtractor.hasAnalyzableAttachment;
    let originalGetAllAnalyzableAttachments: typeof ContentExtractor.getAllAnalyzableAttachments;
    let originalGenerateNoteForItem: typeof NoteGenerator.generateNoteForItem;
    let originalFillTableForSingleAttachment: typeof LiteratureReviewService.fillTableForSingleAttachment;
    let originalSaveTableNote: typeof LiteratureReviewService.saveTableNote;

    beforeEach(function () {
      originalGetAsync = Zotero.Items.getAsync;
      originalHasAnalyzableAttachment =
        ContentExtractor.hasAnalyzableAttachment;
      originalGetAllAnalyzableAttachments =
        ContentExtractor.getAllAnalyzableAttachments;
      originalGenerateNoteForItem = NoteGenerator.generateNoteForItem;
      originalFillTableForSingleAttachment =
        LiteratureReviewService.fillTableForSingleAttachment;
      originalSaveTableNote = LiteratureReviewService.saveTableNote;
    });

    afterEach(function () {
      Zotero.Items.getAsync = originalGetAsync;
      ContentExtractor.hasAnalyzableAttachment =
        originalHasAnalyzableAttachment;
      ContentExtractor.getAllAnalyzableAttachments =
        originalGetAllAnalyzableAttachments;
      NoteGenerator.generateNoteForItem = originalGenerateNoteForItem;
      LiteratureReviewService.fillTableForSingleAttachment =
        originalFillTableForSingleAttachment;
      LiteratureReviewService.saveTableNote = originalSaveTableNote;
    });

    it("allows summary tasks to proceed when a web snapshot is analyzable", async function () {
      const task = createTask();
      const manager = createQueueInternals(task);
      let generateCalled = false;

      Zotero.Items.getAsync = (async () => ({ id: 1 }) as Zotero.Item) as any;
      ContentExtractor.hasAnalyzableAttachment = async () => true;
      NoteGenerator.generateNoteForItem = (async () => {
        generateCalled = true;
      }) as any;

      const quickFail = await manager.executeTask(task.id);

      expect(quickFail).to.equal(false);
      expect(generateCalled).to.equal(true);
      expect(task.status).to.equal(TaskStatus.COMPLETED);
    });

    it("fails fast with the new analyzable-attachment error message", async function () {
      const task = createTask();
      const manager = createQueueInternals(task);
      let generateCalled = false;

      Zotero.Items.getAsync = (async () => ({ id: 1 }) as Zotero.Item) as any;
      ContentExtractor.hasAnalyzableAttachment = async () => false;
      NoteGenerator.generateNoteForItem = (async () => {
        generateCalled = true;
      }) as any;

      const quickFail = await manager.executeTask(task.id);

      expect(quickFail).to.equal(true);
      expect(generateCalled).to.equal(false);
      expect(task.status).to.equal(TaskStatus.FAILED);
      expect(task.error).to.equal(
        "该条目没有可分析附件，无法进行 AI 分析。请先为该文献添加 PDF 文件、网页快照或其他支持的内容源。",
      );
    });

    it("allows table-fill tasks to use a web snapshot attachment", async function () {
      const task = {
        ...createTask(),
        id: "table-task-1",
        taskType: "tableFill" as const,
      };
      const manager = createQueueInternals(task);
      const item = {
        id: 1,
        getField: () => "Snapshot Paper",
      } as Zotero.Item;
      const snapshot = {
        id: 2,
        parentID: 1,
        attachmentContentType: "text/html",
      } as Zotero.Item;
      let fillAttachment: Zotero.Item | null = null;
      let savedTable = "";

      Zotero.Items.getAsync = (async () => item) as any;
      ContentExtractor.getAllAnalyzableAttachments = async () => [snapshot];
      LiteratureReviewService.fillTableForSingleAttachment = (async (
        _item,
        attachment,
      ) => {
        fillAttachment = attachment;
        return "| 维度 | 内容 |\n|---|---|\n| 快照 | 支持 |";
      }) as any;
      LiteratureReviewService.saveTableNote = (async (_item, table) => {
        savedTable = table;
        return {} as Zotero.Item;
      }) as any;

      await (manager as any).executeTableFillTask(task.id);

      expect(fillAttachment).to.equal(snapshot);
      expect(savedTable).to.contain("快照");
      expect(task.status).to.equal(TaskStatus.COMPLETED);
    });
  });
});
