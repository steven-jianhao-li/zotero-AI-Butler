import { expect } from "chai";
import {
  OUTPUT_LANGUAGE_MAX_LENGTH,
  applyOutputLanguageToConversation,
  applyOutputLanguageToPrompt,
  buildOutputLanguageDirective,
  detectBuiltinPromptLanguage,
  normalizeOutputLanguage,
  normalizeOutputLanguageDomain,
  setOutputLanguage,
  setOutputLanguageDomain,
} from "../src/utils/outputLanguage";

// 最小 Zotero.Prefs stub：outputLanguage 模块通过 utils/prefs 读写偏好
const prefStore: Record<string, unknown> = {};
(globalThis as any).Zotero = {
  Prefs: {
    get: (key: string) => prefStore[key],
    set: (key: string, value: unknown) => {
      prefStore[key] = value;
      return true;
    },
  },
};

const PREF_LANGUAGE = "extensions.zotero.aiButler.outputLanguage";
const PREF_DOMAIN = "extensions.zotero.aiButler.outputLanguageDomain";

function resetPrefs(language = "", domain = "general") {
  prefStore[PREF_LANGUAGE] = language;
  prefStore[PREF_DOMAIN] = domain;
}

describe("output language control", function () {
  beforeEach(function () {
    resetPrefs();
  });

  it("normalizes user input instead of trusting it verbatim", function () {
    expect(normalizeOutputLanguage("  简体 中文 \n")).to.equal("简体 中文");
    expect(normalizeOutputLanguage("English <script>")).to.equal(
      "English script",
    );
    expect(normalizeOutputLanguage(undefined)).to.equal("");
    expect(normalizeOutputLanguage("x".repeat(200)).length).to.equal(
      OUTPUT_LANGUAGE_MAX_LENGTH,
    );
  });

  it("falls back to the general profile for unknown disciplines", function () {
    expect(normalizeOutputLanguageDomain("Science")).to.equal("science");
    expect(normalizeOutputLanguageDomain("astrology")).to.equal("general");
    expect(normalizeOutputLanguageDomain(undefined)).to.equal("general");
  });

  it("detects when the built-in prompt language can follow the target", function () {
    expect(detectBuiltinPromptLanguage("简体中文")).to.equal("zh-CN");
    expect(detectBuiltinPromptLanguage("Chinese")).to.equal("zh-CN");
    expect(detectBuiltinPromptLanguage("English")).to.equal("en-US");
    expect(detectBuiltinPromptLanguage("en-GB")).to.equal("en-US");
    expect(detectBuiltinPromptLanguage("日本語")).to.equal(undefined);
    expect(detectBuiltinPromptLanguage("")).to.equal(undefined);
  });

  it("produces no directive when the setting is empty", function () {
    expect(buildOutputLanguageDirective()).to.equal("");
    const prompt = "Summarize this paper.";
    expect(applyOutputLanguageToPrompt(prompt)).to.equal(prompt);
  });

  it("builds a Chinese directive with science-specific rules", function () {
    resetPrefs("简体中文", "science");
    const directive = buildOutputLanguageDirective();
    expect(directive).to.contain("<output-language>");
    expect(directive).to.contain("目标语言：简体中文");
    expect(directive).to.contain("理");
    // 理科口径：保留公式/单位、术语标准译名
    expect(directive).to.contain("消融实验");
    expect(directive).to.contain("SI");
    expect(directive).to.contain("最终答案必须全部使用简体中文书写");
  });

  it("switches discipline rules without changing the target language", function () {
    const science = buildOutputLanguageDirective("简体中文", "science");
    const arts = buildOutputLanguageDirective("简体中文", "arts");
    const business = buildOutputLanguageDirective("简体中文", "business");
    expect(arts).to.contain("布面油画");
    expect(arts).not.to.contain("消融实验");
    expect(business).to.contain("代理成本");
    expect(science).not.to.contain("代理成本");
  });

  it("renders the directive in English for non-Chinese targets", function () {
    const directive = buildOutputLanguageDirective("日本語", "engineering");
    expect(directive).to.contain("Target language: 日本語");
    expect(directive).to.contain("OUTPUT LANGUAGE");
    expect(directive).to.contain("MOSFET");
  });

  it("injects the rule into single-turn prompts exactly once", function () {
    resetPrefs("English", "humanities");
    const prompt = "Explain the argument.";
    const once = applyOutputLanguageToPrompt(prompt);
    const twice = applyOutputLanguageToPrompt(once);
    expect(once).to.contain(prompt);
    expect(once).to.contain("Target language: English");
    expect(once).to.contain("habitus");
    expect(twice).to.equal(once);
    expect(once.split("<output-language>").length - 1).to.equal(1);
  });

  it("injects into the first user message only and keeps the input intact", function () {
    resetPrefs("简体中文", "general");
    const conversation = [
      { role: "system" as const, content: "system prompt" },
      { role: "user" as const, content: "chapter prompt" },
      { role: "assistant" as const, content: "previous answer" },
      { role: "user" as const, content: "follow up" },
    ];
    const next = applyOutputLanguageToConversation(conversation);
    expect(next).to.have.length(4);
    expect(next[0].content).to.equal("system prompt");
    expect(next[1].content).to.contain("<output-language>");
    expect(next[2].content).to.equal("previous answer");
    expect(next[3].content).to.equal("follow up");
    expect(conversation[1].content).to.equal("chapter prompt");
    // 幂等
    const again = applyOutputLanguageToConversation(next);
    expect(again[1].content).to.equal(next[1].content);
  });

  it("respects explicit opt-out and machine-readable tasks", function () {
    resetPrefs("简体中文", "general");
    const prompt = "return json";
    expect(
      applyOutputLanguageToPrompt(prompt, { skipOutputLanguage: true }),
    ).to.equal(prompt);
    expect(
      applyOutputLanguageToPrompt(prompt, { task: "image-summary" }),
    ).to.equal(prompt);
    expect(applyOutputLanguageToPrompt(prompt, { task: "table" })).to.contain(
      "<output-language>",
    );
    const conversation = [{ role: "user" as const, content: "plan" }];
    expect(
      applyOutputLanguageToConversation(conversation, {
        skipOutputLanguage: true,
      })[0].content,
    ).to.equal("plan");
  });

  it("keeps summary/table/literature-review/chat tasks covered", function () {
    setOutputLanguage("English");
    setOutputLanguageDomain("science");
    for (const task of ["summary", "table", "literature-review", "mindmap"]) {
      expect(applyOutputLanguageToPrompt("task prompt", { task })).to.contain(
        "<output-language>",
      );
    }
    const chat = applyOutputLanguageToConversation(
      [{ role: "user" as const, content: "chat prompt" }],
      { task: "chat" },
    );
    expect(chat[0].content).to.contain("<output-language>");
  });

  it("supports the medicine and law profiles", function () {
    const medicine = buildOutputLanguageDirective("简体中文", "medicine");
    expect(medicine).to.contain("mg/kg");
    expect(medicine).to.contain("ICD");
    const law = buildOutputLanguageDirective("简体中文", "law");
    expect(law).to.contain("判例");
    expect(law).to.contain("shall");
    const lawEn = buildOutputLanguageDirective("English", "law");
    expect(lawEn).to.contain("Target language: English");
    expect(lawEn).to.contain("consideration");
    expect(normalizeOutputLanguageDomain("Medicine")).to.equal("medicine");
    expect(normalizeOutputLanguageDomain("law")).to.equal("law");
  });
});
