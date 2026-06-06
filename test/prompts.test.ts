import { expect } from "chai";
import {
  DEFAULT_CHAPTER_FALLBACKS,
  generateChapterPrompts,
  getBuiltinMultiRoundPromptTemplates,
  mergeMultiRoundPromptTemplates,
  parseChapterStructure,
  parseMultiRoundPromptTemplateExport,
  serializeMultiRoundPromptTemplate,
  type MultiRoundPromptTemplate,
} from "../src/utils/prompts";
import {
  buildDeepReadSkeletonHtml,
  fillDeepReadSlot,
  getDeepReadSlotStatus,
  planDeepReadSlots,
  shouldRunDeepReadSlot,
} from "../src/modules/deepReadEngine";

function v2Template(id = "custom"): MultiRoundPromptTemplate {
  return {
    id,
    name: "Custom v2",
    description: "test template",
    version: 2,
    prompts: [],
    phases: [
      {
        id: "chapter_reading",
        title: "阶段一：逐章精读",
        type: "sequential_dynamic",
        description: "read chapters",
        contextStrategy: "last_round",
        planningPrompt: "Return JSON chapters.",
        fixedPrompts: [],
        chapterTemplate: "Read {{chapter_title_zh}} / {{chapter_title_en}}",
        maxChapters: 2,
      },
      {
        id: "deep_questions",
        title: "阶段二：重点追问",
        type: "independent",
        description: "ask questions",
        parallelizable: false,
        maxConcurrency: 1,
        prompts: [
          { id: "q1", title: "贡献", prompt: "Contribution?", order: 1 },
          { id: "q2", title: "局限", prompt: "Limits?", order: 2 },
        ],
      },
    ],
    finalPrompt: null,
  };
}

describe("multi-round prompt templates v2", function () {
  it("uses a builtin v2 default template", function () {
    const [builtin] = getBuiltinMultiRoundPromptTemplates();

    expect(builtin.version).to.equal(2);
    expect(builtin.phases.map((phase) => phase.type)).to.deep.equal([
      "sequential_dynamic",
      "independent",
    ]);
    expect(builtin.prompts).to.deep.equal([]);
  });

  it("exports and imports a v2 phase template", function () {
    const imported = parseMultiRoundPromptTemplateExport(
      serializeMultiRoundPromptTemplate(v2Template()),
    );

    expect(imported.id).to.equal("custom");
    expect(imported.version).to.equal(2);
    expect(imported.phases[0].type).to.equal("sequential_dynamic");
    expect(imported.phases[1].type).to.equal("independent");
  });

  it("rejects invalid v2 templates", function () {
    expect(() =>
      parseMultiRoundPromptTemplateExport(
        JSON.stringify({ schema: "wrong", version: 2, template: {} }),
      ),
    ).to.throw("schema");

    const missingPlanning = v2Template();
    if (missingPlanning.phases[0].type === "sequential_dynamic") {
      missingPlanning.phases[0].planningPrompt = "";
    }
    expect(() =>
      parseMultiRoundPromptTemplateExport(
        serializeMultiRoundPromptTemplate(missingPlanning),
      ),
    ).to.throw("planningPrompt");

    const duplicated = v2Template();
    if (duplicated.phases[1].type === "independent") {
      duplicated.phases[1].prompts[0].id = "q2";
    }
    expect(() =>
      parseMultiRoundPromptTemplateExport(
        serializeMultiRoundPromptTemplate(duplicated),
      ),
    ).to.throw("q2");
  });

  it("merges templates by id without duplicates", function () {
    const merged = mergeMultiRoundPromptTemplates(
      [v2Template("same")],
      [{ ...v2Template("same"), name: "New" }],
    );

    expect(merged).to.have.length(1);
    expect(merged[0].name).to.equal("New");
  });

  it("normalizes replacement characters in imported prompt titles", function () {
    const template = v2Template();
    if (template.phases[1].type === "independent") {
      template.phases[1].prompts[0].title =
        "\u6280\u672f\u6c34\u5e73\uFFFD\u521b\u65b0\u6027\uFFFD\u5c55\u671b";
    }

    const imported = parseMultiRoundPromptTemplateExport(
      serializeMultiRoundPromptTemplate(template),
    );

    if (imported.phases[1].type !== "independent") {
      throw new Error("Expected independent phase");
    }
    expect(imported.phases[1].prompts[0].title).to.equal(
      "\u6280\u672f\u6c34\u5e73\u00b7\u521b\u65b0\u6027\u00b7\u5c55\u671b",
    );
  });

  it("parses chapter JSON from plain JSON and markdown fences", function () {
    const plain = parseChapterStructure(
      '{"chapters":[{"id":"intro","title_zh":"引言","title_en":"Introduction"}]}',
    );
    const fenced = parseChapterStructure(
      '```json\n{"chapters":[{"id":"method","title_zh":"方法","title_en":"Method"}]}\n```',
    );

    expect(plain[0]).to.include({ id: "intro", title_zh: "引言" });
    expect(fenced[0]).to.include({ id: "method", title_en: "Method" });
  });

  it("extracts malformed JSON with regex and falls back to two chapters", function () {
    const malformed = parseChapterStructure(
      'chapters: [{"title_zh":"背景", "title_en":"Background"}]',
    );
    const fallback = parseChapterStructure("not chapters at all");

    expect(malformed[0]).to.include({ title_zh: "背景" });
    expect(fallback).to.deep.equal(DEFAULT_CHAPTER_FALLBACKS);
  });

  it("renders only the first two chapter prompts", function () {
    const prompts = generateChapterPrompts(
      [
        { id: "ch1", title_zh: "引言", title_en: "Introduction" },
        { id: "ch2", title_zh: "方法", title_en: "Method" },
        { id: "ch3", title_zh: "实验", title_en: "Experiments" },
      ],
      "Read {{chapter_title_zh}} / {{chapter_title_en}}",
      0,
      2,
    );

    expect(prompts.map((prompt) => prompt.id)).to.deep.equal([
      "chapter_ch1",
      "chapter_ch2",
    ]);
    expect(prompts[1].prompt).to.equal("Read 方法 / Method");
  });

  it("builds and fills ordered deep-read slots", function () {
    const template = v2Template();
    const planned = planDeepReadSlots(template, DEFAULT_CHAPTER_FALLBACKS);
    const html = buildDeepReadSkeletonHtml("Paper", template, planned);
    const filled = fillDeepReadSlot(html, "chapter_ch1", "### Done");

    expect(planned.slots.map((slot) => slot.id)).to.deep.equal([
      "chapter_ch1",
      "chapter_ch2",
      "q1",
      "q2",
    ]);
    expect(getDeepReadSlotStatus(filled, "chapter_ch1")).to.equal("done");
    expect(shouldRunDeepReadSlot(filled, "chapter_ch1")).to.equal(false);
    expect(shouldRunDeepReadSlot(filled, "chapter_ch2")).to.equal(true);
  });
});
