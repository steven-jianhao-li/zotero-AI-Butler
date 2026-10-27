import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { setTimeout } from "node:timers";
import { URL } from "node:url";
import vm from "node:vm";
import { transformSync } from "esbuild";

function loadSource(path, imports, globals, inspection = "") {
  const source = readFileSync(
    new URL(`../src/${path}`, import.meta.url),
    "utf8",
  );
  const module = { exports: {} };
  vm.runInNewContext(
    transformSync(source + inspection, {
      loader: "ts",
      format: "cjs",
      target: "es2018",
      supported: { "dynamic-import": false },
    }).code,
    {
      module,
      exports: module.exports,
      require: (name) => imports[name] || {},
      setTimeout,
      ...globals,
    },
  );
  return module.exports;
}

function paper(id) {
  return { id, getField: () => `Paper ${id}`, isRegularItem: () => true };
}

function fixture(items, existingImages = []) {
  const prefs = new Map();
  const writes = [];
  const starts = [];
  const executions = [];
  const notices = [];
  const locale = {
    getString: (key, options) =>
      options?.args ? `${key}:${JSON.stringify(options.args)}` : key,
  };
  const globals = {
    Zotero: {
      Prefs: {
        get: (key) => prefs.get(key),
        set(key, value) {
          prefs.set(key, value);
          writes.push(JSON.parse(value));
        },
      },
      getActiveZoteroPane: () => ({ getSelectedItems: () => items }),
    },
    ztoolkit: {
      log() {},
      ProgressWindow: class {
        createLine(line) {
          notices.push(line);
          return this;
        }
        show() {
          return this;
        }
      },
    },
  };
  const queueModule = loadSource(
    "modules/taskQueue.ts",
    {
      "../utils/locale": locale,
      "../utils/prefs": { getPref: () => undefined },
      "./taskArtifacts": {
        TaskArtifacts: {
          probe: async (_type, item) => ({
            exists: existingImages.includes(item.id),
          }),
        },
      },
    },
    globals,
  );
  const manager = queueModule.TaskQueueManager.getInstance();
  manager.start = () => {
    starts.push({ taskCount: manager.tasks.size, writeCount: writes.length });
    manager.isRunning = true;
  };
  // Exercise the real dispatcher, replacing only image generation/API work.
  manager.executeImageSummaryTask = async (id) => executions.push(id);
  const { handleImageSummary } = loadSource(
    "hooks.ts",
    {
      "./utils/locale": locale,
      "./modules/taskQueue": queueModule,
    },
    globals,
    "\nexport { handleImageSummary };",
  );
  return { manager, handleImageSummary, writes, starts, executions, notices };
}

for (const count of [3, 100, 1000]) {
  test(`the image-summary menu queues all ${count} selected papers (#431)`, async () => {
    const { manager, handleImageSummary, writes, starts, executions, notices } =
      fixture(Array.from({ length: count }, (_, index) => paper(index + 1)));

    await handleImageSummary();

    assert.equal(manager.tasks.size, count);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].tasks.length, count);
    assert.deepEqual(starts, [{ taskCount: count, writeCount: 1 }]);
    assert.deepEqual(executions, []);
    for (let id = 1; id <= count; id++) {
      const task = manager.getTask(`img-task-${id}`);
      assert.equal(task.itemId, id);
      assert.equal(task.taskType, "imageSummary");
      assert.equal(task.status, "pending");
    }
    assert.equal(notices.length, 1);
    assert.equal(notices[0].type, "success");
    assert.equal(
      notices[0].text,
      `image-summary-queue-batch-added:{"count":${count}}`,
    );
  });
}

test("one selected paper still starts as a priority image task", async () => {
  const { manager, handleImageSummary, executions, notices } = fixture([
    paper(1),
  ]);
  await handleImageSummary();
  assert.equal(manager.getTask("img-task-1").status, "priority");
  assert.deepEqual(executions, ["img-task-1"]);
  assert.equal(notices[0].text, "image-summary-queue-added");
});

test("multiple image tasks respect the configured queue batch size", async () => {
  const { manager, handleImageSummary, executions } = fixture(
    [1, 2, 3].map(paper),
  );
  manager.batchSize = 2;
  await handleImageSummary();
  assert.deepEqual(executions, []);
  await manager.executeNextBatch();
  assert.deepEqual(executions, ["img-task-1", "img-task-2"]);
  assert.equal(manager.getTask("img-task-3").status, "pending");
});

test("repeated batch selection preserves running/completed images and requeues missing ones", async () => {
  const { manager, handleImageSummary, writes, executions } = fixture(
    [1, 2, 3, 4, 5, 6, 6].map(paper),
    [2, 5],
  );
  for (const [id, status] of [
    [1, "processing"],
    [2, "completed"],
    [3, "completed"],
    [4, "failed"],
    [5, "failed"],
    [6, "pending"],
  ]) {
    manager.tasks.set(`img-task-${id}`, {
      id: `img-task-${id}`,
      itemId: id,
      title: `Paper ${id}`,
      taskType: "imageSummary",
      status,
      progress: 80,
      retryCount: 1,
      maxRetries: 1,
      createdAt: new Date(),
    });
  }
  await handleImageSummary();
  assert.equal(manager.tasks.size, 6);
  assert.equal(writes.length, 1);
  assert.equal(manager.getTask("img-task-1").status, "processing");
  for (const id of [2, 5])
    assert.equal(manager.getTask(`img-task-${id}`).status, "completed");
  for (const id of [3, 4, 6])
    assert.equal(manager.getTask(`img-task-${id}`).status, "pending");
  for (const id of [3, 4])
    assert.equal(manager.getTask(`img-task-${id}`).progress, 0);
  assert.deepEqual(executions, []);
});

test("empty and non-paper selections do not enqueue image tasks", async () => {
  const invalid = { id: 2, isRegularItem: () => false };
  for (const items of [[], [invalid], [paper(1), invalid]]) {
    const { manager, handleImageSummary, writes, executions, notices } =
      fixture(items);
    await handleImageSummary();
    assert.equal(manager.tasks.size, 0);
    assert.deepEqual(writes, []);
    assert.deepEqual(executions, []);
    assert.equal(notices.length, 1);
    assert.equal(notices[0].type, "error");
  }
});

test("an enqueue failure saves the successful prefix and restores scheduling", async () => {
  const invalid = {
    ...paper(2),
    getField() {
      throw new Error("fixture enqueue failure");
    },
  };
  const { manager, handleImageSummary, writes, starts, notices } = fixture([
    paper(1),
    invalid,
    paper(3),
  ]);
  await handleImageSummary();
  assert.equal(manager.tasks.size, 1);
  assert.equal(writes.length, 1);
  assert.deepEqual(
    writes[0].tasks.map((task) => task.itemId),
    [1],
  );
  assert.deepEqual(starts, [{ taskCount: 1, writeCount: 1 }]);
  assert.equal(manager.activeEnqueueBatches, 0);
  assert.equal(notices[0].type, "error");
  await manager.addImageSummaryTask(paper(3), false);
  assert.equal(manager.tasks.size, 2);
  assert.equal(writes.length, 2);
});
