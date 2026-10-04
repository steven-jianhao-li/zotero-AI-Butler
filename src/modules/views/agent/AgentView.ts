import { BaseView } from "../BaseView";
import { AgentService } from "../../agent/AgentService";
import {
  defaultAgentOptions,
  type AgentRunOptions,
  type AgentSession,
} from "../../agent/types";
import { LLMEndpointManager } from "../../llmEndpointManager";
import { AgentTimeline } from "./AgentTimeline";
import { button, documentOf, element, select, t } from "./dom";
import type { FluentMessageId } from "../../../../typings/i10n";

type SessionDraft = {
  prompt: string;
  options: AgentRunOptions;
};

/** Session workspace: durable conversations, explicit capabilities and evidence. */
export class AgentView extends BaseView {
  private service = AgentService.getInstance();
  private activeId = "";
  private displayedSessionId = "";
  private drafts = new Map<string, SessionDraft>();
  private unsubscribe?: () => void;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private mountVersion = 0;
  private sessionsHost!: HTMLElement;
  private titleHost!: HTMLElement;
  private statusHost!: HTMLElement;
  private welcome!: HTMLElement;
  private timelineHost!: HTMLElement;
  private timeline!: AgentTimeline;
  private approvalHost!: HTMLElement;
  private inspector!: HTMLElement;
  private attachmentHost!: HTMLElement;
  private errorHost!: HTMLElement;
  private composer!: HTMLTextAreaElement;
  private sendButton!: HTMLButtonElement;
  private stopButton!: HTMLButtonElement;
  private attachButton!: HTMLButtonElement;
  private permission!: HTMLSelectElement;
  private permissionHelp!: HTMLElement;
  private endpoint!: HTMLSelectElement;
  private deepReadEndpoint!: HTMLSelectElement;
  private pdfPolicy!: HTMLSelectElement;
  private contextWindow!: HTMLInputElement;
  private outputTokens!: HTMLInputElement;
  private maxSteps!: HTMLInputElement;
  private contextLabel!: HTMLElement;
  private approvalSignature = "";
  private inspectorSignature = "";

  constructor() {
    super("agent-view");
  }

  protected renderContent(): HTMLElement {
    const doc = Zotero.getMainWindow().document;
    const root = element(doc, "div", "agent-view");
    root.id = this.viewId;
    const layout = element(doc, "div", "agent-layout");

    const rail = element(doc, "aside", "agent-rail");
    rail.setAttribute("aria-label", t("agent-sessions"));
    const railHeader = element(doc, "div", "agent-rail-header");
    railHeader.append(
      element(doc, "span", "agent-brand-mark", "✦"),
      element(doc, "strong", "agent-brand", t("agent-brand")),
    );
    rail.append(
      railHeader,
      button(
        doc,
        t("agent-new-session"),
        () => this.newSession(),
        "agent-button agent-new-session",
      ),
      element(doc, "div", "agent-section-label", t("agent-sessions")),
    );
    this.sessionsHost = element(doc, "div", "agent-sessions");
    rail.append(
      this.sessionsHost,
      element(doc, "p", "agent-rail-footer", t("agent-session-storage")),
    );

    const center = element(doc, "main", "agent-center");
    const header = element(doc, "header", "agent-header");
    const railToggle = button(
      doc,
      "☰",
      () => {
        const collapsed = layout.classList.toggle("agent-rail-collapsed");
        railToggle.setAttribute("aria-expanded", String(!collapsed));
      },
      "agent-icon-button",
    );
    railToggle.title = t("agent-toggle-sessions");
    railToggle.setAttribute("aria-label", railToggle.title);
    railToggle.setAttribute("aria-expanded", "true");
    this.titleHost = element(
      doc,
      "h2",
      "agent-session-title",
      t("agent-new-title"),
    );
    this.statusHost = element(
      doc,
      "span",
      "agent-status",
      t("agent-status-idle"),
    );
    this.statusHost.setAttribute("role", "status");
    const inspectorToggle = button(
      doc,
      t("agent-inspector"),
      () => {
        const expanded = layout.classList.toggle("agent-inspector-open");
        inspectorToggle.setAttribute("aria-expanded", String(expanded));
      },
      "agent-button agent-inspector-toggle",
    );
    inspectorToggle.setAttribute("aria-expanded", "false");
    header.append(railToggle, this.titleHost, this.statusHost, inspectorToggle);

    const conversation = element(doc, "div", "agent-conversation");
    this.welcome = this.renderWelcome(doc);
    this.timelineHost = element(doc, "div", "agent-timeline");
    this.timelineHost.setAttribute("role", "log");
    this.timelineHost.setAttribute("aria-label", t("agent-conversation"));
    this.timelineHost.setAttribute("aria-live", "polite");
    this.timelineHost.setAttribute("aria-relevant", "additions");
    this.timeline = new AgentTimeline(this.timelineHost);
    conversation.append(this.welcome, this.timelineHost);
    this.approvalHost = element(doc, "div", "agent-approvals");
    this.errorHost = element(doc, "div", "agent-ui-error");
    this.errorHost.setAttribute("role", "alert");
    center.append(
      header,
      conversation,
      this.approvalHost,
      this.errorHost,
      this.renderComposer(doc),
    );

    this.inspector = element(doc, "aside", "agent-inspector");
    this.inspector.setAttribute("aria-label", t("agent-inspector"));
    layout.append(rail, center, this.inspector);
    root.append(layout);
    return root;
  }

  protected onMount(): void {
    const version = ++this.mountVersion;
    this.unsubscribe = this.service.subscribe(() => this.scheduleRefresh());
    this.sendButton.disabled = true;
    void this.service
      .ready()
      .then(() => {
        if (version !== this.mountVersion) return;
        const sessions = this.service.getSessions();
        const active =
          sessions.find((session) => session.id === this.activeId) ||
          sessions[0] ||
          this.service.createSession();
        this.selectSession(active.id);
      })
      .catch((error: unknown) => {
        if (version === this.mountVersion) this.showError(error);
      });
  }

  protected onShow(): void {
    this.applyTheme();
    this.loadEndpoints();
    this.refresh();
  }

  protected onDestroy(): void {
    ++this.mountVersion;
    this.saveDraft();
    this.displayedSessionId = "";
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    this.approvalSignature = "";
    this.inspectorSignature = "";
  }

  private renderWelcome(doc: Document): HTMLElement {
    const welcome = element(doc, "div", "agent-welcome");
    welcome.append(
      element(doc, "div", "agent-welcome-mark", "✦"),
      element(doc, "h1", "", t("agent-welcome-title")),
      element(
        doc,
        "p",
        "agent-welcome-description",
        t("agent-welcome-description"),
      ),
    );
    const suggestions = element(doc, "div", "agent-suggestions");
    for (const kind of ["explore", "compare", "organize"] as const) {
      const suggestion = button(
        doc,
        t(`agent-suggestion-${kind}`),
        () => {
          this.composer.value = t(`agent-prompt-${kind}`);
          this.composer.focus();
          this.saveDraft();
        },
        "agent-suggestion",
      );
      suggestions.append(suggestion);
    }
    welcome.append(suggestions);
    return welcome;
  }

  private renderComposer(doc: Document): HTMLElement {
    const area = element(doc, "div", "agent-composer-area");
    const box = element(doc, "div", "agent-composer-box");
    this.attachmentHost = element(doc, "div", "agent-attachments");
    this.composer = element(doc, "textarea", "agent-composer");
    this.composer.rows = 3;
    this.composer.placeholder = t("agent-composer-placeholder");
    this.composer.setAttribute("aria-label", t("agent-composer-placeholder"));
    this.composer.addEventListener("input", () => this.saveDraft());
    this.composer.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void this.run();
      }
    });
    const toolbar = element(doc, "div", "agent-composer-toolbar");
    this.attachButton = button(
      doc,
      t("agent-attach-selection"),
      () => this.attachSelection(),
      "agent-button agent-attach-button",
    );
    this.permission = select(doc, t("agent-permission"), [
      { value: "read-only", label: t("agent-permission-read-only") },
      { value: "confirm", label: t("agent-permission-confirm") },
      { value: "full", label: t("agent-permission-full") },
    ]);
    this.permission.addEventListener("change", () => {
      this.updatePermissionHelp();
      this.saveDraft();
    });
    this.sendButton = button(
      doc,
      t("agent-send"),
      () => {
        void this.run();
      },
      "agent-button agent-send",
    );
    this.stopButton = button(
      doc,
      t("agent-stop"),
      () => this.service.stop(this.activeId),
      "agent-button agent-stop",
    );
    this.stopButton.hidden = true;
    toolbar.append(
      this.attachButton,
      this.permission,
      this.sendButton,
      this.stopButton,
    );
    box.append(this.attachmentHost, this.composer, toolbar);

    const settings = element(doc, "details", "agent-run-settings");
    settings.append(element(doc, "summary", "", t("agent-run-settings")));
    const fields = element(doc, "div", "agent-settings-fields");
    this.endpoint = select(doc, t("agent-model"), []);
    this.deepReadEndpoint = select(doc, t("agent-deep-read-model"), []);
    this.pdfPolicy = select(doc, t("agent-pdf-policy"), [
      { value: "auto", label: t("agent-pdf-auto") },
      { value: "text", label: t("agent-pdf-text") },
      { value: "pdf-base64", label: t("agent-pdf-base64") },
      { value: "mineru", label: t("agent-pdf-mineru") },
    ]);
    const defaults = defaultAgentOptions();
    this.contextWindow = this.numberInput(
      doc,
      defaults.contextWindowTokens,
      8192,
      1048576,
    );
    this.outputTokens = this.numberInput(
      doc,
      defaults.maxOutputTokens,
      1024,
      32768,
    );
    this.maxSteps = this.numberInput(doc, defaults.maxSteps, 1, 64);
    const fieldPairs: Array<[FluentMessageId, HTMLElement]> = [
      ["agent-model", this.endpoint],
      ["agent-deep-read-model", this.deepReadEndpoint],
      ["agent-pdf-policy", this.pdfPolicy],
      ["agent-context-window", this.contextWindow],
      ["agent-output-tokens", this.outputTokens],
      ["agent-max-steps", this.maxSteps],
    ];
    for (const [key, input] of fieldPairs) {
      const label = element(doc, "label", "agent-field");
      label.append(element(doc, "span", "", t(key)), input);
      fields.append(label);
      input.addEventListener("change", () => this.saveDraft());
    }
    this.permissionHelp = element(doc, "p", "agent-permission-help");
    this.updatePermissionHelp();
    settings.append(
      fields,
      element(doc, "p", "agent-settings-hint", t("agent-pdf-hint")),
      this.permissionHelp,
    );

    const footer = element(doc, "div", "agent-composer-footer");
    this.contextLabel = element(doc, "span", "agent-context-label");
    footer.append(
      this.contextLabel,
      element(doc, "span", "", t("agent-keyboard-hint")),
    );
    area.append(box, settings, footer);
    this.loadEndpoints();
    return area;
  }

  private numberInput(
    doc: Document,
    value: number,
    min: number,
    max: number,
  ): HTMLInputElement {
    const input = element(doc, "input", "agent-number");
    input.type = "number";
    input.value = String(value);
    input.min = String(min);
    input.max = String(max);
    input.step = "1";
    return input;
  }

  private loadEndpoints(): void {
    if (!this.endpoint) return;
    const endpoints = LLMEndpointManager.getEnabledEndpoints();
    for (const [node, defaultKey] of [
      [this.endpoint, "agent-model-auto"],
      [this.deepReadEndpoint, "agent-model-inherit"],
    ] as const) {
      const selected = node.value;
      node.replaceChildren();
      const fallback = element(documentOf(node), "option", "", t(defaultKey));
      fallback.value = "";
      node.append(fallback);
      for (const endpoint of endpoints) {
        const option = element(
          documentOf(node),
          "option",
          "",
          `${endpoint.name} · ${endpoint.model}`,
        );
        option.value = endpoint.id;
        node.append(option);
      }
      this.selectEndpoint(node, selected);
    }
  }

  private selectEndpoint(node: HTMLSelectElement, id = ""): void {
    node.value = id;
    if (id && node.value !== id) {
      const missing = element(
        documentOf(node),
        "option",
        "",
        t("agent-model-unavailable", { id }),
      );
      missing.value = id;
      node.append(missing);
    }
    node.value = id;
  }

  private newSession(): void {
    this.saveDraft();
    this.selectSession(this.service.createSession().id);
    this.composer.focus();
  }

  private selectSession(id: string): void {
    this.saveDraft();
    const session = this.service.getSession(id);
    if (!session) return;
    this.activeId = id;
    let draft = this.drafts.get(id);
    if (!draft) {
      draft = {
        prompt: "",
        options: {
          ...session.options,
          selectedItemIds: [...session.options.selectedItemIds],
          libraryID: session.events.length
            ? session.options.libraryID
            : Zotero.getActiveZoteroPane()?.getSelectedLibraryID() || 1,
        },
      };
      this.drafts.set(id, draft);
    }
    this.composer.value = draft.prompt;
    this.permission.value = draft.options.permission;
    this.selectEndpoint(this.endpoint, draft.options.endpointId);
    this.selectEndpoint(
      this.deepReadEndpoint,
      draft.options.deepReadEndpointId,
    );
    this.pdfPolicy.value = draft.options.pdfPolicy;
    this.contextWindow.value = String(draft.options.contextWindowTokens);
    this.outputTokens.value = String(draft.options.maxOutputTokens);
    this.maxSteps.value = String(draft.options.maxSteps);
    this.displayedSessionId = id;
    this.updatePermissionHelp();
    this.timeline.clear();
    this.approvalSignature = "";
    this.inspectorSignature = "";
    this.errorHost.textContent = "";
    this.refresh();
    this.renderAttachments();
  }

  private saveDraft(): void {
    const draft = this.drafts.get(this.activeId);
    if (!draft || !this.composer || this.displayedSessionId !== this.activeId)
      return;
    draft.prompt = this.composer.value;
    draft.options = {
      ...draft.options,
      permission: this.permission.value as AgentRunOptions["permission"],
      endpointId: this.endpoint.value || undefined,
      deepReadEndpointId: this.deepReadEndpoint.value || undefined,
      pdfPolicy: this.pdfPolicy.value as AgentRunOptions["pdfPolicy"],
      contextWindowTokens: this.numericValue(this.contextWindow),
      maxOutputTokens: this.numericValue(this.outputTokens),
      maxSteps: this.numericValue(this.maxSteps),
    };
  }

  private numericValue(input: HTMLInputElement): number {
    const value = Number(input.value);
    return Math.min(
      Number(input.max),
      Math.max(
        Number(input.min),
        Number.isFinite(value) ? Math.floor(value) : Number(input.min),
      ),
    );
  }

  private updatePermissionHelp(): void {
    if (this.permissionHelp)
      this.permissionHelp.textContent = t(
        `agent-permission-help-${this.permission.value as AgentRunOptions["permission"]}`,
      );
  }

  private attachSelection(): void {
    const draft = this.drafts.get(this.activeId);
    if (!draft) return;
    const pane = Zotero.getActiveZoteroPane();
    const items = pane?.getSelectedItems() || [];
    const ids = items
      .map((item) => (item.isRegularItem() ? item.id : item.parentID))
      .filter((id): id is number => typeof id === "number" && id > 0);
    if (!ids.length) {
      this.errorHost.textContent = t("agent-no-selection");
      return;
    }
    const libraryID = items[0].libraryID;
    if (
      (draft.options.selectedItemIds.length ||
        this.service.getSession(this.activeId)?.events.length) &&
      draft.options.libraryID !== libraryID
    ) {
      this.errorHost.textContent = t("agent-selection-library-mismatch");
      return;
    }
    draft.options.libraryID = libraryID;
    draft.options.selectedItemIds = [
      ...new Set([...draft.options.selectedItemIds, ...ids]),
    ];
    this.errorHost.textContent = "";
    this.renderAttachments();
  }

  private renderAttachments(): void {
    const draft = this.drafts.get(this.activeId);
    if (!draft) return;
    this.attachmentHost.replaceChildren();
    const doc = documentOf(this.attachmentHost);
    for (const id of draft.options.selectedItemIds) {
      const item = Zotero.Items.get(id);
      const title = item
        ? String(item.getField("title") || `#${id}`)
        : `#${id}`;
      const chip = button(
        doc,
        `▤ ${title} ×`,
        () => {
          draft.options.selectedItemIds = draft.options.selectedItemIds.filter(
            (itemId) => itemId !== id,
          );
          this.renderAttachments();
        },
        "agent-attachment",
      );
      chip.title = t("agent-remove-attachment", { title });
      chip.setAttribute("aria-label", chip.title);
      chip.disabled = this.isRunning(this.service.getSession(this.activeId));
      this.attachmentHost.append(chip);
    }
  }

  private async run(): Promise<void> {
    const session = this.service.getSession(this.activeId);
    if (!session || this.isRunning(session)) return;
    const prompt = this.composer.value.trim();
    if (!prompt) return;
    this.saveDraft();
    const draft = this.drafts.get(this.activeId);
    if (!draft) return;
    const sessionId = this.activeId;
    const eventCount = session.events.length;
    this.errorHost.textContent = "";
    this.composer.value = "";
    draft.prompt = "";
    try {
      await this.service.run(sessionId, prompt, {
        ...draft.options,
        selectedItemIds: [...draft.options.selectedItemIds],
      });
    } catch (error) {
      // Keep a prompt that failed validation before the service accepted it.
      if (session.events.length === eventCount && !draft.prompt) {
        draft.prompt = prompt;
        if (this.activeId === sessionId) this.composer.value = prompt;
      }
      if (this.activeId === sessionId) this.showError(error);
    } finally {
      this.refresh();
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      if (this.container) this.refresh();
    }, 60);
  }

  private refresh(): void {
    if (!this.sessionsHost) return;
    this.renderSessions();
    const session = this.service.getSession(this.activeId);
    if (!session) return;
    const running = this.isRunning(session);
    this.titleHost.textContent = session.events.length
      ? session.title
      : t("agent-new-title");
    this.titleHost.title = this.titleHost.textContent;
    this.statusHost.textContent = t(`agent-status-${session.status}`);
    this.statusHost.setAttribute("data-status", session.status);
    this.welcome.hidden = session.events.length > 0;
    this.timelineHost.hidden = !session.events.length;
    this.timeline.render(session.events, session.team);
    this.sendButton.hidden = running;
    this.sendButton.disabled = running;
    this.stopButton.hidden = !running;
    this.composer.disabled = running;
    this.attachButton.disabled = running;
    for (const control of [
      this.permission,
      this.endpoint,
      this.deepReadEndpoint,
      this.pdfPolicy,
      this.contextWindow,
      this.outputTokens,
      this.maxSteps,
    ])
      control.disabled = running;
    this.contextLabel.textContent = t("agent-context-summary", {
      tokens: session.context.estimatedTokens.toLocaleString(),
      count: session.context.compactions,
    });
    this.renderApprovals(session);
    this.renderInspector(session);
    this.renderAttachments();
  }

  private renderSessions(): void {
    const doc = documentOf(this.sessionsHost);
    this.sessionsHost.replaceChildren();
    for (const session of this.service.getSessions()) {
      const row = element(
        doc,
        "div",
        `agent-session-row${session.id === this.activeId ? " is-active" : ""}`,
      );
      const title = session.events.length
        ? session.title
        : t("agent-new-title");
      const entry = button(
        doc,
        "",
        () => this.selectSession(session.id),
        "agent-session-entry",
      );
      entry.title = title;
      entry.setAttribute(
        "aria-current",
        session.id === this.activeId ? "true" : "false",
      );
      entry.append(
        element(doc, "span", "agent-session-name", title),
        element(
          doc,
          "span",
          "agent-session-meta",
          t(`agent-status-${session.status}`),
        ),
      );
      const remove = button(
        doc,
        "×",
        () => {
          void this.deleteSession(session);
        },
        "agent-session-delete",
      );
      remove.title = t("agent-delete-session");
      remove.setAttribute("aria-label", `${remove.title}: ${title}`);
      remove.disabled = this.isRunning(session);
      row.append(entry, remove);
      this.sessionsHost.append(row);
    }
  }

  private async deleteSession(session: AgentSession): Promise<void> {
    const doc = documentOf(this.sessionsHost);
    if (
      !doc.defaultView?.confirm(
        t("agent-delete-confirm", { title: session.title }),
      )
    )
      return;
    try {
      await this.service.deleteSession(session.id);
      this.drafts.delete(session.id);
      if (this.activeId === session.id) {
        this.activeId = "";
        const next =
          this.service.getSessions()[0] || this.service.createSession();
        this.selectSession(next.id);
      } else this.refresh();
    } catch (error) {
      this.showError(error);
    }
  }

  private renderApprovals(session: AgentSession): void {
    const signature = JSON.stringify(session.pendingApprovals);
    if (signature === this.approvalSignature) return;
    this.approvalSignature = signature;
    this.approvalHost.replaceChildren();
    const doc = documentOf(this.approvalHost);
    for (const approval of session.pendingApprovals) {
      const card = element(doc, "section", "agent-approval-card");
      card.append(
        element(doc, "strong", "", t("agent-approval-title")),
        element(doc, "p", "", approval.description),
      );
      const details = element(doc, "details", "agent-approval-details");
      details.open = true;
      details.append(
        element(doc, "summary", "", approval.toolName),
        element(doc, "pre", "", JSON.stringify(approval.arguments, null, 2)),
      );
      const actions = element(doc, "div", "agent-approval-actions");
      for (const allow of [false, true]) {
        const action = button(
          doc,
          t(allow ? "agent-approve" : "agent-reject"),
          () => {
            actions
              .querySelectorAll("button")
              .forEach((node: HTMLButtonElement) => {
                node.disabled = true;
              });
            this.service.approve(session.id, approval.id, allow);
            this.refresh();
          },
          `agent-button${allow ? " agent-send" : ""}`,
        );
        actions.append(action);
      }
      card.append(details, actions);
      this.approvalHost.append(card);
    }
  }

  private renderInspector(session: AgentSession): void {
    const signature = JSON.stringify([
      session.context,
      session.plan,
      session.team,
      session.options,
      session.permission,
    ]);
    if (signature === this.inspectorSignature) return;
    this.inspectorSignature = signature;
    const doc = documentOf(this.inspector);
    this.inspector.replaceChildren();
    const context = this.inspectorSection(doc, "agent-context");
    const windowTokens = session.options.contextWindowTokens;
    const percent = Math.min(
      100,
      Math.round((session.context.estimatedTokens / windowTokens) * 100),
    );
    context.append(element(doc, "div", "agent-context-number", `${percent}%`));
    const meter = element(doc, "progress", "agent-context-meter");
    meter.max = windowTokens;
    meter.value = session.context.estimatedTokens;
    meter.setAttribute("aria-label", t("agent-context"));
    context.append(
      meter,
      element(
        doc,
        "p",
        "agent-inspector-hint",
        t("agent-context-usage", {
          used: session.context.estimatedTokens.toLocaleString(),
          limit: windowTokens.toLocaleString(),
        }),
      ),
      element(
        doc,
        "p",
        "agent-inspector-hint",
        t("agent-context-compactions", { count: session.context.compactions }),
      ),
      element(
        doc,
        "p",
        "agent-inspector-hint",
        t("agent-progressive-disclosure"),
      ),
    );

    const plan = this.inspectorSection(doc, "agent-plan");
    if (!session.plan.length)
      plan.append(
        element(doc, "p", "agent-inspector-hint", t("agent-plan-empty")),
      );
    for (const step of session.plan) {
      const row = element(
        doc,
        "div",
        `agent-plan-step agent-plan-step--${step.status}`,
      );
      const symbol =
        step.status === "completed"
          ? "✓"
          : step.status === "in-progress"
            ? "◉"
            : "○";
      row.append(
        element(doc, "span", "agent-plan-icon", symbol),
        element(doc, "span", "", step.text),
      );
      row.title = t(`agent-plan-${step.status}`);
      plan.append(row);
    }

    const team = this.inspectorSection(doc, "agent-team");
    if (!session.team.length)
      team.append(
        element(doc, "p", "agent-inspector-hint", t("agent-team-empty")),
      );
    for (const member of session.team) {
      const row = element(doc, "details", "agent-team-member");
      const label = element(doc, "summary", "", member.name);
      row.append(
        label,
        element(
          doc,
          "span",
          "agent-team-status",
          t(`agent-status-${member.status}`),
        ),
        element(doc, "p", "agent-team-task", member.task),
      );
      if (member.result)
        row.append(element(doc, "div", "agent-team-result", member.result));
      team.append(row);
    }
    this.inspector.append(context, plan, team);
  }

  private inspectorSection(doc: Document, key: FluentMessageId): HTMLElement {
    const section = element(doc, "section", "agent-inspector-section");
    section.append(element(doc, "h3", "agent-section-label", t(key)));
    return section;
  }

  private isRunning(session?: AgentSession): boolean {
    return (
      session?.status === "running" || session?.status === "waiting-approval"
    );
  }

  private showError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.errorHost.textContent = message;
    ztoolkit.log("[AI-Butler Agent] UI operation failed:", message);
  }
}
