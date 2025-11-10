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
