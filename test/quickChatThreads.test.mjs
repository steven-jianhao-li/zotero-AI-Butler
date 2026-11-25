import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { setImmediate } from "node:timers";
import { URL } from "node:url";
import vm from "node:vm";
import { transformSync } from "esbuild";
import { marked } from "marked";

const sidebarSource = readFileSync(
  new URL("../src/modules/ItemPaneSection.ts", import.meta.url),
  "utf8",
);
const persistSource = readFileSync(
  new URL("../src/modules/chatPersist.ts", import.meta.url),
  "utf8",
);
const customizationSource = readFileSync(
  new URL("../src/modules/uiCustomization.ts", import.meta.url),
  "utf8",
);
const locale = { getString: (id) => id };

function load(source, imports = {}, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(
    transformSync(source, {
      loader: "ts",
      format: "cjs",
      target: "es2018",
      supported: { "dynamic-import": false },
    }).code,
    {
      module,
      exports: module.exports,
      require: (name) => imports[name] || {},
      ztoolkit: { log() {} },
      setTimeout: () => 1,
      clearTimeout() {},
      ...globals,
    },
  );
  return module.exports;
}

class Element {
  dataset = {};
  children = [];
  style = {};
  listeners = new Map();
  isConnected = true;
  disabled = false;

  constructor(tag) {
    this.tag = tag;
  }

  appendChild(child) {
    this.children.push(child);
  }

  getClientRects() {
    return [];
  }

  get childElementCount() {
    return this.children.length;
  }

  focus() {
    this.focusCount = (this.focusCount || 0) + 1;
  }

  find(predicate) {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const found = child.find(predicate);
      if (found) return found;
    }
    return null;
  }

  querySelector(selector) {
    return this.find((element) =>
      selector
        .split(", ")
        .some(
          (part) =>
            part === "#" + element.id ||
            part === "." + element.className ||
            (part === "[data-pair-id]" && element["data-pair-id"]),
        ),
    );
  }

  querySelectorAll() {
    return [];
  }

  setAttribute(name, value) {
    this[name] = value;
  }

  set innerHTML(value) {
    this.html = value;
    this.children = [];
  }

  addEventListener(type, handler) {
    this.listeners.set(type, handler);
  }

  async click() {
    if (!this.disabled) await this.listeners.get("click")?.();
  }
}

const doc = {
  createElement: (tag) => new Element(tag),
  addEventListener() {},
  getElementById: () => null,
};

function sidebar(imports = {}, globals = {}) {
  return load(
    `${sidebarSource}
export { getAvailableSidebarTabs, renderSidebarTabPanel, createQuickChatPairActions, renderChatArea, renderQuickChatAnswer, resetQuickChatState };
export const getState = () => currentChatState;
renderImageSummarySection = (...args) => __renderImage(...args);
copyQuickChatText = (...args) => __copy(...args);
saveChatPairToNote = (...args) => __save(...args);`,
    { "../utils/locale": locale, ...imports },
    globals,
  );
}

function tableFixture({ generationEnabled, tableVisible = true, content }) {
  const preferences = {
    enableTableFeature: generationEnabled,
    sidebarModuleVisibility: JSON.stringify({
      actionButtons: false,
      quickChat: false,
      note: false,
      deepRead: false,
      mindmap: false,
      imageSummary: false,
      table: tableVisible,
    }),
  };
  const prefs = {
    getPref: (key) => preferences[key],
  };
  const generated = [];
  const customization = load(customizationSource, { "../utils/prefs": prefs });
  const ui = sidebar(
    {
      "../utils/prefs": prefs,
      "./uiCustomization": customization,
      "./literatureReviewService": {
        LiteratureReviewService: {
          findTableNote: async () => content,
          fillTableForSinglePDF: async (item) => {
            generated.push(item.id);
            return "Generated table";
          },
          saveTableNote: async () => {},
        },
      },
      "../utils/prompts": {
        getConfiguredTableTemplate: () => "Template",
        getConfiguredTableFillPrompt: () => "Prompt",
      },
      marked: { marked },
    },
    {
      Zotero: {
        Items: { getAsync: async () => ({ isPDFAttachment: () => true }) },
      },
    },
  );
  const panel = new Element("div");
  const item = { id: 7, getNotes: () => [], getAttachments: () => [8] };
  return { preferences, ui, panel, item, generated };
}

test("saved tables remain readable when generation and image summaries are disabled (#427)", async () => {
  const { ui, panel } = tableFixture({
    generationEnabled: false,
    content: "| Paper | Result |\n| --- | --- |\n| Example | Preserved |",
  });
  assert.deepEqual(
    Array.from(ui.getAvailableSidebarTabs(), (tab) => tab.id),
    ["quickRead"],
  );
  ui.renderSidebarTabPanel("quickRead", panel, doc, { id: 7 });
  await new Promise(setImmediate);
  const section = panel.children[0];
  assert.equal(section.className, "ai-butler-table-section");
  const button = section.children[0].children[1].children[0];
  assert.equal(button.disabled, true);
  assert.equal(button.title, "itempane-table-generation-disabled");
  assert.ok(
    section.children.some(
      (child) => child.textContent === "itempane-table-generation-disabled",
    ),
  );
  const tableContent = section.children
    .flatMap((child) => child.children)
    .find((child) => child.id === "ai-butler-table-content");
  assert.match(tableContent.html, /<td>Preserved<\/td>/);
});

test("a paper without a table still shows the disabled-generation explanation (#427)", async () => {
  const { ui, panel } = tableFixture({ generationEnabled: false, content: "" });
  ui.renderSidebarTabPanel("quickRead", panel, doc, { id: 7 });
  await new Promise(setImmediate);
  const section = panel.children[0];
  assert.ok(section, "The checked table section must not disappear");
  assert.ok(
    section.children.some(
      (child) => child.textContent === "itempane-table-generation-disabled",
    ),
  );
  const tableContent = section.children
    .flatMap((child) => child.children)
    .find((child) => child.id === "ai-butler-table-content");
  assert.match(tableContent.html, /itempane-table-empty/);
});

test("table visibility and generation remain separate controls (#427)", async () => {
  const { ui, panel, preferences, item, generated } = tableFixture({
    generationEnabled: true,
  });
  ui.renderSidebarTabPanel("quickRead", panel, doc, item);
  const section = panel.children[0];
  assert.equal(section.children[0].children[1].children[0].disabled, false);
  assert.equal(
    section.children.some(
      (child) => child.textContent === "itempane-table-generation-disabled",
    ),
    false,
  );
  const button = section.children[0].children[1].children[0];
  await button.click();
  assert.deepEqual(generated, [7]);
  preferences.enableTableFeature = false;
  // A stale button must not start a generation after the global toggle changes.
  await button.click();
  assert.deepEqual(generated, [7]);

  const hidden = tableFixture({ generationEnabled: true, tableVisible: false });
  assert.equal(hidden.ui.getAvailableSidebarTabs().length, 0);
});

function closure(start, end) {
  const first = sidebarSource.indexOf(`  const ${start} =`);
  const last = sidebarSource.indexOf(`  const ${end} =`, first);
  assert.ok(first >= 0 && last > first, `Cannot locate ${start}`);
  return sidebarSource.slice(first, last);
}

function threadFixture() {
  const persist = load(persistSource, { "../utils/locale": locale });
  const copied = [];
  const saved = [];
  const marked = [];
  const ui = sidebar(
    {},
    {
      __copy: async (_doc, text) => {
        copied.push(text);
        return true;
      },
      __save: async (...args) => {
        saved.push(args);
      },
    },
  );
  const currentChatState = {
    itemId: 7,
    threadId: "b",
    conversationHistory: [],
    relatedItems: [{ itemId: 202, title: "Paper B" }],
    relatedMode: "summary",
    relatedContextSignature: "summary:202",
    relatedContextIncludedCount: 1,
  };
  const messagesArea = new Element("div");
  let relatedRenders = 0;
  const bind = load(
    closure("appendPairActions", "refreshThreadSelect") +
      closure("bindThreadToState", "ensureActiveThreadLoaded") +
      "\nexport { bindThreadToState };",
    {},
    {
      currentChatState,
      messagesArea,
      doc,
      item: { id: 7 },
      createQuickChatPairActions: ui.createQuickChatPairActions,
      cloneChatContext: persist.cloneChatContext,
      normalizeChatMessages: persist.normalizeChatMessages,
      chatPersist: { markPairSaved: (...args) => marked.push(args) },
      getString: locale.getString,
      escapeHtmlForChat: (text) => text,
      renderQuickChatAnswer: ui.renderQuickChatAnswer,
      renderRelatedControls: () => {
        relatedRenders++;
      },
      refreshThreadSelect() {},
      syncQuickChatThreadControls() {},
    },
  ).bindThreadToState;
  return {
    bind,
    currentChatState,
    messagesArea,
    copied,
    saved,
    marked,
    relatedRenders: () => relatedRenders,
  };
}

test("thread switches restore context and clear it for new or legacy threads (#427)", () => {
  const fixture = threadFixture();
  const context = {
    relatedItems: [{ itemId: 101, title: "Paper A" }],
    relatedMode: "fullText",
    relatedContextSignature: "fullText:101",
    relatedContextIncludedCount: 1,
  };
  fixture.bind({
    id: "a",
    context,
    messages: [{ role: "user", content: "Compare A" }],
  });
  const state = fixture.currentChatState;
  assert.equal(state.threadId, "a");
  assert.equal(state.relatedItems[0].itemId, 101);
  assert.equal(state.relatedMode, "fullText");
  assert.equal(state.relatedContextSignature, "fullText:101");
  assert.equal(state.relatedContextIncludedCount, 1);
  assert.equal(fixture.relatedRenders(), 1);
  state.relatedItems[0].title = "Changed locally";
  assert.equal(context.relatedItems[0].title, "Paper A");
  fixture.bind({ id: "legacy", messages: [] });
  assert.equal(state.relatedItems.length, 0);
  assert.equal(state.relatedMode, "summary");
  assert.equal(state.relatedContextSignature, "");
  assert.equal(state.relatedContextIncludedCount, 0);
});

test("restored replies copy and save the original question, answer, and metadata (#427)", async () => {
  const fixture = threadFixture();
  const metadata = { modelId: "test-model", providerId: "test-provider" };
  fixture.bind({
    id: "a",
    messages: [
      {
        role: "user",
        content: "Internal context\nQuestion?",
        displayContent: "Question?",
      },
      {
        role: "assistant",
        content: "Answer with $x^2$",
        pairId: "stable-pair",
        noteMetadata: metadata,
        sourceLabel: "Paper A",
      },
    ],
  });
  const pair = fixture.messagesArea.children[0];
  assert.ok(pair.children[0].html.includes("Question?"));
  assert.ok(!pair.children[0].html.includes("Internal context"));
  const actions = pair.children.find(
    (element) => element.className === "ai-butler-quick-chat-actions",
  );
  assert.ok(actions);
  const [copy, save] = actions.children;
  await copy.click();
  assert.deepEqual(fixture.copied, ["Answer with $x^2$"]);
  await save.click();
  await save.click();
  assert.equal(fixture.saved.length, 1);
  assert.deepEqual(fixture.saved[0].slice(1, 4), [
    "stable-pair",
    "Question?",
    "Answer with $x^2$",
  ]);
  assert.equal(fixture.saved[0][4].modelId, metadata.modelId);
  assert.equal(fixture.saved[0][5], "Paper A");
  assert.deepEqual(fixture.marked, [[7, "a", "stable-pair"]]);
  assert.equal(
    fixture.currentChatState.conversationHistory[1].savedToNote,
    true,
  );
  assert.equal(save.disabled, true);
  fixture.bind({
    id: "a",
    messages: fixture.currentChatState.conversationHistory,
  });
  const restoredActions = fixture.messagesArea.children[0].children.at(-1);
  assert.equal(restoredActions.children[1].disabled, true);
  assert.equal(restoredActions.children[1].textContent, "itempane-saved");
});

test("legacy history gets working actions and stable pair IDs (#427)", async () => {
  const fixture = threadFixture();
  const legacy = {
    id: "legacy",
    messages: [
      { role: "user", content: "Old question" },
      { role: "assistant", content: "Old answer" },
    ],
  };
  fixture.bind(legacy);
  const pairId = fixture.messagesArea.children[0]["data-pair-id"];
  fixture.bind(legacy);
  const pair = fixture.messagesArea.children[0];
  assert.equal(pair["data-pair-id"], pairId);
  await pair.children.at(-1).children[1].click();
  assert.equal(fixture.saved[0][2], "Old question");
  assert.equal(fixture.saved[0][3], "Old answer");
});

test("a failed note save can be retried without marking the reply as saved (#427)", async () => {
  let attempts = 0;
  let marked = 0;
  const ui = sidebar(
    {},
    {
      __save: async () => {
        if (++attempts === 1) throw new Error("disk error");
      },
    },
  );
  const answer = { role: "assistant", content: "Answer" };
  const actions = ui.createQuickChatPairActions(
    doc,
    { id: 7 },
    "pair",
    "Question",
    answer,
    () => {
      marked++;
    },
  );
  const save = actions.children[1];
  await save.click();
  assert.equal(marked, 0);
  assert.equal(save.disabled, false);
  assert.equal(answer.savedToNote, undefined);
  await save.click();
  assert.equal(marked, 1);
  assert.equal(save.disabled, true);
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function moduleSource(name) {
  return readFileSync(
    new URL(`../src/modules/${name}.ts`, import.meta.url),
    "utf8",
  );
}

async function chatProfile(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "butler-quick-chat-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { ChatPersist, ...persist } = load(persistSource, {
    "../utils/locale": locale,
  });
  const io = {
    getDirectory: () => dir,
    ensureDirectory: async () => {},
    exists: (file) =>
      access(file).then(
        () => true,
        () => false,
      ),
    read: (file) => readFile(file, "utf8"),
    write: (file, value) => writeFile(file, value, "utf8"),
    join: path.join,
  };
  return async (chat, imports = {}, globals = {}) => {
    const deps = {
      "../utils/locale": locale,
      "./llmproviders/shared/requestAbort": load(
        moduleSource("llmproviders/shared/requestAbort"),
        {
          "../../../utils/locale": locale,
        },
      ),
      ...imports,
    };
    deps["./contentExtractor"] = load(moduleSource("contentExtractor"), deps);
    const chatPersist = new ChatPersist(io);
    await chatPersist.ensureLoaded();
    const ui = sidebar({
      "../utils/prefs": {
        getPref: (key) => key === "quickChatSuppressNewConversationWarning",
      },
      "./chatPersist": { ...persist, chatPersist },
      "../utils/streamingMarkdownRenderer": load(
        moduleSource("../utils/streamingMarkdownRenderer"),
      ),
      "./chatContext": load(moduleSource("chatContext"), {
        "../utils/locale": locale,
      }),
      "./quickChatRelatedContext": load(
        moduleSource("quickChatRelatedContext"),
        deps,
        globals,
      ),
      "./llmService": {
        __esModule: true,
        default: { chat, getEffectivePdfProcessMode: () => "text" },
      },
      "./llmNoteMetadata": {
        LLMNoteMetadataService: { fromResponse: () => null },
      },
      ...deps,
    });
    async function open(itemId = 7, preload = false) {
      const panel = new Element("div");
      ui.renderChatArea(panel, doc, { id: itemId }, preload);
      await new Promise(setImmediate);
      const state = ui.getState();
      if (!preload) state.pdfContent = "Paper " + itemId;
      const input = panel.find((element) => element.tag === "textarea");
      const send = panel.find((element) => element.title === "itempane-send");
      const stop = panel.find(
        (element) => element.title === "itempane-stop-current",
      );
      const messages = panel.querySelector(".ai-butler-quick-chat-messages");
      return {
        state,
        input,
        send,
        stop,
        panel,
        messages,
        ask(question) {
          input.value = question;
          return send.click();
        },
      };
    }
    return { chatPersist, open, ui };
  };
}

function pausedChat(options) {
  const started = deferred();
  const chat = (request) => {
    started.resolve(request);
    if (options.partial) request.onProgress(options.partial);
    return new Promise((resolve, reject) => {
      options.finish = () => resolve({ text: "Late reply" });
      options.reject = () => reject(new Error("Cancelled"));
      if (!options.delayAbort)
        request.transport.abortSignal.addEventListener("abort", options.reject);
    });
  };
  return { chat, started: started.promise };
}

for (const partial of ["Partial answer", ""]) {
  test(`stopping with ${partial ? "partial text" : "no tokens"} survives a follow-up and profile reload (#457)`, async (t) => {
    const profile = await chatProfile(t);
    const blocked = pausedChat({ partial });
    const calls = [];
    const session = await profile((request) => {
      calls.push(request.conversation);
      return calls.length === 1 ? blocked.chat(request) : { text: "Finished" };
    });
    const a = await session.open();
    const pending = a.ask("Interrupted question");
    await blocked.started;
    await a.stop.click();
    await pending;
    const marker = partial ? "itempane-stopped-note" : "itempane-stopped-empty";
    const checkStoppedPair = (messages) => {
      const pair = messages.children[0];
      assert.match(pair.children[0].html, /Interrupted question/);
      assert.ok(pair.children[1].html.includes(partial));
      assert.ok(pair.children[1].html.includes(marker));
      assert.equal(pair.children.length, partial ? 3 : 2);
    };
    checkStoppedPair(a.messages);
    assert.equal(a.send.disabled, false);
    assert.equal(a.stop.style.display, "none");
    assert.equal(a.input.disabled, false);
    await a.ask("Next question");
    assert.deepEqual(
      Array.from(calls[1], (m) => m.content),
      ["Next question"],
    );
    await session.chatPersist.flush();
    const restarted = await profile((request) => {
      calls.push(request.conversation);
      return { text: "Third answer" };
    });
    const b = await restarted.open();
    checkStoppedPair(b.messages);
    const history = b.state.conversationHistory;
    assert.equal(history.length, 4);
    assert.equal(history[1].pairId, history[0].pairId);
    assert.equal(history[1].stopped, true);
    await b.ask("Third question");
    assert.deepEqual(
      Array.from(calls[2], (m) => m.content),
      ["Next question", "Finished", "Third question"],
    );
  });
}

test("a failed request restores its question without a stopped label (#457)", async (t) => {
  const profile = await chatProfile(t);
  const session = await profile(() => {
    throw new Error("Provider failure");
  });
  const active = await session.open();
  await active.ask("Failed question");
  await session.chatPersist.flush();
  const restored = await (await profile()).open();
  assert.equal(restored.messages.children[0].children.length, 1);
  assert.match(
    restored.messages.children[0].children[0].html,
    /Failed question/,
  );
});

test("legacy interrupted questions and partial answers restore without entering prompts (#457)", async (t) => {
  const profile = await chatProfile(t);
  const first = await profile();
  const thread = first.chatPersist.createThread(7);
  first.chatPersist.saveMessages(7, thread.id, [
    { role: "user", content: "Old question" },
    { role: "assistant", content: "Old answer" },
    { role: "user", content: "Interrupted", pairId: "partial" },
    {
      role: "assistant",
      content: "Fragment",
      pairId: "partial",
      stopped: true,
    },
    { role: "user", content: "No tokens", pairId: "empty" },
  ]);
  await first.chatPersist.flush();
  let prompt;
  const restarted = await profile((request) => {
    prompt = request.conversation;
    return { text: "New answer" };
  });
  const active = await restarted.open();
  assert.ok(
    active.messages.children[1].children[1].html.includes(
      "itempane-stopped-note",
    ),
  );
  assert.ok(
    active.messages.children[2].children[1].html.includes(
      "itempane-stopped-empty",
    ),
  );
  await active.ask("Continue");
  assert.deepEqual(
    Array.from(prompt, (m) => m.content),
    ["Old question", "Old answer", "Continue"],
  );
});

test("a late provider success cannot overwrite or unlock a newer request (#427)", async (t) => {
  const profile = await chatProfile(t);
  const old = { delayAbort: true };
  const next = { delayAbort: true };
  const first = pausedChat(old);
  const second = pausedChat(next);
  const session = await profile((request) =>
    request.content.content === "Paper 7"
      ? first.chat(request)
      : second.chat(request),
  );
  const a = await session.open();
  const sending = a.ask("Question A");
  const request = await first.started;
  session.ui.resetQuickChatState(8);
  const b = await session.open(8);
  const newer = b.ask("Question B");
  await second.started;
  request.onProgress("Late text");
  old.finish();
  await sending;
  assert.equal(b.send.disabled, true);
  assert.ok(b.state.abortController);
  assert.equal(a.input.focusCount, undefined);
  assert.equal(
    session.chatPersist.getThread(7, a.state.threadId).messages.length,
    1,
  );
  assert.equal(b.state.conversationHistory.length, 1);
  next.finish();
  await newer;
});

for (const change of ["switch", "clear", "delete", "newer turn"]) {
  test(`late cancellation respects ${change} in the same paper (#457)`, async (t) => {
    const profile = await chatProfile(t);
    const old = { partial: "Fragment", delayAbort: true };
    const blocked = pausedChat(old);
    const session = await profile(blocked.chat);
    const a = await session.open();
    const origin = a.state.threadId;
    a.state.relatedMode = "fullText";
    const sending = a.ask("Question A");
    await blocked.started;
    const store = session.chatPersist;
    const selected = store.createThread(7);
    store.saveMessages(
      7,
      selected.id,
      [{ role: "user", content: "Other thread" }],
      {
        relatedItems: [{ itemId: 22, title: "Other source" }],
        relatedMode: "summary",
        relatedContextSignature: "summary:22",
        relatedContextIncludedCount: 1,
      },
    );
    session.ui.resetQuickChatState(7);
    const b = await session.open();
    assert.equal(b.state.threadId, selected.id);
    if (change === "clear") store.saveMessages(7, origin, []);
    if (change === "delete") store.deleteThread(7, origin);
    if (change === "newer turn")
      store.saveMessages(7, origin, [
        ...store.getThread(7, origin).messages,
        { role: "user", content: "New turn", pairId: "new-id" },
      ]);
    await a.stop.click();
    old.reject();
    await sending;
    await store.flush();
    const { chatPersist: restored } = await profile();
    const active = restored.getOrCreateActiveThread(7);
    assert.equal(active.id, selected.id);
    assert.equal(active.context.relatedItems[0].itemId, 22);
    assert.equal(active.messages[0].content, "Other thread");
    const thread = restored.getThread(7, origin);
    if (change === "switch") {
      assert.equal(thread.context.relatedMode, "fullText");
      assert.equal(thread.messages.at(-1).stopped, true);
      assert.equal(thread.messages.at(-1).content, "Fragment");
      assert.ok(
        a.messages.children
          .at(-1)
          .children[1].html.includes("itempane-stopped-note"),
      );
    }
    if (change === "clear") assert.equal(thread.messages.length, 0);
    if (change === "delete") assert.equal(restored.listThreads(7).length, 1);
    if (change === "newer turn")
      assert.equal(thread.messages.at(-1).pairId, "new-id");
    assert.equal(a.stop.style.display, "none");
    assert.equal(a.send.disabled, false);
  });
}

test("a same-thread sidebar rebuild restores the interrupted stream in the replacement panel (#457)", async (t) => {
  const profile = await chatProfile(t);
  const old = { partial: "Fragment", delayAbort: true };
  const blocked = pausedChat(old);
  const session = await profile(blocked.chat);
  const a = await session.open();
  const pending = a.ask("Interrupted");
  await blocked.started;
  a.messages.isConnected = false;
  const b = await session.open();
  await pending;
  assert.match(b.messages.children[0].children[1].html, /Fragment/);
  assert.match(
    b.messages.children[0].children[1].html,
    /itempane-stopped-note/,
  );
});

test("stop releases a send during the shared primary PDF preload (#457)", async (t) => {
  const profile = await chatProfile(t);
  const reads = [];
  const slow = deferred();
  const prompts = [];
  const session = await profile(
    (request) => {
      prompts.push(request);
      return { text: "Answer" };
    },
    {
      "./pdfExtractor": {
        PDFExtractor: {
          getAllPdfAttachments: async () => [{}],
          extractTextFromItem: (_item, _mode, _progress, { abortSignal }) => {
            reads.push(abortSignal);
            return reads.length === 1 ? slow.promise : "Fresh PDF text";
          },
        },
      },
    },
  );
  const a = await session.open(7, true);
  const sending = a.ask("First question");
  await new Promise(setImmediate);
  assert.equal(reads.length, 1);
  const signal = reads[0];
  assert.equal(signal, a.state.abortController.signal);
  await a.stop.click();
  await new Promise(setImmediate);
  assert.equal(signal.aborted, true);
  assert.equal(a.send.disabled, false);
  assert.equal(a.state.conversationHistory.at(-1).stopped, true);
  await sending;
  assert.equal(prompts.length, 0);
  await a.ask("Try again");
  slow.resolve("Obsolete text");
  await new Promise(setImmediate);
  assert.equal(reads.length, 2);
  assert.equal(a.state.pdfContent, "Fresh PDF text");
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].content.content, "Fresh PDF text");
  assert.deepEqual(
    Array.from(prompts[0].conversation, (m) => m.content),
    ["Try again"],
  );
});

test("reset during text preparation keeps a newer reply when the cancelled read returns (#457)", async (t) => {
  const profile = await chatProfile(t);
  const slow = deferred();
  const started = deferred();
  let reads = 0;
  const session = await profile(
    () => ({ text: "New reply" }),
    {
      "./pdfExtractor": {
        PDFExtractor: {
          getAllPdfAttachments: async () => [{}],
          extractTextFromItem: () => {
            if (++reads > 1) return "Fresh source";
            started.resolve();
            return slow.promise;
          },
        },
      },
    },
    { Zotero: { Items: { getAsync: async (id) => ({ id }) } } },
  );
  const a = await session.open();
  a.state.relatedItems = [{ itemId: 10, title: "Related" }];
  a.state.relatedMode = "fullText";
  const sending = a.ask("Before reset");
  await started.promise;
  await a.panel
    .find((element) => element.title === "itempane-quick-chat-new-conversation")
    .click();
  await a.ask("After reset");
  slow.resolve("Obsolete source");
  await sending;
  await session.chatPersist.flush();
  const restored = await (await profile()).open();
  const messages = restored.state.conversationHistory;
  assert.equal(messages.length, 2);
  assert.equal(messages[0].displayContent, "After reset");
  assert.match(messages[0].content, /Fresh source/);
  assert.equal(messages[1].content, "New reply");
  assert.equal(restored.state.relatedContextSignature, "fullText:10");
});

for (const mode of ["summary", "fullText"]) {
  test(`stop while preparing related ${mode} releases the composer before the host read finishes (#457)`, async (t) => {
    const profile = await chatProfile(t);
    const slow = deferred();
    const started = deferred();
    const reads = [];
    const lookups = [];
    const prompts = [];
    const read = (item, signal) => {
      reads.push(item.id);
      if (reads.length > 1) return "Related text " + item.id;
      started.resolve(signal);
      return slow.promise;
    };
    const session = await profile(
      (request) => {
        prompts.push(request.conversation);
        return { text: "Complete" };
      },
      {
        "./pdfExtractor": {
          PDFExtractor: {
            getAllPdfAttachments: async () => [{}],
            extractTextFromItem: (item, _mode, _progress, { abortSignal }) =>
              read(item, abortSignal),
          },
        },
        "./aiNoteService": {
          AiNoteService: {
            findNoteRecord: async (item) => ({ rawHtml: await read(item) }),
          },
        },
        "./llmNoteMetadata": {
          LLMNoteMetadataService: {
            parseSummaryBlocks: () => [],
            stripSidebarMetadata: (html) => html,
            fromResponse: () => null,
          },
        },
      },
      {
        Zotero: {
          Items: {
            getAsync: async (id) => {
              lookups.push(id);
              return { id };
            },
          },
        },
      },
    );
    const a = await session.open();
    a.state.relatedItems = [
      { itemId: 9, title: "Nine" },
      { itemId: 10, title: "Ten" },
    ];
    a.state.relatedMode = mode;
    const sending = a.ask("Cancelled during prep");
    const signal = await started.promise;
    if (mode === "fullText")
      assert.equal(signal, a.state.abortController.signal);
    await a.stop.click();
    await new Promise(setImmediate);
    assert.equal(a.send.disabled, false);
    assert.equal(a.state.isChatting, false);
    await sending;
    assert.deepEqual(lookups, [9]);
    assert.equal(prompts.length, 0);
    assert.equal(a.state.relatedContextSignature, "");
    const stored = session.chatPersist.getThread(7, a.state.threadId);
    assert.equal(stored.messages[1].stopped, true);
    assert.equal(stored.messages[1].content, "");
    await a.ask("Follow-up");
    slow.resolve("Obsolete related text");
    await new Promise(setImmediate);
    assert.deepEqual(lookups, [9, 9, 10]);
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].length, 1);
    assert.match(prompts[0][0].content, /Follow-up/);
    assert.match(prompts[0][0].content, /Related text 10/);
    assert.equal(a.state.relatedContextIncludedCount, 2);
  });
}

for (const fails of [false, true]) {
  test(`late primary PDF ${fails ? "failure" : "success"} leaves the new paper and status alone (#427)`, async (t) => {
    const profile = await chatProfile(t);
    const slow = deferred();
    const session = await profile(undefined, {
      "./pdfExtractor": {
        PDFExtractor: {
          getAllPdfAttachments: async () => [{}],
          extractTextFromItem: async () => {
            await slow.promise;
            if (fails) throw new Error("Late error");
            return "Obsolete PDF text";
          },
        },
      },
    });
    const a = await session.open(7, true);
    const status = a.messages.html;
    const b = await session.open(8);
    slow.resolve();
    await new Promise(setImmediate);
    assert.equal(a.messages.html, status);
    assert.equal(b.state.pdfContent, "Paper 8");
  });
}

test("sending while history loads cannot submit a question to a different thread (#427)", async () => {
  const loaded = deferred();
  const sendBtn = new Element("button");
  const state = { itemId: 7, threadId: "a", isChatting: false };
  const context = vm.createContext({
    currentChatState: state,
    sendBtn,
    inputBox: { value: "Question for A" },
    item: { id: 7 },
    messagesArea: new Element("div"),
    quickChatBindGeneration: 0,
    ensureActiveThreadLoaded: () => loaded.promise,
  });
  const first = sidebarSource.indexOf(
    '  sendBtn.addEventListener("click", async () => {',
  );
  const last = sidebarSource.indexOf("  // Enter 发送", first);
  vm.runInContext(
    transformSync(sidebarSource.slice(first, last), {
      loader: "ts",
      format: "cjs",
      target: "es2018",
      supported: { "dynamic-import": false },
    }).code,
    context,
  );
  const sending = sendBtn.click();
  context.quickChatBindGeneration++;
  state.threadId = "b";
  loaded.resolve();
  await sending;
  assert.equal(state.isChatting, false);
});
