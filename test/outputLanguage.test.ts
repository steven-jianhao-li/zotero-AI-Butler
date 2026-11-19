import { expect } from "chai";
import {
  OUTPUT_LANGUAGE_MAX_LENGTH,
  applyOutputLanguageToConversation,
  applyOutputLanguageToPrompt,
  buildOutputLanguageDirective,
  detectBuiltinPromptLanguage,
  normalizeOutputLanguage,
  normalizeOutputLanguageDomain,
} from "../src/utils/outputLanguage";

// 刻意不替换全局 Zotero：套件运行在真实 Zotero 进程内，在模块作用域改写
// globalThis.Zotero 会让插件的启动/收尾钩子拿到假对象，mocha 永远等不到结束
// 信号（CI 上表现为 test job 挂起直到超时）。被测函数全部支持显式传入
// language/domain，因此这里不需要任何全局桩，也不会写入真实偏好。

describe("output language control", function () {
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
    expect(buildOutputLanguageDirective("")).to.equal("");
    const prompt = "Summarize this paper.";
    expect(applyOutputLanguageToPrompt(prompt, { language: "" })).to.equal(
      prompt,
    );
  });

  it("builds a Chinese directive with science-specific rules", function () {
    const directive = buildOutputLanguageDirective("简体中文", "science");
    expect(directive).to.contain("<output-language>");
    expect(directive).to.contain("目标语言：简体中文");
    expect(directive).to.contain("理");
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
  });

  it("renders the directive in English for non-Chinese targets", function () {
    const directive = buildOutputLanguageDirective("日本語", "engineering");
    expect(directive).to.contain("Target language: 日本語");
    expect(directive).to.contain("OUTPUT LANGUAGE");
    expect(directive).to.contain("MOSFET");
  });

  it("injects the rule into single-turn prompts exactly once", function () {
    const prompt = "Explain the argument.";
    const context = { language: "English", domain: "humanities" as const };
    const once = applyOutputLanguageToPrompt(prompt, context);
    const twice = applyOutputLanguageToPrompt(once, context);
    expect(once).to.contain(prompt);
    expect(once).to.contain("Target language: English");
    expect(once).to.contain("habitus");
    expect(twice).to.equal(once);
    expect(once.split("<output-language>").length - 1).to.equal(1);
  });

  it("injects into the first user message only and keeps the input intact", function () {
    const conversation = [
      { role: "system" as const, content: "system prompt" },
      { role: "user" as const, content: "chapter prompt" },
      { role: "assistant" as const, content: "previous answer" },
      { role: "user" as const, content: "follow up" },
    ];
    const next = applyOutputLanguageToConversation(conversation, {
      language: "简体中文",
      domain: "general",
    });
    expect(next).to.have.length(4);
    expect(next[0].content).to.equal("system prompt");
    expect(next[1].content).to.contain("<output-language>");
    expect(next[2].content).to.equal("previous answer");
    expect(next[3].content).to.equal("follow up");
    expect(conversation[1].content).to.equal("chapter prompt");
    const again = applyOutputLanguageToConversation(next, {
      language: "简体中文",
      domain: "general",
    });
    expect(again[1].content).to.equal(next[1].content);
  });

  it("respects explicit opt-out and machine-readable tasks", function () {
    const prompt = "return json";
    const context = { language: "简体中文", domain: "general" as const };
    expect(
      applyOutputLanguageToPrompt(prompt, {
        ...context,
        skipOutputLanguage: true,
      }),
    ).to.equal(prompt);
    expect(
      applyOutputLanguageToPrompt(prompt, {
        ...context,
        task: "image-summary",
      }),
    ).to.equal(prompt);
    expect(
      applyOutputLanguageToPrompt(prompt, { ...context, task: "table" }),
    ).to.contain("<output-language>");
    const conversation = [{ role: "user" as const, content: "plan" }];
    expect(
      applyOutputLanguageToConversation(conversation, {
        ...context,
        skipOutputLanguage: true,
      })[0].content,
    ).to.equal("plan");
  });

  it("covers summary, table, literature review, mindmap and chat tasks", function () {
    const base = { language: "English", domain: "science" as const };
    for (const task of ["summary", "table", "literature-review", "mindmap"]) {
      expect(
        applyOutputLanguageToPrompt("task prompt", { ...base, task }),
      ).to.contain("<output-language>");
    }
    const chat = applyOutputLanguageToConversation(
      [{ role: "user" as const, content: "chat prompt" }],
      { ...base, task: "chat" },
    );
    expect(chat[0].content).to.contain("<output-language>");
  });

  it("honours an explicit empty language even when the pref has a value", function () {
    const prompt = "keep as is";
    expect(
      applyOutputLanguageToPrompt(prompt, { language: "", domain: "science" }),
    ).to.equal(prompt);
    expect(
      applyOutputLanguageToConversation(
        [{ role: "user" as const, content: "keep" }],
        { language: "" },
      )[0].content,
    ).to.equal("keep");
  });
});
