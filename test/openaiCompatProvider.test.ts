import { expect } from "chai";
import { OpenAICompatProvider } from "../src/modules/llmproviders/OpenAICompatProvider";
import { OpenAIProvider } from "../src/modules/llmproviders/OpenAIProvider";
import { buildAgentHttpRequest } from "../src/modules/llmproviders/shared/agentTransport";
import type { LLMOptions } from "../src/modules/llmproviders/types";

const globals = globalThis as unknown as Record<string, unknown>;
const options: LLMOptions = {
  apiUrl: "https://example.invalid/v1/chat/completions",
  apiKey: "test-key",
  maxTokens: 2048,
  stream: false,
};
const conversation = [{ role: "user" as const, content: "Reply with OK." }];
const pdf = {
  filePath: "fixture.pdf",
  displayName: "fixture.pdf",
  base64Content: "JVBERi0K",
};

describe("OpenAI-compatible token limits (#438)", function () {
  const provider = new OpenAICompatProvider();
  const originals = new Map<string, unknown>();
  let tokenField: "max_tokens" | "max_completion_tokens";
  let requests: Record<string, unknown>[];

  beforeEach(function () {
    for (const key of ["Zotero", "addon", "ztoolkit"])
      originals.set(key, globals[key]);
    tokenField = "max_completion_tokens";
    requests = [];
    globals.addon = { data: {} };
    globals.ztoolkit = { log() {} };
    globals.Zotero = {
      Prefs: { get: () => undefined },
      HTTP: {
        request: async (
          _method: string,
          _url: string,
          request: { body: string },
        ) => {
          const payload = JSON.parse(request.body) as Record<string, unknown>;
          requests.push(payload);
          const unsupported =
            tokenField === "max_completion_tokens"
              ? "max_tokens"
              : "max_completion_tokens";
          if (unsupported in payload) {
            const message = `Unsupported parameter: '${unsupported}' is not supported with this model. Use '${tokenField}' instead.`;
            throw Object.assign(new Error(message), {
              xmlhttp: {
                status: 400,
                response: JSON.stringify({ error: { message } }),
              },
            });
          }
          const choice = { message: { content: "OK" }, finish_reason: "stop" };
          return {
            status: 200,
            response: payload.stream
              ? `data: ${JSON.stringify({ choices: [{ delta: { content: "OK" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`
              : JSON.stringify({ choices: [choice] }),
            getAllResponseHeaders: () => "content-type: application/json",
          };
        },
      },
    };
  });

  afterEach(function () {
    for (const [key, value] of originals) {
      if (value === undefined) delete globals[key];
      else globals[key] = value;
    }
    originals.clear();
  });

  for (const model of ["gpt-6.1-sol", "gpt-6.1-terra"]) {
    for (const mode of ["text", "pdf-base64"]) {
      it(`${model}: connection test in ${mode} mode accepts the configured token limit`, async function () {
        await provider.testConnection({
          ...options,
          model,
          vendorOptions: { connectionTestMode: mode },
        });
        expect(requests).to.have.length(1);
        expect(requests[0]).to.include({
          max_completion_tokens: 2048,
          stream: false,
        });
      });
    }

    for (const stream of [false, true]) {
      it(`${model}: summaries, chats and multiple PDFs use the same limit (stream=${stream})`, async function () {
        const configured = { ...options, model, stream };
        const operations = [
          () =>
            provider.generateSummary("text", false, "Summarize.", configured),
          () =>
            provider.generateSummary(
              pdf.base64Content,
              true,
              "Summarize.",
              configured,
            ),
          () => provider.chat("text", false, conversation, configured),
          () =>
            provider.chat(pdf.base64Content, true, conversation, configured),
          () =>
            provider.generateMultiFileSummary([pdf], "Summarize.", configured),
        ];
        for (const operation of operations) {
          const result = await operation();
          expect(result).to.include({
            text: "OK",
            completion: "complete",
            maxOutputTokens: 2048,
          });
          expect(requests.at(-1)).to.include({
            max_completion_tokens: 2048,
            stream,
          });
        }
      });
    }
  }

  it("recognizes modern GPT and o-series model names, including provider prefixes", async function () {
    for (const model of [
      "gpt-5",
      "gpt-5.6-luna",
      "gpt-6-astra",
      "gpt-6.1-sol-2026-10-01",
      "o1-preview",
      "o3-mini",
      "o4-mini",
      "openai/gpt-6.1-sol",
      "models/gpt-6.1-terra",
      " GPT-6.1-SOL ",
    ]) {
      await provider.testConnection({ ...options, model });
      expect(requests.at(-1)).to.have.property("max_completion_tokens", 2048);
    }
  });

  it("preserves legacy limits and sampling settings for other compatible models", async function () {
    tokenField = "max_tokens";
    for (const model of [
      "gpt-3.5-turbo",
      "gpt-4o",
      "gpt-4.1",
      "gpt-oss-120b",
      "deepseek-chat",
      "Qwen/Qwen3-235B-A22B",
    ]) {
      const result = await provider.chat("", false, conversation, {
        ...options,
        model,
        temperature: 0.7,
        topP: 0.9,
      });
      expect(result.maxOutputTokens).to.equal(2048);
      expect(requests.at(-1)).to.include({
        max_tokens: 2048,
        temperature: 0.7,
        top_p: 0.9,
      });
    }
  });

  it("leaves both token fields unset when the user disables the limit", async function () {
    const result = await provider.chat("", false, conversation, {
      ...options,
      model: "gpt-6.1-sol",
      maxTokens: undefined,
    });
    expect(requests[0]).not.to.have.property("max_tokens");
    expect(requests[0]).not.to.have.property("max_completion_tokens");
    expect(result.maxOutputTokens).to.equal(undefined);
  });

  it("uses the same token parameter for the OpenAI provider's Chat Completions path", async function () {
    const result = await new OpenAIProvider().chat("", false, conversation, {
      ...options,
      model: "gpt-6.1-sol",
    });
    expect(result).to.include({ text: "OK", maxOutputTokens: 2048 });
    expect(requests[0]).to.have.property("max_completion_tokens", 2048);
  });

  it("keeps Agent token budgets consistent with compatible provider requests", function () {
    for (const model of ["gpt-6.1-sol", "gpt-6.1-terra", "o3-mini"]) {
      const request = buildAgentHttpRequest("openai-compat", [], [], {
        ...options,
        model,
      });
      expect(request.body).to.have.property("max_completion_tokens", 2048);
      expect(request.body).not.to.have.property("max_tokens");
    }
    for (const providerId of ["openai-compat", "openrouter"]) {
      const request = buildAgentHttpRequest(providerId, [], [], {
        ...options,
        model:
          providerId === "openrouter" ? "openai/gpt-6.1-sol" : "deepseek-chat",
      });
      expect(request.body).to.have.property("max_tokens", 2048);
      expect(request.body).not.to.have.property("max_completion_tokens");
    }
  });
});
