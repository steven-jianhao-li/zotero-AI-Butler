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

/**
 * 竞速用的中止信号。
 *
 * `bindAbortSignal` 依赖 `xmlhttp.abort()` 触发底层 reject；但请求尚在排队、
 * XHR 已关闭或实现未把 abort 转为拒绝时，等待方会一直挂到请求自身的超时
 * （默认 `requestTimeout * 6`，最长 30 分钟）。把本函数的 promise 一起塞进
 * `Promise.race`，可以保证用户点“停止”后等待方当帧结束。
 *
 * 返回的 promise 永不 resolve，只会以 `LLMRequestAbortError` reject；
 * 调用方必须在 `finally` 里调用 `dispose()`，避免监听器泄漏。
 */
export function raceAbortSignal(signal?: LLMAbortSignal): {
  promise: Promise<never>;
  dispose: () => void;
} {
  let dispose = () => {};
  const promise = new Promise<never>((_resolve, reject) => {
    if (!signal) return;
    if (signal.aborted) {
      reject(createAbortError(signal));
      return;
    }
    const onAbort = () => reject(createAbortError(signal));
    signal.addEventListener?.("abort", onAbort, { once: true });
    dispose = () => signal.removeEventListener?.("abort", onAbort);
  });
  // 竞速的另一侧胜出时不要留下未处理的拒绝。
  promise.catch(() => {});
  return { promise, dispose };
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
