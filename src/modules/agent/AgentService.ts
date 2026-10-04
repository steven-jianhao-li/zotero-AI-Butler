import { agentText } from "./messages";
import { LLMService } from "../llmService";
import {
  createChatAbortController,
  type ChatAbortControllerLike,
} from "../chatContext";
import type { LLMAbortSignal } from "../llmproviders/types";
import { AgentRunner } from "./AgentRunner";
import { AgentStore } from "./AgentStore";
import { closePendingToolCalls } from "./context";
import { createLibraryTools } from "./tools/libraryTools";
import {
  agentId,
  defaultAgentOptions,
  type AgentApproval,
  type AgentRunOptions,
  type AgentSession,
} from "./types";

/** Owns sessions and authority. Models can never modify run options or approvals. */
export class AgentService {
  private static instance: AgentService | undefined;
  private sessions = new Map<string, AgentSession>();
  private listeners = new Set<() => void>();
  private controllers = new Map<string, ChatAbortControllerLike>();
  private approvals = new Map<
    string,
    { sessionId: string; resolve(allow: boolean): void }
  >();
  private store = new AgentStore();
  private loading: Promise<void>;
  private writes: Promise<unknown> = Promise.resolve();

  private constructor() {
    this.loading = this.store.load().then((sessions) => {
      for (const session of sessions) this.sessions.set(session.id, session);
      this.changed();
    });
  }

  static getInstance(): AgentService {
    return (this.instance ||= new AgentService());
  }

  static shutdown(): void {
    if (!this.instance) return;
    for (const id of this.instance.controllers.keys()) this.instance.stop(id);
  }

  ready(): Promise<void> {
    return this.loading;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        ztoolkit.log("[AI-Butler Agent] View update failed", error);
      }
    }
  }

  getSessions(): AgentSession[] {
    return [...this.sessions.values()].sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
  }

  getSession(id: string): AgentSession | undefined {
    return this.sessions.get(id);
  }

  createSession(): AgentSession {
    const now = Date.now();
    const session: AgentSession = {
      id: agentId("session"),
      title: "",
      createdAt: now,
      updatedAt: now,
      status: "idle",
      permission: "read-only",
      options: defaultAgentOptions(Zotero.Libraries.userLibraryID),
      messages: [],
      events: [],
      plan: [],
      team: [],
      pendingApprovals: [],
      artifacts: {},
      context: {
        estimatedTokens: 0,
        compactions: 0,
        inputTokens: 0,
        outputTokens: 0,
      },
    };
    this.sessions.set(session.id, session);
    this.changed();
    return session;
  }

  async deleteSession(id: string): Promise<void> {
    if (this.controllers.has(id))
      throw new Error(agentText("agent-runtime-delete-running"));
    await this.store.remove(id);
    this.sessions.delete(id);
    this.changed();
  }

  async run(
    id: string,
    prompt: string,
    requested: Partial<AgentRunOptions> = {},
  ): Promise<void> {
    await this.ready();
    const session = this.sessions.get(id);
    if (!session) throw new Error(agentText("agent-runtime-missing-session"));
    if (this.controllers.has(id))
      throw new Error(agentText("agent-runtime-already-running"));
    if (!prompt.trim() || prompt.length > 60000)
      throw new Error(agentText("agent-runtime-prompt-length"));
    if (this.controllers.size >= 3)
      throw new Error(agentText("agent-runtime-session-concurrency"));
    const options = { ...session.options, ...requested };
    if (!["read-only", "confirm", "full"].includes(options.permission))
      throw new Error(agentText("agent-runtime-invalid-permission"));
    if (!["auto", "text", "pdf-base64", "mineru"].includes(options.pdfPolicy))
      throw new Error(agentText("agent-runtime-invalid-policy"));
    if (
      !Number.isSafeInteger(options.libraryID) ||
      !Zotero.Libraries.get(options.libraryID)
    )
      throw new Error(agentText("agent-runtime-invalid-library"));
    options.contextWindowTokens = clamp(
      options.contextWindowTokens,
      8192,
      1048576,
      262144,
    );
    options.maxOutputTokens = clamp(
      options.maxOutputTokens,
      1024,
      Math.min(32768, Math.floor(options.contextWindowTokens / 3)),
      8192,
    );
    options.maxSteps = clamp(options.maxSteps, 1, 64, 32);
    if (
      !Array.isArray(options.selectedItemIds) ||
      options.selectedItemIds.length > 100 ||
      options.selectedItemIds.some(
        (value) => !Number.isSafeInteger(value) || value <= 0,
      )
    )
      throw new Error(agentText("agent-runtime-invalid-selection"));
    // A session's evidence references cannot silently cross into a different library.
    if (
      session.messages.length &&
      options.libraryID !== session.options.libraryID
    )
      throw new Error(agentText("agent-runtime-library-change"));
    session.activeEndpointId =
      options.endpointId || LLMService.acquireChatSessionEndpoint().id;
    session.options = options;
    session.permission = options.permission;
    session.title ||= prompt.trim().slice(0, 70);
    session.updatedAt = Date.now();
    session.status = "running";
    closePendingToolCalls(session.messages, "Previous run was interrupted.");
    session.messages.push({ role: "user", content: prompt.trim() });
    session.events.push({
      id: agentId("event"),
      type: "user",
      text: prompt.trim(),
      createdAt: Date.now(),
    });
    const controller = createChatAbortController();
    this.controllers.set(id, controller);
    this.changed();
    const runner = new AgentRunner({
      turn: (request) => LLMService.agentTurn(request),
      tools: createLibraryTools(),
      // Teammates share this ledger, but cannot replace the parent's session state.
      save: () => this.store.save(session),
      changed: () => this.changed(),
      approve: (_session, approval, signal) =>
        this.requestApproval(session, approval, signal),
      write: (operation) => {
        const next = this.writes.catch(() => undefined).then(operation);
        this.writes = next;
        return next;
      },
    });
    try {
      await runner.run(session, controller.signal);
    } catch (error) {
      session.status = "error";
      session.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.controllers.delete(id);
      for (const [approvalId, pending] of this.approvals) {
        if (pending.sessionId === id) this.approve(id, approvalId, false);
      }
      this.changed();
    }
  }

  stop(id: string): void {
    this.controllers.get(id)?.abort(agentText("agent-runtime-cancelled"));
    for (const [approvalId, pending] of this.approvals) {
      if (pending.sessionId === id) this.approve(id, approvalId, false);
    }
  }

  approve(sessionId: string, approvalId: string, allow: boolean): void {
    const pending = this.approvals.get(approvalId);
    if (!pending || pending.sessionId !== sessionId) return;
    this.approvals.delete(approvalId);
    pending.resolve(allow);
  }

  private async requestApproval(
    session: AgentSession,
    approval: AgentApproval,
    signal: LLMAbortSignal,
  ): Promise<boolean> {
    if (signal.aborted) return false;
    session.pendingApprovals.push(approval);
    session.status = "waiting-approval";
    session.events.push({
      id: agentId("event"),
      type: "approval",
      text: approval.description,
      createdAt: Date.now(),
      toolName: approval.toolName,
      data: approval,
    });
    // Register before the view can expose the card, even while disk I/O is pending.
    const decision = new Promise<boolean>((resolve) => {
      const aborted = () => this.approve(session.id, approval.id, false);
      this.approvals.set(approval.id, {
        sessionId: session.id,
        resolve: (allow) => {
          signal.removeEventListener?.("abort", aborted);
          session.pendingApprovals = session.pendingApprovals.filter(
            (entry) => entry.id !== approval.id,
          );
          session.status = "running";
          session.events.push({
            id: agentId("event"),
            type: "status",
            text: agentText(
              allow ? "agent-runtime-approved" : "agent-runtime-declined",
              { tool: approval.toolName },
            ),
            createdAt: Date.now(),
            data: { approvalId: approval.id, allowed: allow },
          });
          this.changed();
          resolve(allow && !signal.aborted);
        },
      });
      signal.addEventListener?.("abort", aborted, { once: true });
      this.changed();
    });
    try {
      await this.store.save(session);
      return await decision;
    } catch (error) {
      this.approve(session.id, approval.id, false);
      throw error;
    }
  }
}

function clamp(
  value: number,
  min: number,
  max: number,
  fallback: number,
): number {
  return Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.floor(value)))
    : Math.max(min, Math.min(max, fallback));
}
