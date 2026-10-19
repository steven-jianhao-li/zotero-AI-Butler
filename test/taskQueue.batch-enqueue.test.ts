import { expect } from "chai";
import { config } from "../package.json";
import {
  TaskQueueManager,
  TaskStatus,
  getDeepReadTaskId,
  getSummaryTaskId,
  type TaskItem,
  type TaskOptions,
  type TaskProgressCallback,
  type TaskCompleteCallback,
} from "../src/modules/taskQueue";
import { TaskArtifacts } from "../src/modules/taskArtifacts";
import { ContentExtractor } from "../src/modules/contentExtractor";
import { LibraryScannerView } from "../src/modules/views/LibraryScannerView";
import { TaskQueueView } from "../src/modules/views/TaskQueueView";
import { DashboardView } from "../src/modules/views/DashboardView";
import { MainWindow } from "../src/modules/views/MainWindow";

type DeletedTask = {
  key: string;
  itemId: number;
  taskType: "summary" | "deepRead";
  deletedAt: string;
};

type QueueFixture = Pick<TaskQueueManager, keyof TaskQueueManager> & {
  tasks: Map<string, TaskItem>;
  deletedFixedTasks: Map<string, DeletedTask>;
  activeEnqueueBatches: number;
  isRunning: boolean;
  saveToStorage(): Promise<void>;
  executeTask(taskId: string): Promise<boolean>;
  executeNextBatch(): Promise<void>;
};

const queuePref = "extensions.zotero.aibutler.taskQueue";

function paper(id: number): Zotero.Item {
  return {
    id,
    getField: () => `Paper ${id}`,
    isRegularItem: () => true,
  } as unknown as Zotero.Item;
}

function task(id: number, status = TaskStatus.PENDING): TaskItem {
  return {
    id: getSummaryTaskId(id),
    itemId: id,
    title: `Paper ${id}`,
    status,
    progress: status === TaskStatus.COMPLETED ? 100 : 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    retryCount: 0,
    maxRetries: 3,
    taskType: "summary",
  };
}

function deletedTask(
  id: number,
  taskType: "summary" | "deepRead",
): DeletedTask {
  return {
    key: `${id}:${taskType}`,
    itemId: id,
    taskType,
    deletedAt: "2026-01-01T00:00:00Z",
  };
}

describe("TaskQueue batch enqueue (#415)", function () {
  const globals = globalThis as unknown as Record<string, unknown>;
  let previous: Record<string, unknown>;
  let originalProbe: typeof TaskArtifacts.probe;
  let originalHasUsableAttachment: typeof ContentExtractor.hasUsableAnalyzableAttachment;
  let originalMainWindow: typeof MainWindow.getInstance;
  let prefs: Map<string, unknown>;
  let queueReads: number;
  let writes: Array<{ tasks: TaskItem[]; deletedFixedTasks: DeletedTask[] }>;
  let starts: Array<{ taskCount: number; writeCount: number }>;
  let executions: string[];
  let notices: Array<{ text: string; type: string }>;
  let tabs: string[];

  beforeEach(function () {
    previous = Object.fromEntries(
      ["Zotero", "addon", "ztoolkit"].map((key) => [key, globals[key]]),
    );
    originalProbe = TaskArtifacts.probe;
    originalHasUsableAttachment =
      ContentExtractor.hasUsableAnalyzableAttachment;
    originalMainWindow = MainWindow.getInstance;
    prefs = new Map([[`${config.prefsPrefix}.noteStrategy`, "skip"]]);
    queueReads = 0;
    writes = [];
    starts = [];
    executions = [];
    notices = [];
    tabs = [];
    globals.Zotero = {
      Prefs: {
        get(key: string) {
          if (key === queuePref) queueReads++;
          return prefs.get(key);
        },
        set(key: string, value: unknown) {
          prefs.set(key, value);
          if (key === queuePref) writes.push(JSON.parse(String(value)));
        },
      },
    };
    globals.addon = { data: {} };
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
    TaskArtifacts.probe = async () => ({ exists: false });
    ContentExtractor.hasUsableAnalyzableAttachment = async () => true;
    MainWindow.getInstance = () =>
      ({ switchTab: (tab: string) => tabs.push(tab) }) as unknown as MainWindow;
  });

  afterEach(function () {
    TaskArtifacts.probe = originalProbe;
    ContentExtractor.hasUsableAnalyzableAttachment =
      originalHasUsableAttachment;
    MainWindow.getInstance = originalMainWindow;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globals[key];
      else globals[key] = value;
    }
  });

  function queue(): QueueFixture {
    const manager = Object.assign(Object.create(TaskQueueManager.prototype), {
      tasks: new Map<string, TaskItem>(),
      processingTasks: new Set<string>(),
      taskAbortControllers: new Map(),
      abortingTasks: new Set<string>(),
      progressCallbacks: new Set<TaskProgressCallback>(),
      completeCallbacks: new Set<TaskCompleteCallback>(),
      streamCallbacks: new Set(),
      deletedFixedTasks: new Map<string, DeletedTask>(),
      clearedDeletedFixedTaskKeys: new Set<string>(),
      activeEnqueueBatches: 0,
      lastLoadedSnapshotAt: null,
      isRunning: false,
      isBatchRunning: false,
      batchSize: 1,
      start() {
        starts.push({
          taskCount: manager.tasks.size,
          writeCount: writes.length,
        });
        manager.isRunning = true;
      },
      async executeTask(taskId: string) {
        executions.push(taskId);
        return false;
      },
    }) as QueueFixture;
    return manager;
  }

  for (const mode of ["single", "deepRead"]) {
    for (const count of [100, 500, 1000]) {
      it(`persists ${count} ${mode} tasks once before starting`, async function () {
        const manager = queue();
        const items = Array.from({ length: count }, (_, index) =>
          paper(index + 1),
        );
        const notifications: number[] = [];
        manager.onProgress(() => notifications.push(writes.length));

        const ids = await manager.addTasks(items, false, { summaryMode: mode });

        expect(ids).to.have.length(count);
        expect(new Set(ids).size).to.equal(count);
        expect(writes).to.have.length(1);
        expect(writes[0].tasks).to.have.length(count);
        expect(queueReads).to.equal(2);
        expect(starts).to.deep.equal([{ taskCount: count, writeCount: 1 }]);
        expect(executions).to.deep.equal([]);
        for (const queued of manager.getAllTasks()) {
          expect(queued.taskType).to.equal(
            mode === "single" ? "summary" : mode,
          );
          expect(queued.options?.summaryMode).to.equal(mode);
          expect(queued.status).to.equal(TaskStatus.PENDING);
        }
        expect(notifications).to.deep.equal(
          mode === "single" ? Array(count).fill(1) : [],
        );
      });
    }
  }

  it("yields to UI timers during large enqueues and blocks snapshot reloads and new batches", async function () {
    const manager = queue();
    prefs.set(
      queuePref,
      JSON.stringify({ tasks: [], savedAt: "old-snapshot" }),
    );
    let uiTimerRan = false;
    const timer = setTimeout(() => {
      uiTimerRan = true;
    }, 0);
    TaskArtifacts.probe = async (_type, item) => {
      if (item.id === 51) {
        manager.refreshFromStorage();
        await manager.executeNextBatch();
        expect(manager.tasks.size).to.equal(50);
        expect(uiTimerRan).to.equal(true);
        expect(writes).to.have.length(0);
        expect(starts).to.have.length(0);
        expect(executions).to.have.length(0);
      }
      return { exists: false };
    };
    try {
      await manager.addTasks(
        Array.from({ length: 100 }, (_, index) => paper(index + 1)),
      );
    } finally {
      clearTimeout(timer);
    }
    expect(manager.tasks.size).to.equal(100);
    expect(manager.activeEnqueueBatches).to.equal(0);
  });

  it("defers priority execution until persistence and preserves options", async function () {
    const manager = queue();
    TaskArtifacts.probe = async () => {
      expect(executions).to.have.length(0);
      expect(starts).to.have.length(0);
      return { exists: false };
    };
    const options: TaskOptions = {
      summaryMode: "deepRead",
      forceOverwrite: true,
    };
    const ids = await manager.addTasks([paper(1), paper(2)], true, options);

    expect(executions).to.deep.equal(ids);
    expect(writes).to.have.length(1);
    expect(starts).to.deep.equal([{ taskCount: 2, writeCount: 1 }]);
    expect(
      manager
        .getAllTasks()
        .every((entry) => entry.status === TaskStatus.PRIORITY),
    ).to.equal(true);
    expect(
      manager.getAllTasks().every((entry) => entry.options?.forceOverwrite),
    ).to.equal(true);
  });

  it("keeps artifact policies, processing deduplication and legacy IDs in a mixed batch", async function () {
    const manager = queue();
    for (const [id, status] of [
      [1, TaskStatus.COMPLETED],
      [2, TaskStatus.FAILED],
      [3, TaskStatus.PROCESSING],
      [4, TaskStatus.PENDING],
      [5, TaskStatus.COMPLETED],
      [6, TaskStatus.FAILED],
    ] as const) {
      const entry = task(id, status);
      manager.tasks.set(entry.id, entry);
    }
    const legacy = task(8);
    legacy.id = "task-8";
    manager.tasks.set(legacy.id, legacy);
    TaskArtifacts.probe = async (_type, item) => ({
      exists: [5, 6, 7].includes(item.id),
    });

    await manager.addTasks([1, 2, 3, 4, 5, 6, 7, 8, 4].map(paper));

    expect(manager.tasks.size).to.equal(8);
    expect(writes).to.have.length(1);
    for (const id of [1, 2, 4, 8]) {
      expect(manager.getTask(getSummaryTaskId(id))?.status).to.equal(
        TaskStatus.PENDING,
      );
    }
    expect(manager.getTask(getSummaryTaskId(3))?.status).to.equal(
      TaskStatus.PROCESSING,
    );
    for (const id of [5, 6, 7]) {
      expect(manager.getTask(getSummaryTaskId(id))?.status).to.equal(
        TaskStatus.COMPLETED,
      );
    }
    expect(manager.tasks.has("task-8")).to.equal(false);
  });

  for (const mode of ["single", "deepRead"] as const) {
    const type = mode === "single" ? "summary" : "deepRead";
    it(`honors automatic ${type} deletion suppression`, async function () {
      const manager = queue();
      prefs.set(
        queuePref,
        JSON.stringify({ deletedFixedTasks: [deletedTask(1, type)] }),
      );

      await manager.addTasks([paper(1), paper(2)], false, {
        summaryMode: mode,
        source: "auto",
      });

      expect(manager.tasks.size).to.equal(1);
      expect(manager.getAllTasks()[0].itemId).to.equal(2);
      expect(writes[0].deletedFixedTasks).to.deep.equal([deletedTask(1, type)]);
      expect(queueReads).to.equal(2);
    });

    it(`clears only explicitly requeued ${type} deletion markers`, async function () {
      const manager = queue();
      const stale = task(99);
      manager.tasks.set(stale.id, stale);
      prefs.set(
        queuePref,
        JSON.stringify({
          deletedFixedTasks: [
            deletedTask(1, type),
            deletedTask(1, type === "summary" ? "deepRead" : "summary"),
            deletedTask(99, "summary"),
          ],
        }),
      );

      await manager.addTasks([paper(1)], false, { summaryMode: mode });

      expect(manager.tasks.size).to.equal(1);
      expect(writes[0].tasks[0].itemId).to.equal(1);
      expect(
        writes[0].deletedFixedTasks.map((entry) => entry.key),
      ).to.have.members([
        `1:${type === "summary" ? "deepRead" : "summary"}`,
        "99:summary",
      ]);
    });
  }

  it("merges deletions made by another window during enqueue before saving", async function () {
    const manager = queue();
    manager.tasks.set(getSummaryTaskId(99), task(99));
    TaskArtifacts.probe = async () => {
      prefs.set(
        queuePref,
        JSON.stringify({ deletedFixedTasks: [deletedTask(99, "summary")] }),
      );
      return { exists: false };
    };
    await manager.addTasks([paper(1), paper(2)]);
    expect(manager.tasks.has(getSummaryTaskId(99))).to.equal(false);
    expect(writes[0].deletedFixedTasks).to.deep.equal([
      deletedTask(99, "summary"),
    ]);
    expect(writes[0].tasks).to.have.length(2);
  });

  it("saves a successful prefix and restores normal enqueue after a failure", async function () {
    const manager = queue();
    const invalid = { id: 2, isNote: () => true } as unknown as Zotero.Item;
    let failure: unknown;
    try {
      await manager.addTasks([paper(1), invalid, paper(3)]);
    } catch (error) {
      failure = error;
    }

    expect(failure).to.be.instanceOf(Error);
    expect(writes).to.have.length(1);
    expect(writes[0].tasks.map((entry) => entry.itemId)).to.deep.equal([1]);
    expect(starts).to.deep.equal([{ taskCount: 1, writeCount: 1 }]);
    expect(manager.activeEnqueueBatches).to.equal(0);
    await manager.addTask(paper(3));
    expect(writes).to.have.length(2);
    expect(manager.tasks.size).to.equal(2);
  });

  it("does not save or start for empty and fully skipped batches", async function () {
    const manager = queue();
    expect(await manager.addTasks([])).to.deep.equal([]);
    expect(queueReads).to.equal(0);
    manager.tasks.set(getSummaryTaskId(1), task(1, TaskStatus.PROCESSING));
    await manager.addTasks([paper(1)]);
    expect(writes).to.have.length(0);
    expect(starts).to.have.length(0);
  });

  it("keeps overlapping batches independent and prevents refresh from losing in-flight tasks", async function () {
    const manager = queue();
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    TaskArtifacts.probe = async (_type, item) => {
      if (item.id === 1) await barrier;
      return { exists: false };
    };
    const first = manager.addTasks([paper(1), paper(2)]);
    await manager.addTasks([paper(3), paper(4)]);
    expect(manager.activeEnqueueBatches).to.equal(1);
    manager.refreshFromStorage();
    release();
    await first;
    expect(writes).to.have.length(2);
    expect(writes[1].tasks.map((entry) => entry.itemId)).to.have.members([
      1, 2, 3, 4,
    ]);
    expect(manager.activeEnqueueBatches).to.equal(0);
  });

  it("reads the stored queue once when saving 1000 tasks with deletions", async function () {
    const manager = queue();
    for (let id = 1; id <= 1000; id++)
      manager.tasks.set(getSummaryTaskId(id), task(id));
    prefs.set(
      queuePref,
      JSON.stringify({
        tasks: manager.getAllTasks(),
        deletedFixedTasks: [deletedTask(500, "summary")],
      }),
    );
    await manager.saveToStorage();
    expect(queueReads).to.equal(1);
    expect(writes[0].tasks).to.have.length(999);
    expect(manager.tasks.has(getSummaryTaskId(500))).to.equal(false);
  });

  it("reads deletion markers once when selecting from 1000 pending tasks", async function () {
    const manager = queue();
    for (let id = 1; id <= 1000; id++)
      manager.tasks.set(getSummaryTaskId(id), task(id));
    prefs.set(
      queuePref,
      JSON.stringify({
        tasks: manager.getAllTasks(),
        deletedFixedTasks: [deletedTask(1, "summary")],
      }),
    );
    await manager.executeNextBatch();
    expect(queueReads).to.equal(1);
    expect(executions).to.deep.equal([getSummaryTaskId(2)]);
  });

  it("checks fresh cross-window deletions before direct priority execution", async function () {
    const manager = queue();
    manager.tasks.set(getSummaryTaskId(1), task(1));
    prefs.set(
      queuePref,
      JSON.stringify({ deletedFixedTasks: [deletedTask(1, "summary")] }),
    );
    const prototype = TaskQueueManager.prototype as unknown as Pick<
      QueueFixture,
      "executeTask"
    >;
    await prototype.executeTask.call(manager, getSummaryTaskId(1));
    expect(manager.tasks.size).to.equal(0);
    expect(writes[0].tasks).to.have.length(0);
  });

  it("keeps the stored snapshot compatible with queue reloads", async function () {
    const manager = queue();
    await manager.addTasks([paper(1)], false, {
      summaryMode: "deepRead",
      forceOverwrite: true,
    });
    const reloaded = queue();
    reloaded.refreshFromStorage();
    const entry = reloaded.getTask(getDeepReadTaskId(1));
    expect(entry?.createdAt).to.be.instanceOf(Date);
    expect(entry?.options).to.deep.equal({
      summaryMode: "deepRead",
      forceOverwrite: true,
    });
  });

  function scanner(target: "summary" | "deepRead", manager: QueueFixture) {
    const button = { disabled: false, style: {} };
    const view = Object.assign(Object.create(LibraryScannerView.prototype), {
      treeRoot: [1, 2].map((id) => ({
        type: "item",
        item: paper(id),
        checked: true,
        children: [],
      })),
      taskQueueManager: manager,
      scanTarget: target,
      isEnqueuing: false,
      selectedCountElement: null,
      getConfirmButton: () => button,
      log() {},
    }) as { handleConfirm(): Promise<void>; isEnqueuing: boolean };
    return { view, button };
  }

  for (const target of ["summary", "deepRead"] as const) {
    it(`awaits one scanner batch for ${target} and blocks duplicate confirmations`, async function () {
      const manager = queue();
      let release!: () => void;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      let calls = 0;
      const options: Array<TaskOptions | undefined> = [];
      manager.addTasks = async (_items, _priority, requestedOptions) => {
        calls++;
        options.push(requestedOptions);
        await barrier;
        return _items.map((item) =>
          target === "summary"
            ? getSummaryTaskId(item.id)
            : getDeepReadTaskId(item.id),
        );
      };
      const { view, button } = scanner(target, manager);
      const pending = view.handleConfirm();
      expect(button.disabled).to.equal(true);
      expect(notices).to.have.length(0);
      expect(tabs).to.have.length(0);
      await view.handleConfirm();
      release();
      await pending;
      expect(calls).to.equal(1);
      expect(options).to.deep.equal([
        { summaryMode: target === "summary" ? "single" : "deepRead" },
      ]);
      expect(notices.map((entry) => entry.type)).to.deep.equal(["success"]);
      expect(tabs).to.deep.equal(["tasks"]);
      expect(button.disabled).to.equal(false);
    });
  }

  it("reports scanner enqueue failures and restores its button", async function () {
    const manager = queue();
    manager.addTasks = async () => {
      throw new Error("fixture enqueue failure");
    };
    const { view, button } = scanner("summary", manager);
    await view.handleConfirm();
    expect(notices.map((entry) => entry.type)).to.deep.equal(["fail"]);
    expect(tabs).to.have.length(0);
    expect(button.disabled).to.equal(false);
    expect(view.isEnqueuing).to.equal(false);
  });

  it("coalesces enqueue and completion notifications into one task view refresh", async function () {
    const manager = queue();
    let renders = 0;
    const view = Object.assign(Object.create(TaskQueueView.prototype), {
      manager,
      syncScheduled: false,
      refreshTimerId: null,
      syncFromManager() {
        renders++;
      },
    }) as { attachToManager(): void; onDestroy(): void };
    view.attachToManager();
    renders = 0;
    TaskArtifacts.probe = async () => ({ exists: true });
    try {
      await manager.addTasks(
        Array.from({ length: 100 }, (_, index) => paper(index + 1)),
      );
      expect(renders).to.equal(1);
    } finally {
      view.onDestroy();
    }
  });

  it("coalesces dashboard refreshes after a summary batch", async function () {
    const manager = queue();
    let renders = 0;
    const view = Object.assign(Object.create(DashboardView.prototype), {
      refreshScheduled: false,
      refreshData() {
        renders++;
      },
    }) as {
      handleTaskProgress(
        taskId: string,
        progress: number,
        message: string,
      ): void;
    };
    manager.onProgress((taskId, progress, message) =>
      view.handleTaskProgress(taskId, progress, message),
    );
    await manager.addTasks(
      Array.from({ length: 100 }, (_, index) => paper(index + 1)),
    );
    expect(renders).to.equal(1);
  });
});
