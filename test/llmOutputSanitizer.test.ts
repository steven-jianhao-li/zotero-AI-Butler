import { expect } from "chai";
import { sanitizeLLMOutputText } from "../src/modules/llmproviders/shared/outputSanitizer";

describe("LLM output sanitizer", function () {
  it("removes DeepSeek-style think blocks before note rendering", function () {
    const raw = [
      "<think>The user wants a detailed explanation.",
      "",
      "Let me structure the answer.",
      "</think>",
      "",
      "# 论文讲解：LEO卫星网络中的可持续协作数据卸载框架",
      "",
      "这是正式答案。",
    ].join("\n");

    const sanitized = sanitizeLLMOutputText(raw);

    expect(sanitized).to.equal(
      "# 论文讲解：LEO卫星网络中的可持续协作数据卸载框架\n\n这是正式答案。",
    );
    expect(sanitized).not.to.contain("The user wants");
    expect(sanitized).not.to.contain("<think>");
  });

  it("keeps normal output unchanged", function () {
    const raw = "## 摘要\n\n论文提出 SusCO 框架。";

    expect(sanitizeLLMOutputText(raw)).to.equal(raw);
  });

  it("removes multiple common reasoning tag names", function () {
    const raw =
      "开头\n<thinking>hidden A</thinking>\n中间\n<reasoning>hidden B</reasoning>\n结尾";

    expect(sanitizeLLMOutputText(raw)).to.equal("开头\n\n中间\n\n结尾");
  });
});
