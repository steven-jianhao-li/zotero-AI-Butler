import { expect } from "chai";
import {
  AgentRunner,
  type AgentRunnerDependencies,
} from "../src/modules/agent/AgentRunner";
import { AgentStore } from "../src/modules/agent/AgentStore";
import { AgentService } from "../src/modules/agent/AgentService";
import { contextSize } from "../src/modules/agent/context";
import { agentText } from "../src/modules/agent/messages";
import {
  defaultAgentOptions,
  type AgentPermission,
  type AgentSession,
} from "../src/modules/agent/types";
import type { AgentTool } from "../src/modules/agent/tools/types";
import type {
  LLMAgentMessage,
  LLMAgentTurn,
  LLMToolCall,
} from "../src/modules/llmproviders/agentTypes";
import { validateAgentMessages } from "../src/modules/llmproviders/shared/agentTransport";

function session(permission: AgentPermission = "read-only"): AgentSession {
  return {
    id: "session-test-123",
    title: "Research",
    createdAt: 1,
    updatedAt: 1,
    status: "idle",
    permission,
    options: { ...defaultAgentOptions(), permission },
    messages: [
      { role: "system", content: "Research." },
      { role: "user", content: "Find evidence for my question." },
    ],
    events: [],
    artifacts: {},
    plan: [],
    team: [],
    pendingApprovals: [],
    context: {
      estimatedTokens: 0,
      compactions: 0,
      inputTokens: 0,
      outputTokens: 0,
    },
  };
}

function tool(
  name: string,
  write: boolean,
  execute: AgentTool["execute"],
): AgentTool {
  return {
    definition: {
      name,
      description: name,
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: [],
        additionalProperties: false,
      },
    },
    write,
    execute,
  };
}

function call(
  name: string,
  id: string,
  args: Record<string, unknown> = {},
): LLMToolCall {
  return { name, id, arguments: JSON.stringify(args) };
}

function turn(...calls: LLMToolCall[]): LLMAgentTurn {
  return { text: calls.length ? "" : "Research complete.", toolCalls: calls };
}

function dependencies(
  overrides: Partial<AgentRunnerDependencies> = {},
): AgentRunnerDependencies {
  return {
    turn: async () => turn(),
    tools: [],
    save: async () => {},
    changed: () => {},
    approve: async () => false,
    write: (operation) => operation(),
    ...overrides,
  };
}

describe("Agent runtime authority and recovery", function () {
  it("accepts an approval during slow persistence without executing before the save completes", async function () {
    const state = session("confirm");
    const service = Object.create(AgentService.prototype) as AgentService;
    let finishSave = () => {};
    const saving = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    const internal = service as unknown as {
      approvals: Map<string, unknown>;
      listeners: Set<() => void>;
      store: { save(): Promise<void> };
      requestApproval(
        session: AgentSession,
        approval: AgentSession["pendingApprovals"][number],
        signal: AbortSignal,
      ): Promise<boolean>;
    };
    internal.approvals = new Map();
    internal.listeners = new Set();
    internal.store = { save: () => saving };
    const approval = {
      id: "approval-slow",
      toolName: "create_note",
      description: "Create a note",
      arguments: { itemId: 1 },
    };
    const pending = internal.requestApproval(
      state,
      approval,
      new AbortController().signal,
    );
    service.approve(state.id, approval.id, true);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).to.equal(false);
    expect(state.pendingApprovals).to.deep.equal([]);
    finishSave();
    expect(await pending).to.equal(true);
  });

  it("recovers the tail of an oversized paper report through its evidence reference", async function () {
    const state = session();
    const evidence = "Evidence detail. ".repeat(1800) + "TAIL-VERIFIED-8197";
    let step = 0;
    await new AgentRunner(
      dependencies({
        tools: [tool("read_paper", false, async () => ({ evidence }))],
        turn: async (request) => {
          step++;
          if (step === 1) return turn(call("read_paper", "read-paper"));
          if (step === 2) {
            const envelope = JSON.parse(request.messages.at(-1)!.content);
            expect(envelope.truncated).to.equal(true);
            expect(envelope.excerpt).not.to.include("TAIL-VERIFIED-8197");
            return turn(
              call("read_result", "read-tail", {
                resultRef: envelope.resultRef,
                offset: state.artifacts[envelope.resultRef].length - 200,
                limit: 200,
              }),
            );
          }
          expect(request.messages.at(-1)!.content).to.include(
            "TAIL-VERIFIED-8197",
          );
          return turn();
        },
      }),
    ).run(state, new AbortController().signal);
    expect(state.status).to.equal("completed");
    expect(() => validateAgentMessages(state.messages)).not.to.throw();
  });

  it("retains a first user question when installing the system prompt", async function () {
    const state = session();
    state.messages.shift();
    let seen: LLMAgentMessage[] = [];
    await new AgentRunner(
      dependencies({
        turn: async (request) => {
          seen = JSON.parse(JSON.stringify(request.messages));
          return turn();
        },
      }),
    ).run(state, new AbortController().signal);
    expect(seen[0].role).to.equal("system");
    expect(seen[1]).to.deep.equal({
      role: "user",
      content: "Find evidence for my question.",
    });
    expect(state.status).to.equal("completed");
  });

  it("blocks a fabricated write even when a model bypasses the advertised read-only catalog", async function () {
    const state = session();
    let writes = 0,
      requests = 0,
      approvals = 0;
    const runner = new AgentRunner(
      dependencies({
        tools: [
          tool("create_note", true, async () => {
            writes++;
            return { saved: true };
          }),
        ],
        approve: async () => {
          approvals++;
          return true;
        },
        turn: async (request) => {
          expect(
            request.tools.some(
              (definition) => definition.name === "create_note",
            ),
          ).to.equal(false);
          return requests++ === 0
            ? turn(call("create_note", "write-1"))
            : turn();
        },
      }),
    );
    await runner.run(state, new AbortController().signal);
    expect(writes).to.equal(0);
    expect(approvals).to.equal(0);
    expect(
      state.messages.find((message) => message.role === "tool")?.content,
    ).to.include(agentText("agent-runtime-tool-unavailable"));
    expect(() => validateAgentMessages(state.messages)).not.to.throw();
  });

  it("binds confirmation to validated exact arguments and never writes after a denial", async function () {
    const state = session("confirm");
    let writes = 0,
      requests = 0;
    const approvals: Record<string, unknown>[] = [];
    const runner = new AgentRunner(
      dependencies({
        tools: [
          tool("create_note", true, async () => {
            writes++;
            return { saved: true };
          }),
        ],
        approve: async (_state, approval) => {
          approvals.push(approval.arguments);
          return false;
        },
        turn: async () =>
          requests++ === 0
            ? turn(call("create_note", "write-1", { text: "Exact note" }))
            : turn(),
      }),
    );
    await runner.run(state, new AbortController().signal);
    expect(approvals).to.deep.equal([{ text: "Exact note" }]);
    expect(writes).to.equal(0);
    expect(
      state.messages.find((message) => message.role === "tool")?.content,
    ).to.include(agentText("agent-runtime-write-declined"));
  });

  it("asks once for an identical declined write per run and allows a later explicit follow-up", async function () {
    const state = session("confirm");
    let writes = 0,
      requests = 0,
      approvals = 0;
    const tools = [
      tool("create_note", true, async () => {
        writes++;
        return { saved: true };
      }),
    ];
    await new AgentRunner(
      dependencies({
        tools,
        approve: async () => {
          approvals++;
          return false;
        },
        turn: async () =>
          requests++ < 2
            ? turn(call("create_note", `denied-${requests}`, { text: "Note" }))
            : turn(),
      }),
    ).run(state, new AbortController().signal);
    expect(approvals).to.equal(1);
    expect(writes).to.equal(0);
    expect(state.mutationReceipts || []).to.deep.equal([]);
    expect(() => validateAgentMessages(state.messages)).not.to.throw();

    state.messages.push({
      role: "user",
      content: "Please save that note now.",
    });
    requests = 0;
    await new AgentRunner(
      dependencies({
        tools,
        approve: async () => {
          approvals++;
          return true;
        },
        turn: async () =>
          requests++ === 0
            ? turn(call("create_note", "approved-followup", { text: "Note" }))
            : turn(),
      }),
    ).run(state, new AbortController().signal);
    expect(approvals).to.equal(2);
    expect(writes).to.equal(1);
    expect(state.status).to.equal("completed");
  });

  it("rechecks cancellation after approval before any queued write executes", async function () {
    const state = session("confirm");
    const controller = new AbortController();
    let writes = 0;
    const runner = new AgentRunner(
      dependencies({
        tools: [
          tool("create_note", true, async () => {
            writes++;
            return { saved: true };
          }),
        ],
        approve: async () => {
          controller.abort("Cancelled during approval");
          return true;
        },
        turn: async () =>
          turn(
            call("create_note", "write-1"),
            call("create_note", "write-2", { text: "Second" }),
          ),
      }),
    );
    await runner.run(state, controller.signal);
    expect(writes).to.equal(0);
    expect(state.status).to.equal("cancelled");
    expect(state.pendingApprovals).to.deep.equal([]);
    expect(() => validateAgentMessages(state.messages)).not.to.throw();
    expect(
      state.messages
        .filter((message) => message.role === "tool")
        .map((message) => message.toolCallId),
    ).to.deep.equal(["write-1", "write-2"]);
  });

  it("persists intentions before writes and completed receipts before surfacing cancellation", async function () {
    const state = session("full");
    const controller = new AbortController();
    const saved: AgentSession[] = [];
    let writes = 0;
    const tools = [
      tool("create_note", true, async () => {
        expect(saved.at(-1)?.messages.at(-1)?.toolCalls?.[0].id).to.equal(
          "write-1",
        );
        writes++;
        controller.abort("Stopped after commit");
        return { saved: true, noteID: 101 };
      }),
    ];
    await new AgentRunner(
      dependencies({
        tools,
        save: async (current) => {
          saved.push(JSON.parse(JSON.stringify(current)));
        },
        turn: async () =>
          turn(
            call("create_note", "write-1", { text: "Evidence" }),
            call("create_note", "write-2", { text: "Other" }),
          ),
      }),
    ).run(state, controller.signal);
    expect(writes).to.equal(1);
    expect(state.status).to.equal("cancelled");
    expect(
      state.messages.find((message) => message.toolCallId === "write-1")
        ?.content,
    ).to.include('"noteID":101');
    expect(
      state.messages.find((message) => message.toolCallId === "write-2")
        ?.content,
    ).to.include("interrupted");
    expect(() => validateAgentMessages(saved.at(-1)!.messages)).not.to.throw();
  });

  it("does not replay a completed mutation when continuation asks again with a new call ID", async function () {
    const state = session("full");
    const controller = new AbortController();
    let writes = 0;
    const tools = [
      tool("create_note", true, async () => {
        writes++;
        controller.abort("Stopped after commit");
        return { saved: true, noteID: 101 };
      }),
    ];
    await new AgentRunner(
      dependencies({
        tools,
        turn: async () =>
          turn(call("create_note", "write-1", { text: "Evidence" })),
      }),
    ).run(state, controller.signal);
    // A new process recovers only serialized state, never Runner instance fields.
    const recovered = JSON.parse(JSON.stringify(state)) as AgentSession;
    expect(recovered.mutationReceipts?.[0].status).to.equal("completed");
    const resultRef = recovered.mutationReceipts?.[0].resultRef;
    expect(resultRef && recovered.artifacts[resultRef]).to.include(
      '"noteID":101',
    );
    recovered.messages.push({
      role: "user",
      content: "Continue the interrupted research.",
    });
    let requests = 0;
    await new AgentRunner(
      dependencies({
        tools,
        turn: async () =>
          requests++ === 0
            ? turn(call("create_note", "write-retry", { text: "Evidence" }))
            : turn(),
      }),
    ).run(recovered, new AbortController().signal);
    expect(writes).to.equal(1);
    expect(recovered.status).to.equal("completed");
    expect(() => validateAgentMessages(recovered.messages)).not.to.throw();
  });

  it("never replays a write with an uncertain crash receipt even when permission is elevated", async function () {
    const state = session("confirm");
    state.mutationReceipts = [
      { signature: 'create_note:{"text":"Evidence"}', status: "pending" },
    ];
    let writes = 0,
      requests = 0,
      approvals = 0;
    await new AgentRunner(
      dependencies({
        tools: [
          tool("create_note", true, async () => {
            writes++;
            return { saved: true };
          }),
        ],
        approve: async () => {
          approvals++;
          return true;
        },
        turn: async () =>
          requests++ === 0
            ? turn(
                call("create_note", "retry-after-crash", { text: "Evidence" }),
              )
            : turn(),
      }),
    ).run(state, new AbortController().signal);
    expect(writes).to.equal(0);
    expect(approvals).to.equal(0);
    expect(
      state.messages.find((message) => message.role === "tool")?.content,
    ).to.include("uncertain outcome");
    expect(() => validateAgentMessages(state.messages)).not.to.throw();
  });

  it("runs independent teammates concurrently with fresh histories and read-only authority", async function () {
    const state = session("full");
    state.messages[1].content = "LEAD_HISTORY_SECRET";
    let leadRequests = 0,
      active = 0,
      peak = 0,
      writes = 0;
    const childSteps = new Map<string, number>();
    let release!: () => void;
    const bothStarted = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runner = new AgentRunner(
      dependencies({
        tools: [
          tool("create_note", true, async () => {
            writes++;
            return { saved: true };
          }),
        ],
        turn: async (request) => {
          const task =
            request.messages.find((message) => message.role === "user")
              ?.content || "";
          if (!/^Check [AB]$/.test(task)) {
            return leadRequests++ === 0
              ? turn(
                  call("delegate_research", "team-1", {
                    tasks: [
                      { name: "A", task: "Check A" },
                      { name: "B", task: "Check B" },
                    ],
                  }),
                )
              : turn();
          }
          const step = childSteps.get(task) || 0;
          childSteps.set(task, step + 1);
          expect(
            request.tools.some((definition) =>
              ["create_note", "delegate_research", "update_plan"].includes(
                definition.name,
              ),
            ),
          ).to.equal(false);
          expect(request.messages[0].content).to.include("Authority=read-only");
          expect(JSON.stringify(request.messages)).not.to.include(
            "LEAD_HISTORY_SECRET",
          );
          if (step === 0) {
            expect(request.messages).to.have.length(2);
            active++;
            peak = Math.max(peak, active);
            if (active === 2) release();
            await bothStarted;
            active--;
            return turn(call("create_note", `${task}-write`));
          }
          return turn();
        },
      }),
    );
    await runner.run(state, new AbortController().signal);
    expect(peak).to.equal(2);
    expect(writes).to.equal(0);
    expect(state.team.map((member) => member.status)).to.deep.equal([
      "completed",
      "completed",
    ]);
    expect(state.permission).to.equal("full");
  });

  it("compacts only complete older exchanges and retains a recoverable archive", async function () {
    const state = session();
    state.options.contextWindowTokens = 16384;
    state.options.maxOutputTokens = 2048;
    for (let i = 0; i < 15; i++)
      state.messages.push(
        {
          role: "assistant",
          content: `Evidence ${i}: ${"long evidence ".repeat(250)}`,
          toolCalls: [call("read_note", `read-${i}`)],
        },
        { role: "tool", toolCallId: `read-${i}`, content: `Result ${i}` },
      );
    state.messages.push({
      role: "user",
      content: "Give the final comparison.",
    });
    let summaries = 0;
    const runner = new AgentRunner(
      dependencies({
        turn: async (request) => {
          expect(() => validateAgentMessages(request.messages)).not.to.throw();
          if (!request.tools.length) {
            summaries++;
            expect(
              contextSize(request.messages, []) +
                (request.generation?.maxOutputTokens || 0),
            ).to.be.lessThan(state.options.contextWindowTokens);
            return {
              text: "Earlier evidence: results 0–10. Goal: compare papers. No writes performed.",
              toolCalls: [],
              usage: { inputTokens: 2000, outputTokens: 300 },
            };
          }
          expect(request.messages[1].content).to.include("Archive resultRef=");
          return turn();
        },
      }),
    );
    await runner.run(state, new AbortController().signal);
    expect(state.status).to.equal("completed");
    expect(summaries).to.equal(1);
    expect(state.context.compactions).to.equal(1);
    expect(state.context.inputTokens).to.equal(2000);
    expect(state.context.outputTokens).to.equal(300);
    expect(
      Object.values(state.artifacts).some((value) => value.includes("read-0")),
    ).to.equal(true);
    expect(() => validateAgentMessages(state.messages)).not.to.throw();
  });

  it("retains original exchanges when the summarizer returns an incomplete answer", async function () {
    const state = session();
    state.options.contextWindowTokens = 16384;
    state.options.maxOutputTokens = 2048;
    for (let i = 0; i < 15; i++)
      state.messages.push({
        role: "assistant",
        content: `Evidence ${i}: ${"full original evidence ".repeat(250)}`,
        providerState: {
          providerId: "openai",
          parts: [
            { type: "reasoning", encrypted_content: "opaque-private-state" },
          ],
        },
      });
    const original = JSON.parse(JSON.stringify(state.messages.slice(1)));
    await new AgentRunner(
      dependencies({
        turn: async (request) => {
          expect(request.tools).to.deep.equal([]);
          return {
            text: "Truncated memory",
            toolCalls: [],
            finishReason: "length",
          };
        },
      }),
    ).run(state, new AbortController().signal);
    expect(state.status).to.equal("error");
    expect(state.error).to.equal(agentText("agent-runtime-summary-incomplete"));
    expect(state.messages.slice(1)).to.deep.equal(original);
    expect(state.context.compactions).to.equal(0);
    const archive = Object.values(state.artifacts).join("");
    expect(archive).to.include("full original evidence");
    expect(archive).not.to.include("opaque-private-state");
  });

  it("resets authority and pending approvals and balances interrupted calls after restart", async function () {
    const globals = globalThis as unknown as Record<string, unknown>;
    const previous = Object.fromEntries(
      ["Zotero", "PathUtils", "IOUtils", "ztoolkit"].map((key) => [
        key,
        globals[key],
      ]),
    );
    const state = session("full");
    state.status = "waiting-approval";
    state.pendingApprovals = [
      {
        id: "approval-old",
        toolName: "create_note",
        description: "Old",
        arguments: {},
      },
    ];
    state.messages.push({
      role: "assistant",
      content: "",
      toolCalls: [call("create_note", "interrupted-1")],
    });
    state.team.push({
      id: "member-old",
      name: "A",
      task: "Read",
      status: "running",
    });
    const writes: string[] = [];
    globals.Zotero = { DataDirectory: { dir: "/test" } };
    globals.PathUtils = {
      join: (...parts: string[]) => parts.join("/"),
      filename: (path: string) => path.split("/").at(-1),
    };
    globals.IOUtils = {
      exists: async () => true,
      getChildren: async () => ["/test/ai-butler-agent/session-test-123.json"],
      readUTF8: async () => JSON.stringify({ version: 1, session: state }),
      makeDirectory: async () => {},
      writeUTF8: async (_path: string, snapshot: string) => {
        writes.push(snapshot);
      },
    };
    globals.ztoolkit = { log: () => {} };
    try {
      const store = new AgentStore();
      const [loaded] = await store.load();
      expect(loaded.permission).to.equal("read-only");
      expect(loaded.options.permission).to.equal("read-only");
      expect(loaded.status).to.equal("cancelled");
      expect(loaded.team[0].status).to.equal("cancelled");
      expect(loaded.pendingApprovals).to.deep.equal([]);
      expect(() => validateAgentMessages(loaded.messages)).not.to.throw();
      const saving = store.save(loaded);
      loaded.title = "Changed after snapshot";
      await saving;
      expect(JSON.parse(writes[0]).session.title).to.equal("Research");
      expect(() => store.save({ ...loaded, id: "../../escape" })).to.throw(
        agentText("agent-runtime-invalid-session-id"),
      );
    } finally {
      for (const key of Object.keys(previous)) {
        if (previous[key] === undefined) delete globals[key];
        else globals[key] = previous[key];
      }
    }
  });
});
