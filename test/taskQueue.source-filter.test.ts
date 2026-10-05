import { expect } from "chai";
import { config } from "../package.json";
import {
  TaskQueueManager,
  TaskStatus,
  getDeepReadTaskId,
  getSummaryTaskId,
  type TaskItem,
} from "../src/modules/taskQueue";
import { TaskArtifacts } from "../src/modules/taskArtifacts";
import { AiNoteService, type AiNoteKind } from "../src/modules/aiNoteService";
import { ContentExtractor } from "../src/modules/contentExtractor";
import { LibraryScannerView } from "../src/modules/views/LibraryScannerView";
import { MainWindow } from "../src/modules/views/MainWindow";

type QueueFixture = Pick<TaskQueueManager, keyof TaskQueueManager> & {
  tasks: Map<string, TaskItem>;
  deletedFixedTasks: Map<string, unknown>;
  activeEnqueueBatches: number;
};

type ScannerFixture = {
  collectUnprocessedItems(
    ids: number[],
    library: string,
    scanId: number,
  ): Promise<Map<number, Zotero.Item>>;
  handleConfirm(): Promise<void>;
};

describe("Task source filtering (#418)", function () {
  const globals = globalThis as unknown as Record<string, unknown>;
  const queuePref = "extensions.zotero.aibutler.taskQueue";
  let previous: Record<string, unknown>;
  let originalProbe: typeof TaskArtifacts.probe;
  let originalHasNote: typeof AiNoteService.hasNote;
  let originalMainWindow: typeof MainWindow.getInstance;
  let items: Map<number, Zotero.Item>;
  let files: Set<string>;
  let prefs: Map<string, unknown>;
  let writes: number;
  let starts: number;
  let notices: Array<{ text: string; type: string }>;
  let tabs: string[];
  let probed: number[];

  beforeEach(function () {
    previous = Object.fromEntries(
      ["Zotero", "addon", "ztoolkit", "IOUtils"].map((key) => [
        key,
        globals[key],
      ]),
    );
    originalProbe = TaskArtifacts.probe;
    originalHasNote = AiNoteService.hasNote;
    originalMainWindow = MainWindow.getInstance;
    items = new Map();
    files = new Set();
    prefs = new Map([[`${config.prefsPrefix}.noteStrategy`, "skip"]]);
    writes = 0;
    starts = 0;
    notices = [];
    tabs = [];
    probed = [];
    globals.Zotero = {
      Items: { getAsync: async (id: number) => items.get(id) },
      Prefs: {
        get: (key: string) => prefs.get(key),
        set(key: string, value: unknown) {
          prefs.set(key, value);
          if (key === queuePref) writes++;
        },
      },
    };
    globals.IOUtils = { exists: async (path: string) => files.has(path) };
    globals.addon = {
      data: {
        locale: {
          current: {
            formatMessagesSync: (
              requests: Array<{ id: string; args?: Record<string, unknown> }>,
            ) =>
              requests.map(({ id, args }) => ({
                value: `${id} ${JSON.stringify(args || {})}`,
              })),
          },
        },
      },
    };
    globals.ztoolkit = {
      log() {},
      ProgressWindow: class {
        createLine(line: { text: string; type: string }) {
          notices.push(line);
          return this;
        }
        show() {
          return this;
        }
      },
    };
    TaskArtifacts.probe = async (_type, item) => {
      probed.push(item.id);
      return { exists: false };
    };
    AiNoteService.hasNote = async () => false;
    MainWindow.getInstance = () =>
      ({ switchTab: (tab: string) => tabs.push(tab) }) as unknown as MainWindow;
  });

  afterEach(function () {
    TaskArtifacts.probe = originalProbe;
    AiNoteService.hasNote = originalHasNote;
    MainWindow.getInstance = originalMainWindow;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globals[key];
      else globals[key] = value;
    }
  });

  function paper(id: number, attachmentIDs: number[] = []): Zotero.Item {
    const item = {
      id,
      isRegularItem: () => true,
      getField: () => `Paper ${id}`,
      getAttachments: () => attachmentIDs,
    } as unknown as Zotero.Item;
    items.set(id, item);
    return item;
  }

  function attachment(
    id: number,
    contentType: string,
    path: string,
    available = true,
  ): number {
    items.set(id, {
      id,
      dateAdded: "2026-01-01T00:00:00Z",
      attachmentContentType: contentType,
      isAttachment: () => true,
      // Zotero can return a file handle even after its local file is deleted.
      getFile: () => (path ? { path } : false),
      getFilePathAsync: async () => path,
    } as unknown as Zotero.Item);
    if (available && path) files.add(path);
    return id;
  }

  function mixedItems(): Zotero.Item[] {
    return [
      paper(1, [attachment(101, "application/pdf", "paper.pdf")]),
      paper(2),
      paper(3, [attachment(103, "image/png", "image.png")]),
      paper(4, [attachment(104, "application/pdf", "missing.pdf", false)]),
      paper(5, [attachment(105, "text/html", "snapshot.html")]),
      paper(6, [attachment(106, "text/html", "")]),
      paper(7, [attachment(107, "", "snapshot.xhtml")]),
      paper(8, [attachment(108, "text/html", "missing.html", false)]),
    ];
  }

  function queue(): QueueFixture {
    return Object.assign(Object.create(TaskQueueManager.prototype), {
      tasks: new Map(),
      processingTasks: new Set(),
      taskAbortControllers: new Map(),
      abortingTasks: new Set(),
      progressCallbacks: new Set(),
      completeCallbacks: new Set(),
      streamCallbacks: new Set(),
      deletedFixedTasks: new Map(),
      clearedDeletedFixedTaskKeys: new Set(),
      activeEnqueueBatches: 0,
      lastLoadedSnapshotAt: null,
      isRunning: false,
      isBatchRunning: false,
      start() {
        starts++;
        this.isRunning = true;
      },
      async executeTask() {
        throw new Error("Source filtering must not execute tasks in tests");
      },
    }) as QueueFixture;
  }

  function scanner(
    target: AiNoteKind,
    manager: QueueFixture,
    selectedItems: Zotero.Item[] = [],
  ): ScannerFixture {
    return Object.assign(Object.create(LibraryScannerView.prototype), {
      scanTarget: target,
      activeScanId: 1,
      taskQueueManager: manager,
      isEnqueuing: false,
      selectedCountElement: null,
      treeRoot: selectedItems.map((item) => ({
        type: "item",
        checked: true,
        children: [],
        item,
      })),
      getLoadedItem: async (id: number) => items.get(id),
      getConfirmButton: () => null,
      setInfo() {},
      async yieldToUI() {},
      log() {},
    }) as ScannerFixture;
  }

  for (const target of ["summary", "deepRead"] as const) {
    const summaryMode = target === "summary" ? "single" : "deepRead";
    const taskID = target === "summary" ? getSummaryTaskId : getDeepReadTaskId;

    it(`scans only usable sources missing ${target} notes`, async function () {
      const candidates = mixedItems();
      const checkedNotes: number[] = [];
      AiNoteService.hasNote = async (item, kind) => {
        checkedNotes.push(item.id);
        return item.id === 1 && kind === target;
      };
      const result = await scanner(target, queue()).collectUnprocessedItems(
        candidates.map((item) => item.id),
        "Library",
        1,
      );

      expect([...result.keys()]).to.deep.equal([5, 7]);
      expect(checkedNotes).not.to.include(2);
    });

    it(`filters a mixed ${target} batch before artifact checks and saves once`, async function () {
      const manager = queue();
      const ids = await manager.addTasks(mixedItems(), false, { summaryMode });

      expect(ids).to.deep.equal([1, 5, 7].map(taskID));
      expect(manager.getAllTasks().map((task) => task.itemId)).to.have.members([
        1, 5, 7,
      ]);
      expect(probed).to.deep.equal([1, 5, 7]);
      expect(writes).to.equal(1);
      expect(starts).to.equal(1);
      expect(manager.activeEnqueueBatches).to.equal(0);
    });

    it(`rejects a single ${target} source before mutating queue or deletion markers`, async function () {
      const manager = queue();
      const key = `2:${target}`;
      const deleted = {
        key,
        itemId: 2,
        taskType: target,
        deletedAt: "2026-01-01T00:00:00Z",
      };
      manager.deletedFixedTasks.set(key, deleted);
      const source = paper(2);
      let failure: unknown;
      try {
        if (target === "summary") await manager.addTask(source);
        else await manager.addDeepReadTask(source);
      } catch (error) {
        failure = error;
      }

      expect(failure).to.be.instanceOf(Error);
      expect(manager.tasks.size).to.equal(0);
      expect(manager.deletedFixedTasks.get(key)).to.equal(deleted);
      expect(probed).to.deep.equal([]);
      expect(writes).to.equal(0);
      expect(starts).to.equal(0);
    });

    it(`rechecks ${target} attachments removed after scanning and reports the accepted count`, async function () {
      const candidates = mixedItems();
      const manager = queue();
      const view = scanner(target, manager, [candidates[0], candidates[4]]);
      files.delete("paper.pdf");
      await view.handleConfirm();

      expect(manager.getAllTasks().map((task) => task.itemId)).to.deep.equal([
        5,
      ]);
      expect(notices[0].text).to.contain('"count":1');
      expect(notices[1].text).to.contain("queue-items-without-content-skipped");
      expect(notices[1].text).to.contain('"count":1');
      expect(tabs).to.deep.equal(["tasks"]);
    });
  }

  it("does not save or start a batch with no usable sources", async function () {
    const manager = queue();
    const ids = await manager.addTasks([
      paper(1),
      paper(2, [attachment(102, "application/pdf", "missing.pdf", false)]),
    ]);

    expect(ids).to.deep.equal([]);
    expect(manager.tasks.size).to.equal(0);
    expect(writes).to.equal(0);
    expect(starts).to.equal(0);
    expect(manager.activeEnqueueBatches).to.equal(0);
  });

  it("does not report scanner success when all selected sources are unavailable", async function () {
    const manager = queue();
    await scanner("summary", manager, [paper(1)]).handleConfirm();

    expect(notices).to.have.length(1);
    expect(notices[0].type).not.to.equal("success");
    expect(notices[0].text).to.contain("content-error-no-usable-attachment");
    expect(tabs).to.deep.equal([]);
    expect(writes).to.equal(0);
  });

  it("keeps the existing PDF-first content policy when a PDF is unavailable", async function () {
    const source = paper(1, [
      attachment(101, "application/pdf", "missing.pdf", false),
      attachment(102, "text/html", "snapshot.html"),
    ]);

    expect(
      await ContentExtractor.hasUsableAnalyzableAttachment(source),
    ).to.equal(false);
    expect(await queue().addTasks([source])).to.deep.equal([]);
  });

  it("yields to UI timers even when every item in a large batch is filtered", async function () {
    const manager = queue();
    let uiTimerRan = false;
    const timer = setTimeout(() => {
      uiTimerRan = true;
    }, 0);
    try {
      expect(
        await manager.addTasks(
          Array.from({ length: 1000 }, (_, i) => paper(i + 1)),
        ),
      ).to.deep.equal([]);
      expect(uiTimerRan).to.equal(true);
      expect(writes).to.equal(0);
    } finally {
      clearTimeout(timer);
    }
  });

  it("leaves existing failed tasks unchanged when their source is still missing", async function () {
    const manager = queue();
    const failed: TaskItem = {
      id: getSummaryTaskId(1),
      itemId: 1,
      title: "Paper 1",
      taskType: "summary",
      status: TaskStatus.FAILED,
      progress: 0,
      createdAt: new Date(),
      retryCount: 1,
      maxRetries: 3,
      error: "Missing attachment",
    };
    manager.tasks.set(failed.id, failed);

    expect(await manager.addTasks([paper(1)])).to.deep.equal([]);
    expect(manager.tasks.get(failed.id)).to.equal(failed);
    expect(failed.status).to.equal(TaskStatus.FAILED);
    expect(writes).to.equal(0);
  });
});
