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
  createTextarea,
  createCheckbox,
  createSectionTitle,
  createNotice,
} from "../ui/components";
import {
  getDefaultImageSummaryPrompt,
  getDefaultImageGenerationPrompt,
} from "../../../utils/prompts";

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
      "📝 <strong>功能说明</strong>：一图总结使用 Gemini 的图片生成功能 (gemini-3-pro-image-preview) 为论文生成学术概念海报，帮助您快速理解论文核心内容。",
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

    // API Key
    form.appendChild(
      createFormGroup(
        "Gemini API Key *",
        this.createPasswordInput(
          "imageSummaryApiKey",
          (getPref("imageSummaryApiKey" as any) as string) || "",
          "您的 Gemini API Key",
        ),
        "【必填】用于调用 Gemini 图片生成 API。可与 API 配置页面中的 Gemini Key 相同。",
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
            "https://generativelanguage.googleapis.com",
          "https://generativelanguage.googleapis.com",
        ),
        "Gemini API 基础地址，默认为官方地址",
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
      // 简单的测试请求
      const url = `${apiUrl.replace(/\/$/, "")}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const payload = {
        contents: [
          {
            parts: [{ text: "Generate a simple test image of a blue circle." }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
        },
      };

      const response = await Zotero.HTTP.request("POST", url, {
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(payload),
        responseType: "text",
        timeout: 60000,
      });

      if (response.status === 200) {
        const json = JSON.parse(response.response);
        // 检查是否返回了图片
        const hasImage = json?.candidates?.[0]?.content?.parts?.some(
          (p: any) => p.inlineData,
        );
        if (hasImage) {
          if (resultBox && resultPre) {
            resultBox.style.display = "block";
            resultBox.style.backgroundColor = "#e8f5e9";
            resultBox.style.border = "1px solid #a5d6a7";
            resultPre.style.color = "#1b5e20";
            resultPre.textContent = "✅ API 连接成功，生图功能正常！";
          }
        } else {
          if (resultBox && resultPre) {
            resultBox.style.display = "block";
            resultBox.style.backgroundColor = "#fff8e1";
            resultBox.style.border = "1px solid #ffe082";
            resultPre.style.color = "#f57f17";
            resultPre.textContent =
              "⚠️ API 连接成功，但未返回图片\n\n可能原因：模型不支持生图功能";
          }
        }
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error: any) {
      ztoolkit.log("[AI-Butler] 一图总结 API 测试失败:", error);

      // 构建详细错误信息
      const lines: string[] = [];
      lines.push(`❌ 测试失败`);
      lines.push("");
      lines.push(`错误信息: ${error?.message || "连接失败"}`);
      lines.push(`请求地址: ${apiUrl}`);
      lines.push(`模型名称: ${model}`);

      // 尝试解析响应体中的详细错误
      try {
        const responseText =
          error?.xmlhttp?.response || error?.xmlhttp?.responseText;
        if (responseText) {
          const parsed =
            typeof responseText === "string"
              ? JSON.parse(responseText)
              : responseText;
          if (parsed?.error) {
            lines.push("");
            lines.push(`API 错误码: ${parsed.error.code || "N/A"}`);
            lines.push(`API 错误信息: ${parsed.error.message || "N/A"}`);
            if (parsed.error.status) {
              lines.push(`API 状态: ${parsed.error.status}`);
            }
          }
        }
      } catch {
        // 如果无法解析响应，尝试获取原始响应
        try {
          const rawResponse =
            error?.xmlhttp?.response || error?.xmlhttp?.responseText;
          if (rawResponse) {
            lines.push("");
            lines.push(
              `原始响应: ${typeof rawResponse === "string" ? rawResponse.substring(0, 500) : JSON.stringify(rawResponse).substring(0, 500)}`,
            );
          }
        } catch {
          /* ignore */
        }
      }

      // HTTP 状态码
      if (error?.xmlhttp?.status) {
        lines.push("");
        lines.push(`HTTP 状态码: ${error.xmlhttp.status}`);
      }

      const fullMsg = lines.join("\n");

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
      "系统将自动调用 Gemini 生图 API 生成学术概念海报。\n\n" +
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
