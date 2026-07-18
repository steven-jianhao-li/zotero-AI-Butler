import { getString } from "../../../utils/locale";
import type { LLMAbortSignal } from "../types";

export const LLM_REQUEST_ABORT_MESSAGE = "LLM_REQUEST_ABORTED";

export function getDefaultAbortMessage(): string {
  return getString("provider-error-aborted");
}

export class LLMRequestAbortError extends Error {
  public readonly suppressTaskRetry = true;

  constructor(message?: string) {
    super(message ?? getDefaultAbortMessage());
    this.name = "LLMRequestAbortError";
  }
}

export function getAbortMessage(signal?: LLMAbortSignal): string {
  const reason = signal?.reason;
  if (reason instanceof Error && reason.message) return reason.message;
  if (typeof reason === "string" && reason.trim()) return reason.trim();
  return getDefaultAbortMessage();
}

export function createAbortError(
  signal?: LLMAbortSignal,
): LLMRequestAbortError {
  return new LLMRequestAbortError(getAbortMessage(signal));
}

export function throwIfAborted(signal?: LLMAbortSignal): void {
  if (!signal) return;
  if (typeof signal.throwIfAborted === "function") {
    try {
      signal.throwIfAborted();
    } catch {
      throw createAbortError(signal);
    }
  }
  if (signal.aborted) {
    throw createAbortError(signal);
  }
}

export function isAbortError(error: unknown, signal?: LLMAbortSignal): boolean {
  return (
    error instanceof LLMRequestAbortError ||
    (error as { name?: string } | undefined)?.name === "LLMRequestAbortError" ||
    signal?.aborted === true
  );
}

export function normalizeAbortError(
  error: unknown,
  signal?: LLMAbortSignal,
): LLMRequestAbortError {
  if (error instanceof LLMRequestAbortError) return error;
  if (error instanceof Error && error.message) {
    return new LLMRequestAbortError(error.message);
  }
  return createAbortError(signal);
}

export function bindAbortSignal(
  signal: LLMAbortSignal | undefined,
  xmlhttp: XMLHttpRequest,
  onAbort?: (error: LLMRequestAbortError) => void,
): () => void {
  if (!signal) return () => {};

  const abortRequest = () => {
    const error = createAbortError(signal);
    onAbort?.(error);
    try {
      xmlhttp.abort();
    } catch {
      // XHR may already be closed by Zotero.HTTP.
    }
  };

  if (signal.aborted) {
    abortRequest();
    return () => {};
  }

  signal.addEventListener?.("abort", abortRequest, { once: true });
  return () => signal.removeEventListener?.("abort", abortRequest);
}
