/**
 * API 设置页面
 *
 * 提供 API 配置管理界面
 *
 * @file ApiSettingsPage.ts
 * @author AI Butler Team
 */

import { getPref, setPref } from "../../../utils/prefs";
import {
  createStyledButton,
  createFormGroup,
  createInput,
  createSelect,
} from "../ui/components";
import LLMClient from "../../llmClient";

/**
 * API 设置页面类
 */
export class ApiSettingsPage {
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
      textContent: "🔌 API 配置",
      styles: {
        color: "#59c0bc",
        marginBottom: "20px",
        fontSize: "20px",
        borderBottom: "2px solid #59c0bc",
        paddingBottom: "10px",
      },
    });
    this.container.appendChild(title);

    // 添加必填项说明
    const notice = this.createElement("div", {
      styles: {
        padding: "12px 16px",
        backgroundColor: "#e3f2fd",
        border: "1px solid #2196f3",
        borderRadius: "6px",
        marginBottom: "24px",
        fontSize: "14px",
        color: "#1565c0",
      },
    });
    const doc = Zotero.getMainWindow().document;
    notice.innerHTML =
      "📝 <strong>说明</strong>: 标有 <strong style='color: #d32f2f;'>*</strong> 的字段为必填项";
    this.container.appendChild(notice);

    // 表单容器
    const form = this.createElement("div", {
      styles: {
        maxWidth: "800px",
      },
    });

    // API 提供商选择（使用自定义下拉，支持 onChange）
    const providerValue = (getPref("provider") as string) || "openai";
    const providerSelect = createSelect(
      "provider",
      [
        { value: "openai", label: "OpenAI (Responses 新接口)" },
        {
          value: "openai-compat",
          label: "OpenAI兼容 (旧 ChatCompletions / 第三方)",
        },
        { value: "google", label: "Google Gemini" },
        { value: "anthropic", label: "Anthropic Claude" },
      ],
      providerValue,
      (newVal) => {
        // 供应商切换时，动态刷新字段显示
        renderProviderSections(newVal);
        // 取消 Provider 与 PDF 模式的强制联动：用户自行选择 PDF 处理模式
        // 若切换到 Gemini 且未填写，填充默认 URL 与模型
        if (newVal === "google") {
          const curUrl = (getPref("geminiApiUrl") as string) || "";
          const urlInput = this.container.querySelector(
            "#setting-geminiApiUrl",
          ) as HTMLInputElement;
          const modelInput = this.container.querySelector(
            "#setting-geminiModel",
          ) as HTMLInputElement;
          if (urlInput && (!curUrl || urlInput.value.trim() === "")) {
            urlInput.value = "https://generativelanguage.googleapis.com";
          }
          if (
            modelInput &&
            (!modelInput.value || modelInput.value.trim() === "")
          ) {
            modelInput.value = "gemini-2.5-pro";
          }
        }
        // 若切换到 Anthropic 且未填写，填充默认 URL 与模型
        if (newVal === "anthropic") {
          const curUrl = (getPref("anthropicApiUrl") as string) || "";
          const urlInput = this.container.querySelector(
            "#setting-anthropicApiUrl",
          ) as HTMLInputElement;
          const modelInput = this.container.querySelector(
            "#setting-anthropicModel",
          ) as HTMLInputElement;
          if (urlInput && (!curUrl || urlInput.value.trim() === "")) {
            urlInput.value = "https://api.anthropic.com";
          }
          if (
            modelInput &&
            (!modelInput.value || modelInput.value.trim() === "")
          ) {
            modelInput.value = "claude-3-5-sonnet-20241022";
          }
        }
      },
    );
    form.appendChild(
      this.createFormGroup(
        "API 提供商",
        providerSelect,
        "选择您使用的 AI 模型提供商",
      ),
    );

    // Provider 专属字段容器
    const sectionOpenAI = this.createElement("div", { id: "provider-openai" });
    const sectionOpenAICompat = this.createElement("div", {
      id: "provider-openai-compat",
    });
    const sectionGemini = this.createElement("div", { id: "provider-gemini" });
    const sectionAnthropic = this.createElement("div", {
      id: "provider-anthropic",
    });

    // OpenAI 字段（Responses 新接口）
    sectionOpenAI.appendChild(
      this.createFormGroup(
        "API 地址 *",
        this.createInput(
          "openaiApiUrl",
          "text",
          getPref("openaiApiUrl") as string,
          "https://api.openai.com/v1/responses",
        ),
        "【必填】OpenAI官方最新地址：https://api.openai.com/v1/responses",
      ),
    );
    sectionOpenAI.appendChild(
      this.createFormGroup(
        "API 密钥 *",
        this.createPasswordInput(
          "openaiApiKey",
          getPref("openaiApiKey") as string,
          "sk-...",
        ),
        "【必填】您的 API 密钥,将安全存储在本地",
      ),
    );
    sectionOpenAI.appendChild(
      this.createFormGroup(
        "模型 *",
        this.createInput(
          "openaiApiModel",
          "text",
          getPref("openaiApiModel") as string,
          "gpt-5",
        ),
        "【必填】要使用的模型名称",
      ),
    );

    // OpenAI 新接口说明
    const openaiNote = this.createElement("div", {
      innerHTML:
        "ℹ️ <strong>说明</strong>：当前配置使用 OpenAI 官方新接口 <code>/v1/responses</code>（多模态统一）。如果你需要兼容第三方旧的 Chat Completions 服务（如 SiliconFlow 代理），请选择上方下拉中的 <strong>OpenAI兼容</strong> 提供商。",
      styles: {
        padding: "10px 12px",
        backgroundColor: "#e8f5e9",
        border: "1px solid #a5d6a7",
        borderRadius: "6px",
        color: "#2e7d32",
        fontSize: "13px",
        marginBottom: "16px",
      },
    });
    sectionOpenAI.appendChild(openaiNote);

    // OpenAI 兼容（旧 Chat Completions / 第三方）字段
    sectionOpenAICompat.appendChild(
      this.createFormGroup(
        "兼容 API 地址 *",
        this.createInput(
          "openaiCompatApiUrl",
          "text",
          (getPref("openaiCompatApiUrl") as string) ||
            "https://api.openai.com/v1/chat/completions",
          "https://api.openai.com/v1/chat/completions",
        ),
        "【必填】旧版 Chat Completions 完整端点。例如 SiliconFlow: https://api.siliconflow.cn/v1/chat/completions",
      ),
    );
    sectionOpenAICompat.appendChild(
      this.createFormGroup(
        "兼容 API 密钥 *",
        this.createPasswordInput(
          "openaiCompatApiKey",
          (getPref("openaiCompatApiKey") as string) ||
            (getPref("openaiApiKey") as string),
          "sk-...",
        ),
        "【必填】对应第三方服务的密钥（格式同 Bearer Token）",
      ),
    );
    sectionOpenAICompat.appendChild(
      this.createFormGroup(
        "兼容模型 *",
        this.createInput(
          "openaiCompatModel",
          "text",
          (getPref("openaiCompatModel") as string) ||
            (getPref("openaiApiModel") as string) ||
            "gpt-3.5-turbo",
          "gpt-3.5-turbo",
        ),
        "【必填】第三方提供的模型名称，如 Qwen/QwQ-32B、deepseek-ai/DeepSeek-V3 等",
      ),
    );
    const openaiCompatNote = this.createElement("div", {
      innerHTML:
        '⚠️ <strong>用途</strong>：用于兼容旧的 <code>/v1/chat/completions</code> 格式，适配第三方聚合/代理服务（SiliconFlow、OpenAI 兼容网关等）。<br/>若使用官方 OpenAI，请选择 <strong>OpenAI (Responses 新接口)</strong>。<br/>若第三方不支持PDF Base64多模态处理方式，请在 PDF 处理配置中改为"文本提取"模式。',
      styles: {
        padding: "10px 12px",
        backgroundColor: "#fff8e1",
        border: "1px solid #ffe082",
        borderRadius: "6px",
        color: "#795548",
        fontSize: "13px",
        marginBottom: "16px",
      },
    });
    sectionOpenAICompat.appendChild(openaiCompatNote);

    // Gemini 字段
    sectionGemini.appendChild(
      this.createFormGroup(
        "API 基础地址 *",
        this.createInput(
          "geminiApiUrl",
          "text",
          getPref("geminiApiUrl") as string,
          "https://generativelanguage.googleapis.com",
        ),
        "【必填】将以 /v1beta/models/{模型名}:streamGenerateContent?alt=sse 调用",
      ),
    );
    sectionGemini.appendChild(
      this.createFormGroup(
        "API 密钥 *",
        this.createPasswordInput(
          "geminiApiKey",
          getPref("geminiApiKey") as string,
          "sk-...",
        ),
        "【必填】您的 Gemini API Key, 将通过 x-goog-api-key 发送",
      ),
    );
    sectionGemini.appendChild(
      this.createFormGroup(
        "模型 *",
        this.createInput(
          "geminiModel",
          "text",
          getPref("geminiModel") as string,
          "gemini-2.5-pro",
        ),
        "【必填】Gemini 模型名称, 如 gemini-2.5-pro",
      ),
    );

    // Anthropic 字段
    sectionAnthropic.appendChild(
      this.createFormGroup(
        "API 基础地址 *",
        this.createInput(
          "anthropicApiUrl",
          "text",
          getPref("anthropicApiUrl") as string,
          "https://api.anthropic.com",
        ),
        "【必填】Anthropic API 基础地址",
      ),
    );
    sectionAnthropic.appendChild(
      this.createFormGroup(
        "API 密钥 *",
        this.createPasswordInput(
          "anthropicApiKey",
          getPref("anthropicApiKey") as string,
          "sk-ant-...",
        ),
        "【必填】您的 Anthropic API Key, 将通过 x-api-key 发送",
      ),
    );
    sectionAnthropic.appendChild(
      this.createFormGroup(
        "模型 *",
        this.createInput(
          "anthropicModel",
          "text",
          getPref("anthropicModel") as string,
          "claude-3-5-sonnet-20241022",
        ),
        "【必填】Claude 模型名称, 如 claude-3-5-sonnet-20241022",
      ),
    );

    form.appendChild(sectionOpenAI);
    form.appendChild(sectionOpenAICompat);
    form.appendChild(sectionGemini);
    form.appendChild(sectionAnthropic);

    const renderProviderSections = (prov: string) => {
      const isGemini = prov === "google";
      const isAnthropic = prov === "anthropic";
      const isOpenAICompat = prov === "openai-compat";
      (sectionOpenAI as HTMLElement).style.display =
        isGemini || isAnthropic || isOpenAICompat ? "none" : "block";
      (sectionOpenAICompat as HTMLElement).style.display = isOpenAICompat
        ? "block"
        : "none";
      (sectionGemini as HTMLElement).style.display = isGemini
        ? "block"
        : "none";
      (sectionAnthropic as HTMLElement).style.display = isAnthropic
        ? "block"
        : "none";
    };
    renderProviderSections(providerValue);

    // Temperature 参数（可选启用）
    const tempContainer = this.createElement("div", {
      styles: { display: "flex", alignItems: "center", gap: "12px" },
    });
    const enableTemp = ((getPref("enableTemperature") as any) ??
      true) as boolean;
    const tempToggle = this.createCheckbox("enableTemperature", enableTemp);
    const tempSlider = this.createSlider(
      "temperature",
      0,
      2,
      0.1,
      parseFloat((getPref("temperature") as string) || "0.7"),
    );
    // 控制禁用状态
    setTimeout(() => {
      const sliderEl = tempSlider.querySelector(
        "#setting-temperature",
      ) as HTMLInputElement;
      const cbEl = tempToggle.querySelector(
        "#setting-enableTemperature",
      ) as HTMLInputElement;
      if (sliderEl && cbEl) {
        sliderEl.disabled = !cbEl.checked;
        cbEl.addEventListener("change", () => {
          sliderEl.disabled = !cbEl.checked;
        });
      }
    }, 0);
    tempContainer.appendChild(tempToggle);
    tempContainer.appendChild(tempSlider);
    form.appendChild(
      this.createFormGroup(
        "Temperature",
        tempContainer,
        "控制输出的随机性 (0-2),值越高输出越随机；未勾选时将不发送该参数",
      ),
    );

    // Max Tokens 参数（可选启用）
    const maxContainer = this.createElement("div", {
      styles: {
        display: "flex",
        alignItems: "center",
        gap: "12px",
        flexWrap: "nowrap",
      },
    });
    const enableMax = ((getPref("enableMaxTokens") as any) ?? true) as boolean;
    const maxToggle = this.createCheckbox("enableMaxTokens", enableMax);
    const maxInput = this.createInput(
      "maxTokens",
      "number",
      ((getPref("maxTokens") as string) || "4096") as string,
      "4096",
    );
    // 缩短输入框，保持与 Temperature 行一致的紧凑布局
    Object.assign(maxInput.style, {
      width: "180px",
      flex: "0 0 180px",
    });
    setTimeout(() => {
      const inputEl = this.container.querySelector(
        "#setting-maxTokens",
      ) as HTMLInputElement;
      const cbEl = maxToggle.querySelector(
        "#setting-enableMaxTokens",
      ) as HTMLInputElement;
      if (inputEl && cbEl) {
        inputEl.disabled = !cbEl.checked;
        cbEl.addEventListener("change", () => {
          inputEl.disabled = !cbEl.checked;
        });
      }
    }, 0);
    maxContainer.appendChild(maxToggle);
    maxContainer.appendChild(maxInput);
    form.appendChild(
      this.createFormGroup(
        "Max Tokens",
        maxContainer,
        "生成内容的最大 token 数；未勾选时将不发送该参数（某些服务可选）",
      ),
    );

    // Top P 参数（可选启用）
    const topPContainer = this.createElement("div", {
      styles: { display: "flex", alignItems: "center", gap: "12px" },
    });
    const enableTopP = ((getPref("enableTopP") as any) ?? true) as boolean;
    const topPToggle = this.createCheckbox("enableTopP", enableTopP);
    const topPSlider = this.createSlider(
      "topP",
      0,
      1,
      0.05,
      parseFloat((getPref("topP") as string) || "1.0"),
    );
    setTimeout(() => {
      const sliderEl = topPSlider.querySelector(
        "#setting-topP",
      ) as HTMLInputElement;
      const cbEl = topPToggle.querySelector(
        "#setting-enableTopP",
      ) as HTMLInputElement;
      if (sliderEl && cbEl) {
        sliderEl.disabled = !cbEl.checked;
        cbEl.addEventListener("change", () => {
          sliderEl.disabled = !cbEl.checked;
        });
      }
    }, 0);
    topPContainer.appendChild(topPToggle);
    topPContainer.appendChild(topPSlider);
    form.appendChild(
      this.createFormGroup(
        "Top P",
        topPContainer,
        "核采样参数 (0-1),控制输出的多样性；未勾选时将不发送该参数",
      ),
    );

    // 流式输出开关
    form.appendChild(
      this.createFormGroup(
        "流式输出",
        this.createCheckbox("stream", getPref("stream") as boolean),
        "启用后将实时显示生成过程",
      ),
    );

    // 请求超时配置
    form.appendChild(
      this.createFormGroup(
        "请求超时时间 (毫秒)",
        this.createInput(
          "requestTimeout",
          "number",
          getPref("requestTimeout") as string,
          "300000",
        ),
        "API请求的超时时间,默认300000ms(5分钟),最小30000ms(30秒)",
      ),
    );

    // === 调度配置分隔线 ===
    const scheduleTitle = this.createElement("h3", {
      textContent: "📅 调度配置",
      styles: {
        color: "#667eea",
        marginTop: "40px",
        marginBottom: "20px",
        fontSize: "18px",
        borderBottom: "2px solid #667eea",
        paddingBottom: "8px",
      },
    });
    form.appendChild(scheduleTitle);

    // 每批次处理论文数量
    form.appendChild(
      this.createFormGroup(
        "每批次处理论文数量",
        this.createInput(
          "batchSize",
          "number",
          getPref("batchSize") as string,
          "1",
        ),
        "同时处理的论文数量,建议设置为 1 以避免 API 限流",
      ),
    );

    // 批次间隔时间
    form.appendChild(
      this.createFormGroup(
        "批次间隔时间(秒)",
        this.createInput(
          "batchInterval",
          "number",
          getPref("batchInterval") as string,
          "60",
        ),
        "每批次之间的等待时间,用于控制 API 调用频率",
      ),
    );

    // 自动扫描间隔
    form.appendChild(
      this.createFormGroup(
        "自动扫描间隔(秒)",
        this.createInput(
          "scanInterval",
          "number",
          getPref("scanInterval") as string,
          "300",
        ),
        "后台自动扫描新文献的时间间隔,默认 5 分钟",
      ),
    );

    // === PDF 处理配置分隔线 ===
    const pdfTitle = this.createElement("h3", {
      textContent: "📄 PDF 处理配置",
      styles: {
        color: "#ff9800",
        marginTop: "40px",
        marginBottom: "20px",
        fontSize: "18px",
        borderBottom: "2px solid #ff9800",
        paddingBottom: "8px",
      },
    });
    form.appendChild(pdfTitle);

    // PDF 处理模式选择
    const pdfModeValue = (getPref("pdfProcessMode") as string) || "base64";
    const pdfModeSelect = createSelect(
      "pdfProcessMode",
      [
        { value: "base64", label: "Base64 编码(推荐,支持多模态)" },
        { value: "text", label: "文本提取(仅文字内容)" },
      ],
      pdfModeValue,
      (newVal) => {
        // 当用户手动调整 PDF 模式，也给出一个轻量提示
        const msg =
          newVal === "base64"
            ? "已选择 Base64 模式：多模态更强，适用于 Gemini 等。"
            : "已选择 文本提取 模式：仅文字，适用于 Anthropic 等。";
        try {
          new ztoolkit.ProgressWindow("AI Butler", {
            closeOnClick: true,
            closeTime: 2500,
          })
            .createLine({ text: msg, type: "info" })
            .show();
        } catch (e) {
          // 记录而不打断设置流，避免空代码块触发 eslint no-empty
          try {
            ztoolkit.log("[API Settings] 显示 PDF 模式提示失败:", e);
          } catch (_ignore) {
            // 在罕见环境下 ztoolkit 不可用时静默忽略
          }
        }
      },
    );
    form.appendChild(
      this.createFormGroup(
        "PDF 处理模式",
        pdfModeSelect,
        "Base64 模式:将 PDF 直接编码发送给多模态大模型,支持图片、表格、公式等。文本模式:仅提取文字内容,适合不支持多模态的模型",
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
    const testButton = this.createButton("🔍 测试连接", "#2196f3");
    testButton.addEventListener("click", () => this.testApiConnection());
    buttonGroup.appendChild(testButton);

    // 保存按钮
    const saveButton = this.createButton("💾 保存设置", "#4caf50");
    saveButton.addEventListener("click", () => this.saveSettings());
    buttonGroup.appendChild(saveButton);

    // 重置按钮
    const resetButton = this.createButton("🔄 重置默认", "#9e9e9e");
    resetButton.addEventListener("click", () => this.resetSettings());
    buttonGroup.appendChild(resetButton);

    form.appendChild(buttonGroup);

    // 测试结果展示区域（防止进度窗文本过长被截断）
    const resultBox = this.createElement("div", {
      id: "api-test-result",
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
    });
    copyBtn.addEventListener("click", async () => {
      const text = (resultPre.textContent || "").toString();
      const win = Zotero.getMainWindow() as any;
      const doc = win?.document as Document | undefined;
      const nav = (win as any)?.navigator as any;
      try {
        // 优先使用标准剪贴板 API（在 Zotero/Firefox 环境下可能可用）
        if (nav?.clipboard?.writeText) {
          await nav.clipboard.writeText(text);
        } else {
          throw new Error("clipboard api unavailable");
        }
        new ztoolkit.ProgressWindow("API 连接测试", { closeTime: 1500 })
          .createLine({ text: "已复制错误详情", type: "success" })
          .show();
      } catch {
        try {
          if (!doc) throw new Error("no document");
          // 退化为选中复制
          const tmp = doc.createElement("textarea");
          tmp.value = text;
          (tmp.style as any).position = "fixed";
          (tmp.style as any).left = "-9999px";
          (doc.documentElement || doc.body || doc).appendChild(tmp);
          (tmp as any).select?.();
          (doc as any).execCommand?.("copy");
          (tmp as any).remove?.();
          new ztoolkit.ProgressWindow("API 连接测试", { closeTime: 1500 })
            .createLine({ text: "已复制错误详情", type: "success" })
            .show();
        } catch {
          new ztoolkit.ProgressWindow("API 连接测试", { closeTime: 2500 })
            .createLine({
              text: "复制失败，可手动选择文本复制",
              type: "default",
            })
            .show();
        }
      }
    });
    resultTitle.appendChild(resultTitleText);
    resultTitle.appendChild(copyBtn);
    const resultPre = this.createElement("pre", {
      id: "api-test-result-text",
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
   * 创建元素
   */
  private createElement(tag: string, options: any): HTMLElement {
    const doc = Zotero.getMainWindow().document;
    const element = doc.createElement(tag);

    if (options.textContent) {
      element.textContent = options.textContent;
    }

    if (options.innerHTML) {
      element.innerHTML = options.innerHTML;
    }

    if (options.id) {
      element.id = options.id;
    }

    if (options.className) {
      element.className = options.className;
    }

    if (options.styles) {
      Object.assign(element.style, options.styles);
    }

    if (options.children) {
      options.children.forEach((child: HTMLElement) => {
        element.appendChild(child);
      });
    }

    return element;
  }

  /**
   * 创建表单组
   */
  private createFormGroup(
    label: string,
    input: HTMLElement,
    description?: string,
  ): HTMLElement {
    const group = this.createElement("div", {
      styles: {
        marginBottom: "24px",
      },
    });

    const labelElement = this.createElement("label", {
      textContent: label,
      styles: {
        display: "block",
        marginBottom: "8px",
        fontSize: "14px",
        fontWeight: "600",
        color: "#333",
      },
    });
    group.appendChild(labelElement);

    group.appendChild(input);

    if (description) {
      const desc = this.createElement("div", {
        textContent: description,
        styles: {
          marginTop: "6px",
          fontSize: "12px",
          color: "#666",
        },
      });
      group.appendChild(desc);
    }

    return group;
  }

  /**
   * 创建文本输入框
   */
  private createInput(
    id: string,
    type: string,
    value: string,
    placeholder?: string,
  ): HTMLInputElement {
    const doc = Zotero.getMainWindow().document;
    const input = doc.createElement("input");
    input.type = type;
    input.id = `setting-${id}`;
    input.value = value || "";
    if (placeholder) input.placeholder = placeholder;

    Object.assign(input.style, {
      width: "100%",
      padding: "10px 12px",
      fontSize: "14px",
      border: "1px solid #ddd",
      borderRadius: "4px",
      boxSizing: "border-box",
      textAlign: "left",
    });

    input.addEventListener("focus", () => {
      input.style.borderColor = "#59c0bc";
      input.style.outline = "none";
    });

    input.addEventListener("blur", () => {
      input.style.borderColor = "#ddd";
    });

    return input;
  }

  /**
   * 创建密码输入框
   */
  private createPasswordInput(
    id: string,
    value: string,
    placeholder?: string,
  ): HTMLElement {
    const container = this.createElement("div", {
      styles: {
        position: "relative",
        display: "flex",
        gap: "8px",
      },
    });

    const input = this.createInput(id, "password", value, placeholder);
    input.style.flex = "1";
    container.appendChild(input);

    const toggleButton = this.createElement("button", {
      textContent: "👁️",
      styles: {
        padding: "10px 16px",
        border: "1px solid #ddd",
        borderRadius: "4px",
        backgroundColor: "#f5f5f5",
        cursor: "pointer",
        fontSize: "16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      },
    });

    let isVisible = false;
    toggleButton.addEventListener("click", (e) => {
      e.preventDefault();
      isVisible = !isVisible;
      input.type = isVisible ? "text" : "password";
      toggleButton.textContent = isVisible ? "🙈" : "👁️";
    });

    container.appendChild(toggleButton);

    return container;
  }

  /**
   * 创建滑块
   */
  private createSlider(
    id: string,
    min: number,
    max: number,
    step: number,
    value: number,
  ): HTMLElement {
    const doc = Zotero.getMainWindow().document;
    const container = this.createElement("div", {
      styles: {
        display: "flex",
        alignItems: "center",
        gap: "12px",
      },
    });

    const slider = doc.createElement("input");
    slider.type = "range";
    slider.id = `setting-${id}`;
    slider.min = min.toString();
    slider.max = max.toString();
    slider.step = step.toString();
    slider.value = value.toString();

    Object.assign(slider.style, {
      flex: "1",
      height: "6px",
      borderRadius: "3px",
      outline: "none",
    });

    const valueDisplay = this.createElement("span", {
      textContent: value.toFixed(2),
      styles: {
        minWidth: "50px",
        textAlign: "right",
        fontSize: "14px",
        fontWeight: "600",
        color: "#59c0bc",
      },
    });

    slider.addEventListener("input", () => {
      valueDisplay.textContent = parseFloat(slider.value).toFixed(2);
    });

    container.appendChild(slider);
    container.appendChild(valueDisplay);

    return container;
  }

  /**
   * 创建复选框
   */
  private createCheckbox(id: string, checked: boolean): HTMLElement {
    const doc = Zotero.getMainWindow().document;
    const container = this.createElement("div", {
      styles: {
        display: "flex",
        alignItems: "center",
        gap: "12px",
      },
    });

    const checkbox = doc.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = `setting-${id}`;
    checkbox.checked = checked;

    Object.assign(checkbox.style, {
      width: "20px",
      height: "20px",
      cursor: "pointer",
    });

    const label = this.createElement("span", {
      textContent: checked ? "已启用" : "已禁用",
      styles: {
        fontSize: "14px",
        color: "#666",
      },
    });

    checkbox.addEventListener("change", () => {
      label.textContent = checkbox.checked ? "已启用" : "已禁用";
    });

    container.appendChild(checkbox);
    container.appendChild(label);

    return container;
  }

  /**
   * 创建按钮
   */
  private createButton(text: string, color: string): HTMLButtonElement {
    return createStyledButton(text, color);
  }

  /**
   * 保存设置
   */
  private async saveSettings(): Promise<void> {
    try {
      // 🔧 修复: 在 container 内查找元素,而不是在主窗口 document 中
      ztoolkit.log("[API Settings] Starting save...");

      // 获取表单值 - 使用 querySelector 在 container 内查找
      const providerEl = this.container.querySelector(
        "#setting-provider",
      ) as HTMLElement;
      // OpenAI
      const apiUrlEl = this.container.querySelector(
        "#setting-openaiApiUrl",
      ) as HTMLInputElement;
      const apiKeyEl = this.container.querySelector(
        "#setting-openaiApiKey",
      ) as HTMLInputElement;
      const modelEl = this.container.querySelector(
        "#setting-openaiApiModel",
      ) as HTMLInputElement;
      // OpenAI 兼容（旧接口）
      const compatUrlEl = this.container.querySelector(
        "#setting-openaiCompatApiUrl",
      ) as HTMLInputElement;
      const compatKeyEl = this.container.querySelector(
        "#setting-openaiCompatApiKey",
      ) as HTMLInputElement;
      const compatModelEl = this.container.querySelector(
        "#setting-openaiCompatModel",
      ) as HTMLInputElement;
      // Gemini
      const gemUrlEl = this.container.querySelector(
        "#setting-geminiApiUrl",
      ) as HTMLInputElement;
      const gemKeyEl = this.container.querySelector(
        "#setting-geminiApiKey",
      ) as HTMLInputElement;
      const gemModelEl = this.container.querySelector(
        "#setting-geminiModel",
      ) as HTMLInputElement;
      // Anthropic
      const anthUrlEl = this.container.querySelector(
        "#setting-anthropicApiUrl",
      ) as HTMLInputElement;
      const anthKeyEl = this.container.querySelector(
        "#setting-anthropicApiKey",
      ) as HTMLInputElement;
      const anthModelEl = this.container.querySelector(
        "#setting-anthropicModel",
      ) as HTMLInputElement;
      const temperatureEl = this.container.querySelector(
        "#setting-temperature",
      ) as HTMLInputElement;
      const maxTokensEl = this.container.querySelector(
        "#setting-maxTokens",
      ) as HTMLInputElement;
      const topPEl = this.container.querySelector(
        "#setting-topP",
      ) as HTMLInputElement;
      const enableTempEl = this.container.querySelector(
        "#setting-enableTemperature",
      ) as HTMLInputElement;
      const enableMaxEl = this.container.querySelector(
        "#setting-enableMaxTokens",
      ) as HTMLInputElement;
      const enableTopPEl = this.container.querySelector(
        "#setting-enableTopP",
      ) as HTMLInputElement;
      const streamEl = this.container.querySelector(
        "#setting-stream",
      ) as HTMLInputElement;
      // 调度配置
      const batchSizeEl = this.container.querySelector(
        "#setting-batchSize",
      ) as HTMLInputElement;
      const batchIntervalEl = this.container.querySelector(
        "#setting-batchInterval",
      ) as HTMLInputElement;
      const scanIntervalEl = this.container.querySelector(
        "#setting-scanInterval",
      ) as HTMLInputElement;
      // PDF 处理模式
      const pdfModeEl = this.container.querySelector(
        "#setting-pdfProcessMode",
      ) as HTMLElement;

      // 调试: 检查元素是否找到
      ztoolkit.log("[API Settings] Elements found:", {
        provider: !!providerEl,
        openaiApiUrl: !!apiUrlEl,
        openaiApiKey: !!apiKeyEl,
        openaiApiModel: !!modelEl,
      });

      const provider = (providerEl as any)?.getValue
        ? (providerEl as any).getValue()
        : "openai";
      const pdfProcessMode = (pdfModeEl as any)?.getValue
        ? (pdfModeEl as any).getValue()
        : "base64";
      const values = {
        provider,
        openaiApiUrl: apiUrlEl?.value?.trim() || "",
        openaiApiKey: apiKeyEl?.value?.trim() || "",
        openaiApiModel: modelEl?.value?.trim() || "",
        openaiCompatApiUrl: compatUrlEl?.value?.trim() || "",
        openaiCompatApiKey: compatKeyEl?.value?.trim() || "",
        openaiCompatModel: compatModelEl?.value?.trim() || "",
        geminiApiUrl: gemUrlEl?.value?.trim() || "",
        geminiApiKey: gemKeyEl?.value?.trim() || "",
        geminiModel: gemModelEl?.value?.trim() || "",
        anthropicApiUrl: anthUrlEl?.value?.trim() || "",
        anthropicApiKey: anthKeyEl?.value?.trim() || "",
        anthropicModel: anthModelEl?.value?.trim() || "",
        temperature: temperatureEl?.value || "0.7",
        maxTokens: maxTokensEl?.value?.trim() || "4096",
        topP: topPEl?.value || "1.0",
        enableTemperature: enableTempEl?.checked ?? true,
        enableMaxTokens: enableMaxEl?.checked ?? true,
        enableTopP: enableTopPEl?.checked ?? true,
        stream: streamEl?.checked ?? true,
        requestTimeout:
          (
            this.container.querySelector(
              "#setting-requestTimeout",
            ) as HTMLInputElement
          )?.value?.trim() || "300000",
        batchSize: batchSizeEl?.value?.trim() || "1",
        batchInterval: batchIntervalEl?.value?.trim() || "60",
        scanInterval: scanIntervalEl?.value?.trim() || "300",
        pdfProcessMode,
      } as const;

      // 调试: 检查获取到的值
      ztoolkit.log("[API Settings] Values:", {
        openaiApiUrl: values.openaiApiUrl || "(空)",
        openaiApiKey: values.openaiApiKey ? "(已设置)" : "(空)",
        openaiApiModel: values.openaiApiModel || "(空)",
      });

      // 验证必填项 - 详细提示哪些字段缺失
      const missingFields: string[] = [];
      if (provider === "google") {
        if (!values.geminiApiUrl) missingFields.push("API 基础地址(Gemini)");
        if (!values.geminiApiKey) missingFields.push("API 密钥(Gemini)");
        if (!values.geminiModel) missingFields.push("模型名称(Gemini)");
      } else if (provider === "anthropic") {
        if (!values.anthropicApiUrl)
          missingFields.push("API 基础地址(Anthropic)");
        if (!values.anthropicApiKey) missingFields.push("API 密钥(Anthropic)");
        if (!values.anthropicModel) missingFields.push("模型名称(Anthropic)");
      } else if (provider === "openai-compat") {
        if (!values.openaiCompatApiUrl)
          missingFields.push("兼容 API 地址(OpenAI兼容)");
        if (!values.openaiCompatApiKey)
          missingFields.push("兼容 API 密钥(OpenAI兼容)");
        if (!values.openaiCompatModel)
          missingFields.push("兼容 模型名称(OpenAI兼容)");
      } else {
        if (!values.openaiApiUrl) missingFields.push("API 地址");
        if (!values.openaiApiKey) missingFields.push("API 密钥");
        if (!values.openaiApiModel) missingFields.push("模型名称");
      }

      if (missingFields.length > 0) {
        const errorMsg = `请填写以下必填项:\n\n• ${missingFields.join("\n• ")}`;
        ztoolkit.log("[API Settings] Validation failed:", missingFields);

        new ztoolkit.ProgressWindow("API 配置", {
          closeTime: 4000,
        })
          .createLine({ text: `❌ ${errorMsg}`, type: "fail" })
          .show();
        return;
      }

      // 保存到配置
      setPref("provider", values.provider);
      // 分别保存三套配置,互不覆盖
      setPref("openaiApiUrl", values.openaiApiUrl);
      // OpenAI 兼容配置保存
      setPref("openaiCompatApiUrl", values.openaiCompatApiUrl);
      setPref("openaiCompatApiKey", values.openaiCompatApiKey);
      setPref("openaiCompatModel", values.openaiCompatModel);
      setPref("openaiApiKey", values.openaiApiKey);
      setPref("openaiApiModel", values.openaiApiModel);
      setPref("geminiApiUrl", values.geminiApiUrl);
      setPref("geminiApiKey", values.geminiApiKey);
      setPref("geminiModel", values.geminiModel);
      setPref("anthropicApiUrl", values.anthropicApiUrl);
      setPref("anthropicApiKey", values.anthropicApiKey);
      setPref("anthropicModel", values.anthropicModel);
      setPref("temperature", values.temperature);
      setPref("maxTokens", values.maxTokens);
      setPref("topP", values.topP);
      setPref("enableTemperature", values.enableTemperature as any);
      setPref("enableMaxTokens", values.enableMaxTokens as any);
      setPref("enableTopP", values.enableTopP as any);
      setPref("stream", values.stream);
      setPref("requestTimeout", values.requestTimeout);
      // 调度配置
      setPref("batchSize", values.batchSize);
      setPref("batchInterval", values.batchInterval);
      setPref("scanInterval", values.scanInterval);
      // PDF 处理模式
      setPref("pdfProcessMode", values.pdfProcessMode);

      // 不再在保存时强制调整 PDF 模式

      ztoolkit.log("[API Settings] Settings saved successfully");

      new ztoolkit.ProgressWindow("API 配置", {
        closeTime: 2000,
      })
        .createLine({ text: "✅ 设置已保存", type: "success" })
        .show();
    } catch (error: any) {
      ztoolkit.log(`[API Settings] Save error: ${error}`);
      new ztoolkit.ProgressWindow("API 配置", {
        closeTime: 3000,
      })
        .createLine({ text: `❌ 保存失败: ${error.message}`, type: "fail" })
        .show();
    }
  }

  /**
   * 测试 API 连接
   */
  private async testApiConnection(): Promise<void> {
    const progressWindow = new ztoolkit.ProgressWindow("API 连接测试", {
      closeTime: -1,
    });
    progressWindow.createLine({ text: "正在测试连接...", type: "default" });
    progressWindow.show();

    // 页面内结果区域（避免进度窗文本截断）
    const resultBox = this.container.querySelector(
      "#api-test-result",
    ) as HTMLElement | null;
    const resultPre = this.container.querySelector(
      "#api-test-result-text",
    ) as HTMLElement | null;
    if (resultBox && resultPre) {
      resultBox.style.display = "block";
      resultBox.style.backgroundColor = "#fff8e1";
      resultBox.style.border = "1px solid #ffe082";
      resultPre.textContent = "正在测试连接…\n请稍候。";
    }

    try {
      // 先保存当前设置,确保测试使用最新配置
      await this.saveSettings();

      // 调用 LLMClient 的测试方法
      const result = await LLMClient.testConnection();

      progressWindow.changeLine({
        text: result,
        type: "success",
        progress: 100,
      });

      if (resultBox && resultPre) {
        resultBox.style.display = "block";
        // 成功样式
        resultBox.style.backgroundColor = "#e8f5e9";
        resultBox.style.border = "1px solid #a5d6a7";
        resultPre.style.color = "#1b5e20";
        resultPre.textContent = result;
      }

      setTimeout(() => progressWindow.close(), 3000);
    } catch (error: any) {
      const fullMsg = (error?.stack ||
        error?.message ||
        String(error)) as string;
      progressWindow.changeLine({
        text: `❌ ${error?.message || "连接失败"}`,
        type: "fail",
        progress: 100,
      });

      if (resultBox && resultPre) {
        resultBox.style.display = "block";
        // 失败样式
        resultBox.style.backgroundColor = "#ffebee";
        resultBox.style.border = "1px solid #ffcdd2";
        resultPre.style.color = "#b71c1c";
        resultPre.textContent = fullMsg;
      }

      setTimeout(() => progressWindow.close(), 5000);
    }
  }

  /**
   * 重置设置
   */
  private resetSettings(): void {
    const confirmed = Services.prompt.confirm(
      Zotero.getMainWindow() as any,
      "重置设置",
      "确定要重置为默认设置吗?",
    );

    if (!confirmed) {
      return;
    }

    // 重置为默认值
    setPref("provider", "openai");
    // OpenAI 默认（已改为新接口）
    setPref("openaiApiUrl", "https://api.openai.com/v1/responses");
    setPref("openaiApiKey", "");
    setPref("openaiApiModel", "gpt-5");
    // OpenAI 兼容默认
    setPref("openaiCompatApiUrl", "https://api.openai.com/v1/chat/completions");
    setPref("openaiCompatApiKey", "");
    setPref("openaiCompatModel", "gpt-3.5-turbo");
    // Gemini 默认
    setPref("geminiApiUrl", "https://generativelanguage.googleapis.com");
    setPref("geminiApiKey", "");
    setPref("geminiModel", "gemini-2.5-pro");
    // Anthropic 默认
    setPref("anthropicApiUrl", "https://api.anthropic.com");
    setPref("anthropicApiKey", "");
    setPref("anthropicModel", "claude-3-5-sonnet-20241022");
    setPref("temperature", "0.7");
    setPref("maxTokens", "8192");
    setPref("topP", "1.0");
    setPref("enableTemperature", true as any);
    setPref("enableMaxTokens", true as any);
    setPref("enableTopP", true as any);
    setPref("stream", true);
    setPref("requestTimeout", "300000");

    // 重新渲染
    this.render();

    new ztoolkit.ProgressWindow("API 配置")
      .createLine({ text: "已重置为默认设置", type: "success" })
      .show();
  }
}
