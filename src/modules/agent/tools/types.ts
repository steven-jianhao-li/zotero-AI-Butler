import type { LLMToolDefinition } from "../../llmproviders/agentTypes";
import type { LLMAbortSignal } from "../../llmproviders/types";
import type { AgentSession } from "../types";

export interface AgentToolContext {
  session: AgentSession;
  signal: LLMAbortSignal;
  assertActive(): void;
}

export interface AgentTool {
  definition: LLMToolDefinition;
  write: boolean;
  execute(
    args: Record<string, unknown>,
    context: AgentToolContext,
  ): Promise<unknown>;
}
