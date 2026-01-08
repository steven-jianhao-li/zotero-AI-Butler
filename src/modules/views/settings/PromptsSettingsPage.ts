/**
 * 提示词管理页
 *
 * @file PromptsSettingsPage.ts
 */

import { getPref, setPref, clearPref } from "../../../utils/prefs";
import {
  getDefaultSummaryPrompt,
  PROMPT_VERSION,
  parseMultiRoundPrompts,
  getDefaultMultiRoundPrompts,
  getDefaultMultiRoundFinalPrompt,
  type MultiRoundPromptItem,
  type SummaryMode,
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

    // 内容包装器 - 限制最大宽度，防止内容撑开容器
    const contentWrapper = Zotero.getMainWindow().document.createElement("div");
    Object.assign(contentWrapper.style, {
      maxWidth: "680px",
      width: "100%",
    });
    this.container.appendChild(contentWrapper);

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
    contentWrapper.appendChild(title);

    contentWrapper.appendChild(
      createNotice(
        "提示: 支持预设模板、自定义编辑与变量插值预览。可用变量: <code>${title}</code>、<code>${authors}</code>、<code>${year}</code>。",
        "info",
      ),
    );

    // =========== 总结模式选择区域 ===========
    const modeSection = Zotero.getMainWindow().document.createElement("div");
    Object.assign(modeSection.style, {
      marginBottom: "24px",
      padding: "16px",
      background: "var(--ai-input-bg)",
      borderRadius: "8px",
      border: "1px solid var(--ai-input-border)",
    });

    const modeTitle = Zotero.getMainWindow().document.createElement("h3");
    modeTitle.textContent = "🔄 总结模式";
    Object.assign(modeTitle.style, {
      color: "#59c0bc",
      marginBottom: "12px",
      fontSize: "16px",
    });
    modeSection.appendChild(modeTitle);

    // 模式说明
    modeSection.appendChild(
      createNotice(
        "选择 AI 总结论文的方式：<br/>" +
          "• <b>单次对话</b>: 一次对话完成总结（Token消耗最少，笔记简洁）<br/>" +
          "• <b>多轮拼接</b>: 多轮对话后拼接所有内容（Token消耗较多，笔记最详细）<br/>" +
          "• <b>多轮总结</b>: 多轮对话后AI汇总（Token消耗最多，笔记详细且篇幅适中）",
        "info",
      ),
    );

    // 模式选择
    const currentMode = ((getPref("summaryMode" as any) as string) ||
      "single") as SummaryMode;
    const modeOptions = [
      { value: "single", label: "📝 单次对话 (默认)" },
      { value: "multi_concat", label: "📚 多轮拼接" },
      { value: "multi_summarize", label: "✨ 多轮总结" },
    ];

    const modeSelect = createSelect(
      "summary-mode",
      modeOptions,
      currentMode,
      (newValue) => {
        setPref("summaryMode" as any, newValue as any);
        this.updateMultiRoundVisibility(newValue as SummaryMode);
        new ztoolkit.ProgressWindow("提示词")
          .createLine({
            text: `已切换为: ${modeOptions.find((o) => o.value === newValue)?.label}`,
            type: "success",
          })
          .show();
      },
    );
    modeSection.appendChild(
      createFormGroup("选择模式", modeSelect, "更改后立即生效"),
    );

    // 多轮设置容器（根据模式显示/隐藏）
    const multiRoundContainer =
      Zotero.getMainWindow().document.createElement("div");
    multiRoundContainer.id = "multi-round-settings";
    Object.assign(multiRoundContainer.style, {
      marginTop: "16px",
      display: currentMode === "single" ? "none" : "block",
    });

    // 多轮提示词编辑区
    const multiRoundTitle = Zotero.getMainWindow().document.createElement("h4");
    multiRoundTitle.textContent = "📋 多轮提示词设置";
    Object.assign(multiRoundTitle.style, {
      color: "#59c0bc",
      marginBottom: "12px",
      fontSize: "14px",
    });
    multiRoundContainer.appendChild(multiRoundTitle);

    // 当前多轮提示词列表
    const promptsJson = (getPref("multiRoundPrompts" as any) as string) || "[]";
    const prompts = parseMultiRoundPrompts(promptsJson);

    const promptsList = Zotero.getMainWindow().document.createElement("div");
    promptsList.id = "multi-round-prompts-list";
    Object.assign(promptsList.style, {
      maxHeight: "200px",
      overflowY: "auto",
      marginBottom: "12px",
    });

    this.renderMultiRoundPromptsList(promptsList, prompts);
    multiRoundContainer.appendChild(promptsList);

    // 多轮提示词操作按钮
    const promptsBtnRow = Zotero.getMainWindow().document.createElement("div");
    Object.assign(promptsBtnRow.style, {
      display: "flex",
      gap: "8px",
      marginBottom: "12px",
    });

    const btnAddPrompt = createStyledButton("➕ 添加提示词", "#4caf50");
    btnAddPrompt.addEventListener("click", () => this.addMultiRoundPrompt());
    const btnResetPrompts = createStyledButton("🔄 恢复默认", "#9e9e9e");
    btnResetPrompts.addEventListener("click", () =>
      this.resetMultiRoundPrompts(),
    );

    promptsBtnRow.appendChild(btnAddPrompt);
    promptsBtnRow.appendChild(btnResetPrompts);
    multiRoundContainer.appendChild(promptsBtnRow);

    // 最终总结提示词（仅多轮总结模式显示）
    const finalPromptContainer =
      Zotero.getMainWindow().document.createElement("div");
    finalPromptContainer.id = "final-prompt-container";
    Object.assign(finalPromptContainer.style, {
      display: currentMode === "multi_summarize" ? "block" : "none",
      marginTop: "12px",
    });

    const finalPromptTitle =
      Zotero.getMainWindow().document.createElement("h4");
    finalPromptTitle.textContent = "📝 最终总结提示词";
    Object.assign(finalPromptTitle.style, {
      color: "#59c0bc",
      marginBottom: "8px",
      fontSize: "14px",
    });
    finalPromptContainer.appendChild(finalPromptTitle);

    const currentFinalPrompt =
      (getPref("multiRoundFinalPrompt" as any) as string) ||
      getDefaultMultiRoundFinalPrompt();
    const finalPromptEditor = createTextarea(
      "final-prompt-editor",
      currentFinalPrompt,
      6,
      "输入最终总结提示词...",
    );
    finalPromptEditor.addEventListener("change", () => {
      setPref("multiRoundFinalPrompt" as any, finalPromptEditor.value as any);
    });
    finalPromptContainer.appendChild(
      createFormGroup(
        "最终总结提示词",
        finalPromptEditor,
        "多轮对话完成后，使用此提示词生成最终总结",
      ),
    );

    // 保存中间对话内容选项
    const saveIntermediate =
      (getPref("multiSummarySaveIntermediate" as any) as boolean) ?? false;
    const saveIntermediateCheckbox = createCheckbox(
      "save-intermediate",
      saveIntermediate,
    );
    saveIntermediateCheckbox.addEventListener("click", () => {
      const checkbox = saveIntermediateCheckbox.querySelector(
        "input",
      ) as HTMLInputElement;
      if (checkbox) {
        setPref("multiSummarySaveIntermediate" as any, checkbox.checked as any);
        new ztoolkit.ProgressWindow("提示词")
          .createLine({
            text: checkbox.checked
              ? "✅ 将保存中间对话内容"
              : "ℹ️ 仅保存最终总结",
            type: "success",
          })
          .show();
      }
    });
    finalPromptContainer.appendChild(
      createFormGroup(
        "保存中间对话内容",
        saveIntermediateCheckbox,
        "开启后，笔记中将同时包含多轮对话过程和最终总结",
      ),
    );

    multiRoundContainer.appendChild(finalPromptContainer);
    modeSection.appendChild(multiRoundContainer);
    contentWrapper.appendChild(modeSection);

    // =========== 原有的单次提示词设置 ===========
    // 左右布局
    const layout = Zotero.getMainWindow().document.createElement("div");
    layout.id = "single-round-settings";
    Object.assign(layout.style, {
      display: currentMode === "single" ? "grid" : "none",
      gridTemplateColumns: "minmax(280px, 340px) 1fr",
      gap: "20px",
      alignItems: "start",
    });
    contentWrapper.appendChild(layout);

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

    // 初次渲染时也做一次预览
    this.updatePreview();
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

  /**
   * 根据总结模式更新多轮设置区域的可见性
   */
  private updateMultiRoundVisibility(mode: SummaryMode): void {
    const multiRoundSettings = this.container.querySelector(
      "#multi-round-settings",
    ) as HTMLElement;
    const finalPromptContainer = this.container.querySelector(
      "#final-prompt-container",
    ) as HTMLElement;
    const singleRoundSettings = this.container.querySelector(
      "#single-round-settings",
    ) as HTMLElement;

    if (multiRoundSettings) {
      multiRoundSettings.style.display = mode === "single" ? "none" : "block";
    }
    if (finalPromptContainer) {
      finalPromptContainer.style.display =
        mode === "multi_summarize" ? "block" : "none";
    }
    // 单次对话模式下显示预设模板区域，多轮模式下隐藏
    if (singleRoundSettings) {
      singleRoundSettings.style.display = mode === "single" ? "grid" : "none";
    }
  }

  /**
   * 渲染多轮提示词列表
   */
  private renderMultiRoundPromptsList(
    container: HTMLElement,
    prompts: MultiRoundPromptItem[],
  ): void {
    container.innerHTML = "";

    if (prompts.length === 0) {
      const empty = Zotero.getMainWindow().document.createElement("div");
      empty.textContent = "暂无多轮提示词，请添加或恢复默认";
      Object.assign(empty.style, {
        color: "var(--ai-text-secondary)",
        padding: "12px",
        textAlign: "center",
      });
      container.appendChild(empty);
      return;
    }

    prompts.forEach((prompt, index) => {
      const item = Zotero.getMainWindow().document.createElement("div");
      Object.assign(item.style, {
        display: "flex",
        alignItems: "center",
        padding: "8px",
        marginBottom: "4px",
        background: "var(--ai-card-bg)",
        borderRadius: "4px",
        border: "1px solid var(--ai-input-border)",
        minWidth: "0", // 防止flex子元素撑开容器
        overflow: "hidden", // 确保内容不溢出
      });

      const orderBadge = Zotero.getMainWindow().document.createElement("span");
      orderBadge.textContent = `${index + 1}`;
      Object.assign(orderBadge.style, {
        background: "#59c0bc",
        color: "white",
        borderRadius: "50%",
        width: "24px",
        height: "24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginRight: "10px",
        fontSize: "12px",
        fontWeight: "bold",
      });
      item.appendChild(orderBadge);

      const info = Zotero.getMainWindow().document.createElement("div");
      Object.assign(info.style, {
        flex: "1",
        overflow: "hidden",
      });

      const title = Zotero.getMainWindow().document.createElement("div");
      title.textContent = prompt.title;
      Object.assign(title.style, {
        fontWeight: "bold",
        color: "var(--ai-text-primary)",
        marginBottom: "2px",
      });
      info.appendChild(title);

      const preview = Zotero.getMainWindow().document.createElement("div");
      preview.textContent =
        prompt.prompt.substring(0, 50) +
        (prompt.prompt.length > 50 ? "..." : "");
      Object.assign(preview.style, {
        fontSize: "12px",
        color: "var(--ai-text-secondary)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      });
      info.appendChild(preview);

      item.appendChild(info);

      // 编辑按钮
      const btnEdit = Zotero.getMainWindow().document.createElement("button");
      btnEdit.textContent = "✏️";
      btnEdit.title = "编辑";
      Object.assign(btnEdit.style, {
        border: "none",
        background: "transparent",
        cursor: "pointer",
        fontSize: "16px",
        padding: "4px 8px",
      });
      btnEdit.addEventListener("click", () =>
        this.editMultiRoundPrompt(prompt.id),
      );
      item.appendChild(btnEdit);

      // 删除按钮
      const btnDelete = Zotero.getMainWindow().document.createElement("button");
      btnDelete.textContent = "🗑️";
      btnDelete.title = "删除";
      Object.assign(btnDelete.style, {
        border: "none",
        background: "transparent",
        cursor: "pointer",
        fontSize: "16px",
        padding: "4px 8px",
      });
      btnDelete.addEventListener("click", () =>
        this.deleteMultiRoundPrompt(prompt.id),
      );
      item.appendChild(btnDelete);

      container.appendChild(item);
    });
  }

  /**
   * 添加新的多轮提示词
   */
  private addMultiRoundPrompt(): void {
    const win = Zotero.getMainWindow() as any;

    // 输入标题
    const titleObj = { value: "" } as any;
    const ok1 = Services.prompt.prompt(
      win,
      "添加多轮提示词",
      "请输入提示词标题:",
      titleObj,
      "",
      { value: false },
    );
    if (!ok1 || !titleObj.value?.trim()) return;

    // 输入内容
    const promptObj = { value: "" } as any;
    const ok2 = Services.prompt.prompt(
      win,
      "添加多轮提示词",
      "请输入提示词内容:",
      promptObj,
      "",
      { value: false },
    );
    if (!ok2 || !promptObj.value?.trim()) return;

    const promptsJson = (getPref("multiRoundPrompts" as any) as string) || "[]";
    const prompts = parseMultiRoundPrompts(promptsJson);

    const newPrompt: MultiRoundPromptItem = {
      id: `round_${Date.now()}`,
      title: titleObj.value.trim(),
      prompt: promptObj.value.trim(),
      order: prompts.length + 1,
    };

    prompts.push(newPrompt);
    setPref("multiRoundPrompts" as any, JSON.stringify(prompts) as any);

    // 刷新列表
    const list = this.container.querySelector(
      "#multi-round-prompts-list",
    ) as HTMLElement;
    if (list) {
      this.renderMultiRoundPromptsList(list, prompts);
    }

    new ztoolkit.ProgressWindow("提示词")
      .createLine({ text: `✅ 已添加: ${newPrompt.title}`, type: "success" })
      .show();
  }

  /**
   * 编辑多轮提示词
   */
  private editMultiRoundPrompt(id: string): void {
    const win = Zotero.getMainWindow() as any;
    const promptsJson = (getPref("multiRoundPrompts" as any) as string) || "[]";
    const prompts = parseMultiRoundPrompts(promptsJson);
    const index = prompts.findIndex((p) => p.id === id);

    if (index === -1) return;

    const current = prompts[index];

    // 编辑标题
    const titleObj = { value: current.title } as any;
    const ok1 = Services.prompt.prompt(
      win,
      "编辑提示词",
      "标题:",
      titleObj,
      "",
      { value: false },
    );
    if (!ok1) return;

    // 编辑内容
    const promptObj = { value: current.prompt } as any;
    const ok2 = Services.prompt.prompt(
      win,
      "编辑提示词",
      "内容:",
      promptObj,
      "",
      { value: false },
    );
    if (!ok2) return;

    prompts[index] = {
      ...current,
      title: titleObj.value?.trim() || current.title,
      prompt: promptObj.value?.trim() || current.prompt,
    };

    setPref("multiRoundPrompts" as any, JSON.stringify(prompts) as any);

    const list = this.container.querySelector(
      "#multi-round-prompts-list",
    ) as HTMLElement;
    if (list) {
      this.renderMultiRoundPromptsList(list, prompts);
    }

    new ztoolkit.ProgressWindow("提示词")
      .createLine({
        text: `✅ 已更新: ${prompts[index].title}`,
        type: "success",
      })
      .show();
  }

  /**
   * 删除多轮提示词
   */
  private deleteMultiRoundPrompt(id: string): void {
    const win = Zotero.getMainWindow() as any;
    const promptsJson = (getPref("multiRoundPrompts" as any) as string) || "[]";
    const prompts = parseMultiRoundPrompts(promptsJson);
    const index = prompts.findIndex((p) => p.id === id);

    if (index === -1) return;

    const ok = Services.prompt.confirm(
      win,
      "删除提示词",
      `确定删除「${prompts[index].title}」吗?`,
    );
    if (!ok) return;

    prompts.splice(index, 1);
    // 重新排序
    prompts.forEach((p, i) => (p.order = i + 1));

    setPref("multiRoundPrompts" as any, JSON.stringify(prompts) as any);

    const list = this.container.querySelector(
      "#multi-round-prompts-list",
    ) as HTMLElement;
    if (list) {
      this.renderMultiRoundPromptsList(list, prompts);
    }

    new ztoolkit.ProgressWindow("提示词")
      .createLine({ text: "✅ 已删除", type: "success" })
      .show();
  }

  /**
   * 恢复默认的多轮提示词
   */
  private resetMultiRoundPrompts(): void {
    const ok = Services.prompt.confirm(
      Zotero.getMainWindow() as any,
      "恢复默认",
      "确定将多轮提示词恢复为默认设置吗?",
    );
    if (!ok) return;

    const defaults = getDefaultMultiRoundPrompts();
    setPref("multiRoundPrompts" as any, JSON.stringify(defaults) as any);
    setPref(
      "multiRoundFinalPrompt" as any,
      getDefaultMultiRoundFinalPrompt() as any,
    );

    const list = this.container.querySelector(
      "#multi-round-prompts-list",
    ) as HTMLElement;
    if (list) {
      this.renderMultiRoundPromptsList(list, defaults);
    }

    new ztoolkit.ProgressWindow("提示词")
      .createLine({ text: "✅ 已恢复默认多轮提示词", type: "success" })
      .show();
  }
}
