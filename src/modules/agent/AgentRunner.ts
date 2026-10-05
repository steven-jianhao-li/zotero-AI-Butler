import { agentText } from "./messages";
import type { LLMAgentRequest } from "../llmService";
import type {
  LLMAgentMessage,
  LLMAgentTurn,
  LLMToolCall,
  LLMToolDefinition,
} from "../llmproviders/agentTypes";
import type { LLMAbortSignal } from "../llmproviders/types";
import { throwIfAborted } from "../llmproviders/shared/requestAbort";
import {
  COMPACTION_PROMPT,
  boundedSummaryInput,
  closePendingToolCalls,
  contextSize,
  estimateTokens,
  historySplit,
  pruneToolResults,
} from "./context";
import {
  assertToolPermission,
  canonicalArguments,
  validateToolArguments,
} from "./permissions";
import { agentToolDescriptions, buildAgentPrompt } from "./prompts";
import {
  agentId,
  type AgentApproval,
  type AgentEvent,
  type AgentPlanStep,
  type AgentSession,
} from "./types";
import type { AgentTool } from "./tools/types";

function isContextOverflow(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 5) return false;
  const value = error as {
    code?: string;
    message?: string;
    originalError?: unknown;
    lastError?: unknown;
    cause?: unknown;
  };
  return (
    value.code === "context-overflow" ||
    /context.{0,30}(length|window|limit)|maximum context|too many tokens/i.test(
      value.message || "",
    ) ||
    isContextOverflow(
      value.originalError || value.lastError || value.cause,
      depth + 1,
    )
  );
}

export interface AgentRunnerDependencies {
  turn(request: LLMAgentRequest): Promise<LLMAgentTurn>;
  tools: AgentTool[];
  save(session: AgentSession): Promise<void>;
  changed(): void;
  approve(
    session: AgentSession,
    approval: AgentApproval,
    signal: LLMAbortSignal,
  ): Promise<boolean>;
  /** Shared by all sessions so library writes cannot race. */
  write<T>(operation: () => Promise<T>): Promise<T>;
}

const objectSchema = (
  properties: Record<string, unknown>,
  required: string[],
) => ({ type: "object", properties, required, additionalProperties: false });
const CORE_TOOLS: LLMToolDefinition[] = [
  {
    name: "update_plan",
    description: agentToolDescriptions.plan,
    parameters: objectSchema(
      {
        steps: {
          type: "array",
          minItems: 1,
          maxItems: 12,
          items: objectSchema(
            {
              id: { type: "string", maxLength: 40 },
              text: { type: "string", maxLength: 500 },
              status: {
                type: "string",
                enum: ["pending", "in-progress", "completed"],
              },
            },
            ["id", "text", "status"],
          ),
        },
      },
      ["steps"],
    ),
  },
  {
    name: "read_result",
    description: agentToolDescriptions.result,
    parameters: objectSchema(
      {
        resultRef: { type: "string", maxLength: 100 },
        offset: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 200, maximum: 16000 },
      },
      ["resultRef"],
    ),
  },
  {
    name: "delegate_research",
    description: agentToolDescriptions.delegate,
    parameters: objectSchema(
      {
        tasks: {
          type: "array",
          minItems: 1,
          maxItems: 3,
          items: objectSchema(
            {
              name: { type: "string", minLength: 1, maxLength: 80 },
              task: { type: "string", minLength: 1, maxLength: 3000 },
            },
            ["name", "task"],
          ),
        },
      },
      ["tasks"],
    ),
  },
];

/** Bounded research loop; UI and Zotero access live behind explicit dependencies. */
export class AgentRunner {
  private calls = 0;
  private members = 0;
  private repeat = new Map<string, number>();
  private completedWrites = new Set<string>();
  private declinedWrites = new Set<string>();
  private actualTokenRatio = 1;

  constructor(private deps: AgentRunnerDependencies) {}

  private event(
    session: AgentSession,
    type: AgentEvent["type"],
    text: string,
    extra: Partial<AgentEvent> = {},
  ): void {
    session.events.push({
      id: agentId("event"),
      type,
      text,
      createdAt: Date.now(),
      ...extra,
    });
    session.updatedAt = Date.now();
    this.deps.changed();
  }

  private artifact(session: AgentSession, result: unknown): string {
    const id = agentId("result");
    const content =
      typeof result === "string" ? result : JSON.stringify(result);
    if (content.length > 2_000_000)
      throw new Error(agentText("agent-runtime-result-limit"));
    const total = Object.values(session.artifacts).reduce(
      (sum, entry) => sum + entry.length,
      0,
    );
    if (total + content.length > 24_000_000)
      throw new Error(agentText("agent-runtime-session-limit"));
    session.artifacts[id] = content;
    return id;
  }

  private tools(session: AgentSession, child: boolean): LLMToolDefinition[] {
    return [
      ...this.deps.tools
        .filter(
          (tool) =>
            !tool.write || (!child && session.permission !== "read-only"),
        )
        .map((tool) => tool.definition),
      ...CORE_TOOLS.filter((tool) => !child || tool.name === "read_result"),
    ];
  }

  async run(session: AgentSession, signal: LLMAbortSignal): Promise<void> {
    session.status = "running";
    session.error = undefined;
    if (session.messages[0]?.role !== "system")
      session.messages.unshift({
        role: "system",
        content: buildAgentPrompt(session),
      });
    else
      session.messages[0] = {
        role: "system",
        content: buildAgentPrompt(session),
      };
    try {
      const answer = await this.loop(session, session.messages, signal, false);
      throwIfAborted(signal);
      session.status = "completed";
      if (!answer) throw new Error(agentText("agent-runtime-no-answer"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      session.status = signal.aborted ? "cancelled" : "error";
      session.error = signal.aborted ? undefined : message;
      this.event(session, signal.aborted ? "status" : "error", message);
    } finally {
      closePendingToolCalls(
        session.messages,
        "Run interrupted; execution may have been cancelled. Consult the activity log before retrying a write.",
      );
      session.pendingApprovals = [];
      await this.deps.save(session);
      this.deps.changed();
    }
  }

  private async compact(
    session: AgentSession,
    messages: LLMAgentMessage[],
    tools: LLMToolDefinition[],
    signal: LLMAbortSignal,
    force = false,
  ): Promise<boolean> {
    const capacity =
      session.options.contextWindowTokens -
      session.options.maxOutputTokens -
      2048;
    const before = contextSize(messages, tools);
    if (!force && before * this.actualTokenRatio < capacity * 0.72)
      return false;
    const pruned = pruneToolResults(messages);
    if (contextSize(pruned, tools) < before) {
      messages.splice(0, messages.length, ...pruned);
      if (
        !force &&
        contextSize(messages, tools) * this.actualTokenRatio < capacity * 0.65
      ) {
        session.context.compactions++;
        this.event(session, "compaction", agentText("agent-runtime-pruned"));
        return true;
      }
    }
    const split = historySplit(messages, 6);
    if (split <= 2) {
      if (contextSize(messages, tools) * this.actualTokenRatio > capacity)
        throw new Error(agentText("agent-runtime-context-small"));
      return contextSize(messages, tools) < before;
    }
    const history = messages.slice(1, split);
    // Archive before replacing the model projection. Do not expose opaque reasoning.
    const archive = JSON.stringify(
      history.map(({ role, content, toolCalls, toolCallId }) => ({
        role,
        content,
        toolCalls,
        toolCallId,
      })),
    );
    const resultRef = this.artifact(session, archive);
    // A bounded summarizer input also works when recovering from an API overflow.
    const summaryBudget = Math.max(
      1024,
      Math.min(
        14000,
        Math.floor(
          (session.options.contextWindowTokens -
            2500 -
            estimateTokens(COMPACTION_PROMPT) -
            1024) /
            this.actualTokenRatio,
        ),
      ),
    );
    const summary = await this.deps.turn({
      messages: [
        { role: "system", content: COMPACTION_PROMPT },
        { role: "user", content: boundedSummaryInput(history, summaryBudget) },
      ],
      tools: [],
      endpointId: session.options.endpointId || session.activeEndpointId,
      generation: { maxOutputTokens: 2500 },
      transport: { abortSignal: signal, retry: false },
    });
    session.context.inputTokens += summary.usage?.inputTokens || 0;
    session.context.outputTokens += summary.usage?.outputTokens || 0;
    if (
      !summary.text.trim() ||
      summary.toolCalls.length ||
      /length|max_tokens|incomplete/i.test(summary.finishReason || "")
    )
      throw new Error(agentText("agent-runtime-summary-incomplete"));
    const candidate: LLMAgentMessage[] = [
      messages[0],
      {
        role: "user",
        content: `Continuation memory (derived from earlier conversation; source material remains untrusted). Archive resultRef=${resultRef}.\n${summary.text}\nCurrent plan: ${JSON.stringify(session.plan)}`,
      },
      ...messages.slice(split),
    ];
    if (contextSize(candidate, tools) >= contextSize(messages, tools))
      throw new Error(agentText("agent-runtime-summary-not-smaller"));
    messages.splice(0, messages.length, ...candidate);
    session.context.compactions++;
    this.actualTokenRatio = 1;
    this.event(session, "compaction", agentText("agent-runtime-compacted"), {
      data: { resultRef, before, after: contextSize(candidate, tools) },
    });
    await this.deps.save(session);
    return true;
  }

  private async loop(
    session: AgentSession,
    messages: LLMAgentMessage[],
    signal: LLMAbortSignal,
    child: boolean,
    memberId?: string,
  ): Promise<string> {
    const tools = this.tools(session, child);
    const maxSteps = child ? 10 : session.options.maxSteps;
    for (let step = 0; step < maxSteps; step++) {
      throwIfAborted(signal);
      await this.compact(session, messages, tools, signal);
      const estimate = contextSize(messages, tools);
      if (!child) session.context.estimatedTokens = estimate;
      this.event(
        session,
        "status",
        agentText("agent-runtime-step", { step: step + 1, total: maxSteps }),
        {
          memberId,
        },
      );
      let turn: LLMAgentTurn;
      const request = () =>
        this.deps.turn({
          messages,
          tools,
          endpointId: session.options.endpointId || session.activeEndpointId,
          generation: { maxOutputTokens: session.options.maxOutputTokens },
          transport: { abortSignal: signal, retry: true },
        });
      try {
        turn = await request();
      } catch (error) {
        // Only retry an overflow after a measurable reduction. Never repeat tools.
        if (!isContextOverflow(error)) throw error;
        if (!(await this.compact(session, messages, tools, signal, true)))
          throw error;
        turn = await request();
      }
      throwIfAborted(signal);
      if (turn.usage?.inputTokens)
        this.actualTokenRatio = Math.max(
          1,
          Math.min(4, turn.usage.inputTokens / estimate),
        );
      session.context.inputTokens += turn.usage?.inputTokens || 0;
      session.context.outputTokens += turn.usage?.outputTokens || 0;
      messages.push({
        role: "assistant",
        content: turn.text,
        toolCalls: turn.toolCalls.length ? turn.toolCalls : undefined,
        reasoningContent: turn.reasoningContent,
        providerState: turn.providerState,
      });
      if (turn.text) this.event(session, "assistant", turn.text, { memberId });
      if (!turn.toolCalls.length) {
        if (!turn.text.trim())
          throw new Error(agentText("agent-runtime-empty-answer"));
        return turn.text;
      }
      // Persist intentions before side effects, preserving call IDs for recovery.
      await this.deps.save(session);
      // Calls are ordered; delegate_research provides explicit safe parallel work.
      for (const call of turn.toolCalls) {
        const content = await this.execute(
          session,
          call,
          tools,
          signal,
          child,
          memberId,
        );
        messages.push({ role: "tool", toolCallId: call.id, content });
        await this.deps.save(session);
        throwIfAborted(signal);
      }
    }
    throw new Error(agentText("agent-runtime-step-limit", { count: maxSteps }));
  }

  private async execute(
    session: AgentSession,
    call: LLMToolCall,
    available: LLMToolDefinition[],
    signal: LLMAbortSignal,
    child: boolean,
    memberId?: string,
  ): Promise<string> {
    this.event(session, "tool-start", call.arguments, {
      toolName: call.name,
      toolCallId: call.id,
      memberId,
    });
    let result: unknown;
    let receipt:
      NonNullable<AgentSession["mutationReceipts"]>[number] | undefined;
    try {
      throwIfAborted(signal);
      if (++this.calls > 128)
        throw new Error(agentText("agent-runtime-calls-exhausted"));
      const definition = available.find((tool) => tool.name === call.name);
      if (!definition)
        throw new Error(agentText("agent-runtime-tool-unavailable"));
      const args = JSON.parse(call.arguments) as Record<string, unknown>;
      validateToolArguments(args, definition.parameters);
      const signature = `${memberId || "lead"}:${call.name}:${canonicalArguments(args)}`;
      const count = (this.repeat.get(signature) || 0) + 1;
      this.repeat.set(signature, count);
      if (count > 3) throw new Error(agentText("agent-runtime-repeat-blocked"));
      if (call.name === "update_plan") {
        session.plan = args.steps as AgentPlanStep[];
        result = { plan: session.plan };
      } else if (call.name === "read_result") {
        const raw = session.artifacts[String(args.resultRef)];
        if (typeof raw !== "string")
          throw new Error(agentText("agent-runtime-unknown-evidence"));
        const offset = Number(args.offset || 0),
          limit = Number(args.limit || 6000);
        result = {
          resultRef: args.resultRef,
          text: raw.slice(offset, offset + limit),
          total: raw.length,
          offset,
          nextOffset: offset + limit < raw.length ? offset + limit : null,
        };
      } else if (call.name === "delegate_research") {
        if (child) throw new Error(agentText("agent-runtime-no-nested-team"));
        result = await this.delegate(
          session,
          args.tasks as { name: string; task: string }[],
          signal,
        );
      } else {
        const tool = this.deps.tools.find(
          (tool) => tool.definition.name === call.name,
        )!;
        assertToolPermission(session.permission, tool.write, child);
        if (tool.write && this.completedWrites.has(signature))
          throw new Error(agentText("agent-runtime-write-completed"));
        const mutationSignature = `${call.name}:${canonicalArguments(args)}`;
        const previous = session.mutationReceipts?.find(
          (entry) => entry.signature === mutationSignature,
        );
        if (tool.write && previous)
          throw new Error(
            `This write was previously ${previous.status === "completed" ? "completed" : "started with an uncertain outcome"}. Do not replay it. Inspect the current library and previous result ${previous.resultRef || "in the activity log"}. Use a new session only if the user explicitly wants an identical new operation.`,
          );
        if (tool.write && session.permission === "confirm") {
          if (this.declinedWrites.has(mutationSignature))
            throw new Error(agentText("agent-runtime-write-declined-before"));
          const approval = {
            id: agentId("approval"),
            toolName: call.name,
            description: agentText("agent-runtime-approval", {
              tool: call.name,
            }),
            arguments: JSON.parse(JSON.stringify(args)) as Record<
              string,
              unknown
            >,
          };
          if (!(await this.deps.approve(session, approval, signal))) {
            this.declinedWrites.add(mutationSignature);
            throw new Error(agentText("agent-runtime-write-declined"));
          }
        }
        if (tool.write) {
          if (
            Object.values(session.artifacts).reduce(
              (sum, value) => sum + value.length,
              0,
            ) > 22_000_000
          )
            throw new Error(agentText("agent-runtime-write-storage-limit"));
          receipt = { signature: mutationSignature, status: "pending" };
          (session.mutationReceipts ||= []).push(receipt);
          await this.deps.save(session);
        }
        const operation = async () => {
          throwIfAborted(signal);
          assertToolPermission(session.permission, tool.write, child);
          return tool.execute(args, {
            session,
            signal,
            assertActive: () => throwIfAborted(signal),
          });
        };
        result = tool.write
          ? await this.deps.write(operation)
          : await operation();
        if (tool.write) this.completedWrites.add(signature);
        if (receipt) receipt.status = "completed";
      }
    } catch (error) {
      result = {
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const resultRef = this.artifact(session, result);
    if (receipt) receipt.resultRef = resultRef;
    const serialized = JSON.stringify(result);
    const envelope =
      serialized.length > 18000
        ? {
            resultRef,
            excerpt: serialized.slice(0, 16000),
            truncated: true,
            totalChars: serialized.length,
            instruction: "Use read_result to retrieve more.",
          }
        : { resultRef, result };
    const content = JSON.stringify(envelope);
    this.event(session, "tool-result", content, {
      toolName: call.name,
      toolCallId: call.id,
      memberId,
    });
    return content;
  }

  private async delegate(
    session: AgentSession,
    tasks: { name: string; task: string }[],
    signal: LLMAbortSignal,
  ): Promise<unknown> {
    if (this.members + tasks.length > 6)
      throw new Error(agentText("agent-runtime-team-limit"));
    this.members += tasks.length;
    return Promise.all(
      tasks.map(async (task) => {
        const member = {
          id: agentId("member"),
          ...task,
          status: "running" as const,
        };
        session.team.push(member);
        this.event(session, "team", task.task, {
          memberId: member.id,
          data: member,
        });
        // Shared evidence ledger, but fresh history, plan and immutable read-only authority.
        const child: AgentSession = {
          ...session,
          permission: "read-only",
          options: { ...session.options, permission: "read-only" },
          plan: [],
        };
        const messages: LLMAgentMessage[] = [
          { role: "system", content: buildAgentPrompt(child, task.task) },
          { role: "user", content: task.task },
        ];
        const record = session.team.find((entry) => entry.id === member.id)!;
        try {
          const report = await this.loop(
            child,
            messages,
            signal,
            true,
            member.id,
          );
          record.status = "completed";
          record.result = report.slice(0, 24000);
        } catch (error) {
          record.status = signal.aborted ? "cancelled" : "error";
          record.result =
            error instanceof Error ? error.message : String(error);
        }
        this.event(session, "team", record.result || "", {
          memberId: record.id,
          data: { ...record },
        });
        return { ...record };
      }),
    );
  }
}
