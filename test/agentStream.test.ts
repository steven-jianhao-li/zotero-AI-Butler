import { expect } from "chai";
import { AgentStreamParser } from "../src/modules/llmproviders/shared/agentStream";
import {
  buildAgentHttpRequest,
  parseAgentTurn,
  requestAgentTurn,
  validateAgentTurn,
} from "../src/modules/llmproviders/shared/agentTransport";
import type { LLMAgentStreamUpdate } from "../src/modules/llmproviders/agentTypes";

const tools = [
  {
    name: "search",
    description: "Search",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
];
const options = {
  apiUrl: "https://example.invalid/v1",
  apiKey: "fixture",
  model: "fixture",
  stream: true,
};
const sse = (event: unknown) => `data: ${JSON.stringify(event)}\r\n\r\n`;
const chat = (delta: unknown, finish_reason: string | null = null) =>
  sse({ choices: [{ index: 0, delta, finish_reason }] });

describe("Agent native streaming", function () {
  it("publishes readable deltas while assembling split parallel tool calls without executing them", function () {
    const previews: LLMAgentStreamUpdate[] = [];
    const parser = new AgentStreamParser("chat", (value) =>
      previews.push(value),
    );
    const stream =
      chat({ role: "assistant", reasoning_content: "Look up " }) +
      chat({ reasoning_content: "titles.", content: "Searching." }) +
      chat({
        tool_calls: [
          {
            index: 0,
            id: "c1",
            type: "function",
            function: { name: "search", arguments: '{"query":' },
          },
          { index: 1, id: "c2", function: { name: "sea", arguments: '{"que' } },
        ],
      }) +
      chat(
        {
          tool_calls: [
            { index: 1, function: { name: "rch", arguments: 'ry":"b"}' } },
            { index: 0, function: { arguments: '"a"}' } },
          ],
        },
        "tool_calls",
      ) +
      "data: [DONE]\r\n\r\n";
    for (const character of stream) parser.push(character);
    expect(previews.at(-1)).to.deep.equal({
      text: "Searching.",
      reasoningContent: "Look up titles.",
    });
    expect(JSON.stringify(previews)).not.to.include("arguments");
    const result = validateAgentTurn(
      parseAgentTurn("chat", parser.finish()),
      tools,
    );
    expect(
      result.toolCalls.map((call) => [call.name, call.arguments]),
    ).to.deep.equal([
      ["search", '{"query":"a"}'],
      ["search", '{"query":"b"}'],
    ]);
  });

  it("requires terminal markers and rejects length limits, partial JSON and provider errors", function () {
    for (const stream of [
      chat({ content: "Partial" }),
      chat({ content: "Partial" }, "length") + "data: [DONE]\n\n",
      chat(
        {
          tool_calls: [
            {
              index: 0,
              id: "c",
              function: { name: "search", arguments: '{"query":' },
            },
          ],
        },
        "tool_calls",
      ) + "data: [DONE]\n\n",
      sse({ error: { message: "private diagnostic" } }),
    ]) {
      const parser = new AgentStreamParser("chat");
      expect(() => {
        parser.push(stream);
        validateAgentTurn(parseAgentTurn("chat", parser.finish()), tools);
      }).to.throw();
    }
  });

  it("uses the canonical Responses completion and never displays encrypted replay data", function () {
    const previews: LLMAgentStreamUpdate[] = [];
    const parser = new AgentStreamParser("responses", (value) =>
      previews.push(value),
    );
    parser.push(
      sse({
        type: "response.reasoning_summary_text.delta",
        delta: "Check sources.",
      }),
    );
    parser.push(sse({ type: "response.output_text.delta", delta: "Answer" }));
    parser.push(
      sse({
        type: "response.completed",
        response: {
          status: "completed",
          output: [
            {
              type: "reasoning",
              encrypted_content: "secret-replay",
              summary: [{ type: "summary_text", text: "Check sources." }],
            },
            {
              type: "message",
              content: [{ type: "output_text", text: "Answer" }],
            },
          ],
        },
      }),
    );
    const result = parseAgentTurn("responses", parser.finish());
    expect(result.text).to.equal("Answer");
    expect(JSON.stringify(previews)).not.to.include("secret-replay");
    expect(result.providerState?.parts[0].encrypted_content).to.equal(
      "secret-replay",
    );
  });

  it("reconstructs Anthropic tool input and signed thinking", function () {
    const parser = new AgentStreamParser("anthropic");
    for (const event of [
      { type: "message_start", message: { usage: { input_tokens: 10 } } },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "Read titles." },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "signature_delta", signature: "signed" },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "tool_use",
          id: "c1",
          name: "search",
          input: {},
        },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: '{"query":' },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: '"paper"}' },
      },
      { type: "content_block_stop", index: 1 },
      {
        type: "message_delta",
        delta: { stop_reason: "tool_use" },
        usage: { output_tokens: 20 },
      },
      { type: "message_stop" },
    ])
      parser.push(sse(event));
    const result = validateAgentTurn(
      parseAgentTurn("anthropic", parser.finish()),
      tools,
    );
    expect(result.reasoningContent).to.equal("Read titles.");
    expect(result.toolCalls[0].arguments).to.equal('{"query":"paper"}');
    expect(result.providerState?.parts[0].signature).to.equal("signed");
    expect(result.usage).to.include({ inputTokens: 10, outputTokens: 20 });
  });

  it("preserves Gemini function-call thought signatures and uses the SSE endpoint", function () {
    const parser = new AgentStreamParser("google");
    parser.push(
      sse({
        candidates: [
          { content: { parts: [{ text: "Compare", thought: true }] } },
        ],
      }),
    );
    parser.push(
      sse({
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    id: "c1",
                    name: "search",
                    args: { query: "paper" },
                  },
                  thoughtSignature: "signed",
                },
              ],
            },
            finishReason: "STOP",
          },
        ],
      }),
    );
    const result = validateAgentTurn(
      parseAgentTurn("google", parser.finish()),
      tools,
    );
    expect(result.reasoningContent).to.equal("Compare");
    expect(result.providerState?.parts[1].thoughtSignature).to.equal("signed");
    expect(buildAgentHttpRequest("google", [], tools, options).url).to.include(
      ":streamGenerateContent?alt=sse",
    );
  });

  it("delivers XHR progress before the request completes and accepts JSON fallbacks", async function () {
    const globals = globalThis as unknown as { Zotero: unknown };
    const previous = globals.Zotero;
    const updates: LLMAgentStreamUpdate[] = [];
    let progress: (() => void) | undefined;
    let removed = false;
    let mode = "sse";
    globals.Zotero = {
      HTTP: {
        request: async (
          _method: string,
          _url: string,
          config: { requestObserver(xhr: unknown): void },
        ) => {
          const xhr = {
            status: 200,
            responseText: "",
            abort() {},
            addEventListener(_name: string, fn: () => void) {
              progress = fn;
            },
            removeEventListener() {
              removed = true;
            },
          };
          config.requestObserver(xhr);
          if (mode === "json")
            return {
              responseText: JSON.stringify({
                choices: [
                  {
                    message: { role: "assistant", content: "Fallback" },
                    finish_reason: "stop",
                  },
                ],
              }),
            };
          xhr.responseText = chat({
            reasoning_content: "Thinking",
            content: "First",
          });
          progress!();
          expect(updates.at(-1)?.text).to.equal("First");
          xhr.responseText +=
            chat({ content: " reply" }, "stop") + "data: [DONE]\n\n";
          return xhr;
        },
      },
    };
    try {
      expect(
        (
          await requestAgentTurn(
            "openai-compat",
            [],
            [],
            options,
            undefined,
            (update) => updates.push(update),
          )
        ).text,
      ).to.equal("First reply");
      expect(removed).to.equal(true);
      mode = "json";
      expect(
        (await requestAgentTurn("openai-compat", [], [], options)).text,
      ).to.equal("Fallback");
    } finally {
      globals.Zotero = previous;
    }
  });
});
