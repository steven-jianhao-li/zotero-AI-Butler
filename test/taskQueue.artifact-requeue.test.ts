import { expect } from "chai";
import { config } from "../package.json";
import {
  TaskQueueManager,
  TaskStatus,
  type TaskItem,
} from "../src/modules/taskQueue";
import {
  TaskArtifacts,
  type TaskArtifactProbeResult,
  type FixedTaskArtifactType,
} from "../src/modules/taskArtifacts";

type QueueInternals = {
  requeueExistingFixedTask(
    task: TaskItem,
    item: Zotero.Item,
    artifactType: FixedTaskArtifactType,
    priority: boolean,
    options?: TaskItem["options"],
    workflowStage?: string,
  ): Promise<boolean>;
  saveToStorage(): Promise<void>;
};

const noteStrategyPref = `${config.prefsPrefix}.noteStrategy`;
const tableStrategyPref = `${config.prefsPrefix}.tableStrategy`;

function createQueueInternals(): QueueInternals {
  const manager = Object.create(TaskQueueManager.prototype) as QueueInternals;
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
  const item = { id: 1 } as Zotero.Item;
  let originalProbe: typeof TaskArtifacts.probe;
  let originalNoteStrategy: string | number | boolean | null | undefined;
  let originalTableStrategy: string | number | boolean | null | undefined;

  beforeEach(function () {
    originalProbe = TaskArtifacts.probe;
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
});
