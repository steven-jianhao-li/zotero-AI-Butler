/**
 * 一图总结设置页面
 *
 * 提供 Nano-Banana Pro (Gemini Image) 生图 API 配置管理界面
 *
 * @file ImageSummarySettingsPage.ts
 * @author AI Butler Team
 */

import { getPref, setPref } from "../../../utils/prefs";
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

    const title = this.createPageTitle("🖼️ 一图总结设置");
    this.container.appendChild(title);

    this.container.appendChild(
      createNotice(
        "一图总结使用生图模型为论文生成学术概念海报。支持 Gemini 原生接口与 OpenAI 兼容接口；可先用预设快速接入服务，再按需微调 API 与生成参数。",
        "info",
      ),
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
      "🔌 API 连接",
      "填写用于生成图片的服务地址、密钥和模型。首次使用可以先在上方选择一个常用服务。",
    );

    const requestModeValue =
      (getPref("imageSummaryRequestMode" as any) as string) || "gemini";
    const requestModeSelect = createSelect(
      "imageSummaryRequestMode",
      [
        { value: "gemini", label: "Gemini 原生接口 (x-goog-api-key)" },
        { value: "openai", label: "OpenAI 兼容接口 (Bearer)" },
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
        "请求方式",
        requestModeSelect,
        "选择使用 Gemini 原生接口或 OpenAI 兼容接口来调用生图模型。",
      ),
    );

    apiCard.body.appendChild(
      createFormGroup(
        "API Key *",
        this.createPasswordInput(
          "imageSummaryApiKey",
          (getPref("imageSummaryApiKey" as any) as string) || "",
          "您的 API Key",
        ),
        "【必填】Gemini 模式使用 x-goog-api-key；OpenAI 模式使用 Authorization Bearer。",
      ),
    );

    apiCard.body.appendChild(
      this.createEndpointFormGroup(
        "API 地址 *",
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
        "额外请求 Headers",
        createTextarea(
          "imageSummaryCustomHeaders",
          (getPref("imageSummaryCustomHeaders" as any) as string) || "",
          4,
          '{"X-ModelScope-Async-Mode": "true"}',
        ),
        '可选。填写 JSON 或 Python dict 对象，键值会附加到一图总结生图请求；例如 {"X-ModelScope-Async-Mode": "true"}。鉴权和 Content-Type 仍由插件配置管理。',
      ),
    );

    apiCard.body.appendChild(
      createFormGroup(
        "生图模型",
        createInput(
          "imageSummaryModel",
          "text",
          (getPref("imageSummaryModel" as any) as string) ||
            "gemini-3-pro-image-preview",
          "gemini-3-pro-image-preview",
        ),
        "Gemini 推荐 gemini-3-pro-image-preview；OpenAI 兼容生图可填写 gpt-image-2、agnes-image-2.1-flash、qwen-image-2.0 等模型。",
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
        "生图请求超时时间 (秒)",
        timeoutInput,
        "一图总结第二阶段生图请求的超时时间，默认 600 秒 (10 分钟)，最小 30 秒。",
      ),
    );
    form.appendChild(apiCard.card);

    const generationCard = this.createSettingsCard(
      "⚙️ 生成选项",
      "控制图片文字语言、比例和分辨率。兼容服务较多时，建议先关闭高级参数跑通 API。",
    );

    generationCard.body.appendChild(
      createFormGroup(
        "图片语言",
        createInput(
          "imageSummaryLanguage",
          "text",
          (getPref("imageSummaryLanguage" as any) as string) || "中文",
          "中文",
        ),
        "生成图片中显示的文字语言。",
      ),
    );

    generationCard.body.appendChild(
      createFormGroup(
        "启用宽高比参数",
        createCheckbox(
          "imageSummaryAspectRatioEnabled",
          (getPref("imageSummaryAspectRatioEnabled" as any) as boolean) ??
            false,
        ),
        "Gemini 模式发送 aspectRatio；OpenAI/gpt-image-2 模式会和分辨率一起合成为官方 size 参数。",
      ),
    );

    generationCard.body.appendChild(
      createFormGroup(
        "图片宽高比",
        createInput(
          "imageSummaryAspectRatio",
          "text",
          (getPref("imageSummaryAspectRatio" as any) as string) || "16:9",
          "16:9",
        ),
        "如 16:9、1:1、9:16、4:3；Agnes 2.1 会作为 ratio 参数发送。",
      ),
    );

    generationCard.body.appendChild(
      createFormGroup(
        "启用分辨率参数",
        createCheckbox(
          "imageSummaryResolutionEnabled",
          (getPref("imageSummaryResolutionEnabled" as any) as boolean) ?? false,
        ),
        "Gemini 模式发送 imageSize；OpenAI/gpt-image-2 模式会转换为官方 size 参数。",
      ),
    );

    generationCard.body.appendChild(
      createFormGroup(
        "图片分辨率",
        this.createResolutionSetting(),
        "不知道怎么选时用 1K；想要更清晰可选 2K/4K。特殊尺寸可选择“自定义”。",
      ),
    );

    generationCard.body.appendChild(
      createFormGroup(
        "使用已有 AI 总结",
        createCheckbox(
          "imageSummaryUseExistingNote",
          (getPref("imageSummaryUseExistingNote" as any) as boolean) || false,
        ),
        "开启后，将使用已存在的 AI 管家笔记内容作为视觉摘要输入，可节省 API 调用费用。",
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
              autoSummaryLabel.textContent = "已禁用";
            }
          } else {
            if (autoSummaryLabel) {
              autoSummaryLabel.textContent = "已启用";
            }
            setPref("autoImageSummaryOnComplete" as any, true);
          }
        } else {
          if (autoSummaryLabel) {
            autoSummaryLabel.textContent = "已禁用";
          }
          setPref("autoImageSummaryOnComplete" as any, false);
        }
      });
    }

    generationCard.body.appendChild(
      createFormGroup(
        "自动添加一图总结",
        autoSummaryContainer,
        "⚠️ 开启后，论文 AI 总结完成时将自动生成一图总结，可能消耗大量 API 费用。",
      ),
    );
    form.appendChild(generationCard.card);

    const promptCard = this.createSettingsCard(
      "📝 提示词配置",
      "这里决定图片里讲什么、怎么讲。通常保持默认即可，有固定风格需求时再调整。",
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
    varsNotice.innerHTML =
      "📌 <strong>可用变量</strong>：<code>${context}</code> 论文内容, <code>${title}</code> 论文标题, <code>${language}</code> 语言设置, <code>${summaryForImage}</code> 视觉摘要结果";
    promptCard.body.appendChild(varsNotice);

    // 视觉信息提取提示词
    promptCard.body.appendChild(
      createFormGroup(
        "视觉信息提取提示词",
        createTextarea(
          "imageSummaryPrompt",
          (getPref("imageSummaryPrompt" as any) as string) ||
            getDefaultImageSummaryPrompt(),
          10,
          "用于从论文中提取视觉信息的提示词...",
        ),
        "第一阶段：从论文中提取用于生成图片的关键视觉信息",
      ),
    );

    // 生图提示词
    promptCard.body.appendChild(
      createFormGroup(
        "生图提示词",
        createTextarea(
          "imageSummaryImagePrompt",
          (getPref("imageSummaryImagePrompt" as any) as string) ||
            getDefaultImageGenerationPrompt(),
          12,
          "用于生成学术概念海报的提示词...",
        ),
        "第二阶段：根据视觉摘要生成学术概念海报图片",
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
    const testButton = createStyledButton("🔍 测试 API", "#2196f3", "medium");
    testButton.addEventListener("click", () => this.testConnection());
    buttonGroup.appendChild(testButton);

    // 保存按钮
    const saveButton = createStyledButton("💾 保存设置", "#4caf50", "medium");
    saveButton.addEventListener("click", () => this.saveSettings());
    buttonGroup.appendChild(saveButton);

    // 重置提示词按钮
    const resetButton = createStyledButton(
      "🔄 重置提示词",
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
      textContent: "API 连接测试结果",
      styles: { fontSize: "13px", fontWeight: "600" },
    });
    // 按钮容器
    const buttonContainer = this.createElement("div", {
      styles: { display: "flex", gap: "8px" },
    });
    const copyBtn = this.createElement("button", {
      textContent: "复制详情",
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
        new ztoolkit.ProgressWindow("一图总结", { closeTime: 1500 })
          .createLine({ text: "已复制错误详情", type: "success" })
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
          new ztoolkit.ProgressWindow("一图总结", { closeTime: 1500 })
            .createLine({ text: "已复制错误详情", type: "success" })
            .show();
        } catch {
          new ztoolkit.ProgressWindow("一图总结", { closeTime: 2500 })
            .createLine({
              text: "复制失败，可手动选择文本复制",
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
    title.textContent = "快速开始";
    Object.assign(title.style, {
      fontSize: "15px",
      fontWeight: "750",
      color: "var(--ai-text, #1f2937)",
      marginBottom: "4px",
    });
    copy.appendChild(title);

    const desc = doc.createElement("div");
    desc.textContent =
      "选择你准备用的生图服务，插件会自动填好地址、模型和推荐尺寸。";
    Object.assign(desc.style, {
      fontSize: "12px",
      lineHeight: "1.6",
      color: "var(--ai-text-muted, #6b7280)",
    });
    copy.appendChild(desc);
    header.appendChild(copy);

    const badge = doc.createElement("span");
    badge.textContent = "推荐首次配置使用";
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
        { value: "", label: "选择一个服务预设…" },
        { value: "gemini", label: "Gemini 原生 / Nano Banana Pro" },
        { value: "openai", label: "OpenAI 官方 gpt-image" },
        { value: "agnes21", label: "Agnes Image 2.1 Flash" },
        { value: "dashscope", label: "阿里云百炼 Qwen Image" },
      ],
      "",
      (newVal) => this.applyImageProviderPreset(newVal),
    );
    panel.appendChild(presetSelect);

    const note = doc.createElement("div");
    note.textContent =
      "应用后只需要重新填写 API Key。已经能正常生成图片时，不必重复应用预设。";
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
        { value: "1K", label: "标准清晰度 1K（通用，费用低）" },
        { value: "2K", label: "高清 2K（更清晰）" },
        { value: "4K", label: "超清 4K（更慢，成本更高）" },
        { value: "custom", label: "自定义（输入尺寸或等级）" },
      ],
      isPreset ? current : "custom",
      (value) => this.updateResolutionCustomInputVisibility(value),
    );
    wrapper.appendChild(select);

    const customInput = createInput(
      "imageSummaryResolutionCustom",
      "text",
      isPreset ? "" : current,
      "例如 1024x768、1536x1024、2K",
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
    title.textContent = "应用生图预设";
    Object.assign(title.style, {
      fontSize: "16px",
      fontWeight: "700",
      marginBottom: "12px",
      color: "var(--ai-text, #1f2937)",
    });
    dialog.appendChild(title);

    const message = doc.createElement("div");
    message.innerHTML =
      "将应用预设：<strong>" +
      this.escapeHtml(presetName) +
      "</strong><br><br>插件将把生图服务切换到这套推荐配置，包括地址、模型和图片尺寸。<br><br>你的提示词会保留；API Key 会清空，需要重新填写。";
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

    const cancelButton = createStyledButton("取消", "#9e9e9e", "small");
    cancelButton.addEventListener("click", close);
    actions.appendChild(cancelButton);

    const confirmButton = createStyledButton("确认应用", "#9c27b0", "small");
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
      gemini: "Gemini 原生 / Nano Banana Pro",
      openai: "OpenAI 官方 gpt-image",
      agnes21: "Agnes Image 2.1 Flash",
      dashscope: "阿里云百炼 Qwen Image",
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
    setPref("imageSummaryLanguage" as any, "中文");
    setPref("imageSummaryAspectRatioEnabled" as any, config.aspectRatioEnabled);
    setPref("imageSummaryAspectRatio" as any, config.aspectRatio);
    setPref("imageSummaryResolutionEnabled" as any, config.resolutionEnabled);
    setPref("imageSummaryResolution" as any, config.resolution);
    setPref("imageSummaryUseExistingNote" as any, false);
    setPref("autoImageSummaryOnComplete" as any, false);

    this.render();

    new ztoolkit.ProgressWindow("一图总结", {
      closeOnClick: true,
      closeTime: 2500,
    })
      .createLine({ text: "已切换到：" + presetName, type: "success" })
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
        .createLine({ text: "一图总结设置已保存", type: "success" })
        .show();
    } catch (error: any) {
      ztoolkit.log("[AI-Butler] 保存一图总结设置失败:", error);
      new ztoolkit.ProgressWindow("AI Butler", {
        closeOnClick: true,
        closeTime: 3000,
      })
        .createLine({ text: `保存失败: ${error.message}`, type: "error" })
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
        resultPre.textContent = "❌ 请先填写 API Key";
      }
      return;
    }

    // 显示测试中状态
    if (resultBox && resultPre) {
      resultBox.style.display = "block";
      resultBox.style.backgroundColor = "#fff8e1";
      resultBox.style.border = "1px solid #ffe082";
      resultPre.style.color = "#5d4037";
      resultPre.textContent = "正在测试连接…\n请稍候。";
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
        resultPre.textContent = `✅ API 连接成功，生成了 ${result.mimeType} 图片 (${Math.round(result.imageBase64.length / 1024)} KB)`;
      }
    } catch (error: any) {
      ztoolkit.log("[AI-Butler] 一图总结 API 测试失败:", error);

      const fullMsg =
        error instanceof ImageGenerationError
          ? ImageClient.formatError(error)
          : `错误信息: ${error?.message || "连接失败"}`;

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
    const message =
      "⚠️ 费用警告\n\n" +
      "开启『自动添加一图总结』功能后，每当论文AI总结完成时，" +
      "系统将自动调用生图 API 生成学术概念海报。\n\n" +
      "这将消耗大量 API 调用次数和费用！\n\n" +
      "确定要开启此功能吗？";

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
      .createLine({ text: "提示词已重置为默认值", type: "success" })
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

    const official = this.createEndpointMeta("官方 Endpoint：");
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
    required.textContent = "【必填】";
    required.style.flex = "0 0 auto";

    const preview = this.createEndpointMeta("预览：");
    preview.style.maxWidth = "440px";

    desc.appendChild(required);
    desc.appendChild(preview);
    group.appendChild(desc);

    const update = () => {
      const endpoint = this.buildImageEndpointPreview(id, placeholder);
      const officialEndpoint = this.getImageOfficialEndpoint();
      official.textContent = `官方 Endpoint：${officialEndpoint}`;
      official.title = officialEndpoint;
      preview.textContent = `预览：${endpoint}`;
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
    toggleBtn.title = "显示/隐藏密钥";
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
