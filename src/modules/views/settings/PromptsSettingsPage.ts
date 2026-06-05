/**
 * 提示词管理页
 *
 * @file PromptsSettingsPage.ts
 */

import { getPref, setPref } from "../../../utils/prefs";
import {
  getDefaultSummaryPrompt,
  getDefaultTableTemplate,
  getDefaultTableFillPrompt,
  getDefaultTableReviewPrompt,
  PROMPT_VERSION,
  parseMultiRoundPrompts,
  getDefaultMultiRoundFinalPrompt,
  getBuiltinMultiRoundPromptTemplates,
  parseMultiRoundPromptTemplates,
  mergeMultiRoundPromptTemplates,
  parseMultiRoundPromptTemplateExport,
  serializeMultiRoundPromptTemplate,
  type MultiRoundPromptItem,
  type MultiRoundPromptTemplate,
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

type PresetMap = Record<string, string>;
type PromptSettingsKind = "summary" | "deepRead" | "table" | "all";
const CURRENT_MULTI_ROUND_TEMPLATE_ID = "__current_multi_round_template__";
const MULTI_ROUND_TEMPLATE_ID_PREF = "multiRoundPromptTemplateId";
const DEEP_READ_PROMPT_NOTICE =
  "AI 精读目标是把论文读厚：按多轮提示词依次追问论文，并把每一轮回答完整沉淀到 AI 精读笔记。<br/>下面的模板是一组可复用的多轮提示词；每一轮的“标题”用于标识本轮阅读主题，“提示词”是实际发给 AI 的问题。";

export class PromptsSettingsPage {
  private container: HTMLElement;
  private pageKind: PromptSettingsKind;

  // UI refs
  private presetSelect!: HTMLElement; // 自定义下拉框
  private editor!: HTMLTextAreaElement;
  private previewBox!: HTMLElement;
  private sampleTitle!: HTMLInputElement;
  private sampleAuthors!: HTMLInputElement;
  private sampleYear!: HTMLInputElement;
  private editingMultiRoundPromptId: string | null = null;
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
        return "\u{1f4dd} AI \u603b\u7ed3\u63d0\u793a\u8bcd";
      case "deepRead":
        return "📚 AI精读多轮提示词模板";
      case "table":
        return "\u{1f4ca} \u8868\u683c\u603b\u7ed3\u63d0\u793a\u8bcd";
      default:
        return "\u{1f4dd} \u63d0\u793a\u8bcd\u6a21\u677f";
    }
  }

  private getPageNotice(): string {
    switch (this.pageKind) {
      case "summary":
        return "AI \u603b\u7ed3\u7528\u4e8e\u628a\u6587\u7ae0\u8bfb\u8584\u3002\u672c\u9875\u53ea\u7ba1\u7406\u5355\u8f6e\u603b\u7ed3\u63d0\u793a\u8bcd\u3001\u9884\u8bbe\u6a21\u677f\u3001\u53d8\u91cf\u9884\u89c8\u3001\u4fdd\u5b58\u548c\u6062\u590d\u9ed8\u8ba4\u3002";
      case "deepRead":
        return DEEP_READ_PROMPT_NOTICE;
      case "table":
        return "\u8868\u683c\u603b\u7ed3\u7528\u4e8e\u7ed3\u6784\u5316\u9605\u8bfb\u548c\u6587\u732e\u7efc\u8ff0\u3002\u672c\u9875\u53ea\u7ba1\u7406\u8868\u683c\u6a21\u677f\u3001\u9010\u7bc7\u586b\u8868\u63d0\u793a\u8bcd\u548c\u6c47\u603b\u7efc\u8ff0\u63d0\u793a\u8bcd\u3002";
      default:
        return "\u63d0\u793a: \u652f\u6301\u9884\u8bbe\u6a21\u677f\u3001\u81ea\u5b9a\u4e49\u7f16\u8f91\u4e0e\u53d8\u91cf\u63d2\u503c\u9884\u89c8\u3002\u53ef\u7528\u53d8\u91cf: <code>${title}</code>\u3001<code>${authors}</code>\u3001<code>${year}</code>\u3002";
    }
  }

  public render(): void {
    this.container.innerHTML = "";

    // 内容包装器 - 限制最大宽度，防止内容撑开容器
    const contentWrapper = Zotero.getMainWindow().document.createElement("div");
    Object.assign(contentWrapper.style, {
      maxWidth: "680px",
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

    // =========== AI 精读提示词设置 ===========
    const modeSection = Zotero.getMainWindow().document.createElement("div");
    Object.assign(modeSection.style, {
      marginBottom: "24px",
    });

    if (this.pageKind === "all") {
      modeSection.appendChild(createNotice(DEEP_READ_PROMPT_NOTICE, "info"));
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
    });

    const multiRoundTitle = Zotero.getMainWindow().document.createElement("h4");
    multiRoundTitle.textContent = "📋 AI 精读多轮提示词模板";
    Object.assign(multiRoundTitle.style, {
      color: "#59c0bc",
      margin: "0",
      fontSize: "14px",
      whiteSpace: "nowrap",
    });
    multiRoundHeader.appendChild(multiRoundTitle);

    multiRoundContainer.appendChild(multiRoundHeader);

    const promptsJson = (getPref("multiRoundPrompts" as any) as string) || "[]";
    const prompts = parseMultiRoundPrompts(promptsJson);

    multiRoundContainer.appendChild(
      this.renderMultiRoundTemplateControls(prompts),
    );

    const promptsList = Zotero.getMainWindow().document.createElement("div");
    promptsList.id = "multi-round-prompts-list";
    Object.assign(promptsList.style, {
      marginBottom: "12px",
    });

    this.renderMultiRoundPromptsList(promptsList, prompts);
    multiRoundContainer.appendChild(promptsList);
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
      gridTemplateColumns: "minmax(280px, 340px) 1fr",
      gap: "20px",
      alignItems: "start",
    });
    summarySection.appendChild(layout);

    // 左侧: 模板选择与示例变量
    const left = Zotero.getMainWindow().document.createElement("div");
    layout.appendChild(left);

    // 预设选择
    const presets = this.getAllPresets();
    const currentPrompt =
      (getPref("summaryPrompt") as string) || getDefaultSummaryPrompt();
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
        "选择预设",
        this.presetSelect,
        "选择后可在右侧编辑器中查看与修改",
      ),
    );

    // 预设按钮 - 竖向布局，避免文字溢出
    const presetBtnCol = Zotero.getMainWindow().document.createElement("div");
    Object.assign(presetBtnCol.style, {
      display: "flex",
      flexDirection: "column",
      gap: "10px",
      marginBottom: "16px",
    });

    const btnApplyPreset = createStyledButton("📋 应用预设", "#2196f3");
    Object.assign(btnApplyPreset.style, {
      width: "100%",
      padding: "12px 20px",
      fontSize: "14px",
    });
    btnApplyPreset.addEventListener("click", () => this.loadPresetToEditor());

    const btnSaveAsPreset = createStyledButton("💾 保存为新预设", "#4caf50");
    Object.assign(btnSaveAsPreset.style, {
      width: "100%",
      padding: "12px 20px",
      fontSize: "14px",
    });
    btnSaveAsPreset.addEventListener("click", () => this.saveAsPreset());

    const btnDeletePreset = createStyledButton("🗑️ 删除预设", "#f44336");
    Object.assign(btnDeletePreset.style, {
      width: "100%",
      padding: "12px 20px",
      fontSize: "14px",
    });
    btnDeletePreset.addEventListener("click", () => this.deleteCustomPreset());

    presetBtnCol.appendChild(btnApplyPreset);
    presetBtnCol.appendChild(btnSaveAsPreset);
    presetBtnCol.appendChild(btnDeletePreset);
    left.appendChild(presetBtnCol);

    // 示例变量输入
    left.appendChild(createSectionTitle("示例元数据(用于预览)"));
    this.sampleTitle = createInput(
      "sample-title",
      "text",
      "A Great Paper",
      "论文标题",
    );
    left.appendChild(createFormGroup("标题", this.sampleTitle));
    this.sampleAuthors = createInput(
      "sample-authors",
      "text",
      "Alice; Bob",
      "作者,用分号分隔",
    );
    left.appendChild(createFormGroup("作者", this.sampleAuthors));
    this.sampleYear = createInput("sample-year", "text", "2024", "年份");
    left.appendChild(createFormGroup("年份", this.sampleYear));

    // 右侧: 编辑器 + 操作 + 预览
    const right = Zotero.getMainWindow().document.createElement("div");
    layout.appendChild(right);

    this.editor = createTextarea(
      "prompt-editor",
      currentPrompt,
      18,
      "在此编辑提示词模板...",
    );
    right.appendChild(
      createFormGroup(
        "模板编辑器",
        this.editor,
        "可直接编辑; 支持变量 ${title}/${authors}/${year}",
      ),
    );

    // 操作按钮
    const actionRow = Zotero.getMainWindow().document.createElement("div");
    Object.assign(actionRow.style, {
      display: "flex",
      gap: "12px",
      marginTop: "8px",
      marginBottom: "16px",
    });
    const btnSave = createStyledButton("💾 保存", "#4caf50");
    btnSave.addEventListener("click", () => this.saveCurrent());
    const btnReset = createStyledButton("🔄 恢复", "#9e9e9e");
    btnReset.addEventListener("click", () => this.resetDefault());
    const btnPreview = createStyledButton("👁️ 预览", "#2196f3");
    btnPreview.addEventListener("click", () => this.updatePreview());
    actionRow.appendChild(btnSave);
    actionRow.appendChild(btnReset);
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
        "插值预览",
        this.previewBox,
        "展示变量替换后的实际请求内容片段",
      ),
    );

    // Render preview only on the AI summary prompt page
    if (this.shouldRender("summary")) {
      this.updatePreview();
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
  private getAllPresets(): PresetMap {
    const builtins: PresetMap = {
      默认模板: getDefaultSummaryPrompt(),
      精简摘要: `你是一名学术助手。请用中文以简洁的要点方式总结论文主要问题、方法、关键结果与结论。文章信息: 标题=${"${title}"}; 作者=${"${authors}"}; 年份=${"${year}"}`,
      结构化报告: `请以"背景/方法/结果/讨论/局限/结论"六部分结构化总结论文; 开头写:《${"${title}"}》(${" ${year} "}).`,
      计算机默认: `帮我用中文讲一下这篇计算机领域的论文，讲的越详细越好，我有通用计算机专业基础，但是没有这个小方向的基础。输出的时候只包含关于论文的讲解，不要包含寒暄的内容。开始时先用一段话总结这篇论文的核心内容。`,
    };

    // 自定义预设
    const custom: PresetMap = {};
    try {
      const raw = (getPref("customPrompts") as string) || "";
      if (raw && raw.trim()) {
        const parsed = JSON.parse(raw);
        // 过滤掉空值，防止 null/undefined
        Object.entries(parsed).forEach(([k, v]) => {
          if (v && typeof v === "string") {
            custom[k] = v;
          }
        });
      }
    } catch (e) {
      ztoolkit.log("[PromptsSettings] Failed to parse customPrompts:", e);
    }

    return { ...builtins, ...custom };
  }

  private detectPresetName(current: string, presets: PresetMap): string {
    // 防止 null/undefined 值导致错误
    if (!current) return "默认模板";
    const entry = Object.entries(presets).find(([, v]) => {
      return v && typeof v === "string" && v.trim() === current.trim();
    });
    return entry ? entry[0] : "默认模板";
  }

  private loadPresetToEditor(): void {
    const name = (this.presetSelect as any).getValue();
    const presets = this.getAllPresets();
    const tpl = presets[name];
    if (tpl && typeof tpl === "string") {
      this.editor.value = tpl;
      setPref("summaryPrompt", tpl); // 保存到配置，确保立即生效
      new ztoolkit.ProgressWindow("提示词")
        .createLine({ text: `已应用并保存预设: ${name}`, type: "success" })
        .show();
      this.updatePreview();
    } else {
      new ztoolkit.ProgressWindow("提示词")
        .createLine({ text: "预设模板为空或无效", type: "fail" })
        .show();
    }
  }

  private saveAsPreset(): void {
    const win = Zotero.getMainWindow() as any;
    const name = { value: "" } as any;
    const ok = Services.prompt.prompt(
      win,
      "保存为新预设",
      "请输入预设名称:",
      name,
      "",
      { value: false },
    );
    if (!ok || !name.value || !name.value.trim()) return;

    const presetName = name.value.trim();
    const editorValue = this.editor.value || "";

    if (!editorValue.trim()) {
      new ztoolkit.ProgressWindow("提示词")
        .createLine({ text: "❌ 模板内容为空", type: "fail" })
        .show();
      return;
    }

    const custom: PresetMap = {};
    try {
      const raw = (getPref("customPrompts") as string) || "";
      if (raw && raw.trim()) {
        const parsed = JSON.parse(raw);
        // 过滤空值
        Object.entries(parsed).forEach(([k, v]) => {
          if (v && typeof v === "string") custom[k] = v;
        });
      }
    } catch (e) {
      ztoolkit.log("[PromptsSettings] Failed to parse customPrompts:", e);
    }

    custom[presetName] = editorValue;
    setPref("customPrompts", JSON.stringify(custom));

    // 重新渲染整个页面来更新下拉框选项
    this.render();

    // 设置下拉框为新保存的预设
    setTimeout(() => {
      (this.presetSelect as any).setValue(presetName);
    }, 0);

    new ztoolkit.ProgressWindow("提示词")
      .createLine({ text: `✅ 预设已保存: ${presetName}`, type: "success" })
      .show();
  }

  private deleteCustomPreset(): void {
    const name = (this.presetSelect as any).getValue();
    // 只允许删除自定义的(避免删内置)
    const custom: PresetMap = {};
    try {
      const raw = (getPref("customPrompts") as string) || "";
      if (raw && raw.trim()) {
        const parsed = JSON.parse(raw);
        Object.entries(parsed).forEach(([k, v]) => {
          if (v && typeof v === "string") custom[k] = v;
        });
      }
    } catch (e) {
      ztoolkit.log("[PromptsSettings] Failed to parse customPrompts:", e);
    }

    if (!(name in custom)) {
      new ztoolkit.ProgressWindow("提示词")
        .createLine({ text: "只能删除自定义预设", type: "default" })
        .show();
      return;
    }
    const ok = Services.prompt.confirm(
      Zotero.getMainWindow() as any,
      "删除预设",
      `确定删除自定义预设: ${name} ?`,
    );
    if (!ok) return;
    delete custom[name];
    setPref("customPrompts", JSON.stringify(custom));

    // 重新渲染整个页面来更新下拉框选项（与 saveAsPreset 一致）
    this.render();

    // 设置下拉框为默认模板
    setTimeout(() => {
      (this.presetSelect as any).setValue("默认模板");
    }, 0);

    new ztoolkit.ProgressWindow("提示词")
      .createLine({ text: `✅ 已删除预设: ${name}`, type: "success" })
      .show();
  }

  private saveCurrent(): void {
    const text = this.editor.value || getDefaultSummaryPrompt();
    setPref("summaryPrompt", text);

    // 获取当前选中的预设名
    const currentPresetName = (this.presetSelect as any).getValue();

    // 检查是否是自定义预设，如果是则同时更新
    const custom: PresetMap = {};
    try {
      const raw = (getPref("customPrompts") as string) || "";
      if (raw && raw.trim()) {
        const parsed = JSON.parse(raw);
        Object.entries(parsed).forEach(([k, v]) => {
          if (v && typeof v === "string") custom[k] = v;
        });
      }
    } catch (e) {
      ztoolkit.log("[PromptsSettings] Failed to parse customPrompts:", e);
    }

    if (currentPresetName in custom) {
      // 更新自定义预设
      custom[currentPresetName] = text;
      setPref("customPrompts", JSON.stringify(custom));
      new ztoolkit.ProgressWindow("提示词")
        .createLine({
          text: `✅ 预设「${currentPresetName}」已更新`,
          type: "success",
        })
        .show();
    } else {
      // 内置预设，仅保存到 summaryPrompt
      new ztoolkit.ProgressWindow("提示词")
        .createLine({ text: "✅ 当前模板已保存", type: "success" })
        .show();
    }
  }

  private resetDefault(): void {
    const ok = Services.prompt.confirm(
      Zotero.getMainWindow() as any,
      "恢复默认",
      "确定将模板恢复为默认吗?",
    );
    if (!ok) return;
    const def = getDefaultSummaryPrompt();
    setPref("summaryPrompt", def);
    setPref("promptVersion" as any, PROMPT_VERSION as any);
    this.editor.value = def;
    this.updatePreview();
    new ztoolkit.ProgressWindow("提示词")
      .createLine({ text: "已恢复为默认模板", type: "success" })
      .show();
  }

  private updatePreview(): void {
    const vars = {
      title: this.sampleTitle?.value || "(示例标题)",
      authors: this.sampleAuthors?.value || "(示例作者)",
      year: this.sampleYear?.value || "(年份)",
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
              label: "当前配置（未保存为模板）",
            },
            ...templates.map((template) => ({
              value: template.id,
              label: template.name,
            })),
          ]
        : templates.map((template) => ({
            value: template.id,
            label: template.name,
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
      "提示词模板",
      this.multiRoundTemplateSelect,
      "选择模板后会立即切换当前 AI 精读轮次提示词。",
    );
    Object.assign(templateGroup.style, {
      flex: "1 1 320px",
      marginBottom: "0",
      minWidth: "260px",
    });
    controlsRow.appendChild(templateGroup);

    const actions = doc.createElement("div");
    Object.assign(actions.style, {
      display: "flex",
      gap: "8px",
      justifyContent: "flex-start",
      flexWrap: "wrap",
      paddingTop: "27px",
    });

    const btnNewTemplate = createStyledButton("新建模板", "#4caf50", "small");
    btnNewTemplate.addEventListener("click", () =>
      this.createMultiRoundPromptTemplate(),
    );
    const btnRenameTemplate = createStyledButton("重命名", "#2196f3", "small");
    btnRenameTemplate.addEventListener("click", () =>
      this.renameCurrentMultiRoundPromptTemplate(),
    );
    const btnCopyTemplate = createStyledButton("复制模板", "#673ab7", "small");
    btnCopyTemplate.addEventListener("click", () =>
      this.copyCurrentMultiRoundPromptTemplate(),
    );
    const btnDeleteTemplate = createStyledButton(
      "删除模板",
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
    controlsRow.appendChild(actions);
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

    const btnAddPrompt = createStyledButton("+ 添加轮次", "#4caf50", "small");
    btnAddPrompt.addEventListener("click", () => this.addMultiRoundPrompt());
    const btnSaveTemplate = createStyledButton("保存模板", "#2196f3", "small");
    btnSaveTemplate.addEventListener("click", () =>
      this.confirmSaveCurrentMultiRoundTemplate(),
    );
    const btnExportTemplate = createStyledButton(
      "导出模板",
      "#673ab7",
      "small",
    );
    btnExportTemplate.addEventListener("click", () =>
      this.exportCurrentMultiRoundTemplate(),
    );
    const btnImportTemplate = createStyledButton(
      "导入模板",
      "#ff9800",
      "small",
    );
    btnImportTemplate.addEventListener("click", () =>
      this.importMultiRoundPromptTemplate(),
    );

    actions.appendChild(btnAddPrompt);
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
    );
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
    return this.detectMultiRoundTemplateId(currentPrompts, templates);
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
      new ztoolkit.ProgressWindow("提示词")
        .createLine({ text: "模板不存在", type: "fail" })
        .show();
      return;
    }

    this.saveMultiRoundPrompts(template.prompts);
    if (template.finalPrompt) {
      setPref("multiRoundFinalPrompt", template.finalPrompt);
    }
    this.rememberSelectedMultiRoundTemplate(template.id);
    this.editingMultiRoundPromptId = null;
    this.render();
    new ztoolkit.ProgressWindow("提示词")
      .createLine({
        text: `✅ 已切换模板: ${template.name}`,
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
      new ztoolkit.ProgressWindow("提示词")
        .createLine({ text: "当前配置未绑定模板，请先新建模板", type: "fail" })
        .show();
      return;
    }

    const template = this.getMultiRoundPromptTemplates().find(
      (item) => item.id === templateId,
    );
    if (!template) {
      new ztoolkit.ProgressWindow("提示词")
        .createLine({ text: "模板不存在", type: "fail" })
        .show();
      return;
    }

    const prompts = this.getMultiRoundPrompts();
    if (!prompts.length) {
      new ztoolkit.ProgressWindow("提示词")
        .createLine({ text: "请先添加至少一轮提示词", type: "fail" })
        .show();
      return;
    }

    const saveTarget = this.createWritableMultiRoundPromptTemplate(template);
    this.showInlineConfirm({
      title: "保存提示词模板？",
      message: `将保存至「${saveTarget.name}」模板。`,
      confirmText: "保存模板",
      confirmColor: "#4caf50",
      onConfirm: () => {
        const savedTemplate = this.saveCurrentMultiRoundTemplate(
          saveTarget,
          prompts,
        );
        this.render();
        new ztoolkit.ProgressWindow("提示词")
          .createLine({
            text: `✅ 已保存模板: ${savedTemplate.name}`,
            type: "success",
          })
          .show();
      },
    });
  }

  private saveCurrentMultiRoundTemplate(
    template: MultiRoundPromptTemplate,
    prompts: MultiRoundPromptItem[],
  ): MultiRoundPromptTemplate {
    const updatedTemplate: MultiRoundPromptTemplate = {
      ...template,
      prompts,
      finalPrompt:
        (getPref("multiRoundFinalPrompt") as string) ||
        template.finalPrompt ||
        getDefaultMultiRoundFinalPrompt(),
    };
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

  private exportCurrentMultiRoundTemplate(): void {
    const prompts = this.getMultiRoundPrompts();
    const selectedTemplateId = (
      this.multiRoundTemplateSelect as any
    )?.getValue?.();
    const selectedTemplate = this.getMultiRoundPromptTemplates().find(
      (item) => item.id === selectedTemplateId,
    );
    const currentFinalPrompt =
      (getPref("multiRoundFinalPrompt") as string) ||
      selectedTemplate?.finalPrompt ||
      getDefaultMultiRoundFinalPrompt();
    const template: MultiRoundPromptTemplate = {
      id: selectedTemplate?.id || `template-${Date.now()}`,
      name: selectedTemplate?.name || "当前 AI 精读模板",
      description:
        selectedTemplate?.description || "从当前 AI 精读轮次提示词导出。",
      version: selectedTemplate?.version || 1,
      prompts,
      finalPrompt: currentFinalPrompt,
    };

    this.showJsonDialog({
      title: "导出 AI 精读提示词模板",
      value: serializeMultiRoundPromptTemplate(template),
      readOnly: true,
    });
  }

  private importMultiRoundPromptTemplate(): void {
    this.showJsonDialog({
      title: "导入 AI 精读提示词模板",
      value: "",
      placeholder: "粘贴导出的提示词模板 JSON...",
      confirmText: "导入模板",
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
          this.saveMultiRoundPrompts(templateToImport.prompts);
          if (templateToImport.finalPrompt) {
            setPref("multiRoundFinalPrompt", templateToImport.finalPrompt);
          }
          this.render();
          new ztoolkit.ProgressWindow("提示词")
            .createLine({
              text: `✅ 已导入模板: ${templateToImport.name}`,
              type: "success",
            })
            .show();
          return true;
        } catch (error: any) {
          new ztoolkit.ProgressWindow("提示词")
            .createLine({
              text: `❌ 导入失败: ${error.message || String(error)}`,
              type: "fail",
            })
            .show();
          return false;
        }
      },
    });
  }

  private createMultiRoundPromptTemplate(): void {
    const prompts = this.getMultiRoundPrompts();
    if (!prompts.length) {
      new ztoolkit.ProgressWindow("提示词")
        .createLine({ text: "请先添加至少一轮提示词", type: "fail" })
        .show();
      return;
    }

    this.showTemplateMetadataDialog({
      title: "新建 AI 精读提示词模板",
      onConfirm: (name, description) => {
        const template: MultiRoundPromptTemplate = {
          id: `custom-${Date.now()}`,
          name,
          description,
          version: 1,
          prompts,
          finalPrompt:
            (getPref("multiRoundFinalPrompt") as string) ||
            getDefaultMultiRoundFinalPrompt(),
        };
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
        new ztoolkit.ProgressWindow("提示词")
          .createLine({ text: `✅ 已新建模板: ${name}`, type: "success" })
          .show();
      },
    });
  }

  private renameCurrentMultiRoundPromptTemplate(): void {
    const template = this.getSelectedMultiRoundTemplate();
    if (!template) {
      new ztoolkit.ProgressWindow("提示词")
        .createLine({ text: "请先选择一个模板", type: "fail" })
        .show();
      return;
    }
    if (this.isBuiltinMultiRoundPromptTemplate(template.id)) {
      new ztoolkit.ProgressWindow("提示词")
        .createLine({ text: "默认模板不可重命名，请先复制模板", type: "fail" })
        .show();
      return;
    }

    this.showTemplateMetadataDialog({
      title: "重命名 AI 精读提示词模板",
      name: template.name,
      description: template.description || "",
      confirmText: "重命名",
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
        new ztoolkit.ProgressWindow("提示词")
          .createLine({ text: `✅ 已重命名模板: ${name}`, type: "success" })
          .show();
      },
    });
  }

  private copyCurrentMultiRoundPromptTemplate(): void {
    const template = this.getSelectedMultiRoundTemplate();
    if (!template) {
      new ztoolkit.ProgressWindow("提示词")
        .createLine({ text: "请先选择一个模板", type: "fail" })
        .show();
      return;
    }

    const copyName = `${template.name} 副本`;
    const copiedTemplate: MultiRoundPromptTemplate = {
      ...template,
      id: `custom-${Date.now()}`,
      name: copyName,
      description: template.description || `从模板「${template.name}」复制。`,
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
    this.saveMultiRoundPrompts(copiedTemplate.prompts);
    if (copiedTemplate.finalPrompt) {
      setPref("multiRoundFinalPrompt", copiedTemplate.finalPrompt);
    }
    this.render();
    new ztoolkit.ProgressWindow("提示词")
      .createLine({ text: `✅ 已复制模板: ${copyName}`, type: "success" })
      .show();
  }

  private deleteCurrentMultiRoundPromptTemplate(): void {
    const template = this.getSelectedMultiRoundTemplate();
    if (!template) {
      new ztoolkit.ProgressWindow("提示词")
        .createLine({ text: "请先选择一个模板", type: "fail" })
        .show();
      return;
    }
    if (this.isBuiltinMultiRoundPromptTemplate(template.id)) {
      new ztoolkit.ProgressWindow("提示词")
        .createLine({ text: "默认模板不可删除", type: "fail" })
        .show();
      return;
    }

    this.showInlineConfirm({
      title: "删除提示词模板？",
      message: `将删除「${template.name}」模板。当前轮次提示词不会被清空，但该模板会从模板列表移除。`,
      confirmText: "删除模板",
      confirmColor: "#e53935",
      onConfirm: () => {
        const customTemplates = parseMultiRoundPromptTemplates(
          (getPref("multiRoundPromptTemplates") as string) || "[]",
        ).filter((item) => item.id !== template.id);
        setPref("multiRoundPromptTemplates", JSON.stringify(customTemplates));
        this.rememberSelectedMultiRoundTemplate(null);
        this.render();
        new ztoolkit.ProgressWindow("提示词")
          .createLine({
            text: `✅ 已删除模板: ${template.name}`,
            type: "success",
          })
          .show();
      },
    });
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
      ...template,
      id: `custom-${Date.now()}`,
      name: `${template.name}（自定义）`,
      description:
        template.description || `从内置模板「${template.name}」保存。`,
    };
  }

  private saveMultiRoundPrompts(prompts: MultiRoundPromptItem[]): void {
    const normalized = prompts.map((prompt, index) => ({
      ...prompt,
      order: index + 1,
    }));
    setPref("multiRoundPrompts" as any, JSON.stringify(normalized) as any);
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
      "例如：系统论文精读模板",
    );
    const descriptionInput = createTextarea(
      "multi-round-template-description",
      options.description || "",
      4,
      "模板用途说明，可留空",
    );
    body.appendChild(createFormGroup("模板名称", nameInput));
    body.appendChild(createFormGroup("模板说明", descriptionInput));

    const btnCancel = createStyledButton("取消", "#9e9e9e", "small");
    btnCancel.addEventListener("click", close);
    const btnConfirm = createStyledButton(
      options.confirmText || "保存模板",
      "#4caf50",
      "small",
    );
    btnConfirm.addEventListener("click", () => {
      const name = nameInput.value.trim();
      if (!name) {
        new ztoolkit.ProgressWindow("提示词")
          .createLine({ text: "模板名称不能为空", type: "fail" })
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

    const btnClose = createStyledButton("关闭", "#9e9e9e", "small");
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

  /**
   * 渲染多轮提示词列表
   */
  private renderMultiRoundPromptsList(
    container: HTMLElement,
    prompts: MultiRoundPromptItem[],
  ): void {
    const doc = Zotero.getMainWindow().document;
    container.innerHTML = "";

    if (prompts.length === 0) {
      const empty = doc.createElement("div");
      empty.textContent =
        "\u6682\u65e0\u591a\u8f6e\u63d0\u793a\u8bcd\uff0c\u8bf7\u6dfb\u52a0\u6216\u6062\u590d\u9ed8\u8ba4";
      Object.assign(empty.style, {
        color: "var(--ai-text-secondary)",
        padding: "18px 12px",
        textAlign: "center",
        border: "1px dashed var(--ai-input-border)",
        borderRadius: "8px",
      });
      container.appendChild(empty);
      return;
    }

    prompts.forEach((prompt, index) => {
      const isEditing = this.editingMultiRoundPromptId === prompt.id;
      const item = doc.createElement("div");
      Object.assign(item.style, {
        marginBottom: "8px",
        padding: isEditing ? "10px 12px 12px" : "8px 10px",
        background: isEditing ? "rgba(89, 192, 188, 0.06)" : "transparent",
        borderRadius: "8px",
        border: isEditing
          ? "1px solid #59c0bc"
          : "1px solid var(--ai-input-border)",
        minWidth: "0",
      });

      const row = doc.createElement("div");
      Object.assign(row.style, {
        display: "grid",
        gridTemplateColumns:
          "28px minmax(76px, 120px) minmax(0, 1fr) auto auto",
        alignItems: "center",
        columnGap: "10px",
        minWidth: "0",
      });

      const orderBadge = doc.createElement("span");
      orderBadge.textContent = String(index + 1);
      Object.assign(orderBadge.style, {
        background: "#59c0bc",
        color: "white",
        borderRadius: "999px",
        width: "24px",
        height: "24px",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "12px",
        fontWeight: "700",
      });
      row.appendChild(orderBadge);

      const title = doc.createElement("div");
      title.textContent = prompt.title;
      Object.assign(title.style, {
        color: "var(--ai-text-primary)",
        fontSize: "13px",
        fontWeight: "700",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      });
      row.appendChild(title);

      const preview = doc.createElement("div");
      preview.textContent =
        prompt.prompt ||
        "\uff08\u5c1a\u672a\u586b\u5199\u63d0\u793a\u8bcd\uff09";
      Object.assign(preview.style, {
        color: "var(--ai-text-secondary)",
        fontSize: "12px",
        lineHeight: "1.5",
        minWidth: "0",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        opacity: prompt.prompt ? "0.9" : "0.58",
      });
      row.appendChild(preview);

      const btnEdit = doc.createElement("button");
      btnEdit.textContent = isEditing ? "\u6536\u8d77" : "\u7f16\u8f91";
      btnEdit.title = isEditing
        ? "\u6536\u8d77\u7f16\u8f91\u5668"
        : "\u7f16\u8f91";
      Object.assign(btnEdit.style, {
        border: "1px solid #59c0bc",
        borderRadius: "6px",
        background: isEditing ? "#59c0bc" : "transparent",
        color: isEditing ? "white" : "#59c0bc",
        cursor: "pointer",
        fontSize: "12px",
        padding: "4px 10px",
        minWidth: "52px",
        whiteSpace: "nowrap",
      });
      btnEdit.addEventListener("click", () => {
        this.editingMultiRoundPromptId = isEditing ? null : prompt.id;
        this.renderMultiRoundPromptsList(container, prompts);
      });
      row.appendChild(btnEdit);

      const btnDelete = doc.createElement("button");
      btnDelete.textContent = "🗑️";
      btnDelete.title = "\u5220\u9664";
      const applyDeleteIdleStyle = () => {
        btnDelete.style.border = "1px solid rgba(128, 128, 128, 0.28)";
        btnDelete.style.background = "rgba(128, 128, 128, 0.04)";
        btnDelete.style.color = "var(--ai-text-secondary)";
        btnDelete.style.opacity = "0.82";
      };
      Object.assign(btnDelete.style, {
        borderRadius: "6px",
        cursor: "pointer",
        fontSize: "13px",
        padding: "4px 7px",
        transition:
          "border-color 0.15s ease, background 0.15s ease, color 0.15s ease",
      });
      applyDeleteIdleStyle();
      btnDelete.addEventListener("mouseenter", () => {
        btnDelete.style.border = "1px solid rgba(244, 67, 54, 0.45)";
        btnDelete.style.background = "rgba(244, 67, 54, 0.08)";
        btnDelete.style.color = "#f44336";
        btnDelete.style.opacity = "1";
      });
      btnDelete.addEventListener("mouseleave", applyDeleteIdleStyle);
      btnDelete.addEventListener("click", () =>
        this.deleteMultiRoundPrompt(prompt.id),
      );
      row.appendChild(btnDelete);

      item.appendChild(row);

      if (isEditing) {
        const editor = this.createMultiRoundPromptEditor(prompt, container);
        item.appendChild(editor);
      }

      container.appendChild(item);
    });
  }

  /**
   * 创建多轮提示词内联编辑器
   */
  private createMultiRoundPromptEditor(
    prompt: MultiRoundPromptItem,
    listContainer: HTMLElement,
  ): HTMLElement {
    const doc = Zotero.getMainWindow().document;
    const editor = doc.createElement("div");
    Object.assign(editor.style, {
      marginTop: "14px",
      padding: "16px 16px 12px",
      borderTop: "1px solid var(--ai-input-border)",
      borderRadius: "8px",
      background: "rgba(89, 192, 188, 0.06)",
    });

    const titleInput = createInput(
      `multi-round-title-${prompt.id}`,
      "text",
      prompt.title,
      "例如：研究背景与问题",
    );
    const promptTextarea = createTextarea(
      `multi-round-prompt-${prompt.id}`,
      prompt.prompt,
      8,
      "输入这一轮要问 AI 的提示词...",
    );

    editor.appendChild(createFormGroup("标题", titleInput));
    editor.appendChild(createFormGroup("提示词", promptTextarea));

    const actions = doc.createElement("div");
    Object.assign(actions.style, {
      display: "flex",
      gap: "10px",
      justifyContent: "flex-end",
      marginTop: "4px",
    });

    const btnCancel = createStyledButton("取消", "#9e9e9e", "small");
    btnCancel.addEventListener("click", () => {
      this.editingMultiRoundPromptId = null;
      const prompts = this.getMultiRoundPrompts();
      this.renderMultiRoundPromptsList(listContainer, prompts);
    });

    const btnSave = createStyledButton("保存", "#4caf50", "small");
    btnSave.addEventListener("click", () => {
      const title = titleInput.value.trim();
      const promptText = promptTextarea.value.trim();

      if (!title || !promptText) {
        new ztoolkit.ProgressWindow("提示词")
          .createLine({ text: "标题和提示词都不能为空", type: "fail" })
          .show();
        return;
      }

      const prompts = this.getMultiRoundPrompts();
      const index = prompts.findIndex((item) => item.id === prompt.id);
      const savedPrompt: MultiRoundPromptItem = {
        ...(index === -1 ? prompt : prompts[index]),
        title,
        prompt: promptText,
      };
      if (index === -1) {
        prompts.push(savedPrompt);
      } else {
        prompts[index] = savedPrompt;
      }
      this.saveMultiRoundPrompts(prompts);
      this.editingMultiRoundPromptId = null;
      this.renderMultiRoundPromptsList(listContainer, prompts);

      new ztoolkit.ProgressWindow("提示词")
        .createLine({ text: `✅ 已保存: ${title}`, type: "success" })
        .show();
    });

    actions.appendChild(btnCancel);
    actions.appendChild(btnSave);
    editor.appendChild(actions);

    return editor;
  }

  /**
   * 获取当前多轮提示词配置
   */
  private getMultiRoundPrompts(): MultiRoundPromptItem[] {
    const promptsJson = (getPref("multiRoundPrompts" as any) as string) || "[]";
    return parseMultiRoundPrompts(promptsJson);
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

    if (!this.container.style.position) {
      this.container.style.position = "relative";
    }

    const overlay = doc.createElement("div");
    overlay.className = "ai-butler-page-dialog";
    Object.assign(overlay.style, {
      position: "absolute",
      inset: "0",
      minHeight: "100%",
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "center",
      padding: "32px 24px",
      background: "var(--ai-bg, #f7f9fb)",
      zIndex: "1000",
      boxSizing: "border-box",
      overflow: "auto",
    });

    const dialog = doc.createElement("div");
    Object.assign(dialog.style, {
      width: "min(760px, 100%)",
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
    this.container.appendChild(overlay);

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
    });
    body.appendChild(message);

    const btnCancel = createStyledButton("取消", "#9e9e9e", "small");
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

  /**
   * 添加新的多轮提示词
   */
  private addMultiRoundPrompt(): void {
    const prompts = this.getMultiRoundPrompts();

    const newPrompt: MultiRoundPromptItem = {
      id: `round_${Date.now()}`,
      title: `第 ${prompts.length + 1} 轮`,
      prompt: "",
      order: prompts.length + 1,
    };

    this.editingMultiRoundPromptId = newPrompt.id;

    // 刷新列表
    const list = this.container.querySelector(
      "#multi-round-prompts-list",
    ) as HTMLElement;
    if (list) {
      this.renderMultiRoundPromptsList(list, [...prompts, newPrompt]);
    }
  }

  /**
   * 删除多轮提示词
   */
  private deleteMultiRoundPrompt(id: string): void {
    const promptsJson = (getPref("multiRoundPrompts" as any) as string) || "[]";
    const prompts = parseMultiRoundPrompts(promptsJson);
    const index = prompts.findIndex((p) => p.id === id);

    if (index === -1) {
      this.editingMultiRoundPromptId = null;
      const list = this.container.querySelector(
        "#multi-round-prompts-list",
      ) as HTMLElement;
      if (list) {
        this.renderMultiRoundPromptsList(list, prompts);
      }
      return;
    }

    const title = prompts[index].title;
    this.showInlineConfirm({
      title: "删除多轮提示词？",
      message: `将删除「${title}」。此操作会立即保存，但不会影响已经生成的笔记。`,
      confirmText: "删除",
      onConfirm: () => {
        prompts.splice(index, 1);
        // 重新排序
        prompts.forEach((p, i) => (p.order = i + 1));

        this.saveMultiRoundPrompts(prompts);
        this.editingMultiRoundPromptId = null;

        const list = this.container.querySelector(
          "#multi-round-prompts-list",
        ) as HTMLElement;
        if (list) {
          this.renderMultiRoundPromptsList(list, prompts);
        }

        new ztoolkit.ProgressWindow("提示词")
          .createLine({ text: "✅ 已删除", type: "success" })
          .show();
      },
    });
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
    const currentTemplate =
      (getPref("tableTemplate" as any) as string) || getDefaultTableTemplate();
    const templateEditor = createTextarea(
      "table-template-editor",
      currentTemplate,
      10,
      "输入 Markdown 格式的表格模板...",
    );
    tableSection.appendChild(
      createFormGroup(
        "表格模板 (Markdown)",
        templateEditor,
        "定义每篇论文需要填写的结构化维度",
      ),
    );

    // 2. 填表提示词
    const currentFillPrompt =
      (getPref("tableFillPrompt" as any) as string) ||
      getDefaultTableFillPrompt();
    const fillPromptEditor = createTextarea(
      "table-fill-prompt-editor",
      currentFillPrompt,
      8,
      "输入逐篇论文填表的提示词...",
    );
    tableSection.appendChild(
      createFormGroup(
        "逐篇填表提示词",
        fillPromptEditor,
        "指导 LLM 阅读单篇论文并填写表格。可用变量: ${tableTemplate}",
      ),
    );

    // 3. 汇总综述提示词
    const currentReviewPrompt =
      (getPref("tableReviewPrompt" as any) as string) ||
      getDefaultTableReviewPrompt();
    const reviewPromptEditor = createTextarea(
      "table-review-prompt-editor",
      currentReviewPrompt,
      8,
      "输入基于汇总表生成综述的提示词...",
    );
    tableSection.appendChild(
      createFormGroup(
        "汇总综述提示词",
        reviewPromptEditor,
        "基于所有文献的填表结果生成综合文献综述",
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
        "生成笔记时额外填表",
        enableTableCheckbox,
        "开启后，生成单篇文献笔记时将异步并行生成填表数据",
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
        "并行填表任务数",
        concurrencyInput,
        "同时并行处理的最大文献填表数量 (1-10)",
      ),
    );

    // 6. 保存 / 恢复默认 按钮
    const tableBtnRow = doc.createElement("div");
    Object.assign(tableBtnRow.style, {
      display: "flex",
      gap: "12px",
      marginTop: "16px",
    });

    const btnSaveTable = createStyledButton("💾 保存表格设置", "#4caf50");
    btnSaveTable.addEventListener("click", () => {
      setPref("tableTemplate" as any, templateEditor.value as any);
      setPref("tableFillPrompt" as any, fillPromptEditor.value as any);
      setPref("tableReviewPrompt" as any, reviewPromptEditor.value as any);
      new ztoolkit.ProgressWindow("提示词")
        .createLine({ text: "✅ 表格设置已保存", type: "success" })
        .show();
    });

    const btnResetTable = createStyledButton("🔄 恢复默认", "#9e9e9e");
    btnResetTable.addEventListener("click", () => {
      const ok = Services.prompt.confirm(
        Zotero.getMainWindow() as any,
        "恢复默认",
        "确定将表格设置恢复为默认吗?",
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
      new ztoolkit.ProgressWindow("提示词")
        .createLine({ text: "✅ 表格设置已恢复默认", type: "success" })
        .show();
    });

    tableBtnRow.appendChild(btnSaveTable);
    tableBtnRow.appendChild(btnResetTable);
    tableSection.appendChild(tableBtnRow);

    contentWrapper.appendChild(tableSection);
  }
}
