import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { URL } from "node:url";
import { TextDecoder } from "node:util";
import vm from "node:vm";
import { transformSync } from "esbuild";

const source = (name) =>
  readFileSync(new URL("../src/" + name, import.meta.url), "utf8");
const locale = {
  getString: (key, options) =>
    key + (options?.args ? " " + JSON.stringify(options.args) : ""),
};
function loadSource(name, imports, globals = {}) {
  const module = { exports: {} };
  if (name !== "modules/llmproviders/shared/completion.ts") {
    imports = {
      "./llmproviders/shared/completion": loadSource(
        "modules/llmproviders/shared/completion.ts",
        { "../../../utils/locale": locale },
      ),
      ...imports,
    };
  }
  const compiled = transformSync(source(name), {
    loader: "ts",
    format: "cjs",
    target: "es2018",
  });
  vm.runInNewContext(
    compiled.code,
    {
      module,
      exports: module.exports,
      Error,
      TextDecoder,
      ...globals,
      require: (specifier) => imports[specifier] || {},
    },
    { filename: name },
  );
  return module.exports;
}
function extractionHost() {
  const counters = { reads: 0, indexes: 0, delays: 0 };
  const files = new Map([["E:/fixture/paper.pdf", "fixture"]]);
  const cachePath = "E:/fixture/.zotero-ft-cache";
  const abort = loadSource("modules/llmproviders/shared/requestAbort.ts", {
    "../../../utils/locale": locale,
  });
  const Fulltext = {
    INDEX_STATE_UNAVAILABLE: 0,
    INDEX_STATE_UNINDEXED: 1,
    INDEX_STATE_PARTIAL: 2,
    INDEX_STATE_INDEXED: 3,
    INDEX_STATE_QUEUED: 4,
    getItemCacheFile: () => ({ path: cachePath }),
    getIndexedState: async () => 3,
    indexItems: async () => {
      counters.indexes++;
    },
  };
  const Zotero = {
    version: "6.0.27",
    getMainWindow: () => undefined,
    Fulltext,
    File: { getContentsAsync: async (path) => files.get(path) || "" },
    Promise: {
      delay: async () => {
        counters.delays++;
      },
    },
  };
  const IOUtils = {
    exists: async (path) => files.has(path),
    stat: async (path) => ({ size: files.get(path)?.length || 0 }),
  };
  const Services = {
    dirsvc: { get: () => ({ path: "E:/isolated-system-temp" }) },
  };
  const pdf = loadSource(
    "modules/pdfExtractor.ts",
    {
      "../utils/locale": locale,
      "../utils/prefs": { getPref: () => undefined },
      "./llmproviders/shared/requestAbort": abort,
    },
    {
      Zotero,
      IOUtils,
      Services,
      Ci: { nsIFile: {} },
      PathUtils: {
        join: (...segments) => segments.join("/"),
        parent: (path) => path.slice(0, path.lastIndexOf("/")),
      },
      ztoolkit: { log() {} },
    },
  );
  const attachment = {
    id: 42,
    key: "TESTONLY",
    attachmentContentType: "application/pdf",
    getField: () => "Fixture PDF",
    getFilePathAsync: async () => "E:/fixture/paper.pdf",
    get attachmentText() {
      counters.reads++;
      return Promise.resolve(files.get(cachePath) || "");
    },
  };
  const extractor = pdf.PDFExtractor;
  // Old code fails immediately rather than spending 30 seconds in each red run.
  if ("TEXT_EXTRACTION_TIMEOUT_MS" in extractor)
    extractor.TEXT_EXTRACTION_TIMEOUT_MS = 0;
  return {
    ...pdf,
    extractor,
    attachment,
    counters,
    files,
    cachePath,
    Zotero,
    IOUtils,
    Services,
    abort,
  };
}

test("warm text returns without reindexing", async () => {
  const host = extractionHost();
  host.files.set(host.cachePath, "Existing text");
  assert.equal(
    await host.extractor.extractTextFromAttachment(host.attachment),
    "Existing text",
  );
  assert.equal(host.counters.indexes, 0);
});
test("INDEXED plus empty cache is repaired once and read immediately", async () => {
  const host = extractionHost();
  host.files.set(host.cachePath, "   ");
  host.Zotero.Fulltext.indexItems = async (ids, options) => {
    host.counters.indexes++;
    assert.deepEqual(Array.from(ids), [42]);
    assert.equal(options.complete, true);
    host.files.set(host.cachePath, "Recovered text");
  };
  assert.equal(
    await host.extractor.extractTextFromAttachment(host.attachment),
    "Recovered text",
  );
  assert.equal(host.counters.indexes, 1);
  assert.equal(host.counters.delays, 0);
});
test("cold cache is read after awaited indexing without polling delay", async () => {
  const host = extractionHost();
  host.Zotero.Fulltext.getIndexedState = async () => 1;
  host.Zotero.Fulltext.indexItems = async () => {
    host.counters.indexes++;
    host.files.set(host.cachePath, "Cold extraction");
  };
  assert.equal(
    await host.extractor.extractTextFromAttachment(host.attachment),
    "Cold extraction",
  );
  assert.equal(host.counters.indexes, 1);
  assert.equal(host.counters.delays, 0);
});
test("resolved indexing with empty output is a terminal typed failure", async () => {
  const host = extractionHost();
  host.Zotero.Fulltext.getIndexedState = async () => 1;
  await assert.rejects(
    host.extractor.extractTextFromAttachment(host.attachment),
    (error) => {
      assert.equal(error.name, "PDFTextExtractionError");
      assert.equal(error.suppressTaskRetry, true);
      assert.ok(error.diagnosticText.includes("index-result"));
      assert.ok(error.message.includes("pdf-error-no-extractable-text"));
      return true;
    },
  );
  assert.equal(host.counters.indexes, 1);
  assert.equal(host.counters.delays, 0);
  assert.ok(host.counters.reads <= 2);
});
test("converter and index exceptions survive in diagnostics", async () => {
  const host = extractionHost();
  Object.defineProperty(host.attachment, "attachmentText", {
    get() {
      throw new Error("converter execution denied");
    },
  });
  host.Zotero.Fulltext.indexItems = async () => {
    host.counters.indexes++;
    throw new Error("index execution denied");
  };
  await assert.rejects(
    host.extractor.extractTextFromAttachment(host.attachment),
    (error) => {
      assert.match(error.diagnosticText, /converter execution denied/);
      assert.match(error.diagnosticText, /index execution denied/);
      return true;
    },
  );
  assert.equal(host.counters.indexes, 1);
});
test("abort after an awaited successful read is not returned as success", async () => {
  const host = extractionHost();
  const signal = { aborted: false };
  Object.defineProperty(host.attachment, "attachmentText", {
    get() {
      signal.aborted = true;
      return Promise.resolve("Late text");
    },
  });
  await assert.rejects(
    host.extractor.extractTextFromPDF(host.attachment, undefined, signal),
    { name: "LLMRequestAbortError" },
  );
  assert.equal(host.counters.indexes, 0);
});
test("abort during index completion prevents subsequent reads", async () => {
  const host = extractionHost();
  const signal = { aborted: false };
  host.Zotero.Fulltext.getIndexedState = async () => 1;
  host.Zotero.Fulltext.indexItems = async () => {
    host.counters.indexes++;
    signal.aborted = true;
    host.files.set(host.cachePath, "Late indexed text");
  };
  await assert.rejects(
    host.extractor.extractTextFromPDF(host.attachment, undefined, signal),
    { name: "LLMRequestAbortError" },
  );
  assert.equal(host.counters.reads, 1);
});
function routingHost() {
  const host = extractionHost();
  const endpoint = {
    id: "test",
    name: "test",
    providerType: "openai-compat",
    model: "test",
  };
  const counts = { attempts: 0, marks: 0 };
  const endpoints = {
    prepareRoute: () => ({ endpoints: [endpoint], maxAttempts: 3 }),
    getMaxAttemptCount: () => 3,
    markEndpointAttempted: () => {
      counts.marks++;
    },
  };
  const llm = loadSource(
    "modules/llmService.ts",
    {
      "../utils/locale": locale,
      "../utils/prefs": { getPref: () => undefined },
      "./llmEndpointManager": { LLMEndpointManager: endpoints },
      "./pdfExtractor": host,
      "./epubExtractor": loadSource("modules/epubExtractor.ts", {
        "../utils/locale": locale,
        "./llmproviders/shared/requestAbort": host.abort,
      }),
      "./llmproviders/shared/requestAbort": host.abort,
      "./llmproviders/shared/retry": {
        getApiRetryDelay: () => 0,
        waitForApiRetry: async () => {},
      },
    },
    { ztoolkit: { log() {} } },
  );
  const queue = loadSource("modules/taskQueue.ts", {
    "../utils/locale": locale,
    "./pdfExtractor": host,
    "./llmproviders/shared/requestAbort": host.abort,
  });
  const failure = new host.PDFTextExtractionError(
    "Fixture extraction failure",
    { itemId: 42, startedAt: "2026-10-18T00:00:00Z", steps: [] },
  );
  return { ...host, ...llm, ...queue, endpoint, counts, failure };
}
for (const method of [
  "runGenerateWithEndpointRouting",
  "runGenerateWithFixedEndpoint",
  "chatWithEndpointRouting",
  "runChatWithFixedEndpoint",
]) {
  test(
    method + " preserves local extraction failures without endpoint retries",
    async () => {
      const host = routingHost();
      host.LLMService.generateOnceWithEndpoint =
        host.LLMService.chatOnceWithEndpoint = async () => {
          host.counts.attempts++;
          throw host.failure;
        };
      const request = {
        transport: {},
        content: { kind: "text", text: "fixture" },
      };
      const operation =
        method === "runGenerateWithEndpointRouting"
          ? host.LLMService[method](request, "prompt")
          : method === "chatWithEndpointRouting"
            ? host.LLMService[method](request, {
                endpoints: [host.endpoint],
                maxAttempts: 3,
              })
            : host.LLMService[method](host.endpoint, request, "prompt");
      await assert.rejects(operation, (error) => error === host.failure);
      assert.equal(host.counts.attempts, 1);
      assert.equal(host.counts.marks, 0);
    },
  );
}
test("real provider errors retain existing endpoint retry cap", async () => {
  const host = routingHost();
  host.LLMService.generateOnceWithEndpoint = async () => {
    host.counts.attempts++;
    throw new host.LLMApiCallError(host.endpoint, new Error("HTTP 503"));
  };
  await assert.rejects(
    host.LLMService.runGenerateWithEndpointRouting({ transport: {} }, "prompt"),
    { name: "LLMApiExhaustedError" },
  );
  assert.equal(host.counts.attempts, 3);
  assert.equal(host.counts.marks, 3);
});
test("queue treats PDF failures as terminal rather than API failures", () => {
  const host = routingHost();
  const queue = Object.create(host.TaskQueueManager.prototype);
  assert.equal(
    queue.shouldSuppressTaskRetry(host.failure, { progress: 40 }),
    true,
  );
  assert.equal(queue.isLikelyApiFailure(host.failure, { progress: 40 }), false);
});
test("queue error details include diagnostics nested under exhausted wrappers", () => {
  const host = routingHost();
  const queue = Object.create(host.TaskQueueManager.prototype);
  queue.getRuntimeDebugInfo = () => ({ zoteroVersion: "6.0.27" });
  const wrapped = new host.LLMApiExhaustedError(3, host.failure);
  const details = queue.buildTaskErrorDetails(
    {
      id: "fixture",
      itemId: 42,
      title: "Fixture",
      retryCount: 0,
      maxRetries: 3,
      progress: 20,
    },
    wrapped,
  );
  assert.ok(details.includes(host.failure.diagnosticText));
  assert.match(details, /likelyApiFailure: false/);
});
test("queue diagnostic traversal tolerates cyclic error causes", () => {
  const host = routingHost();
  const queue = Object.create(host.TaskQueueManager.prototype);
  queue.getRuntimeDebugInfo = () => ({});
  const error = new Error("cyclic failure");
  error.cause = error;
  assert.doesNotThrow(() =>
    queue.buildTaskErrorDetails({ id: "cycle", progress: 0 }, error),
  );
});

test("fulltext cache remains usable when attachmentText throws", async () => {
  const host = extractionHost();
  host.files.set(host.cachePath, "Readable cache");
  Object.defineProperty(host.attachment, "attachmentText", {
    get() {
      throw new Error("temporary getter failure");
    },
  });
  assert.equal(
    await host.extractor.extractTextFromAttachment(host.attachment),
    "Readable cache",
  );
  assert.equal(host.counters.indexes, 0);
});
test("missing linked file fails before converter and indexing calls", async () => {
  const host = extractionHost();
  host.files.clear();
  await assert.rejects(
    host.extractor.extractTextFromAttachment(host.attachment),
    (error) => {
      assert.match(error.message, /pdf-error-file-path-not-found/);
      assert.equal(error.suppressTaskRetry, true);
      return true;
    },
  );
  assert.equal(host.counters.reads, 0);
  assert.equal(host.counters.indexes, 0);
});
test("an already aborted extraction never reads the file", async () => {
  const host = extractionHost();
  await assert.rejects(
    host.extractor.extractTextFromPDF(host.attachment, undefined, {
      aborted: true,
    }),
    { name: "LLMRequestAbortError" },
  );
  assert.equal(host.counters.reads, 0);
  assert.equal(host.counters.indexes, 0);
});
test("cache output can recover even if indexing rejects after writing it", async () => {
  const host = extractionHost();
  host.Zotero.Fulltext.indexItems = async () => {
    host.counters.indexes++;
    host.files.set(host.cachePath, "Usable output");
    throw new Error("index database failure");
  };
  assert.equal(
    await host.extractor.extractTextFromAttachment(host.attachment),
    "Usable output",
  );
  assert.equal(host.counters.indexes, 1);
});
test("single-attachment entry preserves cancellation after a read", async () => {
  const host = extractionHost();
  const signal = { aborted: false };
  Object.defineProperty(host.attachment, "attachmentText", {
    get() {
      signal.aborted = true;
      return Promise.resolve("Late text");
    },
  });
  await assert.rejects(
    host.extractor.extractTextFromAttachment(host.attachment, signal),
    { name: "LLMRequestAbortError" },
  );
});
test("actual generateOnce extraction failure never calls the provider", async () => {
  const host = routingHost();
  let providerCalls = 0;
  let extractionCalls = 0;
  host.LLMService.getProviderForEndpoint = () => ({
    generateSummary: async () => {
      providerCalls++;
    },
  });
  host.LLMService.resolveContent = async () => {
    extractionCalls++;
    return host.extractor.extractTextFromAttachment(host.attachment);
  };
  await assert.rejects(
    host.LLMService.runGenerateWithEndpointRouting(
      { transport: {}, content: {} },
      "prompt",
    ),
    { name: "PDFTextExtractionError" },
  );
  assert.equal(extractionCalls, 1);
  assert.equal(providerCalls, 0);
  assert.equal(host.counts.marks, 0);
});
test("typed extraction lookup supports old wrappers, cycles and foreign realms", () => {
  const host = routingHost();
  const wrapper = { cause: null, originalError: host.failure };
  wrapper.cause = wrapper;
  assert.equal(host.PDFTextExtractionError.find(wrapper), host.failure);
  const foreign = {
    name: "PDFTextExtractionError",
    diagnosticText: "foreign diagnostics",
  };
  assert.equal(
    host.PDFTextExtractionError.find({ lastError: foreign }),
    foreign,
  );
  assert.equal(
    host.PDFTextExtractionError.find({ name: "PDFTextExtractionError" }),
    undefined,
  );
});
test("endpoint abort remains immediate and does not rotate endpoints", async () => {
  const host = routingHost();
  await assert.rejects(
    host.LLMService.runGenerateWithEndpointRouting(
      { transport: { abortSignal: { aborted: true } } },
      "prompt",
    ),
    { name: "LLMRequestAbortError" },
  );
  assert.equal(host.counts.marks, 0);
});
test("normal routed success marks a single endpoint", async () => {
  const host = routingHost();
  const response = { text: "Summary" };
  host.LLMService.generateOnceWithEndpoint = async () => response;
  assert.equal(
    await host.LLMService.runGenerateWithEndpointRouting(
      { transport: {} },
      "prompt",
    ),
    response,
  );
  assert.equal(host.counts.marks, 1);
});

test("an abort raised by the host getter is not swallowed as an empty PDF", async () => {
  const host = extractionHost();
  Object.defineProperty(host.attachment, "attachmentText", {
    get() {
      throw new host.abort.LLMRequestAbortError("cancelled");
    },
  });
  await assert.rejects(
    host.extractor.extractTextFromAttachment(host.attachment),
    { name: "LLMRequestAbortError" },
  );
  assert.equal(host.counters.indexes, 0);
});

test("explicit PDF attachment routing passes cancellation through extraction", async () => {
  const host = routingHost();
  const signal = { aborted: false };
  let seenSignal;
  host.PDFExtractor.extractTextFromAttachment = async (
    _attachment,
    receivedSignal,
  ) => {
    seenSignal = receivedSignal;
    return "attachment text";
  };
  await host.LLMService.resolveContent(
    {},
    { kind: "pdf-attachment", attachment: host.attachment, policy: "text" },
    [],
    false,
    undefined,
    undefined,
    signal,
  );
  assert.equal(seenSignal, signal);
});

test("failed summary task stays failed until the user manually retries", async () => {
  const host = routingHost();
  const queue = Object.create(host.TaskQueueManager.prototype);
  const task = {
    id: "fixture",
    itemId: 42,
    title: "Fixture",
    status: host.TaskStatus.PENDING,
    taskType: "summary",
    retryCount: 0,
    maxRetries: 3,
  };
  const state = { saves: 0, starts: 0 };
  Object.assign(queue, {
    tasks: new Map([[task.id, task]]),
    processingTasks: new Set(),
    taskAbortControllers: new Map(),
    abortingTasks: new Set(),
    isRunning: false,
    isTaskDeletedByUser: () => false,
    saveToStorage: async () => {
      state.saves++;
    },
    updateTaskProgress: (entry, progress, message, meta) => {
      entry.progress = progress;
      entry.stage = meta.stage;
      entry.errorMessage = message;
    },
    getRuntimeDebugInfo: () => ({}),
    notifyComplete() {},
    notifyStream() {},
    start: () => {
      state.starts++;
    },
  });
  const compiled = loadSource(
    "modules/taskQueue.ts",
    {
      "../utils/locale": locale,
      "./pdfExtractor": host,
      "./llmproviders/shared/requestAbort": host.abort,
      "./contentExtractor": {
        ContentExtractor: { hasAnalyzableAttachment: async () => true },
      },
      "./noteGenerator": {
        NoteGenerator: {
          generateNoteForItem: async () => {
            throw host.failure;
          },
        },
      },
    },
    { Zotero: { Items: { getAsync: async () => ({}) } } },
  );
  await compiled.TaskQueueManager.prototype.executeTask.call(queue, task.id);
  assert.equal(task.status, host.TaskStatus.FAILED);
  assert.equal(task.retryCount, 0);
  assert.ok(task.errorDetails.includes(host.failure.diagnosticText));
  assert.equal(task.stage, "failed");
  assert.equal(queue.processingTasks.size, 0);
  assert.equal(queue.taskAbortControllers.size, 0);
  await queue.retryTask(task.id);
  assert.equal(task.status, host.TaskStatus.PRIORITY);
  assert.equal(task.error, undefined);
  assert.equal(task.errorDetails, undefined);
  assert.equal(state.starts, 1);
  assert.ok(state.saves >= 3);
});

test("modern host on-demand PDFWorker text keeps the no-index fast path", async () => {
  const host = extractionHost();
  let workerCalls = 0;
  host.Zotero.version = "modern-source-contract";
  host.Zotero.PDFWorker = {
    getFullText: async (id) => {
      assert.equal(id, 42);
      workerCalls++;
      return { text: "Modern worker text" };
    },
  };
  Object.defineProperty(host.attachment, "attachmentText", {
    get: async () =>
      (await host.Zotero.PDFWorker.getFullText(host.attachment.id)).text,
  });
  assert.equal(
    await host.extractor.extractTextFromAttachment(host.attachment),
    "Modern worker text",
  );
  assert.equal(workerCalls, 1);
  assert.equal(host.counters.indexes, 0);
});

test("index-state query failure does not block a successful text repair", async () => {
  const host = extractionHost();
  host.Zotero.Fulltext.getIndexedState = async () => {
    throw new Error("state query failed");
  };
  host.Zotero.Fulltext.indexItems = async () => {
    host.counters.indexes++;
    host.files.set(host.cachePath, "Repaired despite unavailable statistics");
  };
  assert.equal(
    await host.extractor.extractTextFromAttachment(host.attachment),
    "Repaired despite unavailable statistics",
  );
  assert.equal(host.counters.indexes, 1);
});

test("host abort during indexing is preserved without another extraction", async () => {
  const host = extractionHost();
  host.Zotero.Fulltext.indexItems = async () => {
    throw new host.abort.LLMRequestAbortError("index cancelled");
  };
  await assert.rejects(
    host.extractor.extractTextFromAttachment(host.attachment),
    { name: "LLMRequestAbortError" },
  );
  assert.equal(host.counters.reads, 1);
});

function legacyPathHost() {
  const host = extractionHost();
  const calls = [];
  const removed = [];
  host.Zotero.isWin = true;
  host.Zotero.DataDirectory = { dir: "E:/isolated-library" };
  host.Zotero.getTempDirectory = () => ({ path: "E:/isolated-temp" });
  host.Zotero.Utilities = {
    randomString: () => "fixtureunique123",
    Internal: {
      exec: async (executable, args) => {
        calls.push({ executable, args: [...args] });
        const input = args[args.length - 2];
        const output = args[args.length - 1];
        assert.match(input, /^[\x20-\x7e]+$/);
        assert.equal(host.files.get(input), "fixture");
        host.files.set(output, "Recovered from staged PDF");
      },
    },
  };
  host.Zotero.Fulltext.getPDFConverterExecAndArgs = () => ({
    exec: { path: "E:/runtime/pdftotext.exe" },
    args: ["-datadir", "E:/runtime/poppler-data"],
  });
  host.IOUtils.makeDirectory = async (path, options) => {
    assert.equal(options.ignoreExisting, false);
    if (host.files.has(path)) throw new Error("directory already exists");
    host.files.set(path, "directory");
  };
  host.IOUtils.copy = async (input, output) => {
    host.files.set(output, host.files.get(input));
  };
  host.IOUtils.remove = async (path) => {
    removed.push(path);
    host.files.delete(path);
  };
  host.Zotero.File.pathToFile = (path) => ({
    remove: (recursive) => {
      assert.equal(recursive, false);
      assert.equal(
        [...host.files.keys()].some((entry) => entry.startsWith(path + "/")),
        false,
      );
      removed.push(path);
      host.files.delete(path);
    },
  });
  Object.defineProperty(host.attachment, "attachmentText", {
    get() {
      throw new Error("pdftotext.exe returned exit status 1");
    },
  });
  return { ...host, calls, removed };
}

test("legacy Windows conversion recovers from safe staged paths and removes copies", async () => {
  const host = legacyPathHost();
  assert.equal(
    await host.extractor.extractTextFromAttachment(host.attachment),
    "Recovered from staged PDF",
  );
  assert.equal(host.calls.length, 1);
  assert.equal(host.counters.indexes, 1);
  assert.ok(host.calls[0].args.includes("-nopgbrk"));
  assert.deepEqual(host.Zotero.Fulltext.getPDFConverterExecAndArgs().args, [
    "-datadir",
    "E:/runtime/poppler-data",
  ]);
  assert.equal(host.files.get("E:/fixture/paper.pdf"), "fixture");
  assert.equal(
    [...host.files.keys()].some((path) => path.includes("ai-butler-pdf-")),
    false,
  );
});

test("staged converter failure keeps diagnostics and removes private copies", async () => {
  const host = legacyPathHost();
  host.Zotero.Utilities.Internal.exec = async () => {
    throw new Error("staged converter rejected the PDF");
  };
  await assert.rejects(
    host.extractor.extractTextFromAttachment(host.attachment),
    (error) => {
      assert.equal(error.name, "PDFTextExtractionError");
      assert.ok(
        error.diagnosticText.includes("staged converter rejected the PDF"),
      );
      return true;
    },
  );
  assert.equal(
    [...host.files.keys()].some((path) => path.includes("ai-butler-pdf-")),
    false,
  );
});

test("cancellation after staging copy prevents converter execution and still cleans up", async () => {
  const host = legacyPathHost();
  const signal = { aborted: false };
  host.IOUtils.copy = async (input, output) => {
    host.files.set(output, host.files.get(input));
    signal.aborted = true;
  };
  await assert.rejects(
    host.extractor.extractTextFromAttachment(host.attachment, signal),
    (error) => error.name === "LLMRequestAbortError",
  );
  assert.equal(host.calls.length, 0);
  assert.equal(
    [...host.files.keys()].some((path) => path.includes("ai-butler-pdf-")),
    false,
  );
});

test("non-ASCII temporary roots are not passed to the legacy converter", async () => {
  const host = legacyPathHost();
  host.Zotero.DataDirectory.dir = "E:/资料库";
  host.Zotero.getTempDirectory = () => ({ path: "E:/临时目录" });
  host.Services.dirsvc.get = () => ({ path: "E:/系统临时目录" });
  await assert.rejects(
    host.extractor.extractTextFromAttachment(host.attachment),
    (error) => {
      assert.ok(error.diagnosticText.includes("ASCII"));
      return true;
    },
  );
  assert.equal(host.calls.length, 0);
});

test("staging does not remove a pre-existing directory after a name collision", async () => {
  const host = legacyPathHost();
  host.IOUtils.makeDirectory = async () => {
    throw new Error("directory already exists");
  };
  await assert.rejects(
    host.extractor.extractTextFromAttachment(host.attachment),
  );
  assert.equal(host.removed.length, 0);
  assert.equal(host.calls.length, 0);
});

test("unwritable library root falls back to the host temporary root", async () => {
  const host = legacyPathHost();
  const createDirectory = host.IOUtils.makeDirectory;
  host.IOUtils.makeDirectory = async (path, options) => {
    if (path.startsWith("E:/isolated-library/"))
      throw new Error("read-only directory");
    return createDirectory(path, options);
  };
  assert.equal(
    await host.extractor.extractTextFromAttachment(host.attachment),
    "Recovered from staged PDF",
  );
  assert.ok(host.calls[0].args.at(-2).startsWith("E:/isolated-temp/"));
});

test("Unicode library and host temporary roots use an ASCII system temporary root", async () => {
  const host = legacyPathHost();
  host.Zotero.DataDirectory.dir = "E:/资料库";
  host.Zotero.getTempDirectory = () => ({ path: "E:/资料库/tmp" });
  assert.equal(
    await host.extractor.extractTextFromAttachment(host.attachment),
    "Recovered from staged PDF",
  );
  assert.ok(host.calls[0].args.at(-2).startsWith("E:/isolated-system-temp/"));
});

function clipboardHost(nativeCopy, browserCopy) {
  const notifications = [];
  const created = [];
  const win = {
    navigator: {
      clipboard: browserCopy ? { writeText: browserCopy } : undefined,
    },
    document: {
      body: { appendChild() {} },
      createElement() {
        throw new Error("XUL textarea has no select()");
      },
      createElementNS(namespace, tagName) {
        const element = {
          namespace,
          tagName,
          style: {},
          select() {},
          remove() {
            element.removed = true;
          },
        };
        created.push(element);
        return element;
      },
      execCommand: () => false,
    },
  };
  const { TaskQueueView } = loadSource(
    "modules/views/TaskQueueView.ts",
    {
      "./BaseView": { BaseView: class {} },
      "../../utils/locale": locale,
    },
    {
      Zotero: {
        getMainWindow: () => win,
        Utilities: { Internal: { copyTextToClipboard: nativeCopy } },
      },
      ztoolkit: {
        log() {},
        ProgressWindow: class {
          createLine(line) {
            notifications.push(line);
            return this;
          }
          show() {}
        },
      },
    },
  );
  return {
    view: Object.create(TaskQueueView.prototype),
    notifications,
    created,
    win,
  };
}

test("task error copy uses host-native clipboard without browser permissions", async () => {
  const copies = [];
  const host = clipboardHost((text) => copies.push(text));
  await host.view.copyTextToClipboard("PDF diagnostics 中文");
  assert.deepEqual(copies, ["PDF diagnostics 中文"]);
  assert.equal(host.notifications[0].type, "success");
  assert.equal(host.created.length, 0);
});

test("clipboard fallback uses HTML namespace and does not claim success on false", async () => {
  const host = clipboardHost(
    () => {
      throw new Error("native clipboard unavailable");
    },
    async () => {
      throw new Error("browser copy denied");
    },
  );
  await host.view.copyTextToClipboard("PDF diagnostics");
  assert.equal(host.created.length, 1);
  assert.equal(host.created[0].namespace, "http://www.w3.org/1999/xhtml");
  assert.equal(host.created[0].removed, true);
  assert.equal(host.notifications[0].type, "fail");
});
