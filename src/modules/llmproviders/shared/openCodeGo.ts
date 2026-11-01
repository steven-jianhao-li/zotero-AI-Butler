import { version } from "../../../../package.json";
import { mergeRequestHeaders } from "./requestHeaders";

/**
 * OpenCode Go 协议适配。
 *
 * OpenCode Go 是 OpenCode 的订阅式模型网关：第三方客户端使用 Console 网关
 * `https://opencode.ai/inference/go`，按模型能力分别走四种协议：
 * - OpenAI Chat Completions：`/openai/v1/chat/completions`
 * - OpenAI Responses：`/openai/v1/responses`
 * - Anthropic Messages：`/anthropic/v1/messages`
 * - Gemini：`/google/v1beta/models/<model>:generateContent`
 *
 * 除标准鉴权头（Bearer / x-api-key / x-goog-api-key，按协议族不同）外，
 * OpenCode 客户端还会给所有 `opencode*` 供应商追加特殊协议头：
 * - `x-opencode-session`：会话 ID（Go 官方要求必带，用于路由与提示词缓存）
 * - `x-opencode-request`：当前用户轮次的请求 ID
 * - `x-opencode-client`：客户端标识（opencode 自己是 `cli`）
 * - `x-opencode-project`：项目标识（无 git 项目时为 `global`）
 * - `User-Agent`：客户端标识（opencode 为 `opencode/<version> ...`）
 *
 * 以上取值来自对 OpenCode 1.18.30 实际请求的本地抓包，本插件以自己的身份
 * 发送同类请求头，不伪装成 OpenCode 客户端。
 */

/** 官方 harness 文档给出的 Go 网关 Chat Completions 端点。 */
export const OPENCODE_GO_DEFAULT_CHAT_URL =
  "https://opencode.ai/inference/go/openai/v1/chat/completions";

/** 官方 harness 文档给出的 Go 网关 Responses 端点。 */
export const OPENCODE_GO_DEFAULT_RESPONSES_URL =
  "https://opencode.ai/inference/go/openai/v1/responses";

/** 官方 harness 文档给出的 Go 网关 Anthropic Messages 基址。 */
export const OPENCODE_GO_DEFAULT_ANTHROPIC_URL =
  "https://opencode.ai/inference/go/anthropic";

/** 官方 harness 文档给出的 Go 网关 Gemini 基址。 */
export const OPENCODE_GO_DEFAULT_GOOGLE_URL =
  "https://opencode.ai/inference/go/google";

/** 默认模型：GLM-5.3 属于 chat 协议族，文本/推理/工具调用能力齐全。 */
export const OPENCODE_GO_DEFAULT_MODEL = "glm-5.3";

/** Go 要求客户端标识自己，不伪装成 OpenCode 或通用 SDK。 */
export const OPENCODE_GO_USER_AGENT = `zotero-ai-butler/${version}`;

/** `x-opencode-client`：本插件的客户端标识。 */
export const OPENCODE_GO_CLIENT = "zotero-ai-butler";

/** `x-opencode-project`：Zotero 插件不是代码项目，与 OpenCode 的 global 项目一致。 */
export const OPENCODE_GO_PROJECT = "global";

const VERSIONED_PATH = /\/(?:v\d+(?:beta)?|openai\/v\d+(?:beta)?)$/i;

let cachedSessionId = "";
let sessionSequence = 0;
let requestSequence = 0;

function randomToken(length = 10): string {
  let out = "";
  while (out.length < length) {
    out += Math.random().toString(36).slice(2);
  }
  return out.slice(0, length);
}

/**
 * 稳定会话 ID：同一插件会话内复用，满足 Go 对 `x-opencode-session`
 * 稳定性的要求（用于路由与提示词缓存）。
 */
export function getOpenCodeGoSessionId(): string {
  if (!cachedSessionId) {
    sessionSequence += 1;
    cachedSessionId = `ses_${Date.now().toString(36)}${sessionSequence}${randomToken(8)}`;
  }
  return cachedSessionId;
}

/** 每次请求唯一的 `x-opencode-request`。 */
export function getOpenCodeGoRequestId(): string {
  requestSequence += 1;
  return `msg_${Date.now().toString(36)}${requestSequence}${randomToken(8)}`;
}

/** 仅供测试使用：丢弃缓存的会话/请求计数。 */
export function resetOpenCodeGoSessionId(): void {
  cachedSessionId = "";
  sessionSequence = 0;
  requestSequence = 0;
}

/**
 * 把用户填写的地址归一化为 Go 网关的 Chat Completions 端点。
 *
 * 接受下列写法（大小写不敏感，忽略尾部斜杠）：
 * - 完整端点 `.../inference/go/openai/v1/chat/completions`
 * - 网关基址 `.../inference/go` / `.../inference`
 * - 协议版本地址 `.../openai/v1`（或任意 `.../v1`）
 * - 留空（使用官方默认地址）
 */
export function resolveOpenCodeGoChatUrl(rawUrl?: string): string {
  const raw = (rawUrl || "").trim().replace(/\/+$/, "");
  if (!raw) return OPENCODE_GO_DEFAULT_CHAT_URL;
  if (/\/chat\/completions$/i.test(raw)) return raw;
  if (VERSIONED_PATH.test(raw)) return `${raw}/chat/completions`;
  if (/\/openai$/i.test(raw)) return `${raw}/v1/chat/completions`;
  if (/\/go$/i.test(raw)) return `${raw}/openai/v1/chat/completions`;
  if (/\/inference$/i.test(raw)) return `${raw}/go/openai/v1/chat/completions`;
  return `${raw}/v1/chat/completions`;
}

/** 端点是否指向 OpenCode Go 网关（用于自动补齐 Go 协议头）。 */
export function isOpenCodeGoGatewayUrl(rawUrl?: string): boolean {
  const raw = (rawUrl || "").trim();
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (!/(^|\.)opencode\.ai$/i.test(url.hostname)) return false;
    return /\/(?:inference|zen)\/go(?:\/|$)/i.test(url.pathname);
  } catch {
    return false;
  }
}

/**
 * 构造完整请求头：标准 Bearer 鉴权 + 全部 Go 特殊协议头。
 * 用户自定义请求头优先（可覆盖任意一项）。
 */
export function buildOpenCodeGoHeaders(
  apiKey: string,
  customHeaders?: Record<string, string>,
): Record<string, string> {
  return mergeRequestHeaders(
    {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": OPENCODE_GO_USER_AGENT,
      "x-opencode-client": OPENCODE_GO_CLIENT,
      "x-opencode-project": OPENCODE_GO_PROJECT,
      "x-opencode-session": getOpenCodeGoSessionId(),
      "x-opencode-request": getOpenCodeGoRequestId(),
    },
    customHeaders,
  );
}

/**
 * 只补充 Go 特殊协议头，供统一中间层注入到任意协议族（Chat Completions /
 * Responses / Anthropic / Gemini）的请求上；鉴权头仍由各 Provider 负责。
 */
export function withOpenCodeGoHeaders(
  customHeaders?: Record<string, string>,
): Record<string, string> {
  return mergeRequestHeaders(
    {
      "User-Agent": OPENCODE_GO_USER_AGENT,
      "x-opencode-client": OPENCODE_GO_CLIENT,
      "x-opencode-project": OPENCODE_GO_PROJECT,
      "x-opencode-session": getOpenCodeGoSessionId(),
      "x-opencode-request": getOpenCodeGoRequestId(),
    },
    customHeaders,
  );
}

export type OpenCodeGoErrorKind =
  "unauthorized" | "forbidden" | "usage-limit" | "unknown";

function errorSearchText(error: unknown): string {
  if (error === null || error === undefined) return "";
  if (typeof error === "string") return error;
  const parts: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === "string") parts.push(value);
    else if (typeof value === "number") parts.push(String(value));
  };
  const fields = error as Record<string, unknown>;
  push(fields.message);
  push(fields.status);
  push(fields.statusCode);
  push(fields.responseBody);
  push(fields.body);
  const xhr = fields.xmlhttp;
  if (xhr && typeof xhr === "object") {
    const xhrFields = xhr as Record<string, unknown>;
    push(xhrFields.status);
    push(xhrFields.response);
    push(xhrFields.responseText);
  }
  return parts.join("\n");
}

/**
 * 区分 Go 网关的典型错误，便于给出可操作的提示：
 * - unauthorized：API Key 过期/无效（401）
 * - forbidden：免费层模型只允许 OpenCode 客户端（403）
 * - usage-limit：Go 订阅额度耗尽（429 / GoUsageLimitError）
 */
export function classifyOpenCodeGoError(error: unknown): OpenCodeGoErrorKind {
  const text = errorSearchText(error).toLowerCase();
  if (!text) return "unknown";
  if (/gousagelimiterror|go usage limit|usage limit reached/.test(text))
    return "usage-limit";
  if (
    /\b401\b|unauthorized|api key has expired|invalid api key|incorrect api key/.test(
      text,
    )
  ) {
    return "unauthorized";
  }
  if (
    /\b403\b|forbidden|free tier|free-tier|requires opencode|only available (from|in) opencode/.test(
      text,
    )
  ) {
    return "forbidden";
  }
  if (/\b429\b|too many requests|rate limit/.test(text)) return "usage-limit";
  return "unknown";
}
