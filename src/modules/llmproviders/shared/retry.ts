import type { LLMAbortSignal, LLMRequestDiagnostics } from "../types";
import { createAbortError, throwIfAborted } from "./requestAbort";

/** Only transient failures need backoff; another endpoint can fix auth/config errors. */
export function getApiRetryDelay(error: Error, failedAttempt: number): number {
  const request = (
    error as Error & { requestDiagnostics?: LLMRequestDiagnostics }
  ).requestDiagnostics;
  const status = request?.httpStatus;
  const transient =
    !!request?.timeoutKind ||
    status === 408 ||
    status === 429 ||
    (status !== undefined && status >= 500) ||
    /timeout|timed out|network|connection|\b(?:408|429|5\d\d)\b|超时|连接/i.test(
      error.message,
    );
  if (!transient) return 0;
  const base = Math.min(1000 * 2 ** Math.min(failedAttempt, 4), 10000);
  return Math.round(base * (1 + Math.random() * 0.25));
}

/** Cancellation during backoff must prevent the next API request. */
export function waitForApiRetry(
  ms: number,
  signal?: LLMAbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", abort);
      reject(createAbortError(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener?.("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener?.("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
