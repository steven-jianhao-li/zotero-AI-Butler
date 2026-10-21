import type { LLMOptions } from "../types";
import { getString } from "../../../utils/locale";
import { deriveAnthropicModelsUrl } from "./modelList";
import { mergeRequestHeaders } from "./requestHeaders";
import {
  bindAbortSignal,
  isAbortError,
  normalizeAbortError,
  throwIfAborted,
} from "./requestAbort";

// Used only when a Messages-compatible endpoint cannot report its model limit.
export const DEFAULT_ANTHROPIC_MAX_TOKENS = 8192;
const limits = new Map<string, { expires: number; limit?: number }>();

export function validateOutputTokens(
  value: number | undefined,
  limit?: number,
): void {
  if (
    value !== undefined &&
    (!Number.isSafeInteger(value) ||
      value < 1 ||
      (limit !== undefined && value > limit))
  ) {
    throw new Error(
      getString("llm-error-invalid-output-tokens", {
        args: { value, limit: limit ?? "unknown" },
      }),
    );
  }
}

export function resolveAnthropicMaxTokens(
  options: LLMOptions,
  limit?: number,
): number {
  validateOutputTokens(options.maxTokens, limit);
  return options.maxTokens ?? limit ?? DEFAULT_ANTHROPIC_MAX_TOKENS;
}

/** Ask the configured endpoint, so aliases and gateways use their own limits. */
export async function getAnthropicMaxTokens(
  options: LLMOptions,
): Promise<number> {
  validateOutputTokens(options.maxTokens);
  throwIfAborted(options.abortSignal);
  const url = `${deriveAnthropicModelsUrl(options.apiUrl)}/${encodeURIComponent(options.model || "claude-3-5-sonnet-20241022")}`;
  const headers = mergeRequestHeaders(
    { "x-api-key": options.apiKey || "", "anthropic-version": "2023-06-01" },
    options.customHeaders,
  );
  // Account/header scoped, memory-only, never logged or persisted.
  const cacheKey = JSON.stringify([url, headers]);
  let cached = limits.get(cacheKey);
  if (!cached || cached.expires <= Date.now()) {
    let cleanup: (() => void) | undefined;
    let limit: number | undefined;
    try {
      const response = await Zotero.HTTP.request("GET", url, {
        headers,
        responseType: "text",
        timeout: Math.min(options.requestTimeoutMs ?? 10000, 10000),
        errorDelayMax: 0,
        requestObserver: (xhr: XMLHttpRequest) => {
          cleanup = bindAbortSignal(options.abortSignal, xhr);
        },
      });
      if (response.status === 200) {
        const data: Record<string, unknown> = JSON.parse(response.response);
        const value = data.max_tokens ?? data.max_output_tokens;
        if (
          typeof value === "number" &&
          Number.isSafeInteger(value) &&
          value > 0
        )
          limit = value;
      }
    } catch (error) {
      if (isAbortError(error, options.abortSignal))
        throw normalizeAbortError(error, options.abortSignal);
      ztoolkit.log(
        "[AI-Butler] Model output limit unavailable; using configured/fallback token budget.",
      );
    } finally {
      cleanup?.();
    }
    cached = { limit, expires: Date.now() + 5 * 60 * 1000 };
    if (limits.size >= 100) limits.clear();
    limits.set(cacheKey, cached);
  }
  throwIfAborted(options.abortSignal);
  return resolveAnthropicMaxTokens(options, cached.limit);
}
