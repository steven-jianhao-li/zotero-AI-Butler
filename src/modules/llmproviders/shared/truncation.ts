import type { LLMOptions, LLMTruncationState } from "../types";

export type LLMTruncationKind = LLMTruncationState["kind"];

const TOKEN_LIMIT_REASONS = new Set([
  "length",
  "max_tokens",
  "max_output_tokens",
  "max_completion_tokens",
  "max_tokens_exceeded",
  "token_limit_exceeded",
  "output_limit_exceeded",
]);

const CONTEXT_WINDOW_REASONS = new Set([
  "model_context_window_exceeded",
  "context_length_exceeded",
  "context_window_exceeded",
]);

function normalizeReason(reason: unknown): string {
  return typeof reason === "string" ? reason.trim() : "";
}

function classifyReason(reason: string): LLMTruncationKind {
  const normalized = reason.toLowerCase();
  if (TOKEN_LIMIT_REASONS.has(normalized)) return "max_tokens";
  if (CONTEXT_WINDOW_REASONS.has(normalized)) return "context_window";
  return "other";
}

export function resetTruncationState(options: LLMOptions): void {
  options.truncation = undefined;
}

export function recordFinishReason(
  options: LLMOptions,
  providerId: string,
  source: string,
  reason: unknown,
): void {
  const finishReason = normalizeReason(reason);
  if (!finishReason) return;

  const kind = classifyReason(finishReason);
  const truncated = kind !== "other";
  if (options.truncation?.truncated && !truncated) return;
  options.truncation = {
    providerId,
    source,
    finishReason,
    truncated,
    autoContinuable: kind === "max_tokens",
    kind,
  };
}

export function recordOpenAIResponsesTerminalEvent(
  options: LLMOptions,
  providerId: string,
  source: string,
  event: any,
): void {
  const type = normalizeReason(event?.type);
  if (!type) return;

  if (type === "response.incomplete") {
    recordFinishReason(
      options,
      providerId,
      source,
      event?.response?.incomplete_details?.reason ||
        event?.incomplete_details?.reason ||
        "unknown_incomplete",
    );
    return;
  }

  if (type === "response.completed") {
    const response = event?.response || event;
    if (response?.status === "incomplete") {
      recordFinishReason(
        options,
        providerId,
        source,
        response?.incomplete_details?.reason || "unknown_incomplete",
      );
    } else {
      recordFinishReason(options, providerId, source, "stop");
    }
  }
}

export function recordOpenAIResponsesObject(
  options: LLMOptions,
  providerId: string,
  source: string,
  data: any,
): void {
  if (!data || typeof data !== "object") return;
  if (data.status === "incomplete") {
    recordFinishReason(
      options,
      providerId,
      source,
      data?.incomplete_details?.reason || "unknown_incomplete",
    );
  } else if (typeof data.status === "string") {
    recordFinishReason(options, providerId, source, data.status);
  }
}

export function isAutoContinuableTruncation(
  state: LLMTruncationState | undefined,
): boolean {
  return state?.truncated === true && state.autoContinuable === true;
}
