import type {
  LLMOptions,
  LLMProviderResult,
  LLMUsage,
  ProgressCb,
} from "../types";
import { completionForReason } from "./completion";
import {
  parseOpenAIResponsesDelta,
  parseOpenAIResponsesText,
} from "./openaiResponses";
import {
  bindAbortSignal,
  isAbortError,
  normalizeAbortError,
  throwIfAborted,
} from "./requestAbort";
import { getRequestTimeoutMs } from "./llmutils";
import {
  providerHttpRequestFailed,
  providerRequestFailed,
} from "./localizedErrors";
import { validateOutputTokens } from "./outputTokens";

export type TextProtocol =
  "anthropic" | "chat" | "responses" | "gemini" | "ollama";
type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
const string = (value: unknown): string =>
  typeof value === "string" ? value : "";
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;

/** Incremental SSE/NDJSON parser with explicit protocol completion checks. */
export class TextResponseParser {
  private buffer = "";
  private data: string[] = [];
  private eventType = "";
  private chatStream = false;
  private chatDone = false;
  private terminal = false;
  private failure = "";
  private reason = "";
  private text = "";
  private requestId: string | undefined;
  private usage: LLMUsage = {};

  constructor(
    private readonly protocol: TextProtocol,
    private readonly onText?: (text: string) => void,
  ) {}

  private append(text: string): void {
    if (!text) return;
    this.text += text;
    this.onText?.(text);
  }

  private recordReason(reason: string): void {
    if (!reason) return;
    // Once a model reports truncation or another abnormal stop, a later normal
    // terminal marker from a gateway must not erase it.
    if (
      !this.reason ||
      completionForReason(this.reason).completion === "complete"
    )
      this.reason = reason;
  }

  private readUsage(value: unknown): void {
    const usage = object(value);
    const input = number(
      usage.input_tokens ??
        usage.prompt_tokens ??
        usage.promptTokenCount ??
        usage.prompt_eval_count,
    );
    const output = number(
      usage.output_tokens ??
        usage.completion_tokens ??
        usage.candidatesTokenCount ??
        usage.eval_count,
    );
    const total = number(usage.total_tokens ?? usage.totalTokenCount);
    if (input !== undefined) this.usage.inputTokens = input;
    if (output !== undefined) this.usage.outputTokens = output;
    if (total !== undefined) this.usage.totalTokens = total;
  }

  private consume(value: unknown, streaming: boolean): void {
    const event = object(value);
    if (!Object.keys(event).length) {
      this.failure = "invalid_response";
      return;
    }
    this.requestId ||= string(event.id) || undefined;
    this.readUsage(event.usage ?? event.usageMetadata);
    if (
      event.error ||
      event.type === "error" ||
      event.type === "response.failed"
    ) {
      this.failure =
        string(object(event.error).message) ||
        string(event.error) ||
        string(event.message) ||
        "provider_error";
      this.reason = "provider_error";
      return;
    }
    if (this.failure) return;
    // Some Responses-compatible gateways return Chat Completions instead.
    if (
      this.protocol === "chat" ||
      (this.protocol === "responses" && Array.isArray(event.choices))
    ) {
      this.chatStream ||= streaming;
      const choice = object(array(event.choices)[0]);
      this.append(
        string(object(streaming ? choice.delta : choice.message).content),
      );
      if (typeof choice.finish_reason === "string" && choice.finish_reason) {
        this.recordReason(choice.finish_reason);
        this.terminal = true;
      }
    } else if (this.protocol === "anthropic") {
      if (!streaming) {
        this.append(
          array(event.content)
            .filter((part) => object(part).type === "text")
            .map((part) => string(object(part).text))
            .join(""),
        );
        this.recordReason(string(event.stop_reason));
        this.terminal = !!this.reason;
      } else if (event.type === "content_block_delta") {
        this.append(string(object(event.delta).text));
      } else if (event.type === "message_delta") {
        this.recordReason(string(object(event.delta).stop_reason));
      } else if (event.type === "message_stop") {
        this.terminal = true;
      } else if (event.type === "message_start") {
        this.requestId = string(object(event.message).id) || this.requestId;
        this.readUsage(object(event.message).usage);
      }
    } else if (this.protocol === "responses") {
      if (streaming) this.append(parseOpenAIResponsesDelta(event));
      if (
        !streaming ||
        event.type === "response.completed" ||
        event.type === "response.incomplete"
      ) {
        const response = streaming ? object(event.response) : event;
        this.requestId = string(response.id) || this.requestId;
        this.readUsage(response.usage);
        if (!this.text) this.append(parseOpenAIResponsesText(response));
        const status =
          string(response.status) ||
          string(event.type).replace("response.", "");
        this.recordReason(
          status === "incomplete"
            ? string(object(response.incomplete_details).reason) ||
                "unknown_incomplete"
            : status,
        );
        this.terminal = ["completed", "incomplete", "failed"].includes(status);
      }
    } else if (this.protocol === "gemini") {
      const candidate = object(array(event.candidates)[0]);
      this.append(
        array(object(candidate.content).parts)
          .filter((part) => object(part).thought !== true)
          .map((part) => string(object(part).text))
          .join(""),
      );
      this.recordReason(
        string(candidate.finishReason) ||
          string(object(event.promptFeedback).blockReason),
      );
      this.terminal ||= !!this.reason;
    } else if (this.protocol === "ollama") {
      this.append(
        string(object(event.message).content) || string(event.response),
      );
      this.readUsage(event);
      if (event.done === true) {
        this.terminal = true;
        this.recordReason(string(event.done_reason) || "stop");
      }
    }
  }

  private parse(data: string, streaming: boolean): void {
    if (!data.trim()) return;
    if (data.trim() === "[DONE]") {
      this.chatDone = true;
      return;
    }
    try {
      const parsed: unknown = JSON.parse(data);
      this.consume(
        this.eventType && !object(parsed).type
          ? { ...object(parsed), type: this.eventType }
          : parsed,
        streaming,
      );
    } catch {
      this.failure = "invalid_json";
    }
  }

  feed(chunk: string): void {
    this.buffer += chunk;
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      if (this.protocol === "ollama") {
        if (line.trim()) this.parse(line, true);
      } else if (line === "") {
        if (this.data.length) this.parse(this.data.join("\n"), true);
        this.data = [];
        this.eventType = "";
      } else if (line.startsWith("data:")) {
        this.data.push(line.slice(5).replace(/^ /, ""));
      } else if (line.startsWith("event:")) {
        this.eventType = line.slice(6).trim();
      }
    }
  }

  finish(rawJson?: string, transportError?: string): LLMProviderResult {
    if (rawJson !== undefined) this.parse(rawJson, false);
    else if (this.protocol === "ollama" && this.buffer.trim()) {
      this.parse(this.buffer, true);
      this.buffer = "";
    }
    const malformed = this.buffer.trim().length > 0 || this.data.length > 0;
    const reason = transportError
      ? "transport_error"
      : this.failure
        ? this.reason === "provider_error"
          ? "provider_error"
          : "invalid_stream"
        : malformed
          ? "unfinished_frame"
          : !this.terminal ||
              !this.reason ||
              (this.chatStream && !this.chatDone)
            ? "missing_terminal"
            : this.reason;
    const state = completionForReason(reason);
    if (!this.text.trim() && state.completion === "complete") {
      state.completion = "partial";
      state.recovery = "none";
    }
    return {
      text: this.text,
      ...state,
      finishReason:
        !this.text.trim() &&
        state.completion === "partial" &&
        completionForReason(reason).completion === "complete"
          ? "empty_output"
          : reason,
      ...(transportError ? { recovery: "retry" as const } : {}),
      requestId: this.requestId,
      usage: this.usage,
      error: transportError || this.failure || undefined,
    };
  }
}

export async function requestLLMText(args: {
  protocol: TextProtocol;
  provider: string;
  url: string;
  headers: Record<string, string>;
  payload: Record<string, unknown>;
  options: LLMOptions;
  onProgress?: ProgressCb;
}): Promise<LLMProviderResult> {
  const { protocol, provider, headers, options, onProgress } = args;
  throwIfAborted(options.abortSignal);
  validateOutputTokens(options.maxTokens);
  const stream = options.stream !== false;
  const url =
    protocol === "gemini" && !stream
      ? args.url.replace(":streamGenerateContent?alt=sse", ":generateContent")
      : args.url;
  const payload =
    protocol === "gemini" ? args.payload : { ...args.payload, stream };
  let delivery = Promise.resolve();
  const parser = new TextResponseParser(protocol, (text) => {
    if (onProgress)
      delivery = delivery
        .then(() => onProgress(text))
        .catch((error) =>
          ztoolkit.log("[AI-Butler] Stream callback failed:", error),
        );
  });
  let processed = 0;
  let cleanup: (() => void) | undefined;
  let raw = "";
  const feed = (value: unknown) => {
    if (typeof value !== "string") return;
    raw = value;
    if (stream && value.length > processed) {
      parser.feed(value.slice(processed));
      processed = value.length;
    }
  };
  let transportError: string | undefined;
  try {
    const response = await Zotero.HTTP.request("POST", url, {
      headers,
      body: JSON.stringify(payload),
      responseType: "text",
      timeout: options.requestTimeoutMs ?? getRequestTimeoutMs(),
      errorDelayMax: 0,
      requestObserver: (xhr: XMLHttpRequest) => {
        cleanup = bindAbortSignal(options.abortSignal, xhr);
        xhr.onprogress = () => {
          if (xhr.status < 400) feed(xhr.response);
        };
      },
    });
    if (response.status >= 400)
      throw new Error(providerHttpRequestFailed(response.status));
    feed(response.response);
  } catch (error) {
    if (isAbortError(error, options.abortSignal))
      throw normalizeAbortError(error, options.abortSignal);
    const xhr = object(object(error).xmlhttp);
    const status = number(xhr.status);
    let message =
      error instanceof Error ? error.message : providerRequestFailed(provider);
    const responseBody = xhr.response ?? xhr.responseText;
    if (typeof responseBody === "string" && responseBody.trim()) {
      try {
        const body = object(JSON.parse(responseBody));
        message = string(object(body.error).message) || message;
      } catch {
        // HTML gateway errors are not model responses; retain the HTTP status.
      }
    }
    transportError = status ? `HTTP ${status}: ${message}` : message;
  } finally {
    cleanup?.();
  }
  throwIfAborted(options.abortSignal);
  const result = parser.finish(stream ? undefined : raw, transportError);
  await delivery;
  throwIfAborted(options.abortSignal);
  if (!result.text && result.error) throw new Error(result.error);
  result.maxOutputTokens = number(
    payload.max_tokens ??
      payload.max_output_tokens ??
      object(payload.generationConfig).maxOutputTokens ??
      object(payload.options).num_predict,
  );
  ztoolkit.log(
    `[AI-Butler] ${provider}: completion=${result.completion}, reason=${result.finishReason}, maxOutputTokens=${result.maxOutputTokens ?? "server-default"}, outputTokens=${result.usage?.outputTokens ?? "unknown"}`,
  );
  return result;
}
