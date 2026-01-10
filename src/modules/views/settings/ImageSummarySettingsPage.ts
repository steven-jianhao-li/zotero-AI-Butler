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

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /**
   * 渲染页面
   */
  public render(): void {
    this.container.innerHTML = "";

    // 标题
    const title = this.createElement("h2", {
      textContent: "🖼️ 一图总结设置",
      styles: {
        color: "#9c27b0",
        marginBottom: "20px",
        fontSize: "20px",
        borderBottom: "2px solid #9c27b0",
        paddingBottom: "10px",
      },
    });
    this.container.appendChild(title);

    // 功能说明
    const notice = createNotice(
      "📝 <strong>功能说明</strong>：一图总结使用生图模型 (默认 gemini-3-pro-image-preview) 为论文生成学术概念海报，支持 Gemini 原生接口与 OpenAI 兼容接口两种请求方式。",
      "info",
    );
    this.container.appendChild(notice);

    // 表单容器
    const form = this.createElement("div", {
      styles: {
        maxWidth: "800px",
      },
    });

    // === API 配置区域 ===
    form.appendChild(createSectionTitle("🔌 API 配置"));

    // 请求方式
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
        // 切换时，如 API 地址保持默认且用户尚未手动修改，则自动填充更合适的默认值
        const urlInput = this.container.querySelector(
          "#setting-imageSummaryApiUrl",
        ) as HTMLInputElement | null;
        if (!urlInput) return;
        const cur = (urlInput.value || "").trim();
        const isDefaultGemini =
          !cur || cur === "https://generativelanguage.googleapis.com";
        const isDefaultOpenAI =
          cur === "https://api.openai.com/v1/chat/completions";
        if (newVal === "openai" && isDefaultGemini) {
          urlInput.value = "https://api.openai.com/v1/chat/completions";
        }
        if (newVal === "gemini" && (isDefaultOpenAI || !cur)) {
          urlInput.value = "https://generativelanguage.googleapis.com";
        }
      },
    );
    form.appendChild(
      createFormGroup(
        "请求方式",
        requestModeSelect,
        "选择使用 Gemini 原生接口或 OpenAI 兼容接口来调用生图模型",
      ),
    );

    // API Key
    form.appendChild(
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

    // API Base URL
    form.appendChild(
      createFormGroup(
        "API 基础地址",
        createInput(
          "imageSummaryApiUrl",
          "text",
          (getPref("imageSummaryApiUrl" as any) as string) ||
            (requestModeValue === "openai"
              ? "https://api.openai.com/v1/chat/completions"
              : "https://generativelanguage.googleapis.com"),
          requestModeValue === "openai"
            ? "https://api.openai.com/v1/chat/completions"
            : "https://generativelanguage.googleapis.com",
        ),
        "Gemini: 填基础地址；OpenAI: 可填基础地址或完整端点（如 /v1/chat/completions）",
      ),
    );

    // 模型名称
    form.appendChild(
      createFormGroup(
        "生图模型",
        createInput(
          "imageSummaryModel",
          "text",
          (getPref("imageSummaryModel" as any) as string) ||
            "gemini-3-pro-image-preview",
          "gemini-3-pro-image-preview",
        ),
        "Gemini 生图模型名称，推荐使用 gemini-3-pro-image-preview (Nano Banana Pro)",
      ),
    );

    // === 生成选项区域 ===
    form.appendChild(createSectionTitle("⚙️ 生成选项"));

    // 图片语言
    form.appendChild(
      createFormGroup(
        "图片语言",
        createInput(
          "imageSummaryLanguage",
          "text",
          (getPref("imageSummaryLanguage" as any) as string) || "中文",
          "中文",
        ),
        "生成图片中显示的文字语言",
      ),
    );

    // 图片宽高比
    form.appendChild(
      createFormGroup(
        "图片宽高比",
        createInput(
          "imageSummaryAspectRatio",
          "text",
          (getPref("imageSummaryAspectRatio" as any) as string) || "16:9",
          "16:9",
        ),
        "生成图片的宽高比，如 16:9、1:1、9:16、4:3 等",
      ),
    );

    // 图片分辨率
    form.appendChild(
      createFormGroup(
        "图片分辨率",
        createSelect(
          "imageSummaryResolution",
          [
            { value: "1K", label: "1K (默认)" },
            { value: "2K", label: "2K" },
            { value: "4K", label: "4K" },
          ],
          (getPref("imageSummaryResolution" as any) as string) || "1K",
        ),
        "生成图片的分辨率，更高分辨率可能会增加 API 费用",
      ),
    );

    // 使用已有 AI 笔记代替
    form.appendChild(
      createFormGroup(
        "使用已有 AI 笔记",
        createCheckbox(
          "imageSummaryUseExistingNote",
          (getPref("imageSummaryUseExistingNote" as any) as boolean) || false,
        ),
        "开启后，将使用已存在的 AI 管家笔记内容作为视觉摘要输入，可节省 API 调用费用",
      ),
    );

    // 自动添加一图总结（带二次确认）
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
          // 弹出二次确认对话框
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
            // 用户确认后自动保存设置
            setPref("autoImageSummaryOnComplete" as any, true);
          }
        } else {
          if (autoSummaryLabel) {
            autoSummaryLabel.textContent = "已禁用";
          }
          // 用户关闭时自动保存设置
          setPref("autoImageSummaryOnComplete" as any, false);
        }
      });
    }

    form.appendChild(
      createFormGroup(
        "自动添加一图总结",
        autoSummaryContainer,
        "⚠️ 开启后，论文AI总结完成时将自动生成一图总结（可能消耗大量API费用，请谨慎开启）",
      ),
    );

    // === 提示词配置区域 ===
    form.appendChild(createSectionTitle("📝 提示词配置"));

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
    form.appendChild(varsNotice);

    // 视觉信息提取提示词
    form.appendChild(
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
    form.appendChild(
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

      // 下拉框单独处理 (resolution)
      const resolutionSelect = this.container.querySelector(
        "#setting-imageSummaryResolution",
      ) as HTMLElement;
      if (resolutionSelect) {
        const resValue =
          (resolutionSelect as any).getValue?.() ||
          resolutionSelect.getAttribute("data-value") ||
          "1K";
        setPref("imageSummaryResolution" as any, resValue);
      }

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
