import { expect } from "chai";
import {
  PROMPT_LANGUAGE_LABEL_KEYS,
  PROMPT_LANGUAGE_ORDER,
  getPromptLanguageOptions,
  normalizePromptLanguageSelection,
} from "../src/utils/promptLanguageSelect";

// 刻意不替换全局 Zotero：测试运行在真实 Zotero 进程内，在模块作用域改写
// globalThis.Zotero 会让插件的启动/收尾钩子拿到假对象，mocha 永远等不到结束
// 信号（CI 上表现为 test job 挂起直到超时）。这两个函数是纯函数，显式传入
// fallback 即可，无需任何全局桩。

describe("prompt language select", function () {
  it("keeps a stable order and maps every value to its own label key", function () {
    const keys = PROMPT_LANGUAGE_ORDER.map((value) => {
      return PROMPT_LANGUAGE_LABEL_KEYS[value];
    });
    expect(keys).to.deep.equal([
      "settings-prompts-language-auto",
      "settings-prompts-language-zh",
      "settings-prompts-language-en",
    ]);
    expect(new Set(keys).size).to.equal(keys.length);
    expect(PROMPT_LANGUAGE_ORDER).to.have.length(keys.length);
  });

  it("renders options through the injected translator", function () {
    const seen: string[] = [];
    const options = getPromptLanguageOptions((key) => {
      seen.push(key);
      return `t:${key}`;
    });
    expect(options.map((option) => option.value)).to.deep.equal([
      "auto",
      "zh-CN",
      "en-US",
    ]);
    expect(options.map((option) => option.label)).to.deep.equal([
      "t:settings-prompts-language-auto",
      "t:settings-prompts-language-zh",
      "t:settings-prompts-language-en",
    ]);
    expect(seen).to.deep.equal(
      [...PROMPT_LANGUAGE_ORDER].map(
        (value) => PROMPT_LANGUAGE_LABEL_KEYS[value],
      ),
    );
  });

  it("normalizes unknown select values instead of leaving the box blank", function () {
    // 已知值：大小写与别名都收敛到规范值
    expect(normalizePromptLanguageSelection("zh", "auto")).to.equal("zh-CN");
    expect(normalizePromptLanguageSelection("EN", "auto")).to.equal("en-US");
    expect(normalizePromptLanguageSelection("auto", "zh-CN")).to.equal("auto");
    // 脏值：回退到显式 fallback
    expect(normalizePromptLanguageSelection("klingon", "en-US")).to.equal(
      "en-US",
    );
    expect(normalizePromptLanguageSelection("", "zh-CN")).to.equal("zh-CN");
    expect(normalizePromptLanguageSelection(undefined, "auto")).to.equal(
      "auto",
    );
    expect(normalizePromptLanguageSelection(null, "zh-CN")).to.equal("zh-CN");
  });
});
