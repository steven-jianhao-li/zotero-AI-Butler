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
    expect(
      isRegularSummaryNote([], "<h2>AI 总结 - Paper</h2><p>Summary</p>"),
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

  it("recognizes deep-read notes by heading and excludes them from summaries", function () {
    const deepReadHtml = "<h2>AI \u7cbe\u8bfb - Paper</h2><p>Detail</p>";
    const legacyDeepReadHtml =
      "<h2>AI \u7ba1\u5bb6 - \u7cbe\u8bfb - Paper</h2><p>Detail</p>";

    expect(isDeepReadNote([], deepReadHtml)).to.equal(true);
    expect(isDeepReadNote([], legacyDeepReadHtml)).to.equal(true);
    expect(isRegularSummaryNote([], deepReadHtml)).to.equal(false);
    expect(isRegularSummaryNote([], legacyDeepReadHtml)).to.equal(false);
    expect(classifyAiButlerNote([], deepReadHtml)).to.equal("deepRead");
  });

  it("treats old multi-model summaries mistagged as deep-read as summaries", function () {
    const wrongMultiModelSummary =
      "<h2>AI 管家 - Paper</h2><p>Provider A summary</p>";
    const tags = [{ tag: "AI-DeepRead" }];

    expect(isRegularSummaryNote(tags, wrongMultiModelSummary)).to.equal(true);
    expect(isDeepReadNote(tags, wrongMultiModelSummary)).to.equal(false);
    expect(classifyAiButlerNote(tags, wrongMultiModelSummary)).to.equal(
      "summary",
    );
  });

  it("keeps real deep-read slot notes as deep-read even if tags are present", function () {
    const deepReadHtml = [
      "<h1>AI 精读 - Paper</h1>",
      "<!-- zab:slot:overview:done -->",
      "<p>Detailed reading</p>",
      "<!-- zab:slot:overview:end -->",
    ].join("\n");
    const tags = [{ tag: "AI-DeepRead" }];

    expect(isRegularSummaryNote(tags, deepReadHtml)).to.equal(false);
    expect(isDeepReadNote(tags, deepReadHtml)).to.equal(true);
  });
});
