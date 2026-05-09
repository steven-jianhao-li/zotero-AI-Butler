import { expect } from "chai";
import { ImageClient, ImageGenerationError } from "../src/modules/imageClient";

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
    tools?: Array<{ type?: string; size?: string }>;
    response_format?: string;
    size?: string;
  };
  parseCustomHeaders(rawHeaders: unknown): Record<string, string>;
  mergeRequestHeaders(
    baseHeaders: Record<string, string>,
    customHeaders: unknown,
  ): Record<string, string>;
  downloadImageUrlAsBase64(
    url: string,
    timeoutMs?: number,
  ): Promise<{ imageBase64: string; mimeType: string }>;
};

const imageClientInternals = ImageClient as unknown as ImageClientInternals;

async function withMockedImageDownload<T>(
  contentType: string | null,
  body: ArrayBuffer | ArrayBufferView | string,
  run: () => Promise<T>,
): Promise<T> {
  const originalZotero = (globalThis as any).Zotero;
  (globalThis as any).Zotero = {
    ...(originalZotero || {}),
    HTTP: {
      ...(originalZotero?.HTTP || {}),
      request: async () => ({
        status: 200,
        response: body,
        getResponseHeader: (name: string) =>
          name.toLowerCase() === "content-type" ? contentType : null,
      }),
    },
  };

  try {
    return await run();
  } finally {
    if (originalZotero === undefined) {
      delete (globalThis as any).Zotero;
    } else {
      (globalThis as any).Zotero = originalZotero;
    }
  }
}

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
    expect(payload.tools).to.deep.equal([
      { type: "image_generation", size: "1280x720" },
    ]);
    expect(payload.messages).to.equal(undefined);
  });

  it("should build GPT Image 2 Images API payload with generated size", function () {
    const payload = imageClientInternals.buildOpenAIImagePayload(
      "draw a test image",
      {
        model: "gpt-image-2",
        aspectRatio: "16:9",
        resolution: "4K",
      },
      "images",
    );

    expect(payload.model).to.equal("gpt-image-2");
    expect(payload.prompt).to.equal("draw a test image");
    expect(payload.size).to.equal("3840x2160");
    expect(payload.response_format).to.equal(undefined);
  });

  it("should parse custom image request headers from JSON", function () {
    const headers = imageClientInternals.parseCustomHeaders(
      '{"X-ModelScope-Async-Mode":"true"}',
    );

    expect(headers).to.deep.equal({
      "X-ModelScope-Async-Mode": "true",
    });
  });

  it("should parse common Python dict custom header snippets", function () {
    const headers = imageClientInternals.parseCustomHeaders(
      `headers={**common_headers, 'X-ModelScope-Async-Mode': 'true'}`,
    );

    expect(headers).to.deep.equal({
      "X-ModelScope-Async-Mode": "true",
    });
  });

  it("should append custom image headers without overriding protected headers", function () {
    const headers = imageClientInternals.mergeRequestHeaders(
      {
        "Content-Type": "application/json",
        Authorization: "Bearer real-key",
      },
      {
        "X-ModelScope-Async-Mode": true,
        authorization: "Bearer ignored",
      },
    );

    expect(headers).to.deep.equal({
      "Content-Type": "application/json",
      Authorization: "Bearer real-key",
      "X-ModelScope-Async-Mode": "true",
    });
  });

  it("should sniff downloaded PNG when response is application/octet-stream", async function () {
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);

    const result = await withMockedImageDownload(
      "application/octet-stream",
      pngBytes.buffer,
      () =>
        imageClientInternals.downloadImageUrlAsBase64(
          "https://example.com/siliconflow-output",
          30000,
        ),
    );

    expect(result.mimeType).to.equal("image/png");
    expect(result.imageBase64).to.equal("iVBORw0KGgo=");
  });

  it("should fallback to image URL suffix for generic content type", async function () {
    const result = await withMockedImageDownload(
      "application/octet-stream",
      new Uint8Array([1, 2, 3, 4]).buffer,
      () =>
        imageClientInternals.downloadImageUrlAsBase64(
          "https://cdn.example.com/result.webp?token=abc",
          30000,
        ),
    );

    expect(result.mimeType).to.equal("image/webp");
  });

  it("should parse octet-stream data URLs when bytes identify an image", function () {
    const extracted = imageClientInternals.extractImageFromOpenAIResponseJson({
      data: [
        {
          url: "data:application/octet-stream;base64,iVBORw0KGgo=",
        },
      ],
    });

    expect(extracted).to.deep.equal({
      imageBase64: "iVBORw0KGgo=",
      mimeType: "image/png",
    });
  });

  it("should reject downloaded generic binary without image evidence", async function () {
    let caught: unknown = null;
    try {
      await withMockedImageDownload(
        "application/octet-stream",
        new Uint8Array([1, 2, 3, 4]).buffer,
        () =>
          imageClientInternals.downloadImageUrlAsBase64(
            "https://cdn.example.com/result",
            30000,
          ),
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).to.be.instanceOf(ImageGenerationError);
    expect((caught as ImageGenerationError).details.errorName).to.equal(
      "UnsupportedImageMimeType",
    );
  });
});
