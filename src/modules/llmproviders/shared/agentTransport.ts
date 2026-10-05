import { AgentProtocolError } from "./agentErrors";
import type {
  LLMAgentMessage,
  LLMAgentTurn,
  LLMToolCall,
  LLMToolDefinition,
} from "../agentTypes";
import type { LLMOptions, LLMUsage, ProgressCb } from "../types";
import { parseOpenAIResponsesAgentTurn } from "./openaiResponses";
import {
  bindAbortSignal,
  isAbortError,
  normalizeAbortError,
  throwIfAborted,
} from "./requestAbort";

type JsonObject = Record<string, unknown>;
type AgentProtocol = "chat" | "responses" | "anthropic" | "google";

export interface AgentHttpRequest {
  protocol: AgentProtocol;
  url: string;
  headers: Record<string, string>;
  body: JsonObject;
}

function record(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentProtocolError("invalid-object");
  }
  return value as JsonObject;
}

function string(value: unknown): string {
  if (typeof value !== "string") {
    throw new AgentProtocolError("invalid-string");
  }
  return value;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

/** Classify overflow without exposing provider messages, credentials or paper text. */
export function isAgentContextOverflow(error: unknown): boolean {
  if (error instanceof AgentProtocolError)
    return error.code === "context-overflow";
  const overflow =
    /context.{0,30}(length|window|limit)|maximum context|too many tokens|prompt.{0,20}too long|input.{0,20}too (long|large)/i;
  const inspect = (value: unknown): boolean => {
    if (!value || typeof value !== "object") return false;
    const fields = value as JsonObject;
    return [fields.code, fields.type, fields.message].some(
      (field) => typeof field === "string" && overflow.test(field),
    );
  };
  if (!error || typeof error !== "object") return false;
  const fields = error as JsonObject;
  if (inspect(fields) || inspect(fields.error)) return true;
  const xhr = fields.xmlhttp;
  if (!xhr || typeof xhr !== "object") return false;
  const response =
    (xhr as JsonObject).responseText ?? (xhr as JsonObject).response;
  if (typeof response !== "string") {
    return (
      inspect(response) ||
      (response && typeof response === "object"
        ? inspect((response as JsonObject).error)
        : false)
    );
  }
  try {
    const parsed: unknown = JSON.parse(response);
    return (
      inspect(parsed) ||
      (parsed && typeof parsed === "object"
        ? inspect((parsed as JsonObject).error)
        : false)
    );
  } catch {
    // Only structured API errors are classified; raw proxy pages can contain secrets.
    return false;
  }
}

function usage(raw: unknown): LLMUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = record(raw);
  const input = number(value.prompt_tokens ?? value.input_tokens);
  const inputTokens =
    input === undefined
      ? undefined
      : input +
        (number(value.cache_read_input_tokens) || 0) +
        (number(value.cache_creation_input_tokens) || 0);
  const outputTokens = number(value.completion_tokens ?? value.output_tokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens:
      number(value.total_tokens) ??
      (inputTokens !== undefined && outputTokens !== undefined
        ? inputTokens + outputTokens
        : undefined),
  };
}

function argumentsObject(raw: string): JsonObject {
  try {
    return record(JSON.parse(raw));
  } catch {
    throw new AgentProtocolError("invalid-arguments");
  }
}

/** Reject orphan results and incomplete exchanges before making an API request. */
export function validateAgentMessages(messages: LLMAgentMessage[]): void {
  const pending = new Set<string>();
  const seen = new Set<string>();
  for (const message of messages) {
    if (message.role === "tool") {
      if (!message.toolCallId || !pending.delete(message.toolCallId)) {
        throw new AgentProtocolError("orphan-result");
      }
    } else {
      if (pending.size) {
        throw new AgentProtocolError("unresolved-calls");
      }
      for (const call of message.toolCalls || []) {
        if (message.role !== "assistant" || !call.id || seen.has(call.id)) {
          throw new AgentProtocolError("invalid-history-ids");
        }
        argumentsObject(call.arguments);
        seen.add(call.id);
        pending.add(call.id);
      }
    }
  }
  if (pending.size) throw new AgentProtocolError("unresolved-calls");
}

/** Validates the whole batch before callers may execute any tool. */
export function validateAgentTurn(
  turn: LLMAgentTurn,
  tools: LLMToolDefinition[],
  history: LLMAgentMessage[] = [],
): LLMAgentTurn {
  if (turn.toolCalls.length > 32)
    throw new AgentProtocolError("malformed-calls");
  const known = new Set(tools.map((tool) => tool.name));
  const ids = new Set(
    history.flatMap((message) =>
      (message.toolCalls || []).map((call) => call.id),
    ),
  );
  for (const call of turn.toolCalls) {
    if (!call.id || ids.has(call.id) || !known.has(call.name)) {
      throw new AgentProtocolError("invalid-call");
    }
    argumentsObject(call.arguments);
    ids.add(call.id);
  }
  if (!turn.text.trim() && !turn.toolCalls.length) {
    throw new AgentProtocolError("empty-turn");
  }
  return turn;
}

function apiUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Avoid exposing the configured URL, which can contain sensitive parameters.
    throw new AgentProtocolError("invalid-url");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new AgentProtocolError("invalid-url");
  }
  return url;
}

function versionedUrl(raw: string, suffix: string): string {
  const url = apiUrl(raw);
  const path = url.pathname.replace(/\/+$/, "");
  const version = path.match(/^(.*\/v\d+(?:beta)?)(?:\/.*)?$/i);
  url.pathname = `${version ? version[1] : path.replace(/\/api\/chat$/, "") + "/v1"}/${suffix}`;
  url.hash = "";
  return url.toString();
}

function nativeMessages(
  messages: LLMAgentMessage[],
  protocol: "anthropic" | "google",
): JsonObject[] {
  const output: JsonObject[] = [];
  const calls = new Map<string, LLMToolCall>();
  const nativeCallIds = new Set<string>();
  const field = protocol === "google" ? "parts" : "content";
  for (const message of messages) {
    if (message.role === "system") continue;
    let parts: JsonObject[] = [];
    const role =
      message.role === "assistant"
        ? protocol === "google"
          ? "model"
          : "assistant"
        : "user";
    if (message.role === "tool") {
      const call = calls.get(message.toolCallId || "");
      if (!call) throw new AgentProtocolError("missing-call");
      parts = [
        protocol === "google"
          ? {
              functionResponse: {
                ...(nativeCallIds.has(call.id) ? { id: call.id } : {}),
                name: call.name,
                response: { result: message.content },
              },
            }
          : {
              type: "tool_result",
              tool_use_id: call.id,
              content: message.content,
            },
      ];
    } else {
      for (const call of message.toolCalls || []) calls.set(call.id, call);
      if (message.providerState?.providerId === protocol) {
        parts = message.providerState.parts;
        if (protocol === "google") {
          for (const part of parts) {
            if (part.functionCall) {
              const call = record(part.functionCall);
              if (typeof call.id === "string") nativeCallIds.add(call.id);
            }
          }
        }
      } else {
        if (message.content) {
          parts.push(
            protocol === "google"
              ? { text: message.content }
              : { type: "text", text: message.content },
          );
        }
        for (const call of message.toolCalls || []) {
          parts.push(
            protocol === "google"
              ? {
                  functionCall: {
                    id: call.id,
                    name: call.name,
                    args: argumentsObject(call.arguments),
                  },
                }
              : {
                  type: "tool_use",
                  id: call.id,
                  name: call.name,
                  input: argumentsObject(call.arguments),
                },
          );
        }
      }
    }
    const last = output[output.length - 1];
    if (last?.role === role && Array.isArray(last[field])) {
      (last[field] as JsonObject[]).push(...parts);
    } else {
      output.push({ role, [field]: [...parts] });
    }
  }
  return output;
}

/** Build protocol-specific messages here; feature code never handles API shapes. */
export function buildAgentHttpRequest(
  providerId: string,
  messages: LLMAgentMessage[],
  tools: LLMToolDefinition[],
  options: LLMOptions,
): AgentHttpRequest {
  validateAgentMessages(messages);
  const rawUrl = options.apiUrl?.trim();
  const model = options.model?.trim();
  if (!rawUrl || !model) throw new AgentProtocolError("missing-endpoint");
  if (providerId !== "ollama" && !options.apiKey?.trim()) {
    throw new AgentProtocolError("missing-key");
  }
  const protocol: AgentProtocol =
    providerId === "openai"
      ? "responses"
      : providerId === "anthropic" || providerId === "google"
        ? providerId
        : "chat";
  if (
    ![
      "openai",
      "openai-compat",
      "openrouter",
      "volcanoark",
      "ollama",
      "anthropic",
      "google",
    ].includes(providerId)
  ) {
    throw new AgentProtocolError("unsupported-provider");
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`;
  const common: JsonObject = {
    ...(options.temperature !== undefined
      ? { temperature: options.temperature }
      : {}),
    ...(options.topP !== undefined ? { top_p: options.topP } : {}),
  };
  if (protocol === "responses") {
    const input: JsonObject[] = [];
    for (const message of messages) {
      if (message.role === "tool") {
        input.push({
          type: "function_call_output",
          call_id: message.toolCallId,
          output: message.content,
        });
        continue;
      }
      if (
        message.role === "assistant" &&
        message.providerState?.providerId === "openai"
      ) {
        input.push(...message.providerState.parts);
      }
      if (message.content)
        input.push({ role: message.role, content: message.content });
      for (const call of message.toolCalls || []) {
        input.push({
          type: "function_call",
          call_id: call.id,
          name: call.name,
          arguments: call.arguments,
        });
      }
    }
    return {
      protocol,
      url: versionedUrl(rawUrl, "responses"),
      headers,
      body: {
        ...options.vendorOptions,
        ...common,
        model,
        input,
        stream: false,
        store: false,
        include: ["reasoning.encrypted_content"],
        tools: tools.map((tool) => ({
          type: "function",
          ...tool,
          strict: false,
        })),
        ...(options.maxTokens !== undefined
          ? { max_output_tokens: options.maxTokens }
          : {}),
        ...(options.reasoningEffort
          ? { reasoning: { effort: options.reasoningEffort } }
          : {}),
      },
    };
  }
  if (protocol === "anthropic") {
    delete headers.Authorization;
    headers["x-api-key"] = options.apiKey || "";
    headers["anthropic-version"] = "2023-06-01";
    // Opus 4.7+ no longer accepts temperature; match the ordinary provider.
    const minor = model
      .toLowerCase()
      .match(/claude[-_/]opus[-_/]4[-_/.](\d+|latest)/);
    const temperature =
      options.temperature !== undefined &&
      !(minor && (minor[1] === "latest" || Number(minor[1]) >= 7))
        ? { temperature: options.temperature }
        : {};
    return {
      protocol,
      url: versionedUrl(rawUrl, "messages"),
      headers,
      body: {
        ...options.vendorOptions,
        ...temperature,
        model,
        stream: false,
        max_tokens: options.maxTokens ?? 8192,
        system: messages
          .filter((m) => m.role === "system")
          .map((m) => m.content)
          .join("\n\n"),
        messages: nativeMessages(messages, protocol),
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters,
        })),
      },
    };
  }
  if (protocol === "google") {
    delete headers.Authorization;
    headers["x-goog-api-key"] = options.apiKey || "";
    const url = apiUrl(rawUrl);
    const base = url.pathname
      .replace(/\/+$/, "")
      .replace(/\/v1(?:beta)?(?:\/.*)?$/, "");
    url.pathname = `${base}/v1beta/models/${encodeURIComponent(model.replace(/^models\//, ""))}:generateContent`;
    url.hash = "";
    return {
      protocol,
      url: url.toString(),
      headers,
      body: {
        generationConfig: {
          ...options.vendorOptions,
          ...(options.temperature !== undefined
            ? { temperature: options.temperature }
            : {}),
          ...(options.topP !== undefined ? { topP: options.topP } : {}),
          ...(options.maxTokens !== undefined
            ? { maxOutputTokens: options.maxTokens }
            : {}),
        },
        systemInstruction: {
          parts: messages
            .filter((m) => m.role === "system")
            .map((m) => ({ text: m.content })),
        },
        contents: nativeMessages(messages, protocol),
        ...(tools.length
          ? {
              tools: [
                { functionDeclarations: tools.map((tool) => ({ ...tool })) },
              ],
            }
          : {}),
      },
    };
  }
  return {
    protocol,
    url: versionedUrl(rawUrl, "chat/completions"),
    headers,
    body: {
      ...options.vendorOptions,
      ...common,
      model,
      stream: false,
      ...(options.maxTokens !== undefined
        ? { max_tokens: options.maxTokens }
        : {}),
      ...(options.reasoningEffort
        ? { reasoning_effort: options.reasoningEffort }
        : {}),
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content || (message.toolCalls?.length ? null : ""),
        ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
        ...(message.reasoningContent !== undefined
          ? { reasoning_content: message.reasoningContent }
          : {}),
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: call.arguments },
              })),
            }
          : {}),
      })),
      ...(tools.length
        ? { tools: tools.map((tool) => ({ type: "function", function: tool })) }
        : {}),
    },
  };
}

export function parseAgentTurn(
  protocol: AgentProtocol,
  raw: unknown,
): LLMAgentTurn {
  const data = record(raw);
  if (data.error) {
    if (isAgentContextOverflow(data))
      throw new AgentProtocolError("context-overflow");
    throw new AgentProtocolError("api-error");
  }
  if (protocol === "responses") return parseOpenAIResponsesAgentTurn(data);
  if (protocol === "chat") {
    if (!Array.isArray(data.choices) || data.choices.length !== 1) {
      throw new AgentProtocolError("invalid-choice-count");
    }
    const choice = record(data.choices[0]);
    const finishReason = string(choice.finish_reason);
    if (!["stop", "tool_calls"].includes(finishReason)) {
      throw new AgentProtocolError("truncated-turn");
    }
    const message = record(choice.message);
    if (message.role !== "assistant")
      throw new AgentProtocolError("invalid-role");
    if (
      message.tool_calls !== undefined &&
      !Array.isArray(message.tool_calls)
    ) {
      throw new AgentProtocolError("malformed-calls");
    }
    const toolCalls = (message.tool_calls || []) as unknown[];
    if (finishReason === "tool_calls" && !toolCalls.length) {
      throw new AgentProtocolError("missing-declared-calls");
    }
    return {
      text: message.content == null ? "" : string(message.content),
      toolCalls: toolCalls.map((rawCall) => {
        const call = record(rawCall);
        if (call.type !== "function")
          throw new AgentProtocolError("unsupported-tool-type");
        const fn = record(call.function);
        return {
          id: string(call.id),
          name: string(fn.name),
          arguments: string(fn.arguments),
        };
      }),
      ...(typeof message.reasoning_content === "string"
        ? { reasoningContent: message.reasoning_content }
        : {}),
      usage: usage(data.usage),
      finishReason,
    };
  }
  if (protocol === "anthropic") {
    const finishReason = string(data.stop_reason);
    if (!["end_turn", "tool_use", "stop_sequence"].includes(finishReason)) {
      throw new AgentProtocolError("truncated-turn");
    }
    if (!Array.isArray(data.content))
      throw new AgentProtocolError("missing-content");
    const parts = data.content.map(record);
    return {
      text: parts
        .filter((part) => part.type === "text")
        .map((part) => string(part.text))
        .join(""),
      toolCalls: parts
        .filter((part) => part.type === "tool_use")
        .map((part) => ({
          id: string(part.id),
          name: string(part.name),
          arguments: JSON.stringify(record(part.input)),
        })),
      providerState: { providerId: "anthropic", parts },
      usage: usage(data.usage),
      finishReason,
    };
  }
  if (!Array.isArray(data.candidates) || data.candidates.length !== 1)
    throw new AgentProtocolError("invalid-candidate-count");
  const candidate = record(data.candidates[0]);
  if (candidate.finishReason !== "STOP")
    throw new AgentProtocolError("truncated-turn");
  const content = record(candidate.content);
  if (!Array.isArray(content.parts))
    throw new AgentProtocolError("missing-parts");
  const parts = content.parts.map(record);
  const geminiUsage = data.usageMetadata ? record(data.usageMetadata) : {};
  return {
    text: parts
      .filter((part) => typeof part.text === "string" && !part.thought)
      .map((part) => part.text)
      .join(""),
    toolCalls: parts
      .filter((part) => part.functionCall)
      .map((part, index) => {
        const call = record(part.functionCall);
        const id =
          typeof call.id === "string"
            ? call.id
            : `gemini-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
        return {
          id,
          name: string(call.name),
          arguments: JSON.stringify(record(call.args || {})),
        };
      }),
    providerState: { providerId: "google", parts },
    usage: {
      inputTokens: number(geminiUsage.promptTokenCount),
      outputTokens: number(geminiUsage.candidatesTokenCount),
      totalTokens: number(geminiUsage.totalTokenCount),
    },
    finishReason: "STOP",
  };
}

/** Non-streaming by design: no tool may run until the response is complete. */
export async function requestAgentTurn(
  providerId: string,
  messages: LLMAgentMessage[],
  tools: LLMToolDefinition[],
  options: LLMOptions,
  onProgress?: ProgressCb,
): Promise<LLMAgentTurn> {
  throwIfAborted(options.abortSignal);
  const request = buildAgentHttpRequest(providerId, messages, tools, options);
  let cleanup: (() => void) | undefined;
  let abortError: Error | undefined;
  try {
    const response = await Zotero.HTTP.request("POST", request.url, {
      headers: request.headers,
      body: JSON.stringify(request.body),
      responseType: "text",
      timeout: options.requestTimeoutMs ?? 300000,
      errorDelayMax: 0,
      requestObserver: (xhr: XMLHttpRequest) => {
        cleanup = bindAbortSignal(options.abortSignal, xhr, (error) => {
          abortError = error;
        });
      },
    });
    throwIfAborted(options.abortSignal);
    let data: unknown;
    try {
      data = JSON.parse(response.responseText || "");
    } catch {
      throw new AgentProtocolError("invalid-json");
    }
    const turn = validateAgentTurn(
      parseAgentTurn(request.protocol, data),
      tools,
      messages,
    );
    if (turn.text && onProgress) await onProgress(turn.text);
    return turn;
  } catch (error) {
    if (abortError || isAbortError(error, options.abortSignal)) {
      throw normalizeAbortError(abortError || error, options.abortSignal);
    }
    if (isAgentContextOverflow(error)) {
      // Expose only the safe category, not the raw provider error.
      throw new AgentProtocolError("context-overflow");
    }
    // Zotero HTTP errors may contain request bodies and credentials. Expose status only.
    const httpError = error as {
      status?: number;
      xmlhttp?: { status?: number };
    };
    const status = httpError.status ?? httpError.xmlhttp?.status;
    if (
      typeof status === "number" &&
      Number.isInteger(status) &&
      status >= 0 &&
      status <= 599
    ) {
      // The HTTP error may contain credentials and full paper text.
      throw new AgentProtocolError("http-error", { status });
    }
    if (error instanceof AgentProtocolError) throw error;
    // Do not propagate credential-bearing errors into Agent logs or persisted sessions.
    throw new AgentProtocolError("request-failed");
  } finally {
    cleanup?.();
  }
}
