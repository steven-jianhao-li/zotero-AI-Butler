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
        { value: "openai", label: "OpenAI" },
        { value: "google", label: "Google Gemini" },
      ],
      providerValue,
      (newVal) => {
        // 供应商切换时，动态刷新字段显示
        renderProviderSections(newVal);
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
    const sectionGemini = this.createElement("div", { id: "provider-gemini" });

    // OpenAI 字段
    sectionOpenAI.appendChild(
      this.createFormGroup(
        "API 地址 *",
        this.createInput(
          "apiUrl",
          "text",
          getPref("apiUrl") as string,
          "https://api.openai.com/v1/chat/completions",
        ),
        "【必填】API 端点地址 (OpenAI 兼容接口)",
      ),
    );
    sectionOpenAI.appendChild(
      this.createFormGroup(
        "API 密钥 *",
        this.createPasswordInput(
          "apiKey",
          getPref("apiKey") as string,
          "sk-...",
        ),
        "【必填】您的 API 密钥,将安全存储在本地",
      ),
    );
    sectionOpenAI.appendChild(
      this.createFormGroup(
        "模型 *",
        this.createInput(
          "model",
          "text",
          getPref("model") as string,
          "gpt-3.5-turbo",
        ),
        "【必填】要使用的模型名称",
      ),
    );

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

    form.appendChild(sectionOpenAI);
    form.appendChild(sectionGemini);

    const renderProviderSections = (prov: string) => {
      const isGemini = prov === "google";
      (sectionOpenAI as HTMLElement).style.display = isGemini
        ? "none"
        : "block";
      (sectionGemini as HTMLElement).style.display = isGemini
        ? "block"
        : "none";
    };
    renderProviderSections(providerValue);

    // Temperature 参数
    form.appendChild(
      this.createFormGroup(
        "Temperature",
        this.createSlider(
          "temperature",
          0,
          2,
          0.1,
          parseFloat(getPref("temperature") as string),
        ),
        "控制输出的随机性 (0-2),值越高输出越随机",
      ),
    );

    // Max Tokens 参数
    form.appendChild(
      this.createFormGroup(
        "Max Tokens",
        this.createInput(
          "maxTokens",
          "number",
          getPref("maxTokens") as string,
          "4096",
        ),
        "生成内容的最大 token 数",
      ),
    );

    // Top P 参数
    form.appendChild(
      this.createFormGroup(
        "Top P",
        this.createSlider(
          "topP",
          0,
          1,
          0.05,
          parseFloat(getPref("topP") as string),
        ),
        "核采样参数 (0-1),控制输出的多样性",
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
      () => {}, // 无需回调
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
        "#setting-apiUrl",
      ) as HTMLInputElement;
      const apiKeyEl = this.container.querySelector(
        "#setting-apiKey",
      ) as HTMLInputElement;
      const modelEl = this.container.querySelector(
        "#setting-model",
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
      const temperatureEl = this.container.querySelector(
        "#setting-temperature",
      ) as HTMLInputElement;
      const maxTokensEl = this.container.querySelector(
        "#setting-maxTokens",
      ) as HTMLInputElement;
      const topPEl = this.container.querySelector(
        "#setting-topP",
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
        apiUrl: !!apiUrlEl,
        apiKey: !!apiKeyEl,
        model: !!modelEl,
      });

      const provider = (providerEl as any)?.getValue
        ? (providerEl as any).getValue()
        : "openai";
      const pdfProcessMode = (pdfModeEl as any)?.getValue
        ? (pdfModeEl as any).getValue()
        : "base64";
      const values = {
        provider,
        apiUrl: apiUrlEl?.value?.trim() || "",
        apiKey: apiKeyEl?.value?.trim() || "",
        model: modelEl?.value?.trim() || "",
        geminiApiUrl: gemUrlEl?.value?.trim() || "",
        geminiApiKey: gemKeyEl?.value?.trim() || "",
        geminiModel: gemModelEl?.value?.trim() || "",
        temperature: temperatureEl?.value || "0.7",
        maxTokens: maxTokensEl?.value?.trim() || "4096",
        topP: topPEl?.value || "1.0",
        stream: streamEl?.checked ?? true,
        batchSize: batchSizeEl?.value?.trim() || "1",
        batchInterval: batchIntervalEl?.value?.trim() || "60",
        scanInterval: scanIntervalEl?.value?.trim() || "300",
        pdfProcessMode,
      } as const;

      // 调试: 检查获取到的值
      ztoolkit.log("[API Settings] Values:", {
        apiUrl: values.apiUrl || "(空)",
        apiKey: values.apiKey ? "(已设置)" : "(空)",
        model: values.model || "(空)",
      });

      // 验证必填项 - 详细提示哪些字段缺失
      const missingFields: string[] = [];
      if (provider === "google") {
        if (!values.geminiApiUrl) missingFields.push("API 基础地址(Gemini)");
        if (!values.geminiApiKey) missingFields.push("API 密钥(Gemini)");
        if (!values.geminiModel) missingFields.push("模型名称(Gemini)");
      } else {
        if (!values.apiUrl) missingFields.push("API 地址");
        if (!values.apiKey) missingFields.push("API 密钥");
        if (!values.model) missingFields.push("模型名称");
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
      // 分别保存两套配置,互不覆盖
      setPref("apiUrl", values.apiUrl);
      setPref("apiKey", values.apiKey);
      setPref("model", values.model);
      setPref("geminiApiUrl", values.geminiApiUrl);
      setPref("geminiApiKey", values.geminiApiKey);
      setPref("geminiModel", values.geminiModel);
      setPref("temperature", values.temperature);
      setPref("maxTokens", values.maxTokens);
      setPref("topP", values.topP);
      setPref("stream", values.stream);
      // 调度配置
      setPref("batchSize", values.batchSize);
      setPref("batchInterval", values.batchInterval);
      setPref("scanInterval", values.scanInterval);
      // PDF 处理模式
      setPref("pdfProcessMode", values.pdfProcessMode);

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

      setTimeout(() => progressWindow.close(), 3000);
    } catch (error: any) {
      progressWindow.changeLine({
        text: `❌ ${error.message}`,
        type: "fail",
        progress: 100,
      });

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
    // OpenAI 默认
    setPref("apiUrl", "https://api.openai.com/v1/chat/completions");
    setPref("apiKey", "");
    setPref("model", "gpt-3.5-turbo");
    // Gemini 默认
    setPref("geminiApiUrl", "https://generativelanguage.googleapis.com");
    setPref("geminiApiKey", "");
    setPref("geminiModel", "gemini-2.5-pro");
    setPref("temperature", "0.7");
    setPref("maxTokens", "4096");
    setPref("topP", "1.0");
    setPref("stream", true);

    // 重新渲染
    this.render();

    new ztoolkit.ProgressWindow("API 配置")
      .createLine({ text: "已重置为默认设置", type: "success" })
      .show();
  }
}
