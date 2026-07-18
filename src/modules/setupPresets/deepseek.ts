import { AutoScanManager } from "../autoScanManager";
import { LLMEndpointManager, type LLMEndpoint } from "../llmEndpointManager";
import { getPref, setPref } from "../../utils/prefs";
import { getString } from "../../utils/locale";
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
  if (trimmed.length <= 10) return getString("setup-preset-value-filled");
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

function providerLabel(raw: unknown): string {
  const value = String(raw || "").trim();
  const labels: Record<string, string> = {
    "openai-compat": getString("setup-preset-provider-openai-compat"),
    openai: "OpenAI",
    google: "Google Gemini",
    anthropic: "Anthropic Claude",
    openrouter: "OpenRouter",
    volcanoark: getString("setup-preset-provider-volcanoark"),
    ollama: getString("setup-preset-provider-ollama"),
  };
  return (
    labels[value] || value || getString("setup-preset-value-not-configured")
  );
}

function pdfModeLabel(raw: unknown): string {
  const value = String(raw || "base64").trim();
  const labels: Record<string, string> = {
    text: getString("setup-preset-pdf-text"),
    base64: getString("setup-preset-pdf-base64"),
    mineru: getString("setup-preset-pdf-mineru"),
  };
  return labels[value] || value;
}
function getChanges(values: SetupPresetValues): SetupPresetChange[] {
  const endpoints = LLMEndpointManager.getEndpoints();
  const currentTop =
    endpoints[0]?.name || getString("setup-preset-value-not-configured");
  return [
    {
      label: getString("setup-preset-change-ai-platform"),
      before: providerLabel(getPref("provider")),
      after: getString("setup-preset-deepseek-provider-after"),
    },
    {
      label: getString("setup-preset-change-deepseek-api-url"),
      before: String(
        getPref("openaiCompatApiUrl") || getString("setup-preset-value-empty"),
      ),
      after: DEEPSEEK_API_URL,
    },
    {
      label: getString("setup-preset-change-deepseek-model"),
      before: String(
        getPref("openaiCompatModel") || getString("setup-preset-value-empty"),
      ),
      after: values.model || DEEPSEEK_MODEL,
    },
    {
      label: getString("setup-preset-change-api-key"),
      before: getString("setup-preset-local-key-replaced"),
      after: maskApiKey(values.apiKey),
    },
    {
      label: getString("setup-preset-change-model-priority"),
      before: currentTop,
      after: getString("setup-preset-deepseek-priority-after"),
    },
    {
      label: getString("setup-preset-change-pdf-processing"),
      before: pdfModeLabel(getPref("pdfProcessMode")),
      after: getString("setup-preset-pdf-text"),
    },
    {
      label: getString("setup-preset-change-auto-scan"),
      before: getPref("autoScan")
        ? getString("setup-preset-value-enabled")
        : getString("setup-preset-value-disabled"),
      after: getString("setup-preset-value-enable"),
    },
    {
      label: getString("setup-preset-change-save-chat"),
      before: getPref("saveChatHistory")
        ? getString("setup-preset-value-enabled")
        : getString("setup-preset-value-disabled"),
      after: getString("setup-preset-value-enable"),
    },
    {
      label: getString("setup-preset-change-temperature"),
      before: getPref("enableTemperature")
        ? getString("setup-preset-value-send")
        : getString("setup-preset-value-not-send"),
      after: getString("setup-preset-value-not-send"),
    },
    {
      label: getString("setup-preset-change-max-tokens"),
      before: getPref("enableMaxTokens")
        ? getString("setup-preset-value-send")
        : getString("setup-preset-value-not-send"),
      after: getString("setup-preset-value-not-send"),
    },
    {
      label: getString("setup-preset-change-top-p"),
      before: getPref("enableTopP")
        ? getString("setup-preset-value-send")
        : getString("setup-preset-value-not-send"),
      after: getString("setup-preset-value-not-send"),
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
  get description() {
    return getString("setup-preset-deepseek-description");
  },
  get guideTitle() {
    return getString("setup-preset-deepseek-guide-title");
  },
  get guideSubtitle() {
    return getString("setup-preset-deepseek-guide-subtitle");
  },
  get apiKeyPlaceholder() {
    return getString("setup-preset-deepseek-api-key-placeholder");
  },
  get successMessage() {
    return getString("setup-preset-deepseek-success");
  },
  endpoint: {
    id: DEEPSEEK_ENDPOINT_ID,
    name: "DeepSeek",
    providerType: "openai-compat",
    apiUrl: DEEPSEEK_API_URL,
    model: DEEPSEEK_MODEL,
    reasoningEffort: "default",
    pdfProcessMode: "text",
  },
  get guideSteps() {
    return [
      {
        title: getString("setup-preset-deepseek-step-open-title"),
        detail: getString("setup-preset-deepseek-step-open-detail"),
        url: "https://platform.deepseek.com/usage",
      },
      {
        title: getString("setup-preset-deepseek-step-key-title"),
        detail: getString("setup-preset-deepseek-step-key-detail"),
        url: "https://platform.deepseek.com/api_keys",
      },
      {
        title: getString("setup-preset-deepseek-step-paste-title"),
        detail: getString("setup-preset-deepseek-step-paste-detail"),
      },
    ];
  },
  getChanges,
  apply,
};
