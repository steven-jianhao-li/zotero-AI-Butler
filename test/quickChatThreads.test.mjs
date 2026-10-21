import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { URL } from "node:url";
import vm from "node:vm";
import { transformSync } from "esbuild";

const sidebarSource = readFileSync(
  new URL("../src/modules/ItemPaneSection.ts", import.meta.url),
  "utf8",
);
const persistSource = readFileSync(
  new URL("../src/modules/chatPersist.ts", import.meta.url),
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

const doc = { createElement: (tag) => new Element(tag) };

function sidebar(imports = {}, globals = {}) {
  return load(
    `${sidebarSource}
export { getAvailableSidebarTabs, renderSidebarTabPanel, createQuickChatPairActions };
renderTableSection = (...args) => __renderTable(...args);
renderImageSummarySection = (...args) => __renderImage(...args);
copyQuickChatText = (...args) => __copy(...args);
saveChatPairToNote = (...args) => __save(...args);`,
    { "../utils/locale": locale, ...imports },
    globals,
  );
}

test("an enabled table remains accessible with image summaries disabled (#427)", () => {
  const rendered = [];
  const ui = sidebar(
    { "./uiCustomization": { isSidebarModuleEnabled: (id) => id === "table" } },
    { __renderTable: () => rendered.push("table") },
  );
  const tabs = ui.getAvailableSidebarTabs();
  assert.deepEqual(
    Array.from(tabs, (tab) => tab.id),
    ["quickRead"],
  );
  ui.renderSidebarTabPanel("quickRead", { childElementCount: 1 }, doc, {
    id: 7,
  });
  assert.deepEqual(rendered, ["table"]);
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
      updateQuickChatAssistantMessage: (element, text) => {
        element.answer = text;
      },
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

test("a late reply from another paper cannot overwrite or unlock the active chat (#427)", async () => {
  const started = deferred();
  const response = deferred();
  const sendBtn = new Element("button");
  const inputBox = new Element("textarea");
  inputBox.value = "Question?";
  inputBox.focus = () => assert.fail("A stale request stole input focus");
  const scope = {
    currentChatState: {
      itemId: 7,
      threadId: "a",
      isChatting: false,
      pdfContent: "Paper A",
      relatedItems: [],
      conversationHistory: [],
      abortController: null,
    },
    sendBtn,
    inputBox,
    stopBtn: new Element("button"),
    doc,
    item: { id: 7 },
    messagesArea: new Element("div"),
    quickChatPairIdCounter: 0,
    quickChatPinnedToBottom: true,
    getString: locale.getString,
    escapeHtmlForChat: (text) => text,
    createChatAbortController: () => new globalThis.AbortController(),
    ensureActiveThreadLoaded: async () => {},
    syncQuickChatThreadControls() {},
    quickChatHasVisibleMessages: () => false,
    scrollQuickChatToBottomIfPinned() {},
    resizeQuickChatInput() {},
    buildQuickChatConversation: (history, question) => [
      ...history,
      { role: "user", content: question },
    ],
    updateQuickChatAssistantMessage: () =>
      assert.fail("A stale reply changed the UI"),
    persistActiveQuickChatThread: () =>
      assert.fail("A stale reply was persisted"),
  };
  const first = sidebarSource.indexOf(
    '  sendBtn.addEventListener("click", async () => {',
  );
  const last = sidebarSource.indexOf("  // Enter 发送", first);
  const source = sidebarSource.slice(first, last);
  // Keep the VM context so the fixture can simulate switching the selected item.
  const context = vm.createContext({
    ...scope,
    require: () => ({
      __esModule: true,
      default: {
        chat: (options) => {
          started.resolve(options);
          return response.promise;
        },
      },
    }),
    ztoolkit: { log() {} },
  });
  vm.runInContext(
    transformSync(source, {
      loader: "ts",
      format: "cjs",
      target: "es2018",
      supported: { "dynamic-import": false },
    }).code,
    context,
  );
  const sending = sendBtn.click();
  const options = await started.promise;
  const nextState = {
    itemId: 8,
    threadId: "b",
    isChatting: true,
    pdfContent: "Paper B",
    conversationHistory: [{ role: "user", content: "Question B" }],
    abortController: new globalThis.AbortController(),
  };
  context.currentChatState = nextState;
  options.onProgress("Late text from A");
  response.resolve({ text: "Late answer from A" });
  await sending;
  assert.equal(nextState.isChatting, true);
  assert.ok(nextState.abortController);
  assert.deepEqual(nextState.conversationHistory, [
    { role: "user", content: "Question B" },
  ]);
});

test("a late PDF extraction does not replace another paper's content (#427)", async () => {
  const started = deferred();
  const extracted = deferred();
  const context = vm.createContext({
    currentChatState: { itemId: 7, pdfContent: "" },
    item: { id: 7 },
    messagesArea: new Element("div"),
    getString: locale.getString,
    showPdfStatus() {},
    ztoolkit: { log() {} },
    require: (name) =>
      name === "./contentExtractor"
        ? {
            ContentExtractor: {
              extractAnalyzableContentFromItem: () => {
                started.resolve();
                return extracted.promise;
              },
            },
          }
        : {
            __esModule: true,
            default: { getEffectivePdfProcessMode: () => "text" },
          },
  });
  vm.runInContext(
    transformSync(
      closure("loadPdfContentIfNeeded", "showChatArea") +
        "\nglobalThis.loadPdf = loadPdfContentIfNeeded;",
      {
        loader: "ts",
        format: "cjs",
        target: "es2018",
        supported: { "dynamic-import": false },
      },
    ).code,
    context,
  );
  const loading = context.loadPdf();
  await started.promise;
  context.currentChatState = { itemId: 8, pdfContent: "Paper B" };
  extracted.resolve({ content: "Paper A", isBase64: false });
  await loading;
  assert.equal(context.currentChatState.pdfContent, "Paper B");
});
