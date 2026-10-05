import { expect } from "chai";
import { LLMEndpointManager } from "../src/modules/llmEndpointManager";
import LLMService from "../src/modules/llmService";
import { ProviderRegistry } from "../src/modules/llmproviders/ProviderRegistry";
import type { LLMOptions } from "../src/modules/llmproviders/types";
import { buildAgentHttpRequest } from "../src/modules/llmproviders/shared/agentTransport";
import {
  mergeRequestHeaders,
  parseCustomRequestHeaders,
} from "../src/modules/llmproviders/shared/requestHeaders";

const globals = globalThis as unknown as Record<string, unknown>;
const providerIds = LLMEndpointManager.providerTypes();
const customHeaders = {
  "User-Agent": "my-client/1.0",
  "X-Client-Name": "header-test",
  authorization: "Bearer custom-token",
  "x-api-key": "custom-key",
  "x-goog-api-key": "custom-google-key",
  "anthropic-version": "custom-version",
  accept: "application/custom+json",
};

type MockRequestOptions = {
  headers: Record<string, string>;
  body?: string;
  responseType?: string;
  requestObserver?: (xhr: XMLHttpRequest) => void;
};

function mockResponse(providerId: string, stream: boolean): string {
  const responses = {
    status: "completed",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "OK" }],
      },
    ],
  };
  if (stream) {
    if (providerId === "ollama") {
      return `${JSON.stringify({ message: { content: "OK" }, done: true, done_reason: "stop" })}\n`;
    }
    const events =
      providerId === "openai" || providerId === "volcanoark"
        ? [
            { type: "response.output_text.delta", delta: "OK" },
            { type: "response.completed", response: responses },
          ]
        : providerId === "anthropic"
          ? [
              {
                type: "content_block_delta",
                delta: { type: "text_delta", text: "OK" },
              },
              { type: "message_delta", delta: { stop_reason: "end_turn" } },
              { type: "message_stop" },
            ]
          : providerId === "google"
            ? [
                {
                  candidates: [
                    {
                      content: { parts: [{ text: "OK" }] },
                      finishReason: "STOP",
                    },
                  ],
                },
              ]
            : [
                {
                  choices: [
                    { delta: { content: "OK" }, finish_reason: "stop" },
                  ],
                },
              ];
    return (
      events
        .map(
          (event) =>
            `${"type" in event ? `event: ${event.type}\n` : ""}data: ${JSON.stringify(event)}\n\n`,
        )
        .join("") + "data: [DONE]\n\n"
    );
  }
  if (providerId === "openai" || providerId === "volcanoark") {
    return JSON.stringify(responses);
  }
  if (providerId === "anthropic") {
    return JSON.stringify({
      content: [{ type: "text", text: "OK" }],
      stop_reason: "end_turn",
    });
  }
  if (providerId === "google") {
    return JSON.stringify({
      candidates: [
        { content: { parts: [{ text: "OK" }] }, finishReason: "STOP" },
      ],
    });
  }
  if (providerId === "ollama") {
    return JSON.stringify({ message: { content: "OK" }, done_reason: "stop" });
  }
  return JSON.stringify({
    choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
  });
}

describe("Custom LLM request headers", function () {
  const originals = new Map<string, unknown>();
  let providerId: string;
  let requests: MockRequestOptions[];

  beforeEach(function () {
    for (const name of ["Zotero", "addon", "ztoolkit"]) {
      originals.set(name, globals[name]);
    }
    requests = [];
    const prefs = new Map<string, unknown>();
    globals.addon = { data: {} };
    globals.ztoolkit = { log: () => undefined };
    globals.Zotero = {
      locale: "en-US",
      Prefs: {
        get: (key: string) => prefs.get(key),
        set: (key: string, value: unknown) => prefs.set(key, value),
        clear: (key: string) => prefs.delete(key),
      },
      HTTP: {
        request: async (
          method: string,
          url: string,
          options: MockRequestOptions,
        ) => {
          requests.push(options);
          const body = options.body ? JSON.parse(options.body) : {};
          const stream =
            body.stream === true || url.includes(":streamGenerate");
          const raw =
            method === "GET"
              ? JSON.stringify({ data: [{ id: "test-model" }] })
              : mockResponse(providerId, stream);
          const xhr = {
            status: 200,
            readyState: 4,
            responseText: raw,
            response: raw,
            onprogress: undefined as ((event: unknown) => void) | undefined,
            abort: () => undefined,
            getAllResponseHeaders: () => "",
          };
          options.requestObserver?.(xhr as unknown as XMLHttpRequest);
          xhr.onprogress?.({ target: xhr });
          return {
            ...xhr,
            response: options.responseType === "json" ? JSON.parse(raw) : raw,
          };
        },
      },
    };
  });

  afterEach(function () {
    for (const [name, value] of originals) {
      if (value === undefined) delete globals[name];
      else globals[name] = value;
    }
    originals.clear();
  });

  it("parses JSON and treats blank settings as no custom headers", function () {
    expect(
      parseCustomRequestHeaders(JSON.stringify(customHeaders)),
    ).to.deep.equal(customHeaders);
    for (const value of [undefined, "", " \n ", "{}"])
      expect(parseCustomRequestHeaders(value)).to.deep.equal({});
  });

  it("rejects malformed JSON, non-object roots, invalid names and invalid values", function () {
    for (const value of [
      '{"Authorization":"confidential-token",',
      "null",
      "[]",
      '"text"',
      '{"Bad Name":"value"}',
      '{"":"value"}',
      '{"X-Test":123}',
      '{"X-Test":null}',
      '{"X-Test":["value"]}',
      '{"X-Test":"line\\r\\nInjected: value"}',
      '{"X-Test":"\\u0000"}',
      '{"X-Test":"\\u4e2d"}',
    ]) {
      expect(() => parseCustomRequestHeaders(value))
        .to.throw()
        .and.have.property("message")
        .that.does.not.include("confidential-token");
    }
  });

  it("overrides names case-insensitively without changing defaults", function () {
    const defaults = {
      Authorization: "Bearer default",
      Accept: "application/json",
    };
    const headers = mergeRequestHeaders(defaults, {
      authorization: "Bearer custom",
      ACCEPT: "first",
      accept: "last",
      "X-Empty": "",
    });
    expect(headers).to.deep.equal({
      authorization: "Bearer custom",
      accept: "last",
      "X-Empty": "",
    });
    expect(defaults.Authorization).to.equal("Bearer default");
    expect(mergeRequestHeaders(defaults)).to.deep.equal(defaults);
  });

  it("keeps headers isolated across persisted endpoints and option assembly", function () {
    const first = {
      ...LLMEndpointManager.createEndpoint("openai"),
      apiKey: "placeholder",
      customHeaders: JSON.stringify(customHeaders),
    };
    const second = LLMEndpointManager.createEndpoint("anthropic");
    LLMEndpointManager.saveEndpoints([first, second]);
    const stored = LLMEndpointManager.getEndpoints();
    expect(LLMService.buildOptions(stored[0]).customHeaders).to.deep.equal(
      customHeaders,
    );
    expect(LLMService.buildOptions(stored[1]).customHeaders).to.deep.equal({});
    expect(() =>
      LLMService.buildOptions({ ...first, customHeaders: "{" }),
    ).to.throw();
    expect(requests).to.have.length(0);
  });

  it("preserves custom headers when synchronizing a migrated legacy endpoint", function () {
    const [endpoint] = LLMEndpointManager.getEndpoints();
    endpoint.customHeaders = JSON.stringify(customHeaders);
    LLMEndpointManager.saveEndpoints([endpoint]);
    expect(
      LLMEndpointManager.syncLegacyPrimaryEndpointFromPrefs()?.customHeaders,
    ).to.equal(endpoint.customHeaders);
  });

  for (const id of providerIds) {
    it(`sends ${id} headers on connection tests, model lists, summaries and chats`, async function () {
      providerId = id;
      const provider = ProviderRegistry.get(id)!;
      const options: LLMOptions = {
        apiUrl: LLMEndpointManager.providerDefaults(id).apiUrl.replace(
          /^https?:\/\/[^/]+/,
          "https://example.invalid",
        ),
        apiKey: "default-key",
        model: "test-model",
        customHeaders,
        stream: false,
      };
      const calls: Array<() => Promise<unknown>> = [
        () => provider.testConnection(options),
        () => provider.listModels!(options),
      ];
      for (const stream of [false, true]) {
        const streamedOptions = { ...options, stream };
        calls.push(
          () =>
            provider.generateSummary(
              "text",
              false,
              "Summarize.",
              streamedOptions,
            ),
          () =>
            provider.chat(
              "text",
              false,
              [{ role: "user", content: "Explain." }],
              streamedOptions,
            ),
        );
        if (provider.capabilities?.supportsPdfBase64) {
          calls.push(
            () =>
              provider.generateSummary(
                "JVBERi0K",
                true,
                "Summarize.",
                streamedOptions,
              ),
            () =>
              provider.chat(
                "JVBERi0K",
                true,
                [{ role: "user", content: "Explain." }],
                streamedOptions,
              ),
          );
          if (provider.generateMultiFileSummary) {
            calls.push(() =>
              provider.generateMultiFileSummary!(
                [
                  {
                    filePath: "unused.pdf",
                    displayName: "Test",
                    base64Content: "JVBERi0K",
                  },
                ],
                "Summarize.",
                streamedOptions,
              ),
            );
          }
        }
      }
      for (const call of calls) {
        requests = [];
        await call();
        expect(requests.length).to.be.greaterThan(0);
        for (const request of requests) {
          expect(request.headers).to.include(customHeaders);
          const names = Object.keys(request.headers).map((name) =>
            name.toLowerCase(),
          );
          expect(new Set(names).size).to.equal(names.length);
        }
      }
    });

    it(`applies ${id} custom headers after building Agent protocol defaults`, function () {
      const request = buildAgentHttpRequest(
        id,
        [{ role: "user", content: "Find papers." }],
        [],
        {
          apiUrl: "https://example.invalid/v1",
          apiKey: "default-key",
          model: "test-model",
          customHeaders,
        },
      );
      expect(request.headers).to.include(customHeaders);
      expect(request.headers).not.to.have.property("Authorization");
    });
  }
});
