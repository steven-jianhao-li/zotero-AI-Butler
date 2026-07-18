/**
 * 一图总结设置页面
 *
 * 提供 Nano-Banana Pro (Gemini Image) 生图 API 配置管理界面
 *
 * @file ImageSummarySettingsPage.ts
 * @author AI Butler Team
 */

import { getPref, setPref } from "../../../utils/prefs";
import { getString } from "../../../utils/locale";
import {
  createStyledButton,
  createFormGroup,
  createInput,
  createSelect,
  createTextarea,
  createCheckbox,
  createSectionTitle,
  createNotice,
} from "../ui/components";
import {
  getDefaultImageSummaryPrompt,
  getDefaultImageGenerationPrompt,
  getConfiguredImageSummaryPrompt,
  getConfiguredImageGenerationPrompt,
} from "../../../utils/prompts";
import { ImageClient, ImageGenerationError } from "../../imageClient";

/**
 * 一图总结设置页面类
 */
export class ImageSummarySettingsPage {
  private container: HTMLElement;
  private endpointPreviewUpdaters: Array<() => void> = [];

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /**
   * 渲染页面
   */
  public render(): void {
    this.container.innerHTML = "";
    this.endpointPreviewUpdaters = [];

    const title = this.createPageTitle(
      getString("settings-image-summary-title"),
    );
    this.container.appendChild(title);

    this.container.appendChild(
      createNotice(getString("settings-image-summary-description"), "info"),
    );

    const form = this.createElement("div", {
      styles: {
        maxWidth: "880px",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
      },
    });

    form.appendChild(this.createPresetPanel());

    const apiCard = this.createSettingsCard(
      getString("settings-image-summary-api-title"),
      getString("settings-image-summary-api-description"),
    );

    const requestModeValue =
      (getPref("imageSummaryRequestMode" as any) as string) || "gemini";
    const requestModeSelect = createSelect(
      "imageSummaryRequestMode",
      [
        {
          value: "gemini",
          label: getString("settings-image-summary-request-mode-gemini"),
        },
        {
          value: "openai",
          label: getString("settings-image-summary-request-mode-openai"),
        },
      ],
      requestModeValue,
      (newVal) => {
        const urlInput = this.container.querySelector(
          "#setting-imageSummaryApiUrl",
        ) as HTMLInputElement | null;
        if (!urlInput) return;
        const cur = (urlInput.value || "").trim();
        const isDefaultGemini =
          !cur || cur === "https://generativelanguage.googleapis.com";
        const isDefaultOpenAI =
          cur === "https://api.openai.com/v1/chat/completions" ||
          cur === "https://api.openai.com/v1/responses" ||
          cur === "https://api.openai.com/v1/images/generations";
        if (newVal === "openai" && isDefaultGemini) {
          urlInput.value = "https://api.openai.com/v1/images/generations";
        }
        if (newVal === "gemini" && (isDefaultOpenAI || !cur)) {
          urlInput.value = "https://generativelanguage.googleapis.com";
        }
        this.refreshEndpointPreviews();
      },
    );
    apiCard.body.appendChild(
      createFormGroup(
        getString("settings-image-summary-request-mode"),
        requestModeSelect,
        getString("settings-image-summary-request-mode-help"),
      ),
    );

    apiCard.body.appendChild(
      createFormGroup(
        getString("settings-image-summary-api-key-label"),
        this.createPasswordInput(
          "imageSummaryApiKey",
          (getPref("imageSummaryApiKey" as any) as string) || "",
          getString("settings-image-summary-api-key-placeholder"),
        ),
        getString("settings-image-summary-api-key-help"),
      ),
    );

    apiCard.body.appendChild(
      this.createEndpointFormGroup(
        getString("settings-image-summary-api-url"),
        "imageSummaryApiUrl",
        (getPref("imageSummaryApiUrl" as any) as string) ||
          (requestModeValue === "openai"
            ? "https://api.openai.com/v1/images/generations"
            : "https://generativelanguage.googleapis.com"),
        requestModeValue === "openai"
          ? "https://api.openai.com/v1/images/generations"
          : "https://generativelanguage.googleapis.com",
      ),
    );

    apiCard.body.appendChild(
      createFormGroup(
        getString("settings-image-summary-extra-headers"),
        createTextarea(
          "imageSummaryCustomHeaders",
          (getPref("imageSummaryCustomHeaders" as any) as string) || "",
          4,
          '{"X-ModelScope-Async-Mode": "true"}',
        ),
        getString("settings-image-summary-extra-headers-help"),
      ),
    );

    apiCard.body.appendChild(
      createFormGroup(
        getString("settings-image-summary-model"),
        createInput(
          "imageSummaryModel",
          "text",
          (getPref("imageSummaryModel" as any) as string) ||
            "gemini-3-pro-image-preview",
          "gemini-3-pro-image-preview",
        ),
        getString("settings-image-summary-model-help"),
      ),
    );

    const timeoutInput = createInput(
      "imageSummaryRequestTimeoutSeconds",
      "number",
      String(ImageClient.getImageSummaryRequestTimeoutSeconds()),
      "600",
    );
    timeoutInput.min = "30";
    timeoutInput.step = "1";
    apiCard.body.appendChild(
      createFormGroup(
        getString("settings-image-summary-timeout"),
        timeoutInput,
        getString("settings-image-summary-timeout-help"),
      ),
    );
    form.appendChild(apiCard.card);

    const generationCard = this.createSettingsCard(
      getString("settings-image-summary-generation-title"),
      getString("settings-image-summary-generation-description"),
    );

    generationCard.body.appendChild(
      createFormGroup(
        getString("settings-image-summary-language"),
        createInput(
          "imageSummaryLanguage",
          "text",
          (getPref("imageSummaryLanguage" as any) as string) ||
            getString("settings-image-summary-default-language"),
          getString("settings-image-summary-default-language"),
        ),
        getString("settings-image-summary-language-help"),
      ),
    );

    generationCard.body.appendChild(
      createFormGroup(
        getString("settings-image-summary-enable-aspect-ratio"),
        createCheckbox(
          "imageSummaryAspectRatioEnabled",
          (getPref("imageSummaryAspectRatioEnabled" as any) as boolean) ??
            false,
        ),
        getString("settings-image-summary-enable-aspect-ratio-help"),
      ),
    );

    generationCard.body.appendChild(
      createFormGroup(
        getString("settings-image-summary-aspect-ratio"),
        createInput(
          "imageSummaryAspectRatio",
          "text",
          (getPref("imageSummaryAspectRatio" as any) as string) || "16:9",
          "16:9",
        ),
        getString("settings-image-summary-aspect-ratio-help"),
      ),
    );

    generationCard.body.appendChild(
      createFormGroup(
        getString("settings-image-summary-enable-resolution"),
        createCheckbox(
          "imageSummaryResolutionEnabled",
          (getPref("imageSummaryResolutionEnabled" as any) as boolean) ?? false,
        ),
        getString("settings-image-summary-enable-resolution-help"),
      ),
    );

    generationCard.body.appendChild(
      createFormGroup(
        getString("settings-image-summary-resolution"),
        this.createResolutionSetting(),
        getString("settings-image-summary-resolution-help"),
      ),
    );

    generationCard.body.appendChild(
      createFormGroup(
        getString("settings-image-summary-use-existing-note"),
        createCheckbox(
          "imageSummaryUseExistingNote",
          (getPref("imageSummaryUseExistingNote" as any) as boolean) || false,
        ),
        getString("settings-image-summary-use-existing-note-help"),
      ),
    );

    const autoSummaryContainer = createCheckbox(
      "autoImageSummaryOnComplete",
      (getPref("autoImageSummaryOnComplete" as any) as boolean) || false,
    );
    const autoSummaryCheckbox = autoSummaryContainer.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    const autoSummaryLabel = autoSummaryContainer.querySelector(
      "span",
    ) as HTMLSpanElement;

    if (autoSummaryCheckbox) {
      autoSummaryCheckbox.addEventListener("change", () => {
        if (autoSummaryCheckbox.checked) {
          const confirmed = this.showCostWarningDialog();
          if (!confirmed) {
            autoSummaryCheckbox.checked = false;
            if (autoSummaryLabel) {
              autoSummaryLabel.textContent = getString(
                "settings-image-summary-disabled",
              );
            }
          } else {
            if (autoSummaryLabel) {
              autoSummaryLabel.textContent = getString(
                "settings-image-summary-enabled",
              );
            }
            setPref("autoImageSummaryOnComplete" as any, true);
          }
        } else {
          if (autoSummaryLabel) {
            autoSummaryLabel.textContent = getString(
              "settings-image-summary-disabled",
            );
          }
          setPref("autoImageSummaryOnComplete" as any, false);
        }
      });
    }

    generationCard.body.appendChild(
      createFormGroup(
        getString("settings-image-summary-auto-add"),
        autoSummaryContainer,
        getString("settings-image-summary-auto-add-help"),
      ),
    );
    form.appendChild(generationCard.card);

    const promptCard = this.createSettingsCard(
      getString("settings-image-summary-prompt-title"),
      getString("settings-image-summary-prompt-description"),
    );

    // 变量说明
    const varsNotice = this.createElement("div", {
      styles: {
        padding: "12px 16px",
        backgroundColor: "#fff3e0",
        border: "1px solid #ffcc80",
        borderRadius: "6px",
        marginBottom: "16px",
        fontSize: "13px",
        color: "#e65100",
      },
    });
    varsNotice.innerHTML = getString(
      "settings-image-summary-available-variables",
    );
    promptCard.body.appendChild(varsNotice);

    // 视觉信息提取提示词
    promptCard.body.appendChild(
      createFormGroup(
        getString("settings-image-summary-visual-prompt"),
        createTextarea(
          "imageSummaryPrompt",
          getConfiguredImageSummaryPrompt(
            getPref("imageSummaryPrompt" as any) as string,
          ),
          10,
          getString("settings-image-summary-visual-prompt-placeholder"),
        ),
        getString("settings-image-summary-visual-prompt-help"),
      ),
    );

    // 生图提示词
    promptCard.body.appendChild(
      createFormGroup(
        getString("settings-image-summary-image-prompt"),
        createTextarea(
          "imageSummaryImagePrompt",
          getConfiguredImageGenerationPrompt(
            getPref("imageSummaryImagePrompt" as any) as string,
          ),
          12,
          getString("settings-image-summary-image-prompt-placeholder"),
        ),
        getString("settings-image-summary-image-prompt-help"),
      ),
    );

    form.appendChild(promptCard.card);

    // 按钮组
    const buttonGroup = this.createElement("div", {
      styles: {
        display: "flex",
        gap: "12px",
        marginTop: "30px",
        paddingTop: "20px",
        borderTop: "1px solid #eee",
      },
    });

    // 测试连接按钮
    const testButton = createStyledButton(
      getString("settings-image-summary-test-api"),
      "#2196f3",
      "medium",
    );
    testButton.addEventListener("click", () => this.testConnection());
    buttonGroup.appendChild(testButton);

    // 保存按钮
    const saveButton = createStyledButton(
      getString("settings-image-summary-save-settings"),
      "#4caf50",
      "medium",
    );
    saveButton.addEventListener("click", () => this.saveSettings());
    buttonGroup.appendChild(saveButton);

    // 重置提示词按钮
    const resetButton = createStyledButton(
      getString("settings-image-summary-reset-prompts"),
      "#9e9e9e",
      "medium",
    );
    resetButton.addEventListener("click", () => this.resetPrompts());
    buttonGroup.appendChild(resetButton);

    form.appendChild(buttonGroup);

    // 测试结果展示区域（防止进度窗文本过长被截断）
    const resultBox = this.createElement("div", {
      id: "image-summary-test-result",
      styles: {
        display: "none",
        marginTop: "12px",
        padding: "12px 14px",
        borderRadius: "6px",
        backgroundColor: "#fff8e1",
        border: "1px solid #ffe082",
      },
    });
    // 标题 + 复制按钮
    const resultTitle = this.createElement("div", {
      styles: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
        marginBottom: "6px",
      },
    });
    const resultTitleText = this.createElement("span", {
      textContent: getString("settings-image-summary-test-result-title"),
      styles: { fontSize: "13px", fontWeight: "600" },
    });
    // 按钮容器
    const buttonContainer = this.createElement("div", {
      styles: { display: "flex", gap: "8px" },
    });
    const copyBtn = this.createElement("button", {
      textContent: getString("settings-image-summary-copy-details"),
      styles: {
        border: "1px solid #ddd",
        background: "#fff",
        color: "#333",
        borderRadius: "4px",
        padding: "4px 8px",
        cursor: "pointer",
        fontSize: "12px",
      },
    }) as HTMLButtonElement;
    copyBtn.type = "button";
    copyBtn.addEventListener("click", async () => {
      const resultPre = this.container.querySelector(
        "#image-summary-test-result-text",
      ) as HTMLElement | null;
      const text = (resultPre?.textContent || "").toString();
      const win = Zotero.getMainWindow() as any;
      const doc = win?.document as Document | undefined;
      const nav = (win as any)?.navigator as any;
      try {
        if (nav?.clipboard?.writeText) {
          await nav.clipboard.writeText(text);
        } else {
          throw new Error("clipboard api unavailable");
        }
        new ztoolkit.ProgressWindow(
          getString("settings-image-summary-progress-title"),
          { closeTime: 1500 },
        )
          .createLine({
            text: getString("settings-image-summary-error-details-copied"),
            type: "success",
          })
          .show();
      } catch {
        try {
          if (!doc) throw new Error("no document");
          const tmp = doc.createElement("textarea");
          tmp.value = text;
          (tmp.style as any).position = "fixed";
          (tmp.style as any).left = "-9999px";
          (doc.documentElement || doc.body || doc).appendChild(tmp);
          (tmp as any).select?.();
          (doc as any).execCommand?.("copy");
          (tmp as any).remove?.();
          new ztoolkit.ProgressWindow(
            getString("settings-image-summary-progress-title"),
            { closeTime: 1500 },
          )
            .createLine({
              text: getString("settings-image-summary-error-details-copied"),
              type: "success",
            })
            .show();
        } catch {
          new ztoolkit.ProgressWindow(
            getString("settings-image-summary-progress-title"),
            { closeTime: 2500 },
          )
            .createLine({
              text: getString("settings-image-summary-copy-failed"),
              type: "default",
            })
            .show();
        }
      }
    });
    buttonContainer.appendChild(copyBtn);
    resultTitle.appendChild(resultTitleText);
    resultTitle.appendChild(buttonContainer);
    const resultPre = this.createElement("pre", {
      id: "image-summary-test-result-text",
      styles: {
        margin: "0",
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
        maxHeight: "240px",
        overflow: "auto",
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        fontSize: "12px",
        lineHeight: "1.5",
        color: "#5d4037",
      },
    });
    resultBox.appendChild(resultTitle);
    resultBox.appendChild(resultPre);
    form.appendChild(resultBox);

    this.container.appendChild(form);
  }

  private createPageTitle(titleText: string): HTMLElement {
    const title = this.createElement("h2", {
      textContent: titleText,
      styles: {
        color: "#59c0bc",
        marginBottom: "20px",
        fontSize: "20px",
        borderBottom: "2px solid #59c0bc",
        paddingBottom: "10px",
      },
    });
    return title;
  }

  private createSettingsCard(
    titleText: string,
    subtitleText: string,
  ): { card: HTMLElement; body: HTMLElement } {
    const doc = this.container.ownerDocument || Zotero.getMainWindow().document;
    const card = doc.createElement("section");
    Object.assign(card.style, {
      padding: "18px",
      borderRadius: "14px",
      background: "var(--ai-surface, #ffffff)",
      border: "1px solid var(--ai-border, #d7dde5)",
      boxShadow: "0 8px 24px rgba(15, 23, 42, 0.06)",
    });

    const header = doc.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      flexDirection: "column",
      gap: "6px",
      marginBottom: "16px",
      paddingBottom: "12px",
      borderBottom: "1px solid var(--ai-border, #e5e7eb)",
    });

    const title = doc.createElement("div");
    title.textContent = titleText;
    Object.assign(title.style, {
      fontSize: "16px",
      fontWeight: "750",
      color: "var(--ai-text, #1f2937)",
    });
    header.appendChild(title);

    const subtitle = doc.createElement("div");
    subtitle.textContent = subtitleText;
    Object.assign(subtitle.style, {
      fontSize: "12px",
      lineHeight: "1.6",
      color: "var(--ai-text-muted, #6b7280)",
    });
    header.appendChild(subtitle);
    card.appendChild(header);

    const body = doc.createElement("div");
    Object.assign(body.style, {
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr)",
      gap: "2px",
    });
    card.appendChild(body);

    return { card, body };
  }

  private createPresetPanel(): HTMLElement {
    const doc = this.container.ownerDocument || Zotero.getMainWindow().document;
    const panel = doc.createElement("section");
    Object.assign(panel.style, {
      padding: "16px",
      borderRadius: "14px",
      border: "1px solid rgba(156, 39, 176, 0.22)",
      background:
        "linear-gradient(135deg, rgba(156,39,176,0.08), rgba(255,255,255,0)), var(--ai-surface, #ffffff)",
      boxShadow: "0 8px 24px rgba(15, 23, 42, 0.05)",
    });

    const header = doc.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: "16px",
      marginBottom: "12px",
    });

    const copy = doc.createElement("div");
    const title = doc.createElement("div");
    title.textContent = getString("settings-image-summary-quick-start");
    Object.assign(title.style, {
      fontSize: "15px",
      fontWeight: "750",
      color: "var(--ai-text, #1f2937)",
      marginBottom: "4px",
    });
    copy.appendChild(title);

    const desc = doc.createElement("div");
    desc.textContent = getString(
      "settings-image-summary-quick-start-description",
    );
    Object.assign(desc.style, {
      fontSize: "12px",
      lineHeight: "1.6",
      color: "var(--ai-text-muted, #6b7280)",
    });
    copy.appendChild(desc);
    header.appendChild(copy);

    const badge = doc.createElement("span");
    badge.textContent = getString(
      "settings-image-summary-recommended-first-setup",
    );
    Object.assign(badge.style, {
      flex: "0 0 auto",
      padding: "5px 9px",
      borderRadius: "999px",
      fontSize: "11px",
      fontWeight: "700",
      color: "#7b1fa2",
      background: "rgba(156, 39, 176, 0.10)",
      border: "1px solid rgba(156, 39, 176, 0.16)",
    });
    header.appendChild(badge);
    panel.appendChild(header);

    const presetSelect = createSelect(
      "imageSummaryPreset",
      [
        {
          value: "",
          label: getString("settings-image-summary-preset-placeholder"),
        },
        {
          value: "gemini",
          label: getString("settings-image-summary-preset-gemini"),
        },
        {
          value: "openai",
          label: getString("settings-image-summary-preset-openai"),
        },
        {
          value: "agnes21",
          label: getString("settings-image-summary-preset-agnes"),
        },
        {
          value: "dashscope",
          label: getString("settings-image-summary-preset-dashscope"),
        },
      ],
      "",
      (newVal) => this.applyImageProviderPreset(newVal),
    );
    panel.appendChild(presetSelect);

    const note = doc.createElement("div");
    note.textContent = getString("settings-image-summary-preset-note");
    Object.assign(note.style, {
      marginTop: "8px",
      fontSize: "11px",
      lineHeight: "1.5",
      color: "var(--ai-text-muted, #6b7280)",
    });
    panel.appendChild(note);

    return panel;
  }

  private createResolutionSetting(): HTMLElement {
    const doc = this.container.ownerDocument || Zotero.getMainWindow().document;
    const wrapper = doc.createElement("div");
    Object.assign(wrapper.style, {
      display: "flex",
      flexDirection: "column",
      gap: "8px",
    });

    const current =
      ((getPref("imageSummaryResolution" as any) as string) || "1K").trim() ||
      "1K";
    const presets = ["1K", "2K", "4K"];
    const isPreset = presets.includes(current);

    const select = createSelect(
      "imageSummaryResolutionPreset",
      [
        {
          value: "1K",
          label: getString("settings-image-summary-resolution-1k"),
        },
        {
          value: "2K",
          label: getString("settings-image-summary-resolution-2k"),
        },
        {
          value: "4K",
          label: getString("settings-image-summary-resolution-4k"),
        },
        {
          value: "custom",
          label: getString("settings-image-summary-resolution-custom"),
        },
      ],
      isPreset ? current : "custom",
      (value) => this.updateResolutionCustomInputVisibility(value),
    );
    wrapper.appendChild(select);

    const customInput = createInput(
      "imageSummaryResolutionCustom",
      "text",
      isPreset ? "" : current,
      getString("settings-image-summary-resolution-custom-placeholder"),
    );
    customInput.style.display = isPreset ? "none" : "block";
    wrapper.appendChild(customInput);

    return wrapper;
  }

  private updateResolutionCustomInputVisibility(value?: string): void {
    const preset =
      value ||
      ((
        this.container.querySelector(
          "#setting-imageSummaryResolutionPreset",
        ) as any
      )?.getValue?.() as string | undefined) ||
      "1K";
    const customInput = this.container.querySelector(
      "#setting-imageSummaryResolutionCustom",
    ) as HTMLInputElement | null;
    if (customInput) {
      customInput.style.display = preset === "custom" ? "block" : "none";
    }
  }

  private getResolutionSettingValue(): string {
    const presetEl = this.container.querySelector(
      "#setting-imageSummaryResolutionPreset",
    ) as HTMLElement | null;
    const preset =
      (presetEl as any)?.getValue?.() ||
      presetEl?.getAttribute("data-value") ||
      "1K";
    if (preset !== "custom") return String(preset || "1K").trim() || "1K";

    const customInput = this.container.querySelector(
      "#setting-imageSummaryResolutionCustom",
    ) as HTMLInputElement | null;
    return (customInput?.value || "").trim() || "1K";
  }

  private showPresetConfirmDialog(
    presetName: string,
    onConfirm: () => void,
  ): void {
    const doc = this.container.ownerDocument || Zotero.getMainWindow().document;
    this.container
      .querySelectorAll(".ai-butler-image-preset-dialog")
      .forEach((node: Element) => node.remove());

    const overlay = doc.createElement("div");
    overlay.className = "ai-butler-image-preset-dialog";
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
      background: "rgba(15, 23, 42, 0.36)",
      zIndex: "99999",
      boxSizing: "border-box",
      overflow: "auto",
    });

    const dialog = doc.createElement("div");
    Object.assign(dialog.style, {
      width: "min(560px, calc(100vw - 48px))",
      maxHeight: "calc(100vh - 48px)",
      overflow: "auto",
      padding: "18px",
      borderRadius: "12px",
      background: "var(--ai-surface, #ffffff)",
      border: "1px solid var(--ai-border, #d7dde5)",
      boxShadow: "0 18px 50px rgba(15, 23, 42, 0.2)",
      color: "var(--ai-text, #1f2937)",
      boxSizing: "border-box",
    });
    overlay.appendChild(dialog);

    const title = doc.createElement("div");
    title.textContent = getString("settings-image-summary-apply-preset-title");
    Object.assign(title.style, {
      fontSize: "16px",
      fontWeight: "700",
      marginBottom: "12px",
      color: "var(--ai-text, #1f2937)",
    });
    dialog.appendChild(title);

    const message = doc.createElement("div");
    message.innerHTML = getString(
      "settings-image-summary-apply-preset-message",
      {
        args: { preset: this.escapeHtml(presetName) },
      },
    );
    Object.assign(message.style, {
      fontSize: "13px",
      lineHeight: "1.65",
      color: "var(--ai-text-muted, #4b5563)",
      wordBreak: "break-word",
    });
    dialog.appendChild(message);

    const actions = doc.createElement("div");
    Object.assign(actions.style, {
      display: "flex",
      justifyContent: "flex-end",
      gap: "10px",
      marginTop: "18px",
      flexWrap: "wrap",
    });

    const close = () => {
      overlay.remove();
      this.setSelectValue("imageSummaryPreset", "");
    };

    const cancelButton = createStyledButton(
      getString("settings-image-summary-cancel"),
      "#9e9e9e",
      "small",
    );
    cancelButton.addEventListener("click", close);
    actions.appendChild(cancelButton);

    const confirmButton = createStyledButton(
      getString("settings-image-summary-confirm-apply"),
      "#9c27b0",
      "small",
    );
    confirmButton.addEventListener("click", () => {
      overlay.remove();
      onConfirm();
    });
    actions.appendChild(confirmButton);
    dialog.appendChild(actions);

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });
    dialog.addEventListener("click", (event) => event.stopPropagation());

    (doc.body || this.container).appendChild(overlay);
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => {
      switch (char) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case '"':
          return "&quot;";
        case "'":
          return "&#39;";
        default:
          return char;
      }
    });
  }

  private applyImageProviderPreset(preset: string): void {
    if (!preset) return;

    const presetNames: Record<string, string> = {
      gemini: getString("settings-image-summary-preset-gemini"),
      openai: getString("settings-image-summary-preset-openai"),
      agnes21: "Agnes Image 2.1 Flash",
      dashscope: getString("settings-image-summary-preset-dashscope"),
    };
    const presetName = presetNames[preset] || preset;

    this.showPresetConfirmDialog(presetName, () =>
      this.applyImageProviderPresetConfirmed(preset, presetName),
    );
  }

  private applyImageProviderPresetConfirmed(
    preset: string,
    presetName: string,
  ): void {
    const timeoutSeconds = String(
      ImageClient.getImageSummaryRequestTimeoutSeconds(),
    );

    const configs: Record<
      string,
      {
        requestMode: "gemini" | "openai";
        apiUrl: string;
        model: string;
        aspectRatioEnabled: boolean;
        aspectRatio: string;
        resolutionEnabled: boolean;
        resolution: string;
        customHeaders?: string;
      }
    > = {
      gemini: {
        requestMode: "gemini",
        apiUrl: "https://generativelanguage.googleapis.com",
        model: "gemini-3-pro-image-preview",
        aspectRatioEnabled: true,
        aspectRatio: "16:9",
        resolutionEnabled: true,
        resolution: "1K",
      },
      openai: {
        requestMode: "openai",
        apiUrl: "https://api.openai.com/v1/images/generations",
        model: "gpt-image-1",
        aspectRatioEnabled: true,
        aspectRatio: "16:9",
        resolutionEnabled: true,
        resolution: "1K",
      },
      agnes21: {
        requestMode: "openai",
        apiUrl: "https://apihub.agnes-ai.com/v1/images/generations",
        model: "agnes-image-2.1-flash",
        aspectRatioEnabled: true,
        aspectRatio: "16:9",
        resolutionEnabled: true,
        resolution: "2K",
      },
      dashscope: {
        requestMode: "openai",
        apiUrl:
          "https://dashscope.aliyuncs.com/compatible-mode/v1/images/generations",
        model: "qwen-image-2.0",
        aspectRatioEnabled: false,
        aspectRatio: "16:9",
        resolutionEnabled: false,
        resolution: "1K",
      },
    };

    const config = configs[preset];
    if (!config) {
      this.setSelectValue("imageSummaryPreset", "");
      return;
    }

    // 应用预设是一次显式重置：直接写入 prefs 后重新渲染，确保页面和持久化配置同步。
    setPref("imageSummaryRequestMode" as any, config.requestMode);
    setPref("imageSummaryApiKey" as any, "");
    setPref("imageSummaryApiUrl" as any, config.apiUrl);
    setPref("imageSummaryModel" as any, config.model);
    setPref("imageSummaryCustomHeaders" as any, config.customHeaders || "");
    setPref("imageSummaryRequestTimeoutSeconds" as any, timeoutSeconds);
    setPref(
      "imageSummaryLanguage" as any,
      getString("settings-image-summary-default-language"),
    );
    setPref("imageSummaryAspectRatioEnabled" as any, config.aspectRatioEnabled);
    setPref("imageSummaryAspectRatio" as any, config.aspectRatio);
    setPref("imageSummaryResolutionEnabled" as any, config.resolutionEnabled);
    setPref("imageSummaryResolution" as any, config.resolution);
    setPref("imageSummaryUseExistingNote" as any, false);
    setPref("autoImageSummaryOnComplete" as any, false);

    this.render();

    new ztoolkit.ProgressWindow(
      getString("settings-image-summary-progress-title"),
      {
        closeOnClick: true,
        closeTime: 2500,
      },
    )
      .createLine({
        text: getString("settings-image-summary-preset-applied", {
          args: { preset: presetName },
        }),
        type: "success",
      })
      .show();
  }

  private setInputValue(id: string, value: string): void {
    const input = this.container.querySelector("#setting-" + id) as
      | HTMLInputElement
      | HTMLTextAreaElement
      | null;
    if (!input) return;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  private setCheckboxValue(id: string, checked: boolean): void {
    const input = this.container.querySelector(
      "#setting-" + id,
    ) as HTMLInputElement | null;
    if (!input) return;
    input.checked = checked;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  private setSelectValue(id: string, value: string): void {
    const el = this.container.querySelector("#setting-" + id) as any;
    if (!el) return;
    if (typeof el.setValue === "function") el.setValue(value);
    else if ("value" in el) el.value = value;
    el.setAttribute?.("data-value", value);
    el.dispatchEvent?.(new Event("change", { bubbles: true }));
    if (id === "imageSummaryResolutionPreset") {
      this.updateResolutionCustomInputVisibility(value);
    }
  }

  /**
   * 保存设置
   */
  private async saveSettings(): Promise<void> {
    try {
      // 收集所有设置值
      const fields = [
        "imageSummaryApiKey",
        "imageSummaryApiUrl",
        "imageSummaryModel",
        "imageSummaryLanguage",
        "imageSummaryAspectRatio",
        "imageSummaryCustomHeaders",
        "imageSummaryPrompt",
        "imageSummaryImagePrompt",
      ];

      for (const field of fields) {
        const input = this.container.querySelector(`#setting-${field}`) as
          | HTMLInputElement
          | HTMLTextAreaElement;
        if (input) {
          setPref(field as any, input.value.trim() as any);
        }
      }

      const timeoutInput = this.container.querySelector(
        "#setting-imageSummaryRequestTimeoutSeconds",
      ) as HTMLInputElement | null;
      if (timeoutInput) {
        const timeoutSeconds = ImageClient.getImageSummaryRequestTimeoutSeconds(
          timeoutInput.value,
        );
        timeoutInput.value = String(timeoutSeconds);
        setPref(
          "imageSummaryRequestTimeoutSeconds" as any,
          String(timeoutSeconds),
        );
      }

      // 下拉框单独处理 (requestMode)
      const modeSelect = this.container.querySelector(
        "#setting-imageSummaryRequestMode",
      ) as HTMLElement | null;
      if (modeSelect) {
        const modeValue =
          (modeSelect as any).getValue?.() ||
          modeSelect.getAttribute("data-value") ||
          "gemini";
        setPref("imageSummaryRequestMode" as any, modeValue);
      }

      const resolutionValue = this.getResolutionSettingValue();
      setPref("imageSummaryResolution" as any, resolutionValue);

      // 复选框单独处理
      const useExistingCb = this.container.querySelector(
        "#setting-imageSummaryUseExistingNote",
      ) as HTMLInputElement;
      if (useExistingCb) {
        setPref("imageSummaryUseExistingNote" as any, useExistingCb.checked);
      }

      // 自动一图总结复选框
      const autoSummaryCb = this.container.querySelector(
        "#setting-autoImageSummaryOnComplete",
      ) as HTMLInputElement;
      if (autoSummaryCb) {
        setPref("autoImageSummaryOnComplete" as any, autoSummaryCb.checked);
      }

      // 宽高比参数启用复选框
      const aspectRatioEnabledCb = this.container.querySelector(
        "#setting-imageSummaryAspectRatioEnabled",
      ) as HTMLInputElement;
      if (aspectRatioEnabledCb) {
        setPref(
          "imageSummaryAspectRatioEnabled" as any,
          aspectRatioEnabledCb.checked,
        );
      }

      // 分辨率参数启用复选框
      const resolutionEnabledCb = this.container.querySelector(
        "#setting-imageSummaryResolutionEnabled",
      ) as HTMLInputElement;
      if (resolutionEnabledCb) {
        setPref(
          "imageSummaryResolutionEnabled" as any,
          resolutionEnabledCb.checked,
        );
      }

      new ztoolkit.ProgressWindow("AI Butler", {
        closeOnClick: true,
        closeTime: 2000,
      })
        .createLine({
          text: getString("settings-image-summary-settings-saved"),
          type: "success",
        })
        .show();
    } catch (error: any) {
      ztoolkit.log("[AI-Butler] 保存一图总结设置失败:", error);
      new ztoolkit.ProgressWindow("AI Butler", {
        closeOnClick: true,
        closeTime: 3000,
      })
        .createLine({
          text: getString("settings-image-summary-save-failed", {
            args: { message: error.message },
          }),
          type: "error",
        })
        .show();
    }
  }

  /**
   * 测试 API 连接
   */
  private async testConnection(): Promise<void> {
    const modeEl = this.container.querySelector(
      "#setting-imageSummaryRequestMode",
    ) as HTMLElement | null;
    const requestMode =
      (modeEl as any)?.getValue?.() ||
      modeEl?.getAttribute("data-value") ||
      "gemini";

    const apiKey =
      (
        this.container.querySelector(
          "#setting-imageSummaryApiKey",
        ) as HTMLInputElement
      )?.value?.trim() || "";
    const apiUrl =
      (
        this.container.querySelector(
          "#setting-imageSummaryApiUrl",
        ) as HTMLInputElement
      )?.value?.trim() || "https://generativelanguage.googleapis.com";
    const model =
      (
        this.container.querySelector(
          "#setting-imageSummaryModel",
        ) as HTMLInputElement
      )?.value?.trim() || "gemini-3-pro-image-preview";
    const customHeaders =
      (
        this.container.querySelector(
          "#setting-imageSummaryCustomHeaders",
        ) as HTMLTextAreaElement
      )?.value?.trim() || "";
    const requestTimeoutMs = ImageClient.getImageSummaryRequestTimeoutMs(
      (
        this.container.querySelector(
          "#setting-imageSummaryRequestTimeoutSeconds",
        ) as HTMLInputElement | null
      )?.value,
    );

    // 页面内结果区域
    const resultBox = this.container.querySelector(
      "#image-summary-test-result",
    ) as HTMLElement | null;
    const resultPre = this.container.querySelector(
      "#image-summary-test-result-text",
    ) as HTMLElement | null;

    if (!apiKey) {
      if (resultBox && resultPre) {
        resultBox.style.display = "block";
        resultBox.style.backgroundColor = "#ffebee";
        resultBox.style.border = "1px solid #ffcdd2";
        resultPre.style.color = "#b71c1c";
        resultPre.textContent = getString(
          "settings-image-summary-api-key-required",
        );
      }
      return;
    }

    // 显示测试中状态
    if (resultBox && resultPre) {
      resultBox.style.display = "block";
      resultBox.style.backgroundColor = "#fff8e1";
      resultBox.style.border = "1px solid #ffe082";
      resultPre.style.color = "#5d4037";
      resultPre.textContent = getString("settings-image-summary-testing-wait");
    }

    try {
      const result = await ImageClient.generateImage(
        "Generate a simple test image: a blue circle on white background.",
        {
          apiKey,
          apiUrl,
          model,
          requestMode: requestMode as any,
          customHeaders,
          requestTimeoutMs,
        },
      );

      if (resultBox && resultPre) {
        resultBox.style.display = "block";
        resultBox.style.backgroundColor = "#e8f5e9";
        resultBox.style.border = "1px solid #a5d6a7";
        resultPre.style.color = "#1b5e20";
        resultPre.textContent = getString(
          "settings-image-summary-test-success",
          {
            args: {
              mimeType: result.mimeType,
              size: Math.round(result.imageBase64.length / 1024),
            },
          },
        );
      }
    } catch (error: any) {
      ztoolkit.log("[AI-Butler] 一图总结 API 测试失败:", error);

      const fullMsg =
        error instanceof ImageGenerationError
          ? ImageClient.formatError(error)
          : getString("settings-image-summary-error-message", {
              args: {
                message:
                  error?.message ||
                  getString("settings-image-summary-connection-failed"),
              },
            });

      if (resultBox && resultPre) {
        resultBox.style.display = "block";
        resultBox.style.backgroundColor = "#ffebee";
        resultBox.style.border = "1px solid #ffcdd2";
        resultPre.style.color = "#b71c1c";
        resultPre.textContent = fullMsg;
      }
    }
  }

  /**
   * 显示费用警告确认对话框
   * @returns 用户是否确认开启
   */
  private showCostWarningDialog(): boolean {
    const message = getString("settings-image-summary-cost-warning");

    return ztoolkit.getGlobal("confirm")(message);
  }

  /**
   * 重置提示词为默认值
   */
  private resetPrompts(): void {
    const summaryPrompt = this.container.querySelector(
      "#setting-imageSummaryPrompt",
    ) as HTMLTextAreaElement;
    const imagePrompt = this.container.querySelector(
      "#setting-imageSummaryImagePrompt",
    ) as HTMLTextAreaElement;

    if (summaryPrompt) {
      summaryPrompt.value = getDefaultImageSummaryPrompt();
    }
    if (imagePrompt) {
      imagePrompt.value = getDefaultImageGenerationPrompt();
    }

    new ztoolkit.ProgressWindow("AI Butler", {
      closeOnClick: true,
      closeTime: 2000,
    })
      .createLine({
        text: getString("settings-image-summary-prompts-reset"),
        type: "success",
      })
      .show();
  }

  /**
   * 创建元素辅助方法
   */
  private createElement(
    tag: string,
    options: {
      textContent?: string;
      innerHTML?: string;
      styles?: Partial<CSSStyleDeclaration>;
      id?: string;
    } = {},
  ): HTMLElement {
    const doc = this.container.ownerDocument || Zotero.getMainWindow().document;
    const el = doc.createElement(tag);
    if (options.textContent) el.textContent = options.textContent;
    if (options.innerHTML) el.innerHTML = options.innerHTML;
    if (options.id) el.id = options.id;
    if (options.styles) {
      Object.assign(el.style, options.styles);
    }
    return el;
  }

  private createEndpointFormGroup(
    label: string,
    id: string,
    value: string,
    placeholder: string,
  ): HTMLElement {
    const doc = this.container.ownerDocument || Zotero.getMainWindow().document;
    const group = doc.createElement("div");
    Object.assign(group.style, { marginBottom: "24px" });

    const labelRow = doc.createElement("div");
    Object.assign(labelRow.style, {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      marginBottom: "8px",
      width: "100%",
    });

    const labelEl = doc.createElement("label");
    labelEl.textContent = label;
    Object.assign(labelEl.style, {
      fontSize: "14px",
      fontWeight: "600",
      color: "var(--ai-text)",
    });

    const official = this.createEndpointMeta(
      getString("settings-image-summary-official-endpoint", {
        args: { endpoint: "" },
      }),
    );
    official.style.marginLeft = "auto";
    labelRow.appendChild(labelEl);
    labelRow.appendChild(official);

    const input = createInput(id, "text", value, placeholder);
    group.appendChild(labelRow);
    group.appendChild(input);

    const desc = doc.createElement("div");
    Object.assign(desc.style, {
      marginTop: "6px",
      display: "flex",
      alignItems: "center",
      gap: "6px",
      fontSize: "12px",
      color: "var(--ai-text-muted)",
    });

    const required = doc.createElement("span");
    required.textContent = getString("settings-image-summary-required");
    required.style.flex = "0 0 auto";

    const preview = this.createEndpointMeta(
      getString("settings-image-summary-preview", { args: { endpoint: "" } }),
    );
    preview.style.maxWidth = "440px";

    desc.appendChild(required);
    desc.appendChild(preview);
    group.appendChild(desc);

    const update = () => {
      const endpoint = this.buildImageEndpointPreview(id, placeholder);
      const officialEndpoint = this.getImageOfficialEndpoint();
      official.textContent = getString(
        "settings-image-summary-official-endpoint",
        {
          args: { endpoint: officialEndpoint },
        },
      );
      official.title = officialEndpoint;
      preview.textContent = getString("settings-image-summary-preview", {
        args: { endpoint },
      });
      preview.title = endpoint;
    };

    input.addEventListener("input", update);
    input.addEventListener("change", update);
    this.endpointPreviewUpdaters.push(update);

    setTimeout(() => {
      const modelInput = this.container.querySelector(
        "#setting-imageSummaryModel",
      ) as HTMLInputElement | null;
      modelInput?.addEventListener("input", update);
      modelInput?.addEventListener("change", update);
      update();
    }, 0);

    return group;
  }

  private createEndpointMeta(text: string): HTMLElement {
    const doc = this.container.ownerDocument || Zotero.getMainWindow().document;
    const el = doc.createElement("span");
    el.textContent = text;
    Object.assign(el.style, {
      display: "block",
      minWidth: "0",
      maxWidth: "520px",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      fontSize: "12px",
      color: "var(--ai-text-muted)",
    });
    return el;
  }

  private refreshEndpointPreviews(): void {
    setTimeout(() => {
      this.endpointPreviewUpdaters.forEach((update) => update());
    }, 0);
  }

  private buildImageEndpointPreview(urlInputId: string, fallbackUrl: string) {
    const mode = this.getImageRequestMode();
    const input = this.container.querySelector(
      `#setting-${urlInputId}`,
    ) as HTMLInputElement | null;
    const rawUrl = (
      input?.value ||
      fallbackUrl ||
      (mode === "openai"
        ? "https://api.openai.com/v1/images/generations"
        : "https://generativelanguage.googleapis.com")
    )
      .trim()
      .replace(/\/+$/, "");
    const model =
      (
        this.container.querySelector(
          "#setting-imageSummaryModel",
        ) as HTMLInputElement | null
      )?.value?.trim() || "gemini-3-pro-image-preview";

    if (mode === "openai") {
      return this.toOpenAIImageEndpoint(rawUrl);
    }

    const base = rawUrl.replace(/\/v1beta(?:\/.*)?$/i, "");
    return `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  }

  private getImageOfficialEndpoint(): string {
    if (this.getImageRequestMode() === "openai") {
      const model =
        (
          this.container.querySelector(
            "#setting-imageSummaryModel",
          ) as HTMLInputElement | null
        )?.value?.trim() || "";
      if (/^agnes-image(?:$|[-_.:])/i.test(model)) {
        return "https://apihub.agnes-ai.com/v1/images/generations";
      }
      if (/^qwen-image(?:$|[-_.:])/i.test(model)) {
        return "https://dashscope.aliyuncs.com/compatible-mode/v1/images/generations";
      }
      return "https://api.openai.com/v1/images/generations";
    }
    return "https://generativelanguage.googleapis.com";
  }

  private getImageRequestMode(): "gemini" | "openai" {
    const modeEl = this.container.querySelector(
      "#setting-imageSummaryRequestMode",
    ) as HTMLElement | null;
    const value =
      (modeEl as any)?.getValue?.() ||
      modeEl?.getAttribute("data-value") ||
      "gemini";
    return value === "openai" ? "openai" : "gemini";
  }

  private toOpenAIImageEndpoint(url: string): string {
    const raw = url.trim().replace(/\/+$/, "");
    if (!raw) return "";
    if (
      /(\/v1\/(chat\/completions|responses|images\/generations)\b|\/(chat\/completions|responses|images\/generations)\b)/i.test(
        raw,
      )
    ) {
      return raw;
    }
    if (/\/v1$/i.test(raw)) return `${raw}/images/generations`;
    return `${raw}/v1/images/generations`;
  }

  /**
   * 创建密码输入框
   */
  private createPasswordInput(
    id: string,
    value: string,
    placeholder?: string,
  ): HTMLElement {
    const doc = this.container.ownerDocument || Zotero.getMainWindow().document;
    const wrapper = doc.createElement("div");
    wrapper.style.cssText = "display: flex; align-items: center; gap: 8px;";

    const input = createInput(id, "password", value, placeholder);
    input.style.flex = "1";
    wrapper.appendChild(input);

    const toggleBtn = doc.createElement("button");
    toggleBtn.textContent = "👁";
    toggleBtn.title = getString("settings-image-summary-toggle-key");
    toggleBtn.type = "button";
    toggleBtn.style.cssText = `
      border: 1px solid #ddd;
      background: #f5f5f5;
      border-radius: 4px;
      padding: 6px 10px;
      cursor: pointer;
      font-size: 14px;
    `;
    toggleBtn.addEventListener("click", () => {
      const isPassword = input.type === "password";
      input.type = isPassword ? "text" : "password";
      toggleBtn.textContent = isPassword ? "🙈" : "👁";
    });
    wrapper.appendChild(toggleBtn);

    return wrapper;
  }
}

export default ImageSummarySettingsPage;
