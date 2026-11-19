/**
 * 提示词管理页
 *
 * @file PromptsSettingsPage.ts
 */

import { getPref, setPref } from "../../../utils/prefs";
import {
  getConfiguredSummaryPrompt,
  getDefaultPromptLanguagePreference,
  getResolvedDefaultPromptLanguage,
  getDefaultSummaryPrompt,
  getDefaultTableTemplate,
  getDefaultTableFillPrompt,
  getDefaultTableReviewPrompt,
  getConfiguredTableTemplate,
  getConfiguredTableFillPrompt,
  getConfiguredTableReviewPrompt,
  isKnownDefaultSummaryPrompt,
  PROMPT_VERSION,
  getDefaultMultiRoundPromptTemplate,
  DEFAULT_MULTI_ROUND_PLANNING_PROMPT,
  getBuiltinMultiRoundPromptTemplates,
  parseMultiRoundPromptTemplates,
  mergeMultiRoundPromptTemplates,
  parseMultiRoundPromptTemplateExport,
  serializeMultiRoundPromptTemplate,
  type MultiRoundContextStrategy,
  type MultiRoundPromptItem,
  type MultiRoundPromptTemplate,
  type MultiRoundPromptPhase,
} from "../../../utils/prompts";
import {
  createFormGroup,
  createInput,
  createTextarea,
  createSelect,
  createStyledButton,
  createSectionTitle,
  createNotice,
  createCheckbox,
} from "../ui/components";
import { getString } from "../../../utils/locale";
import {
  getPromptLanguageOptions,
  normalizePromptLanguageSelection,
} from "../../../utils/promptLanguageSelect";

type PresetMap = Record<string, string>;
type PromptSettingsKind = "summary" | "deepRead" | "table" | "all";
const CURRENT_MULTI_ROUND_TEMPLATE_ID = "__current_multi_round_template__";
const MULTI_ROUND_TEMPLATE_ID_PREF = "multiRoundPromptTemplateId";
const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

export class PromptsSettingsPage {
  private container: HTMLElement;
  private pageKind: PromptSettingsKind;

  // UI refs
  private presetSelect!: HTMLElement; // 自定义下拉框
  private btnSaveCurrentTemplate!: HTMLButtonElement;
  private editor!: HTMLTextAreaElement;
  private previewBox!: HTMLElement;
  private sampleTitle!: HTMLInputElement;
  private sampleAuthors!: HTMLInputElement;
  private sampleYear!: HTMLInputElement;
  private multiRoundTemplateSelect!: HTMLElement;
  private selectedMultiRoundTemplateId: string | null = null;

  constructor(container: HTMLElement, pageKind: PromptSettingsKind = "all") {
    this.container = container;
    this.pageKind = pageKind;
  }

  private shouldRender(kind: Exclude<PromptSettingsKind, "all">): boolean {
    return this.pageKind === "all" || this.pageKind === kind;
  }

  private getPageTitle(): string {
    switch (this.pageKind) {
      case "summary":
        return getString("settings-prompts-title-summary");
      case "deepRead":
        return getString("settings-prompts-title-deep-read");
      case "table":
        return getString("settings-prompts-title-table");
      default:
        return getString("settings-prompts-title-all");
    }
  }

  private getPageNotice(): string {
    switch (this.pageKind) {
      case "summary":
        return getString("settings-prompts-notice-summary");
      case "deepRead":
        return getString("settings-prompts-notice-deep-read");
      case "table":
        return getString("settings-prompts-notice-table");
      default:
        return getString("settings-prompts-notice-all");
    }
  }

  public render(): void {
    this.container.innerHTML = "";

    // 内容包装器 - 限制最大宽度，防止内容撑开容器
    const contentWrapper = Zotero.getMainWindow().document.createElement("div");
    Object.assign(contentWrapper.style, {
      maxWidth:
        this.pageKind === "summary" || this.pageKind === "all"
          ? "980px"
          : "680px",
      width: "100%",
    });
    this.container.appendChild(contentWrapper);

    // 标题
    const title = Zotero.getMainWindow().document.createElement("h2");
    title.textContent = this.getPageTitle();
    Object.assign(title.style, {
      color: "#59c0bc",
      marginBottom: "20px",
      fontSize: "20px",
      borderBottom: "2px solid #59c0bc",
      paddingBottom: "10px",
    });
    contentWrapper.appendChild(title);

    contentWrapper.appendChild(createNotice(this.getPageNotice(), "info"));
    contentWrapper.appendChild(this.renderDefaultPromptLanguageSetting());

    // =========== AI 精读提示词设置 ===========
    const modeSection = Zotero.getMainWindow().document.createElement("div");
    Object.assign(modeSection.style, {
      marginBottom: "24px",
    });

    if (this.pageKind === "all") {
      modeSection.appendChild(
        createNotice(getString("settings-prompts-notice-deep-read"), "info"),
      );
    }

    const multiRoundContainer =
      Zotero.getMainWindow().document.createElement("div");
    multiRoundContainer.id = "multi-round-settings";
    Object.assign(multiRoundContainer.style, {
      marginTop: "16px",
      display: "block",
    });

    const multiRoundHeader =
      Zotero.getMainWindow().document.createElement("div");
    Object.assign(multiRoundHeader.style, {
      display: "flex",
      alignItems: "center",
      marginBottom: "10px",
      justifyContent: "space-between",
      gap: "12px",
      flexWrap: "wrap",
    });

    const multiRoundTitle = Zotero.getMainWindow().document.createElement("h4");
    multiRoundTitle.textContent = getString(
      "settings-prompts-multi-round-title",
    );
    Object.assign(multiRoundTitle.style, {
      color: "#59c0bc",
      margin: "0",
      fontSize: "14px",
      whiteSpace: "nowrap",
    });
    multiRoundHeader.appendChild(multiRoundTitle);
    multiRoundHeader.appendChild(this.renderMultiRoundManagementActions());

    multiRoundContainer.appendChild(multiRoundHeader);

    multiRoundContainer.appendChild(this.renderMultiRoundTemplateControls([]));
    multiRoundContainer.appendChild(this.renderDeepReadV2Settings());
    multiRoundContainer.appendChild(this.renderMultiRoundPromptActions());
    modeSection.appendChild(multiRoundContainer);

    if (this.pageKind === "deepRead") {
      contentWrapper.appendChild(modeSection);
      return;
    }

    if (this.pageKind === "table") {
      this.renderTableSettings(contentWrapper);
      return;
    }

    // =========== AI 总结提示词设置 ===========
    const summarySection = Zotero.getMainWindow().document.createElement("div");
    Object.assign(summarySection.style, {
      marginBottom: "24px",
    });
    if (this.shouldRender("summary")) {
      contentWrapper.appendChild(summarySection);
    }

    const layout = Zotero.getMainWindow().document.createElement("div");
    layout.id = "single-round-settings";
    Object.assign(layout.style, {
      display: "grid",
      gridTemplateColumns: "minmax(280px, 320px) minmax(360px, 1fr)",
      gap: "18px",
      alignItems: "start",
    });
    summarySection.appendChild(layout);

    // 左侧: 模板选择与示例变量
    const left = Zotero.getMainWindow().document.createElement("div");
    left.appendChild(
      this.createSummaryPanelHeading(
        getString("settings-prompts-template-library-title"),
        getString("settings-prompts-template-library-subtitle"),
      ),
    );
    Object.assign(left.style, this.getSummaryPanelStyle());
    layout.appendChild(left);

    // 预设选择
    const presets = this.getAllPresets();
    const currentPrompt = getConfiguredSummaryPrompt(
      getPref("summaryPrompt") as string,
    );
    const presetOptions = Object.keys(presets).map((name) => ({
      value: name,
      label: name,
    }));
    this.presetSelect = createSelect(
      "prompt-preset",
      presetOptions,
      this.detectPresetName(currentPrompt, presets),
      (newValue) => {
        // 当下拉框值改变时，自动加载预设到编辑器
        this.loadPresetToEditor();
      },
    ) as any;
    left.appendChild(
      createFormGroup(
        getString("settings-prompts-select-preset-label"),
        this.presetSelect,
        getString("settings-prompts-select-preset-help"),
      ),
    );

    // 预设管理：切换即应用，按钮只保留管理动作，避免 Apply/Save 的双重语义。
    const presetBtnCol = Zotero.getMainWindow().document.createElement("div");
    Object.assign(presetBtnCol.style, {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "10px",
      marginBottom: "16px",
    });

    const btnNewPreset = createStyledButton(
      getString("settings-prompts-new-preset"),
      "#2e7d32",
    );
    const btnDeletePreset = createStyledButton(
      getString("settings-prompts-delete-preset"),
      "#f44336",
    );
    const btnRestoreBuiltins = createStyledButton(
      getString("settings-prompts-restore-builtins"),
      "#607d8b",
    );
    Object.assign(btnRestoreBuiltins.style, { gridColumn: "1 / -1" });

    [btnNewPreset, btnDeletePreset, btnRestoreBuiltins].forEach((button) => {
      Object.assign(button.style, {
        width: "100%",
        padding: "11px 14px",
        fontSize: "13px",
        borderRadius: "10px",
      });
    });
    btnNewPreset.addEventListener("click", () => this.createSummaryPreset());
    btnDeletePreset.addEventListener("click", () => this.deleteCustomPreset());
    btnRestoreBuiltins.addEventListener("click", () =>
      this.restoreBuiltinSummaryPresets(),
    );

    presetBtnCol.appendChild(btnNewPreset);
    presetBtnCol.appendChild(btnDeletePreset);
    presetBtnCol.appendChild(btnRestoreBuiltins);
    left.appendChild(presetBtnCol);

    // 示例变量输入
    left.appendChild(
      createSectionTitle(getString("settings-prompts-sample-metadata-title")),
    );
    this.sampleTitle = createInput(
      "sample-title",
      "text",
      "A Great Paper",
      getString("settings-prompts-sample-title-placeholder"),
    );
    left.appendChild(
      createFormGroup(
        getString("settings-prompts-sample-title-label"),
        this.sampleTitle,
      ),
    );
    this.sampleAuthors = createInput(
      "sample-authors",
      "text",
      "Alice; Bob",
      getString("settings-prompts-sample-authors-placeholder"),
    );
    left.appendChild(
      createFormGroup(
        getString("settings-prompts-sample-authors-label"),
        this.sampleAuthors,
      ),
    );
    this.sampleYear = createInput(
      "sample-year",
      "text",
      "2024",
      getString("settings-prompts-sample-year-placeholder"),
    );
    left.appendChild(
      createFormGroup(
        getString("settings-prompts-sample-year-label"),
        this.sampleYear,
      ),
    );

    // 右侧: 编辑器 + 操作 + 预览
    const right = Zotero.getMainWindow().document.createElement("div");
    right.appendChild(
      this.createSummaryPanelHeading(
        getString("settings-prompts-editor-panel-title"),
        getString("settings-prompts-editor-panel-subtitle"),
      ),
    );
    Object.assign(right.style, this.getSummaryPanelStyle());
    layout.appendChild(right);

    this.editor = createTextarea(
      "prompt-editor",
      currentPrompt,
      18,
      getString("settings-prompts-editor-placeholder"),
    );
    right.appendChild(
      createFormGroup(
        getString("settings-prompts-editor-label"),
        this.editor,
        getString("settings-prompts-editor-help"),
      ),
    );

    // 操作按钮
    const actionRow = Zotero.getMainWindow().document.createElement("div");
    Object.assign(actionRow.style, {
      display: "flex",
      gap: "10px",
      marginTop: "8px",
      marginBottom: "16px",
      flexWrap: "wrap",
    });
    this.btnSaveCurrentTemplate = createStyledButton(
      getString("settings-prompts-save-current-template"),
      "#4caf50",
    ) as HTMLButtonElement;
    this.btnSaveCurrentTemplate.addEventListener("click", () =>
      this.saveCurrent(),
    );
    const btnPreview = createStyledButton(
      getString("settings-prompts-preview"),
      "#2196f3",
    );
    btnPreview.addEventListener("click", () => this.updatePreview());
    actionRow.appendChild(this.btnSaveCurrentTemplate);
    actionRow.appendChild(btnPreview);
    right.appendChild(actionRow);

    // 预览框：改为与模板编辑器风格一致，适配明暗主题
    this.previewBox = Zotero.getMainWindow().document.createElement("div");
    Object.assign(this.previewBox.style, {
      border: "1px dashed var(--ai-input-border)",
      borderRadius: "6px",
      padding: "12px",
      background: "var(--ai-input-bg)",
      color: "var(--ai-input-text)",
      whiteSpace: "pre-wrap",
      fontFamily: "Consolas, Menlo, monospace",
      lineHeight: "1.5",
      minHeight: "120px",
    });
    right.appendChild(
      createFormGroup(
        getString("settings-prompts-preview-label"),
        this.previewBox,
        getString("settings-prompts-preview-help"),
      ),
    );

    // Render preview only on the AI summary prompt page
    if (this.shouldRender("summary")) {
      this.updatePreview();
      this.updateSummarySaveButtonState();
    }

    if (this.pageKind === "all") {
      contentWrapper.appendChild(modeSection);
    }

    // =========== Table summary prompt settings ===========
    if (this.pageKind === "all") {
      this.renderTableSettings(contentWrapper);
    }
  }

  // ===== helpers =====
  private renderDefaultPromptLanguageSetting(): HTMLElement {
    // 原生 select：Zotero 6 (Gecko 60) 下比自绘下拉可靠。
    // 旧实现在 document 上注册捕获阶段的 click 监听，并在插件沙盒里构造
    // CustomEvent —— 后者不在 bootstrap.js 的 wantGlobalProperties 中，
    // 选中后收尾逻辑抛错，界面回弹，用户表现为“设不了”。
    const doc = Zotero.getMainWindow().document;
    const select = doc.createElementNS(
      XHTML_NAMESPACE,
      "select",
    ) as HTMLSelectElement;
    select.id = "setting-promptLanguage";
    const currentValue = normalizePromptLanguageSelection(
      getDefaultPromptLanguagePreference(),
    );
    for (const option of getPromptLanguageOptions((key) =>
      getString(key as any),
    )) {
      const element = doc.createElementNS(
        XHTML_NAMESPACE,
        "option",
      ) as HTMLOptionElement;
      element.value = option.value;
      element.textContent = option.label;
      element.selected = option.value === currentValue;
      select.appendChild(element);
    }
    Object.assign(select.style, {
      width: "100%",
      maxWidth: "420px",
      padding: "10px 12px",
      fontSize: "14px",
      borderRadius: "6px",
      border: "1px solid var(--ai-input-border, #cccccc)",
      backgroundColor: "var(--ai-input-bg, #ffffff)",
      color: "var(--ai-input-text, #000000)",
      boxSizing: "border-box",
      cursor: "pointer",
    });
    select.addEventListener("change", () => {
      const newValue = normalizePromptLanguageSelection(select.value);
      const oldSummaryPrompt = (getPref("summaryPrompt") as string) || "";
      setPref("promptLanguage" as any, newValue as any);
      if (isKnownDefaultSummaryPrompt(oldSummaryPrompt)) {
        setPref("summaryPrompt", getDefaultSummaryPrompt());
        setPref("promptVersion" as any, PROMPT_VERSION as any);
      }
      this.render();
      this.showPromptToast(
        getString("settings-prompts-language-saved"),
        "success",
      );
    });
    return createFormGroup(
      getString("settings-prompts-language-label"),
      select,
      getString("settings-prompts-language-help"),
    );
  }

  private getSummaryPanelStyle(): Partial<CSSStyleDeclaration> {
    return {
      padding: "16px",
      borderRadius: "16px",
      border: "1px solid var(--ai-border, rgba(89, 192, 188, 0.22))",
      background:
        "linear-gradient(180deg, var(--ai-surface, #ffffff), var(--ai-bg, #f7f9fb))",
      boxShadow: "0 10px 30px rgba(15, 23, 42, 0.06)",
      boxSizing: "border-box",
    };
  }

  private createSummaryPanelHeading(
    titleText: string,
    subtitleText: string,
  ): HTMLElement {
    const doc = Zotero.getMainWindow().document;
    const wrapper = doc.createElement("div");
    Object.assign(wrapper.style, {
      marginBottom: "14px",
      paddingBottom: "12px",
      borderBottom: "1px solid var(--ai-border, rgba(0,0,0,0.08))",
    });

    const title = doc.createElement("div");
    title.textContent = titleText;
    Object.assign(title.style, {
      fontWeight: "700",
      fontSize: "14px",
      color: "var(--ai-text, #1f2937)",
      marginBottom: "4px",
    });

    const subtitle = doc.createElement("div");
    subtitle.textContent = subtitleText;
    Object.assign(subtitle.style, {
      fontSize: "12px",
      lineHeight: "1.5",
      color: "var(--ai-text-muted, #6b7280)",
    });

    wrapper.appendChild(title);
    wrapper.appendChild(subtitle);
    return wrapper;
  }

  private getBuiltinSummaryPresets(): PresetMap {
    const useEnglish = getResolvedDefaultPromptLanguage() === "en-US";
    return {
      [getString("settings-prompts-builtin-default")]:
        getDefaultSummaryPrompt(),
      [getString("settings-prompts-builtin-concise")]: useEnglish
        ? `You are an academic assistant. Summarize the paper's main problem, method, key results, and conclusion concisely in English bullet points. Paper metadata: title=${"${title}"}; authors=${"${authors}"}; year=${"${year}"}`
        : `你是一名学术助手。请用中文以简洁的要点方式总结论文主要问题、方法、关键结果与结论。文章信息: 标题=${"${title}"}; 作者=${"${authors}"}; 年份=${"${year}"}`,
      [getString("settings-prompts-builtin-structured")]: useEnglish
        ? `Summarize the paper in English using six sections: Background / Method / Results / Discussion / Limitations / Conclusion. Start with: ${"${title}"} (${"${year}"}).`
        : `请以"背景/方法/结果/讨论/局限/结论"六部分结构化总结论文; 开头写:《${"${title}"}》(${" ${year} "}).`,
      [getString("settings-prompts-builtin-computer")]: useEnglish
        ? `Explain this computer-science paper in English in as much detail as possible. I have general computer-science background knowledge, but not necessarily in this specific subarea. Only output the explanation of the paper; do not include greetings or small talk. Start with one paragraph summarizing the core idea of the paper.`
        : `帮我用中文讲一下这篇计算机领域的论文，讲的越详细越好，我有通用计算机专业基础，但是没有这个小方向的基础。输出的时候只包含关于论文的讲解，不要包含寒暄的内容。开始时先用一段话总结这篇论文的核心内容。`,
    };
  }

  private getCustomSummaryPresets(): PresetMap {
    const custom: PresetMap = {};
    try {
      const raw = (getPref("customPrompts") as string) || "";
      if (raw && raw.trim()) {
        const parsed = JSON.parse(raw);
        Object.entries(parsed).forEach(([k, v]) => {
          if (v && typeof v === "string") {
            custom[k] = v;
          }
        });
      }
    } catch (e) {
      ztoolkit.log("[PromptsSettings] Failed to parse customPrompts:", e);
    }
    return custom;
  }

  private setCustomSummaryPresets(custom: PresetMap): void {
    setPref("customPrompts", JSON.stringify(custom));
  }

  private getAllPresets(): PresetMap {
    return {
      ...this.getBuiltinSummaryPresets(),
      ...this.getCustomSummaryPresets(),
    };
  }

  private getDefaultSummaryPresetName(): string {
    return getString("settings-prompts-builtin-default");
  }

  private isDefaultSummaryPresetName(name: string): boolean {
    return name === this.getDefaultSummaryPresetName();
  }

  private detectPresetName(current: string, presets: PresetMap): string {
    // 防止 null/undefined 值导致错误
    if (!current) return this.getDefaultSummaryPresetName();
    const entry = Object.entries(presets).find(([, v]) => {
      return v && typeof v === "string" && v.trim() === current.trim();
    });
    return entry ? entry[0] : this.getDefaultSummaryPresetName();
  }

  private updateSummarySaveButtonState(): void {
    if (!this.btnSaveCurrentTemplate || !this.presetSelect) return;
    const name = (this.presetSelect as any).getValue() || "";
    const isDefault = this.isDefaultSummaryPresetName(name);
    this.btnSaveCurrentTemplate.disabled = isDefault;
    this.btnSaveCurrentTemplate.title = isDefault
      ? getString("settings-prompts-default-readonly-help")
      : "";
    this.btnSaveCurrentTemplate.style.opacity = isDefault ? "0.55" : "1";
    this.btnSaveCurrentTemplate.style.cursor = isDefault
      ? "not-allowed"
      : "pointer";
  }

  private showPromptToast(
    text: string,
    type: "success" | "fail" | "default" = "success",
  ): void {
    new ztoolkit.ProgressWindow(getString("settings-prompts-progress-title"))
      .createLine({ text, type })
      .show();
  }

  private loadPresetToEditor(): void {
    const name = (this.presetSelect as any).getValue();
    const presets = this.getAllPresets();
    const tpl = presets[name];
    if (tpl && typeof tpl === "string") {
      this.editor.value = tpl;
      setPref("summaryPrompt", tpl); // 切换即应用，确保生成总结时立即使用当前模板
      setPref("promptVersion" as any, PROMPT_VERSION as any);
      this.updatePreview();
      this.updateSummarySaveButtonState();
      this.showPromptToast(
        getString("settings-prompts-preset-applied", { args: { name } }),
        "success",
      );
    } else {
      this.showPromptToast(getString("settings-prompts-preset-empty"), "fail");
    }
  }

  private createSummaryPreset(): void {
    const { body, actions, close } = this.createPageDialog(
      getString("settings-prompts-new-preset-dialog-title"),
    );
    const nameInput = createInput(
      "summary-preset-name",
      "text",
      "",
      getString("settings-prompts-preset-name-placeholder"),
    );
    body.appendChild(
      createFormGroup(
        getString("settings-prompts-preset-name-label"),
        nameInput,
        getString("settings-prompts-new-preset-help"),
      ),
    );

    const btnCancel = createStyledButton(
      getString("settings-prompts-cancel"),
      "#9e9e9e",
      "small",
    );
    btnCancel.addEventListener("click", close);

    const btnConfirm = createStyledButton(
      getString("settings-prompts-new-preset"),
      "#4caf50",
      "small",
    );
    btnConfirm.addEventListener("click", () => {
      const presetName = nameInput.value.trim();
      if (!presetName) {
        this.showPromptToast(
          getString("settings-prompts-preset-name-required"),
          "fail",
        );
        return;
      }
      const allPresets = this.getAllPresets();
      if (presetName in allPresets) {
        this.showPromptToast(
          getString("settings-prompts-preset-name-exists", {
            args: { name: presetName },
          }),
          "fail",
        );
        return;
      }

      const editorValue = this.editor.value || "";
      if (!editorValue.trim()) {
        this.showPromptToast(
          getString("settings-prompts-template-empty"),
          "fail",
        );
        return;
      }

      const custom = this.getCustomSummaryPresets();
      custom[presetName] = editorValue;
      this.setCustomSummaryPresets(custom);
      setPref("summaryPrompt", editorValue);
      setPref("promptVersion" as any, PROMPT_VERSION as any);
      close();
      this.render();
      this.showPromptToast(
        getString("settings-prompts-preset-saved", {
          args: { name: presetName },
        }),
        "success",
      );
    });

    actions.appendChild(btnCancel);
    actions.appendChild(btnConfirm);
    setTimeout(() => nameInput.focus(), 0);
  }

  private deleteCustomPreset(): void {
    const name = (this.presetSelect as any).getValue();
    if (this.isDefaultSummaryPresetName(name)) {
      this.showPromptToast(
        getString("settings-prompts-cannot-delete-default"),
        "default",
      );
      return;
    }

    const custom = this.getCustomSummaryPresets();
    if (!(name in custom)) {
      this.showPromptToast(
        getString("settings-prompts-delete-custom-only"),
        "default",
      );
      return;
    }

    this.showInlineConfirm({
      title: getString("settings-prompts-delete-dialog-title"),
      message: getString("settings-prompts-delete-dialog-message", {
        args: { name },
      }),
      confirmText: getString("settings-prompts-delete-preset"),
      confirmColor: "#e53935",
      onConfirm: () => {
        const builtin = this.getBuiltinSummaryPresets();
        delete custom[name];
        this.setCustomSummaryPresets(custom);

        const nextPrompt = builtin[name] || getDefaultSummaryPrompt();
        setPref("summaryPrompt", nextPrompt);
        setPref("promptVersion" as any, PROMPT_VERSION as any);
        this.render();
        this.showPromptToast(
          getString("settings-prompts-preset-deleted", { args: { name } }),
          "success",
        );
      },
    });
  }

  private saveCurrent(): void {
    const text = this.editor.value || "";
    const currentPresetName = (this.presetSelect as any).getValue();

    if (this.isDefaultSummaryPresetName(currentPresetName)) {
      this.showPromptToast(
        getString("settings-prompts-default-readonly"),
        "default",
      );
      return;
    }
    if (!text.trim()) {
      this.showPromptToast(
        getString("settings-prompts-template-empty"),
        "fail",
      );
      return;
    }

    const custom = this.getCustomSummaryPresets();
    custom[currentPresetName] = text;
    this.setCustomSummaryPresets(custom);
    setPref("summaryPrompt", text);
    setPref("promptVersion" as any, PROMPT_VERSION as any);
    this.updatePreview();
    this.showPromptToast(
      getString("settings-prompts-preset-updated", {
        args: { name: currentPresetName },
      }),
      "success",
    );
  }

  private restoreBuiltinSummaryPresets(): void {
    const builtins = this.getBuiltinSummaryPresets();
    const custom = this.getCustomSummaryPresets();
    const modifiedBuiltinNames = Object.keys(builtins).filter(
      (name) => name in custom,
    );

    if (modifiedBuiltinNames.length === 0) {
      this.showPromptToast(
        getString("settings-prompts-restore-builtins-noop"),
        "default",
      );
      return;
    }

    const list = modifiedBuiltinNames.map((name) => `• ${name}`).join("\n");
    this.showInlineConfirm({
      title: getString("settings-prompts-restore-builtins-dialog-title"),
      message: getString("settings-prompts-restore-builtins-dialog-message", {
        args: { names: list },
      }),
      confirmText: getString("settings-prompts-restore-builtins"),
      confirmColor: "#9e9e9e",
      onConfirm: () => {
        modifiedBuiltinNames.forEach((name) => delete custom[name]);
        this.setCustomSummaryPresets(custom);

        const currentName = (this.presetSelect as any).getValue();
        if (currentName in builtins) {
          setPref("summaryPrompt", builtins[currentName]);
        }
        setPref("promptVersion" as any, PROMPT_VERSION as any);
        this.render();
        this.showPromptToast(
          getString("settings-prompts-restore-builtins-done"),
          "success",
        );
      },
    });
  }

  private updatePreview(): void {
    const vars = {
      title:
        this.sampleTitle?.value ||
        getString("settings-prompts-sample-title-fallback"),
      authors:
        this.sampleAuthors?.value ||
        getString("settings-prompts-sample-authors-fallback"),
      year:
        this.sampleYear?.value ||
        getString("settings-prompts-sample-year-fallback"),
    };
    const content = this.interpolate(this.editor.value || "", vars);
    this.previewBox.textContent = content.substring(0, 2000);
  }

  private interpolate(tpl: string, vars: Record<string, string>): string {
    return tpl.replace(
      /\$\{(title|authors|year)\}/g,
      (_, k) => vars[k as keyof typeof vars] || "",
    );
  }

  // =========== 多轮提示词相关方法 ===========

  private renderMultiRoundManagementActions(): HTMLElement {
    const doc = Zotero.getMainWindow().document;
    const actions = doc.createElement("div");
    Object.assign(actions.style, {
      display: "flex",
      gap: "8px",
      justifyContent: "flex-end",
      flexWrap: "wrap",
      marginLeft: "auto",
    });

    const btnNewTemplate = createStyledButton(
      getString("settings-prompts-new-template"),
      "#4caf50",
      "small",
    );
    btnNewTemplate.addEventListener("click", () =>
      this.createMultiRoundPromptTemplate(),
    );
    const btnRenameTemplate = createStyledButton(
      getString("settings-prompts-rename"),
      "#2196f3",
      "small",
    );
    btnRenameTemplate.addEventListener("click", () =>
      this.renameCurrentMultiRoundPromptTemplate(),
    );
    const btnCopyTemplate = createStyledButton(
      getString("settings-prompts-copy-template"),
      "#673ab7",
      "small",
    );
    btnCopyTemplate.addEventListener("click", () =>
      this.copyCurrentMultiRoundPromptTemplate(),
    );
    const btnDeleteTemplate = createStyledButton(
      getString("settings-prompts-delete-template"),
      "#e53935",
      "small",
    );
    btnDeleteTemplate.addEventListener("click", () =>
      this.deleteCurrentMultiRoundPromptTemplate(),
    );

    actions.appendChild(btnNewTemplate);
    actions.appendChild(btnRenameTemplate);
    actions.appendChild(btnCopyTemplate);
    actions.appendChild(btnDeleteTemplate);
    return actions;
  }

  private renderDeepReadV2Settings(): HTMLElement {
    const doc = Zotero.getMainWindow().document;
    const template =
      this.getSelectedMultiRoundTemplate() ||
      getDefaultMultiRoundPromptTemplate();
    const container = doc.createElement("div");
    Object.assign(container.style, {
      display: "flex",
      flexDirection: "column",
      gap: "14px",
      marginBottom: "16px",
    });

    const sequential = template.phases.find(
      (phase) => phase.type === "sequential_dynamic",
    );
    if (sequential && sequential.type === "sequential_dynamic") {
      const card = this.createDeepReadPhaseCard(
        this.localizeBuiltinDeepReadPhaseTitle(template, sequential),
        this.localizeBuiltinDeepReadPhaseDescription(template, sequential),
      );
      card.appendChild(
        this.createContextStrategySelector(sequential.contextStrategy),
      );
      card.appendChild(
        this.createBuiltinPromptHelp(
          getString("settings-prompts-planning-title"),
          DEFAULT_MULTI_ROUND_PLANNING_PROMPT,
          getString("settings-prompts-planning-help"),
        ),
      );
      card.appendChild(this.renderFixedPromptCards(sequential.fixedPrompts));
      card.appendChild(
        this.createPromptDetails(
          getString("settings-prompts-chapter-template-title"),
          sequential.chapterTemplate,
          "deep-read-chapter-template",
          getString("settings-prompts-chapter-template-help"),
        ),
      );
      card.appendChild(this.createVariableNotice());
      container.appendChild(card);
    }

    const independent = template.phases.find(
      (phase) => phase.type === "independent",
    );
    if (independent && independent.type === "independent") {
      const card = this.createDeepReadPhaseCard(
        this.localizeBuiltinDeepReadPhaseTitle(template, independent),
        this.localizeBuiltinDeepReadPhaseDescription(template, independent),
      );
      card.appendChild(
        this.createCheckboxSetting(
          "deep-read-independent-parallelizable",
          getString("settings-prompts-parallel-enabled"),
          getString("settings-prompts-parallel-enabled-help"),
          independent.parallelizable,
        ),
      );
      card.appendChild(
        this.createLabeledInput(
          "deep-read-independent-max-concurrency",
          getString("settings-prompts-max-concurrency"),
          getString("settings-prompts-max-concurrency-help"),
          String(independent.maxConcurrency || 1),
          "1",
        ),
      );
      independent.prompts.forEach((prompt, index) => {
        const promptCard = doc.createElement("div");
        Object.assign(promptCard.style, {
          border: "1px solid rgba(89, 192, 188, 0.28)",
          borderRadius: "10px",
          padding: "12px",
          marginTop: index === 0 ? "0" : "12px",
          background: "rgba(89, 192, 188, 0.035)",
        });

        const cardHeader = doc.createElement("div");
        Object.assign(cardHeader.style, {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "10px",
          marginBottom: "10px",
        });
        const cardTitle = doc.createElement("div");
        cardTitle.textContent = getString(
          "settings-prompts-independent-round-title",
          { args: { index: index + 1 } },
        );
        Object.assign(cardTitle.style, {
          fontWeight: "700",
          color: "var(--ai-text, #1f2937)",
        });
        cardHeader.appendChild(cardTitle);

        const deleteButton = createStyledButton(
          getString("settings-prompts-delete-round"),
          "#e53935",
          "small",
        );
        deleteButton.addEventListener("click", () =>
          this.removeIndependentPromptFromCurrentTemplate(index),
        );
        cardHeader.appendChild(deleteButton);
        promptCard.appendChild(cardHeader);

        promptCard.appendChild(
          this.createLabeledInput(
            `deep-read-independent-title-${index}`,
            getString("settings-prompts-round-title-label"),
            getString("settings-prompts-round-title-help"),
            this.localizeBuiltinDeepReadPromptTitle(template, prompt),
            getString("settings-prompts-round-title-placeholder"),
          ),
        );
        promptCard.appendChild(
          this.createPromptDetails(
            getString("settings-prompts-actual-prompt-label"),
            prompt.prompt,
            `deep-read-independent-prompt-${index}`,
            getString("settings-prompts-independent-prompt-help"),
          ),
        );
        card.appendChild(promptCard);
      });

      const addButton = createStyledButton(
        getString("settings-prompts-add-independent-round"),
        "#4caf50",
        "small",
      );
      addButton.addEventListener("click", () =>
        this.addIndependentPromptToCurrentTemplate(),
      );
      Object.assign(addButton.style, { marginTop: "12px" });
      card.appendChild(addButton);
      container.appendChild(card);
    }

    return container;
  }

  private createCheckboxSetting(
    id: string,
    label: string,
    helpText: string,
    checked: boolean,
  ): HTMLElement {
    const doc = Zotero.getMainWindow().document;
    const wrapper = doc.createElement("div");
    Object.assign(wrapper.style, { margin: "10px 0" });

    const labelEl = doc.createElement("label");
    labelEl.textContent = `${label} ?`;
    labelEl.title = helpText;
    labelEl.setAttribute("for", `setting-${id}`);
    Object.assign(labelEl.style, {
      display: "block",
      marginBottom: "6px",
      fontWeight: "600",
      color: "var(--ai-text, #333)",
      cursor: "help",
    });
    wrapper.appendChild(labelEl);
    wrapper.appendChild(createCheckbox(id, checked));
    return wrapper;
  }

  private createVariableNotice(): HTMLElement {
    const doc = Zotero.getMainWindow().document;
    const notice = doc.createElement("div");
    Object.assign(notice.style, {
      marginTop: "10px",
      padding: "10px 12px",
      borderRadius: "8px",
      border: "1px solid rgba(33, 150, 243, 0.35)",
      background: "rgba(33, 150, 243, 0.08)",
      color: "var(--ai-text, #1f2937)",
      fontSize: "13px",
      lineHeight: "1.6",
    });
    notice.innerHTML = getString("settings-prompts-variable-notice");
    return notice;
  }

  private normalizeOverallReadingTitle(title: string): string {
    return title.trim() === getString("settings-prompts-legacy-overview-title")
      ? getString("settings-prompts-fixed-reading-title")
      : title;
  }

  private createContextStrategySelector(value: string): HTMLElement {
    const doc = Zotero.getMainWindow().document;
    const wrapper = doc.createElement("div");
    Object.assign(wrapper.style, { margin: "10px 0" });

    const label = doc.createElement("label");
    label.textContent = getString("settings-prompts-context-mode-label");
    label.title = getString("settings-prompts-context-mode-help");
    label.setAttribute("for", "setting-deep-read-context-strategy");
    Object.assign(label.style, {
      display: "block",
      marginBottom: "6px",
      fontWeight: "600",
      color: "var(--ai-text, #333)",
      cursor: "help",
    });
    wrapper.appendChild(label);

    wrapper.appendChild(
      createSelect(
        "deep-read-context-strategy",
        [
          {
            value: "last_round",
            label: getString("settings-prompts-context-last-round"),
          },
          {
            value: "full_history",
            label: getString("settings-prompts-context-full-history"),
          },
        ],
        value === "full_history" ? "full_history" : "last_round",
      ),
    );
    wrapper.appendChild(
      this.createDeepReadFlow(
        [
          getString("settings-prompts-planning-title"),
          getString("settings-prompts-fixed-reading-title"),
          getString("settings-prompts-chapter-deep-read"),
        ],
        "phase",
      ),
    );
    return wrapper;
  }

  private renderFixedPromptCards(prompts: MultiRoundPromptItem[]): HTMLElement {
    const doc = Zotero.getMainWindow().document;
    const wrapper = doc.createElement("div");
    Object.assign(wrapper.style, {
      marginTop: "12px",
      padding: "12px",
      border: "1px solid rgba(33, 150, 243, 0.22)",
      borderRadius: "10px",
      background: "rgba(33, 150, 243, 0.04)",
    });

    const heading = doc.createElement("div");
    heading.textContent = getString("settings-prompts-fixed-reading-title");
    Object.assign(heading.style, {
      fontWeight: "700",
      marginBottom: "8px",
      color: "var(--ai-text, #1f2937)",
    });
    wrapper.appendChild(heading);

    const desc = doc.createElement("p");
    desc.textContent = getString("settings-prompts-fixed-reading-help");
    Object.assign(desc.style, {
      margin: "0 0 10px 0",
      opacity: "0.78",
      lineHeight: "1.6",
    });
    wrapper.appendChild(desc);

    if (!prompts.length) {
      const empty = doc.createElement("p");
      empty.textContent = getString("settings-prompts-no-fixed-rounds");
      Object.assign(empty.style, { margin: "0 0 10px 0", opacity: "0.72" });
      wrapper.appendChild(empty);
    }

    prompts.forEach((prompt, index) => {
      const promptCard = doc.createElement("div");
      Object.assign(promptCard.style, {
        border: "1px solid rgba(33, 150, 243, 0.2)",
        borderRadius: "8px",
        padding: "10px",
        marginTop: index === 0 ? "0" : "10px",
        background: "var(--ai-surface, #fff)",
      });
      const rowHeader = doc.createElement("div");
      Object.assign(rowHeader.style, {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "10px",
        marginBottom: "8px",
      });
      const rowTitle = doc.createElement("div");
      rowTitle.textContent = getString("settings-prompts-fixed-round-title", {
        args: { index: index + 1 },
      });
      Object.assign(rowTitle.style, { fontWeight: "700" });
      const deleteButton = createStyledButton(
        getString("settings-prompts-delete-fixed-round"),
        "#e53935",
        "small",
      );
      deleteButton.addEventListener("click", () =>
        this.removeFixedPromptFromCurrentTemplate(index),
      );
      rowHeader.appendChild(rowTitle);
      rowHeader.appendChild(deleteButton);
      promptCard.appendChild(rowHeader);

      promptCard.appendChild(
        this.createLabeledInput(
          `deep-read-fixed-title-${index}`,
          getString("settings-prompts-fixed-round-title-label", {
            args: { index: index + 1 },
          }),
          getString("settings-prompts-fixed-round-title-help"),
          this.normalizeOverallReadingTitle(prompt.title),
          getString("settings-prompts-fixed-round-title-placeholder"),
        ),
      );
      promptCard.appendChild(
        this.createPromptDetails(
          getString("settings-prompts-fixed-prompt-label"),
          prompt.prompt,
          `deep-read-fixed-prompt-${index}`,
          getString("settings-prompts-fixed-prompt-help"),
        ),
      );
      wrapper.appendChild(promptCard);
    });

    const addButton = createStyledButton(
      getString("settings-prompts-add-fixed-round"),
      "#4caf50",
      "small",
    );
    addButton.addEventListener("click", () =>
      this.addFixedPromptToCurrentTemplate(),
    );
    Object.assign(addButton.style, { marginTop: "12px" });
    wrapper.appendChild(addButton);

    return wrapper;
  }

  private createDeepReadPhaseCard(
    title: string,
    description: string,
  ): HTMLElement {
    const doc = Zotero.getMainWindow().document;
    const card = doc.createElement("div");
    Object.assign(card.style, {
      border: "1px solid rgba(89, 192, 188, 0.35)",
      borderRadius: "10px",
      padding: "14px",
      background: "var(--ai-surface, #fff)",
    });

    const heading = doc.createElement("h4");
    heading.textContent = title;
    Object.assign(heading.style, {
      margin: "0 0 8px 0",
      color: "#59c0bc",
      fontSize: "15px",
    });
    card.appendChild(heading);

    if (description) {
      const desc = doc.createElement("p");
      desc.textContent = description;
      Object.assign(desc.style, {
        margin: "0 0 10px 0",
        opacity: "0.82",
        lineHeight: "1.6",
      });
      card.appendChild(desc);
    }

    return card;
  }

  private createDeepReadFlow(
    steps: string[],
    variant: "template" | "phase" = "phase",
  ): HTMLElement {
    const doc = Zotero.getMainWindow().document;
    const flow = doc.createElement("div");
    Object.assign(flow.style, {
      display: "flex",
      flexWrap: "wrap",
      alignItems: "center",
      gap: variant === "template" ? "6px" : "8px",
      margin: variant === "template" ? "8px 0 0 0" : "10px 0 12px 0",
    });

    steps.forEach((step, index) => {
      const badge = doc.createElement("span");
      badge.textContent = `${index + 1}. ${step}`;
      Object.assign(badge.style, {
        padding: variant === "template" ? "5px 10px" : "6px 11px",
        borderRadius: variant === "template" ? "999px" : "8px",
        background:
          variant === "template"
            ? "linear-gradient(135deg, rgba(89, 192, 188, 0.14), rgba(76, 175, 80, 0.12))"
            : "rgba(33, 150, 243, 0.1)",
        border:
          variant === "template"
            ? "1px solid rgba(89, 192, 188, 0.3)"
            : "1px solid rgba(33, 150, 243, 0.22)",
        color: "var(--ai-text, #333)",
        fontSize: variant === "template" ? "12px" : "12.5px",
        fontWeight: variant === "template" ? "600" : "500",
      });
      flow.appendChild(badge);

      if (index < steps.length - 1) {
        const arrow = doc.createElement("span");
        arrow.textContent = "→";
        Object.assign(arrow.style, {
          color: variant === "template" ? "#59c0bc" : "#2196f3",
          fontWeight: "700",
          fontSize: variant === "template" ? "15px" : "16px",
          opacity: "0.85",
        });
        flow.appendChild(arrow);
      }
    });
    return flow;
  }
  private createLabeledInput(
    id: string,
    label: string,
    helpText: string,
    value: string,
    placeholder: string,
  ): HTMLElement {
    const doc = Zotero.getMainWindow().document;
    const wrapper = doc.createElement("div");
    Object.assign(wrapper.style, { marginBottom: "10px" });

    const labelEl = doc.createElement("label");
    labelEl.textContent = `${label} ⓘ`;
    labelEl.title = helpText;
    labelEl.setAttribute("for", `setting-${id}`);
    Object.assign(labelEl.style, {
      display: "block",
      marginBottom: "6px",
      fontWeight: "600",
      color: "var(--ai-text, #333)",
      cursor: "help",
    });
    wrapper.appendChild(labelEl);

    wrapper.appendChild(createInput(id, "text", value, placeholder));
    return wrapper;
  }

  private createPromptDetails(
    title: string,
    content: string,
    inputId?: string,
    helpText?: string,
  ): HTMLElement {
    const doc = Zotero.getMainWindow().document;
    const details = doc.createElement("details");
    details.open = true;
    Object.assign(details.style, { marginTop: "8px" });

    const summary = doc.createElement("summary");
    summary.textContent = helpText ? `${title} ⓘ` : title;
    if (helpText) summary.title = helpText;
    Object.assign(summary.style, {
      cursor: "pointer",
      fontWeight: "600",
      color: "var(--ai-text, #333)",
    });
    details.appendChild(summary);

    const editor = doc.createElement("textarea");
    if (inputId) editor.id = inputId;
    editor.value = content;
    Object.assign(editor.style, {
      width: "100%",
      minHeight: "150px",
      boxSizing: "border-box",
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      padding: "10px",
      margin: "8px 0 0 0",
      borderRadius: "8px",
      background: "var(--ai-bg, #f7f9fb)",
      border: "1px solid rgba(0,0,0,0.12)",
      fontSize: "12px",
      lineHeight: "1.5",
      fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
      resize: "vertical",
    });
    details.appendChild(editor);
    return details;
  }

  private createBuiltinPromptHelp(
    title: string,
    content: string,
    helpText: string,
  ): HTMLElement {
    const doc = Zotero.getMainWindow().document;
    const wrapper = doc.createElement("div");
    Object.assign(wrapper.style, {
      marginTop: "8px",
      padding: "10px 12px",
      borderRadius: "8px",
      border: "1px solid rgba(0,0,0,0.12)",
      background: "var(--ai-bg, #f7f9fb)",
      color: "var(--ai-text, #333)",
      fontSize: "13px",
      lineHeight: "1.5",
    });

    const label = doc.createElement("span");
    label.textContent = `${title} ⓘ`;
    label.title = `${helpText}\n\n${content}`;
    Object.assign(label.style, {
      fontWeight: "600",
      cursor: "help",
    });
    wrapper.appendChild(label);

    const description = doc.createElement("div");
    description.textContent = helpText;
    Object.assign(description.style, { marginTop: "6px" });
    wrapper.appendChild(description);
    return wrapper;
  }

  private renderMultiRoundTemplateControls(
    currentPrompts: MultiRoundPromptItem[],
  ): HTMLElement {
    const doc = Zotero.getMainWindow().document;
    const templates = this.getMultiRoundPromptTemplates();
    const selectedTemplateId = this.resolveSelectedMultiRoundTemplateId(
      currentPrompts,
      templates,
    );
    const templateOptions =
      selectedTemplateId === CURRENT_MULTI_ROUND_TEMPLATE_ID
        ? [
            {
              value: CURRENT_MULTI_ROUND_TEMPLATE_ID,
              label: getString("settings-prompts-current-unsaved-template"),
            },
            ...templates.map((template) => ({
              value: template.id,
              label: this.localizeBuiltinDeepReadTemplateName(template),
            })),
          ]
        : templates.map((template) => ({
            value: template.id,
            label: this.localizeBuiltinDeepReadTemplateName(template),
          }));

    const container = doc.createElement("div");
    Object.assign(container.style, {
      marginBottom: "16px",
    });

    this.multiRoundTemplateSelect = createSelect(
      "multi-round-template",
      templateOptions,
      selectedTemplateId,
      (templateId) => this.applyMultiRoundPromptTemplate(templateId),
    );

    const controlsRow = doc.createElement("div");
    Object.assign(controlsRow.style, {
      display: "flex",
      gap: "10px",
      alignItems: "flex-start",
      flexWrap: "wrap",
    });

    const templateGroup = createFormGroup(
      "",
      this.multiRoundTemplateSelect,
      getString("settings-prompts-template-select-help"),
    );
    templateGroup.appendChild(
      this.createDeepReadFlow(
        [
          getString("settings-prompts-chapter-deep-read"),
          getString("settings-prompts-focused-followup"),
        ],
        "template",
      ),
    );
    Object.assign(templateGroup.style, {
      flex: "1 1 320px",
      marginBottom: "0",
      minWidth: "260px",
    });
    controlsRow.appendChild(templateGroup);

    container.appendChild(controlsRow);

    return container;
  }

  private renderMultiRoundPromptActions(): HTMLElement {
    const doc = Zotero.getMainWindow().document;
    const actions = doc.createElement("div");
    Object.assign(actions.style, {
      display: "flex",
      gap: "10px",
      justifyContent: "flex-start",
      marginTop: "12px",
      marginBottom: "16px",
      flexWrap: "wrap",
    });

    const btnSaveTemplate = createStyledButton(
      getString("settings-prompts-save-template"),
      "#2196f3",
      "small",
    );
    btnSaveTemplate.addEventListener("click", () =>
      this.confirmSaveCurrentMultiRoundTemplate(),
    );
    const btnExportTemplate = createStyledButton(
      getString("settings-prompts-export-template"),
      "#673ab7",
      "small",
    );
    btnExportTemplate.addEventListener("click", () =>
      this.exportCurrentMultiRoundTemplate(),
    );
    const btnImportTemplate = createStyledButton(
      getString("settings-prompts-import-template"),
      "#ff9800",
      "small",
    );
    btnImportTemplate.addEventListener("click", () =>
      this.importMultiRoundPromptTemplate(),
    );

    actions.appendChild(btnSaveTemplate);
    actions.appendChild(btnExportTemplate);
    actions.appendChild(btnImportTemplate);
    return actions;
  }

  private getMultiRoundPromptTemplates(): MultiRoundPromptTemplate[] {
    const customTemplatesJson =
      (getPref("multiRoundPromptTemplates") as string) || "[]";
    return mergeMultiRoundPromptTemplates(
      getBuiltinMultiRoundPromptTemplates(),
      parseMultiRoundPromptTemplates(customTemplatesJson),
    ).map((template) => this.localizeDefaultLikeDeepReadTemplate(template));
  }

  private resolveSelectedMultiRoundTemplateId(
    currentPrompts: MultiRoundPromptItem[],
    templates: MultiRoundPromptTemplate[],
  ): string {
    const savedTemplateId =
      this.selectedMultiRoundTemplateId ||
      (getPref(MULTI_ROUND_TEMPLATE_ID_PREF as any) as string) ||
      "";
    if (templates.some((template) => template.id === savedTemplateId)) {
      this.selectedMultiRoundTemplateId = savedTemplateId;
      return savedTemplateId;
    }
    const defaultTemplateId = getDefaultMultiRoundPromptTemplate().id;
    this.selectedMultiRoundTemplateId = defaultTemplateId;
    return defaultTemplateId;
  }

  private rememberSelectedMultiRoundTemplate(templateId: string | null): void {
    this.selectedMultiRoundTemplateId = templateId;
    setPref(MULTI_ROUND_TEMPLATE_ID_PREF as any, (templateId || "") as any);
  }

  private getSelectedMultiRoundTemplateId(): string {
    return (
      (this.multiRoundTemplateSelect as any)?.getValue?.() ||
      this.selectedMultiRoundTemplateId ||
      (getPref(MULTI_ROUND_TEMPLATE_ID_PREF as any) as string) ||
      ""
    );
  }

  private getSelectedMultiRoundTemplate(): MultiRoundPromptTemplate | null {
    const templateId = this.getSelectedMultiRoundTemplateId();
    if (!templateId || templateId === CURRENT_MULTI_ROUND_TEMPLATE_ID) {
      return null;
    }
    return (
      this.getMultiRoundPromptTemplates().find(
        (template) => template.id === templateId,
      ) || null
    );
  }

  private isBuiltinMultiRoundPromptTemplate(templateId: string): boolean {
    return getBuiltinMultiRoundPromptTemplates().some(
      (template) => template.id === templateId,
    );
  }

  private isDefaultDeepReadTemplate(
    template: MultiRoundPromptTemplate,
  ): boolean {
    return template.id === "default-v2-chapter-reading";
  }

  private isLegacyDefaultDeepReadText(
    value: string | undefined,
    patterns: string[],
  ): boolean {
    return Boolean(
      value && patterns.some((pattern) => value.includes(pattern)),
    );
  }

  private isDefaultLikeDeepReadTemplate(
    template: MultiRoundPromptTemplate,
  ): boolean {
    return (
      this.isDefaultDeepReadTemplate(template) ||
      this.isLegacyDefaultDeepReadText(template.name, [
        "默认：双阶段逐章精读",
        "双阶段逐章精读",
      ]) ||
      this.isLegacyDefaultDeepReadText(template.description, [
        "先解析章节 JSON",
        "按章节顺序逐章精读",
      ]) ||
      template.phases.some(
        (phase) =>
          this.isLegacyDefaultDeepReadText(phase.title, [
            "逐章精读",
            "重点追问",
          ]) ||
          this.isLegacyDefaultDeepReadText(phase.description, [
            "先让 AI 识别论文章节结构",
            "基于论文原文，先自动识别章节结构",
            "逐章深入精读",
            "按章节顺序串行执行",
            "每个追问独立阅读全文全文",
            "不携带其他轮次上下文",
          ]),
      )
    );
  }

  private localizeBuiltinDeepReadTemplateName(
    template: MultiRoundPromptTemplate,
  ): string {
    return this.isDefaultDeepReadTemplate(template) ||
      this.isLegacyDefaultDeepReadText(template.name, [
        "默认：双阶段逐章精读",
        "双阶段逐章精读",
      ])
      ? getString("settings-prompts-builtin-deep-read-template-name")
      : template.name;
  }

  private localizeBuiltinDeepReadTemplateDescription(
    template: MultiRoundPromptTemplate,
  ): string {
    return this.isDefaultDeepReadTemplate(template) ||
      this.isLegacyDefaultDeepReadText(template.description, [
        "先解析章节 JSON",
        "按章节顺序逐章精读",
      ])
      ? getString("settings-prompts-builtin-deep-read-template-description")
      : template.description;
  }

  private localizeBuiltinDeepReadPhaseTitle(
    template: MultiRoundPromptTemplate,
    phase: MultiRoundPromptPhase,
  ): string {
    const isDefaultLike = this.isDefaultLikeDeepReadTemplate(template);
    if (
      phase.id === "chapter_reading" ||
      (isDefaultLike && phase.type === "sequential_dynamic") ||
      this.isLegacyDefaultDeepReadText(phase.title, ["逐章精读"])
    ) {
      return getString(
        "settings-prompts-builtin-deep-read-phase-chapter-title",
      );
    }
    if (phase.id === "deep_questions") {
      return getString(
        "settings-prompts-builtin-deep-read-phase-followup-title",
      );
    }
    return phase.title;
  }

  private localizeBuiltinDeepReadPhaseDescription(
    template: MultiRoundPromptTemplate,
    phase: MultiRoundPromptPhase,
  ): string {
    const isDefaultLike = this.isDefaultLikeDeepReadTemplate(template);
    if (
      phase.id === "chapter_reading" ||
      (isDefaultLike && phase.type === "sequential_dynamic") ||
      this.isLegacyDefaultDeepReadText(phase.description, [
        "先让 AI 识别论文章节结构",
        "基于论文原文，先自动识别章节结构",
        "逐章深入精读",
        "按章节顺序串行执行",
      ])
    ) {
      return getString(
        "settings-prompts-builtin-deep-read-phase-chapter-description",
      );
    }
    if (
      phase.id === "deep_questions" ||
      (isDefaultLike && phase.type === "independent") ||
      this.isLegacyDefaultDeepReadText(phase.description, [
        "每个追问独立阅读全文全文",
        "不携带其他轮次上下文",
      ])
    ) {
      return getString(
        "settings-prompts-builtin-deep-read-phase-followup-description",
      );
    }
    return phase.description;
  }

  private localizeBuiltinDeepReadPromptTitle(
    template: MultiRoundPromptTemplate,
    prompt: MultiRoundPromptItem,
  ): string {
    if (
      prompt.id === "q_core_contribution" ||
      this.isLegacyDefaultDeepReadText(prompt.title, ["核心贡献判断"])
    ) {
      return getString(
        "settings-prompts-builtin-deep-read-question-core-title",
      );
    }
    if (
      prompt.id === "q_limits_questions" ||
      this.isLegacyDefaultDeepReadText(prompt.title, ["局限与疑问"])
    ) {
      return getString(
        "settings-prompts-builtin-deep-read-question-limits-title",
      );
    }
    return prompt.title;
  }

  private localizeDefaultLikeDeepReadTemplate(
    template: MultiRoundPromptTemplate,
  ): MultiRoundPromptTemplate {
    if (!this.isDefaultLikeDeepReadTemplate(template)) {
      return template;
    }
    return {
      ...template,
      name: this.localizeBuiltinDeepReadTemplateName(template),
      description: this.localizeBuiltinDeepReadTemplateDescription(template),
      phases: template.phases.map((phase) => ({
        ...phase,
        title: this.localizeBuiltinDeepReadPhaseTitle(template, phase),
        description: this.localizeBuiltinDeepReadPhaseDescription(
          template,
          phase,
        ),
        ...(phase.type === "independent"
          ? {
              prompts: phase.prompts.map((prompt) => ({
                ...prompt,
                title: this.localizeBuiltinDeepReadPromptTitle(
                  template,
                  prompt,
                ),
              })),
            }
          : {}),
      })),
    };
  }

  private detectMultiRoundTemplateId(
    currentPrompts: MultiRoundPromptItem[],
    templates: MultiRoundPromptTemplate[],
  ): string {
    const matched = templates.find((template) =>
      this.areMultiRoundPromptsEqual(currentPrompts, template.prompts),
    );
    return matched?.id || CURRENT_MULTI_ROUND_TEMPLATE_ID;
  }

  private areMultiRoundPromptsEqual(
    left: MultiRoundPromptItem[],
    right: MultiRoundPromptItem[],
  ): boolean {
    if (left.length !== right.length) {
      return false;
    }
    return left.every((prompt, index) => {
      const other = right[index];
      return (
        prompt.title.trim() === other.title.trim() &&
        prompt.prompt.trim() === other.prompt.trim()
      );
    });
  }

  private applyMultiRoundPromptTemplate(templateId: string): void {
    if (templateId === CURRENT_MULTI_ROUND_TEMPLATE_ID) {
      this.rememberSelectedMultiRoundTemplate(null);
      return;
    }
    const template = this.getMultiRoundPromptTemplates().find(
      (item) => item.id === templateId,
    );
    if (!template) {
      new ztoolkit.ProgressWindow(getString("settings-prompts-progress-title"))
        .createLine({
          text: getString("settings-prompts-template-missing"),
          type: "fail",
        })
        .show();
      return;
    }

    this.rememberSelectedMultiRoundTemplate(template.id);
    this.render();
    new ztoolkit.ProgressWindow(getString("settings-prompts-progress-title"))
      .createLine({
        text: getString("settings-prompts-template-switched", {
          args: { name: this.localizeBuiltinDeepReadTemplateName(template) },
        }),
        type: "success",
      })
      .show();
  }

  private confirmSaveCurrentMultiRoundTemplate(): void {
    const templateId =
      (this.multiRoundTemplateSelect as any)?.getValue?.() ||
      this.selectedMultiRoundTemplateId ||
      (getPref(MULTI_ROUND_TEMPLATE_ID_PREF as any) as string) ||
      "";
    if (!templateId || templateId === CURRENT_MULTI_ROUND_TEMPLATE_ID) {
      new ztoolkit.ProgressWindow(getString("settings-prompts-progress-title"))
        .createLine({
          text: getString("settings-prompts-no-bound-template"),
          type: "fail",
        })
        .show();
      return;
    }

    const template = this.getMultiRoundPromptTemplates().find(
      (item) => item.id === templateId,
    );
    if (!template) {
      new ztoolkit.ProgressWindow(getString("settings-prompts-progress-title"))
        .createLine({
          text: getString("settings-prompts-template-missing"),
          type: "fail",
        })
        .show();
      return;
    }

    const saveTarget = this.collectDeepReadTemplateFromEditor(
      this.createWritableMultiRoundPromptTemplate(template),
    );
    this.showInlineConfirm({
      title: getString("settings-prompts-save-template-title"),
      message: getString("settings-prompts-save-template-message", {
        args: { name: saveTarget.name },
      }),
      confirmText: getString("settings-prompts-save-template"),
      confirmColor: "#4caf50",
      onConfirm: () => {
        const savedTemplate = this.saveMultiRoundTemplate(saveTarget);
        this.render();
        new ztoolkit.ProgressWindow(
          getString("settings-prompts-progress-title"),
        )
          .createLine({
            text: getString("settings-prompts-template-saved", {
              args: { name: savedTemplate.name },
            }),
            type: "success",
          })
          .show();
      },
    });
  }

  private saveCurrentMultiRoundTemplate(
    template: MultiRoundPromptTemplate,
  ): MultiRoundPromptTemplate {
    const updatedTemplate = this.collectDeepReadTemplateFromEditor(template);
    return this.saveMultiRoundTemplate(updatedTemplate);
  }

  private saveMultiRoundTemplate(
    updatedTemplate: MultiRoundPromptTemplate,
  ): MultiRoundPromptTemplate {
    const customTemplates = parseMultiRoundPromptTemplates(
      (getPref("multiRoundPromptTemplates") as string) || "[]",
    );
    const nextTemplates = this.upsertMultiRoundPromptTemplate(
      customTemplates,
      updatedTemplate,
    );
    setPref("multiRoundPromptTemplates", JSON.stringify(nextTemplates));
    this.rememberSelectedMultiRoundTemplate(updatedTemplate.id);
    return updatedTemplate;
  }

  private collectDeepReadTemplateFromEditor(
    template: MultiRoundPromptTemplate,
  ): MultiRoundPromptTemplate {
    const findEditorElement = <T extends HTMLElement>(id: string): T | null =>
      (this.container.querySelector(`[id="${id}"]`) as T | null) ||
      (this.container.querySelector(`[id="setting-${id}"]`) as T | null);
    const getValue = (id: string, fallback: string) => {
      const value = findEditorElement<HTMLInputElement | HTMLTextAreaElement>(
        id,
      )?.value;
      return value && value.trim() ? value.trim() : fallback;
    };
    const getSelectValue = (id: string, fallback: string) => {
      const value = (findEditorElement(id) as any)?.getValue?.();
      return typeof value === "string" && value.trim() ? value : fallback;
    };
    const getContextStrategy = (
      fallback: MultiRoundContextStrategy,
    ): MultiRoundContextStrategy =>
      getSelectValue("setting-deep-read-context-strategy", fallback) ===
      "full_history"
        ? "full_history"
        : "last_round";
    const getNumberValue = (id: string, fallback: number) => {
      const raw = getValue(id, String(fallback));
      const value = Number(raw);
      return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
    };
    const getCheckboxValue = (id: string, fallback: boolean) => {
      const checkbox = findEditorElement<HTMLInputElement>(id);
      return checkbox ? checkbox.checked : fallback;
    };

    const phases = template.phases.map((phase) => {
      if (phase.type === "sequential_dynamic") {
        return {
          ...phase,
          contextStrategy: getContextStrategy(phase.contextStrategy),
          planningPrompt: DEFAULT_MULTI_ROUND_PLANNING_PROMPT,
          fixedPrompts: phase.fixedPrompts.map((prompt, index) => ({
            ...prompt,
            title: this.normalizeOverallReadingTitle(
              getValue(
                `deep-read-fixed-title-${index}`,
                this.normalizeOverallReadingTitle(prompt.title),
              ),
            ),
            prompt: getValue(`deep-read-fixed-prompt-${index}`, prompt.prompt),
            order: index + 1,
          })),
          chapterTemplate: getValue(
            "deep-read-chapter-template",
            phase.chapterTemplate,
          ),
        };
      }
      return {
        ...phase,
        parallelizable: getCheckboxValue(
          "deep-read-independent-parallelizable",
          phase.parallelizable,
        ),
        maxConcurrency: Math.min(
          8,
          Math.max(
            1,
            getNumberValue(
              "deep-read-independent-max-concurrency",
              phase.maxConcurrency || 1,
            ),
          ),
        ),
        prompts: phase.prompts.map((prompt, index) => ({
          ...prompt,
          title: getValue(`deep-read-independent-title-${index}`, prompt.title),
          prompt: getValue(
            `deep-read-independent-prompt-${index}`,
            prompt.prompt,
          ),
          order: index + 1,
        })),
      };
    });

    return {
      ...template,
      version: 2,
      phases,
      prompts: [],
    };
  }

  private exportCurrentMultiRoundTemplate(): void {
    const selectedTemplateId = (
      this.multiRoundTemplateSelect as any
    )?.getValue?.();
    const template = this.collectDeepReadTemplateFromEditor(
      this.getMultiRoundPromptTemplates().find(
        (item) => item.id === selectedTemplateId,
      ) || getDefaultMultiRoundPromptTemplate(),
    );

    this.showJsonDialog({
      title: getString("settings-prompts-export-dialog-title"),
      value: serializeMultiRoundPromptTemplate(template),
      readOnly: true,
    });
  }

  private importMultiRoundPromptTemplate(): void {
    this.showJsonDialog({
      title: getString("settings-prompts-import-dialog-title"),
      value: "",
      placeholder: getString("settings-prompts-import-placeholder"),
      confirmText: getString("settings-prompts-import-template"),
      onConfirm: (json) => {
        try {
          const imported = parseMultiRoundPromptTemplateExport(json);
          const customTemplates = parseMultiRoundPromptTemplates(
            (getPref("multiRoundPromptTemplates") as string) || "[]",
          );
          const templateToImport =
            this.createWritableMultiRoundPromptTemplate(imported);
          const nextTemplates = this.upsertMultiRoundPromptTemplate(
            customTemplates,
            templateToImport,
          );
          setPref(
            "multiRoundPromptTemplates",
            JSON.stringify(nextTemplates) as any,
          );
          this.rememberSelectedMultiRoundTemplate(templateToImport.id);
          this.render();
          new ztoolkit.ProgressWindow(
            getString("settings-prompts-progress-title"),
          )
            .createLine({
              text: getString("settings-prompts-template-imported", {
                args: { name: templateToImport.name },
              }),
              type: "success",
            })
            .show();
          return true;
        } catch (error: any) {
          new ztoolkit.ProgressWindow(
            getString("settings-prompts-progress-title"),
          )
            .createLine({
              text: getString("settings-prompts-import-failed", {
                args: { error: error.message || String(error) },
              }),
              type: "fail",
            })
            .show();
          return false;
        }
      },
    });
  }

  private createMultiRoundPromptTemplate(): void {
    this.showTemplateMetadataDialog({
      title: getString("settings-prompts-new-dialog-title"),
      onConfirm: (name, description) => {
        const template = this.collectDeepReadTemplateFromEditor({
          ...this.localizeDefaultLikeDeepReadTemplate(
            getDefaultMultiRoundPromptTemplate(),
          ),
          id: `custom-${Date.now()}`,
          name,
          description,
        });
        const customTemplates = parseMultiRoundPromptTemplates(
          (getPref("multiRoundPromptTemplates") as string) || "[]",
        );
        const nextTemplates = this.upsertMultiRoundPromptTemplate(
          customTemplates,
          template,
        );
        setPref("multiRoundPromptTemplates", JSON.stringify(nextTemplates));
        this.rememberSelectedMultiRoundTemplate(template.id);
        this.render();
        new ztoolkit.ProgressWindow(
          getString("settings-prompts-progress-title"),
        )
          .createLine({
            text: getString("settings-prompts-template-created", {
              args: { name },
            }),
            type: "success",
          })
          .show();
      },
    });
  }

  private renameCurrentMultiRoundPromptTemplate(): void {
    const template = this.getSelectedMultiRoundTemplate();
    if (!template) {
      new ztoolkit.ProgressWindow(getString("settings-prompts-progress-title"))
        .createLine({
          text: getString("settings-prompts-select-template-first"),
          type: "fail",
        })
        .show();
      return;
    }
    if (this.isBuiltinMultiRoundPromptTemplate(template.id)) {
      new ztoolkit.ProgressWindow(getString("settings-prompts-progress-title"))
        .createLine({
          text: getString("settings-prompts-cannot-rename-default"),
          type: "fail",
        })
        .show();
      return;
    }

    this.showTemplateMetadataDialog({
      title: getString("settings-prompts-rename-dialog-title"),
      name: template.name,
      description: template.description || "",
      confirmText: getString("settings-prompts-rename"),
      onConfirm: (name, description) => {
        const customTemplates = parseMultiRoundPromptTemplates(
          (getPref("multiRoundPromptTemplates") as string) || "[]",
        );
        const nextTemplates = this.upsertMultiRoundPromptTemplate(
          customTemplates,
          {
            ...template,
            name,
            description,
          },
        );
        setPref("multiRoundPromptTemplates", JSON.stringify(nextTemplates));
        this.rememberSelectedMultiRoundTemplate(template.id);
        this.render();
        new ztoolkit.ProgressWindow(
          getString("settings-prompts-progress-title"),
        )
          .createLine({
            text: getString("settings-prompts-template-renamed", {
              args: { name },
            }),
            type: "success",
          })
          .show();
      },
    });
  }

  private copyCurrentMultiRoundPromptTemplate(): void {
    const template = this.getSelectedMultiRoundTemplate();
    if (!template) {
      new ztoolkit.ProgressWindow(getString("settings-prompts-progress-title"))
        .createLine({
          text: getString("settings-prompts-select-template-first"),
          type: "fail",
        })
        .show();
      return;
    }

    const copyName = getString("settings-prompts-copy-name", {
      args: { name: template.name },
    });
    const copiedTemplate: MultiRoundPromptTemplate = {
      ...template,
      id: `custom-${Date.now()}`,
      name: copyName,
      description:
        template.description ||
        getString("settings-prompts-copy-description", {
          args: { name: this.localizeBuiltinDeepReadTemplateName(template) },
        }),
    };
    const customTemplates = parseMultiRoundPromptTemplates(
      (getPref("multiRoundPromptTemplates") as string) || "[]",
    );
    const nextTemplates = this.upsertMultiRoundPromptTemplate(
      customTemplates,
      copiedTemplate,
    );
    setPref("multiRoundPromptTemplates", JSON.stringify(nextTemplates));
    this.rememberSelectedMultiRoundTemplate(copiedTemplate.id);
    this.render();
    new ztoolkit.ProgressWindow(getString("settings-prompts-progress-title"))
      .createLine({
        text: getString("settings-prompts-template-copied", {
          args: { name: copyName },
        }),
        type: "success",
      })
      .show();
  }

  private deleteCurrentMultiRoundPromptTemplate(): void {
    const template = this.getSelectedMultiRoundTemplate();
    if (!template) {
      new ztoolkit.ProgressWindow(getString("settings-prompts-progress-title"))
        .createLine({
          text: getString("settings-prompts-select-template-first"),
          type: "fail",
        })
        .show();
      return;
    }
    if (this.isBuiltinMultiRoundPromptTemplate(template.id)) {
      new ztoolkit.ProgressWindow(getString("settings-prompts-progress-title"))
        .createLine({
          text: getString("settings-prompts-cannot-delete-default"),
          type: "fail",
        })
        .show();
      return;
    }

    this.showInlineConfirm({
      title: getString("settings-prompts-delete-template-title"),
      message: getString("settings-prompts-delete-template-message", {
        args: { name: template.name },
      }),
      confirmText: getString("settings-prompts-delete-template"),
      confirmColor: "#e53935",
      onConfirm: () => {
        const customTemplates = parseMultiRoundPromptTemplates(
          (getPref("multiRoundPromptTemplates") as string) || "[]",
        ).filter((item) => item.id !== template.id);
        setPref("multiRoundPromptTemplates", JSON.stringify(customTemplates));
        this.rememberSelectedMultiRoundTemplate(null);
        this.render();
        new ztoolkit.ProgressWindow(
          getString("settings-prompts-progress-title"),
        )
          .createLine({
            text: getString("settings-prompts-template-deleted", {
              args: { name: template.name },
            }),
            type: "success",
          })
          .show();
      },
    });
  }

  private addFixedPromptToCurrentTemplate(): void {
    const template = this.collectDeepReadTemplateFromEditor(
      this.getSelectedMultiRoundTemplate() ||
        getDefaultMultiRoundPromptTemplate(),
    );
    const nextTemplate: MultiRoundPromptTemplate = {
      ...template,
      phases: template.phases.map((phase) => {
        if (phase.type !== "sequential_dynamic") return phase;
        const nextIndex = phase.fixedPrompts.length + 1;
        return {
          ...phase,
          fixedPrompts: [
            ...phase.fixedPrompts,
            {
              id: `fixed_custom_${Date.now()}`,
              title: getString("settings-prompts-fixed-reading-new-title", {
                args: { index: nextIndex },
              }),
              prompt:
                "\u8bf7\u57fa\u4e8e\u8bba\u6587\u5168\u6587\u5b8c\u6210\u4e00\u4e2a\u6587\u7ae0\u6574\u4f53\u901a\u8bfb\u4efb\u52a1\uff0c\u8f93\u51fa Markdown\u3002",
              order: nextIndex,
            },
          ],
        };
      }),
    };
    this.saveEditableTemplateDraft(nextTemplate);
  }

  private removeFixedPromptFromCurrentTemplate(index: number): void {
    const template = this.collectDeepReadTemplateFromEditor(
      this.getSelectedMultiRoundTemplate() ||
        getDefaultMultiRoundPromptTemplate(),
    );
    const nextTemplate: MultiRoundPromptTemplate = {
      ...template,
      phases: template.phases.map((phase) => {
        if (phase.type !== "sequential_dynamic") return phase;
        return {
          ...phase,
          fixedPrompts: phase.fixedPrompts
            .filter((_, promptIndex) => promptIndex !== index)
            .map((prompt, promptIndex) => ({
              ...prompt,
              order: promptIndex + 1,
            })),
        };
      }),
    };
    this.saveEditableTemplateDraft(nextTemplate);
  }

  private addIndependentPromptToCurrentTemplate(): void {
    const template = this.collectDeepReadTemplateFromEditor(
      this.getSelectedMultiRoundTemplate() ||
        getDefaultMultiRoundPromptTemplate(),
    );
    const nextTemplate: MultiRoundPromptTemplate = {
      ...template,
      phases: template.phases.map((phase) => {
        if (phase.type !== "independent") return phase;
        const nextIndex = phase.prompts.length + 1;
        return {
          ...phase,
          prompts: [
            ...phase.prompts,
            {
              id: `q_custom_${Date.now()}`,
              title: getString("settings-prompts-custom-followup-new-title", {
                args: { index: nextIndex },
              }),
              prompt:
                "\u8bf7\u57fa\u4e8e\u8bba\u6587\u5168\u6587\u63d0\u51fa\u4e00\u4e2a\u4f60\u8ba4\u4e3a\u6700\u5173\u952e\u7684\u8ffd\u95ee\uff0c\u5e76\u7528\u4e2d\u6587\u56de\u7b54\u3002\u8f93\u51fa Markdown\uff0c\u6807\u9898\u5c42\u7ea7\u4ece\u4e09\u7ea7\u6807\u9898\u5f00\u59cb\u3002",
              order: nextIndex,
            },
          ],
        };
      }),
    };
    this.saveEditableTemplateDraft(nextTemplate);
  }

  private removeIndependentPromptFromCurrentTemplate(
    indexToRemove: number,
  ): void {
    const template = this.collectDeepReadTemplateFromEditor(
      this.getSelectedMultiRoundTemplate() ||
        getDefaultMultiRoundPromptTemplate(),
    );
    const nextTemplate: MultiRoundPromptTemplate = {
      ...template,
      phases: template.phases.map((phase) => {
        if (phase.type !== "independent") return phase;
        return {
          ...phase,
          prompts: phase.prompts
            .filter((_prompt, index) => index !== indexToRemove)
            .map((prompt, index) => ({ ...prompt, order: index + 1 })),
        };
      }),
    };
    this.saveEditableTemplateDraft(nextTemplate);
  }

  private saveEditableTemplateDraft(template: MultiRoundPromptTemplate): void {
    const writable = this.createWritableMultiRoundPromptTemplate(template);
    const customTemplates = parseMultiRoundPromptTemplates(
      (getPref("multiRoundPromptTemplates") as string) || "[]",
    );
    const nextTemplates = this.upsertMultiRoundPromptTemplate(
      customTemplates,
      writable,
    );
    setPref("multiRoundPromptTemplates", JSON.stringify(nextTemplates));
    this.rememberSelectedMultiRoundTemplate(writable.id);
    this.render();
  }

  private upsertMultiRoundPromptTemplate(
    templates: MultiRoundPromptTemplate[],
    imported: MultiRoundPromptTemplate,
  ): MultiRoundPromptTemplate[] {
    const templateToSave =
      this.createWritableMultiRoundPromptTemplate(imported);
    const next = [...templates];
    const index = next.findIndex(
      (template) => template.id === templateToSave.id,
    );
    if (index === -1) {
      next.push(templateToSave);
    } else {
      next[index] = templateToSave;
    }
    return next;
  }

  private createWritableMultiRoundPromptTemplate(
    template: MultiRoundPromptTemplate,
  ): MultiRoundPromptTemplate {
    const builtinTemplateIds = new Set(
      getBuiltinMultiRoundPromptTemplates().map((item) => item.id),
    );
    if (!builtinTemplateIds.has(template.id)) {
      return template;
    }
    return {
      ...this.localizeDefaultLikeDeepReadTemplate(template),
      id: `custom-${Date.now()}`,
      name: getString("settings-prompts-customized-name", {
        args: { name: this.localizeBuiltinDeepReadTemplateName(template) },
      }),
      description:
        this.localizeBuiltinDeepReadTemplateDescription(template) ||
        getString("settings-prompts-save-builtin-description", {
          args: { name: this.localizeBuiltinDeepReadTemplateName(template) },
        }),
    };
  }

  private showTemplateMetadataDialog(options: {
    title: string;
    name?: string;
    description?: string;
    confirmText?: string;
    onConfirm: (name: string, description: string) => void;
  }): void {
    const { body, actions, close } = this.createPageDialog(options.title);

    const nameInput = createInput(
      "multi-round-template-name",
      "text",
      options.name || "",
      getString("settings-prompts-template-name-placeholder"),
    );
    const descriptionInput = createTextarea(
      "multi-round-template-description",
      options.description || "",
      4,
      getString("settings-prompts-template-description-placeholder"),
    );
    body.appendChild(
      createFormGroup(
        getString("settings-prompts-template-name-label"),
        nameInput,
      ),
    );
    body.appendChild(
      createFormGroup(
        getString("settings-prompts-template-description-label"),
        descriptionInput,
      ),
    );

    const btnCancel = createStyledButton(
      getString("settings-prompts-cancel"),
      "#9e9e9e",
      "small",
    );
    btnCancel.addEventListener("click", close);
    const btnConfirm = createStyledButton(
      options.confirmText || getString("settings-prompts-save-template"),
      "#4caf50",
      "small",
    );
    btnConfirm.addEventListener("click", () => {
      const name = nameInput.value.trim();
      if (!name) {
        new ztoolkit.ProgressWindow(
          getString("settings-prompts-progress-title"),
        )
          .createLine({
            text: getString("settings-prompts-template-name-required"),
            type: "fail",
          })
          .show();
        return;
      }
      options.onConfirm(name, descriptionInput.value.trim());
      close();
    });

    actions.appendChild(btnCancel);
    actions.appendChild(btnConfirm);
    setTimeout(() => nameInput.focus(), 0);
  }

  private showJsonDialog(options: {
    title: string;
    value: string;
    readOnly?: boolean;
    placeholder?: string;
    confirmText?: string;
    onConfirm?: (value: string) => boolean | void;
  }): void {
    const doc = Zotero.getMainWindow().document;
    const { body, actions, close } = this.createPageDialog(options.title);
    const textarea = doc.createElement("textarea");
    textarea.value = options.value;
    textarea.readOnly = !!options.readOnly;
    if (options.placeholder) {
      textarea.placeholder = options.placeholder;
    }
    Object.assign(textarea.style, {
      width: "100%",
      height: "360px",
      boxSizing: "border-box",
      resize: "vertical",
      fontFamily: "Consolas, Menlo, monospace",
      fontSize: "12px",
      lineHeight: "1.5",
      border: "1px solid var(--ai-input-border)",
      borderRadius: "6px",
      background: "var(--ai-input-bg)",
      color: "var(--ai-input-text)",
      padding: "10px",
    });
    body.appendChild(textarea);

    const btnClose = createStyledButton(
      getString("settings-prompts-close"),
      "#9e9e9e",
      "small",
    );
    btnClose.addEventListener("click", close);
    actions.appendChild(btnClose);

    if (options.onConfirm && options.confirmText) {
      const btnConfirm = createStyledButton(
        options.confirmText,
        "#4caf50",
        "small",
      );
      btnConfirm.addEventListener("click", () => {
        const shouldClose = options.onConfirm?.(textarea.value);
        if (shouldClose !== false) {
          close();
        }
      });
      actions.appendChild(btnConfirm);
    }
  }

  private createPageDialog(titleText: string): {
    body: HTMLElement;
    actions: HTMLElement;
    close: () => void;
  } {
    const doc = Zotero.getMainWindow().document;
    this.container
      .querySelectorAll(".ai-butler-page-dialog")
      .forEach((node: Element) => node.remove());

    const overlay = doc.createElement("div");
    overlay.className = "ai-butler-page-dialog";
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
      background: "rgba(15, 23, 42, 0.32)",
      zIndex: "99999",
      boxSizing: "border-box",
      overflow: "auto",
    });

    const dialog = doc.createElement("div");
    Object.assign(dialog.style, {
      width: "min(760px, calc(100vw - 48px))",
      maxHeight: "calc(100vh - 48px)",
      overflow: "auto",
      padding: "18px",
      borderRadius: "8px",
      background: "var(--ai-surface, #ffffff)",
      border: "1px solid var(--ai-border, #d7dde5)",
      boxShadow: "0 18px 50px rgba(15, 23, 42, 0.16)",
      color: "var(--ai-text, #1f2937)",
      boxSizing: "border-box",
    });
    overlay.appendChild(dialog);

    const title = doc.createElement("div");
    title.textContent = titleText;
    Object.assign(title.style, {
      fontSize: "16px",
      fontWeight: "700",
      marginBottom: "14px",
      color: "var(--ai-text, #1f2937)",
    });
    dialog.appendChild(title);

    const body = doc.createElement("div");
    dialog.appendChild(body);

    const actions = doc.createElement("div");
    Object.assign(actions.style, {
      display: "flex",
      justifyContent: "flex-end",
      gap: "10px",
      marginTop: "14px",
      flexWrap: "wrap",
    });
    dialog.appendChild(actions);

    const close = () => overlay.remove();
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        close();
      }
    });
    dialog.addEventListener("click", (event) => event.stopPropagation());
    (doc.body || this.container).appendChild(overlay);

    return { body, actions, close };
  }

  /**
   * 显示设置页内确认弹窗
   */
  private showInlineConfirm(options: {
    title: string;
    message: string;
    confirmText: string;
    confirmColor?: string;
    onConfirm: () => void;
  }): void {
    const doc = Zotero.getMainWindow().document;
    const { body, actions, close } = this.createPageDialog(options.title);

    const message = doc.createElement("div");
    message.textContent = options.message;
    Object.assign(message.style, {
      fontSize: "13px",
      lineHeight: "1.6",
      color: "var(--ai-text-muted, #4b5563)",
      wordBreak: "break-word",
      whiteSpace: "pre-wrap",
    });
    body.appendChild(message);

    const btnCancel = createStyledButton(
      getString("settings-prompts-cancel"),
      "#9e9e9e",
      "small",
    );
    btnCancel.addEventListener("click", close);

    const btnConfirm = createStyledButton(
      options.confirmText,
      options.confirmColor || "#e53935",
      "small",
    );
    btnConfirm.addEventListener("click", () => {
      close();
      options.onConfirm();
    });

    actions.appendChild(btnCancel);
    actions.appendChild(btnConfirm);
  }

  // =========== 表格总结提示词设置 ===========

  /**
   * 渲染表格总结提示词设置区域
   */
  private renderTableSettings(contentWrapper: HTMLElement): void {
    const doc = Zotero.getMainWindow().document;

    const tableSection = doc.createElement("div");
    Object.assign(tableSection.style, {
      marginBottom: "24px",
    });

    // 1. 表格模板编辑
    const currentTemplate = getConfiguredTableTemplate(
      getPref("tableTemplate" as any) as string,
    );
    const templateEditor = createTextarea(
      "table-template-editor",
      currentTemplate,
      10,
      getString("settings-prompts-table-template-placeholder"),
    );
    tableSection.appendChild(
      createFormGroup(
        getString("settings-prompts-table-template-label"),
        templateEditor,
        getString("settings-prompts-table-template-help"),
      ),
    );

    // 2. 填表提示词
    const currentFillPrompt = getConfiguredTableFillPrompt(
      getPref("tableFillPrompt" as any) as string,
    );
    const fillPromptEditor = createTextarea(
      "table-fill-prompt-editor",
      currentFillPrompt,
      8,
      getString("settings-prompts-table-fill-placeholder"),
    );
    tableSection.appendChild(
      createFormGroup(
        getString("settings-prompts-table-fill-label"),
        fillPromptEditor,
        getString("settings-prompts-table-fill-help"),
      ),
    );

    // 3. 汇总综述提示词
    const currentReviewPrompt = getConfiguredTableReviewPrompt(
      getPref("tableReviewPrompt" as any) as string,
    );
    const reviewPromptEditor = createTextarea(
      "table-review-prompt-editor",
      currentReviewPrompt,
      8,
      getString("settings-prompts-table-review-placeholder"),
    );
    tableSection.appendChild(
      createFormGroup(
        getString("settings-prompts-table-review-label"),
        reviewPromptEditor,
        getString("settings-prompts-table-review-help"),
      ),
    );

    // 4. 单篇笔记时额外填表开关
    const enableTableOnSingle =
      (getPref("enableTableOnSingleNote" as any) as boolean) ?? true;
    const enableTableCheckbox = createCheckbox(
      "enable-table-on-single",
      enableTableOnSingle,
    );
    enableTableCheckbox.addEventListener("click", () => {
      const checkbox = enableTableCheckbox.querySelector(
        "input",
      ) as HTMLInputElement;
      if (checkbox) {
        setPref("enableTableOnSingleNote" as any, checkbox.checked as any);
      }
    });
    tableSection.appendChild(
      createFormGroup(
        getString("settings-prompts-enable-table-on-note"),
        enableTableCheckbox,
        getString("settings-prompts-enable-table-on-note-help"),
      ),
    );

    // 5. 并行任务量控制
    const currentConcurrency =
      (getPref("tableFillConcurrency" as any) as number) || 3;
    const concurrencyInput = createInput(
      "table-fill-concurrency",
      "number",
      String(currentConcurrency),
      "1-10",
    );
    concurrencyInput.min = "1";
    concurrencyInput.max = "10";
    concurrencyInput.style.width = "80px";
    concurrencyInput.addEventListener("change", () => {
      let val = parseInt(concurrencyInput.value, 10);
      if (isNaN(val) || val < 1) val = 1;
      if (val > 10) val = 10;
      concurrencyInput.value = String(val);
      setPref("tableFillConcurrency" as any, val as any);
    });
    tableSection.appendChild(
      createFormGroup(
        getString("settings-prompts-table-concurrency"),
        concurrencyInput,
        getString("settings-prompts-table-concurrency-help"),
      ),
    );

    // 6. 保存 / 恢复默认 按钮
    const tableBtnRow = doc.createElement("div");
    Object.assign(tableBtnRow.style, {
      display: "flex",
      gap: "12px",
      marginTop: "16px",
    });

    const btnSaveTable = createStyledButton(
      getString("settings-prompts-save-table-settings"),
      "#4caf50",
    );
    btnSaveTable.addEventListener("click", () => {
      setPref("tableTemplate" as any, templateEditor.value as any);
      setPref("tableFillPrompt" as any, fillPromptEditor.value as any);
      setPref("tableReviewPrompt" as any, reviewPromptEditor.value as any);
      new ztoolkit.ProgressWindow(getString("settings-prompts-progress-title"))
        .createLine({
          text: getString("settings-prompts-table-settings-saved"),
          type: "success",
        })
        .show();
    });

    const btnResetTable = createStyledButton(
      getString("settings-prompts-restore"),
      "#9e9e9e",
    );
    btnResetTable.addEventListener("click", () => {
      const ok = Services.prompt.confirm(
        Zotero.getMainWindow() as any,
        getString("settings-prompts-reset-dialog-title"),
        getString("settings-prompts-reset-table-message"),
      );
      if (!ok) return;
      templateEditor.value = getDefaultTableTemplate();
      fillPromptEditor.value = getDefaultTableFillPrompt();
      reviewPromptEditor.value = getDefaultTableReviewPrompt();
      setPref("tableTemplate" as any, getDefaultTableTemplate() as any);
      setPref("tableFillPrompt" as any, getDefaultTableFillPrompt() as any);
      setPref("tableReviewPrompt" as any, getDefaultTableReviewPrompt() as any);
      setPref("enableTableOnSingleNote" as any, true as any);
      setPref("tableFillConcurrency" as any, 3 as any);
      const checkbox = enableTableCheckbox.querySelector(
        "input",
      ) as HTMLInputElement;
      if (checkbox) checkbox.checked = true;
      concurrencyInput.value = "3";
      new ztoolkit.ProgressWindow(getString("settings-prompts-progress-title"))
        .createLine({
          text: getString("settings-prompts-table-settings-reset"),
          type: "success",
        })
        .show();
    });

    tableBtnRow.appendChild(btnSaveTable);
    tableBtnRow.appendChild(btnResetTable);
    tableSection.appendChild(tableBtnRow);

    contentWrapper.appendChild(tableSection);
  }
}
