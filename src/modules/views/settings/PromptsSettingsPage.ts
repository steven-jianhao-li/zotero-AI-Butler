/**
 * 提示词管理页
 *
 * @file PromptsSettingsPage.ts
 */

import { getPref, setPref, clearPref } from "../../../utils/prefs";
import {
  getDefaultSummaryPrompt,
  PROMPT_VERSION,
} from "../../../utils/prompts";
import {
  createFormGroup,
  createInput,
  createTextarea,
  createSelect,
  createStyledButton,
  createSectionTitle,
  createNotice,
} from "../ui/components";

type PresetMap = Record<string, string>;

export class PromptsSettingsPage {
  private container: HTMLElement;

  // UI refs
  private presetSelect!: HTMLElement; // 自定义下拉框
  private editor!: HTMLTextAreaElement;
  private previewBox!: HTMLElement;
  private sampleTitle!: HTMLInputElement;
  private sampleAuthors!: HTMLInputElement;
  private sampleYear!: HTMLInputElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  public render(): void {
    this.container.innerHTML = "";

    // 标题
    const title = Zotero.getMainWindow().document.createElement("h2");
    title.textContent = "📝 提示词模板";
    Object.assign(title.style, {
      color: "#59c0bc",
      marginBottom: "20px",
      fontSize: "20px",
      borderBottom: "2px solid #59c0bc",
      paddingBottom: "10px",
    });
    this.container.appendChild(title);

    this.container.appendChild(
      createNotice(
        "提示: 支持预设模板、自定义编辑与变量插值预览。可用变量: <code>${title}</code>、<code>${authors}</code>、<code>${year}</code>。",
        "info",
      ),
    );

    // 左右布局
    const layout = Zotero.getMainWindow().document.createElement("div");
    Object.assign(layout.style, {
      display: "grid",
      gridTemplateColumns: "minmax(280px, 340px) 1fr",
      gap: "20px",
      alignItems: "start",
    });
    this.container.appendChild(layout);

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

    // 预览框
    this.previewBox = Zotero.getMainWindow().document.createElement("div");
    Object.assign(this.previewBox.style, {
      border: "1px dashed #ccc",
      borderRadius: "6px",
      padding: "12px",
      background: "#fafafa",
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

    // 初次渲染时也做一次预览
    this.updatePreview();
  }

  // ===== helpers =====
  private getAllPresets(): PresetMap {
    const builtins: PresetMap = {
      默认模板: getDefaultSummaryPrompt(),
      精简摘要: `你是一名学术助手。请用中文以简洁的要点方式总结论文主要问题、方法、关键结果与结论。文章信息: 标题=${"${title}"}; 作者=${"${authors}"}; 年份=${"${year}"}`,
      结构化报告: `请以"背景/方法/结果/讨论/局限/结论"六部分结构化总结论文; 开头写:《${"${title}"}》(${" ${year} "}).`,
    };

    // 自定义预设
    let custom: PresetMap = {};
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
      new ztoolkit.ProgressWindow("提示词")
        .createLine({ text: `已应用预设: ${name}`, type: "success" })
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
    let name = { value: "" } as any;
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

    let custom: PresetMap = {};
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
    let custom: PresetMap = {};
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

    // 更新下拉选项而不是完全重新渲染
    const presets = this.getAllPresets();
    const presetOptions = Object.keys(presets).map((n) => ({
      value: n,
      label: n,
    }));

    this.presetSelect.innerHTML = "";
    presetOptions.forEach((opt) => {
      const option = Zotero.getMainWindow().document.createElement("option");
      option.value = opt.value;
      option.textContent = opt.label;
      this.presetSelect.appendChild(option);
    });

    new ztoolkit.ProgressWindow("提示词")
      .createLine({ text: `✅ 已删除预设: ${name}`, type: "success" })
      .show();
  }

  private saveCurrent(): void {
    const text = this.editor.value || getDefaultSummaryPrompt();
    setPref("summaryPrompt", text);
    // 保存当前模板即视为用户自定义,这里不动 promptVersion
    new ztoolkit.ProgressWindow("提示词")
      .createLine({ text: "✅ 当前模板已保存", type: "success" })
      .show();
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
}
