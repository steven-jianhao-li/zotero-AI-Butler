export type ProgressCb = (chunk: string) => Promise<void> | void;

export type ConversationMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LLMOptions = {
  apiUrl?: string;
  apiKey?: string;
  model?: string;
  stream?: boolean;
  requestTimeoutMs?: number;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  vendorOptions?: Record<string, unknown>;
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
    lines.push(`错误名称: ${d.errorName}`);
    lines.push(`错误信息: ${d.errorMessage}`);
    if (d.statusCode !== undefined) {
      lines.push(`状态码: ${d.statusCode}`);
    }
    lines.push(`请求路径: ${d.requestUrl}`);
    if (d.responseBody) {
      lines.push(`响应内容: ${d.responseBody}`);
    }
    if (d.responseHeaders && Object.keys(d.responseHeaders).length > 0) {
      lines.push(`响应首部: ${JSON.stringify(d.responseHeaders, null, 2)}`);
    }
    lines.push(`请求体: ${d.requestBody}`);
    return lines.join("\n");
  }
}
