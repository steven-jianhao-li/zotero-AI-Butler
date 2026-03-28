import { expect } from "chai";
import { ImageClient } from "../src/modules/imageClient";

describe("ImageClient OpenAI compat response parsing", function () {
  it("should parse regular JSON response", function () {
    const raw = JSON.stringify({
      choices: [
        {
          message: { role: "assistant", content: "https://example.com/a.png" },
        },
      ],
    });

    const parsed = (ImageClient as any).parseOpenAICompatibleResponse(raw);

    expect(parsed).to.be.an("object");
    expect(parsed?.choices?.[0]?.message?.content).to.equal(
      "https://example.com/a.png",
    );
  });

  it("should fallback-parse SSE response even when stream=false", function () {
    const sse =
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"grok-imagine-1.0","choices":[{"index":0,"delta":{"role":"assistant","content":"https://example.com/"}}]}\n\n' +
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"grok-imagine-1.0","choices":[{"index":0,"delta":{"content":"img.png"},"finish_reason":"stop"}]}\n\n' +
      "data: [DONE]\n\n";

    const parsed = (ImageClient as any).parseOpenAICompatibleResponse(sse);

    expect(parsed).to.be.an("object");
    expect(parsed?.object).to.equal("chat.completion");
    expect(parsed?.choices?.[0]?.message?.content).to.equal(
      "https://example.com/img.png",
    );
    expect(parsed?.choices?.[0]?.finish_reason).to.equal("stop");
  });

  it("should ignore malformed SSE chunks and still recover valid text", function () {
    const sse =
      'data: {"id":"chatcmpl-2","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"hello "}}]}\n\n' +
      'data: {"id":"chatcmpl-2","object":"chat.completion.chunk","choices":,"usage":{}}\n\n' +
      'data: {"id":"chatcmpl-2","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"world"},"finish_reason":"stop"}]}\n\n' +
      "data: [DONE]\n\n";

    const parsed = (ImageClient as any).parseOpenAICompatibleResponse(sse);

    expect(parsed?.choices?.[0]?.message?.content).to.equal("hello world");
    expect(parsed?.choices?.[0]?.finish_reason).to.equal("stop");
  });
});
