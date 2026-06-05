import { AutoScanManager } from "../autoScanManager";
import { LLMEndpointManager, type LLMEndpoint } from "../llmEndpointManager";
import { getPref, setPref } from "../../utils/prefs";
import type {
  SetupPreset,
  SetupPresetChange,
  SetupPresetValues,
} from "./types";

const DEEPSEEK_ENDPOINT_ID = "endpoint-preset-deepseek";
const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions";
const DEEPSEEK_MODEL = "deepseek-chat";

function maskApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 10) return "已填写";
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

function providerLabel(raw: unknown): string {
  const value = String(raw || "").trim();
  const labels: Record<string, string> = {
    "openai-compat": "OpenAI 兼容接口",
    openai: "OpenAI",
    google: "Google Gemini",
    anthropic: "Anthropic Claude",
    openrouter: "OpenRouter",
    volcanoark: "火山方舟",
    ollama: "Ollama 本地模型",
  };
  return labels[value] || value || "未配置";
}

function pdfModeLabel(raw: unknown): string {
  const value = String(raw || "base64").trim();
  const labels: Record<string, string> = {
    text: "文本提取",
    base64: "Base64 文件输入",
    mineru: "MinerU 解析",
  };
  return labels[value] || value;
}
function getChanges(values: SetupPresetValues): SetupPresetChange[] {
  const endpoints = LLMEndpointManager.getEndpoints();
  const currentTop = endpoints[0]?.name || "未配置";
  return [
    {
      label: "AI 平台",
      before: providerLabel(getPref("provider")),
      after: "DeepSeek（使用 OpenAI 兼容接口）",
    },
    {
      label: "DeepSeek API 地址",
      before: String(getPref("openaiCompatApiUrl") || "空"),
      after: DEEPSEEK_API_URL,
    },
    {
      label: "DeepSeek 模型",
      before: String(getPref("openaiCompatModel") || "空"),
      after: values.model || DEEPSEEK_MODEL,
    },
    {
      label: "API Key",
      before: "本地已有值会被替换",
      after: maskApiKey(values.apiKey),
    },
    { label: "模型优先级", before: currentTop, after: "DeepSeek 排在第一位" },
    {
      label: "PDF 处理",
      before: pdfModeLabel(getPref("pdfProcessMode")),
      after: "文本提取",
    },
    {
      label: "自动扫描",
      before: getPref("autoScan") ? "已开启" : "已关闭",
      after: "开启",
    },
    {
      label: "追问保存",
      before: getPref("saveChatHistory") ? "已开启" : "已关闭",
      after: "开启",
    },
    {
      label: "随机性参数（Temperature）",
      before: getPref("enableTemperature") ? "发送" : "不发送",
      after: "不发送",
    },
    {
      label: "最大输出长度参数（Max Tokens）",
      before: getPref("enableMaxTokens") ? "发送" : "不发送",
      after: "不发送",
    },
    {
      label: "采样参数（Top P）",
      before: getPref("enableTopP") ? "发送" : "不发送",
      after: "不发送",
    },
  ];
}

function apply(values: SetupPresetValues): void {
  const trimmedKey = values.apiKey.trim();
  const timestamp = new Date().toISOString();
  const deepSeekEndpoint: LLMEndpoint = {
    id: DEEPSEEK_ENDPOINT_ID,
    name: "DeepSeek",
    providerType: "openai-compat",
    apiUrl: DEEPSEEK_API_URL,
    apiKey: trimmedKey,
    model: values.model || DEEPSEEK_MODEL,
    reasoningEffort: "default",
    pdfProcessMode: "text",
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const endpoints = LLMEndpointManager.getEndpoints().filter(
    (endpoint) => endpoint.id !== DEEPSEEK_ENDPOINT_ID,
  );

  setPref("provider", "openai-compat");
  setPref("openaiCompatApiUrl", DEEPSEEK_API_URL);
  setPref("openaiCompatApiKey", trimmedKey);
  setPref("openaiCompatModel", values.model || DEEPSEEK_MODEL);
  setPref("llmRoutingStrategy", "priority");
  setPref("pdfProcessMode", "text");
  setPref("autoScan", true);
  setPref("saveChatHistory", true as any);
  setPref("enableTemperature", false as any);
  setPref("enableMaxTokens", false as any);
  setPref("enableTopP", false as any);
  LLMEndpointManager.saveEndpoints([deepSeekEndpoint, ...endpoints]);
  AutoScanManager.getInstance().start();
}

export const deepSeekPreset: SetupPreset = {
  id: "deepseek",
  name: "DeepSeek",
  title: "DeepSeek",
  description: "适合国内网络环境，价格低，作为 OpenAI 兼容接口接入。",
  guideTitle: "DeepSeek 配置教程",
  guideSubtitle:
    "只需要完成充值/创建密钥/粘贴密钥这几步，剩下的插件设置会自动处理。",
  apiKeyPlaceholder: "粘贴 DeepSeek API Key，例如 sk-...",
  successMessage: "✅ DeepSeek 配置已应用，可以开始使用了",
  endpoint: {
    id: DEEPSEEK_ENDPOINT_ID,
    name: "DeepSeek",
    providerType: "openai-compat",
    apiUrl: DEEPSEEK_API_URL,
    model: DEEPSEEK_MODEL,
    reasoningEffort: "default",
    pdfProcessMode: "text",
  },
  guideSteps: [
    {
      title: "打开 DeepSeek 开放平台",
      detail: "登录后进入用量页，确认账户有可用余额。",
      url: "https://platform.deepseek.com/usage",
    },
    {
      title: "创建 API Key",
      detail: "进入 API Keys 页面，新建密钥并立刻复制；密钥通常只展示一次。",
      url: "https://platform.deepseek.com/api_keys",
    },
    {
      title: "粘贴 API Key",
      detail: "把刚复制的密钥粘贴到下方输入框，然后继续下一步。",
    },
  ],
  getChanges,
  apply,
};
