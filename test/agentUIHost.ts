import { AgentTimeline } from "../src/modules/views/agent/AgentTimeline";
import { agentStorageInfo } from "../src/modules/views/agent/AgentStorageInfo";
import { agentLogo } from "../src/modules/views/agent/icons";
import { AgentStore } from "../src/modules/agent/AgentStore";
import {
  defaultAgentOptions,
  type AgentEvent,
  type AgentSession,
} from "../src/modules/agent/types";

/** Real Gecko DOM checks, run only inside the isolated compatibility profile. */
export async function runAgentUIHostChecks(
  doc: Document,
  assert: (value: boolean, name: string) => void,
): Promise<void> {
  const element = (className: string) => {
    const node = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    ) as HTMLDivElement;
    node.className = className;
    return node;
  };
  const frame = () =>
    new Promise<void>((resolve) => doc.defaultView!.setTimeout(resolve, 30));
  const root = element("agent-view");
  root.style.cssText =
    "position:fixed;inset:0;z-index:10000;display:flex;flex-direction:column;width:900px;height:650px;padding:24px";
  const host = element("agent-timeline");
  root.append(host);
  doc.documentElement.append(root);
  const timeline = new AgentTimeline(host);
  const event = (
    id: string,
    type: AgentEvent["type"],
    extra: Partial<AgentEvent> = {},
  ): AgentEvent => ({ id, type, text: id, createdAt: 1000, ...extra });
  const state: AgentSession = {
    id: "session-ui-fixture",
    title: "Fixture",
    createdAt: 1000,
    updatedAt: 1000,
    status: "running",
    permission: "confirm",
    options: defaultAgentOptions(),
    messages: [],
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
    events: [
      event("u1", "user"),
      event("think", "reasoning", { text: "Compare **titles**." }),
      event("progress", "assistant", {
        text: "Checking the papers.",
        phase: "work",
      }),
      event("call", "tool-start", {
        toolCallId: "call-1",
        toolName: "search_library",
        text: '{"query":"fixture"}',
      }),
    ],
  };
  const decisions: string[] = [];
  const render = () =>
    timeline.render(state, (id, allow) => decisions.push(`${id}:${allow}`));
  const openDirectory = AgentStore.openDirectory;
  try {
    render();
    const work = host.querySelector<HTMLDetailsElement>(".agent-work")!;
    const thinking = host.querySelector<HTMLDetailsElement>(
      ".agent-event--reasoning",
    )!;
    const tool = host.querySelector<HTMLDetailsElement>(
      ".agent-event--tool-start",
    )!;
    assert(work.open && !thinking.open, "agentRunningWorkVisible");
    thinking.querySelector<HTMLElement>("summary")!.click();
    tool.querySelector<HTMLElement>("summary")!.click();
    await frame();
    state.artifacts.result1 =
      '{"papers":["fixture"],"fullEvidence":"complete result"}';
    state.events.push(
      event("result", "tool-result", {
        toolCallId: "call-1",
        text: '{"resultRef":"result1","truncated":true}',
      }),
    );
    render();
    assert(
      tool.open &&
        thinking.open &&
        tool.textContent!.includes("complete result"),
      "agentToolResultPreservesDisclosure",
    );
    assert(
      host.querySelectorAll(".agent-event--tool-start").length === 1 &&
        !host.querySelector(".agent-event--tool-result"),
      "agentToolCallAndResultPaired",
    );
    state.events.push(
      event("final", "assistant", {
        text: "Final **answer**.",
        phase: "delivery",
      }),
      event("end", "status", { runStatus: "completed", createdAt: 66000 }),
    );
    state.status = "completed";
    render();
    assert(
      !work.open && !!host.querySelector(".agent-delivery strong"),
      "agentCompletedDeliveryOutsideFold",
    );
    work.querySelector<HTMLElement>("summary")!.click();
    await frame();
    render();
    assert(work.open && thinking.open, "agentManualExpansionSurvivesRefresh");
    work.open = false;
    timeline.setMode("activity");
    assert(work.open, "agentActivityExpandsWork");
    timeline.setMode("conversation");
    assert(!work.open, "agentConversationRestoresFold");
    timeline.clear();
    render();
    assert(
      !host.querySelector<HTMLDetailsElement>(".agent-work")!.open,
      "agentReloadKeepsDeliveryDefault",
    );
    state.status = "waiting-approval";
    const approval = {
      id: "approve-fixture",
      toolName: "create_note",
      description: "Create a fixture note",
      arguments: { itemId: 101 },
    };
    state.pendingApprovals = [approval];
    state.events.push(
      event("u2", "user"),
      event("approve", "approval", { data: approval }),
    );
    render();
    const turns = host.querySelectorAll(".agent-turn");
    const secondWork =
      turns[1].querySelector<HTMLDetailsElement>(".agent-work")!;
    secondWork.open = false;
    const card = turns[1].querySelector<HTMLElement>(".agent-approval-card")!;
    assert(!secondWork.contains(card), "agentApprovalOutsideCollapsedWork");
    card.querySelector<HTMLButtonElement>(".agent-primary")!.click();
    assert(
      decisions[0] === "approve-fixture:true",
      "agentInlineApprovalAction",
    );
    state.pendingApprovals = [];
    state.status = "error";
    state.events.push(
      event("approved", "status", {
        text: "Approved: create_note",
        data: { approvalId: approval.id, allowed: true },
      }),
      event("failed", "error", { text: "Fixture failure" }),
    );
    render();
    assert(
      !host.querySelector(".agent-approval-card") &&
        !!turns[1].querySelector(".agent-turn-errors .agent-event--error"),
      "agentApprovalHistoryAndErrorsRetained",
    );
    assert(
      !host.querySelector(".agent-delivery .agent-event--reasoning"),
      "agentThinkingExcludedFromDelivery",
    );
    const logo = agentLogo(doc);
    logo.style.cssText = "width:32px;height:32px";
    root.prepend(logo);
    await logo.decode();
    assert(
      logo.naturalWidth > 0 && logo.src.endsWith("/icons/logo.svg"),
      "agentBrandedLogoLoads",
    );
    const storage = agentStorageInfo(doc, (error) => {
      throw error;
    });
    const rail = element("agent-rail-footer");
    rail.style.cssText = "margin-top:auto;position:relative";
    rail.append(storage);
    root.append(rail);
    storage.querySelector<HTMLElement>("summary")!.click();
    await frame();
    assert(
      storage.querySelector("code")!.textContent === AgentStore.directory(),
      "agentStorageShowsActualPath",
    );
    let opened = false;
    AgentStore.openDirectory = async () => {
      opened = true;
    };
    storage.querySelector<HTMLButtonElement>("button")!.click();
    await frame();
    assert(opened, "agentStorageOpenButton");
    const panel = storage
      .querySelector<HTMLElement>(".agent-storage-panel")!
      .getBoundingClientRect();
    assert(
      panel.width > 0 &&
        panel.top >= 0 &&
        panel.right <= doc.defaultView!.innerWidth,
      "agentStoragePanelFitsWindow",
    );
  } finally {
    AgentStore.openDirectory = openDirectory;
    root.remove();
  }
}
