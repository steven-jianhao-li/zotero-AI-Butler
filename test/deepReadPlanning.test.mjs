import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { URL } from "node:url";
import vm from "node:vm";
import { transformSync } from "esbuild";

const locale = { getString: (key) => key };
function loadSource(name, imports, globals = {}) {
  const module = { exports: {} };
  const source = readFileSync(
    new URL(`../src/${name}`, import.meta.url),
    "utf8",
  );
  vm.runInNewContext(
    transformSync(source, { loader: "ts", format: "cjs" }).code,
    {
      module,
      exports: module.exports,
      ...globals,
      require: (specifier) =>
        imports[specifier] ||
        (specifier === "./llmproviders/shared/completion" ? completion : {}),
    },
  );
  return module.exports;
}
const completion = loadSource("modules/llmproviders/shared/completion.ts", {
  "../../../utils/locale": locale,
});
const prompts = loadSource("utils/prompts.ts", {
  "../defaults/prompts/deep-read.json": JSON.parse(
    readFileSync(
      new URL("../src/defaults/prompts/deep-read.json", import.meta.url),
    ),
  ),
  "./locale": locale,
  "./prefs": { getPref: () => undefined },
});
const noteMarkdown = loadSource("modules/noteMarkdown.ts", {
  marked: await import("marked"),
  "../utils/locale": locale,
});
const engine = loadSource("modules/deepReadEngine.ts", {
  "../utils/locale": locale,
  "../utils/prompts": prompts,
  "./noteMarkdown": noteMarkdown,
});

test("default chapter planning refuses missing paper content instead of inventing fallback sections", () => {
  const template = prompts.getDefaultMultiRoundPromptTemplate();
  const planning = template.phases.find(
    (phase) => phase.type === "sequential_dynamic",
  ).planningPrompt;
  assert.ok(planning.includes('{"chapters":[]}'));
  assert.ok(!planning.includes("就返回“引言”和“第二章”"));
});

for (const language of ["zh-CN", "en-US"]) {
  test(`default ${language} planning distinguishes readable unsectioned papers from missing input`, () => {
    const localizedPrompts = loadSource("utils/prompts.ts", {
      "../defaults/prompts/deep-read.json": JSON.parse(
        readFileSync(
          new URL("../src/defaults/prompts/deep-read.json", import.meta.url),
        ),
      ),
      "./locale": locale,
      "./prefs": { getPref: () => language },
    });
    const planning = localizedPrompts
      .getDefaultMultiRoundPromptTemplate()
      .phases.find(
        (phase) => phase.type === "sequential_dynamic",
      ).planningPrompt;
    assert.match(planning, /whole_paper/);
    assert.ok(planning.includes('"chapters":[]'));
    assert.ok(!planning.includes("Return at least two chapters"));
  });
}

test("readable unsectioned paper can be planned as one whole-paper reading unit", () => {
  const parsed = prompts.parseChapterStructureResult(
    '{"chapters":[{"id":"whole_paper","title_zh":"全文","title_en":"Whole paper"}]}',
  );
  assert.equal(parsed.source, "json");
  assert.equal(parsed.chapters.length, 1);
  assert.equal(parsed.chapters[0].id, "whole_paper");
});

for (const [name, response] of [
  [
    "bare array",
    '[{"id":"ch1","title_en":"Introduction"},{"id":"ch2","title_en":"Results"}]',
  ],
  [
    "fenced array",
    '```json\n[{"id":"ch1","title_en":"Introduction"},{"id":"ch2","title_en":"Results"}]\n```',
  ],
  [
    "wrapped chapters object",
    '{"chapters":[{"id":"ch1","title_en":"Introduction"},{"id":"ch2","title_en":"Results"}]}',
  ],
]) {
  test(`chapter planning accepts valid ${name} without manual fallback`, () => {
    const parsed = prompts.parseChapterStructureResult(response);
    assert.equal(parsed.source, "json");
    assert.deepEqual(
      Array.from(parsed.chapters, (chapter) => chapter.title_en),
      ["Introduction", "Results"],
    );
  });
}

for (const responseText of [
  "I cannot access the attached PDF. Please provide the article text.",
  "",
  "null",
  '{"chapters":[]}',
]) {
  test(`invalid planning ${JSON.stringify(responseText)} stops without modal input, fabricated chapters, note writes or extra model calls`, async () => {
    const template = prompts.getDefaultMultiRoundPromptTemplate();
    let requests = 0;
    let writes = 0;
    let promptsShown = 0;
    const { NoteGenerator } = loadSource(
      "modules/noteGenerator.ts",
      {
        "./deepReadEngine": engine,
        "../utils/prompts": prompts,
        "../utils/locale": locale,
        "../utils/prefs": { getPref: () => false },
        "./llmproviders/shared/requestAbort": { throwIfAborted() {} },
        "./aiNoteService": {
          AiNoteService: {
            saveGeneratedNote: async () => {
              writes++;
              throw new Error("Unexpected note write");
            },
          },
        },
      },
      {
        ztoolkit: { log() {} },
        Zotero: { getMainWindow: () => ({}) },
        Services: {
          prompt: {
            prompt: () => {
              promptsShown++;
              return false;
            },
          },
        },
      },
    );
    NoteGenerator.getActiveDeepReadTemplate = () => template;
    NoteGenerator.callDeepReadChat = async () => {
      requests++;
      return {
        text: responseText,
        finishReason: "stop",
      };
    };
    NoteGenerator.showDeepReadNotice = () => {};
    let failure;
    try {
      await NoteGenerator.generateDeepReadContent({
        item: { id: 1 },
        existing: null,
        existingHtml: "",
        policy: "skip",
        pdfContent: "base64-fixture",
        isBase64: true,
        itemTitle: "Fixture",
      });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure);
    assert.equal(failure.name, "DeepReadChapterPlanningError");
    assert.equal(failure.suppressTaskRetry, true);
    assert.match(failure.message, /note-generator-error-chapter-planning/);
    assert.match(failure.message, /PDF Base64/);
    assert.ok(failure.message.includes(responseText || "(empty response)"));
    assert.equal(promptsShown, 0);
    assert.equal(writes, 0);
    assert.equal(requests, 1);
  });
}

for (const failure of [
  { name: "LLMApiCallError" },
  { name: "LLMApiExhaustedError" },
  { suppressTaskRetry: true },
]) {
  test(`deep-read cache session does not retry terminal failure ${JSON.stringify(failure)}`, async () => {
    let fallbackCalls = 0;
    const error = Object.assign(new Error("Terminal API failure"), failure);
    const { NoteGenerator } = loadSource("modules/noteGenerator.ts", {
      "./llmService": {
        __esModule: true,
        default: {
          chatWithEndpoint: async () => {
            throw error;
          },
          chat: async () => {
            fallbackCalls++;
            return { text: "Unexpected retry" };
          },
        },
      },
      "./llmproviders/shared/requestAbort": { isAbortError: () => false },
    });
    await assert.rejects(
      NoteGenerator.chatWithDeepReadSession(
        { endpointId: "primary", allowFallback: true },
        { content: {}, conversation: [] },
      ),
      (caught) => caught === error,
    );
    assert.equal(fallbackCalls, 0);
  });
}

test("deep-read cache session retains fallback for nonterminal errors", async () => {
  const session = { endpointId: "primary", allowFallback: true };
  const { NoteGenerator } = loadSource(
    "modules/noteGenerator.ts",
    {
      "./llmService": {
        __esModule: true,
        default: {
          chatWithEndpoint: async () => {
            throw new Error("Session unavailable");
          },
          chat: async () => ({ text: "Recovered", endpointId: "secondary" }),
        },
      },
      "./llmproviders/shared/requestAbort": { isAbortError: () => false },
    },
    { ztoolkit: { log() {} } },
  );
  const response = await NoteGenerator.chatWithDeepReadSession(session, {
    content: {},
    conversation: [],
  });
  assert.equal(response.text, "Recovered");
  assert.equal(session.endpointId, "secondary");
});
