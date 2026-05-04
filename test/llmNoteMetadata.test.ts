import { expect } from "chai";
import {
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
    expect(stripped).to.contain(html);
    expect(stripped.trim().startsWith("<h2>AI 总结</h2>")).to.equal(true);
    expect(stripped.indexOf("<h2>AI 总结</h2>")).to.be.lessThan(
      stripped.indexOf('data-ai-butler-llm-source="v1"'),
    );
    expect(
      LLMNoteMetadataService.formatSelectorLabel(metadata("block-a")),
    ).to.equal("供应商: OpenAI Primary 模型: gpt-5 ⓘ");
    expect(LLMNoteMetadataService.stripSidebarMetadata(wrapped)).to.equal(html);
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
});
