import { getPref } from "../../../utils/prefs";

export function getRequestTimeoutMs(): number {
  const timeoutStr = (getPref("requestTimeout") as string) || "300000";
  const timeout = parseInt(timeoutStr) || 300000;
  return Math.max(timeout, 30000);
}

export function safeJsonParse<T = any>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** 记录各供应商 prompt/context cache 的输入侧命中情况。 */
export function logPromptCacheUsage(tag: string, usage: any): void {
  if (!usage || typeof usage !== "object") return;
  const totalInput = usage.prompt_tokens ?? usage.input_tokens;
  const cacheHit =
    usage.prompt_cache_hit_tokens ??
    usage.prompt_tokens_details?.cached_tokens ??
    usage.cache_read_input_tokens;
  const cacheMiss =
    usage.prompt_cache_miss_tokens ?? usage.cache_creation_input_tokens;

  if (cacheHit === undefined && cacheMiss === undefined) return;

  ztoolkit.log(
    `[AI-Butler] ${tag} prompt cache usage: input=${totalInput ?? "unknown"}, hit=${cacheHit ?? 0}, miss=${cacheMiss ?? 0}`,
  );
}
