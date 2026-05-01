import { expect } from "chai";
import { ImageClient } from "../src/modules/imageClient";

type ImageClientInternals = {
  parseOpenAICompatibleResponse(rawResponse: unknown): {
    object?: string;
    choices?: Array<{
      message?: { content?: string };
      finish_reason?: string | null;
    }>;
    output?: Array<{
      type?: string;
      result?: string;
      output_format?: string;
    }>;
  };
  extractImageFromOpenAIResponseJson(json: unknown): {
    imageBase64: string;
    mimeType: string;
  } | null;
  buildOpenAIImagePayload(
    prompt: string,
    config: {
      model: string;
      aspectRatio: string;
      resolution: string;
    },
    endpointType: "images" | "responses" | "chat",
  ): {
    model?: string;
    input?: string;
    prompt?: string;
    messages?: Array<{ role?: string; content?: string }>;
    tools?: Array<{ type?: string }>;
    response_format?: string;
  };
};

const imageClientInternals = ImageClient as unknown as ImageClientInternals;

describe("ImageClient OpenAI compat response parsing", function () {
  it("should parse regular JSON response", function () {
    const raw = JSON.stringify({
      choices: [
        {
          message: { role: "assistant", content: "https://example.com/a.png" },
        },
      ],
    });

    const parsed = imageClientInternals.parseOpenAICompatibleResponse(raw);

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

    const parsed = imageClientInternals.parseOpenAICompatibleResponse(sse);

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

    const parsed = imageClientInternals.parseOpenAICompatibleResponse(sse);

    expect(parsed?.choices?.[0]?.message?.content).to.equal("hello world");
    expect(parsed?.choices?.[0]?.finish_reason).to.equal("stop");
  });

  it("should extract Responses API image_generation_call result", function () {
    const extracted = imageClientInternals.extractImageFromOpenAIResponseJson({
      output: [
        {
          type: "image_generation_call",
          output_format: "png",
          result: "iVBORw0KGgo=",
        },
      ],
    });

    expect(extracted).to.deep.equal({
      imageBase64: "iVBORw0KGgo=",
      mimeType: "image/png",
    });
  });

  it("should fallback-parse Responses API SSE image output", function () {
    const sse =
      'data: {"type":"response.output_item.done","item":{"type":"image_generation_call","output_format":"jpeg","result":"abc123=="}}\n\n' +
      "data: [DONE]\n\n";

    const parsed = imageClientInternals.parseOpenAICompatibleResponse(sse);
    const extracted =
      imageClientInternals.extractImageFromOpenAIResponseJson(parsed);

    expect(parsed?.object).to.equal("response");
    expect(extracted).to.deep.equal({
      imageBase64: "abc123==",
      mimeType: "image/jpeg",
    });
  });

  it("should build Responses API image generation payload with image_generation tool", function () {
    const payload = imageClientInternals.buildOpenAIImagePayload(
      "draw a test image",
      {
        model: "gpt-image-2",
        aspectRatio: "16:9",
        resolution: "1K",
      },
      "responses",
    );

    expect(payload.model).to.equal("gpt-image-2");
    expect(payload.input).to.contain("draw a test image");
    expect(payload.input).to.contain("Aspect ratio: 16:9.");
    expect(payload.input).to.contain("Resolution: 1K.");
    expect(payload.tools).to.deep.equal([{ type: "image_generation" }]);
    expect(payload.messages).to.equal(undefined);
  });
});
