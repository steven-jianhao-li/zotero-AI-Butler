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
      export { LLMTransportError } from './src/modules/llmproviders/shared/requestMonitor';
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

const frame = (value) => `data: ${JSON.stringify(value)}\n\n`;
const answer = frame({ choices: [{ delta: { content: "answer" } }] });
const done =
  frame({ choices: [{ delta: {}, finish_reason: "stop" }] }) +
  "data: [DONE]\n\n";

function connection(h) {
  let resolve;
  let reject;
  let aborts = 0;
  let sentOptions;
  const pending = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const xhr = {
    status: 200,
    response: "",
    onprogress: null,
    abort() {
      aborts++;
      reject(new Error("host request aborted"));
    },
  };
  h.globals.Zotero.HTTP = {
    request(_method, _url, options) {
      sentOptions = options;
      options.requestObserver(xhr);
      return pending;
    },
  };
  return {
    get aborts() {
      return aborts;
    },
    get sentOptions() {
      return sentOptions;
    },
    send(text) {
      xhr.response += text;
      xhr.onprogress?.();
    },
    progress() {
      xhr.onprogress?.();
    },
    finish(text = "") {
      xhr.response += text;
      resolve(xhr);
    },
  };
}

function request(h, options = {}) {
  return h.requestLLMText({
    protocol: "chat",
    provider: "openai-compat",
    url: "https://user:secret@fixture.invalid/v1/chat/completions?key=secret",
    headers: { Authorization: "Bearer secret" },
    payload: { model: "fixture", messages: [] },
    options: {
      model: "fixture",
      stream: true,
      requestTimeoutMs: 100,
      ...options,
    },
  });
}

test("heartbeats keep streaming alive beyond the response timeout without a UI callback", async (t) => {
  const h = host(t);
  const c = connection(h);
  const activity = [];
  const pending = request(h, {
    onActivity: (event) => activity.push(event.kind),
  });
  t.mock.timers.tick(80);
  c.send(": heartbeat\n\n");
  t.mock.timers.tick(80);
  c.send(frame({ choices: [{ delta: { reasoning_content: "thinking" } }] }));
  assert.deepEqual(activity, ["receiving"]);
  t.mock.timers.tick(80);
  c.send(answer + done);
  c.finish();
  const result = await pending;
  assert.equal(result.completion, "complete");
  assert.equal(result.text, "answer");
  assert.deepEqual(activity, ["receiving", "content"]);
  assert.equal(result.requestDiagnostics.firstByteMs, 80);
  assert.equal(result.requestDiagnostics.firstContentMs, 240);
  assert.equal(result.requestDiagnostics.totalTimeoutMs, 600);
  assert.equal(result.requestDiagnostics.endpointHost, "fixture.invalid");
  assert.ok(!JSON.stringify(result.requestDiagnostics).includes("secret"));
  assert.equal(c.sentOptions.timeout, 0);
  t.mock.timers.tick(2000);
  assert.equal(c.aborts, 0);
});

test("no response data times out and cancels the request", async (t) => {
  const h = host(t);
  const c = connection(h);
  const checked = assert.rejects(request(h), (error) => {
    assert.equal(error.requestDiagnostics.timeoutKind, "first-response");
    assert.equal(error.requestDiagnostics.receivedChars, 0);
    return true;
  });
  t.mock.timers.tick(100);
  await checked;
  t.mock.timers.tick(1000);
  assert.equal(c.aborts, 1);
});

test("progress notifications without new data do not reset the idle timeout", async (t) => {
  const h = host(t);
  const c = connection(h);
  const checked = assert.rejects(request(h), (error) => {
    assert.equal(error.requestDiagnostics.timeoutKind, "idle");
    assert.equal(error.requestDiagnostics.firstByteMs, 10);
    assert.equal(error.requestDiagnostics.lastActivityMs, 10);
    return true;
  });
  t.mock.timers.tick(10);
  c.send(": heartbeat\n\n");
  t.mock.timers.tick(80);
  c.progress();
  t.mock.timers.tick(20);
  await checked;
});

test("continuous heartbeats still obey the finite total deadline", async (t) => {
  const h = host(t);
  const c = connection(h);
  const checked = assert.rejects(request(h), (error) => {
    assert.equal(error.requestDiagnostics.timeoutKind, "total");
    assert.equal(error.requestDiagnostics.elapsedMs, 600);
    return true;
  });
  for (let i = 0; i < 7; i++) {
    t.mock.timers.tick(80);
    c.send(": heartbeat\n\n");
  }
  t.mock.timers.tick(40);
  await checked;
  assert.equal(c.aborts, 1);
});

test("an idle timeout preserves partial text without declaring success", async (t) => {
  const h = host(t);
  const c = connection(h);
  const pending = request(h);
  c.send(answer);
  t.mock.timers.tick(100);
  const result = await pending;
  assert.equal(result.completion, "partial");
  assert.equal(result.text, "answer");
  assert.equal(result.requestDiagnostics.timeoutKind, "idle");
});

test("non-streaming retains a total timeout even when data arrives", async (t) => {
  const h = host(t);
  const c = connection(h);
  const checked = assert.rejects(request(h, { stream: false }), (error) => {
    assert.equal(error.requestDiagnostics.timeoutKind, "total");
    assert.equal(error.requestDiagnostics.totalTimeoutMs, 100);
    return true;
  });
  t.mock.timers.tick(80);
  c.send("{");
  t.mock.timers.tick(20);
  await checked;
});

test("final bytes are read without progress events and non-streaming content is timed", async (t) => {
  const h = host(t);
  const c = connection(h);
  const pending = request(h, { stream: false });
  t.mock.timers.tick(70);
  c.finish(
    JSON.stringify({
      choices: [{ message: { content: "answer" }, finish_reason: "stop" }],
    }),
  );
  const result = await pending;
  assert.equal(result.completion, "complete");
  assert.equal(result.requestDiagnostics.firstContentMs, 70);
});

test("user cancellation clears deadlines and is not reported as a timeout", async (t) => {
  const h = host(t);
  const c = connection(h);
  const controller = new AbortController();
  const checked = assert.rejects(
    request(h, { abortSignal: controller.signal }),
    { name: "LLMRequestAbortError" },
  );
  controller.abort();
  await checked;
  t.mock.timers.tick(1000);
  assert.equal(c.aborts, 1);
});

function endpoint(h, id = "one") {
  return {
    id,
    name: id,
    providerType: "openai-compat",
    apiUrl: "https://fixture.invalid",
    apiKey: "secret",
    model: "fixture",
    enabled: true,
    createdAt: "",
    updatedAt: "",
  };
}

test("service exposes connection activity before any answer text, without onProgress", async (t) => {
  const h = host(t);
  h.LLMEndpointManager.saveEndpoints([endpoint(h)]);
  const c = connection(h);
  const statuses = [];
  const pending = h.LLMService.generate({
    task: "summary",
    prompt: "summarize",
    content: { kind: "text", text: "paper" },
    transport: {
      retry: false,
      onStatus: (event) => statuses.push(event.stage),
    },
  });
  await flush();
  c.send(": heartbeat\n\n");
  assert.equal(statuses.at(-1), "llm-receiving");
  assert.ok(!statuses.includes("llm-streaming"));
  c.send(answer + done);
  c.finish();
  assert.equal((await pending).completion, "complete");
  assert.ok(statuses.includes("llm-streaming"));
});

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
