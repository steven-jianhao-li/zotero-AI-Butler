import type { LLMUsage } from "./types";

export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** Opaque provider continuation data; keep with its assistant turn, never render. */
export interface LLMAgentProviderState {
  providerId: string;
  parts: Record<string, unknown>[];
}

export interface LLMAgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: LLMToolCall[];
  toolCallId?: string;
  reasoningContent?: string;
  providerState?: LLMAgentProviderState;
}

export interface LLMAgentTurn {
  text: string;
  toolCalls: LLMToolCall[];
  usage?: LLMUsage;
  finishReason?: string;
  reasoningContent?: string;
  providerState?: LLMAgentProviderState;
}
