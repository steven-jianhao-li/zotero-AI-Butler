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
