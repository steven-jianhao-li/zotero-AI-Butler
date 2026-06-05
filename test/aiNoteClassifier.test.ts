import { expect } from "chai";
import {
  classifyAiButlerNote,
  isDeepReadNote,
  isRegularSummaryNote,
} from "../src/modules/aiNoteClassifier";

describe("AI note classifier", function () {
  it("does not treat saved follow-up chat notes as summary notes", function () {
    const noteHtml = "<h2>AI 管家 - 后续追问 - Paper</h2><p>Q: why?</p>";
    const legacyTitleHtml = "<h2>AI 管家 - 后续追问笔记</h2><p>Q: why?</p>";

    expect(isRegularSummaryNote([], noteHtml)).to.equal(false);
    expect(isRegularSummaryNote([], legacyTitleHtml)).to.equal(false);
    expect(
      isRegularSummaryNote([{ tag: "AI-Butler-Chat" }], noteHtml),
    ).to.equal(false);
  });

  it("recognizes regular summary notes by tag or heading", function () {
    expect(isRegularSummaryNote([{ tag: "AI-Generated" }], "")).to.equal(true);
    expect(
      isRegularSummaryNote([], "<h2>AI 管家 - Paper</h2><p>Summary</p>"),
    ).to.equal(true);
  });

  it("does not reject a tagged summary only because the title starts with follow-up text", function () {
    const noteHtml = "<h2>AI 管家 - 后续追问 - 作为研究主题</h2>";

    expect(isRegularSummaryNote([{ tag: "AI-Generated" }], noteHtml)).to.equal(
      true,
    );
  });

  it("recognizes AI summary and deep-read tags separately", function () {
    expect(isRegularSummaryNote([{ tag: "AI-Summary" }], "")).to.equal(true);
    expect(isRegularSummaryNote([{ tag: "AI-DeepRead" }], "")).to.equal(false);
    expect(isDeepReadNote([{ tag: "AI-DeepRead" }], "")).to.equal(true);
    expect(classifyAiButlerNote([{ tag: "AI-Summary" }], "")).to.equal(
      "summary",
    );
    expect(classifyAiButlerNote([{ tag: "AI-DeepRead" }], "")).to.equal(
      "deepRead",
    );
  });
});
