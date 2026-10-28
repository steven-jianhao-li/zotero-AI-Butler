import type { LLMModelInfo } from "./types";

/**
 * OpenCode Go 模型目录。
 *
 * OpenCode Go 网关不公开 `/models` 接口（实测返回 404），因此端点面板无法像
 * 其它供应商那样在线拉取模型列表，这里内置一份目录作为回退数据；用户仍可
 * 手动填写任意 Go 模型 ID。
 *
 * Go 的每个模型只接受固定的协议族：`chat`（OpenAI Chat Completions）、
 * `responses`（OpenAI Responses）、`anthropic`（Anthropic Messages）、
 * `google`（Gemini）。插件里对应四类供应商，把端点地址指向 Go 网关即可，
 * 统一中间层会自动补充 Go 要求的请求头。
 *
 * 数据来源：`opencode models --verbose`（providerID `opencode-go`）。
 * OpenCode 更新模型清单后可重新执行该命令并同步此文件。
 */
export type OpenCodeGoApiFamily = "chat" | "responses" | "anthropic" | "google";

export type OpenCodeGoModel = LLMModelInfo & {
  /** 该模型在 Go 网关上实际使用的协议族。 */
  apiFamily: OpenCodeGoApiFamily;
};

export const OPENCODE_GO_MODELS: OpenCodeGoModel[] = [
  {
    id: "beam-free",
    name: "Beam Free",
    apiFamily: "chat",
    contextLength: 1048576,
    maxOutputTokens: 131072,
  },
  {
    id: "claude-haiku-5-5",
    name: "Claude Haiku 5.5",
    apiFamily: "anthropic",
    contextLength: 1000000,
    maxOutputTokens: 128000,
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro (New)",
    apiFamily: "chat",
    contextLength: 1000000,
    maxOutputTokens: 384000,
  },
  {
    id: "deepseek-v4.1-flash",
    name: "DeepSeek V4.1 Flash",
    apiFamily: "chat",
    contextLength: 1000000,
    maxOutputTokens: 384000,
  },
  {
    id: "gemini-4-argon",
    name: "Gemini 4 Argon",
    apiFamily: "google",
    contextLength: 1048576,
    maxOutputTokens: 65536,
  },
  {
    id: "glm-5.2",
    name: "GLM-5.2",
    apiFamily: "chat",
    contextLength: 1000000,
    maxOutputTokens: 131072,
  },
  {
    id: "glm-5.3",
    name: "GLM-5.3",
    apiFamily: "chat",
    contextLength: 1000000,
    maxOutputTokens: 131072,
  },
  {
    id: "glm-5.3-flash",
    name: "GLM-5.3-Flash",
    apiFamily: "chat",
    contextLength: 1000000,
    maxOutputTokens: 131072,
  },
  {
    id: "gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    apiFamily: "responses",
    contextLength: 1050000,
    maxOutputTokens: 128000,
  },
  {
    id: "gpt-6-luna",
    name: "GPT-6 Luna",
    apiFamily: "responses",
    contextLength: 1050000,
    maxOutputTokens: 128000,
  },
  {
    id: "grok-4.7",
    name: "Grok 4.7",
    apiFamily: "responses",
    contextLength: 500000,
    maxOutputTokens: 500000,
  },
  {
    id: "hy3",
    name: "Hy3",
    apiFamily: "chat",
    contextLength: 256000,
    maxOutputTokens: 128000,
  },
  {
    id: "hy4-preview",
    name: "Hy4 preview",
    apiFamily: "chat",
    contextLength: 1024000,
    maxOutputTokens: 64000,
  },
  {
    id: "iceman-contributor-free",
    name: "Iceman Contributor Free",
    apiFamily: "chat",
    contextLength: 262144,
    maxOutputTokens: 131072,
  },
  {
    id: "kimi-k2.7-code",
    name: "Kimi K2.7 Code",
    apiFamily: "chat",
    contextLength: 262144,
    maxOutputTokens: 262144,
  },
  {
    id: "kimi-k3",
    name: "Kimi K3",
    apiFamily: "chat",
    contextLength: 1048576,
    maxOutputTokens: 131072,
  },
  {
    id: "kimi-k3.1-pro",
    name: "Kimi K3.1 Pro",
    apiFamily: "chat",
    contextLength: 1048576,
    maxOutputTokens: 131072,
  },
  {
    id: "longcat-2.0",
    name: "LongCat-2.0",
    apiFamily: "chat",
    contextLength: 1000000,
    maxOutputTokens: 131072,
  },
  {
    id: "mimo-v2.5",
    name: "MiMo V2.5",
    apiFamily: "chat",
    contextLength: 1000000,
    maxOutputTokens: 128000,
  },
  {
    id: "mimo-v2.5-pro",
    name: "MiMo V2.5 Pro",
    apiFamily: "chat",
    contextLength: 1048576,
    maxOutputTokens: 128000,
  },
  {
    id: "mimo-v2.6-flash",
    name: "MiMo-V2.6-Flash",
    apiFamily: "chat",
    contextLength: 1048576,
    maxOutputTokens: 131072,
  },
  {
    id: "mimo-v2.6-pro",
    name: "MiMo-V2.6-Pro",
    apiFamily: "chat",
    contextLength: 1048576,
    maxOutputTokens: 131072,
  },
  {
    id: "minimax-m3",
    name: "MiniMax-M3",
    apiFamily: "anthropic",
    contextLength: 1000000,
    maxOutputTokens: 131072,
  },
  {
    id: "minimax-m3.1-flash",
    name: "MiniMax M3.1 Flash",
    apiFamily: "chat",
    contextLength: 1000000,
    maxOutputTokens: 512000,
  },
  {
    id: "muse-spark-1.2-contributor",
    name: "Muse Spark 1.2 Contributor",
    apiFamily: "responses",
    contextLength: 1048576,
    maxOutputTokens: 131072,
  },
  {
    id: "muse-spark-1.3-contributor",
    name: "Muse Spark 1.3 Contributor",
    apiFamily: "responses",
    contextLength: 1048576,
    maxOutputTokens: 131072,
  },
  {
    id: "qwen3.7-plus",
    name: "Qwen3.7 Plus",
    apiFamily: "anthropic",
    contextLength: 1000000,
    maxOutputTokens: 65536,
  },
  {
    id: "qwen3.8-flash",
    name: "Qwen3.8 Flash",
    apiFamily: "anthropic",
    contextLength: 1000000,
    maxOutputTokens: 131072,
  },
  {
    id: "qwen3.8-max",
    name: "Qwen3.8 Max",
    apiFamily: "anthropic",
    contextLength: 1000000,
    maxOutputTokens: 131072,
  },
  {
    id: "step-5-preview",
    name: "Step 5 Preview",
    apiFamily: "chat",
    contextLength: 1000000,
    maxOutputTokens: 65536,
  },
];

/** 供端点面板按供应商类型回退使用的同族模型列表。 */
export function openCodeGoModelsForFamily(
  family: OpenCodeGoApiFamily,
): LLMModelInfo[] {
  return OPENCODE_GO_MODELS.filter((model) => model.apiFamily === family).map(
    ({ apiFamily: _apiFamily, ...model }) => ({ ...model }),
  );
}

export default OPENCODE_GO_MODELS;
