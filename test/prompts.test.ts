import { expect } from "chai";
import {
  DEFAULT_CHAPTER_FALLBACKS,
  DEFAULT_TABLE_TEMPLATE,
  buildUserMessage,
  generateChapterPrompts,
  getConfiguredTableTemplate,
  getDefaultMultiRoundPromptTemplate,
  getBuiltinMultiRoundPromptTemplates,
  mergeMultiRoundPromptTemplates,
  parseChapterStructure,
  parseChapterStructureResult,
  parseManualChapterStructure,
  parseMultiRoundPromptTemplateExport,
  serializeMultiRoundPromptTemplate,
  type MultiRoundPromptTemplate,
} from "../src/utils/prompts";
import {
  buildDeepReadSkeletonHtml,
  extractDeepReadChaptersFromHtml,
  extractDeepReadPlanMetadata,
  fillDeepReadSlot,
  getDeepReadSlotStatus,
  hasIncompleteDeepReadContent,
  isDeepReadSlotDone,
  markDeepReadSlotRunning,
  planDeepReadSlots,
  resetRunningDeepReadSlots,
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
        chapterTemplate: "Read {{title_zh}} / {{title_en}}",
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

  it("reports chapter parse source and parses manual chapter input", function () {
    const parsed = parseChapterStructureResult(
      'chapters: [{"title_zh":"??", "title_en":"Background"}]',
    );
    const manual = parseManualChapterStructure(
      "Introduction\nChapter 2: Method (Method)",
    );

    expect(parsed.source).to.equal("regex");
    expect(manual.map((chapter) => chapter.title_zh)).to.deep.equal([
      "Introduction",
      "Method",
    ]);
    expect(manual[1].title_en).to.equal("Method");
  });

  it("renders only the first two chapter prompts", function () {
    const prompts = generateChapterPrompts(
      [
        { id: "ch1", title_zh: "引言", title_en: "Introduction" },
        { id: "ch2", title_zh: "方法", title_en: "Method" },
        { id: "ch3", title_zh: "实验", title_en: "Experiments" },
      ],
      "Read {{chapter_index}}. {{title_zh}} / {{title_en}}",
      0,
      2,
    );

    expect(prompts.map((prompt) => prompt.id)).to.deep.equal([
      "chapter_ch1",
      "chapter_ch2",
    ]);
    expect(prompts[1].prompt).to.equal("Read 2. 方法 / Method");
  });

  it("builds and fills ordered deep-read slots", function () {
    const template = v2Template();
    const planned = planDeepReadSlots(template, DEFAULT_CHAPTER_FALLBACKS);
    const html = buildDeepReadSkeletonHtml("Paper", template, planned);
    const filled = fillDeepReadSlot(html, "chapter_ch1", "### Done", "引言");

    expect(planned.slots.map((slot) => slot.id)).to.deep.equal([
      "chapter_ch1",
      "chapter_ch2",
      "q1",
      "q2",
    ]);
    expect(getDeepReadSlotStatus(filled, "chapter_ch1")).to.equal("done");
    expect(html).to.include("<h1>AI 精读 - Paper</h1>");
    expect(html).to.include("<h2>章节解析</h2>");
    expect(html).to.include("<p>第1章：引言（Introduction）</p>");
    expect(html).to.not.include("逐章精读 ⓘ");
    expect(filled).to.include("<h2>引言</h2>");
    expect(shouldRunDeepReadSlot(filled, "chapter_ch1")).to.equal(false);
    expect(shouldRunDeepReadSlot(filled, "chapter_ch2")).to.equal(true);
  });

  it("detects stripped localized placeholders as incomplete deep-read content", function () {
    const exportedHtml = [
      "<h1>AI Deep Reading - Paper</h1>",
      "<h2>Chapter Analysis</h2>",
      "<p>Chapter 1: Intro</p>",
      "<h2>Intro</h2>",
      "<p>Done content with enough detail for the first chapter.</p>",
      "<h2>Method</h2>",
      "<p>⏳ Waiting for generation...</p>",
      "<h2>Limitations</h2>",
      "<p>🔄 Generating...</p>",
    ].join("\n");

    expect(hasIncompleteDeepReadContent(exportedHtml)).to.equal(true);
    expect(
      hasIncompleteDeepReadContent("<h2>Intro</h2><p>Finished analysis.</p>"),
    ).to.equal(false);
  });

  it("keeps stripped English placeholder sections runnable in legacy slot fallback", function () {
    const template = v2Template();
    const planned = planDeepReadSlots(template, DEFAULT_CHAPTER_FALLBACKS);
    const pendingSlot = planned.sequentialSlots[1];
    const legacyHtml = [
      "<h1>AI Deep Reading - Paper</h1>",
      `<h2>${pendingSlot.title}</h2>`,
      "<p>⏳ Waiting for generation...</p>",
    ].join("\n");

    expect(
      getDeepReadSlotStatus(legacyHtml, pendingSlot.id, pendingSlot),
    ).to.equal("pending");
    expect(
      shouldRunDeepReadSlot(legacyHtml, pendingSlot.id, pendingSlot),
    ).to.equal(true);
  });

  it("persists plan metadata and marks running slots", function () {
    const template = v2Template();
    const planned = planDeepReadSlots(template, DEFAULT_CHAPTER_FALLBACKS);
    const html = buildDeepReadSkeletonHtml("Paper", template, planned);
    const running = markDeepReadSlotRunning(html, "chapter_ch1", "Intro");
    const metadata = extractDeepReadPlanMetadata(html);

    expect(metadata?.templateId).to.equal("custom");
    expect(metadata?.chapters).to.deep.equal(DEFAULT_CHAPTER_FALLBACKS);
    expect(metadata?.template?.id).to.equal("custom");
    expect(getDeepReadSlotStatus(running, "chapter_ch1")).to.equal("running");
    expect(isDeepReadSlotDone(running, "chapter_ch1")).to.equal(false);
    const reset = resetRunningDeepReadSlots(running);
    expect(getDeepReadSlotStatus(reset, "chapter_ch1")).to.equal("pending");
    expect(reset).to.include("<!-- zab:slot:chapter_ch1:pending -->");
  });

  it("recovers chapters from rendered deep-read notes when metadata is missing", function () {
    const template = v2Template();
    const planned = planDeepReadSlots(template, DEFAULT_CHAPTER_FALLBACKS);
    const html = buildDeepReadSkeletonHtml("Paper", template, planned).replace(
      /<!-- zab:deep-read-plan:[\s\S]*? -->\n?/,
      "",
    );

    const chapters = extractDeepReadChaptersFromHtml(html);

    expect(chapters).to.deep.equal(DEFAULT_CHAPTER_FALLBACKS);
    expect(planDeepReadSlots(template, chapters).slots[0].id).to.equal(
      "chapter_ch1",
    );
  });

  it("recovers chapters from English rendered deep-read notes when metadata is missing", function () {
    const template = v2Template();
    const html = [
      "<h1>AI Deep Reading - Paper</h1>",
      "<h2>Chapter Analysis</h2>",
      "<p>Chapter 1: Introduction</p>",
      "<p>Chapter 2: Simulation vs. Emulation</p>",
      "<h2>Introduction</h2>",
      "<p>Already generated content.</p>",
      "<h2>Simulation vs. Emulation</h2>",
      "<p>⏳ Waiting for generation...</p>",
    ].join("\n");

    const chapters = extractDeepReadChaptersFromHtml(html);

    expect(chapters).to.deep.equal([
      { id: "ch1", title_zh: "Introduction", title_en: "" },
      { id: "ch2", title_zh: "Simulation vs. Emulation", title_en: "" },
    ]);
    expect(planDeepReadSlots(template, chapters).slots[1].id).to.equal(
      "chapter_ch2",
    );
  });

  it("normalizes duplicate dynamically planned chapter ids into stable slot ids", function () {
    const planned = planDeepReadSlots(v2Template(), [
      { id: "same", title_zh: "A", title_en: "A" },
      { id: "same", title_zh: "B", title_en: "B" },
    ]);

    expect(planned.sequentialSlots.map((slot) => slot.id)).to.deep.equal([
      "chapter_ch1",
      "chapter_ch2",
    ]);
  });

  it("does not duplicate model-provided top-level slot headings", function () {
    const template = v2Template();
    const planned = planDeepReadSlots(template, DEFAULT_CHAPTER_FALLBACKS);
    const html = buildDeepReadSkeletonHtml("Paper", template, planned);
    const filled = fillDeepReadSlot(
      html,
      "chapter_ch1",
      "## 第1章精读：Introduction\n\n### Done",
      "引言",
    );

    expect(filled).to.not.include("<h2>引言</h2>");
    expect(filled).to.include("<h2>第1章精读：Introduction</h2>");
  });

  it("keeps deep-read prose from becoming a top-level heading", function () {
    const template = v2Template();
    const planned = planDeepReadSlots(template, DEFAULT_CHAPTER_FALLBACKS);
    const html = buildDeepReadSkeletonHtml("Paper", template, planned);
    const prose =
      "在互联网安全领域，基于域名系统（DNS）的反射放大分布式拒绝服务（DRDoS）攻击一直是一项严峻的挑战。尽管学术界和工业界已经提出了诸如服务器屏蔽、访问控制、速率限制等多种防御措施，但开放DNS（ODNS）基础设施依然频繁被攻击者滥用。";
    const filled = fillDeepReadSlot(
      html,
      "q1",
      `## 综述精读\n\n### 论文概述与核心背景\n\n# ${prose}`,
      "综述摘要精读",
    );

    expect(filled).to.include("<h2>综述精读</h2>");
    expect(filled).to.include("<h3>论文概述与核心背景</h3>");
    expect(filled).to.include(`<p>${prose}</p>`);
    expect(filled).to.not.include(`<h1>${prose}</h1>`);
  });

  describe("localized prompt defaults", function () {
    let previousAddon: any;
    let previousLocale: any;

    beforeEach(function () {
      previousAddon = (globalThis as any).addon;
      previousLocale = previousAddon?.data?.locale;
      const addon = previousAddon || { data: {} };
      addon.data = addon.data || {};
      (globalThis as any).addon = addon;
      addon.data.locale = {
        current: {
          formatMessagesSync(requests: Array<{ id: string }>) {
            return requests.map(({ id }) => ({
              value: id.endsWith("settings-image-summary-default-language")
                ? "English"
                : undefined,
            }));
          },
        },
      };
    });

    afterEach(function () {
      if (previousAddon) {
        (globalThis as any).addon = previousAddon;
        previousAddon.data = previousAddon.data || {};
        previousAddon.data.locale = previousLocale;
      } else {
        delete (globalThis as any).addon;
      }
    });

    it("uses an English language instruction when building English requests", function () {
      const message = buildUserMessage("Explain the paper.", "Paper body");

      expect(message).to.include("Please answer in English.");
      expect(message).to.not.include("请用中文回答");
    });

    it("treats saved Chinese table defaults as defaults in English locale", function () {
      const table = getConfiguredTableTemplate(DEFAULT_TABLE_TEMPLATE);

      expect(table).to.include("| Dimension | Content |");
      expect(table).to.not.include("| 维度 | 内容 |");
    });

    it("does not include Chinese title placeholders in the English chapter prompt", function () {
      const template = getDefaultMultiRoundPromptTemplate();
      const chapterPhase = template.phases.find(
        (phase) => phase.type === "sequential_dynamic",
      );

      expect(chapterPhase?.type).to.equal("sequential_dynamic");
      if (chapterPhase?.type === "sequential_dynamic") {
        expect(chapterPhase.chapterTemplate).to.include("{{title_en}}");
        expect(chapterPhase.chapterTemplate).to.not.include("{{title_zh}}");
      }
    });
  });
});
