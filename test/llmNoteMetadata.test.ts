import { expect } from "chai";
import {
  LEGACY_SUMMARY_BLOCK_ID,
  LLMNoteMetadataService,
  type LLMNoteMetadata,
} from "../src/modules/llmNoteMetadata";

function metadata(blockId: string): LLMNoteMetadata {
  return {
    schema: "AI_BUTLER_LLM_NOTE_BLOCK",
    version: 1,
    blockId,
    task: "summary",
    endpointId: "endpoint-a",
    providerId: "openai",
    providerName: "OpenAI Primary",
    modelId: "gpt-5",
    generatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function compactInterTagWhitespace(html: string): string {
  return html.replace(/>\s+</g, "><").trim();
}

describe("LLMNoteMetadataService", function () {
  it("wraps, parses, and strips metadata blocks", function () {
    const html = "<h2>AI 总结</h2><div>Visible content</div>";
    const wrapped = LLMNoteMetadataService.wrapHtml(html, metadata("block-a"));

    const blocks = LLMNoteMetadataService.parseAll(wrapped);

    expect(blocks).to.have.length(1);
    expect(blocks[0].metadata).to.include({
      blockId: "block-a",
      endpointId: "endpoint-a",
      providerId: "openai",
      providerName: "OpenAI Primary",
      modelId: "gpt-5",
    });
    const stripped = LLMNoteMetadataService.stripMetadataComments(wrapped);
    expect(stripped).to.contain('data-ai-butler-llm-source="v1"');
    expect(stripped).to.contain("AI 来源：");
    expect(stripped).to.contain("供应商：OpenAI Primary");
    expect(stripped).to.contain("· 模型：gpt-5");
    expect(stripped).to.contain("OpenAI Primary");
    expect(stripped).to.contain("gpt-5");
    const titleIndex = stripped.indexOf("<h2>AI 总结</h2>");
    const sourceIndex = stripped.indexOf('data-ai-butler-llm-source="v1"');
    const bodyIndex = stripped.indexOf("<div>Visible content</div>");
    expect(stripped.trim().startsWith("<h2>AI 总结</h2>")).to.equal(true);
    expect(titleIndex).to.be.lessThan(sourceIndex);
    expect(sourceIndex).to.be.lessThan(bodyIndex);
    expect(
      LLMNoteMetadataService.formatSelectorLabel(metadata("block-a")),
    ).to.contain("供应商: OpenAI Primary 模型: gpt-5");
    expect(
      compactInterTagWhitespace(
        LLMNoteMetadataService.stripSidebarMetadata(wrapped),
      ),
    ).to.equal(html);
  });

  it("ignores similar visible text that is not a real metadata block", function () {
    const html = [
      "<p><!-- AI_BUTLER_LLM_BLOCK_BEGIN::v1::fake::nonce --></p>",
      "<p>AI_BUTLER_LLM_META_B64URL::v1::not-valid</p>",
      "<p>normal summary text</p>",
    ].join("");

    expect(LLMNoteMetadataService.parseAll(html)).to.deep.equal([]);
    expect(LLMNoteMetadataService.stripMetadataComments(html)).to.contain(
      "normal summary text",
    );
  });

  it("parses multiple blocks in order for future multi-model summaries", function () {
    const first = LLMNoteMetadataService.wrapHtml(
      "<div>first</div>",
      metadata("block-1"),
    );
    const second = LLMNoteMetadataService.wrapHtml("<div>second</div>", {
      ...metadata("block-2"),
      providerName: "OpenRouter Backup",
      modelId: "openrouter/model",
    });

    const blocks = LLMNoteMetadataService.parseAll(
      `${first}\n<hr/>\n${second}`,
    );

    expect(blocks.map((block) => block.blockId)).to.deep.equal([
      "block-1",
      "block-2",
    ]);
    expect(LLMNoteMetadataService.getLatest(`${first}\n${second}`)).to.include({
      blockId: "block-2",
      providerName: "OpenRouter Backup",
    });
  });

  it("replaces one metadata block and keeps it parseable", function () {
    const wrapped = LLMNoteMetadataService.wrapHtml(
      "<h2>AI 总结</h2><p>old</p>",
      metadata("block-a"),
    );

    const updated = LLMNoteMetadataService.replaceBlockContent(
      wrapped,
      "block-a",
      "<h2>AI 总结</h2><p>new</p>",
    );
    const blocks = LLMNoteMetadataService.parseAll(updated);

    expect(blocks).to.have.length(1);
    expect(blocks[0].blockId).to.equal("block-a");
    expect(blocks[0].metadata).to.include({
      providerName: "OpenAI Primary",
      modelId: "gpt-5",
    });
    expect(LLMNoteMetadataService.stripSidebarMetadata(updated)).to.contain(
      "<p>new</p>",
    );
    expect(LLMNoteMetadataService.stripSidebarMetadata(updated)).not.to.contain(
      "<p>old</p>",
    );
  });

  it("replaces only the requested block in a multi-block note", function () {
    const first = LLMNoteMetadataService.wrapHtml(
      "<div>first</div>",
      metadata("block-1"),
    );
    const second = LLMNoteMetadataService.wrapHtml(
      "<div>second</div>",
      metadata("block-2"),
    );
    const noteHtml = `${first}\n<hr/>\n${second}`;

    const updated = LLMNoteMetadataService.replaceBlockContent(
      noteHtml,
      "block-2",
      "<div>second edited</div>",
    );
    const blocks = LLMNoteMetadataService.parseAll(updated);

    expect(blocks.map((block) => block.blockId)).to.deep.equal([
      "block-1",
      "block-2",
    ]);
    expect(
      LLMNoteMetadataService.stripSidebarMetadata(blocks[0].content),
    ).to.contain("first");
    expect(
      LLMNoteMetadataService.stripSidebarMetadata(blocks[1].content),
    ).to.contain("second edited");
    expect(LLMNoteMetadataService.stripSidebarMetadata(updated)).not.to.contain(
      ">second<",
    );
  });

  it("exposes a legacy-only note as an unknown-model summary block", function () {
    const legacy = "<h2>AI 管家 - Paper</h2><p>old summary</p>";

    const blocks = LLMNoteMetadataService.parseSummaryBlocks(legacy);

    expect(blocks).to.have.length(1);
    expect(blocks[0]).to.include({
      kind: "legacy",
      blockId: LEGACY_SUMMARY_BLOCK_ID,
      metadata: null,
      content: legacy,
    });
    expect(
      LLMNoteMetadataService.formatSummaryBlockSelectorLabel(blocks[0]),
    ).to.equal("未记录模型");
  });

  it("keeps legacy content and appended summary metadata as switchable blocks", function () {
    const legacy = "<h2>AI 管家 - Paper</h2><p>old summary</p>";
    const appended = LLMNoteMetadataService.wrapHtml(
      "<h2>AI 管家 - Paper</h2><p>new summary</p>",
      metadata("block-new"),
    );

    const blocks = LLMNoteMetadataService.parseSummaryBlocks(
      `${legacy}\n<hr/>\n${appended}`,
    );

    expect(blocks).to.have.length(2);
    expect(blocks[0]).to.include({
      kind: "legacy",
      blockId: LEGACY_SUMMARY_BLOCK_ID,
    });
    expect(blocks[0].content).to.contain("old summary");
    expect(blocks[0].content).not.to.match(/<hr\s*\/?>/i);
    expect(blocks[1]).to.include({
      kind: "metadata",
      blockId: "block-new",
    });
    expect(blocks[1].content).to.contain("new summary");
  });

  it("uses visible source rows when Zotero strips metadata comments", function () {
    const first = [
      "<h2>AI 管家 - Paper</h2>",
      '<p data-ai-butler-llm-source="v1">',
      '<strong>AI 来源：</strong>供应商：OpenAI Primary · 模型：gpt5.5 · 生成时间：<span title="2026-01-01T00:00:00.000Z">2026/1/1</span>',
      "</p>",
      "<div>first summary</div>",
    ].join("");
    const second = [
      "<h2>AI 管家 - Paper</h2>",
      '<p data-ai-butler-llm-source="v1">',
      '<strong>AI 来源：</strong>供应商：OpenAI Primary · 模型：gptnew · 生成时间：<span title="2026-01-02T00:00:00.000Z">2026/1/2</span>',
      "</p>",
      "<div>second summary</div>",
    ].join("");

    const blocks = LLMNoteMetadataService.parseSummaryBlocks(
      `${first}<hr/>${second}`,
    );

    expect(blocks).to.have.length(2);
    expect(blocks.map((block) => block.metadata?.modelId)).to.deep.equal([
      "gpt5.5",
      "gptnew",
    ]);
    expect(blocks[0].content).to.contain("first summary");
    expect(blocks[1].content).to.contain("second summary");
    expect(
      LLMNoteMetadataService.formatSummaryBlockSelectorLabel(blocks[1]),
    ).to.contain("gptnew");
  });

  it("uses visible blocks as source of truth when only appended comments remain", function () {
    const oldBlock = LLMNoteMetadataService.stripMetadataComments(
      LLMNoteMetadataService.wrapHtml("<h2>AI 管家 - Paper</h2><p>old</p>", {
        ...metadata("block-old"),
        modelId: "gpt5.5",
      }),
    );
    const appendedBlock = LLMNoteMetadataService.wrapHtml(
      "<h2>AI 管家 - Paper</h2><p>new</p>",
      {
        ...metadata("block-new"),
        modelId: "gptnew",
        generatedAt: "2026-01-02T00:00:00.000Z",
      },
    );

    const blocks = LLMNoteMetadataService.parseSummaryBlocks(
      `${oldBlock}<hr/>${appendedBlock}`,
    );

    expect(blocks).to.have.length(2);
    expect(blocks.map((block) => block.kind)).to.deep.equal([
      "metadata",
      "metadata",
    ]);
    expect(blocks.map((block) => block.metadata?.modelId)).to.deep.equal([
      "gpt5.5",
      "gptnew",
    ]);
  });

  it("infers source rows even when Zotero strips metadata data attributes", function () {
    const first = [
      "<h2>AI 管家 - Paper</h2>",
      "<p>",
      '<strong>AI 来源：</strong>供应商：OpenAI Primary · 模型：gpt5.5 · 生成时间：<span title="2026-01-01T00:00:00.000Z">2026/1/1</span>',
      "</p>",
      "<div>first summary</div>",
    ].join("");
    const second = [
      "<h2>AI 管家 - Paper</h2>",
      "<p>",
      '<strong>AI 来源：</strong>供应商：OpenAI Primary · 模型：gptnew · 生成时间：<span title="2026-01-02T00:00:00.000Z">2026/1/2</span>',
      "</p>",
      "<div>second summary</div>",
    ].join("");

    const blocks = LLMNoteMetadataService.parseSummaryBlocks(
      `${first}<hr/>${second}`,
    );

    expect(blocks).to.have.length(2);
    expect(blocks.map((block) => block.metadata?.modelId)).to.deep.equal([
      "gpt5.5",
      "gptnew",
    ]);
    expect(
      LLMNoteMetadataService.stripSidebarMetadata(blocks[0].content),
    ).not.to.contain("AI 来源");
  });

  it("filters chat metadata blocks out of summary block selectors", function () {
    const summary = LLMNoteMetadataService.wrapHtml(
      "<h2>AI 总结</h2><p>summary</p>",
      metadata("summary-block"),
    );
    const chat = LLMNoteMetadataService.wrapHtml("<p>chat</p>", {
      ...metadata("chat-block"),
      blockId: "chat-block",
      task: "chat",
    });

    const blocks = LLMNoteMetadataService.parseSummaryBlocks(
      `${summary}\n<hr/>\n${chat}`,
    );

    expect(blocks).to.have.length(1);
    expect(blocks[0]).to.include({
      kind: "metadata",
      blockId: "summary-block",
    });
    expect(blocks[0].content).not.to.contain("chat");
  });

  it("removes one metadata summary block and keeps remaining summaries parseable", function () {
    const first = LLMNoteMetadataService.wrapHtml(
      "<h2>first</h2><p>first body</p>",
      metadata("block-1"),
    );
    const second = LLMNoteMetadataService.wrapHtml(
      "<h2>second</h2><p>second body</p>",
      metadata("block-2"),
    );

    const updated = LLMNoteMetadataService.removeSummaryBlock(
      `${first}\n<hr/>\n${second}`,
      "block-1",
    );
    const blocks = LLMNoteMetadataService.parseSummaryBlocks(updated);

    expect(blocks).to.have.length(1);
    expect(blocks[0].blockId).to.equal("block-2");
    expect(updated).not.to.contain("first body");
    expect(updated).to.contain("second body");
  });

  it("removes legacy summary content without deleting metadata blocks", function () {
    const legacy = "<h2>AI 管家 - Paper</h2><p>old summary</p>";
    const appended = LLMNoteMetadataService.wrapHtml(
      "<h2>AI 管家 - Paper</h2><p>new summary</p>",
      metadata("block-new"),
    );

    const updated = LLMNoteMetadataService.removeSummaryBlock(
      `${legacy}\n<hr/>\n${appended}`,
      LEGACY_SUMMARY_BLOCK_ID,
    );
    const blocks = LLMNoteMetadataService.parseSummaryBlocks(updated);

    expect(blocks).to.have.length(1);
    expect(blocks[0].blockId).to.equal("block-new");
    expect(updated).not.to.contain("old summary");
    expect(updated).to.contain("new summary");
  });

  it("reports no summary blocks after deleting the only legacy block", function () {
    const updated = LLMNoteMetadataService.removeSummaryBlock(
      "<h2>AI 管家 - Paper</h2><p>old summary</p>",
      LEGACY_SUMMARY_BLOCK_ID,
    );

    expect(updated).to.equal("");
    expect(LLMNoteMetadataService.hasSummaryBlocks(updated)).to.equal(false);
  });
});
