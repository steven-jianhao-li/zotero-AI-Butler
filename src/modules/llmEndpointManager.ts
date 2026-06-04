import { getPref, setPref } from "../utils/prefs";
import type { ProviderId } from "./apiKeyManager";
import { normalizeReasoningEffortSetting } from "./llmproviders/shared/reasoning";
import type { LLMReasoningEffortSetting } from "./llmproviders/types";

export type LLMEndpointProviderType = ProviderId;
export type LLMRoutingStrategy = "priority" | "roundRobin";
export type LLMPdfProcessMode = "base64" | "text" | "mineru";
export type LLMEndpointPdfProcessMode = "global" | LLMPdfProcessMode;

export interface LLMEndpoint {
  id: string;
  name: string;
  providerType: LLMEndpointProviderType;
  apiUrl: string;
  apiKey: string;
  model: string;
  reasoningEffort?: LLMReasoningEffortSetting;
  pdfProcessMode?: LLMEndpointPdfProcessMode;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LLMEndpointRoute {
  endpoints: LLMEndpoint[];
  strategy: LLMRoutingStrategy;
  maxAttempts: number;
}

export interface ProviderDefaults {
  label: string;
  apiUrl: string;
  model: string;
  reasoningEffort?: LLMReasoningEffortSetting;
}

const PROVIDER_DEFAULTS: Record<LLMEndpointProviderType, ProviderDefaults> = {
  openai: {
    label: "OpenAI (Responses 新接口)",
    apiUrl: "https://api.openai.com/v1/responses",
    model: "gpt-5",
    reasoningEffort: "medium",
  },
  "openai-compat": {
    label: "OpenAI 兼容 (Chat Completions)",
    apiUrl: "https://api.openai.com/v1/chat/completions",
    model: "gpt-3.5-turbo",
    reasoningEffort: "default",
  },
  google: {
    label: "Google Gemini",
    apiUrl: "https://generativelanguage.googleapis.com",
    model: "gemini-2.5-pro",
    reasoningEffort: "default",
  },
  anthropic: {
    label: "Anthropic Claude",
    apiUrl: "https://api.anthropic.com",
    model: "claude-3-5-sonnet-20241022",
    reasoningEffort: "default",
  },
  openrouter: {
    label: "OpenRouter",
    apiUrl: "https://openrouter.ai/api/v1/chat/completions",
    model: "google/gemma-3-27b-it",
    reasoningEffort: "default",
  },
  volcanoark: {
    label: "火山方舟 (Volcano Ark)",
    apiUrl: "https://ark.cn-beijing.volces.com/api/v3/responses",
    model: "doubao-seed-1-8-251228",
    reasoningEffort: "default",
  },
  ollama: {
    label: "Ollama",
    apiUrl: "http://localhost:11434",
    model: "llama3.2",
    reasoningEffort: "default",
  },
};

const PROVIDER_TYPES = Object.keys(
  PROVIDER_DEFAULTS,
) as LLMEndpointProviderType[];

const LEGACY_PRIMARY_ENDPOINT_ID = "endpoint-legacy-primary";

function nowIso(): string {
  return new Date().toISOString();
}

function makeEndpointId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `endpoint-${Date.now().toString(36)}-${random}`;
}

function safeProviderType(raw: unknown): LLMEndpointProviderType {
  const value = String(raw || "").toLowerCase();
  if (value.includes("gemini")) return "google";
  if (value.includes("claude")) return "anthropic";
  if (value.includes("ollama")) return "ollama";
  if (PROVIDER_TYPES.includes(value as LLMEndpointProviderType)) {
    return value as LLMEndpointProviderType;
  }
  return "openai";
}

function normalizeGlobalPdfProcessMode(raw: unknown): LLMPdfProcessMode {
  const value = String(raw || "")
    .trim()
    .toLowerCase();
  if (value === "text" || value === "mineru") return value;
  return "base64";
}

function normalizeEndpointPdfProcessMode(
  raw: unknown,
): LLMEndpointPdfProcessMode {
  const value = String(raw || "")
    .trim()
    .toLowerCase();
  if (value === "base64" || value === "text" || value === "mineru") {
    return value;
  }
  return "global";
}

function parseJsonArray(raw: unknown): unknown[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeEndpoint(
  raw: Partial<LLMEndpoint>,
  fallbackIndex: number,
): LLMEndpoint {
  const providerType = safeProviderType(raw.providerType);
  const defaults = PROVIDER_DEFAULTS[providerType];
  const createdAt = raw.createdAt || nowIso();
  return {
    id: String(raw.id || "").trim() || makeEndpointId(),
    name:
      String(raw.name || "").trim() || `${defaults.label} ${fallbackIndex + 1}`,
    providerType,
    apiUrl: String(raw.apiUrl || defaults.apiUrl).trim(),
    apiKey: String(raw.apiKey || "").trim(),
    model: String(raw.model || defaults.model).trim(),
    reasoningEffort: normalizeReasoningEffortSetting(
      raw.reasoningEffort,
      defaults.reasoningEffort || "default",
    ),
    pdfProcessMode: normalizeEndpointPdfProcessMode(raw.pdfProcessMode),
    enabled: raw.enabled !== false,
    createdAt,
    updatedAt: raw.updatedAt || createdAt,
  };
}

export class LLMEndpointManager {
  static providerTypes(): LLMEndpointProviderType[] {
    return [...PROVIDER_TYPES];
  }

  static providerDefaults(
    providerType: LLMEndpointProviderType,
  ): ProviderDefaults {
    return PROVIDER_DEFAULTS[providerType] || PROVIDER_DEFAULTS.openai;
  }

  static providerLabel(providerType: string): string {
    return this.providerDefaults(safeProviderType(providerType)).label;
  }

  static providerAllowsEmptyApiKey(providerType: string): boolean {
    return safeProviderType(providerType) === "ollama";
  }

  static isEndpointUsable(
    endpoint: Pick<LLMEndpoint, "apiUrl" | "apiKey" | "model" | "providerType">,
  ): boolean {
    return (
      endpoint.apiUrl.trim().length > 0 &&
      endpoint.model.trim().length > 0 &&
      (endpoint.apiKey.trim().length > 0 ||
        this.providerAllowsEmptyApiKey(endpoint.providerType))
    );
  }

  static normalizePdfProcessMode(raw: unknown): LLMEndpointPdfProcessMode {
    return normalizeEndpointPdfProcessMode(raw);
  }

  static getGlobalPdfProcessMode(): LLMPdfProcessMode {
    return normalizeGlobalPdfProcessMode(getPref("pdfProcessMode" as any));
  }

  static getEffectivePdfProcessMode(
    endpoint?: Pick<LLMEndpoint, "pdfProcessMode"> | null,
  ): LLMPdfProcessMode {
    const endpointMode = normalizeEndpointPdfProcessMode(
      endpoint?.pdfProcessMode,
    );
    return endpointMode === "global"
      ? this.getGlobalPdfProcessMode()
      : endpointMode;
  }

  static pdfProcessModeLabel(mode: LLMEndpointPdfProcessMode): string {
    switch (normalizeEndpointPdfProcessMode(mode)) {
      case "base64":
        return "Base64 文件输入";
      case "text":
        return "文本提取";
      case "mineru":
        return "MinerU";
      default:
        return "跟随全局默认";
    }
  }

  static createEndpoint(
    providerType: LLMEndpointProviderType = "openai-compat",
  ): LLMEndpoint {
    const defaults = this.providerDefaults(providerType);
    const timestamp = nowIso();
    return {
      id: makeEndpointId(),
      name: defaults.label,
      providerType,
      apiUrl: defaults.apiUrl,
      apiKey: "",
      model: defaults.model,
      reasoningEffort: defaults.reasoningEffort || "default",
      pdfProcessMode: "global",
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  static getEndpoints(): LLMEndpoint[] {
    const stored = this.readStoredEndpoints();
    if (stored.length > 0) return stored;
    const migrated = [this.createLegacyEndpoint()];
    this.saveEndpoints(migrated);
    return migrated;
  }

  static getEnabledEndpoints(): LLMEndpoint[] {
    return this.getEndpoints().filter((endpoint) => endpoint.enabled);
  }

  static saveEndpoints(endpoints: LLMEndpoint[]): void {
    const seen = new Set<string>();
    const normalized = endpoints.map((endpoint, index) => {
      const item = normalizeEndpoint(endpoint, index);
      while (seen.has(item.id)) item.id = makeEndpointId();
      seen.add(item.id);
      item.updatedAt = nowIso();
      return item;
    });
    setPref("llmEndpoints", JSON.stringify(normalized));
  }

  static upsertEndpoint(endpoint: LLMEndpoint): void {
    const endpoints = this.getEndpoints();
    const index = endpoints.findIndex((item) => item.id === endpoint.id);
    if (index >= 0) endpoints[index] = endpoint;
    else endpoints.push(endpoint);
    this.saveEndpoints(endpoints);
  }

  static removeEndpoint(endpointId: string): void {
    this.saveEndpoints(
      this.getEndpoints().filter((endpoint) => endpoint.id !== endpointId),
    );
  }

  static moveEndpoint(endpointId: string, direction: -1 | 1): void {
    const endpoints = this.getEndpoints();
    const index = endpoints.findIndex((endpoint) => endpoint.id === endpointId);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= endpoints.length) return;
    const [endpoint] = endpoints.splice(index, 1);
    endpoints.splice(next, 0, endpoint);
    this.saveEndpoints(endpoints);
  }

  static getRoutingStrategy(): LLMRoutingStrategy {
    const raw = String(getPref("llmRoutingStrategy") || "").trim();
    return raw === "roundRobin" ? "roundRobin" : "priority";
  }

  static setRoutingStrategy(strategy: LLMRoutingStrategy): void {
    setPref("llmRoutingStrategy", strategy);
  }

  static getMaxAttemptCount(): number {
    const raw = String(getPref("maxApiSwitchCount" as any) || "3");
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
  }

  static prepareRoute(): LLMEndpointRoute {
    let enabled = this.getEnabledEndpoints();
    if (!enabled.some((endpoint) => this.isEndpointUsable(endpoint))) {
      this.syncLegacyPrimaryEndpointFromPrefs();
      enabled = this.getEnabledEndpoints();
    }
    if (enabled.length === 0) {
      throw new Error("No enabled LLM endpoints are configured.");
    }

    const strategy = this.getRoutingStrategy();
    const maxAttempts = this.getMaxAttemptCount();
    if (strategy === "priority") {
      return { endpoints: enabled, strategy, maxAttempts };
    }

    const cursor = this.getRoundRobinCursor();
    const start = enabled.findIndex((endpoint) => endpoint.id === cursor);
    const startIndex = start >= 0 ? start : 0;
    return {
      endpoints: [
        ...enabled.slice(startIndex),
        ...enabled.slice(0, startIndex),
      ],
      strategy,
      maxAttempts,
    };
  }

  static markEndpointAttempted(endpointId: string): void {
    if (this.getRoutingStrategy() !== "roundRobin") return;
    const enabled = this.getEnabledEndpoints();
    if (enabled.length === 0) return;
    const index = enabled.findIndex((endpoint) => endpoint.id === endpointId);
    const next = enabled[(index >= 0 ? index + 1 : 0) % enabled.length];
    if (next) setPref("llmRoundRobinCursor", next.id);
  }

  static getEndpoint(endpointId: string): LLMEndpoint | undefined {
    return this.getEndpoints().find((endpoint) => endpoint.id === endpointId);
  }

  static isMultiModelSummaryEnabled(): boolean {
    return (getPref("multiModelSummaryEnabled") as boolean) === true;
  }

  static setMultiModelSummaryEnabled(enabled: boolean): void {
    setPref("multiModelSummaryEnabled", enabled);
  }

  static getMultiModelSummaryEndpointIds(): string[] {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const value of parseJsonArray(
      getPref("multiModelSummaryEndpointIds"),
    )) {
      const id = String(value || "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    return ids;
  }

  static setMultiModelSummaryEndpointIds(ids: string[]): void {
    const seen = new Set<string>();
    const normalized = ids
      .map((id) => String(id || "").trim())
      .filter((id) => {
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    setPref("multiModelSummaryEndpointIds", JSON.stringify(normalized));
  }

  static getMultiModelSummaryEndpoints(): LLMEndpoint[] {
    const selectedIds = this.getMultiModelSummaryEndpointIds();
    if (selectedIds.length === 0) return [];

    const enabledById = new Map(
      this.getEnabledEndpoints().map((endpoint) => [endpoint.id, endpoint]),
    );
    return selectedIds
      .map((id) => enabledById.get(id))
      .filter((endpoint): endpoint is LLMEndpoint => Boolean(endpoint));
  }

  static validateEndpoint(endpoint: LLMEndpoint): string[] {
    const missing: string[] = [];
    if (!endpoint.name.trim()) missing.push("name");
    if (!endpoint.apiUrl.trim()) missing.push("apiUrl");
    if (
      !this.providerAllowsEmptyApiKey(endpoint.providerType) &&
      !endpoint.apiKey.trim()
    ) {
      missing.push("apiKey");
    }
    if (!endpoint.model.trim()) missing.push("model");
    return missing;
  }

  static syncLegacyPrimaryEndpointFromPrefs(): LLMEndpoint | null {
    const stored = this.readStoredEndpoints();
    const legacyEndpoint = this.createLegacyEndpoint();

    if (stored.length === 0) {
      this.saveEndpoints([legacyEndpoint]);
      return legacyEndpoint;
    }

    const index = stored.findIndex(
      (endpoint) => endpoint.id === LEGACY_PRIMARY_ENDPOINT_ID,
    );
    if (index < 0) return null;

    const previous = stored[index];
    const synced: LLMEndpoint = {
      ...legacyEndpoint,
      createdAt: previous.createdAt,
      enabled: previous.enabled,
      pdfProcessMode: previous.pdfProcessMode || "global",
    };

    if (this.endpointCoreEquals(previous, synced)) {
      return previous;
    }

    stored[index] = synced;
    this.saveEndpoints(stored);
    return synced;
  }

  private static readStoredEndpoints(): LLMEndpoint[] {
    return parseJsonArray(getPref("llmEndpoints")).map((item, index) =>
      normalizeEndpoint(item as Partial<LLMEndpoint>, index),
    );
  }

  private static getRoundRobinCursor(): string {
    return String(getPref("llmRoundRobinCursor") || "").trim();
  }

  private static createLegacyEndpoint(): LLMEndpoint {
    const providerType = safeProviderType(
      getPref("provider") || "openai-compat",
    );
    const defaults = this.providerDefaults(providerType);
    const timestamp = nowIso();
    return {
      id: LEGACY_PRIMARY_ENDPOINT_ID,
      name: defaults.label,
      providerType,
      apiUrl: this.getLegacyApiUrl(providerType) || defaults.apiUrl,
      apiKey: this.getLegacyApiKey(providerType),
      model: this.getLegacyModel(providerType) || defaults.model,
      reasoningEffort: this.getLegacyReasoningEffort(providerType),
      pdfProcessMode: "global",
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  private static getLegacyApiUrl(
    providerType: LLMEndpointProviderType,
  ): string {
    const keyByProvider: Record<LLMEndpointProviderType, string> = {
      openai: "openaiApiUrl",
      "openai-compat": "openaiCompatApiUrl",
      google: "geminiApiUrl",
      anthropic: "anthropicApiUrl",
      openrouter: "openRouterApiUrl",
      volcanoark: "volcanoArkApiUrl",
      ollama: "ollamaApiUrl",
    };
    return String(getPref(keyByProvider[providerType] as any) || "").trim();
  }

  private static getLegacyApiKey(
    providerType: LLMEndpointProviderType,
  ): string {
    const keyByProvider: Record<LLMEndpointProviderType, string> = {
      openai: "openaiApiKey",
      "openai-compat": "openaiCompatApiKey",
      google: "geminiApiKey",
      anthropic: "anthropicApiKey",
      openrouter: "openRouterApiKey",
      volcanoark: "volcanoArkApiKey",
      ollama: "ollamaApiKey",
    };
    const value = String(getPref(keyByProvider[providerType] as any) || "");
    if (providerType === "openai-compat" && !value.trim()) {
      return String(getPref("openaiApiKey") || "").trim();
    }
    return value.trim();
  }

  private static getLegacyModel(providerType: LLMEndpointProviderType): string {
    const keyByProvider: Record<LLMEndpointProviderType, string> = {
      openai: "openaiApiModel",
      "openai-compat": "openaiCompatModel",
      google: "geminiModel",
      anthropic: "anthropicModel",
      openrouter: "openRouterModel",
      volcanoark: "volcanoArkModel",
      ollama: "ollamaModel",
    };
    const value = String(getPref(keyByProvider[providerType] as any) || "");
    if (providerType === "openai-compat" && !value.trim()) {
      return String(getPref("openaiApiModel") || "").trim();
    }
    return value.trim();
  }

  private static getLegacyReasoningEffort(
    providerType: LLMEndpointProviderType,
  ): LLMReasoningEffortSetting {
    const defaults = this.providerDefaults(providerType);
    const reasoningEffort = normalizeReasoningEffortSetting(
      getPref("reasoningEffort" as any),
      defaults.reasoningEffort || "default",
    );
    return reasoningEffort === "default"
      ? defaults.reasoningEffort || "default"
      : reasoningEffort;
  }

  private static endpointCoreEquals(a: LLMEndpoint, b: LLMEndpoint): boolean {
    return (
      a.id === b.id &&
      a.name === b.name &&
      a.providerType === b.providerType &&
      a.apiUrl === b.apiUrl &&
      a.apiKey === b.apiKey &&
      a.model === b.model &&
      a.reasoningEffort === b.reasoningEffort &&
      (a.pdfProcessMode || "global") === (b.pdfProcessMode || "global") &&
      a.enabled === b.enabled
    );
  }
}

export default LLMEndpointManager;
