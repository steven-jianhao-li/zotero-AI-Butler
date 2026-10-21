import assert from "node:assert/strict";
import { Buffer, atob, btoa } from "node:buffer";
import { readFileSync } from "node:fs";
import process from "node:process";
import { test } from "node:test";
import { URL } from "node:url";
import { TextEncoder, TextDecoder } from "node:util";
import vm from "node:vm";
import { build, transformSync } from "esbuild";

const bundle = await build({
  stdin: {
    contents: `export * from "./src/modules/aiNoteService";
export * from "./src/modules/noteMarkdown";`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  plugins: [
    {
      name: "fixture-locale",
      setup(builder) {
        builder.onResolve({ filter: /utils\/locale$/ }, () => ({
          path: "locale",
          namespace: "fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: "export const getString = id => id;",
          loader: "js",
        }));
      },
    },
  ],
});

function load(code, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    TextEncoder,
    TextDecoder,
    btoa,
    atob,
    ztoolkit: { log() {} },
    ...globals,
  });
  return module.exports;
}

function loadView(file, imports, extra = "") {
  const source = readFileSync(
    new URL(`../src/modules/${file}`, import.meta.url),
    "utf8",
  );
  return load(
    transformSync(source + extra, { loader: "ts", format: "cjs" }).code,
    {
      require: (name) => imports[name] || {},
      setTimeout: () => 1,
      clearTimeout() {},
    },
  );
}

const plain = (value) => JSON.parse(JSON.stringify(value));
const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, "");
const parser = load(bundle.outputFiles[0].text);

test("legacy quick-chat answers survive RGB serialization and nested styled content (#406)", () => {
  const html = `<div id="ai-butler-pair-quick_406">
<div style="border-left: 3px solid rgb(79, 143, 217)"><strong>User:</strong><p>Question?</p></div>
<div style="border-left: 3px solid rgb(89, 192, 188)"><strong>Assistant:</strong><p>First paragraph.</p><div style="background:#f5f5f5"><p>Code example.</p></div><p>Final paragraph.</p></div></div>`;
  const [pair] = parser.parseFollowUpChatPairsFromNoteHtml(html);
  assert.equal(pair.user, "Question?");
  assert.match(pair.assistant, /^First paragraph\./);
  assert.match(pair.assistant, /Code example\./);
  assert.match(pair.assistant, /Final paragraph\.$/);
});

test("an incomplete metadata copy cannot hide a saved assistant answer", () => {
  const pair = { id: "quick_406", user: "Question?", assistant: "" };
  const visible = parser.buildFollowUpChatPairNoteHtml({
    pairId: pair.id,
    userMessage: pair.user,
    assistantMessage: "**Complete answer**",
  });
  const html = `<!-- AI_BUTLER_CHAT_JSON: ${JSON.stringify(pair)} -->${stripComments(visible)}`;
  assert.deepEqual(plain(parser.parseFollowUpChatPairsFromNoteHtml(html)), [
    { ...pair, assistant: "**Complete answer**" },
  ]);
});

test("visible answer content recovers an empty data attribute answer", () => {
  const pair = { id: "quick_partial", user: "Question?", assistant: "" };
  const visible = stripComments(
    parser.buildFollowUpChatPairNoteHtml({
      pairId: pair.id,
      userMessage: pair.user,
      assistantMessage: "Recovered answer.",
    }),
  ).replace(
    /data-ai-butler-chat-json="[^"]*"/,
    `data-ai-butler-chat-json="${Buffer.from(JSON.stringify(pair)).toString("base64url")}"`,
  );
  assert.equal(
    parser.parseFollowUpChatPairsFromNoteHtml(visible)[0].assistant,
    "Recovered answer.",
  );
});

function historyFixture() {
  const notes = new Map();
  const item = {
    id: 42,
    libraryID: 1,
    getNotes: () => [...notes.keys()],
    getField: () => "Paper",
  };
  class Note {
    constructor() {
      this.id = 100 + notes.size;
      this.html = "";
      this.tags = [];
    }
    getNote() {
      return this.html;
    }
    setNote(html) {
      this.html = stripComments(html);
    }
    getTags() {
      return this.tags;
    }
    addTag(tag) {
      this.tags.push({ tag });
    }
    async saveTx() {
      notes.set(this.id, this);
    }
  }
  const api = load(bundle.outputFiles[0].text, {
    Zotero: { Item: Note, Items: { getAsync: async (id) => notes.get(id) } },
  });
  const { saveChatPairToNote } = loadView(
    "ItemPaneSection.ts",
    {
      "./aiNoteService": api,
      "../utils/locale": { getString: (id) => id },
    },
    "\nexport { saveChatPairToNote };",
  );
  const { SummaryView } = loadView("views/SummaryView.ts", {
    "./BaseView": { BaseView: class {} },
    "../aiNoteService": api,
    "../noteMarkdown": api,
  });
  const restore = async () => {
    const view = new SummaryView();
    const messages = [];
    view.appendChatMessage = (role, content) => {
      messages.push({ role, content });
      return null;
    };
    view.applyTheme = () => {};
    await view.loadExistingChatPairs(item);
    return { messages, history: plain(view.conversationHistory) };
  };
  return { api, notes, item, Note, saveChatPairToNote, restore };
}

test("saved quick and full follow-ups restore both roles through the full-chat view (#406)", async () => {
  const { api, notes, item, saveChatPairToNote, restore } = historyFixture();
  await saveChatPairToNote(
    item,
    "quick_1",
    "快速问题？",
    "回答：$E=mc^2$ 与 **格式**。",
    null,
    "Quick chat",
  );
  await api.AiNoteService.appendFollowUpPair({
    item,
    pairId: "full_2",
    userMessage: "Follow up?",
    assistantMessage: "Second answer.",
  });
  assert.equal(notes.size, 1);
  const expected = [
    { role: "user", content: "快速问题？" },
    { role: "assistant", content: "回答：$E=mc^2$ 与 **格式**。" },
    { role: "user", content: "Follow up?" },
    { role: "assistant", content: "Second answer." },
  ];
  const restored = await restore();
  assert.deepEqual(restored.messages, expected);
  assert.deepEqual(restored.history, expected);
  // A retry after Zotero removes comment markers must not duplicate the turn.
  await saveChatPairToNote(
    item,
    "quick_1",
    expected[0].content,
    expected[1].content,
  );
  assert.deepEqual((await restore()).messages, expected);
});

test("full chat also restores legacy standalone chat notes", async () => {
  const { api, Note, restore } = historyFixture();
  const note = new Note();
  note.addTag("AI-Butler-Chat");
  note.setNote(
    api.buildFollowUpChatPairNoteHtml({
      pairId: "legacy",
      userMessage: "Old question",
      assistantMessage: "Old answer",
    }),
  );
  await note.saveTx();
  assert.deepEqual((await restore()).messages, [
    { role: "user", content: "Old question" },
    { role: "assistant", content: "Old answer" },
  ]);
});

test("simultaneous saves share one note and retain every complete turn", async () => {
  const { api, item, notes } = historyFixture();
  await Promise.all(
    [1, 2, 3].map((id) =>
      api.AiNoteService.appendFollowUpPair({
        item,
        pairId: `pair_${id}`,
        userMessage: `Q${id}`,
        assistantMessage: `A${id}`,
      }),
    ),
  );
  assert.equal(notes.size, 1);
  const pairs = api.parseFollowUpChatPairsFromNoteHtml(
    [...notes.values()][0].html,
  );
  assert.deepEqual(
    plain(pairs).map((pair) => pair.assistant),
    ["A1", "A2", "A3"],
  );
});
