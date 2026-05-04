import { getPref, setPref } from "../../../utils/prefs";
import LLMService from "../../llmService";
import {
  LLMEndpointManager,
  type LLMEndpoint,
  type LLMEndpointProviderType,
  type LLMRoutingStrategy,
} from "../../llmEndpointManager";
import type { LLMModelInfo } from "../../llmproviders/types";
import {
  createFormGroup,
  createInput,
  createSelect,
  createStyledButton,
} from "./components";

type EndpointPanelOptions = {
  modalHost?: HTMLElement;
  onChange?: () => void;
};

type DraftEndpoint = {
  name: string;
  providerType: LLMEndpointProviderType;
};

function doc(): Document {
  return Zotero.getMainWindow().document;
}

function endpointProviderOptions(): Array<{ value: string; label: string }> {
  return LLMEndpointManager.providerTypes().map((providerType) => ({
    value: providerType,
    label: LLMEndpointManager.providerLabel(providerType),
  }));
}

function readMultiModelIds(): string[] {
  try {
    const raw = (getPref("multiModelSummaryEndpointIds") as string) || "[]";
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function writeMultiModelIds(ids: string[]): void {
  setPref("multiModelSummaryEndpointIds", JSON.stringify(ids));
}

function smallMuted(text: string): HTMLElement {
  const el = doc().createElement("div");
  el.textContent = text;
  Object.assign(el.style, {
    color: "var(--ai-text-muted)",
    fontSize: "12px",
    lineHeight: "1.45",
  });
  return el;
}

function fieldDescription(text: string): string {
  return text;
}

export class EndpointSettingsPanel {
  private root: HTMLElement;
  private endpoints: LLMEndpoint[];
  private expandedEndpointIds = new Set<string>();
  private options: EndpointPanelOptions;

  constructor(options: EndpointPanelOptions = {}) {
    this.options = options;
    this.root = doc().createElement("section");
    this.endpoints = LLMEndpointManager.getEndpoints();
    this.render();
  }

  getElement(): HTMLElement {
    return this.root;
  }

  private persist(): void {
    LLMEndpointManager.saveEndpoints(this.endpoints);
    this.options.onChange?.();
  }

  private rerender(): void {
    this.endpoints = LLMEndpointManager.getEndpoints();
    this.render();
  }

  private isNameUnique(name: string, currentId?: string): boolean {
    const normalized = name.trim().toLowerCase();
    if (!normalized) return false;
    return !this.endpoints.some(
      (endpoint) =>
        endpoint.id !== currentId &&
        endpoint.name.trim().toLowerCase() === normalized,
    );
  }

  private render(): void {
    const document = doc();
    this.root.innerHTML = "";
    Object.assign(this.root.style, {
      maxWidth: "800px",
      marginBottom: "28px",
      boxSizing: "border-box",
    });

    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "12px",
      marginBottom: "14px",
      flexWrap: "wrap",
    });

    const titleWrap = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = "模型平台";
    Object.assign(title.style, {
      margin: "0 0 4px 0",
      color: "#59c0bc",
      fontSize: "18px",
      borderBottom: "2px solid #59c0bc",
      paddingBottom: "8px",
    });
    titleWrap.appendChild(title);
    titleWrap.appendChild(
      smallMuted(
        "添加并管理一个或多个大模型供应商。供应商类型、API 地址、API 密钥和模型均由这里的模型平台配置接管。",
      ),
    );

    const addButton = createStyledButton(
      "添加大模型供应商",
      "#59c0bc",
      "small",
    );
    addButton.addEventListener("click", () => this.openAddEndpointDialog());

    header.appendChild(titleWrap);
    header.appendChild(addButton);
    this.root.appendChild(header);

    const list = document.createElement("div");
    Object.assign(list.style, {
      display: "flex",
      flexDirection: "column",
      gap: "12px",
      marginTop: "16px",
      marginBottom: "18px",
    });

    this.endpoints.forEach((endpoint, index) => {
      list.appendChild(this.renderEndpointCard(endpoint, index));
    });

    this.root.appendChild(list);
    this.root.appendChild(this.renderRoutingControls());
    this.root.appendChild(this.renderReservedMultiModelControls());
  }

  private renderRoutingControls(): HTMLElement {
    const document = doc();
    const panel = document.createElement("div");
    Object.assign(panel.style, {
      marginTop: "18px",
    });

    const strategy = LLMEndpointManager.getRoutingStrategy();
    const strategySelect = createSelect(
      "llmRoutingStrategy",
      [
        {
          value: "priority",
          label: "优先级：优先使用最高优先级供应商，仅失败后按顺序切换",
        },
        { value: "roundRobin", label: "轮询：轮询启用的供应商" },
      ],
      strategy,
      (value) => {
        LLMEndpointManager.setRoutingStrategy(value as LLMRoutingStrategy);
      },
    );
    panel.appendChild(
      createFormGroup(
        "路由策略",
        strategySelect,
        "供应商优先级从上到下依次降低，可通过调整位置指定优先级",
      ),
    );

    const retryInput = createInput(
      "maxApiSwitchCount",
      "number",
      String(getPref("maxApiSwitchCount" as any) || "3"),
      "3",
    );
    retryInput.min = "1";
    retryInput.addEventListener("change", () => {
      const value = Math.max(1, parseInt(retryInput.value || "3", 10) || 3);
      retryInput.value = String(value);
      setPref("maxApiSwitchCount" as any, String(value));
    });
    Object.assign(retryInput.style, {
      width: "180px",
      flex: "0 0 180px",
    });
    panel.appendChild(
      createFormGroup(
        "最大重试次数",
        retryInput,
        "供应商失败后，会循环尝试，直到达到最大重试次数上限。",
      ),
    );

    return panel;
  }

  private renderReservedMultiModelControls(): HTMLElement {
    const document = doc();
    const box = document.createElement("div");
    Object.assign(box.style, {
      marginTop: "12px",
      marginBottom: "12px",
      padding: "12px",
      border: "1px dashed var(--ai-border)",
      borderRadius: "6px",
      background: "var(--ai-surface-2)",
    });

    const row = document.createElement("label");
    Object.assign(row.style, {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      color: "var(--ai-text)",
      fontSize: "14px",
      fontWeight: "600",
      marginBottom: "8px",
    });

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked =
      (getPref("multiModelSummaryEnabled") as boolean) === true;
    checkbox.addEventListener("change", () => {
      setPref("multiModelSummaryEnabled", checkbox.checked);
    });

    row.appendChild(checkbox);
    row.appendChild(document.createTextNode("多模型同时总结（预留）"));
    box.appendChild(row);
    box.appendChild(
      smallMuted(
        "本轮只保存配置，不改变运行行为；下一轮会用选定供应商并行生成多个总结。",
      ),
    );

    const ids = new Set(readMultiModelIds());
    const endpointList = document.createElement("div");
    Object.assign(endpointList.style, {
      display: "flex",
      gap: "10px",
      flexWrap: "wrap",
      marginTop: "10px",
    });
    this.endpoints.forEach((endpoint) => {
      const item = document.createElement("label");
      Object.assign(item.style, {
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        fontSize: "12px",
        color: "var(--ai-text-muted)",
      });
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = ids.has(endpoint.id);
      input.addEventListener("change", () => {
        if (input.checked) ids.add(endpoint.id);
        else ids.delete(endpoint.id);
        writeMultiModelIds([...ids]);
      });
      item.appendChild(input);
      item.appendChild(document.createTextNode(endpoint.name));
      endpointList.appendChild(item);
    });
    box.appendChild(endpointList);
    return box;
  }

  private renderEndpointCard(
    endpoint: LLMEndpoint,
    index: number,
  ): HTMLElement {
    const document = doc();
    const isExpanded = this.expandedEndpointIds.has(endpoint.id);
    const card = document.createElement("article");
    Object.assign(card.style, {
      border: "1px solid var(--ai-border)",
      borderRadius: "8px",
      background: "var(--ai-surface)",
      boxSizing: "border-box",
      overflow: "hidden",
    });

    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "12px",
      padding: "12px",
      background: endpoint.enabled
        ? "rgba(76, 175, 80, 0.08)"
        : "rgba(128, 128, 128, 0.08)",
      borderBottom: isExpanded ? "1px solid var(--ai-border)" : "none",
    });

    const identity = document.createElement("div");
    Object.assign(identity.style, {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      minWidth: "0",
      flex: "1",
    });
    identity.appendChild(this.renderEnableSwitch(endpoint));

    const textWrap = document.createElement("div");
    Object.assign(textWrap.style, {
      minWidth: "0",
    });
    const name = document.createElement("div");
    name.textContent = endpoint.name || "未命名供应商";
    Object.assign(name.style, {
      fontWeight: "700",
      color: "var(--ai-text)",
      fontSize: "14px",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });
    const type = document.createElement("div");
    type.textContent = `供应商类型：${LLMEndpointManager.providerLabel(
      endpoint.providerType,
    )}`;
    Object.assign(type.style, {
      color: "var(--ai-text-muted)",
      fontSize: "12px",
      marginTop: "3px",
    });
    textWrap.appendChild(name);
    textWrap.appendChild(type);
    identity.appendChild(textWrap);
    header.appendChild(identity);

    const actions = document.createElement("div");
    Object.assign(actions.style, {
      display: "flex",
      gap: "6px",
      alignItems: "center",
      flexWrap: "wrap",
      justifyContent: "flex-end",
    });
    actions.appendChild(
      this.actionButton("↑", "#777", () => {
        if (index <= 0) return;
        const [item] = this.endpoints.splice(index, 1);
        this.endpoints.splice(index - 1, 0, item);
        this.persist();
        this.rerender();
      }),
    );
    actions.appendChild(
      this.actionButton("↓", "#777", () => {
        if (index >= this.endpoints.length - 1) return;
        const [item] = this.endpoints.splice(index, 1);
        this.endpoints.splice(index + 1, 0, item);
        this.persist();
        this.rerender();
      }),
    );
    actions.appendChild(
      this.actionButton(isExpanded ? "收起详情" : "详情", "#59c0bc", () => {
        if (isExpanded) this.expandedEndpointIds.delete(endpoint.id);
        else this.expandedEndpointIds.add(endpoint.id);
        this.render();
      }),
    );
    actions.appendChild(
      this.actionButton("删除", "#f44336", () => {
        if (this.endpoints.length <= 1) {
          endpoint.enabled = false;
        } else {
          this.endpoints = this.endpoints.filter(
            (item) => item.id !== endpoint.id,
          );
          this.expandedEndpointIds.delete(endpoint.id);
        }
        this.persist();
        this.rerender();
      }),
    );
    header.appendChild(actions);
    card.appendChild(header);

    if (isExpanded) {
      card.appendChild(this.renderEndpointDetails(endpoint));
    }
    return card;
  }

  private renderEnableSwitch(endpoint: LLMEndpoint): HTMLElement {
    const document = doc();
    const button = document.createElement("button");
    button.type = "button";
    button.title = endpoint.enabled ? "已启用" : "已禁用";
    Object.assign(button.style, {
      width: "42px",
      height: "22px",
      border: "none",
      borderRadius: "999px",
      padding: "2px",
      cursor: "pointer",
      background: endpoint.enabled ? "#4caf50" : "#bdbdbd",
      transition: "background 0.2s ease",
      flex: "0 0 auto",
    });
    const knob = document.createElement("span");
    Object.assign(knob.style, {
      display: "block",
      width: "18px",
      height: "18px",
      borderRadius: "50%",
      background: "#fff",
      transform: endpoint.enabled ? "translateX(20px)" : "translateX(0)",
      transition: "transform 0.2s ease",
      boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
    });
    button.appendChild(knob);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      endpoint.enabled = !endpoint.enabled;
      this.persist();
      this.rerender();
    });
    return button;
  }

  private renderEndpointDetails(endpoint: LLMEndpoint): HTMLElement {
    const document = doc();
    const details = document.createElement("div");
    Object.assign(details.style, {
      padding: "14px 12px 16px",
      background: "var(--ai-surface)",
    });

    details.appendChild(this.renderApiUrlField(endpoint));
    details.appendChild(this.renderApiKeyField(endpoint));
    details.appendChild(this.renderModelField(endpoint));
    details.appendChild(this.renderConnectionTest(endpoint));
    return details;
  }

  private renderApiUrlField(endpoint: LLMEndpoint): HTMLElement {
    const document = doc();
    const group = document.createElement("div");
    Object.assign(group.style, {
      marginBottom: "24px",
    });

    const label = document.createElement("label");
    label.textContent = "API 地址 *";
    Object.assign(label.style, {
      display: "block",
      marginBottom: "8px",
      fontSize: "14px",
      fontWeight: "600",
      color: "var(--ai-text)",
    });
    group.appendChild(label);

    const apiUrlInput = createInput(
      `endpoint-${endpoint.id}-url`,
      "text",
      endpoint.apiUrl,
      LLMEndpointManager.providerDefaults(endpoint.providerType).apiUrl,
    );
    apiUrlInput.addEventListener("input", () => {
      endpoint.apiUrl = apiUrlInput.value;
      this.updateEndpointPreview(endpoint);
      this.persist();
    });
    group.appendChild(apiUrlInput);

    const description = document.createElement("div");
    Object.assign(description.style, {
      marginTop: "6px",
      display: "flex",
      alignItems: "center",
      gap: "6px",
      fontSize: "12px",
      color: "var(--ai-text-muted)",
      minWidth: "0",
    });

    const required = document.createElement("span");
    required.textContent = "【必填】";
    Object.assign(required.style, {
      flex: "0 0 auto",
    });

    const preview = document.createElement("span");
    preview.setAttribute("data-endpoint-preview", endpoint.id);
    Object.assign(preview.style, {
      display: "block",
      minWidth: "0",
      maxWidth: "100%",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });

    description.appendChild(required);
    description.appendChild(preview);
    group.appendChild(description);
    this.updateEndpointPreview(endpoint, preview);
    return group;
  }

  private renderApiKeyField(endpoint: LLMEndpoint): HTMLElement {
    const document = doc();
    const wrapper = document.createElement("div");
    Object.assign(wrapper.style, {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      width: "100%",
    });

    const apiKeyInput = createInput(
      `endpoint-${endpoint.id}-key`,
      "password",
      endpoint.apiKey,
      "sk-...",
    );
    Object.assign(apiKeyInput.style, {
      flex: "1 1 auto",
      minWidth: "0",
    });
    apiKeyInput.addEventListener("input", () => {
      endpoint.apiKey = apiKeyInput.value;
      this.persist();
    });

    const toggleButton = document.createElement("button");
    toggleButton.type = "button";
    toggleButton.textContent = "👁";
    toggleButton.title = "显示/隐藏密钥";
    Object.assign(toggleButton.style, {
      flex: "0 0 auto",
      width: "38px",
      minHeight: "38px",
      border: "1px solid var(--ai-border)",
      borderRadius: "4px",
      background: "var(--ai-surface-2)",
      color: "var(--ai-text)",
      cursor: "pointer",
      fontSize: "14px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    });
    toggleButton.addEventListener("click", () => {
      const isHidden = apiKeyInput.type === "password";
      apiKeyInput.type = isHidden ? "text" : "password";
      toggleButton.textContent = isHidden ? "🙈" : "👁";
    });

    wrapper.appendChild(apiKeyInput);
    wrapper.appendChild(toggleButton);
    return createFormGroup(
      "API 密钥 *",
      wrapper,
      fieldDescription("【必填】该供应商的单个 API 密钥，将安全存储在本地。"),
    );
  }

  private renderModelField(endpoint: LLMEndpoint): HTMLElement {
    const document = doc();
    const wrapper = document.createElement("div");
    Object.assign(wrapper.style, {
      display: "flex",
      flexDirection: "column",
      gap: "8px",
    });

    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex",
      alignItems: "center",
      gap: "8px",
    });

    const modelInput = createInput(
      `endpoint-${endpoint.id}-model`,
      "text",
      endpoint.model,
      LLMEndpointManager.providerDefaults(endpoint.providerType).model,
    );
    modelInput.addEventListener("input", () => {
      endpoint.model = modelInput.value;
      this.updateEndpointPreview(endpoint);
      this.persist();
    });
    row.appendChild(modelInput);

    const fetchButton = createStyledButton("获取模型", "#667eea", "small");
    row.appendChild(fetchButton);
    wrapper.appendChild(row);

    const modelList = document.createElement("div");
    Object.assign(modelList.style, {
      display: "none",
      border: "1px solid var(--ai-border)",
      borderRadius: "4px",
      maxHeight: "220px",
      overflowY: "auto",
      background: "var(--ai-surface)",
    });
    wrapper.appendChild(modelList);

    fetchButton.addEventListener("click", () => {
      void this.fetchModels(endpoint, modelList, modelInput);
    });

    return createFormGroup(
      "模型 *",
      wrapper,
      fieldDescription(
        "【必填】要使用的模型 ID。可手动填写，也可尝试从供应商接口获取模型列表。",
      ),
    );
  }

  private renderConnectionTest(endpoint: LLMEndpoint): HTMLElement {
    const document = doc();
    const wrapper = document.createElement("div");
    Object.assign(wrapper.style, {
      display: "flex",
      flexDirection: "column",
      gap: "8px",
    });
    const actions = document.createElement("div");
    Object.assign(actions.style, {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      flexWrap: "wrap",
    });
    const testButton = createStyledButton("测试连接", "#2196f3", "small");
    const copyButton = createStyledButton("复制详情", "#777", "small");
    const status = document.createElement("pre");
    status.id = `endpoint-status-${endpoint.id}`;
    Object.assign(status.style, {
      margin: "0",
      minHeight: "48px",
      maxHeight: "180px",
      overflowY: "auto",
      padding: "8px 10px",
      border: "1px solid var(--ai-border)",
      borderRadius: "4px",
      background: "var(--ai-surface-2)",
      color: "var(--ai-text-muted)",
      fontSize: "12px",
      lineHeight: "1.5",
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    });
    testButton.addEventListener("click", () => {
      void this.testEndpoint(endpoint, status);
    });
    copyButton.addEventListener("click", () => {
      void this.copyConnectionDetails(status);
    });
    actions.appendChild(testButton);
    actions.appendChild(copyButton);
    wrapper.appendChild(actions);
    wrapper.appendChild(status);
    return createFormGroup(
      "连接测试",
      wrapper,
      fieldDescription("使用当前 API 地址、密钥和模型测试连接。"),
    );
  }

  private async fetchModels(
    endpoint: LLMEndpoint,
    container: HTMLElement,
    modelInput: HTMLInputElement,
  ): Promise<void> {
    container.style.display = "block";
    container.textContent = "正在获取模型列表...";
    try {
      this.persist();
      const models = await LLMService.listModels(endpoint.providerType, {
        apiUrl: endpoint.apiUrl,
        apiKey: endpoint.apiKey,
        model: endpoint.model,
        stream: false,
      });
      this.renderModelList(models, container, endpoint, modelInput);
    } catch (error: any) {
      container.textContent = error?.message || String(error);
      container.style.color = "#f44336";
    }
  }

  private renderModelList(
    models: LLMModelInfo[],
    container: HTMLElement,
    endpoint: LLMEndpoint,
    modelInput: HTMLInputElement,
  ): void {
    const document = doc();
    container.innerHTML = "";
    container.style.color = "var(--ai-text)";
    if (models.length === 0) {
      container.textContent = "未获取到模型列表";
      return;
    }

    models.forEach((model) => {
      const item = document.createElement("button");
      item.type = "button";
      item.textContent = model.name ? `${model.id} - ${model.name}` : model.id;
      Object.assign(item.style, {
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "8px 10px",
        border: "none",
        background: "transparent",
        color: "var(--ai-text)",
        cursor: "pointer",
        fontSize: "12px",
      });
      item.addEventListener("mouseenter", () => {
        item.style.background = "var(--ai-hover)";
      });
      item.addEventListener("mouseleave", () => {
        item.style.background = "transparent";
      });
      item.addEventListener("click", () => {
        endpoint.model = model.id;
        modelInput.value = model.id;
        this.updateEndpointPreview(endpoint);
        this.persist();
        container.style.display = "none";
      });
      container.appendChild(item);
    });
  }

  private openAddEndpointDialog(): void {
    const mountTarget =
      this.options.modalHost || this.root.parentElement || this.root;
    const document = mountTarget.ownerDocument || doc();
    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
      position: "fixed",
      background: "rgba(0,0,0,0.35)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
      boxSizing: "border-box",
      zIndex: "9999",
    });

    const dialog = document.createElement("div");
    Object.assign(dialog.style, {
      width: "360px",
      maxWidth: "calc(100% - 32px)",
      maxHeight: "calc(100% - 32px)",
      overflowY: "auto",
      background: "var(--ai-surface)",
      color: "var(--ai-text)",
      border: "1px solid var(--ai-border)",
      borderRadius: "8px",
      boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
      padding: "16px",
      boxSizing: "border-box",
    });

    const title = document.createElement("h3");
    title.textContent = "添加提供商";
    Object.assign(title.style, {
      margin: "0 0 14px 0",
      fontSize: "16px",
      color: "var(--ai-text)",
      paddingBottom: "14px",
      borderBottom: "1px solid var(--ai-border)",
    });
    dialog.appendChild(title);

    const icon = document.createElement("div");
    icon.textContent = "P";
    Object.assign(icon.style, {
      width: "58px",
      height: "58px",
      borderRadius: "50%",
      margin: "0 auto 20px",
      border: "1px solid var(--ai-border)",
      background: "var(--ai-surface-2)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontWeight: "700",
      fontSize: "28px",
      color: "var(--ai-text)",
    });
    dialog.appendChild(icon);

    const draft: DraftEndpoint = {
      name: "",
      providerType: "openai",
    };

    const nameInput = createInput(
      "new-endpoint-name",
      "text",
      "",
      "例如 OpenAI",
    );
    const nameGroup = createFormGroup("供应商名称", nameInput);
    dialog.appendChild(nameGroup);

    const providerSelect = createSelect(
      "new-endpoint-provider",
      endpointProviderOptions(),
      draft.providerType,
      (value) => {
        draft.providerType = value as LLMEndpointProviderType;
      },
    );
    dialog.appendChild(createFormGroup("供应商类型", providerSelect));

    const error = document.createElement("div");
    Object.assign(error.style, {
      color: "#f44336",
      fontSize: "12px",
      minHeight: "18px",
      marginTop: "-8px",
      marginBottom: "8px",
    });
    dialog.appendChild(error);

    const actions = document.createElement("div");
    Object.assign(actions.style, {
      display: "flex",
      justifyContent: "flex-end",
      gap: "8px",
      marginTop: "12px",
    });
    const cancelButton = createStyledButton("取消", "#777", "small");
    const confirmButton = createStyledButton("确定", "#4caf50", "small");
    confirmButton.disabled = true;
    confirmButton.style.opacity = "0.45";
    actions.appendChild(cancelButton);
    actions.appendChild(confirmButton);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);

    const syncOverlayBounds = () => {
      const rect = mountTarget.getBoundingClientRect();
      Object.assign(overlay.style, {
        top: `${Math.max(0, rect.top)}px`,
        left: `${Math.max(0, rect.left)}px`,
        width: `${Math.max(0, rect.width)}px`,
        height: `${Math.max(0, rect.height)}px`,
      });
    };
    const win = document.defaultView;
    const cleanup = () => {
      win?.removeEventListener("resize", syncOverlayBounds);
      overlay.remove();
    };
    const validate = () => {
      draft.name = nameInput.value.trim();
      let message = "";
      if (!draft.name) message = "请填写供应商名称";
      else if (!this.isNameUnique(draft.name)) message = "供应商名称必须唯一";
      error.textContent = message;
      confirmButton.disabled = Boolean(message);
      confirmButton.style.opacity = message ? "0.45" : "1";
    };

    nameInput.addEventListener("input", validate);
    cancelButton.addEventListener("click", cleanup);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) cleanup();
    });
    confirmButton.addEventListener("click", () => {
      validate();
      if (confirmButton.disabled) return;
      const endpoint = LLMEndpointManager.createEndpoint(draft.providerType);
      endpoint.name = draft.name;
      this.endpoints.push(endpoint);
      this.expandedEndpointIds.add(endpoint.id);
      this.persist();
      cleanup();
      this.rerender();
    });

    if (!mountTarget) return;
    syncOverlayBounds();
    win?.addEventListener("resize", syncOverlayBounds);
    mountTarget.appendChild(overlay);
    setTimeout(() => nameInput.focus(), 0);
  }

  private actionButton(
    label: string,
    color: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const button = createStyledButton(label, color, "small");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  private async testEndpoint(
    endpoint: LLMEndpoint,
    status: HTMLElement,
  ): Promise<void> {
    status.textContent = "正在测试...";
    status.style.color = "var(--ai-text-muted)";

    try {
      this.persist();
      const result = await LLMService.testEndpointConnection(endpoint);
      status.textContent = result || "连接成功";
      status.style.color = "#4caf50";
    } catch (error: any) {
      status.textContent = error?.message || String(error);
      status.style.color = "#f44336";
    }
  }

  private updateEndpointPreview(
    endpoint: LLMEndpoint,
    target?: HTMLElement | null,
  ): void {
    const preview =
      target ||
      (this.root.querySelector(
        `[data-endpoint-preview="${endpoint.id}"]`,
      ) as HTMLElement | null);
    if (!preview) return;
    const endpointUrl = this.buildEndpointPreview(endpoint);
    preview.textContent = `预览：${endpointUrl}`;
    preview.title = endpointUrl;
  }

  private buildEndpointPreview(endpoint: LLMEndpoint): string {
    const defaults = LLMEndpointManager.providerDefaults(endpoint.providerType);
    const rawUrl = (endpoint.apiUrl || defaults.apiUrl).trim();
    const model = (endpoint.model || defaults.model)
      .trim()
      .replace(/^models\//, "");

    if (endpoint.providerType === "openai") {
      return this.toResponsesEndpoint(rawUrl, "/v1");
    }
    if (
      endpoint.providerType === "openai-compat" ||
      endpoint.providerType === "openrouter"
    ) {
      return this.toChatCompletionsEndpoint(rawUrl);
    }
    if (endpoint.providerType === "google") {
      const base = rawUrl
        .replace(/\/+$/, "")
        .replace(/\/v1beta(?:\/.*)?$/i, "");
      return `${base}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
    }
    if (endpoint.providerType === "anthropic") {
      const base = rawUrl.replace(/\/+$/, "").replace(/\/v1(?:\/.*)?$/i, "");
      return `${base}/v1/messages`;
    }
    return this.toResponsesEndpoint(rawUrl, "");
  }

  private toResponsesEndpoint(url: string, defaultVersionPath: string): string {
    const raw = url.trim().replace(/\/+$/, "");
    if (!raw) return "";
    if (/\/responses$/i.test(raw)) return raw;
    if (/\/v\d+(?:beta)?$/i.test(raw)) return `${raw}/responses`;
    if (/\/v\d+(?:beta)?\/.+$/i.test(raw)) {
      return raw.replace(/(\/v\d+(?:beta)?)(?:\/.*)?$/i, "$1/responses");
    }
    return `${raw}${defaultVersionPath}/responses`;
  }

  private toChatCompletionsEndpoint(url: string): string {
    const raw = url.trim().replace(/\/+$/, "");
    if (!raw) return "";
    if (/\/(?:v\d+(?:beta)?\/)?chat\/completions$/i.test(raw)) return raw;
    if (/\/v\d+(?:beta)?$/i.test(raw)) return `${raw}/chat/completions`;
    if (/\/v\d+(?:beta)?\/.+$/i.test(raw)) {
      return raw.replace(/(\/v\d+(?:beta)?)(?:\/.*)?$/i, "$1/chat/completions");
    }
    return `${raw}/v1/chat/completions`;
  }

  private async copyConnectionDetails(status: HTMLElement): Promise<void> {
    const text = (status.textContent || "").trim();
    if (!text) {
      new ztoolkit.ProgressWindow("连接测试", { closeTime: 1800 })
        .createLine({ text: "暂无可复制的测试详情", type: "default" })
        .show();
      return;
    }

    const document = status.ownerDocument || doc();
    const win = document.defaultView as (Window & typeof globalThis) | null;
    const clipboard = win?.navigator?.clipboard;

    try {
      if (clipboard?.writeText) {
        await clipboard.writeText(text);
      } else {
        throw new Error("clipboard api unavailable");
      }
    } catch {
      try {
        const host = document.body || document.documentElement;
        if (!host) throw new Error("document host unavailable");
        const textarea = document.createElement("textarea");
        textarea.value = text;
        Object.assign(textarea.style, {
          position: "fixed",
          left: "-9999px",
          top: "0",
        });
        host.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      } catch {
        new ztoolkit.ProgressWindow("连接测试", { closeTime: 2200 })
          .createLine({ text: "复制失败，可手动选择详情文本", type: "fail" })
          .show();
        return;
      }
    }

    new ztoolkit.ProgressWindow("连接测试", { closeTime: 1500 })
      .createLine({ text: "已复制测试详情", type: "success" })
      .show();
  }
}

export default EndpointSettingsPanel;
