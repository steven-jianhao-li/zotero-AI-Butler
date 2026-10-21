import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import { build } from "esbuild";
import process from "node:process";
import { Buffer } from "node:buffer";
import { URL } from "node:url";

const { AbortController } = globalThis;

const compiled = await build({
  stdin: {
    contents: `
      export { requestLLMText } from './src/modules/llmproviders/shared/textTransport';
      export { LLMService, LLMApiExhaustedError } from './src/modules/llmService';
      export { LLMEndpointManager } from './src/modules/llmEndpointManager';
      export { TaskQueueManager, TaskStatus } from './src/modules/taskQueue';
      export { TaskArtifacts } from './src/modules/taskArtifacts';
      export { NoteGenerator } from './src/modules/noteGenerator';
      export { ContentExtractor } from './src/modules/contentExtractor';
      export { config } from './package.json';
    `,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  define: { __env__: '"test"' },
  logLevel: "silent",
});

async function flush() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

function host(t) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  const prefs = new Map();
  const module = { exports: {} };
  const globals = {
    module,
    exports: module.exports,
    require: createRequire(import.meta.url),
    Buffer,
    URL,
    AbortController,
    Date,
    Math: Object.assign(Object.create(Math), { random: () => 0 }),
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    Zotero: {
      locale: "en-US",
      Prefs: {
        get: (key) => prefs.get(key),
        set: (key, value) => prefs.set(key, value),
        clear: (key) => prefs.delete(key),
      },
      Items: {
        getAsync: async (id) => ({
          id,
          isRegularItem: () => true,
          isNote: () => false,
          isAttachment: () => false,
          getField: () => "Fixture",
        }),
      },
    },
    addon: {
      data: {
        locale: {
          current: {
            formatMessagesSync: ([{ id, args }]) => [
              { value: `${id} ${JSON.stringify(args || {})}` },
            ],
          },
        },
      },
    },
    ztoolkit: { log() {} },
  };
  vm.runInNewContext(compiled.outputFiles[0].text, globals);
  return { ...module.exports, globals, prefs };
}

function queue(h, status = "processing") {
  const task = {
    id: "summary-task-1",
    itemId: 1,
    taskType: "summary",
    title: "Fixture",
    status,
    progress: 45,
    createdAt: new Date(),
    retryCount: 0,
    maxRetries: 3,
  };
  const q = Object.assign(Object.create(h.TaskQueueManager.prototype), {
    tasks: new Map([[task.id, task]]),
    processingTasks: new Set(),
    taskAbortControllers: new Map(),
    abortingTasks: new Set(),
    progressCallbacks: new Set(),
    completeCallbacks: new Set(),
    streamCallbacks: new Set(),
    async saveToStorage() {},
    isTaskDeletedByUser() {
      return false;
    },
    mergeStoredDeletedFixedTasks() {},
  });
  h.NoteGenerator.findExistingNote = async () => ({
    getNote: () => "<p>Old completed summary</p>",
  });
  return { q, task };
}

test("existing notes never complete a running overwrite or discard its request controller", async (t) => {
  const h = host(t);
  const { q, task } = queue(h);
  task.options = { forceOverwrite: true };
  const controller = new AbortController();
  q.taskAbortControllers.set(task.id, controller);
  q.processingTasks.add(task.id);
  let successes = 0;
  q.completeCallbacks.add(() => successes++);
  assert.equal(await q.markTaskCompletedIfArtifactReady(task.id), false);
  assert.equal(task.status, "processing");
  assert.equal(q.taskAbortControllers.get(task.id), controller);
  assert.equal(q.processingTasks.has(task.id), true);
  assert.equal(successes, 0);
});

test("artifact reconciliation rechecks task state after asynchronous probing", async (t) => {
  const h = host(t);
  const { q, task } = queue(h, "pending");
  let finishProbe;
  h.TaskArtifacts.probe = () =>
    new Promise((resolve) => {
      finishProbe = resolve;
    });
  const pending = q.markTaskCompletedIfArtifactReady(task.id);
  await flush();
  task.status = "processing";
  q.processingTasks.add(task.id);
  finishProbe({ exists: true });
  assert.equal(await pending, false);
  assert.equal(task.status, "processing");
});

test("artifact reconciliation honors regeneration policy while preserving idle skip recovery", async (t) => {
  const h = host(t);
  const { q, task } = queue(h, "pending");
  for (const strategy of ["overwrite", "append"]) {
    h.prefs.set(h.config.prefsPrefix + ".noteStrategy", strategy);
    assert.equal(await q.markTaskCompletedIfArtifactReady(task.id), false);
  }
  h.prefs.set(h.config.prefsPrefix + ".noteStrategy", "skip");
  assert.equal(await q.markTaskCompletedIfArtifactReady(task.id), true);
  assert.equal(task.status, "completed");
});
