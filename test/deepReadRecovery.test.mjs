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

function slotHtml(slotId, status, content) {
  return `<!-- zab:slot:${slotId}:${status} -->\n${content}\n<!-- zab:slot:${slotId}:end -->`;
}

test("repairs the known embedded running-slot expansion without discarding completed content", () => {
  const running = slotHtml(
    "chapter_ch9",
    "running",
    "<h2>Conclusion</h2>\n<p>🔄 正在生成...</p>",
  );
  const corrupt = slotHtml(
    "chapter_ch9",
    "done",
    `<h2>Conclusion</h2><p>Before <span class="math">${running}gt;60$</span> after.</p>`,
  );
  const expected = slotHtml(
    "chapter_ch9",
    "done",
    '<h2>Conclusion</h2><p>Before <span class="math">$&gt;60$</span> after.</p>',
  );
  assert.equal(engine.hasIncompleteDeepReadContent(corrupt), true);
  const repaired = engine.repairDeepReadSlotMath(corrupt);
  assert.equal(repaired, expected);
  assert.equal(engine.repairDeepReadSlotMath(repaired), repaired);
  assert.equal(engine.hasIncompleteDeepReadContent(repaired), false);
  assert.equal(engine.shouldRunDeepReadSlot(repaired, "chapter_ch9"), false);
});

test("repair leaves genuine pending/running/error rounds and unrelated nested content untouched", () => {
  for (const status of ["pending", "running", "error"]) {
    const original = slotHtml("chapter_ch9", status, "<p>Needs work</p>");
    assert.equal(engine.repairDeepReadSlotMath(original), original);
    assert.equal(engine.hasIncompleteDeepReadContent(original), true);
  }
  const nested = slotHtml("chapter_ch9", "running", "<p>Needs work</p>");
  for (const content of [
    `<p>${nested}gt;60</p>`,
    `<span class="math">${nested}not-an-entity</span>`,
    `<span class="math">${slotHtml("other", "running", "<p>Needs work</p>")}gt;60</span>`,
  ]) {
    const original = slotHtml("chapter_ch9", "done", content);
    assert.equal(engine.repairDeepReadSlotMath(original), original);
  }
});

test("repairs repeated formula expansions in one completed round", () => {
  const running = slotHtml(
    "chapter_ch9",
    "running",
    "<h2>Conclusion</h2><p>🔄 Generating...</p>",
  );
  const corrupt = slotHtml(
    "chapter_ch9",
    "done",
    `<span class="math">${running}gt;60$</span><span class="math">${running}lt;90$</span>`,
  );
  const expected = slotHtml(
    "chapter_ch9",
    "done",
    '<span class="math">$&gt;60$</span><span class="math">$&lt;90$</span>',
  );
  assert.equal(engine.repairDeepReadSlotMath(corrupt), expected);
});

test("resuming a corrupted completed note saves the repair without any model request", async () => {
  const template = {
    id: "fixture",
    name: "Fixture",
    version: 2,
    prompts: [],
    phases: [
      {
        id: "chapters",
        title: "Chapters",
        type: "sequential_dynamic",
        contextStrategy: "last_round",
        planningPrompt: "Plan chapters",
        fixedPrompts: [],
        chapterTemplate: "Read {{title_zh}}",
        maxChapters: 1,
      },
    ],
  };
  const chapters = [
    { id: "ch1", title_zh: "Conclusion", title_en: "Conclusion" },
  ];
  const planned = engine.planDeepReadSlots(template, chapters);
  const skeleton = engine.buildDeepReadSkeletonHtml(
    "Fixture",
    template,
    planned,
  );
  const done = engine.replaceDeepReadSlotHtml(
    skeleton,
    "chapter_ch1",
    '<h2>Conclusion</h2><p><span class="math">$&gt;60$</span> Completed analysis.</p>',
    "done",
  );
  const running = slotHtml(
    "chapter_ch1",
    "running",
    "<h2>Conclusion</h2><p>🔄 Generating...</p>",
  );
  let savedHtml = done.replace("$&gt;", () => running + "gt;");
  let saves = 0;
  let requests = 0;
  const note = {
    getNote: () => savedHtml,
    setNote: (html) => {
      savedHtml = html;
    },
    saveTx: async () => {
      saves++;
    },
  };
  const { NoteGenerator } = loadSource(
    "modules/noteGenerator.ts",
    {
      "./deepReadEngine": engine,
      "../utils/locale": locale,
      "../utils/prefs": { getPref: () => false },
      "./llmproviders/shared/requestAbort": { throwIfAborted() {} },
    },
    { ztoolkit: { log() {} } },
  );
  NoteGenerator.getActiveDeepReadTemplate = () => template;
  NoteGenerator.callDeepReadChat = async () => {
    requests++;
    throw new Error("A completed round must not be regenerated");
  };
  const result = await NoteGenerator.generateDeepReadContent({
    item: { id: 1 },
    existing: note,
    existingHtml: savedHtml,
    policy: "skip",
    pdfContent: "fixture",
    isBase64: false,
    itemTitle: "Fixture",
  });
  assert.equal(requests, 0);
  assert.equal(saves, 1);
  assert.equal(savedHtml, done);
  assert.equal(result.noteHtml, done);
  assert.equal(engine.hasIncompleteDeepReadContent(result.noteHtml), false);
});
