import { expect } from "chai";
import { agentTurns } from "../src/modules/views/agent/transcript";
import {
  agentTraceRecords,
  agentTraceSegments,
} from "../src/modules/views/agent/trajectory";
import {
  defaultAgentOptions,
  type AgentSession,
} from "../src/modules/agent/types";
import type { AgentEvent, AgentStatus } from "../src/modules/agent/types";

function event(
  id: string,
  type: AgentEvent["type"],
  extra: Partial<AgentEvent> = {},
): AgentEvent {
  return { id, type, text: id, createdAt: 1000, ...extra };
}
function project(events: AgentEvent[], status: AgentStatus = "completed") {
  return agentTurns({ events, status });
}

describe("Agent work and delivery projection", function () {
  it("groups model previews and tool results into searchable timed trace records", function () {
    const state: AgentSession = {
      id: "fixture",
      title: "",
      createdAt: 0,
      updatedAt: 0,
      status: "completed",
      permission: "read-only",
      options: defaultAgentOptions(),
      messages: [],
      plan: [],
      team: [],
      pendingApprovals: [],
      artifacts: { r1: "full result searchable" },
      context: {
        estimatedTokens: 0,
        compactions: 0,
        inputTokens: 0,
        outputTokens: 0,
      },
      events: [
        event("u", "user"),
        event("request", "status", {
          stepId: "s1",
          data: { kind: "model-request" },
          endedAt: 4000,
        }),
        event("reason", "reasoning", { stepId: "s1" }),
        event("reply", "assistant", { stepId: "s1" }),
        event("call", "tool-start", { toolCallId: "c1", createdAt: 4000 }),
        event("result", "tool-result", {
          toolCallId: "c1",
          createdAt: 5000,
          text: '{"resultRef":"r1"}',
        }),
      ],
    };
    const records = agentTraceRecords(state);
    expect(records.map((record) => record.kind)).to.deep.equal([
      "input",
      "model",
      "tool",
    ]);
    expect(records[1].events.map((event) => event.id)).to.deep.equal([
      "request",
      "reason",
      "reply",
    ]);
    expect(records[2].searchText).to.include("full result searchable");
    expect(records[2].endedAt).to.equal(5000);
    const equal = agentTraceSegments(records, false, 6000);
    expect(equal[0].width).to.equal(equal[1].width);
    const timed = agentTraceSegments(records, true, 6000);
    expect(timed[1].width).to.be.greaterThan(timed[2].width);
    expect(timed.reduce((sum, part) => sum + part.width, 0)).to.be.closeTo(
      100,
      0.001,
    );
  });

  it("separates reasoning, intermediate replies, teammates and tools from the final delivery", function () {
    const [turn] = project([
      event("user", "user"),
      event("think", "reasoning"),
      event("progress", "assistant", { phase: "work" }),
      event("start", "tool-start"),
      event("child", "assistant", { memberId: "reader", phase: "work" }),
      event("result", "tool-result"),
      event("final", "assistant", { phase: "delivery" }),
      event("end", "status", { runStatus: "completed", createdAt: 66000 }),
    ]);
    expect(turn.delivery?.id).to.equal("final");
    expect(turn.work.map((entry) => entry.id)).to.deep.equal([
      "think",
      "progress",
      "start",
      "child",
      "result",
    ]);
    expect(turn.toolCount).to.equal(1);
    expect(turn.elapsed).to.equal(65000);
  });

  it("retains each round's outcome when a new run starts", function () {
    const turns = project(
      [
        event("u1", "user"),
        event("error", "error"),
        event("e1", "status", { runStatus: "error" }),
        event("u2", "user"),
        event("a2", "assistant", { phase: "delivery" }),
        event("e2", "status", { runStatus: "completed" }),
        event("u3", "user"),
        event("s3", "status"),
      ],
      "running",
    );
    expect(turns.map((turn) => turn.status)).to.deep.equal([
      "error",
      "completed",
      "running",
    ]);
    expect(turns[0].errors[0].id).to.equal("error");
    expect(turns[2].delivery).to.equal(undefined);
    expect(
      project([event("end", "status", { runStatus: "completed" })], "error")[0]
        .status,
    ).to.equal("error");
  });

  it("recovers old completed answers but never promotes interrupted work or team reports", function () {
    const old = [
      event("u", "user"),
      event("progress", "assistant"),
      event("tool", "tool-start"),
      event("result", "tool-result"),
    ];
    expect(
      project([...old, event("answer", "assistant")])[0].delivery?.id,
    ).to.equal("answer");
    expect(project(old, "cancelled")[0].delivery).to.equal(undefined);
    expect(
      project([...old, event("team", "assistant", { memberId: "reader" })])[0]
        .delivery,
    ).to.equal(undefined);
    expect(
      project([
        event("u", "user"),
        event("progress", "assistant", { phase: "work" }),
      ])[0].delivery,
    ).to.equal(undefined);
    expect(
      project(
        [event("u", "user"), event("progress", "assistant")],
        "running",
      )[0].delivery,
    ).to.equal(undefined);
  });
});
