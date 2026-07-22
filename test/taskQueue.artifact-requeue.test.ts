import { expect } from "chai";
import { config } from "../package.json";
import {
  TaskQueueManager,
  TaskStatus,
  getDeepReadTaskId,
  getSummaryTaskId,
  type TaskItem,
} from "../src/modules/taskQueue";
import {
  TaskArtifacts,
  type TaskArtifactProbeResult,
  type FixedTaskArtifactType,
} from "../src/modules/taskArtifacts";
import { AiNoteService } from "../src/modules/aiNoteService";

type QueueInternals = {
  tasks: Map<string, TaskItem>;
  deletedFixedTasks: Map<string, any>;
  clearedDeletedFixedTaskKeys: Set<string>;
  progressCallbacks: Set<(...args: any[]) => void>;
  completeCallbacks: Set<(...args: any[]) => void>;
  isRunning: boolean;
  addTask(
    item: Zotero.Item,
    priority?: boolean,
    options?: {
      summaryMode?: string;
      forceOverwrite?: boolean;
      source?: "auto";
    },
  ): Promise<string>;
  addDeepReadTask(
    item: Zotero.Item,
    priority?: boolean,
    options?: {
      summaryMode?: string;
      forceOverwrite?: boolean;
      source?: "auto";
    },
  ): Promise<string>;
  removeTask(taskId: string): Promise<void>;
  isAutoCreationSuppressed(
    itemId: number,
    taskType: "summary" | "deepRead",
  ): boolean;
  requeueExistingFixedTask(
    task: TaskItem,
    item: Zotero.Item,
    artifactType: FixedTaskArtifactType,
    priority: boolean,
    options?: TaskItem["options"],
    workflowStage?: string,
  ): Promise<boolean>;
  shouldSkipNewFixedTaskForExistingArtifact(
    item: Zotero.Item,
    artifactType: FixedTaskArtifactType,
    options?: TaskItem["options"],
  ): Promise<boolean>;
  saveToStorage(): Promise<void>;
};

const noteStrategyPref = `${config.prefsPrefix}.noteStrategy`;
const tableStrategyPref = `${config.prefsPrefix}.tableStrategy`;

function createQueueInternals(): QueueInternals {
  const manager = Object.create(TaskQueueManager.prototype) as QueueInternals;
  manager.tasks = new Map();
  manager.deletedFixedTasks = new Map();
  manager.clearedDeletedFixedTaskKeys = new Set();
  manager.progressCallbacks = new Set();
  manager.completeCallbacks = new Set();
  manager.isRunning = true;
  manager.saveToStorage = async () => {};
  return manager;
}

function createTask(status: TaskStatus): TaskItem {
  return {
    id: "task-1",
    itemId: 1,
    title: "Paper",
    status,
    progress: status === TaskStatus.COMPLETED ? 100 : 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    startedAt: new Date("2026-01-01T00:00:05Z"),
    completedAt: new Date("2026-01-01T00:00:10Z"),
    error: status === TaskStatus.FAILED ? "old error" : undefined,
    retryCount: status === TaskStatus.FAILED ? 2 : 0,
    maxRetries: 3,
    duration: status === TaskStatus.COMPLETED ? 5 : undefined,
  };
}

describe("TaskQueue artifact-aware requeue", function () {
  const item = { id: 1, getField: () => "Paper" } as unknown as Zotero.Item;
  let originalProbe: typeof TaskArtifacts.probe;
  let originalFindNote: typeof AiNoteService.findNote;
  let originalNoteStrategy: string | number | boolean | null | undefined;
  let originalTableStrategy: string | number | boolean | null | undefined;

  beforeEach(function () {
    originalProbe = TaskArtifacts.probe;
    originalFindNote = AiNoteService.findNote;
    originalNoteStrategy = Zotero.Prefs.get(noteStrategyPref, true) as
      | string
      | number
      | boolean
      | null
      | undefined;
    originalTableStrategy = Zotero.Prefs.get(tableStrategyPref, true) as
      | string
      | number
      | boolean
      | null
      | undefined;
    Zotero.Prefs.set(noteStrategyPref, "skip", true);
    Zotero.Prefs.set(tableStrategyPref, "skip", true);
  });

  afterEach(function () {
    TaskArtifacts.probe = originalProbe;
    AiNoteService.findNote = originalFindNote;
    if (originalNoteStrategy == null) {
      Zotero.Prefs.clear(noteStrategyPref, true);
    } else {
      Zotero.Prefs.set(noteStrategyPref, originalNoteStrategy, true);
    }
    if (originalTableStrategy == null) {
      Zotero.Prefs.clear(tableStrategyPref, true);
    } else {
      Zotero.Prefs.set(tableStrategyPref, originalTableStrategy, true);
    }
  });

  function stubProbe(result: TaskArtifactProbeResult): void {
    TaskArtifacts.probe = async () => result;
  }

  it("queues normal summaries with single mode by default", async function () {
    const manager = createQueueInternals();
    stubProbe({ exists: false, reason: "summary-note-missing" });

    const taskId = await manager.addTask(item);
    const task = manager.tasks.get(taskId);

    expect(taskId).to.equal(getSummaryTaskId(item.id));
    expect(task?.taskType).to.equal("summary");
    expect(task?.options?.summaryMode).to.equal("single");
  });

  it("routes explicit deep-read mode away from normal summary tasks", async function () {
    const manager = createQueueInternals();
    stubProbe({ exists: false, reason: "deep-read-note-missing" });

    const taskId = await manager.addTask(item, false, {
      summaryMode: "deepRead",
    });
    const task = manager.tasks.get(taskId);

    expect(taskId).to.equal(getDeepReadTaskId(item.id));
    expect(task?.taskType).to.equal("deepRead");
    expect(task?.options?.summaryMode).to.equal("deepRead");
    expect(manager.tasks.has(getSummaryTaskId(item.id))).to.equal(false);
  });

  it("requeues a completed summary task when the artifact is missing", async function () {
    const manager = createQueueInternals();
    const task = createTask(TaskStatus.COMPLETED);
    stubProbe({ exists: false, reason: "summary-note-missing" });

    const shouldRun = await manager.requeueExistingFixedTask(
      task,
      item,
      "summary",
      true,
    );

    expect(shouldRun).to.equal(true);
    expect(task.status).to.equal(TaskStatus.PRIORITY);
    expect(task.progress).to.equal(0);
    expect(task.completedAt).to.equal(undefined);
    expect(task.duration).to.equal(undefined);
  });

  it("keeps a completed summary task when the artifact exists and strategy is skip", async function () {
    const manager = createQueueInternals();
    const task = createTask(TaskStatus.COMPLETED);
    stubProbe({ exists: true });

    const shouldRun = await manager.requeueExistingFixedTask(
      task,
      item,
      "summary",
      true,
    );

    expect(shouldRun).to.equal(false);
    expect(task.status).to.equal(TaskStatus.COMPLETED);
  });

  it("skips creating a new deep-read task when a complete artifact exists and strategy is skip", async function () {
    const manager = createQueueInternals();
    stubProbe({ exists: true });

    const shouldSkip = await manager.shouldSkipNewFixedTaskForExistingArtifact(
      item,
      "deepRead",
      { summaryMode: "deepRead" },
    );

    expect(shouldSkip).to.equal(true);
  });

  it("records a completed deep-read task when an existing complete artifact is skipped", async function () {
    const manager = createQueueInternals();
    stubProbe({ exists: true });

    const taskId = await manager.addDeepReadTask(item, true, {
      summaryMode: "deepRead",
    });
    const task = manager.tasks.get(taskId);

    expect(taskId).to.equal(getDeepReadTaskId(1));
    expect(task?.status).to.equal(TaskStatus.COMPLETED);
    expect(task?.progress).to.equal(100);
    expect(task?.taskType).to.equal("deepRead");
  });

  it("suppresses auto-created deep-read tasks after the user deletes them", async function () {
    const manager = createQueueInternals();
    stubProbe({ exists: false, reason: "deep-read-note-missing" });
    const taskId = await manager.addDeepReadTask(item, false, {
      summaryMode: "deepRead",
    });

    await manager.removeTask(taskId);
    const autoTaskId = await manager.addDeepReadTask(item, false, {
      summaryMode: "deepRead",
      source: "auto",
    });

    expect(autoTaskId).to.equal(taskId);
    expect(manager.tasks.has(taskId)).to.equal(false);
    expect(manager.isAutoCreationSuppressed(item.id, "deepRead")).to.equal(
      true,
    );
  });

  it("allows manual deep-read enqueue to clear an auto-scan deletion marker", async function () {
    const manager = createQueueInternals();
    stubProbe({ exists: false, reason: "deep-read-note-missing" });
    const taskId = getDeepReadTaskId(item.id);
    manager.deletedFixedTasks.set(`${item.id}:deepRead`, {
      key: `${item.id}:deepRead`,
      itemId: item.id,
      taskType: "deepRead",
      deletedAt: "2026-01-01T00:00:00Z",
    });

    await manager.addDeepReadTask(item, false, { summaryMode: "deepRead" });

    expect(manager.tasks.has(taskId)).to.equal(true);
    expect(manager.isAutoCreationSuppressed(item.id, "deepRead")).to.equal(
      false,
    );
  });

  it("does not skip creating a new deep-read task when the artifact is incomplete", async function () {
    const manager = createQueueInternals();
    stubProbe({ exists: false, reason: "deep-read-slots-incomplete" });

    const shouldSkip = await manager.shouldSkipNewFixedTaskForExistingArtifact(
      item,
      "deepRead",
      { summaryMode: "deepRead" },
    );

    expect(shouldSkip).to.equal(false);
  });

  it("does not skip creating a new deep-read task when overwrite is configured", async function () {
    const manager = createQueueInternals();
    stubProbe({ exists: true });
    Zotero.Prefs.set(noteStrategyPref, "overwrite", true);

    const shouldSkip = await manager.shouldSkipNewFixedTaskForExistingArtifact(
      item,
      "deepRead",
      { summaryMode: "deepRead" },
    );

    expect(shouldSkip).to.equal(false);
  });

  it("requeues a completed deep-read task when slots are incomplete", async function () {
    const manager = createQueueInternals();
    const task = createTask(TaskStatus.COMPLETED);
    task.taskType = "deepRead";
    stubProbe({ exists: false, reason: "deep-read-slots-incomplete" });

    const shouldRun = await manager.requeueExistingFixedTask(
      task,
      item,
      "deepRead",
      true,
      { summaryMode: "deepRead" },
    );

    expect(shouldRun).to.equal(true);
    expect(task.status).to.equal(TaskStatus.PRIORITY);
    expect(task.progress).to.equal(0);
    expect(task.completedAt).to.equal(undefined);
  });

  it("requeues a completed summary task when append is configured", async function () {
    const manager = createQueueInternals();
    const task = createTask(TaskStatus.COMPLETED);
    stubProbe({ exists: true });
    Zotero.Prefs.set(noteStrategyPref, "append", true);

    const shouldRun = await manager.requeueExistingFixedTask(
      task,
      item,
      "summary",
      true,
    );

    expect(shouldRun).to.equal(true);
    expect(task.status).to.equal(TaskStatus.PRIORITY);
  });

  it("requeues a completed table task when overwrite is configured", async function () {
    const manager = createQueueInternals();
    const task = createTask(TaskStatus.COMPLETED);
    stubProbe({ exists: true });
    Zotero.Prefs.set(tableStrategyPref, "overwrite", true);

    const shouldRun = await manager.requeueExistingFixedTask(
      task,
      item,
      "tableFill",
      true,
      undefined,
      "等待开始",
    );

    expect(shouldRun).to.equal(true);
    expect(task.status).to.equal(TaskStatus.PRIORITY);
    expect(task.workflowStage).to.equal("等待开始");
  });

  it("keeps processing tasks deduplicated and requeues failed tasks", async function () {
    const manager = createQueueInternals();
    const processingTask = createTask(TaskStatus.PROCESSING);
    const failedTask = createTask(TaskStatus.FAILED);
    stubProbe({ exists: false });

    const processingShouldRun = await manager.requeueExistingFixedTask(
      processingTask,
      item,
      "summary",
      true,
    );
    const failedShouldRun = await manager.requeueExistingFixedTask(
      failedTask,
      item,
      "summary",
      true,
    );

    expect(processingShouldRun).to.equal(false);
    expect(processingTask.status).to.equal(TaskStatus.PROCESSING);
    expect(failedShouldRun).to.equal(true);
    expect(failedTask.status).to.equal(TaskStatus.PRIORITY);
    expect(failedTask.error).to.equal(undefined);
    expect(failedTask.retryCount).to.equal(0);
  });

  it("uses distinct task IDs for summary and deep read", function () {
    expect(getSummaryTaskId(1)).to.equal("summary-task-1");
    expect(getDeepReadTaskId(1)).to.equal("deepread-task-1");
    expect(getSummaryTaskId(1)).to.not.equal(getDeepReadTaskId(1));
  });

  it("treats deep-read notes with runnable slots as incomplete artifacts", async function () {
    AiNoteService.findNote = async () =>
      ({
        getNote: () =>
          [
            "<h1>AI 精读 - Paper</h1>",
            "<!-- zab:slot:method:done -->",
            "<p>已生成</p>",
            "<!-- zab:slot:method:end -->",
            "<!-- zab:slot:result:pending -->",
            "<p>⏳ 等待生成...</p>",
            "<!-- zab:slot:result:end -->",
          ].join("\n"),
      }) as Zotero.Item;

    const result = await TaskArtifacts.probe("deepRead", item);

    expect(result.exists).to.equal(false);
    expect(result.reason).to.equal("deep-read-slots-incomplete");
  });
});
