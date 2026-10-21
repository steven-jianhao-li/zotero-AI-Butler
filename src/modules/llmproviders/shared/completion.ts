import type { LLMProviderResult, LLMResponse } from "../types";
import { getString } from "../../../utils/locale";

const tokenLimits = new Set([
  "length",
  "max_tokens",
  "max_output_tokens",
  "max_completion_tokens",
  "max_tokens_exceeded",
  "token_limit_exceeded",
  "output_limit_exceeded",
]);
const normalStops = new Set(["stop", "end_turn", "completed", "stop_sequence"]);

export function completionForReason(
  reason: string,
): Pick<LLMProviderResult, "completion" | "recovery"> {
  const normalized = reason.toLowerCase();
  if (tokenLimits.has(normalized))
    return { completion: "partial", recovery: "continue" };
  if (normalStops.has(normalized))
    return { completion: "complete", recovery: "none" };
  return { completion: "partial", recovery: "none" };
}

/** Preserve the draft, but do not restart an already partially generated task. */
export class LLMIncompleteError extends Error {
  readonly suppressTaskRetry = true;
  get requestDiagnostics() {
    return this.response.requestDiagnostics;
  }
  constructor(public readonly response: LLMResponse) {
    super(
      getString("llm-error-incomplete-output", {
        args: { reason: response.finishReason || "unknown" },
      }),
    );
    this.name = "LLMIncompleteError";
  }
}
