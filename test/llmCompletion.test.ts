import { expect } from "chai";
import { config } from "../package.json";
import {
  TextResponseParser,
  type TextProtocol,
} from "../src/modules/llmproviders/shared/textTransport";
import { resolveAnthropicMaxTokens } from "../src/modules/llmproviders/shared/outputTokens";
import { LLMIncompleteError } from "../src/modules/llmproviders/shared/completion";
import { LLMService } from "../src/modules/llmService";
import {
  LLMEndpointManager,
  type LLMEndpoint,
} from "../src/modules/llmEndpointManager";
import { ProviderRegistry } from "../src/modules/llmproviders/ProviderRegistry";
import type {
  LLMOptions,
  LLMProviderResult,
  LLMResponse,
} from "../src/modules/llmproviders/types";
import { NoteGenerator } from "../src/modules/noteGenerator";
import { LLMNoteMetadataService } from "../src/modules/llmNoteMetadata";
import {
  isRegularSummaryNote,
  isDeepReadNote,
} from "../src/modules/aiNoteClassifier";
import {
  TaskQueueManager,
  TaskStatus,
  type TaskItem,
} from "../src/modules/taskQueue";
import { ContentExtractor } from "../src/modules/contentExtractor";

const sse = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
function events(
  protocol: TextProtocol,
  text: string,
  reason: "complete" | "tokens" | "context" = "complete",
): string[] {
  if (protocol === "anthropic")
    return [
      sse({
        type: "message_start",
        message: { id: "request-1", usage: { input_tokens: 8 } },
      }),
      sse({ type: "content_block_delta", delta: { type: "text_delta", text } }),
      sse({
        type: "message_delta",
        delta: {
          stop_reason:
            reason === "complete"
              ? "end_turn"
              : reason === "tokens"
                ? "max_tokens"
                : "model_context_window_exceeded",
        },
        usage: { output_tokens: 5 },
      }),
      sse({ type: "message_stop" }),
    ];
  if (protocol === "responses")
    return [
      sse({ type: "response.output_text.delta", delta: text }),
      sse({
        type:
          reason === "complete" ? "response.completed" : "response.incomplete",
        response: {
          status: reason === "complete" ? "completed" : "incomplete",
          incomplete_details: {
            reason:
              reason === "tokens"
                ? "max_output_tokens"
                : "context_window_exceeded",
          },
          usage: { input_tokens: 8, output_tokens: 5 },
        },
      }),
    ];
  if (protocol === "gemini")
    return [
      sse({ candidates: [{ content: { parts: [{ text }] } }] }),
      sse({
        candidates: [
          {
            finishReason:
              reason === "complete"
                ? "STOP"
                : reason === "tokens"
                  ? "MAX_TOKENS"
                  : "context_window_exceeded",
          },
        ],
      }),
    ];
  if (protocol === "ollama")
    return [
      JSON.stringify({ message: { content: text }, done: false }) + "\n",
      JSON.stringify({
        done: true,
        done_reason:
          reason === "complete"
            ? "stop"
            : reason === "tokens"
              ? "length"
              : "context_window_exceeded",
      }) + "\n",
    ];
  return [
    sse({ choices: [{ delta: { content: text }, finish_reason: null }] }),
    sse({
      choices: [
        {
          delta: {},
          finish_reason:
            reason === "complete"
              ? "stop"
              : reason === "tokens"
                ? "length"
                : "context_window_exceeded",
        },
      ],
    }),
    "data: [DONE]\n\n",
  ];
}

const protocols: TextProtocol[] = [
  "anthropic",
  "responses",
  "chat",
  "gemini",
  "ollama",
];
const providerIds = LLMEndpointManager.providerTypes();
const multiPdfProviderIds = providerIds.filter((id) => id !== "ollama");

describe("LLM completion", function () {
  describe("LLM completion parsing", function () {
    for (const protocol of protocols) {
      it(`${protocol}: arbitrary chunk boundaries, including CRLF, preserve text and completion`, function () {
        const parser = new TextResponseParser(protocol);
        for (const char of events(protocol, "中文\nparagraph")
          .join("")
          .replace(/\n/g, "\r\n"))
          parser.feed(char);
        expect(parser.finish()).to.include({
          text: "中文\nparagraph",
          completion: "complete",
          recovery: "none",
        });
      });
      it(`${protocol}: token limits and context exhaustion remain distinct`, function () {
        for (const reason of ["tokens", "context"] as const) {
          const parser = new TextResponseParser(protocol);
          parser.feed(events(protocol, "partial", reason).join(""));
          expect(parser.finish()).to.include({
            completion: "partial",
            recovery: reason === "tokens" ? "continue" : "none",
          });
        }
      });
      it(`${protocol}: missing terminal and timeout never become success`, function () {
        const parser = new TextResponseParser(protocol);
        const chunks = events(protocol, "partial");
        parser.feed(chunks.slice(0, protocol === "anthropic" ? 2 : 1).join(""));
        expect(parser.finish()).to.include({
          completion: "partial",
          finishReason: "missing_terminal",
        });
        expect(parser.finish(undefined, "timeout")).to.include({
          text: "partial",
          completion: "partial",
          finishReason: "transport_error",
        });
      });
      it(`${protocol}: in-band errors and malformed frames remain failures even after text`, function () {
        const parser = new TextResponseParser(protocol);
        parser.feed(
          events(protocol, "partial")
            .slice(0, protocol === "anthropic" ? 2 : 1)
            .join(""),
        );
        parser.feed(
          protocol === "ollama"
            ? JSON.stringify({ error: "overloaded" }) + "\n"
            : sse({ type: "error", error: { message: "overloaded" } }),
        );
        expect(parser.finish()).to.include({
          completion: "partial",
          finishReason: "provider_error",
        });
      });
      it(`${protocol}: a terminal event cannot hide malformed subsequent data`, function () {
        const parser = new TextResponseParser(protocol);
        parser.feed(events(protocol, "answer").join(""));
        parser.feed(
          protocol === "ollama" ? "{broken}\n" : "data: {broken}\n\n",
        );
        expect(parser.finish()).to.include({
          completion: "partial",
          finishReason: "invalid_stream",
        });
      });

      it(`${protocol}: a later normal terminal cannot erase a token-limit stop`, function () {
        const parser = new TextResponseParser(protocol);
        parser.feed(events(protocol, "partial", "tokens").join(""));
        parser.feed(events(protocol, "", "complete").join(""));
        expect(parser.finish()).to.include({
          completion: "partial",
          recovery: "continue",
        });
      });
    }

    it("does not infer a token limit from an unexplained incomplete Responses status", function () {
      const parser = new TextResponseParser("responses");
      const result = parser.finish(
        JSON.stringify({ status: "incomplete", output_text: "partial" }),
      );
      expect(result).to.include({
        completion: "partial",
        finishReason: "unknown_incomplete",
        recovery: "none",
      });
    });

    it("requires a reason even when a gateway sends DONE", function () {
      const parser = new TextResponseParser("chat");
      parser.feed(events("chat", "partial")[0] + "data: [DONE]\n\n");
      expect(parser.finish().completion).to.equal("partial");
    });

    it("requires Chat Completions DONE even when the last choice reports a normal stop", function () {
      const parser = new TextResponseParser("chat");
      parser.feed(events("chat", "answer").slice(0, 2).join(""));
      expect(parser.finish()).to.include({
        completion: "partial",
        finishReason: "missing_terminal",
      });
    });

    it("recognizes an SSE error event even without a type in its JSON data", function () {
      const parser = new TextResponseParser("chat");
      parser.feed(events("chat", "partial")[0]);
      parser.feed('event: error\ndata: {"message":"overloaded"}\n\n');
      expect(parser.finish()).to.include({
        completion: "partial",
        finishReason: "provider_error",
        error: "overloaded",
      });
    });

    it("does not discard a final unterminated SSE frame silently", function () {
      const parser = new TextResponseParser("anthropic");
      parser.feed(events("anthropic", "partial", "tokens").join("").trimEnd());
      expect(parser.finish()).to.include({
        completion: "partial",
        finishReason: "unfinished_frame",
      });
    });

    it("never treats malformed JSON or blocked output as complete", function () {
      for (const raw of [
        "{",
        JSON.stringify({
          choices: [
            {
              message: { content: "partial" },
              finish_reason: "content_filter",
            },
          ],
        }),
        JSON.stringify({
          choices: [{ message: { content: "" }, finish_reason: "stop" }],
        }),
      ]) {
        expect(new TextResponseParser("chat").finish(raw).completion).to.equal(
          "partial",
        );
      }
    });

    it("uses model-reported output limits and validates overrides", function () {
      expect(resolveAnthropicMaxTokens({}, 64000)).to.equal(64000);
      expect(resolveAnthropicMaxTokens({ maxTokens: 2000 }, 64000)).to.equal(
        2000,
      );
      for (const maxTokens of [0, -1, 1.5, Infinity, 65000])
        expect(() =>
          resolveAnthropicMaxTokens({ maxTokens }, 64000),
        ).to.throw();
    });
  });

  type MockRequest = {
    body?: string;
    requestObserver?: (xhr: XMLHttpRequest) => void;
    headers: Record<string, string>;
  };
  const globals = globalThis as unknown as Record<string, unknown>;

  describe("Provider and LLMService completion contract", function () {
    const originals = new Map<string, unknown>();
    let requests: Array<{ url: string; body: Record<string, unknown> }>;
    let respond: (
      protocol: TextProtocol,
      index: number,
      stream: boolean,
    ) => { raw: string; fail?: boolean; progress?: boolean };
    let prefs: Map<string, unknown>;
    const protocolFor = (id: string): TextProtocol =>
      id === "anthropic"
        ? "anthropic"
        : id === "google"
          ? "gemini"
          : id === "ollama"
            ? "ollama"
            : id === "openai" || id === "volcanoark"
              ? "responses"
              : "chat";
    let currentProvider = "anthropic";

    beforeEach(function () {
      for (const key of ["Zotero", "addon", "ztoolkit"])
        originals.set(key, globals[key]);
      requests = [];
      prefs = new Map();
      globals.addon = { data: {} };
      globals.ztoolkit = { log() {} };
      respond = (protocol) => ({ raw: events(protocol, "answer").join("") });
      globals.Zotero = {
        locale: "en-US",
        Prefs: {
          get: (k: string) => prefs.get(k),
          set: (k: string, v: unknown) => prefs.set(k, v),
          clear: (k: string) => prefs.delete(k),
        },
        HTTP: {
          request: async (
            method: string,
            url: string,
            options: MockRequest,
          ) => {
            if (method === "GET")
              return {
                status: 200,
                response: JSON.stringify({ max_tokens: 64000 }),
              };
            const body = JSON.parse(options.body || "{}");
            requests.push({ url, body });
            const stream =
              body.stream === true || url.includes(":streamGenerateContent");
            const reply = respond(
              protocolFor(currentProvider),
              requests.length - 1,
              stream,
            );
            const xhr = {
              status: 200,
              response: reply.raw,
              responseText: reply.raw,
              onprogress: undefined as (() => void) | undefined,
              abort() {},
            };
            options.requestObserver?.(xhr as unknown as XMLHttpRequest);
            if (reply.progress !== false) xhr.onprogress?.();
            if (reply.fail) throw new Error("simulated timeout");
            return xhr;
          },
        },
      };
    });

    afterEach(function () {
      for (const [key, value] of originals) globals[key] = value;
      originals.clear();
    });
    const optionsFor = (id: (typeof providerIds)[number]): LLMOptions => ({
      apiUrl: LLMEndpointManager.providerDefaults(id).apiUrl.replace(
        /^https?:\/\/[^/]+/,
        "https://completion.invalid",
      ),
      apiKey: "mock-key",
      model: "fixture",
      stream: true,
    });
    async function service(rounds = 2) {
      prefs.set(`${config.prefsPrefix}.autoContinuationRounds`, String(rounds));
      const endpoint: LLMEndpoint = {
        ...optionsFor("anthropic"),
        id: "completion-test",
        name: "Fixture",
        providerType: "anthropic",
        enabled: true,
        createdAt: "",
        updatedAt: "",
        apiUrl: "https://completion.invalid",
        apiKey: "mock-key",
        model: "fixture",
      };
      LLMEndpointManager.saveEndpoints([endpoint]);
      return LLMService.generateWithEndpoint(endpoint.id, {
        task: "summary",
        prompt: "explain every section",
        content: { kind: "text", text: "paper" },
        transport: { retry: false },
        onProgress: () => undefined,
      });
    }
    for (const id of providerIds) {
      for (const mode of ["summary", "chat", "multi"] as const) {
        if (mode === "multi" && id === "ollama") continue;
        const call = (options: LLMOptions): Promise<LLMProviderResult> => {
          const provider = ProviderRegistry.get(id)!;
          return mode === "summary"
            ? provider.generateSummary("paper", false, "task", options)
            : mode === "chat"
              ? provider.chat(
                  "paper",
                  false,
                  [{ role: "user", content: "task" }],
                  options,
                )
              : provider.generateMultiFileSummary!(
                  [
                    {
                      filePath: "unused",
                      displayName: "paper",
                      base64Content: "YQ==",
                    },
                  ],
                  "task",
                  options,
                );
        };
        it(`${id} ${mode}: validates streams and reads final bytes even without progress`, async function () {
          currentProvider = id;
          respond = (protocol) => ({
            raw: events(protocol, "answer").join(""),
            progress: false,
          });
          expect(await call(optionsFor(id))).to.include({
            text: "answer",
            completion: "complete",
          });
        });
        it(`${id} ${mode}: preserves partial output without reporting success on timeout`, async function () {
          currentProvider = id;
          respond = (protocol) => ({
            raw: events(protocol, "partial")
              .slice(0, protocol === "anthropic" ? 2 : 1)
              .join(""),
            fail: true,
          });
          expect(await call(optionsFor(id))).to.include({
            text: "partial",
            completion: "partial",
            finishReason: "transport_error",
          });
        });
        it(`${id} ${mode}: honors non-streaming and explicit output budgets`, async function () {
          currentProvider = id;
          respond = (protocol, _index, stream) => {
            expect(stream).to.equal(false);
            const data =
              protocol === "anthropic"
                ? {
                    content: [{ type: "text", text: "answer" }],
                    stop_reason: "end_turn",
                  }
                : protocol === "responses"
                  ? { status: "completed", output_text: "answer" }
                  : protocol === "gemini"
                    ? {
                        candidates: [
                          {
                            content: { parts: [{ text: "answer" }] },
                            finishReason: "STOP",
                          },
                        ],
                      }
                    : protocol === "ollama"
                      ? {
                          message: { content: "answer" },
                          done: true,
                          done_reason: "stop",
                        }
                      : {
                          choices: [
                            {
                              message: { content: "answer" },
                              finish_reason: "stop",
                            },
                          ],
                        };
            return { raw: JSON.stringify(data) };
          };
          expect(
            await call({ ...optionsFor(id), stream: false, maxTokens: 1234 }),
          ).to.include({
            completion: "complete",
            text: "answer",
            maxOutputTokens: 1234,
          });
        });
      }
    }

    it("continues valid token truncation, retains the complete previous answer and publishes its final reason", async function () {
      currentProvider = "anthropic";
      const first =
        "start of answer\n" + "x".repeat(13000) + "\nlast paragraph";
      respond = (protocol, index) => ({
        raw: events(
          protocol,
          index === 0 ? first : "\nremaining sections",
          index === 0 ? "tokens" : "complete",
        ).join(""),
      });
      const response = await service();
      expect(response).to.include({
        completion: "complete",
        finishReason: "end_turn",
        text: first + "\nremaining sections",
        maxOutputTokens: 64000,
      });
      expect(JSON.stringify(requests[1].body)).to.include("start of answer");
      expect(requests).to.have.length(2);
    });
    for (const scenario of [
      "disabled",
      "exhausted",
      "context",
      "timeout",
      "empty",
      "repeat",
    ] as const) {
      it(`does not expose a successful service response for ${scenario}`, async function () {
        currentProvider = "anthropic";
        respond = (protocol, index) => ({
          raw: events(
            protocol,
            index === 0
              ? "partial original answer"
              : scenario === "empty"
                ? ""
                : scenario === "repeat"
                  ? "partial original answer"
                  : ` more ${index}`,
            scenario === "context"
              ? "context"
              : index > 0 && (scenario === "empty" || scenario === "repeat")
                ? "complete"
                : "tokens",
          ).join(""),
          fail: scenario === "timeout",
        });
        let error: unknown;
        try {
          await service(scenario === "disabled" ? 0 : 2);
        } catch (caught) {
          error = caught;
        }
        expect(error).to.be.instanceOf(LLMIncompleteError);
        expect((error as LLMIncompleteError).response.completion).to.equal(
          "partial",
        );
        expect((error as LLMIncompleteError).response.text).to.include(
          "partial original answer",
        );
        expect(requests.length).to.be.at.most(3);
        if (scenario === "context")
          expect((error as LLMIncompleteError).response.finishReason).to.equal(
            "model_context_window_exceeded",
          );
      });
    }

    it("preserves partial drafts under a distinct tag and never overwrites a complete summary", async function () {
      const saved: Array<{ tag: string; html: string }> = [];
      const fake = Zotero as unknown as { Items: unknown; Item: unknown };
      fake.Items = {
        getAsync: async () => [
          { hasTag: (tag: string) => tag === "AI-Generated", deleted: false },
        ],
      };
      fake.Item = class {
        libraryID = 1;
        parentID = 1;
        tag = "";
        html = "";
        addTag(tag: string) {
          this.tag = tag;
        }
        setNote(html: string) {
          this.html = html;
        }
        async saveTx() {
          saved.push({ tag: this.tag, html: this.html });
        }
      };
      const response: LLMResponse = {
        providerId: "anthropic",
        text: "unfinished answer",
        completion: "partial",
        finishReason: "max_tokens",
      };
      const generator = NoteGenerator as unknown as {
        saveIncompleteDraft(
          item: Zotero.Item,
          title: string,
          error: LLMIncompleteError,
        ): Promise<void>;
      };
      await generator.saveIncompleteDraft(
        { id: 1, libraryID: 1, getNotes: () => [2] } as Zotero.Item,
        "Paper",
        new LLMIncompleteError(response),
      );
      expect(saved).to.have.length(1);
      expect(saved[0].tag).to.equal("AI-Incomplete");
      expect(
        isRegularSummaryNote(
          [{ tag: saved[0].tag }],
          saved[0].html + "<h1>AI 总结</h1>",
        ),
      ).to.equal(false);
      expect(
        isDeepReadNote(
          [{ tag: saved[0].tag }],
          saved[0].html + "<h1>AI 精读 - Paper</h1>",
        ),
      ).to.equal(false);
      expect(
        LLMNoteMetadataService.parseAll(saved[0].html)[0].metadata.completion,
      ).to.equal("partial");
    });
    for (const id of multiPdfProviderIds) {
      it(`${id}: multi-PDF continuation preserves attachments, native assistant history, and output budget`, async function () {
        currentProvider = id;
        respond = (protocol, index) => ({
          raw: events(
            protocol,
            index === 0 ? "first section" : " remaining section",
            index === 0 ? "tokens" : "complete",
          ).join(""),
        });
        const endpoint: LLMEndpoint = {
          id: "multi-test",
          name: "Fixture",
          providerType: id,
          enabled: true,
          createdAt: "",
          updatedAt: "",
          apiUrl: optionsFor(id).apiUrl!,
          apiKey: "mock-key",
          model: "fixture",
        };
        LLMEndpointManager.saveEndpoints([endpoint]);
        const response = await LLMService.generateWithEndpoint(endpoint.id, {
          task: "summary",
          prompt: "all sections",
          content: {
            kind: "pdf-files",
            policy: "pdf-base64",
            files: [
              {
                filePath: "unused",
                displayName: "paper.pdf",
                base64Content: "YQ==",
              },
            ],
          },
          generation: { maxOutputTokens: 1234 },
          transport: { retry: false },
        });
        expect(response).to.include({
          text: "first section remaining section",
          completion: "complete",
          continuationRounds: 1,
          maxOutputTokens: 1234,
        });
        const history = (requests[1].body.messages ??
          requests[1].body.input ??
          requests[1].body.contents) as Array<{ role: string }>;
        expect(
          history.some(
            (message) =>
              message.role === "assistant" || message.role === "model",
          ),
        ).to.equal(true);
        expect(JSON.stringify(requests[1].body))
          .to.include("YQ==")
          .and.include("first section");
      });
    }

    it("marks a queue task failed, preserves retryability, and never emits success for partial generation", async function () {
      const task: TaskItem = {
        id: "task-1",
        itemId: 1,
        title: "Paper",
        taskType: "summary",
        status: TaskStatus.PENDING,
        progress: 0,
        createdAt: new Date(),
        retryCount: 0,
        maxRetries: 3,
      };
      const completed: boolean[] = [];
      const manager = Object.assign(Object.create(TaskQueueManager.prototype), {
        tasks: new Map([[task.id, task]]),
        processingTasks: new Set(),
        abortingTasks: new Set(),
        taskAbortControllers: new Map(),
        mergeStoredDeletedFixedTasks() {},
        isTaskDeletedByUser() {
          return false;
        },
        async saveToStorage() {},
        updateTaskProgress(t: TaskItem, progress: number) {
          t.progress = progress;
        },
        notifyStream() {},
        notifyComplete(_id: string, success: boolean) {
          completed.push(success);
        },
        buildTaskErrorDetails() {
          return "incomplete";
        },
      }) as { executeTask(id: string): Promise<boolean> };
      const originalGenerate = NoteGenerator.generateNoteForItem;
      const originalHasAttachment = ContentExtractor.hasAnalyzableAttachment;
      (Zotero as unknown as { Items: unknown }).Items = {
        getAsync: async () => ({
          id: 1,
          isRegularItem: () => true,
          isNote: () => false,
          isAttachment: () => false,
          getField: () => "Paper",
        }),
      };
      ContentExtractor.hasAnalyzableAttachment = async () => true;
      NoteGenerator.generateNoteForItem = async () => {
        throw new LLMIncompleteError({
          providerId: "anthropic",
          text: "partial",
          completion: "partial",
          finishReason: "max_tokens",
        });
      };
      try {
        await manager.executeTask(task.id);
        expect(task.status).to.equal(TaskStatus.FAILED);
        expect(task.progress).to.be.lessThan(100);
        expect(task.retryCount).to.equal(0);
        expect(completed).to.deep.equal([false]);
      } finally {
        NoteGenerator.generateNoteForItem = originalGenerate;
        ContentExtractor.hasAnalyzableAttachment = originalHasAttachment;
      }
    });

    it("user cancellation is never converted to a partial success", async function () {
      const controller = new AbortController();
      respond = (protocol) => {
        controller.abort();
        return { raw: events(protocol, "partial").join("") };
      };
      let error: unknown;
      try {
        await ProviderRegistry.get("anthropic")!.generateSummary(
          "paper",
          false,
          "task",
          { ...optionsFor("anthropic"), abortSignal: controller.signal },
        );
      } catch (caught) {
        error = caught;
      }
      expect(error)
        .to.be.instanceOf(Error)
        .and.have.property("name", "LLMRequestAbortError");
    });

    it("keeps complete and partial endpoint answers together as a failed multi-model draft", async function () {
      const generator = NoteGenerator as unknown as {
        generateMultiModelSummaryContent(
          params: Record<string, unknown>,
        ): Promise<unknown>;
        generateSummaryWithEndpoint(params: {
          endpoint: LLMEndpoint;
        }): Promise<unknown>;
      };
      const original = generator.generateSummaryWithEndpoint;
      const endpoints = ["complete", "partial"].map((id): LLMEndpoint => ({
        id,
        name: id,
        providerType: "anthropic",
        enabled: true,
        apiUrl: "https://completion.invalid",
        apiKey: "mock-key",
        model: "fixture",
        createdAt: "",
        updatedAt: "",
      }));
      generator.generateSummaryWithEndpoint = async ({ endpoint }) => {
        const response: LLMResponse = {
          providerId: "anthropic",
          text: `${endpoint.id} paid answer`,
          completion: endpoint.id === "complete" ? "complete" : "partial",
          finishReason: endpoint.id === "complete" ? "end_turn" : "max_tokens",
        };
        if (endpoint.id === "partial") throw new LLMIncompleteError(response);
        return {
          endpoint,
          content: response.text,
          response,
          noteHtml: "<p>complete</p>",
        };
      };
      let caught: unknown;
      try {
        await generator.generateMultiModelSummaryContent({
          item: {},
          itemTitle: "Paper",
          endpoints,
          summaryMode: "single",
          pdfContent: "paper",
          isBase64: false,
          pdfAttachmentMode: "default",
          prefMode: "text",
        });
      } catch (error) {
        caught = error;
      } finally {
        generator.generateSummaryWithEndpoint = original;
      }
      expect(caught).to.be.instanceOf(LLMIncompleteError);
      expect((caught as LLMIncompleteError).response).to.include({
        completion: "partial",
        finishReason: "multi_model_incomplete",
      });
      expect((caught as LLMIncompleteError).response.text)
        .to.include("complete paid answer")
        .and.include("partial paid answer");
    });

    it("derives the OpenAI PDF endpoint without duplicating the version path", async function () {
      currentProvider = "openai";
      for (const suffix of [
        "",
        "/v1",
        "/v1/",
        "/v1/chat/completions",
        "/v1/responses",
      ]) {
        await ProviderRegistry.get("openai")!.generateSummary(
          "YQ==",
          true,
          "task",
          {
            ...optionsFor("openai"),
            apiUrl: `https://completion.invalid${suffix}`,
          },
        );
        expect(requests[requests.length - 1].url).to.equal(
          "https://completion.invalid/v1/responses",
        );
      }
    });

    it("retains HTTP status and provider details for ordinary retry routing", async function () {
      Zotero.HTTP.request = async () => {
        throw Object.assign(new Error("request failed"), {
          xmlhttp: {
            status: 429,
            response: JSON.stringify({
              error: { message: "rate limit exceeded" },
            }),
          },
        });
      };
      let caught: unknown;
      try {
        await ProviderRegistry.get("openai")!.generateSummary(
          "paper",
          false,
          "task",
          optionsFor("openai"),
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).to.be.instanceOf(Error);
      expect((caught as Error).message)
        .to.include("429")
        .and.include("rate limit exceeded");
    });
  });
});
