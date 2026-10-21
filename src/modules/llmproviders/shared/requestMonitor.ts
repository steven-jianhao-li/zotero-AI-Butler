import { getString } from "../../../utils/locale";
import type { LLMOptions, LLMRequestDiagnostics } from "../types";
import { getRequestTimeoutMs } from "./llmutils";

export class LLMTransportError extends Error {
  constructor(
    message: string,
    public readonly requestDiagnostics: LLMRequestDiagnostics,
  ) {
    super(message);
    this.name = "LLMTransportError";
  }
}

/** Independent deadlines keep an active SSE connection alive without hanging forever. */
export class LLMRequestMonitor {
  readonly deadline: Promise<never>;
  private rejectDeadline!: (error: Error) => void;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private totalTimer?: ReturnType<typeof setTimeout>;
  private finished = false;
  private readonly started = Date.now();
  private readonly diagnostics: LLMRequestDiagnostics;

  constructor(
    providerId: string,
    url: string,
    private readonly options: LLMOptions,
    private readonly abort: () => void,
  ) {
    const timeout = options.requestTimeoutMs ?? getRequestTimeoutMs();
    const requestTimeoutMs = Math.min(
      2147483647,
      Number.isFinite(timeout) && timeout > 0 ? timeout : getRequestTimeoutMs(),
    );
    const stream = options.stream !== false;
    const total = stream
      ? (options.requestTotalTimeoutMs ?? requestTimeoutMs * 6)
      : requestTimeoutMs;
    const totalTimeoutMs = Math.min(
      2147483647,
      Math.max(
        requestTimeoutMs,
        Number.isFinite(total) ? total : requestTimeoutMs * 6,
      ),
    );
    let endpointHost: string | undefined;
    try {
      endpointHost = new URL(url).host;
    } catch {
      // An invalid URL will be rejected by the HTTP transport; do not log it.
    }
    this.diagnostics = {
      providerId,
      model: options.model,
      endpointHost,
      stream,
      requestTimeoutMs,
      totalTimeoutMs,
      startedAt: new Date(this.started).toISOString(),
      elapsedMs: 0,
      receivedChars: 0,
    };
    this.deadline = new Promise((_, reject) => {
      this.rejectDeadline = reject;
    });
  }

  start(): void {
    if (this.diagnostics.stream) this.resetIdleTimer();
    this.totalTimer = setTimeout(
      () => this.timeout("total", this.diagnostics.totalTimeoutMs),
      this.diagnostics.totalTimeoutMs,
    );
  }

  received(length: number, status?: number): void {
    if (this.finished || length <= this.diagnostics.receivedChars) return;
    const first = this.diagnostics.firstByteMs === undefined;
    this.diagnostics.firstByteMs ??= Date.now() - this.started;
    this.diagnostics.lastActivityMs = Date.now() - this.started;
    this.diagnostics.receivedChars = length;
    if (status !== undefined) this.diagnostics.httpStatus = status;
    if (this.diagnostics.stream) this.resetIdleTimer();
    if (first) this.notify("receiving");
  }

  content(): void {
    if (this.diagnostics.firstContentMs !== undefined) return;
    this.diagnostics.firstContentMs = this.finished
      ? this.diagnostics.elapsedMs
      : Date.now() - this.started;
    this.notify("content");
  }

  private notify(kind: "receiving" | "content"): void {
    try {
      this.options.onActivity?.({ kind, diagnostics: this.snapshot() });
    } catch (error) {
      ztoolkit.log("[AI-Butler] Request activity callback failed:", error);
    }
  }

  private resetIdleTimer(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.timeout(
        this.diagnostics.firstByteMs === undefined ? "first-response" : "idle",
        this.diagnostics.requestTimeoutMs,
      );
    }, this.diagnostics.requestTimeoutMs);
  }

  private timeout(
    kind: NonNullable<LLMRequestDiagnostics["timeoutKind"]>,
    ms: number,
  ): void {
    if (this.finished) return;
    this.diagnostics.timeoutKind = kind;
    const message =
      kind === "first-response"
        ? getString("provider-error-first-response-timeout", { args: { ms } })
        : kind === "idle"
          ? getString("provider-error-idle-timeout", { args: { ms } })
          : getString("provider-error-total-timeout", { args: { ms } });
    this.finish();
    // Reject before aborting: a host's abort error must not hide the timeout kind.
    this.rejectDeadline(new LLMTransportError(message, this.snapshot()));
    try {
      this.abort();
    } catch (error) {
      ztoolkit.log("[AI-Butler] Could not abort timed-out request:", error);
    }
  }

  snapshot(status?: number): LLMRequestDiagnostics {
    if (status !== undefined) this.diagnostics.httpStatus = status;
    if (!this.finished) this.diagnostics.elapsedMs = Date.now() - this.started;
    return { ...this.diagnostics };
  }

  finish(): void {
    if (!this.finished) this.diagnostics.elapsedMs = Date.now() - this.started;
    this.finished = true;
    clearTimeout(this.idleTimer);
    clearTimeout(this.totalTimer);
  }
}
