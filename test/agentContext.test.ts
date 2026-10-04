import { expect } from "chai";
import type { LLMAgentMessage } from "../src/modules/llmproviders/agentTypes";
import { validateAgentMessages } from "../src/modules/llmproviders/shared/agentTransport";
import {
  boundedSummaryInput,
  closePendingToolCalls,
  contextSize,
  estimateTokens,
  historySplit,
  pruneToolResults,
} from "../src/modules/agent/context";

const call = (id: string) => ({
  id,
  name: "read_note",
  arguments: '{"noteId":1}',
});

describe("Agent context continuity", function () {
  it("repairs every unfinished parallel call without replaying completed calls", function () {
    const messages: LLMAgentMessage[] = [
      { role: "system", content: "Research." },
      { role: "user", content: "Read notes." },
      {
        role: "assistant",
        content: "",
        toolCalls: [call("a"), call("b"), call("c")],
      },
      { role: "tool", toolCallId: "a", content: '{"result":"done"}' },
    ];
    closePendingToolCalls(messages, "Interrupted");
    expect(() => validateAgentMessages(messages)).not.to.throw();
    expect(
      messages
        .filter((message) => message.role === "tool")
        .map((message) => message.toolCallId),
    ).to.deep.equal(["a", "b", "c"]);
    expect(messages[3].content).to.equal('{"result":"done"}');
    expect(messages[4].content).to.include(
      "Do not replay a write automatically",
    );
    closePendingToolCalls(messages, "Interrupted again");
    expect(messages).to.have.length(6);
  });

  it("never splits an assistant tool batch from any of its results", function () {
    const messages: LLMAgentMessage[] = [
      { role: "system", content: "Research." },
      { role: "user", content: "Read notes." },
      {
        role: "assistant",
        content: "",
        toolCalls: [call("a"), call("b"), call("c")],
      },
      ...["a", "b", "c"].map((id) => ({
        role: "tool" as const,
        toolCallId: id,
        content: "Evidence",
      })),
      { role: "assistant", content: "Done" },
    ];
    for (let keep = 1; keep <= 8; keep++) {
      const split = historySplit(messages, keep);
      expect(() =>
        validateAgentMessages(messages.slice(0, split)),
      ).not.to.throw();
      expect(() =>
        validateAgentMessages([messages[0], ...messages.slice(split)]),
      ).not.to.throw();
    }
  });

  it("prunes old evidence while preserving result references and recent calls verbatim", function () {
    const original: LLMAgentMessage[] = [
      { role: "system", content: "Research." },
    ];
    for (let i = 0; i < 7; i++) {
      original.push(
        { role: "user", content: `Step ${i}` },
        {
          role: "assistant",
          content: "",
          toolCalls: [call(`call-${i}`)],
          providerState: {
            providerId: "openai",
            parts: [{ type: "reasoning", encrypted_content: `signed-${i}` }],
          },
        },
        {
          role: "tool",
          toolCallId: `call-${i}`,
          content: JSON.stringify({
            resultRef: `result-${i}`,
            result: "Long evidence. ".repeat(700),
          }),
        },
      );
    }
    const snapshot = JSON.stringify(original);
    const pruned = pruneToolResults(original);
    expect(contextSize(pruned, [])).to.be.lessThan(contextSize(original, []));
    expect(JSON.stringify(original)).to.equal(snapshot);
    expect(JSON.parse(pruned[3].content).resultRef).to.equal("result-0");
    expect(pruned.slice(historySplit(original))).to.deep.equal(
      original.slice(historySplit(original)),
    );
    expect(() => validateAgentMessages(pruned)).not.to.throw();
    expect(pruned[2].providerState).to.deep.equal(original[2].providerState);
  });

  it("leaves recent evidence and complete history unchanged during interruption repair", function () {
    const messages: LLMAgentMessage[] = [
      { role: "user", content: "Question" },
      { role: "assistant", content: "Answer" },
    ];
    const snapshot = JSON.stringify(messages);
    closePendingToolCalls(messages, "Interrupted");
    expect(JSON.stringify(messages)).to.equal(snapshot);
    expect(pruneToolResults(messages)).to.deep.equal(messages);
  });

  it("preserves legacy evidence when no durable result reference can recover it", function () {
    const messages: LLMAgentMessage[] = [
      { role: "system", content: "Research." },
      { role: "assistant", content: "", toolCalls: [call("legacy")] },
      {
        role: "tool",
        toolCallId: "legacy",
        content: "Original source. ".repeat(500),
      },
      ...Array.from({ length: 10 }, (_, index) => ({
        role: "user" as const,
        content: `Follow-up ${index}`,
      })),
    ];
    expect(pruneToolResults(messages)[2]).to.deep.equal(messages[2]);
  });

  it("bounds multilingual summarizer input while preserving the objective and recent evidence", function () {
    const messages: LLMAgentMessage[] = [
      { role: "user", content: "ORIGINAL_OBJECTIVE" },
      {
        role: "assistant",
        content: "中文文献证据".repeat(5000),
        providerState: {
          providerId: "openai",
          parts: [{ encrypted_content: "opaque-private-state" }],
        },
      },
      { role: "user", content: "LATEST_EVIDENCE" },
    ];
    const input = boundedSummaryInput(messages, 2048);
    expect(estimateTokens(input)).to.be.at.most(2048);
    expect(input).to.include("ORIGINAL_OBJECTIVE");
    expect(input).to.include("LATEST_EVIDENCE");
    expect(input).not.to.include("opaque-private-state");
    expect(input).to.include("Middle omitted");
  });
});
