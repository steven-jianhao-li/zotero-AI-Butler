import type { LLMContentPolicy } from "../llmService";
import type { LLMAgentMessage } from "../llmproviders/agentTypes";

export type AgentPermission = "read-only" | "confirm" | "full";
export type AgentStatus =
  "idle" | "running" | "waiting-approval" | "completed" | "cancelled" | "error";

export interface AgentRunOptions {
  permission: AgentPermission;
  endpointId?: string;
  deepReadEndpointId?: string;
  pdfPolicy: LLMContentPolicy;
  selectedItemIds: number[];
  libraryID: number;
  contextWindowTokens: number;
  maxOutputTokens: number;
  maxSteps: number;
}

export interface AgentPlanStep {
  id: string;
  text: string;
  status: "pending" | "in-progress" | "completed";
}

export interface AgentTeamMember {
  id: string;
  name: string;
  task: string;
  status: "running" | "completed" | "cancelled" | "error";
  result?: string;
}

export interface AgentApproval {
  id: string;
  toolName: string;
  description: string;
  arguments: Record<string, unknown>;
}

export interface AgentEvent {
  id: string;
  type:
    | "user"
    | "assistant"
    | "tool-start"
    | "tool-result"
    | "status"
    | "compaction"
    | "approval"
    | "team"
    | "error";
  text: string;
  createdAt: number;
  toolName?: string;
  toolCallId?: string;
  memberId?: string;
  data?: unknown;
}

/** Model working context is separate from the durable activity/evidence ledger. */
export interface AgentSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  status: AgentStatus;
  permission: AgentPermission;
  options: AgentRunOptions;
  /** Endpoint pinned for this run; options.endpointId may still mean automatic. */
  activeEndpointId?: string;
  messages: LLMAgentMessage[];
  events: AgentEvent[];
  plan: AgentPlanStep[];
  team: AgentTeamMember[];
  pendingApprovals: AgentApproval[];
  context: {
    estimatedTokens: number;
    compactions: number;
    inputTokens: number;
    outputTokens: number;
  };
  artifacts: Record<string, string>;
  mutationReceipts?: {
    signature: string;
    status: "pending" | "completed";
    resultRef?: string;
  }[];
  error?: string;
}

export function agentId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function defaultAgentOptions(libraryID = 1): AgentRunOptions {
  return {
    permission: "read-only",
    pdfPolicy: "auto",
    selectedItemIds: [],
    libraryID,
    contextWindowTokens: 262144,
    maxOutputTokens: 8192,
    maxSteps: 32,
  };
}
