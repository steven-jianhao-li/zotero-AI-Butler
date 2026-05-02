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
import type { LLMModelInfo, LLMOptions } from "../../llmproviders/types";
import { ApiKeyManager, type ProviderId } from "../../apiKeyManager";

/**
 * API 设置页面类
 */
export class ApiSettingsPage {
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
        { value: "openrouter", label: "OpenRouter" },
        { value: "volcanoark", label: "火山方舟 (Volcano Ark)" },
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
        // 若切换到 OpenRouter 且未填写，填充默认
        if (newVal === "openrouter") {
          const curUrl = (getPref("openRouterApiUrl") as string) || "";
          const urlInput = this.container.querySelector(
            "#setting-openRouterApiUrl",
          ) as HTMLInputElement;
          const modelInput = this.container.querySelector(
            "#setting-openRouterModel",
          ) as HTMLInputElement;
          if (urlInput && (!curUrl || urlInput.value.trim() === "")) {
            urlInput.value = "https://openrouter.ai/api/v1/chat/completions";
          }
          if (
            modelInput &&
            (!modelInput.value || modelInput.value.trim() === "")
          ) {
            modelInput.value = "google/gemma-3-27b-it";
          }
        }
        // 若切换到火山方舟且未填写，填充默认
        if (newVal === "volcanoark") {
          const curUrl = (getPref("volcanoArkApiUrl") as string) || "";
          const urlInput = this.container.querySelector(
            "#setting-volcanoArkApiUrl",
          ) as HTMLInputElement;
          const modelInput = this.container.querySelector(
            "#setting-volcanoArkModel",
          ) as HTMLInputElement;
          if (urlInput && (!curUrl || urlInput.value.trim() === "")) {
            urlInput.value =
              "https://ark.cn-beijing.volces.com/api/v3/responses";
          }
          if (
            modelInput &&
            (!modelInput.value || modelInput.value.trim() === "")
          ) {
            modelInput.value = "doubao-seed-1-8-251228";
          }
        }
        this.refreshEndpointPreviews();
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
    const sectionOpenRouter = this.createElement("div", {
      id: "provider-openrouter",
    });
    const sectionVolcanoArk = this.createElement("div", {
      id: "provider-volcanoark",
    });

    // OpenAI 字段（Responses 新接口）
    sectionOpenAI.appendChild(
      this.createEndpointFormGroup(
        "API 地址 *",
        "openaiApiUrl",
        getPref("openaiApiUrl") as string,
        "https://api.openai.com/v1/responses",
        {
          officialEndpoint: "https://api.openai.com/v1/responses",
          previewKind: "openaiResponses",
        },
      ),
    );
    sectionOpenAI.appendChild(
      this.createFormGroup(
        "API 密钥 *",
        this.createPasswordInput(
          "openaiApiKey",
          getPref("openaiApiKey") as string,
          "sk-...",
          "openai",
        ),
        "【必填】您的 API 密钥,将安全存储在本地。点击 + 添加更多密钥启用轮换。",
        "openai",
      ),
    );
    sectionOpenAI.appendChild(
      this.createModelFormGroup(
        "模型 *",
        "openai",
        "openaiApiModel",
        getPref("openaiApiModel") as string,
        "gpt-5",
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
      this.createEndpointFormGroup(
        "兼容 API 地址 *",
        "openaiCompatApiUrl",
        (getPref("openaiCompatApiUrl") as string) ||
          "https://api.openai.com/v1/chat/completions",
        "https://api.openai.com/v1/chat/completions",
        {
          officialEndpoint: "https://api.openai.com/v1/chat/completions",
          previewKind: "chatCompletions",
        },
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
          "openai-compat",
        ),
        "【必填】对应第三方服务的密钥。点击 + 添加更多密钥启用轮换。",
        "openai-compat",
      ),
    );
    sectionOpenAICompat.appendChild(
      this.createModelFormGroup(
        "兼容模型 *",
        "openai-compat",
        "openaiCompatModel",
        (getPref("openaiCompatModel") as string) ||
          (getPref("openaiApiModel") as string) ||
          "gpt-3.5-turbo",
        "gpt-3.5-turbo",
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
      this.createEndpointFormGroup(
        "API 基础地址 *",
        "geminiApiUrl",
        getPref("geminiApiUrl") as string,
        "https://generativelanguage.googleapis.com",
        {
          officialEndpoint: "https://generativelanguage.googleapis.com",
          previewKind: "geminiStream",
          modelInputId: "geminiModel",
        },
      ),
    );
    sectionGemini.appendChild(
      this.createFormGroup(
        "API 密钥 *",
        this.createPasswordInput(
          "geminiApiKey",
          getPref("geminiApiKey") as string,
          "sk-...",
          "google",
        ),
        "【必填】您的 Gemini API Key。点击 + 添加更多密钥启用轮换。",
        "google",
      ),
    );
    sectionGemini.appendChild(
      this.createModelFormGroup(
        "模型 *",
        "google",
        "geminiModel",
        getPref("geminiModel") as string,
        "gemini-2.5-pro",
        "【必填】Gemini 模型名称, 如 gemini-2.5-pro",
      ),
    );

    // Anthropic 字段
    sectionAnthropic.appendChild(
      this.createEndpointFormGroup(
        "API 基础地址 *",
        "anthropicApiUrl",
        getPref("anthropicApiUrl") as string,
        "https://api.anthropic.com",
        {
          officialEndpoint: "https://api.anthropic.com",
          previewKind: "anthropicMessages",
        },
      ),
    );
    sectionAnthropic.appendChild(
      this.createFormGroup(
        "API 密钥 *",
        this.createPasswordInput(
          "anthropicApiKey",
          getPref("anthropicApiKey") as string,
          "sk-ant-...",
          "anthropic",
        ),
        "【必填】您的 Anthropic API Key。点击 + 添加更多密钥启用轮换。",
        "anthropic",
      ),
    );
    sectionAnthropic.appendChild(
      this.createModelFormGroup(
        "模型 *",
        "anthropic",
        "anthropicModel",
        getPref("anthropicModel") as string,
        "claude-3-5-sonnet-20241022",
        "【必填】Claude 模型名称, 如 claude-3-5-sonnet-20241022",
      ),
    );

    // OpenRouter 字段
    sectionOpenRouter.appendChild(
      this.createEndpointFormGroup(
        "API 基础地址 *",
        "openRouterApiUrl",
        getPref("openRouterApiUrl") as string,
        "https://openrouter.ai/api/v1/chat/completions",
        {
          officialEndpoint: "https://openrouter.ai/api/v1/chat/completions",
          previewKind: "chatCompletions",
        },
      ),
    );
    sectionOpenRouter.appendChild(
      this.createFormGroup(
        "API 密钥 *",
        this.createPasswordInput(
          "openRouterApiKey",
          getPref("openRouterApiKey") as string,
          "sk-or-...",
          "openrouter",
        ),
        "【必填】您的 OpenRouter API Key。点击 + 添加更多密钥启用轮换。",
        "openrouter",
      ),
    );
    sectionOpenRouter.appendChild(
      this.createModelFormGroup(
        "模型 *",
        "openrouter",
        "openRouterModel",
        getPref("openRouterModel") as string,
        "google/gemma-3-27b-it",
        "【必填】OpenRouter 模型名称, 如 google/gemma-3-27b-it",
      ),
    );

    // 火山方舟字段
    sectionVolcanoArk.appendChild(
      this.createEndpointFormGroup(
        "API 地址 *",
        "volcanoArkApiUrl",
        getPref("volcanoArkApiUrl") as string,
        "https://ark.cn-beijing.volces.com/api/v3/responses",
        {
          officialEndpoint:
            "https://ark.cn-beijing.volces.com/api/v3/responses",
          previewKind: "volcanoResponses",
        },
      ),
    );
    sectionVolcanoArk.appendChild(
      this.createFormGroup(
        "API 密钥 *",
        this.createPasswordInput(
          "volcanoArkApiKey",
          getPref("volcanoArkApiKey") as string,
          "ark-...",
          "volcanoark",
        ),
        "【必填】您的火山方舟 API Key。点击 + 添加更多密钥启用轮换。",
        "volcanoark",
      ),
    );
    sectionVolcanoArk.appendChild(
      this.createModelFormGroup(
        "模型 *",
        "volcanoark",
        "volcanoArkModel",
        getPref("volcanoArkModel") as string,
        "doubao-seed-1-8-251228",
        "【必填】豆包大模型名称, 如 doubao-seed-1-8-251228",
      ),
    );
    // 火山方舟说明
    const volcanoArkNote = this.createElement("div", {
      innerHTML:
        "ℹ️ <strong>说明</strong>：火山方舟提供每日 200 万 tokens 免费额度，支持多模态理解。<br/>推荐模型：<code>doubao-seed-1-8-251228</code>、<code>doubao-seed-1-6-250615</code>",
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
    sectionVolcanoArk.appendChild(volcanoArkNote);

    form.appendChild(sectionOpenAI);
    form.appendChild(sectionOpenAICompat);
    form.appendChild(sectionGemini);
    form.appendChild(sectionAnthropic);
    form.appendChild(sectionOpenRouter);
    form.appendChild(sectionVolcanoArk);

    const renderProviderSections = (prov: string) => {
      const isGemini = prov === "google";
      const isAnthropic = prov === "anthropic";
      const isOpenRouter = prov === "openrouter";
      const isOpenAICompat = prov === "openai-compat";
      const isVolcanoArk = prov === "volcanoark";
      (sectionOpenAI as HTMLElement).style.display =
        isGemini ||
        isAnthropic ||
        isOpenAICompat ||
        isOpenRouter ||
        isVolcanoArk
          ? "none"
          : "block";
      (sectionOpenAICompat as HTMLElement).style.display = isOpenAICompat
        ? "block"
        : "none";
      (sectionGemini as HTMLElement).style.display = isGemini
        ? "block"
        : "none";
      (sectionAnthropic as HTMLElement).style.display = isAnthropic
        ? "block"
        : "none";
      (sectionOpenRouter as HTMLElement).style.display = isOpenRouter
        ? "block"
        : "none";
      (sectionVolcanoArk as HTMLElement).style.display = isVolcanoArk
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

    // === API 轮换配置分隔线 ===
    const rotationTitle = this.createElement("h3", {
      textContent: "🔄 API 轮换配置",
      styles: {
        color: "#9c27b0",
        marginTop: "40px",
        marginBottom: "20px",
        fontSize: "18px",
        borderBottom: "2px solid #9c27b0",
        paddingBottom: "8px",
      },
    });
    form.appendChild(rotationTitle);

    // API 轮换说明
    const rotationNote = this.createElement("div", {
      innerHTML:
        "ℹ️ <strong>说明</strong>：配置备用 API 密钥后，当主密钥调用失败时会自动切换到备用密钥继续执行，提高任务成功率。",
      styles: {
        padding: "10px 12px",
        backgroundColor: "#f3e5f5",
        border: "1px solid #ce93d8",
        borderRadius: "6px",
        color: "#6a1b9a",
        fontSize: "13px",
        marginBottom: "16px",
      },
    });
    form.appendChild(rotationNote);

    // 最大切换次数
    form.appendChild(
      this.createFormGroup(
        "最大切换次数",
        this.createInput(
          "maxApiSwitchCount",
          "number",
          (getPref("maxApiSwitchCount" as any) as string) || "3",
          "3",
        ),
        "API 调用失败时最多切换密钥的次数，默认 3 次",
      ),
    );

    // 失败冷却时间
    form.appendChild(
      this.createFormGroup(
        "失败冷却时间(秒)",
        this.createInput(
          "failedKeyCooldownSeconds",
          "number",
          String(
            Math.floor(
              (parseInt(
                (getPref("failedKeyCooldown" as any) as string) || "300000",
              ) || 300000) / 1000,
            ),
          ),
          "300",
        ),
        "失败的密钥需要冷却多久才能再次使用，默认 300 秒 (5分钟)",
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
        { value: "mineru", label: "MinerU (高质量排版还原)" },
      ],
      pdfModeValue,
      (newVal) => {
        // Toggle Mineru API Key visibility
        const mineruSection = this.container.querySelector(
          "#provider-mineru",
        ) as HTMLElement;
        if (mineruSection) {
          mineruSection.style.display = newVal === "mineru" ? "block" : "none";
        }

        // 当用户手动调整 PDF 模式，也给出一个轻量提示
        let msg = "";
        if (newVal === "base64")
          msg = "已选择 Base64 模式：多模态更强，适用于 Gemini 等。";
        else if (newVal === "text")
          msg = "已选择 文本提取 模式：仅文字，适用于 Anthropic 等。";
        else if (newVal === "mineru")
          msg =
            "已选择 MinerU 模式：需要填写 API Key 以启用高级公式/表格还原。";

        try {
          new ztoolkit.ProgressWindow("AI Butler", {
            closeOnClick: true,
            closeTime: 2500,
          })
            .createLine({ text: msg, type: "info" })
            .show();
        } catch (e) {
          try {
            ztoolkit.log("[API Settings] 显示 PDF 模式提示失败:", e);
          } catch (_ignore) {
            // ignore
          }
        }
      },
    );
    form.appendChild(
      this.createFormGroup(
        "PDF 处理模式",
        pdfModeSelect,
        "Base64:原生图片识别; 文本提取:Zotero默认提取; MinerU:调用API实现复杂公式/表格排版的高质量还原",
      ),
    );

    // MinerU 专属配置区域
    const sectionMineru = this.createElement("div", { id: "provider-mineru" });
    sectionMineru.style.display = pdfModeValue === "mineru" ? "block" : "none";

    const mineruInputWrapper = this.createPasswordInput(
      "mineruApiKey",
      (getPref("mineruApiKey") as string) || "",
      "配置以启用高质量公式与表格识别...",
    );

    // 手动绑定保存事件，因为 createPasswordInput 只有存在 providerId 时才自动保存
    const mineruInputEl = mineruInputWrapper.querySelector(
      "input",
    ) as HTMLInputElement;
    if (mineruInputEl) {
      let saveTimeout: ReturnType<typeof setTimeout> | null = null;
      const saveMineruKey = () => {
        setPref("mineruApiKey" as any, mineruInputEl.value.trim());
      };

      mineruInputEl.addEventListener("input", () => {
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(saveMineruKey, 500);
      });

      mineruInputEl.addEventListener("blur", () => {
        if (saveTimeout) clearTimeout(saveTimeout);
        saveMineruKey();
      });
    }

    sectionMineru.appendChild(
      this.createFormGroup(
        "MinerU API Key *",
        mineruInputWrapper,
        "【必填】请访问 https://mineru.net/ 申请 API Key",
      ),
    );
    form.appendChild(sectionMineru);

    // PDF 大小限制设置
    const sizeLimitContainer = this.createElement("div", {
      styles: { display: "flex", alignItems: "center", gap: "12px" },
    });
    const enableSizeLimit = ((getPref("enablePdfSizeLimit" as any) as any) ??
      false) as boolean;
    const sizeLimitToggle = this.createCheckbox(
      "enablePdfSizeLimit",
      enableSizeLimit,
    );
    const maxSizeInput = this.createInput(
      "maxPdfSizeMB",
      "number",
      ((getPref("maxPdfSizeMB" as any) as string) || "50") as string,
      "50",
    );
    // 缩短输入框宽度
    Object.assign(maxSizeInput.style, {
      width: "100px",
      flex: "0 0 100px",
    });
    const mbLabel = this.createElement("span", {
      textContent: "MB",
      styles: { fontSize: "14px", color: "#666" },
    });

    // 控制输入框禁用状态
    setTimeout(() => {
      const inputEl = this.container.querySelector(
        "#setting-maxPdfSizeMB",
      ) as HTMLInputElement;
      const cbEl = sizeLimitToggle.querySelector(
        "#setting-enablePdfSizeLimit",
      ) as HTMLInputElement;
      if (inputEl && cbEl) {
        inputEl.disabled = !cbEl.checked;
        cbEl.addEventListener("change", () => {
          inputEl.disabled = !cbEl.checked;
        });
      }
    }, 0);

    sizeLimitContainer.appendChild(sizeLimitToggle);
    sizeLimitContainer.appendChild(maxSizeInput);
    sizeLimitContainer.appendChild(mbLabel);
    form.appendChild(
      this.createFormGroup(
        "附件大小限制",
        sizeLimitContainer,
        "启用后,超过指定大小的 PDF 文件将在自动扫描时被跳过,避免大型扫描版书籍触发 API 限制",
      ),
    );

    // PDF 附件选择模式
    const pdfAttachmentModeValue =
      (getPref("pdfAttachmentMode" as any) as string) || "default";
    const pdfAttachmentModeSelect = createSelect(
      "pdfAttachmentMode",
      [
        { value: "default", label: "仅默认 PDF (最早添加的附件)" },
        { value: "all", label: "全部 PDF (多文件上传)" },
      ],
      pdfAttachmentModeValue,
      (newVal) => {
        const msg =
          newVal === "all"
            ? "已选择全部 PDF 模式：将同时发送所有附件给大模型"
            : "已选择默认 PDF 模式：仅使用最早添加的附件";
        try {
          new ztoolkit.ProgressWindow("AI Butler", {
            closeOnClick: true,
            closeTime: 2500,
          })
            .createLine({ text: msg, type: "info" })
            .show();
        } catch (e) {
          ztoolkit.log("[API Settings] 显示 PDF 附件模式提示失败:", e);
        }
      },
    );
    form.appendChild(
      this.createFormGroup(
        "多 PDF 附件模式",
        pdfAttachmentModeSelect,
        "当论文有多个 PDF 附件时的处理方式。选择“全部 PDF”时会使用当前 Provider 的多 PDF 上传能力；具体可用性取决于所选模型和服务端是否支持 PDF 输入",
      ),
    );

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
    });
    copyBtn.addEventListener("click", async () => {
      const text = (resultPre.textContent || "").toString();
      const win = Zotero.getMainWindow() as any;
      const doc = win?.document as Document | undefined;
      const nav = (win as any)?.navigator as any;
      try {
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
    buttonContainer.appendChild(copyBtn);
    resultTitle.appendChild(resultTitleText);
    resultTitle.appendChild(buttonContainer);
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
    description?: string | HTMLElement,
    providerId?: ProviderId,
    labelAction?: HTMLElement,
  ): HTMLElement {
    const group = this.createElement("div", {
      styles: {
        marginBottom: "24px",
      },
    });

    // 标签行：包含标签和可选的密钥数量徽标
    const labelRow = this.createElement("div", {
      styles: {
        display: "flex",
        alignItems: "center",
        gap: "10px",
        marginBottom: "8px",
        width: "100%",
      },
    });

    const labelElement = this.createElement("label", {
      textContent: label,
      styles: {
        fontSize: "14px",
        fontWeight: "600",
        color: "#333",
      },
    });
    labelRow.appendChild(labelElement);

    // 密钥数量徽标（仅当 providerId 存在时显示）
    if (providerId) {
      const badge = this.createElement("span", {
        styles: {
          padding: "3px 8px",
          backgroundColor: "#e3f2fd",
          color: "#1565c0",
          borderRadius: "10px",
          fontSize: "11px",
          fontWeight: "500",
        },
      });
      badge.setAttribute("data-key-badge", providerId);
      this.updateKeyBadge(badge, providerId);
      labelRow.appendChild(badge);
    }

    if (labelAction) {
      Object.assign(labelAction.style, {
        marginLeft: "auto",
      });
      labelRow.appendChild(labelAction);
    }

    group.appendChild(labelRow);
    group.appendChild(input);

    if (description) {
      if (typeof description === "string") {
        const desc = this.createElement("div", {
          textContent: description,
          styles: {
            marginTop: "6px",
            fontSize: "12px",
            color: "#666",
          },
        });
        group.appendChild(desc);
      } else {
        group.appendChild(description);
      }
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

  private createEndpointFormGroup(
    label: string,
    id: string,
    value: string,
    placeholder: string,
    options: {
      officialEndpoint: string;
      previewKind:
        | "openaiResponses"
        | "chatCompletions"
        | "geminiStream"
        | "anthropicMessages"
        | "volcanoResponses";
      modelInputId?: string;
    },
  ): HTMLElement {
    const input = this.createInput(id, "text", value, placeholder);
    const official = this.createEndpointMeta(
      `官方 Endpoint：${options.officialEndpoint}`,
    );
    const preview = this.createEndpointMeta("预览：");
    preview.style.maxWidth = "440px";

    const desc = this.createElement("div", {
      styles: {
        marginTop: "6px",
        display: "flex",
        alignItems: "center",
        gap: "6px",
        fontSize: "12px",
        color: "#666",
      },
    });
    desc.appendChild(
      this.createElement("span", {
        textContent: "【必填】",
        styles: {
          flex: "0 0 auto",
        },
      }),
    );
    desc.appendChild(preview);

    const update = () => {
      const endpoint = this.buildEndpointPreview(
        options.previewKind,
        id,
        placeholder,
        options.modelInputId,
      );
      preview.textContent = `预览：${endpoint}`;
      preview.title = endpoint;
    };

    input.addEventListener("input", update);
    input.addEventListener("change", update);
    this.endpointPreviewUpdaters.push(update);

    setTimeout(() => {
      if (options.modelInputId) {
        const modelInput = this.container.querySelector(
          `#setting-${options.modelInputId}`,
        ) as HTMLInputElement | null;
        modelInput?.addEventListener("input", update);
        modelInput?.addEventListener("change", update);
      }
      update();
    }, 0);

    return this.createFormGroup(label, input, desc, undefined, official);
  }

  private createEndpointMeta(text: string): HTMLElement {
    const el = this.createElement("span", {
      textContent: text,
      styles: {
        display: "block",
        minWidth: "0",
        maxWidth: "520px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontSize: "12px",
        color: "#666",
      },
    });
    el.title = text.replace(/^官方 Endpoint：|^预览：/, "");
    return el;
  }

  private refreshEndpointPreviews(): void {
    setTimeout(() => {
      this.endpointPreviewUpdaters.forEach((update) => update());
    }, 0);
  }

  private buildEndpointPreview(
    kind:
      | "openaiResponses"
      | "chatCompletions"
      | "geminiStream"
      | "anthropicMessages"
      | "volcanoResponses",
    urlInputId: string,
    fallbackUrl: string,
    modelInputId?: string,
  ): string {
    const input = this.container.querySelector(
      `#setting-${urlInputId}`,
    ) as HTMLInputElement | null;
    const rawUrl = (input?.value || fallbackUrl || "").trim();
    const modelInput = modelInputId
      ? (this.container.querySelector(
          `#setting-${modelInputId}`,
        ) as HTMLInputElement | null)
      : null;
    const model = (modelInput?.value || modelInput?.placeholder || "{模型}")
      .trim()
      .replace(/^models\//, "");

    if (kind === "openaiResponses") {
      return this.toResponsesEndpoint(rawUrl, "/v1");
    }
    if (kind === "chatCompletions") {
      return this.toChatCompletionsEndpoint(rawUrl);
    }
    if (kind === "geminiStream") {
      const base = rawUrl
        .replace(/\/+$/, "")
        .replace(/\/v1beta(?:\/.*)?$/i, "");
      return `${base}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
    }
    if (kind === "anthropicMessages") {
      const base = rawUrl.replace(/\/+$/, "").replace(/\/v1(?:\/.*)?$/i, "");
      return `${base}/v1/messages`;
    }
    return this.toResponsesEndpoint(rawUrl, "");
  }

  private toResponsesEndpoint(url: string, defaultVersionPath: string): string {
    const raw = url.trim().replace(/\/+$/, "");
    if (!raw) return "";
    if (/\/responses$/i.test(raw)) return raw;
    if (/\/v\d+(?:beta)?$/i.test(raw)) return `${raw}/responses`;
    if (/\/v\d+(?:beta)?\/.+$/i.test(raw)) {
      return raw.replace(/(\/v\d+(?:beta)?)(?:\/.*)?$/i, "$1/responses");
    }
    return `${raw}${defaultVersionPath}/responses`;
  }

  private toChatCompletionsEndpoint(url: string): string {
    const raw = url.trim().replace(/\/+$/, "");
    if (!raw) return "";
    if (/\/(?:v\d+(?:beta)?\/)?chat\/completions$/i.test(raw)) return raw;
    if (/\/v\d+(?:beta)?$/i.test(raw)) return `${raw}/chat/completions`;
    if (/\/v\d+(?:beta)?\/.+$/i.test(raw)) {
      return raw.replace(/(\/v\d+(?:beta)?)(?:\/.*)?$/i, "$1/chat/completions");
    }
    return `${raw}/v1/chat/completions`;
  }

  private createModelFormGroup(
    label: string,
    providerId: ProviderId,
    modelInputId: string,
    value: string,
    placeholder: string,
    description?: string,
  ): HTMLElement {
    const picker = this.createModelPicker(
      providerId,
      modelInputId,
      value,
      placeholder,
    );
    return this.createFormGroup(
      label,
      picker.body,
      description,
      undefined,
      picker.action,
    );
  }

  /**
   * 创建模型输入控件：保留手动输入，获取列表后在输入框内显示下拉触发器。
   */
  private createModelPicker(
    providerId: ProviderId,
    modelInputId: string,
    value: string,
    placeholder?: string,
  ): { body: HTMLElement; action: HTMLElement } {
    const doc = Zotero.getMainWindow().document;
    const wrapper = this.createElement("div", {
      styles: {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
      },
    });

    const inputShell = this.createElement("div", {
      styles: {
        position: "relative",
        width: "100%",
        display: "flex",
        alignItems: "stretch",
      },
    });

    const input = this.createInput(modelInputId, "text", value, placeholder);
    Object.assign(input.style, {
      flex: "1 1 auto",
      minWidth: "0",
      borderRight: "0",
      borderRadius: "4px 0 0 4px",
    });

    const toggleButton = this.createElement("button", {
      textContent: "▼",
      styles: {
        flex: "0 0 38px",
        width: "38px",
        border: "1px solid #ddd",
        borderRadius: "0 4px 4px 0",
        backgroundColor: "#f8f9fa",
        color: "#666",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "11px",
        lineHeight: "1",
      },
    }) as HTMLButtonElement;
    toggleButton.title = "选择模型；如未获取列表，将自动获取";

    const dropdown = this.createElement("div", {
      id: `setting-${modelInputId}-modelDropdown`,
      styles: {
        position: "absolute",
        top: "100%",
        left: "0",
        right: "0",
        marginTop: "4px",
        maxHeight: "260px",
        overflowY: "auto",
        backgroundColor: "#fff",
        border: "1px solid #ddd",
        borderRadius: "4px",
        boxShadow: "0 8px 20px rgba(0,0,0,0.14)",
        zIndex: "1500",
        display: "none",
      },
    });

    const status = this.createElement("div", {
      styles: {
        display: "none",
        fontSize: "12px",
        lineHeight: "1.4",
        whiteSpace: "nowrap",
        maxWidth: "220px",
        overflow: "hidden",
        textOverflow: "ellipsis",
      },
    });

    const closeDropdown = () => {
      dropdown.style.display = "none";
      toggleButton.textContent = "▼";
    };

    const openDropdown = () => {
      dropdown.style.display = "block";
      toggleButton.textContent = "▲";
    };

    toggleButton.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (dropdown.style.display === "block") {
        closeDropdown();
        return;
      }

      if (dropdown.getAttribute("data-loaded") !== "true") {
        const ok = await this.fetchAndRenderModelList(
          providerId,
          modelInputId,
          input,
          dropdown,
          toggleButton,
          status,
          fetchButton,
          true,
        );
        if (!ok) return;
      }

      openDropdown();
    });

    inputShell.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    doc.addEventListener("click", closeDropdown);
    wrapper.addEventListener(
      "DOMNodeRemoved",
      () => doc.removeEventListener("click", closeDropdown),
      { once: true },
    );

    inputShell.appendChild(input);
    inputShell.appendChild(toggleButton);
    inputShell.appendChild(dropdown);
    wrapper.appendChild(inputShell);

    const fetchButton = createStyledButton(
      "🔄 获取模型列表",
      "#59c0bc",
      "small",
    );
    fetchButton.title = "使用当前填写的 endpoint 和密钥获取模型列表";
    Object.assign(fetchButton.style, {
      minHeight: "30px",
      padding: "6px 12px",
      fontSize: "12px",
    });
    fetchButton.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await this.fetchAndRenderModelList(
        providerId,
        modelInputId,
        input,
        dropdown,
        toggleButton,
        status,
        fetchButton,
        false,
      );
    });

    const actionGroup = this.createElement("div", {
      styles: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        marginLeft: "auto",
        minWidth: "0",
      },
    });
    actionGroup.appendChild(status);
    actionGroup.appendChild(fetchButton);

    return { body: wrapper, action: actionGroup };
  }

  private async fetchAndRenderModelList(
    providerId: ProviderId,
    modelInputId: string,
    input: HTMLInputElement,
    dropdown: HTMLElement,
    toggleButton: HTMLButtonElement,
    status: HTMLElement,
    button: HTMLButtonElement,
    openAfterSuccess = false,
  ): Promise<boolean> {
    const previousText = button.textContent || "🔄 获取模型列表";
    button.disabled = true;
    toggleButton.disabled = true;
    button.textContent = "🔄 获取中...";
    button.style.opacity = "0.75";
    button.style.cursor = "wait";
    toggleButton.style.opacity = "0.75";
    toggleButton.style.cursor = "wait";
    status.style.display = "block";
    status.style.color = "#666";
    status.textContent = "正在从供应商获取模型列表...";

    try {
      const options = this.getModelListOptions(providerId);
      if (!options.apiUrl?.trim()) throw new Error("请先填写 API 地址");
      if (!options.apiKey?.trim()) throw new Error("请先填写 API 密钥");

      const models = await LLMClient.listModels(providerId, options);
      if (models.length === 0) {
        throw new Error("供应商未返回可用模型");
      }

      this.renderFetchedModelDropdown(modelInputId, input, dropdown, models);
      dropdown.setAttribute("data-loaded", "true");
      dropdown.style.display = openAfterSuccess ? "block" : "none";
      toggleButton.textContent = openAfterSuccess ? "▲" : "▼";
      status.style.color = "#2e7d32";
      status.textContent = `已获取 ${models.length} 个模型`;

      new ztoolkit.ProgressWindow("模型列表", {
        closeTime: 1800,
      })
        .createLine({
          text: `✅ 已获取 ${models.length} 个模型`,
          type: "success",
        })
        .show();
      return true;
    } catch (error: any) {
      const message = error?.message || String(error);
      dropdown.setAttribute("data-loaded", "false");
      dropdown.style.display = "none";
      toggleButton.textContent = "▼";
      status.style.display = "block";
      status.style.color = "#b71c1c";
      status.textContent = `获取失败：${message}`;

      new ztoolkit.ProgressWindow("模型列表", {
        closeTime: 3500,
      })
        .createLine({ text: `❌ ${message}`, type: "fail" })
        .show();
      return false;
    } finally {
      button.disabled = false;
      toggleButton.disabled = false;
      button.textContent = previousText;
      button.style.opacity = "1";
      button.style.cursor = "pointer";
      toggleButton.style.opacity = "1";
      toggleButton.style.cursor = "pointer";
    }
  }

  private renderFetchedModelDropdown(
    modelInputId: string,
    input: HTMLInputElement,
    dropdown: HTMLElement,
    models: LLMModelInfo[],
  ): void {
    dropdown.innerHTML = "";

    models.forEach((model) => {
      const label = this.formatModelOptionLabel(model);
      const item = this.createElement("div", {
        textContent: label,
        styles: {
          padding: "9px 12px",
          cursor: "pointer",
          fontSize: "13px",
          color: "#333",
          backgroundColor: input.value.trim() === model.id ? "#e8f5f4" : "#fff",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        },
      });
      item.title = label;
      item.setAttribute("data-model-id", model.id);

      item.addEventListener("mouseenter", () => {
        item.style.backgroundColor = "#f0f7f7";
      });
      item.addEventListener("mouseleave", () => {
        item.style.backgroundColor =
          input.value.trim() === model.id ? "#e8f5f4" : "#fff";
      });
      item.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.applyModelSelection(modelInputId, input, model.id);
        dropdown.querySelectorAll("[data-model-id]").forEach((el: Element) => {
          const row = el as HTMLElement;
          row.style.backgroundColor =
            row.getAttribute("data-model-id") === model.id ? "#e8f5f4" : "#fff";
        });
        dropdown.style.display = "none";
        const toggleButton = dropdown.parentElement?.querySelector(
          "button",
        ) as HTMLButtonElement | null;
        if (toggleButton) toggleButton.textContent = "▼";
      });

      dropdown.appendChild(item);
    });
  }

  private applyModelSelection(
    modelInputId: string,
    input: HTMLInputElement,
    modelId: string,
  ): void {
    input.value = modelId;
    setPref(modelInputId as any, modelId);

    try {
      const win = Zotero.getMainWindow();
      input.dispatchEvent(new win.Event("input", { bubbles: true }));
      input.dispatchEvent(new win.Event("change", { bubbles: true }));
    } catch {
      // best effort: the value and pref have already been updated
    }
  }

  private formatModelOptionLabel(model: LLMModelInfo): string {
    const parts = [model.id];
    if (model.name && model.name !== model.id) parts.push(model.name);
    if (model.contextLength) {
      parts.push(`${model.contextLength.toLocaleString()} ctx`);
    }
    return parts.join(" · ");
  }

  private getModelListOptions(providerId: ProviderId): Partial<LLMOptions> {
    const readInput = (id: string) =>
      (
        this.container.querySelector(
          `#setting-${id}`,
        ) as HTMLInputElement | null
      )?.value?.trim() || "";

    const timeout = Math.max(
      parseInt(readInput("requestTimeout") || "30000", 10) || 30000,
      30000,
    );
    const keyManagerId = this.mapToKeyManagerId(providerId);

    const configs: Record<
      ProviderId,
      { apiUrlId: string; apiKeyId: string; modelId: string }
    > = {
      openai: {
        apiUrlId: "openaiApiUrl",
        apiKeyId: "openaiApiKey",
        modelId: "openaiApiModel",
      },
      "openai-compat": {
        apiUrlId: "openaiCompatApiUrl",
        apiKeyId: "openaiCompatApiKey",
        modelId: "openaiCompatModel",
      },
      google: {
        apiUrlId: "geminiApiUrl",
        apiKeyId: "geminiApiKey",
        modelId: "geminiModel",
      },
      anthropic: {
        apiUrlId: "anthropicApiUrl",
        apiKeyId: "anthropicApiKey",
        modelId: "anthropicModel",
      },
      openrouter: {
        apiUrlId: "openRouterApiUrl",
        apiKeyId: "openRouterApiKey",
        modelId: "openRouterModel",
      },
      volcanoark: {
        apiUrlId: "volcanoArkApiUrl",
        apiKeyId: "volcanoArkApiKey",
        modelId: "volcanoArkModel",
      },
    };
    const config = configs[keyManagerId];

    return {
      apiUrl: readInput(config.apiUrlId),
      apiKey:
        readInput(config.apiKeyId) || ApiKeyManager.getCurrentKey(keyManagerId),
      model: readInput(config.modelId),
      requestTimeoutMs: timeout,
    };
  }

  /**
   * 创建密码输入框（支持多密钥管理）
   *
   * @param id 输入框ID
   * @param value 当前值
   * @param placeholder 占位符
   * @param providerId 可选的提供商ID，用于多密钥管理
   */
  private createPasswordInput(
    id: string,
    value: string,
    placeholder?: string,
    providerId?: ProviderId,
  ): HTMLElement {
    const wrapper = this.createElement("div", {
      styles: {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
      },
    });
    if (providerId) {
      wrapper.setAttribute("data-key-wrapper", providerId);
    }

    // 第一行：状态 + 密钥1 + 输入框 + 按钮
    const container = this.createElement("div", {
      styles: {
        display: "flex",
        gap: "8px",
        alignItems: "center",
      },
    });

    // 状态指示器（放最前面，可点击禁用/启用）
    if (providerId) {
      const keyIndex = 0;
      const isDisabled = ApiKeyManager.isKeyDisabled(providerId, keyIndex);
      const hasValue = !!value?.trim();
      const statusIcon = this.createElement("span", {
        textContent: "●",
        styles: {
          color: isDisabled ? "#9e9e9e" : hasValue ? "#4caf50" : "#bbb",
          fontSize: "14px",
          lineHeight: "1",
          cursor: "pointer",
        },
      });
      const getTooltip = (disabled: boolean, configured: boolean) => {
        const status = disabled ? "已禁用" : configured ? "已配置" : "未配置";
        const action = disabled ? "点击启用" : "点击禁用";
        return `${status} | ${action}`;
      };
      statusIcon.title = getTooltip(isDisabled, hasValue);
      statusIcon.setAttribute("data-key-status", `${providerId}-${keyIndex}`);
      statusIcon.addEventListener("click", () => {
        const nowDisabled = ApiKeyManager.toggleKeyDisabled(
          providerId,
          keyIndex,
        );
        statusIcon.style.color = nowDisabled
          ? "#9e9e9e"
          : hasValue
            ? "#4caf50"
            : "#bbb";
        statusIcon.title = getTooltip(nowDisabled, hasValue);
        this.updateAllKeyBadges(providerId);
      });
      container.appendChild(statusIcon);
    }

    // 密钥1标签
    if (providerId) {
      const keyLabel = this.createElement("span", {
        textContent: "密钥1",
        styles: {
          fontSize: "12px",
          color: "#666",
          whiteSpace: "nowrap",
        },
      });
      container.appendChild(keyLabel);
    }

    // 输入框
    const input = this.createInput(id, "password", value, placeholder);
    input.style.flex = "1";

    // 自动保存第一个密钥（与额外密钥行为一致）
    if (providerId) {
      const mapping: Record<ProviderId, string> = {
        openai: "openaiApiKey",
        "openai-compat": "openaiCompatApiKey",
        google: "geminiApiKey",
        anthropic: "anthropicApiKey",
        openrouter: "openRouterApiKey",
        volcanoark: "volcanoArkApiKey",
      };
      const prefKey = mapping[providerId];
      if (prefKey) {
        let saveTimeout: ReturnType<typeof setTimeout> | null = null;
        const saveFirstKey = () => {
          const newKey = input.value?.trim() || "";
          setPref(prefKey as any, newKey);
          // 更新状态指示器
          const statusIconEl = container.querySelector(
            "[data-key-status]",
          ) as HTMLElement | null;
          if (statusIconEl) {
            const isDisabled = ApiKeyManager.isKeyDisabled(providerId, 0);
            statusIconEl.style.color = isDisabled
              ? "#9e9e9e"
              : newKey
                ? "#4caf50"
                : "#bbb";
          }
          this.updateAllKeyBadges(providerId);
          ztoolkit.log(`[ApiSettingsPage] 自动保存密钥1: ${prefKey}`);
        };
        input.addEventListener("input", () => {
          if (saveTimeout) clearTimeout(saveTimeout);
          saveTimeout = setTimeout(saveFirstKey, 500);
        });
        input.addEventListener("blur", () => {
          if (saveTimeout) clearTimeout(saveTimeout);
          saveFirstKey();
        });
      }
    }

    container.appendChild(input);

    // 显示/隐藏按钮
    const toggleButton = this.createElement("button", {
      textContent: "👁️",
      styles: {
        padding: "8px 12px",
        border: "1px solid #ddd",
        borderRadius: "4px",
        backgroundColor: "#f5f5f5",
        cursor: "pointer",
        fontSize: "14px",
        lineHeight: "1",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      },
    });
    toggleButton.title = "显示/隐藏密钥";

    let isVisible = false;
    toggleButton.addEventListener("click", (e) => {
      e.preventDefault();
      isVisible = !isVisible;
      input.type = isVisible ? "text" : "password";
      toggleButton.textContent = isVisible ? "🙈" : "👁️";
    });
    container.appendChild(toggleButton);

    // 添加密钥按钮
    if (providerId) {
      const addButton = this.createElement("button", {
        textContent: "+",
        styles: {
          padding: "8px 12px",
          border: "1px solid #4caf50",
          borderRadius: "4px",
          backgroundColor: "#e8f5e9",
          color: "#2e7d32",
          cursor: "pointer",
          fontSize: "14px",
          fontWeight: "bold",
          lineHeight: "1",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        },
      });
      addButton.title = "添加更多密钥";

      addButton.addEventListener("mouseenter", () => {
        addButton.style.backgroundColor = "#4caf50";
        addButton.style.color = "#fff";
      });
      addButton.addEventListener("mouseleave", () => {
        addButton.style.backgroundColor = "#e8f5e9";
        addButton.style.color = "#2e7d32";
      });

      addButton.addEventListener("click", (e) => {
        e.preventDefault();
        this.addExtraKeyField(wrapper, providerId);
        this.updateAllKeyBadges(providerId);
      });

      container.appendChild(addButton);
    }

    wrapper.appendChild(container);

    // 渲染已有的额外密钥
    if (providerId) {
      const extraKeys = ApiKeyManager.getExtraKeys(providerId);
      for (let i = 0; i < extraKeys.length; i++) {
        this.renderExtraKeyField(wrapper, providerId, i, extraKeys[i]);
      }
    }

    return wrapper;
  }

  /**
   * 更新密钥数量徽标
   */
  private updateKeyBadge(badge: HTMLElement, providerId: ProviderId): void {
    const allKeys = ApiKeyManager.getAllKeys(providerId);
    const total = allKeys.length;
    const valid = allKeys.filter((k) => k?.trim()).length;
    const disabled = ApiKeyManager.getDisabledCount(providerId);
    if (disabled > 0) {
      badge.textContent = `共 ${total} 个，${valid} 有效，${disabled} 禁用`;
    } else {
      badge.textContent = `共 ${total} 个密钥，${valid} 个有效`;
    }
  }

  /**
   * 更新所有徽标（删除或添加密钥后调用）
   */
  private updateAllKeyBadges(providerId: ProviderId): void {
    const badges = this.container.querySelectorAll(
      `[data-key-badge="${providerId}"]`,
    );
    badges.forEach((badge: Element) => {
      this.updateKeyBadge(badge as HTMLElement, providerId);
    });
  }

  /**
   * 添加额外密钥输入框
   */
  private addExtraKeyField(wrapper: HTMLElement, providerId: ProviderId): void {
    const extraKeys = ApiKeyManager.getExtraKeys(providerId);
    const index = extraKeys.length;

    // 先保存一个空占位符
    extraKeys.push("");
    ApiKeyManager.saveExtraKeys(providerId, extraKeys);

    // 创建新的空输入框
    this.renderExtraKeyField(wrapper, providerId, index, "");
  }

  /**
   * 渲染额外密钥输入框（自动保存）
   */
  private renderExtraKeyField(
    wrapper: HTMLElement,
    providerId: ProviderId,
    index: number,
    value: string,
  ): void {
    const container = this.createElement("div", {
      styles: {
        display: "flex",
        gap: "8px",
        alignItems: "center",
      },
    });
    container.setAttribute("data-extra-key-index", String(index));
    container.setAttribute("data-provider-id", providerId);

    // 状态指示器（放最前面，可点击禁用/启用）
    const keyIndex = index + 1; // 额外密钥从索引1开始
    const isDisabled = ApiKeyManager.isKeyDisabled(providerId, keyIndex);
    const hasValue = !!value?.trim();
    const statusIcon = this.createElement("span", {
      textContent: "●",
      styles: {
        color: isDisabled ? "#9e9e9e" : hasValue ? "#4caf50" : "#bbb",
        fontSize: "14px",
        lineHeight: "1",
        cursor: "pointer",
      },
    });
    const getTooltip = (disabled: boolean, configured: boolean) => {
      const status = disabled ? "已禁用" : configured ? "已配置" : "未配置";
      const action = disabled ? "点击启用" : "点击禁用";
      return `${status} | ${action}`;
    };
    statusIcon.title = getTooltip(isDisabled, hasValue);
    statusIcon.setAttribute("data-key-status", `${providerId}-${keyIndex}`);
    statusIcon.addEventListener("click", () => {
      const nowDisabled = ApiKeyManager.toggleKeyDisabled(providerId, keyIndex);
      statusIcon.style.color = nowDisabled
        ? "#9e9e9e"
        : hasValue
          ? "#4caf50"
          : "#bbb";
      statusIcon.title = getTooltip(nowDisabled, hasValue);
      this.updateAllKeyBadges(providerId);
    });
    container.appendChild(statusIcon);

    // 密钥标签
    const label = this.createElement("span", {
      textContent: `密钥${index + 2}`,
      styles: {
        fontSize: "12px",
        color: "#666",
        whiteSpace: "nowrap",
      },
    });
    container.appendChild(label);

    // 密码输入框
    const input = this.createInput(
      `${providerId}-extraKey-${index}`,
      "password",
      value,
      "sk-...",
    );
    input.style.flex = "1";

    // 自动保存（输入时延迟保存）
    let saveTimeout: ReturnType<typeof setTimeout> | null = null;
    const saveKey = () => {
      const newKey = input.value?.trim() || "";
      const extraKeys = ApiKeyManager.getExtraKeys(providerId);
      const currentIdx = parseInt(
        container.getAttribute("data-extra-key-index") || "0",
      );
      // 确保数组足够大以容纳当前索引
      while (extraKeys.length <= currentIdx) {
        extraKeys.push("");
      }
      extraKeys[currentIdx] = newKey;
      ApiKeyManager.saveExtraKeys(providerId, extraKeys);
      // 更新状态图标
      const statusIconEl = container.querySelector(
        "[data-key-status]",
      ) as HTMLElement;
      if (statusIconEl) {
        statusIconEl.style.color = newKey ? "#4caf50" : "#bbb";
        statusIconEl.title = newKey ? "已配置" : "未配置";
      }
      // 更新徽标
      this.updateAllKeyBadges(providerId);
    };

    input.addEventListener("input", () => {
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = setTimeout(saveKey, 500);
    });
    input.addEventListener("blur", () => {
      if (saveTimeout) clearTimeout(saveTimeout);
      saveKey();
    });

    container.appendChild(input);

    // 显示/隐藏按钮
    const toggleBtn = this.createElement("button", {
      textContent: "👁️",
      styles: {
        padding: "8px 12px",
        border: "1px solid #ddd",
        borderRadius: "4px",
        backgroundColor: "#f5f5f5",
        cursor: "pointer",
        fontSize: "14px",
        lineHeight: "1",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      },
    });
    toggleBtn.title = "显示/隐藏";
    let isVisible = false;
    toggleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      isVisible = !isVisible;
      input.type = isVisible ? "text" : "password";
      toggleBtn.textContent = isVisible ? "🙈" : "👁️";
    });
    container.appendChild(toggleBtn);

    // 删除按钮
    const deleteBtn = this.createElement("button", {
      textContent: "×",
      styles: {
        padding: "8px 12px",
        border: "1px solid #f44336",
        borderRadius: "4px",
        backgroundColor: "#ffebee",
        color: "#c62828",
        cursor: "pointer",
        fontSize: "14px",
        fontWeight: "bold",
        lineHeight: "1",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      },
    });
    deleteBtn.title = "删除此密钥";
    deleteBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const currentIdx = parseInt(
        container.getAttribute("data-extra-key-index") || "0",
      );
      ApiKeyManager.removeExtraKey(providerId, currentIdx);
      container.remove();
      this.refreshExtraKeyIndices(wrapper, providerId);
      this.updateAllKeyBadges(providerId);
    });
    container.appendChild(deleteBtn);

    wrapper.appendChild(container);
  }

  /**
   * 刷新额外密钥的索引显示
   */
  private refreshExtraKeyIndices(
    wrapper: HTMLElement,
    providerId: ProviderId,
  ): void {
    const containers = wrapper.querySelectorAll(
      `[data-provider-id="${providerId}"]`,
    );
    containers.forEach((container: Element, idx: number) => {
      container.setAttribute("data-extra-key-index", String(idx));
      const label = container.querySelector("span:first-child") as HTMLElement;
      if (label && !label.hasAttribute("data-key-status")) {
        label.textContent = `密钥 ${idx + 2}:`;
      }
      // 更新状态指示器的ID
      const statusIcon = container.querySelector("[data-key-status]");
      if (statusIcon) {
        statusIcon.setAttribute("data-key-status", `${providerId}-${idx + 1}`);
      }
    });
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
      // OpenRouter
      const orUrlEl = this.container.querySelector(
        "#setting-openRouterApiUrl",
      ) as HTMLInputElement;
      const orKeyEl = this.container.querySelector(
        "#setting-openRouterApiKey",
      ) as HTMLInputElement;
      const orModelEl = this.container.querySelector(
        "#setting-openRouterModel",
      ) as HTMLInputElement;
      // Volcano Ark (火山方舟)
      const vaUrlEl = this.container.querySelector(
        "#setting-volcanoArkApiUrl",
      ) as HTMLInputElement;
      const vaKeyEl = this.container.querySelector(
        "#setting-volcanoArkApiKey",
      ) as HTMLInputElement;
      const vaModelEl = this.container.querySelector(
        "#setting-volcanoArkModel",
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
        openRouterApiUrl: orUrlEl?.value?.trim() || "",
        openRouterApiKey: orKeyEl?.value?.trim() || "",
        openRouterModel: orModelEl?.value?.trim() || "",
        volcanoArkApiUrl: vaUrlEl?.value?.trim() || "",
        volcanoArkApiKey: vaKeyEl?.value?.trim() || "",
        volcanoArkModel: vaModelEl?.value?.trim() || "",
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
      } else if (provider === "openrouter") {
        if (!values.openRouterApiUrl)
          missingFields.push("API 基础地址(OpenRouter)");
        if (!values.openRouterApiKey)
          missingFields.push("API 密钥(OpenRouter)");
        if (!values.openRouterModel) missingFields.push("模型名称(OpenRouter)");
      } else if (provider === "volcanoark") {
        if (!values.volcanoArkApiUrl) missingFields.push("API 地址(火山方舟)");
        if (!values.volcanoArkApiKey) missingFields.push("API 密钥(火山方舟)");
        if (!values.volcanoArkModel) missingFields.push("模型名称(火山方舟)");
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
      setPref("openRouterApiUrl", values.openRouterApiUrl);
      setPref("openRouterApiKey", values.openRouterApiKey);
      setPref("openRouterModel", values.openRouterModel);
      setPref("volcanoArkApiUrl", values.volcanoArkApiUrl);
      setPref("volcanoArkApiKey", values.volcanoArkApiKey);
      setPref("volcanoArkModel", values.volcanoArkModel);
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

      // API 轮换配置
      const maxSwitchEl = this.container.querySelector(
        "#setting-maxApiSwitchCount",
      ) as HTMLInputElement | null;
      const cooldownSecsEl = this.container.querySelector(
        "#setting-failedKeyCooldownSeconds",
      ) as HTMLInputElement | null;
      if (maxSwitchEl) {
        setPref("maxApiSwitchCount" as any, maxSwitchEl.value?.trim() || "3");
      }
      if (cooldownSecsEl) {
        const secs = parseInt(cooldownSecsEl.value?.trim() || "300") || 300;
        setPref("failedKeyCooldown" as any, String(secs * 1000));
      }

      // PDF 大小限制配置
      const enableSizeLimitEl = this.container.querySelector(
        "#setting-enablePdfSizeLimit",
      ) as HTMLInputElement | null;
      const maxPdfSizeEl = this.container.querySelector(
        "#setting-maxPdfSizeMB",
      ) as HTMLInputElement | null;
      if (enableSizeLimitEl) {
        setPref("enablePdfSizeLimit" as any, enableSizeLimitEl.checked);
      }
      if (maxPdfSizeEl) {
        setPref("maxPdfSizeMB" as any, maxPdfSizeEl.value?.trim() || "50");
      }

      // PDF 附件选择模式
      const pdfAttachmentModeEl = this.container.querySelector(
        "#setting-pdfAttachmentMode",
      ) as HTMLElement | null;
      if (pdfAttachmentModeEl && (pdfAttachmentModeEl as any).getValue) {
        setPref(
          "pdfAttachmentMode" as any,
          (pdfAttachmentModeEl as any).getValue() || "default",
        );
      }

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
    // 获取当前提供商和密钥
    const provider = (getPref("provider") as string) || "openai";
    const keyManagerId = this.mapToKeyManagerId(provider);
    const allKeys = ApiKeyManager.getAllKeys(keyManagerId);

    // 如果有多个密钥，让用户选择
    if (allKeys.length > 1) {
      this.showKeySelectionPopup(keyManagerId, allKeys);
      return;
    }

    // 只有一个密钥，直接测试
    await this.runTestConnection();
  }

  /**
   * 映射提供商ID到KeyManagerId
   */
  private mapToKeyManagerId(provider: string): ProviderId {
    if (provider === "google") return "google";
    if (provider === "anthropic") return "anthropic";
    if (provider === "openrouter") return "openrouter";
    if (provider === "openai-compat") return "openai-compat";
    if (provider === "volcanoark") return "volcanoark";
    return "openai";
  }

  /**
   * 显示密钥选择弹窗
   */
  private showKeySelectionPopup(providerId: ProviderId, keys: string[]): void {
    // 创建遮罩层（固定定位，覆盖整个视口）
    const overlay = this.createElement("div", {
      styles: {
        position: "fixed",
        top: "0",
        left: "0",
        width: "100vw",
        height: "100vh",
        backgroundColor: "rgba(0,0,0,0.5)",
        zIndex: "10000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      },
    });

    // 弹窗容器
    const popup = this.createElement("div", {
      styles: {
        backgroundColor: "#fff",
        borderRadius: "8px",
        padding: "20px",
        minWidth: "320px",
        maxWidth: "420px",
        boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
      },
    });

    // 标题
    const title = this.createElement("div", {
      textContent: "选择要测试的密钥",
      styles: {
        fontSize: "16px",
        fontWeight: "600",
        marginBottom: "16px",
        color: "#333",
      },
    });
    popup.appendChild(title);

    // 密钥列表
    keys.forEach((key, index) => {
      const btn = this.createElement("button", {
        textContent: `密钥 ${index + 1}: ${ApiKeyManager.maskKey(key)}`,
        styles: {
          display: "block",
          width: "100%",
          padding: "12px 14px",
          marginBottom: "8px",
          border: "1px solid #ddd",
          borderRadius: "6px",
          backgroundColor: "#f8f9fa",
          cursor: "pointer",
          fontSize: "14px",
          textAlign: "left",
        },
      });
      btn.addEventListener("mouseenter", () => {
        btn.style.backgroundColor = "#e3f2fd";
        btn.style.borderColor = "#2196f3";
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.backgroundColor = "#f8f9fa";
        btn.style.borderColor = "#ddd";
      });
      btn.addEventListener("click", async () => {
        overlay.remove();
        await this.runTestConnectionWithKey(key, index);
      });
      popup.appendChild(btn);
    });

    // 取消按钮
    const cancelBtn = this.createElement("button", {
      textContent: "取消",
      styles: {
        display: "block",
        width: "100%",
        padding: "12px 14px",
        marginTop: "8px",
        border: "1px solid #ccc",
        borderRadius: "6px",
        backgroundColor: "#fff",
        cursor: "pointer",
        fontSize: "14px",
        color: "#666",
      },
    });
    cancelBtn.addEventListener("click", () => overlay.remove());
    popup.appendChild(cancelBtn);

    overlay.appendChild(popup);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });

    // 附加到设置页容器
    this.container.appendChild(overlay);
    ztoolkit.log(
      `[ApiSettingsPage] 显示密钥选择弹窗，共 ${keys.length} 个密钥`,
    );
  }

  /**
   * 执行测试连接（使用当前活动密钥）
   */
  private async runTestConnection(): Promise<void> {
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
      // 检查是否为 APITestError 类型
      let fullMsg: string;
      if (error?.name === "APITestError" && error?.details) {
        // 使用详细错误报告格式
        fullMsg = error.formatReport?.() || this.formatAPITestError(error);
      } else {
        // 普通错误，直接显示消息
        fullMsg = error?.message || String(error);
      }

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
   * 执行测试连接（使用指定密钥）
   */
  private async runTestConnectionWithKey(
    apiKey: string,
    keyIndex: number,
  ): Promise<void> {
    const progressWindow = new ztoolkit.ProgressWindow("API 连接测试", {
      closeTime: -1,
    });
    progressWindow.createLine({
      text: `正在测试密钥 ${keyIndex + 1}...`,
      type: "default",
    });
    progressWindow.show();

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
      resultPre.textContent = `正在测试密钥 ${keyIndex + 1}…\n请稍候。`;
    }

    try {
      await this.saveSettings();
      const result = await LLMClient.testConnectionWithKey(apiKey);

      progressWindow.changeLine({
        text: `✅ 密钥 ${keyIndex + 1} 测试成功`,
        type: "success",
        progress: 100,
      });

      if (resultBox && resultPre) {
        resultBox.style.display = "block";
        resultBox.style.backgroundColor = "#e8f5e9";
        resultBox.style.border = "1px solid #a5d6a7";
        resultPre.style.color = "#1b5e20";
        resultPre.textContent = `密钥 ${keyIndex + 1} 测试结果:\n${result}`;
      }

      // 更新成功密钥的状态指示器为绿色
      this.updateKeyStatusIndicator(keyIndex, true);

      setTimeout(() => progressWindow.close(), 3000);
    } catch (error: any) {
      const fullMsg = error?.message || String(error);

      progressWindow.changeLine({
        text: `❌ 密钥 ${keyIndex + 1} 测试失败`,
        type: "fail",
        progress: 100,
      });

      if (resultBox && resultPre) {
        resultBox.style.display = "block";
        resultBox.style.backgroundColor = "#ffebee";
        resultBox.style.border = "1px solid #ffcdd2";
        resultPre.style.color = "#b71c1c";
        resultPre.textContent = `密钥 ${keyIndex + 1} 测试失败:\n${fullMsg}`;
      }

      // 更新失败密钥的状态指示器为红色
      this.updateKeyStatusIndicator(keyIndex, false);

      setTimeout(() => progressWindow.close(), 5000);
    }
  }

  /**
   * 更新密钥状态指示器
   */
  private updateKeyStatusIndicator(keyIndex: number, isValid: boolean): void {
    const provider = (getPref("provider") as string) || "openai";
    const keyManagerId = this.mapToKeyManagerId(provider);
    const statusSelector = `[data-key-status="${keyManagerId}-${keyIndex}"]`;
    const statusIcon = this.container.querySelector(
      statusSelector,
    ) as HTMLElement | null;
    if (statusIcon) {
      statusIcon.style.color = isValid ? "#4caf50" : "#f44336";
      statusIcon.title = isValid ? "测试成功" : "测试失败";
    }
  }

  /**
   * 格式化 APITestError 为详细错误报告
   */
  private formatAPITestError(error: any): string {
    const d = error?.details;
    if (!d) return error?.message || String(error);
    const lines: string[] = [];
    lines.push(`错误名称: ${d.errorName || "Unknown"}`);
    lines.push(`错误信息: ${d.errorMessage || error?.message || "Unknown"}`);
    if (d.statusCode !== undefined) {
      lines.push(`状态码: ${d.statusCode}`);
    }
    lines.push(`请求路径: ${d.requestUrl || "Unknown"}`);
    if (d.responseBody) {
      lines.push(`响应内容: ${d.responseBody}`);
    }
    if (d.responseHeaders && Object.keys(d.responseHeaders).length > 0) {
      lines.push(`响应首部: ${JSON.stringify(d.responseHeaders, null, 2)}`);
    }
    lines.push(`请求体: ${d.requestBody || "Unknown"}`);
    return lines.join("\n");
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
    setPref(
      "openRouterApiUrl",
      "https://openrouter.ai/api/v1/chat/completions",
    );
    setPref("openRouterApiKey", "");
    setPref("openRouterModel", "google/gemma-3-27b-it");
    // 火山方舟默认
    setPref(
      "volcanoArkApiUrl",
      "https://ark.cn-beijing.volces.com/api/v3/responses",
    );
    setPref("volcanoArkApiKey", "");
    setPref("volcanoArkModel", "doubao-seed-1-8-251228");
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
