import { getString } from "../../utils/locale";
export type ProgressCb = (chunk: string) => Promise<void> | void;

export type LLMAbortSignal = {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener?(
    type: "abort",
    listener: () => void,
    options?: { once?: boolean } | boolean,
  ): void;
  removeEventListener?(type: "abort", listener: () => void): void;
  throwIfAborted?(): void;
};

export type ConversationMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LLMReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export type LLMReasoningEffortSetting = "default" | LLMReasoningEffort;

export type LLMOptions = {
  apiUrl?: string;
  apiKey?: string;
  model?: string;
  stream?: boolean;
  requestTimeoutMs?: number;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  reasoningEffort?: LLMReasoningEffort;
  enablePromptCache?: boolean;
  vendorOptions?: Record<string, unknown>;
  abortSignal?: LLMAbortSignal;
};

export type LLMProviderParam =
  | "temperature"
  | "topP"
  | "maxTokens"
  | "stream"
  | "reasoningEffort"
  | "verbosity"
  | "responseFormat";

export type LLMProviderCapabilities = {
  supportsText: boolean;
  supportsStreaming: boolean;
  supportsPdfBase64: boolean;
  maxPdfFiles: number;
  supportsSystemPrompt: boolean;
  supportedParams: LLMProviderParam[];
};

export type LLMModelInfo = {
  id: string;
  name?: string;
  description?: string;
  contextLength?: number;
  ownedBy?: string;
  created?: number;
};

export type LLMUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type LLMResponse = {
  text: string;
  providerId: string;
  endpointId?: string;
  providerName?: string;
  model?: string;
  generatedAt?: string;
  requestId?: string;
  usage?: LLMUsage;
  finishReason?: string;
  warnings?: string[];
  rawExcerpt?: string;
};

export type LLMError = {
  code?: string;
  message: string;
  details?: unknown;
};

// API 连接测试结果
export interface APITestResult {
  success: boolean;
  model: string;
  rawResponse: string; // 原始 JSON 响应文本
}

// API 连接测试错误详情
export interface APITestErrorDetails {
  errorName: string;
  errorMessage: string;
  statusCode?: number;
  requestUrl: string;
  requestBody: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
}

// API 连接测试错误类
export class APITestError extends Error {
  details: APITestErrorDetails;
  constructor(message: string, details: APITestErrorDetails) {
    super(message);
    this.name = "APITestError";
    this.details = details;
  }

  // 格式化为用户友好的错误报告
  formatReport(): string {
    const d = this.details;
    const lines: string[] = [];
    lines.push(
      getString("provider-test-error-name", { args: { value: d.errorName } }),
    );
    lines.push(
      getString("provider-test-error-message", {
        args: { value: d.errorMessage },
      }),
    );
    if (d.statusCode !== undefined) {
      lines.push(
        getString("provider-test-error-status-code", {
          args: { value: d.statusCode },
        }),
      );
    }
    lines.push(
      getString("provider-test-error-request-url", {
        args: { value: d.requestUrl },
      }),
    );
    if (d.responseBody) {
      lines.push(
        getString("provider-test-error-response-body", {
          args: { value: d.responseBody },
        }),
      );
    }
    if (d.responseHeaders && Object.keys(d.responseHeaders).length > 0) {
      lines.push(
        getString("provider-test-error-response-headers", {
          args: { value: JSON.stringify(d.responseHeaders, null, 2) },
        }),
      );
    }
    lines.push(
      getString("provider-test-error-request-body", {
        args: { value: d.requestBody },
      }),
    );
    return lines.join("\n");
  }
}
