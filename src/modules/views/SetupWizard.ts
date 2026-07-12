import LLMClient from "../llmClient";
import { createStyledButton } from "./ui/components";
import {
  setupPresets,
  type SetupPreset,
  type SetupPresetValues,
} from "../setupPresets";

let selectedSetupPresetId: string = setupPresets[0]?.id || "";

function createElement<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  options: {
    id?: string;
    className?: string;
    styles?: Partial<CSSStyleDeclaration>;
    attributes?: Record<string, string>;
    innerHTML?: string;
    textContent?: string;
    children?: HTMLElement[];
  } = {},
): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag);
  if (options.id) element.id = options.id;
  if (options.className) element.className = options.className;
  if (options.styles) Object.assign(element.style, options.styles);
  if (options.attributes) {
    Object.entries(options.attributes).forEach(([key, value]) => {
      element.setAttribute(key, value);
    });
  }
  if (options.innerHTML) element.innerHTML = options.innerHTML;
  if (options.textContent) element.textContent = options.textContent;
  if (options.children) {
    options.children.forEach((child) => element.appendChild(child));
  }
  return element;
}

export function showSetupWizard(ownerDocument?: Document): void {
  const doc = ownerDocument || Zotero.getMainWindow().document;
  const overlay = createElement(doc, "div", {
    styles: {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      backgroundColor: "rgba(0, 0, 0, 0.45)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
      boxSizing: "border-box",
    },
  });

  const modal = createElement(doc, "div", {
    styles: {
      width: "min(760px, 96vw)",
      maxHeight: "88vh",
      overflow: "auto",
      backgroundColor: "var(--ai-bg, #fff)",
      color: "var(--ai-text, #222)",
      borderRadius: "14px",
      boxShadow: "0 18px 50px rgba(0,0,0,0.28)",
      border: "1px solid rgba(89, 192, 188, 0.28)",
    },
  });

  overlay.appendChild(modal);
  const root = doc.body || doc.documentElement;
  if (!root) return;
  root.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });

  renderPresetSelectionStep(doc, modal, close);
}

function renderPresetSelectionStep(
  doc: Document,
  modal: HTMLElement,
  close: () => void,
): void {
  modal.innerHTML = "";
  const selectedPreset = getSelectedSetupPreset();
  const nextButton = createStyledButton("下一步", "#00a67e", "medium");
  nextButton.addEventListener("click", () =>
    renderSetupPresetGuideStep(doc, modal, close, selectedPreset),
  );

  const cancelButton = createStyledButton("取消", "#9e9e9e", "medium");
  cancelButton.addEventListener("click", close);

  modal.appendChild(
    createWizardShell(
      doc,
      "🧭 一键初始化配置",
      "选择一个适合新安装插件的预设，按教程填入 API Key 后即可自动完成常用设置。",
      setupPresets.map((preset) => {
        const card = createPresetCard(
          doc,
          preset,
          preset.id === selectedPreset.id,
        );
        card.addEventListener("click", () => {
          selectedSetupPresetId = preset.id;
          renderPresetSelectionStep(doc, modal, close);
        });
        return card;
      }),
      [cancelButton, nextButton],
      close,
    ),
  );
}

function renderSetupPresetGuideStep(
  doc: Document,
  modal: HTMLElement,
  close: () => void,
  preset: SetupPreset,
): void {
  modal.innerHTML = "";
  const keyInput = createElement(doc, "input", {
    attributes: {
      type: "password",
      placeholder: preset.apiKeyPlaceholder,
      autocomplete: "off",
    },
    styles: {
      width: "100%",
      boxSizing: "border-box",
      padding: "12px 14px",
      border: "1px solid #cfd8dc",
      borderRadius: "8px",
      fontSize: "14px",
      marginTop: "10px",
    },
  }) as HTMLInputElement;

  const showKeyRow = createElement(doc, "label", {
    styles: {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      marginTop: "10px",
      fontSize: "13px",
      color: "var(--ai-text-muted, #666)",
    },
  });
  const showKeyBox = createElement(doc, "input", {
    attributes: { type: "checkbox" },
  }) as HTMLInputElement;
  showKeyBox.addEventListener("change", () => {
    keyInput.type = showKeyBox.checked ? "text" : "password";
  });
  showKeyRow.appendChild(showKeyBox);
  showKeyRow.appendChild(doc.createTextNode("显示密钥"));

  const modelInput = createElement(doc, "input", {
    attributes: {
      type: "text",
      placeholder: "先填写 API Key，再点击获取模型",
    },
    styles: {
      flex: "1",
      minWidth: "0",
      padding: "10px 12px",
      border: "1px solid #cfd8dc",
      borderRadius: "8px",
      fontSize: "14px",
    },
  }) as HTMLInputElement;
  modelInput.value = preset.endpoint.model;
  const modelStatus = createElement(doc, "div", {
    textContent: "可手动填写模型，也可以用 API Key 获取模型列表后选择。",
    styles: {
      marginTop: "6px",
      fontSize: "12px",
      color: "var(--ai-text-muted, #666)",
    },
  });
  const modelList = createElement(doc, "div", {
    styles: {
      display: "none",
      marginTop: "8px",
      border: "1px solid rgba(89, 192, 188, 0.25)",
      borderRadius: "8px",
      maxHeight: "180px",
      overflow: "auto",
    },
  });
  const fetchModelsButton = createStyledButton("获取模型", "#3f51b5", "small");
  fetchModelsButton.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await fetchSetupPresetModels(
      doc,
      preset,
      keyInput.value.trim(),
      modelInput,
      modelStatus,
      modelList,
      fetchModelsButton,
    );
  });
  const modelSection = createElement(doc, "div", {
    styles: { display: "none", marginTop: "16px" },
    children: [
      createElement(doc, "div", {
        textContent: "模型 *",
        styles: {
          marginBottom: "8px",
          fontSize: "14px",
          fontWeight: "700",
        },
      }),
      createElement(doc, "div", {
        styles: { display: "flex", gap: "8px", alignItems: "center" },
        children: [modelInput, fetchModelsButton],
      }),
      modelStatus,
      modelList,
    ],
  });

  keyInput.addEventListener("input", () => {
    modelSection.style.display = keyInput.value.trim() ? "block" : "none";
  });

  const content = createElement(doc, "div", {
    children: [
      createGuideList(doc, preset.guideSteps),
      keyInput,
      showKeyRow,
      modelSection,
    ],
  });

  const backButton = createStyledButton("上一步", "#607d8b", "medium");
  backButton.addEventListener("click", () =>
    renderPresetSelectionStep(doc, modal, close),
  );
  const nextButton = createStyledButton("下一步", "#00a67e", "medium");
  nextButton.addEventListener("click", () => {
    const apiKey = keyInput.value.trim();
    if (!apiKey) {
      keyInput.focus();
      new ztoolkit.ProgressWindow("一键初始化配置", { closeTime: 2200 })
        .createLine({ text: `请先填写 ${preset.name} API Key`, type: "fail" })
        .show();
      return;
    }
    renderSetupPresetConfirmStep(doc, modal, close, preset, {
      apiKey,
      model: modelInput.value.trim() || preset.endpoint.model,
    });
  });

  modal.appendChild(
    createWizardShell(
      doc,
      preset.guideTitle,
      preset.guideSubtitle,
      [content],
      [backButton, nextButton],
      close,
    ),
  );
}

function renderSetupPresetConfirmStep(
  doc: Document,
  modal: HTMLElement,
  close: () => void,
  preset: SetupPreset,
  values: SetupPresetValues,
): void {
  modal.innerHTML = "";
  const changes = preset.getChanges(values);
  const list = createElement(doc, "div", {
    styles: {
      border: "1px solid rgba(89, 192, 188, 0.25)",
      borderRadius: "10px",
      overflow: "hidden",
    },
  });
  list.appendChild(
    createElement(doc, "div", {
      styles: {
        display: "grid",
        gridTemplateColumns: "1.1fr 1fr 1fr",
        gap: "10px",
        padding: "10px 14px",
        backgroundColor: "rgba(89, 192, 188, 0.08)",
        borderBottom: "1px solid rgba(89, 192, 188, 0.2)",
        fontSize: "12px",
        fontWeight: "700",
        color: "var(--ai-text-muted, #666)",
      },
      children: [
        createElement(doc, "div", { textContent: "设置项" }),
        createElement(doc, "div", { textContent: "当前设置" }),
        createElement(doc, "div", { textContent: "将改为" }),
      ],
    }),
  );

  changes.forEach((change) => {
    const row = createElement(doc, "div", {
      styles: {
        display: "grid",
        gridTemplateColumns: "1.1fr 1fr 1fr",
        gap: "10px",
        padding: "12px 14px",
        borderTop: "1px solid rgba(89, 192, 188, 0.18)",
        fontSize: "13px",
        alignItems: "center",
      },
    });
    row.appendChild(
      createElement(doc, "strong", { textContent: change.label }),
    );
    row.appendChild(createMutedCell(doc, change.before));
    row.appendChild(createElement(doc, "div", { textContent: change.after }));
    list.appendChild(row);
  });

  const warning = createElement(doc, "div", {
    textContent: `确认后会立即保存这些设置，并启动自动扫描。原有其它模型端点会保留在 ${preset.name} 后面。`,
    styles: {
      marginTop: "14px",
      padding: "12px 14px",
      backgroundColor: "rgba(255, 152, 0, 0.1)",
      border: "1px solid rgba(255, 152, 0, 0.25)",
      borderRadius: "8px",
      color: "#8a5a00",
      fontSize: "13px",
      lineHeight: "1.5",
    },
  });

  const backButton = createStyledButton("上一步", "#607d8b", "medium");
  backButton.addEventListener("click", () =>
    renderSetupPresetGuideStep(doc, modal, close, preset),
  );
  const applyButton = createStyledButton("确认并应用", "#00a67e", "medium");
  applyButton.addEventListener("click", () => {
    preset.apply(values);
    new ztoolkit.ProgressWindow("一键初始化配置", { closeTime: 3000 })
      .createLine({ text: preset.successMessage, type: "success" })
      .show();
    close();
  });

  modal.appendChild(
    createWizardShell(
      doc,
      "保存并应用配置",
      `请检查即将修改的配置清单。确认后，插件会切换到 ${preset.name} 新手推荐配置。`,
      [list, warning],
      [backButton, applyButton],
      close,
    ),
  );
}

function createWizardShell(
  doc: Document,
  title: string,
  subtitle: string,
  content: HTMLElement[],
  actions: HTMLButtonElement[],
  close: () => void,
): HTMLElement {
  const shell = createElement(doc, "div", {
    styles: {
      padding: "24px",
    },
  });
  const closeButton = createStyledButton("×", "#9e9e9e", "small");
  Object.assign(closeButton.style, {
    width: "34px",
    height: "34px",
    padding: "0",
    fontSize: "20px",
  });
  closeButton.addEventListener("click", close);

  const header = createElement(doc, "div", {
    styles: {
      position: "relative",
      display: "flex",
      justifyContent: "space-between",
      gap: "16px",
      alignItems: "flex-start",
      marginBottom: "18px",
    },
    children: [
      createElement(doc, "div", {
        children: [
          createElement(doc, "h2", {
            textContent: title,
            styles: {
              margin: "0 0 8px 0",
              color: "#00a67e",
              fontSize: "22px",
            },
          }),
          createElement(doc, "div", {
            textContent: subtitle,
            styles: {
              color: "var(--ai-text-muted, #666)",
              fontSize: "14px",
              lineHeight: "1.6",
            },
          }),
        ],
      }),
      closeButton,
    ],
  });

  const body = createElement(doc, "div", {
    styles: {
      position: "relative",
      display: "flex",
      flexDirection: "column",
      gap: "14px",
    },
    children: content,
  });

  const footer = createElement(doc, "div", {
    styles: {
      position: "relative",
      display: "flex",
      justifyContent: "flex-end",
      gap: "10px",
      marginTop: "22px",
      flexWrap: "wrap",
    },
    children: actions,
  });

  shell.appendChild(header);
  shell.appendChild(body);
  shell.appendChild(footer);
  return shell;
}

function createPresetCard(
  doc: Document,
  preset: SetupPreset,
  selected: boolean,
): HTMLElement {
  return createElement(doc, "div", {
    styles: {
      padding: "18px",
      border: `${selected ? 2 : 1}px solid ${selected ? "#00a67e" : "rgba(89, 192, 188, 0.25)"}`,
      borderRadius: "12px",
      backgroundColor: selected
        ? "rgba(0, 166, 126, 0.08)"
        : "rgba(89, 192, 188, 0.04)",
      cursor: "pointer",
    },
    children: [
      createElement(doc, "div", {
        textContent: `${selected ? "✅" : "○"} ${preset.title}`,
        styles: {
          fontSize: "18px",
          fontWeight: "700",
          marginBottom: "8px",
        },
      }),
      createElement(doc, "div", {
        textContent: preset.description,
        styles: {
          color: "var(--ai-text-muted, #666)",
          fontSize: "14px",
          lineHeight: "1.6",
        },
      }),
    ],
  });
}

function createGuideList(
  doc: Document,
  items: Array<{ title: string; detail: string; url?: string }>,
): HTMLElement {
  const list = createElement(doc, "div", {
    styles: {
      position: "relative",
      display: "flex",
      flexDirection: "column",
      gap: "10px",
    },
  });
  items.forEach((item, index) => {
    const row = createElement(doc, "div", {
      styles: {
        display: "grid",
        gridTemplateColumns: "34px minmax(0, 1fr) auto",
        gap: "12px",
        alignItems: "center",
        padding: "12px",
        border: "1px solid rgba(89, 192, 188, 0.2)",
        borderRadius: "10px",
      },
    });
    row.appendChild(
      createElement(doc, "div", {
        textContent: String(index + 1),
        styles: {
          width: "30px",
          height: "30px",
          borderRadius: "999px",
          backgroundColor: "#00a67e",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: "700",
        },
      }),
    );
    row.appendChild(
      createElement(doc, "div", {
        styles: { minWidth: "0" },
        children: [
          createElement(doc, "div", {
            textContent: item.title,
            styles: { fontWeight: "700", marginBottom: "4px" },
          }),
          createElement(doc, "div", {
            textContent: item.detail,
            styles: {
              fontSize: "13px",
              color: "var(--ai-text-muted, #666)",
              lineHeight: "1.5",
            },
          }),
        ],
      }),
    );
    if (item.url) {
      const link = createElement(doc, "button", {
        textContent: "打开",
        styles: {
          border: "none",
          background: "transparent",
          color: "#00a67e",
          fontWeight: "700",
          textDecoration: "none",
          cursor: "pointer",
          padding: "6px 8px",
        },
      });
      link.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openExternalUrl(item.url!);
      });
      row.appendChild(link);
    } else {
      row.appendChild(createElement(doc, "span"));
    }
    list.appendChild(row);
  });
  return list;
}

export function openExternalUrl(url: string): void {
  try {
    if ((Zotero as any).launchURL) {
      (Zotero as any).launchURL(url);
      return;
    }
    const win = Zotero.getMainWindow() as any;
    if (win?.ZoteroPane?.loadURI) {
      win.ZoteroPane.loadURI(url);
      return;
    }
    if (win?.openTrustedLinkIn) {
      win.openTrustedLinkIn(url, "tab");
      return;
    }
    win?.open?.(url, "_blank");
  } catch (error) {
    ztoolkit.log("[AI-Butler] 打开外部链接失败:", error);
    new ztoolkit.ProgressWindow("AI Butler", { closeTime: 3000 })
      .createLine({ text: `无法打开链接：${url}`, type: "fail" })
      .show();
  }
}

async function fetchSetupPresetModels(
  doc: Document,
  preset: SetupPreset,
  apiKey: string,
  modelInput: HTMLInputElement,
  status: HTMLElement,
  modelList: HTMLElement,
  button: HTMLButtonElement,
): Promise<void> {
  if (!apiKey) {
    status.style.color = "#b71c1c";
    status.textContent = `请先填写 ${preset.name} API Key`;
    return;
  }

  const previousText = button.textContent || "获取模型";
  button.disabled = true;
  button.textContent = "获取中...";
  button.style.opacity = "0.75";
  status.style.color = "var(--ai-text-muted, #666)";
  status.textContent = "正在获取模型列表...";
  modelList.style.display = "none";

  try {
    const models = await LLMClient.listModels(preset.endpoint.providerType, {
      apiUrl: preset.endpoint.apiUrl,
      apiKey,
      model: modelInput.value.trim() || preset.endpoint.model,
      requestTimeoutMs: 30000,
    });
    if (models.length === 0) throw new Error("供应商未返回可用模型");

    modelList.innerHTML = "";
    models.forEach((model) => {
      const item = createElement(doc, "button", {
        textContent: formatSetupPresetModelLabel(model),
        styles: {
          width: "100%",
          padding: "9px 12px",
          border: "none",
          borderBottom: "1px solid rgba(89, 192, 188, 0.12)",
          background: "transparent",
          color: "var(--ai-text, #222)",
          cursor: "pointer",
          textAlign: "left",
          fontSize: "13px",
        },
      });
      item.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        modelInput.value = model.id;
        modelList.style.display = "none";
        status.style.color = "#2e7d32";
        status.textContent = `已选择模型：${model.id}`;
      });
      modelList.appendChild(item);
    });
    modelList.style.display = "block";
    status.style.color = "#2e7d32";
    status.textContent = `已获取 ${models.length} 个模型，请选择一个模型。`;
  } catch (error: any) {
    const message = error?.message || String(error);
    status.style.color = "#b71c1c";
    status.textContent = `获取失败：${message}`;
    new ztoolkit.ProgressWindow("模型列表", { closeTime: 3500 })
      .createLine({ text: `❌ ${message}`, type: "fail" })
      .show();
  } finally {
    button.disabled = false;
    button.textContent = previousText;
    button.style.opacity = "1";
  }
}

function formatSetupPresetModelLabel(model: {
  id: string;
  name?: string;
  contextLength?: number;
}): string {
  const parts = [model.id];
  if (model.name && model.name !== model.id) parts.push(model.name);
  if (model.contextLength)
    parts.push(`${model.contextLength.toLocaleString()} ctx`);
  return parts.join(" · ");
}

function createMutedCell(doc: Document, text: string): HTMLElement {
  return createElement(doc, "div", {
    textContent: text,
    styles: {
      color: "var(--ai-text-muted, #777)",
      overflow: "hidden",
      textOverflow: "ellipsis",
    },
  });
}

function getSelectedSetupPreset(): SetupPreset {
  return (
    setupPresets.find((preset) => preset.id === selectedSetupPresetId) ||
    setupPresets[0]
  );
}
