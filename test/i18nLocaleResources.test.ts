import { expect } from "chai";
import {
  getLocaleID,
  getString,
  localizeAttribute,
  localizeLabel,
  localizePlaceholder,
  localizeText,
  localizeTitle,
  localizeTooltip,
} from "../src/utils/locale";
import {
  PDFExtractor,
  PDFTextExtractionError,
} from "../src/modules/pdfExtractor";
import { LLMNoteMetadataService } from "../src/modules/llmNoteMetadata";

describe("i18n getString helper", function () {
  let globalAddon: any;
  let previousAddon: any;
  let previousLocale: any;

  beforeEach(function () {
    previousAddon = (globalThis as any).addon;
    previousLocale = previousAddon?.data?.locale;
    globalAddon = previousAddon || { data: {} };
    (globalThis as any).addon = globalAddon;
    globalAddon.data = globalAddon.data || {};
  });

  afterEach(function () {
    if (previousAddon) {
      (globalThis as any).addon = previousAddon;
      previousAddon.data = previousAddon.data || {};
      previousAddon.data.locale = previousLocale;
    } else {
      delete globalAddon.data.locale;
    }
  });

  it("falls back to the raw key when locale data is unavailable", function () {
    delete globalAddon.data.locale;

    expect(getString("missing-ui-key")).to.equal("missing-ui-key");
  });

  it("falls back to the raw key when a message or attribute is missing", function () {
    withMessages({ "known-key": "Known value" }, () => {
      expect(getString("known-key")).to.equal("Known value");
      expect(getString("unknown-key")).to.equal("unknown-key");
      expect(getString("known-key", "missingAttribute")).to.equal("known-key");
    });
  });

  it("supports scaffold-prefixed Fluent IDs while exposing stable DOM IDs", function () {
    withMessages({ "aiButler-prefixed-key": "Prefixed value" }, () => {
      expect(getString("prefixed-key")).to.equal("Prefixed value");
      expect(getString("aiButler-prefixed-key")).to.equal("Prefixed value");
      expect(getLocaleID("prefixed-key")).to.equal("aiButler-prefixed-key");
    });
  });

  it("applies localized text and attributes through DOM helpers", function () {
    class FakeElement {
      textContent = "";
      attributes = new Map<string, string>();
      setAttribute(name: string, value: string) {
        this.attributes.set(name, value);
      }
    }

    withMessages(
      {
        "helper-text": "正文 { $value }",
        "helper-title": "标题",
        "helper-placeholder": "请输入",
        "helper-label": "按钮",
        "helper-tooltip": "提示",
        "helper-aria": "无障碍标签",
      },
      () => {
        const textEl = new FakeElement();
        const titleEl = new FakeElement();
        const placeholderEl = new FakeElement();
        const labelEl = new FakeElement();
        const tooltipEl = new FakeElement();
        const ariaEl = new FakeElement();

        localizeText(textEl as unknown as Element, "helper-text", {
          args: { value: 1 },
        });
        localizeTitle(titleEl as unknown as Element, "helper-title");
        localizePlaceholder(
          placeholderEl as unknown as Element,
          "helper-placeholder",
        );
        localizeLabel(labelEl as unknown as Element, "helper-label");
        localizeTooltip(tooltipEl as unknown as Element, "helper-tooltip");
        localizeAttribute(
          ariaEl as unknown as Element,
          "aria-label",
          "helper-aria",
        );

        expect(textEl.textContent).to.equal("正文 1");
        expect(titleEl.attributes.get("title")).to.equal("标题");
        expect(placeholderEl.attributes.get("placeholder")).to.equal("请输入");
        expect(labelEl.attributes.get("label")).to.equal("按钮");
        expect(tooltipEl.attributes.get("tooltiptext")).to.equal("提示");
        expect(ariaEl.attributes.get("aria-label")).to.equal("无障碍标签");
      },
    );
  });

  it("reads attributes from Fluent messages that do not have a base value", function () {
    globalAddon.data.locale = {
      current: {
        formatMessagesSync(requests: Array<{ id: string }>) {
          return requests.map(({ id }) => {
            if (id.endsWith("attribute-only-key")) {
              return {
                value: undefined,
                attributes: [{ name: "label", value: "Attribute Label" }],
              };
            }
            return { value: undefined, attributes: [] };
          });
        },
      },
    };

    expect(getString("attribute-only-key", "label")).to.equal(
      "Attribute Label",
    );
    expect(getString("attribute-only-key")).to.equal("attribute-only-key");
    expect(getString("attribute-only-key", "missingAttribute")).to.equal(
      "attribute-only-key",
    );
  });

  function withMessages<T>(messages: Record<string, string>, run: () => T): T {
    globalAddon.data.locale = {
      current: {
        formatMessagesSync(
          requests: Array<{ id: string; args?: Record<string, unknown> }>,
        ) {
          return requests.map(({ id, args }) => {
            const key = Object.keys(messages).find(
              (candidate) => id === candidate || id.endsWith(`-${candidate}`),
            );
            let value = key ? messages[key] : undefined;
            if (value && args) {
              for (const [name, argValue] of Object.entries(args)) {
                value = value.replace(
                  new RegExp(`\\{\\s*\\$${name}\\s*\\}`, "g"),
                  String(argValue),
                );
              }
            }
            return { value };
          });
        },
      },
    };
    return run();
  }

  it("formats localized provider and preset labels", function () {
    withMessages(
      {
        "llm-endpoint-provider-google": "Google Gemini",
        "llm-endpoint-provider-anthropic": "Anthropic Claude",
        "settings-api-provider-google": "Google Gemini",
        "settings-api-provider-anthropic": "Anthropic Claude",
        "settings-api-provider-openrouter": "OpenRouter",
        "settings-api-provider-ollama": "Ollama",
        "settings-image-summary-preset-agnes": "Agnes Image 2.1 Flash",
        "setup-preset-change-api-key": "API Key",
      },
      () => {
        expect(getString("llm-endpoint-provider-google")).to.equal(
          "Google Gemini",
        );
        expect(getString("llm-endpoint-provider-anthropic")).to.equal(
          "Anthropic Claude",
        );
        expect(getString("settings-api-provider-google")).to.equal(
          "Google Gemini",
        );
        expect(getString("settings-api-provider-anthropic")).to.equal(
          "Anthropic Claude",
        );
        expect(getString("settings-api-provider-openrouter")).to.equal(
          "OpenRouter",
        );
        expect(getString("settings-api-provider-ollama")).to.equal("Ollama");
        expect(getString("settings-image-summary-preset-agnes")).to.equal(
          "Agnes Image 2.1 Flash",
        );
        expect(getString("setup-preset-change-api-key")).to.equal("API Key");
      },
    );
  });

  it("formats localized API parameter labels", function () {
    withMessages(
      {
        "settings-api-temperature-label": "Temperature",
        "settings-api-max-tokens-label": "Max Tokens",
        "settings-api-top-p-label": "Top P",
        "settings-image-summary-api-key-label": "API Key *",
      },
      () => {
        expect(getString("settings-api-temperature-label")).to.equal(
          "Temperature",
        );
        expect(getString("settings-api-max-tokens-label")).to.equal(
          "Max Tokens",
        );
        expect(getString("settings-api-top-p-label")).to.equal("Top P");
        expect(getString("settings-image-summary-api-key-label")).to.equal(
          "API Key *",
        );
      },
    );
  });

  it("formats localized endpoint card and multi-summary details", function () {
    withMessages(
      {
        "endpoint-card-subtitle": "供应商类型：{ $provider } · PDF：{ $pdf }",
        "endpoint-multi-summary-detail":
          "{ $provider } · { $model } · PDF：{ $pdf }",
      },
      () => {
        expect(
          getString("endpoint-card-subtitle", {
            args: { provider: "OpenAI 兼容", pdf: "文本提取" },
          }),
        ).to.equal("供应商类型：OpenAI 兼容 · PDF：文本提取");
        expect(
          getString("endpoint-multi-summary-detail", {
            args: {
              provider: "OpenAI 兼容",
              model: "deepseek-chat",
              pdf: "文本提取",
            },
          }),
        ).to.equal("OpenAI 兼容 · deepseek-chat · PDF：文本提取");
      },
    );

    withMessages(
      {
        "endpoint-card-subtitle":
          "Provider type: { $provider } · PDF: { $pdf }",
        "endpoint-multi-summary-detail":
          "{ $provider } · { $model } · PDF: { $pdf }",
      },
      () => {
        expect(
          getString("endpoint-card-subtitle", {
            args: { provider: "OpenAI Compatible", pdf: "Text extraction" },
          }),
        ).to.equal("Provider type: OpenAI Compatible · PDF: Text extraction");
        expect(
          getString("endpoint-multi-summary-detail", {
            args: {
              provider: "OpenAI Compatible",
              model: "deepseek-chat",
              pdf: "Text extraction",
            },
          }),
        ).to.equal("OpenAI Compatible · deepseek-chat · PDF: Text extraction");
      },
    );
  });

  it("returns Chinese strings for migrated settings and workflow keys", function () {
    withMessages(
      {
        "settings-data-title": "💾 数据管理",
        "settings-mindmap-title": "🧠 思维导图设置",
        "settings-api-fetch-models": "🔧 获取模型列表",
        "settings-image-summary-title": "🖼️ 一图总结设置",
        "settings-prompts-template-switched": "✅ 已切换模板: { $name }",
        "settings-prompts-table-settings-saved": "✅ 表格设置已保存",
        "literature-review-source-label":
          "> **[{ $index }] 文献**: { $title } ({ $author }, { $year })",
        "note-generator-deep-read-round-label":
          "AI 精读 { $current }/{ $total }",
        "onboarding-stage-progress":
          "大步骤 { $current }/{ $total }：{ $title }",
      },
      () => {
        expect(getString("settings-data-title")).to.equal("💾 数据管理");
        expect(getString("settings-mindmap-title")).to.equal("🧠 思维导图设置");
        expect(getString("settings-api-fetch-models")).to.equal(
          "🔧 获取模型列表",
        );
        expect(getString("settings-image-summary-title")).to.equal(
          "🖼️ 一图总结设置",
        );
        expect(
          getString("settings-prompts-template-switched", {
            args: { name: "系统论文精读" },
          }),
        ).to.equal("✅ 已切换模板: 系统论文精读");
        expect(getString("settings-prompts-table-settings-saved")).to.equal(
          "✅ 表格设置已保存",
        );
        expect(
          getString("literature-review-source-label", {
            args: {
              index: 2,
              title: "A Great Paper",
              author: "Li",
              year: 2026,
            },
          }),
        ).to.equal("> **[2] 文献**: A Great Paper (Li, 2026)");
        expect(
          getString("note-generator-deep-read-round-label", {
            args: { current: 3, total: 8 },
          }),
        ).to.equal("AI 精读 3/8");
        expect(
          getString("onboarding-stage-progress", {
            args: { current: 1, total: 7, title: "测试模型" },
          }),
        ).to.equal("大步骤 1/7：测试模型");
      },
    );
  });

  it("returns English strings for migrated settings and workflow keys", function () {
    withMessages(
      {
        "settings-data-title": "💾 Data Management",
        "settings-mindmap-title": "🧠 Mind Map Settings",
        "settings-api-fetch-models": "🔧 Fetch Models",
        "settings-image-summary-title": "🖼️ One-image Summary Settings",
        "settings-prompts-template-switched": "✅ Switched template: { $name }",
        "settings-prompts-table-settings-saved": "✅ Table settings saved",
        "literature-review-source-label":
          "> **[{ $index }] Paper**: { $title } ({ $author }, { $year })",
        "note-generator-deep-read-round-label":
          "AI Deep Reading { $current }/{ $total }",
        "onboarding-stage-progress":
          "Major step { $current }/{ $total }: { $title }",
      },
      () => {
        expect(getString("settings-data-title")).to.equal("💾 Data Management");
        expect(getString("settings-mindmap-title")).to.equal(
          "🧠 Mind Map Settings",
        );
        expect(getString("settings-api-fetch-models")).to.equal(
          "🔧 Fetch Models",
        );
        expect(getString("settings-image-summary-title")).to.equal(
          "🖼️ One-image Summary Settings",
        );
        expect(
          getString("settings-prompts-template-switched", {
            args: { name: "System Reading" },
          }),
        ).to.equal("✅ Switched template: System Reading");
        expect(getString("settings-prompts-table-settings-saved")).to.equal(
          "✅ Table settings saved",
        );
        expect(
          getString("literature-review-source-label", {
            args: {
              index: 2,
              title: "A Great Paper",
              author: "Li",
              year: 2026,
            },
          }),
        ).to.equal("> **[2] Paper**: A Great Paper (Li, 2026)");
        expect(
          getString("note-generator-deep-read-round-label", {
            args: { current: 3, total: 8 },
          }),
        ).to.equal("AI Deep Reading 3/8");
        expect(
          getString("onboarding-stage-progress", {
            args: { current: 1, total: 7, title: "Test Model" },
          }),
        ).to.equal("Major step 1/7: Test Model");
      },
    );
  });

  it("formats localized runtime progress and diagnostics keys", function () {
    withMessages(
      {
        "progress-llm-complete-detail":
          "已收到完整响应，长度约 { $count } 个字符",
        "progress-mineru-poll-detail":
          "第 { $attempt } 次轮询；状态：{ $state }；已等待 { $seconds } 秒；Batch ID：{ $batchId }",
        "task-detail-completed": "任务已完成：{ $title }",
        "image-client-test-success":
          "✅ 连接成功！生成了 { $mimeType } 格式的图片 ({ $size } KB)",
      },
      () => {
        expect(
          getString("progress-llm-complete-detail", {
            args: { count: 2048 },
          }),
        ).to.equal("已收到完整响应，长度约 2048 个字符");
        expect(
          getString("progress-mineru-poll-detail", {
            args: {
              attempt: 3,
              state: "running",
              seconds: 15,
              batchId: "batch-1",
            },
          }),
        ).to.equal(
          "第 3 次轮询；状态：running；已等待 15 秒；Batch ID：batch-1",
        );
        expect(
          getString("task-detail-completed", {
            args: { title: "A Great Paper" },
          }),
        ).to.equal("任务已完成：A Great Paper");
        expect(
          getString("image-client-test-success", {
            args: { mimeType: "image/png", size: 512 },
          }),
        ).to.equal("✅ 连接成功！生成了 image/png 格式的图片 (512 KB)");
      },
    );

    withMessages(
      {
        "progress-llm-complete-detail":
          "Received the complete response, about { $count } characters",
        "progress-mineru-poll-detail":
          "Poll { $attempt }; status: { $state }; waited { $seconds } seconds; Batch ID: { $batchId }",
        "task-detail-completed": "Task completed: { $title }",
        "image-client-test-success":
          "✅ Connection succeeded! Generated a { $mimeType } image ({ $size } KB)",
      },
      () => {
        expect(
          getString("progress-llm-complete-detail", {
            args: { count: 2048 },
          }),
        ).to.equal("Received the complete response, about 2048 characters");
        expect(
          getString("progress-mineru-poll-detail", {
            args: {
              attempt: 3,
              state: "running",
              seconds: 15,
              batchId: "batch-1",
            },
          }),
        ).to.equal(
          "Poll 3; status: running; waited 15 seconds; Batch ID: batch-1",
        );
        expect(
          getString("task-detail-completed", {
            args: { title: "A Great Paper" },
          }),
        ).to.equal("Task completed: A Great Paper");
        expect(
          getString("image-client-test-success", {
            args: { mimeType: "image/png", size: 512 },
          }),
        ).to.equal(
          "✅ Connection succeeded! Generated a image/png image (512 KB)",
        );
      },
    );
  });

  it("formats localized item pane and note-generation messages", function () {
    withMessages(
      {
        "itempane-chat-note-title": "AI 管家 - 后续追问 - { $title }",
        "itempane-chat-load-failed": "❌ 加载失败: { $message }",
        "note-generator-error-multimodel-all-failed":
          "多模型同时总结全部失败。\n{ $details }",
        "note-generator-multimodel-complete-heading":
          "**多模型同时总结完成：{ $success }/{ $total } 个模型成功**",
        "note-generator-error-multimodel-summary-mode-unsupported":
          "多模型同时总结仅支持普通 AI 总结；AI 精读请使用 v2 精读流程。",
      },
      () => {
        expect(
          getString("itempane-chat-note-title", {
            args: { title: "A Great Paper" },
          }),
        ).to.equal("AI 管家 - 后续追问 - A Great Paper");
        expect(
          getString("itempane-chat-load-failed", {
            args: { message: "PDF missing" },
          }),
        ).to.equal("❌ 加载失败: PDF missing");
        expect(
          getString("note-generator-error-multimodel-all-failed", {
            args: { details: "OpenAI: timeout" },
          }),
        ).to.equal("多模型同时总结全部失败。\nOpenAI: timeout");
        expect(
          getString("note-generator-multimodel-complete-heading", {
            args: { success: 2, total: 3 },
          }),
        ).to.equal("**多模型同时总结完成：2/3 个模型成功**");
        expect(
          getString("note-generator-error-multimodel-summary-mode-unsupported"),
        ).to.equal(
          "多模型同时总结仅支持普通 AI 总结；AI 精读请使用 v2 精读流程。",
        );
      },
    );

    withMessages(
      {
        "itempane-chat-note-title": "AI Butler - Follow-up Chat - { $title }",
        "itempane-chat-load-failed": "❌ Load failed: { $message }",
        "note-generator-error-multimodel-all-failed":
          "All multi-model summary calls failed.\n{ $details }",
        "note-generator-multimodel-complete-heading":
          "**Multi-model summary complete: { $success }/{ $total } models succeeded**",
        "note-generator-error-multimodel-summary-mode-unsupported":
          "Multi-model summary only supports normal AI Summary. Use AI Deep Reading v2 for deep reading.",
      },
      () => {
        expect(
          getString("itempane-chat-note-title", {
            args: { title: "A Great Paper" },
          }),
        ).to.equal("AI Butler - Follow-up Chat - A Great Paper");
        expect(
          getString("itempane-chat-load-failed", {
            args: { message: "PDF missing" },
          }),
        ).to.equal("❌ Load failed: PDF missing");
        expect(
          getString("note-generator-error-multimodel-all-failed", {
            args: { details: "OpenAI: timeout" },
          }),
        ).to.equal("All multi-model summary calls failed.\nOpenAI: timeout");
        expect(
          getString("note-generator-multimodel-complete-heading", {
            args: { success: 2, total: 3 },
          }),
        ).to.equal("**Multi-model summary complete: 2/3 models succeeded**");
      },
    );
  });

  it("formats localized export setup and MinerU status keys", function () {
    withMessages(
      {
        "progress-mineru-cache-detail":
          "已找到此前保存的 MinerU Markdown 附件，跳过重新解析",
        "mineru-error-api-key-missing": "MinerU API Key 未配置",
        "mineru-error-task-timeout": "MinerU 任务在 { $timeoutMs } ms 后超时",
        "mineru-error-upload-url-failed":
          "获取 MinerU 上传地址失败：{ $message }",
        "mineru-error-no-valid-markdown":
          "解压结果中没有找到有效的 Markdown 文件",
        "note-export-progress-exporting": "正在导出：{ $title }",
        "note-export-warning-item-failed": "{ $title } 导出失败：{ $message }",
        "setup-preset-deepseek-step-key-detail":
          "进入 API Keys 页面，新建密钥并立刻复制；密钥通常只展示一次。",
      },
      () => {
        expect(getString("progress-mineru-cache-detail")).to.equal(
          "已找到此前保存的 MinerU Markdown 附件，跳过重新解析",
        );
        expect(getString("mineru-error-api-key-missing")).to.equal(
          "MinerU API Key 未配置",
        );
        expect(
          getString("mineru-error-task-timeout", { args: { timeoutMs: 3000 } }),
        ).to.equal("MinerU 任务在 3000 ms 后超时");
        expect(
          getString("mineru-error-upload-url-failed", {
            args: { message: "bad" },
          }),
        ).to.equal("获取 MinerU 上传地址失败：bad");
        expect(getString("mineru-error-no-valid-markdown")).to.equal(
          "解压结果中没有找到有效的 Markdown 文件",
        );
        expect(
          getString("note-export-progress-exporting", {
            args: { title: "Paper A" },
          }),
        ).to.equal("正在导出：Paper A");
        expect(
          getString("note-export-warning-item-failed", {
            args: { title: "Paper A", message: "Permission denied" },
          }),
        ).to.equal("Paper A 导出失败：Permission denied");
        expect(getString("setup-preset-deepseek-step-key-detail")).to.equal(
          "进入 API Keys 页面，新建密钥并立刻复制；密钥通常只展示一次。",
        );
      },
    );

    withMessages(
      {
        "progress-mineru-cache-detail":
          "Found a previously saved MinerU Markdown attachment; skipping re-parsing",
        "note-export-progress-exporting": "Exporting: { $title }",
        "note-export-warning-item-failed":
          "{ $title } export failed: { $message }",
        "setup-preset-deepseek-step-key-detail":
          "Open the API Keys page, create a new key, and copy it immediately; keys are usually shown only once.",
      },
      () => {
        expect(getString("progress-mineru-cache-detail")).to.equal(
          "Found a previously saved MinerU Markdown attachment; skipping re-parsing",
        );
        expect(
          getString("note-export-progress-exporting", {
            args: { title: "Paper A" },
          }),
        ).to.equal("Exporting: Paper A");
        expect(
          getString("note-export-warning-item-failed", {
            args: { title: "Paper A", message: "Permission denied" },
          }),
        ).to.equal("Paper A export failed: Permission denied");
        expect(getString("setup-preset-deepseek-step-key-detail")).to.equal(
          "Open the API Keys page, create a new key, and copy it immediately; keys are usually shown only once.",
        );
      },
    );
  });

  it("formats localized provider and LLM error keys", function () {
    withMessages(
      {
        "provider-error-api-url-missing-named": "{ $provider } API URL 未配置",
        "provider-error-http-request-failed": "HTTP { $status }: 请求失败",
        "llm-error-unknown-provider-with-list":
          "未知的供应商: { $provider }。可用: { $list }",
        "mindmap-error-empty-llm-response":
          "LLM 返回了空内容，无法生成思维导图\n\n{ $details }",
      },
      () => {
        expect(
          getString("provider-error-api-url-missing-named", {
            args: { provider: "Gemini" },
          }),
        ).to.equal("Gemini API URL 未配置");
        expect(
          getString("provider-error-http-request-failed", {
            args: { status: 503 },
          }),
        ).to.equal("HTTP 503: 请求失败");
        expect(
          getString("llm-error-unknown-provider-with-list", {
            args: { provider: "foo", list: "openai, google" },
          }),
        ).to.equal("未知的供应商: foo。可用: openai, google");
        expect(
          getString("mindmap-error-empty-llm-response", {
            args: { details: "empty response" },
          }),
        ).to.equal("LLM 返回了空内容，无法生成思维导图\n\nempty response");
      },
    );

    withMessages(
      {
        "provider-error-api-url-missing-named":
          "{ $provider } API URL is not configured",
        "provider-error-http-request-failed":
          "HTTP { $status }: request failed",
        "llm-error-unknown-provider-with-list":
          "Unknown provider: { $provider }. Available: { $list }",
        "mindmap-error-empty-llm-response":
          "The LLM returned empty content, so the mind map could not be generated\n\n{ $details }",
      },
      () => {
        expect(
          getString("provider-error-api-url-missing-named", {
            args: { provider: "Gemini" },
          }),
        ).to.equal("Gemini API URL is not configured");
        expect(
          getString("provider-error-http-request-failed", {
            args: { status: 503 },
          }),
        ).to.equal("HTTP 503: request failed");
        expect(
          getString("llm-error-unknown-provider-with-list", {
            args: { provider: "foo", list: "openai, google" },
          }),
        ).to.equal("Unknown provider: foo. Available: openai, google");
        expect(
          getString("mindmap-error-empty-llm-response", {
            args: { details: "empty response" },
          }),
        ).to.equal(
          "The LLM returned empty content, so the mind map could not be generated\n\nempty response",
        );
      },
    );
  });

  it("formats localized note kind and miscellaneous runtime errors", function () {
    withMessages(
      {
        "note-kind-summary": "AI 总结",
        "dialog-error-create-confirmation-failed": "无法创建确认对话框",
        "image-note-error-file-not-found": "图片文件不存在: { $path }",
        "collection-clean-error-note-delete-unsupported":
          "笔记 { $id } 不支持删除",
      },
      () => {
        expect(getString("note-kind-summary")).to.equal("AI 总结");
        expect(getString("dialog-error-create-confirmation-failed")).to.equal(
          "无法创建确认对话框",
        );
        expect(
          getString("image-note-error-file-not-found", {
            args: { path: "C:/tmp/a.png" },
          }),
        ).to.equal("图片文件不存在: C:/tmp/a.png");
        expect(
          getString("collection-clean-error-note-delete-unsupported", {
            args: { id: 42 },
          }),
        ).to.equal("笔记 42 不支持删除");
      },
    );

    withMessages(
      {
        "note-kind-summary": "AI Summary",
        "dialog-error-create-confirmation-failed":
          "Could not create confirmation dialog",
        "image-note-error-file-not-found":
          "Image file does not exist: { $path }",
        "collection-clean-error-note-delete-unsupported":
          "Note { $id } cannot be deleted",
      },
      () => {
        expect(getString("note-kind-summary")).to.equal("AI Summary");
        expect(getString("dialog-error-create-confirmation-failed")).to.equal(
          "Could not create confirmation dialog",
        );
        expect(
          getString("image-note-error-file-not-found", {
            args: { path: "C:/tmp/a.png" },
          }),
        ).to.equal("Image file does not exist: C:/tmp/a.png");
        expect(
          getString("collection-clean-error-note-delete-unsupported", {
            args: { id: 42 },
          }),
        ).to.equal("Note 42 cannot be deleted");
      },
    );
  });

  it("formats localized loading toast and completion messages", function () {
    withMessages(
      {
        "summary-loading-paper": "正在加载文献...",
        "settings-api-save-failed": "❌ 保存失败: { $message }",
        "summary-complete-all": "✅ 所有 { $total } 个条目处理完成！",
        "summary-stopped-message":
          "⏸️ 已停止处理 - 成功: { $success }, 失败: { $failed }, 未处理: { $notProcessed }",
      },
      () => {
        expect(getString("summary-loading-paper")).to.equal("正在加载文献...");
        expect(
          getString("settings-api-save-failed", {
            args: { message: "disk full" },
          }),
        ).to.equal("❌ 保存失败: disk full");
        expect(
          getString("summary-complete-all", { args: { total: 3 } }),
        ).to.equal("✅ 所有 3 个条目处理完成！");
        expect(
          getString("summary-stopped-message", {
            args: { success: 1, failed: 2, notProcessed: 3 },
          }),
        ).to.equal("⏸️ 已停止处理 - 成功: 1, 失败: 2, 未处理: 3");
      },
    );

    withMessages(
      {
        "summary-loading-paper": "Loading paper...",
        "settings-api-save-failed": "❌ Save failed: { $message }",
        "summary-complete-all": "✅ All { $total } items processed!",
        "summary-stopped-message":
          "⏸️ Processing stopped - succeeded: { $success }, failed: { $failed }, not processed: { $notProcessed }",
      },
      () => {
        expect(getString("summary-loading-paper")).to.equal("Loading paper...");
        expect(
          getString("settings-api-save-failed", {
            args: { message: "disk full" },
          }),
        ).to.equal("❌ Save failed: disk full");
        expect(
          getString("summary-complete-all", { args: { total: 3 } }),
        ).to.equal("✅ All 3 items processed!");
        expect(
          getString("summary-stopped-message", {
            args: { success: 1, failed: 2, notProcessed: 3 },
          }),
        ).to.equal(
          "⏸️ Processing stopped - succeeded: 1, failed: 2, not processed: 3",
        );
      },
    );
  });

  it("formats localized main-window fallback UI keys", function () {
    withMessages(
      {
        "main-window-title": "AI Butler - 智能文献管家",
        "main-window-feature-in-development": "该功能正在开发中...",
        "settings-note-export-eyebrow": "AI Butler · 笔记导出",
      },
      () => {
        expect(getString("main-window-title")).to.equal(
          "AI Butler - 智能文献管家",
        );
        expect(getString("main-window-feature-in-development")).to.equal(
          "该功能正在开发中...",
        );
        expect(getString("settings-note-export-eyebrow")).to.equal(
          "AI Butler · 笔记导出",
        );
      },
    );

    withMessages(
      {
        "main-window-title": "AI Butler - Intelligent Literature Assistant",
        "main-window-feature-in-development":
          "This feature is under development...",
        "settings-note-export-eyebrow": "AI Butler · Note Export",
      },
      () => {
        expect(getString("main-window-title")).to.equal(
          "AI Butler - Intelligent Literature Assistant",
        );
        expect(getString("main-window-feature-in-development")).to.equal(
          "This feature is under development...",
        );
        expect(getString("settings-note-export-eyebrow")).to.equal(
          "AI Butler · Note Export",
        );
      },
    );
  });

  it("formats localized onboarding step and live status messages", function () {
    withMessages(
      {
        "onboarding-step-entry-toolbar-title": "AI 管家仪表盘",
        "onboarding-step-entry-toolbar-description":
          "文献库工具栏上的 🤖 会打开 AI 管家仪表盘。请直接点击这个真实按钮，教程会自动进入下一步。",
        "onboarding-step-final-auto-deepread-setting-next": "知道了",
        "onboarding-live-status-tracked-title":
          "已追踪到当前论文总结任务：{ $progress }%",
        "onboarding-live-status-current-stage":
          "当前阶段：{ $stage }{ $detail }。鼠标移到任务卡片的阶段标签上可看完整进度详情。",
      },
      () => {
        expect(getString("onboarding-step-entry-toolbar-title")).to.equal(
          "AI 管家仪表盘",
        );
        expect(getString("onboarding-step-entry-toolbar-description")).to.equal(
          "文献库工具栏上的 🤖 会打开 AI 管家仪表盘。请直接点击这个真实按钮，教程会自动进入下一步。",
        );
        expect(
          getString("onboarding-step-final-auto-deepread-setting-next"),
        ).to.equal("知道了");
        expect(
          getString("onboarding-live-status-tracked-title", {
            args: { progress: 42 },
          }),
        ).to.equal("已追踪到当前论文总结任务：42%");
        expect(
          getString("onboarding-live-status-current-stage", {
            args: { stage: "提取 PDF", detail: "；第 1 轮" },
          }),
        ).to.equal(
          "当前阶段：提取 PDF；第 1 轮。鼠标移到任务卡片的阶段标签上可看完整进度详情。",
        );
      },
    );

    withMessages(
      {
        "onboarding-step-entry-toolbar-title": "AI Butler Dashboard",
        "onboarding-step-entry-toolbar-description":
          "The 🤖 button on the library toolbar opens the AI Butler dashboard. Click the real button directly, and the tutorial will move to the next step automatically.",
        "onboarding-step-final-auto-deepread-setting-next": "Got it",
        "onboarding-live-status-tracked-title":
          "Tracking the current paper summary task: { $progress }%",
        "onboarding-live-status-current-stage":
          "Current stage: { $stage }{ $detail }. Hover over the stage label on the task card to view full progress details.",
      },
      () => {
        expect(getString("onboarding-step-entry-toolbar-title")).to.equal(
          "AI Butler Dashboard",
        );
        expect(getString("onboarding-step-entry-toolbar-description")).to.equal(
          "The 🤖 button on the library toolbar opens the AI Butler dashboard. Click the real button directly, and the tutorial will move to the next step automatically.",
        );
        expect(
          getString("onboarding-step-final-auto-deepread-setting-next"),
        ).to.equal("Got it");
        expect(
          getString("onboarding-live-status-tracked-title", {
            args: { progress: 42 },
          }),
        ).to.equal("Tracking the current paper summary task: 42%");
        expect(
          getString("onboarding-live-status-current-stage", {
            args: { stage: "Extracting PDF", detail: "; round 1" },
          }),
        ).to.equal(
          "Current stage: Extracting PDF; round 1. Hover over the stage label on the task card to view full progress details.",
        );
      },
    );
  });

  it("formats localized API settings and runtime UI messages", function () {
    withMessages(
      {
        "settings-api-request-timeout-label": "请求超时时间（毫秒）",
        "settings-api-pdf-mode-selected-mineru":
          "已选择 MinerU 模式：需要填写 API Key 以启用高级公式/表格还原。",
        "settings-api-mineru-external-path-placeholder":
          "例如 D:\\ObsidianVault\\Literature",
        "settings-api-key-empty": "(空)",
        "common-unknown-value": "未知",
        "itempane-mindmap-exported-to-desktop": "已保存到桌面: { $filename }",
        "legacy-ai-note-migration-renamed-count":
          "已将 { $renamed }/{ $total } 条旧 AI 笔记标记为 AI 总结",
        "preferences-open-main-window-failed": "打开主窗口失败: { $message }",
      },
      () => {
        expect(getString("settings-api-request-timeout-label")).to.equal(
          "请求超时时间（毫秒）",
        );
        expect(getString("settings-api-pdf-mode-selected-mineru")).to.equal(
          "已选择 MinerU 模式：需要填写 API Key 以启用高级公式/表格还原。",
        );
        expect(
          getString("settings-api-mineru-external-path-placeholder"),
        ).to.equal("例如 D:\\ObsidianVault\\Literature");
        expect(getString("settings-api-key-empty")).to.equal("(空)");
        expect(getString("common-unknown-value")).to.equal("未知");
        expect(
          getString("itempane-mindmap-exported-to-desktop", {
            args: { filename: "map.png" },
          }),
        ).to.equal("已保存到桌面: map.png");
        expect(
          getString("legacy-ai-note-migration-renamed-count", {
            args: { renamed: 2, total: 3 },
          }),
        ).to.equal("已将 2/3 条旧 AI 笔记标记为 AI 总结");
        expect(
          getString("preferences-open-main-window-failed", {
            args: { message: "boom" },
          }),
        ).to.equal("打开主窗口失败: boom");
      },
    );

    withMessages(
      {
        "settings-api-request-timeout-label": "Request timeout (ms)",
        "settings-api-pdf-mode-selected-mineru":
          "MinerU mode selected: enter an API key to enable advanced formula and table restoration.",
        "settings-api-mineru-external-path-placeholder":
          "Example: D:\\ObsidianVault\\Literature",
        "settings-api-key-empty": "(empty)",
        "common-unknown-value": "Unknown",
        "itempane-mindmap-exported-to-desktop":
          "Saved to desktop: { $filename }",
        "legacy-ai-note-migration-renamed-count":
          "Marked { $renamed }/{ $total } legacy AI notes as AI summaries",
        "preferences-open-main-window-failed":
          "Failed to open main window: { $message }",
      },
      () => {
        expect(getString("settings-api-request-timeout-label")).to.equal(
          "Request timeout (ms)",
        );
        expect(getString("settings-api-pdf-mode-selected-mineru")).to.equal(
          "MinerU mode selected: enter an API key to enable advanced formula and table restoration.",
        );
        expect(
          getString("settings-api-mineru-external-path-placeholder"),
        ).to.equal("Example: D:\\ObsidianVault\\Literature");
        expect(getString("settings-api-key-empty")).to.equal("(empty)");
        expect(getString("common-unknown-value")).to.equal("Unknown");
        expect(
          getString("itempane-mindmap-exported-to-desktop", {
            args: { filename: "map.png" },
          }),
        ).to.equal("Saved to desktop: map.png");
        expect(
          getString("legacy-ai-note-migration-renamed-count", {
            args: { renamed: 2, total: 3 },
          }),
        ).to.equal("Marked 2/3 legacy AI notes as AI summaries");
        expect(
          getString("preferences-open-main-window-failed", {
            args: { message: "boom" },
          }),
        ).to.equal("Failed to open main window: boom");
      },
    );
  });

  it("formats localized prompt and deep-read progress messages", function () {
    withMessages(
      {
        "itempane-delete-summary-confirm":
          "确定删除当前 AI 总结版本吗？\n\n{ $label }",
        "legacy-ai-note-migration-confirm-message":
          "新版 AI 管家会把笔记分成“AI 总结”和“AI 精读”。{ $examples } { $more }",
        "note-generator-multimodel-loading":
          "正在使用 { $total } 个模型分析「{ $title }」",
        "note-generator-deep-read-slot-followup-complete": "已完成追问",
        "note-generator-manual-chapters-message":
          "章节解析失败。请每行输入一个章节，例如：第1章：Introduction",
      },
      () => {
        expect(
          getString("itempane-delete-summary-confirm", {
            args: { label: "模型 A" },
          }),
        ).to.equal("确定删除当前 AI 总结版本吗？\n\n模型 A");
        expect(
          getString("legacy-ai-note-migration-confirm-message", {
            args: { examples: "• Paper", more: "共 1 条旧 AI 笔记。" },
          }),
        ).to.equal(
          "新版 AI 管家会把笔记分成“AI 总结”和“AI 精读”。• Paper 共 1 条旧 AI 笔记。",
        );
        expect(
          getString("note-generator-multimodel-loading", {
            args: { total: 2, title: "Paper" },
          }),
        ).to.equal("正在使用 2 个模型分析「Paper」");
        expect(
          getString("note-generator-deep-read-slot-followup-complete"),
        ).to.equal("已完成追问");
        expect(getString("note-generator-manual-chapters-message")).to.equal(
          "章节解析失败。请每行输入一个章节，例如：第1章：Introduction",
        );
      },
    );

    withMessages(
      {
        "itempane-delete-summary-confirm":
          "Delete the current AI summary version?\n\n{ $label }",
        "legacy-ai-note-migration-confirm-message":
          "The new AI Butler separates notes into AI Summary and AI Deep Reading. { $examples } { $more }",
        "note-generator-multimodel-loading":
          "Analyzing “{ $title }” with { $total } models",
        "note-generator-deep-read-slot-followup-complete":
          "Follow-up completed",
        "note-generator-manual-chapters-message":
          "Chapter parsing failed. Enter one chapter per line, for example: Chapter 1: Introduction",
      },
      () => {
        expect(
          getString("itempane-delete-summary-confirm", {
            args: { label: "Model A" },
          }),
        ).to.equal("Delete the current AI summary version?\n\nModel A");
        expect(
          getString("legacy-ai-note-migration-confirm-message", {
            args: { examples: "• Paper", more: "1 legacy AI note." },
          }),
        ).to.equal(
          "The new AI Butler separates notes into AI Summary and AI Deep Reading. • Paper 1 legacy AI note.",
        );
        expect(
          getString("note-generator-multimodel-loading", {
            args: { total: 2, title: "Paper" },
          }),
        ).to.equal("Analyzing “Paper” with 2 models");
        expect(
          getString("note-generator-deep-read-slot-followup-complete"),
        ).to.equal("Follow-up completed");
        expect(getString("note-generator-manual-chapters-message")).to.equal(
          "Chapter parsing failed. Enter one chapter per line, for example: Chapter 1: Introduction",
        );
      },
    );
  });

  it("formats localized workflow progress callback messages", function () {
    withMessages(
      {
        "image-summary-progress-failed": "生成失败: { $message }",
        "mindmap-error-pdf-too-large":
          "PDF 文件过大 ({ $size } MB)，超过设置的阈值 { $max } MB",
        "literature-review-progress-extracting-indexed":
          "正在提取 ({ $current }/{ $total }): { $title }...",
        "note-generator-multimodel-endpoint-complete":
          "模型总结完成：{ $name } ({ $completed }/{ $total })",
        "note-generator-batch-stopped":
          "已停止 (已完成 { $success } 个，失败 { $failed } 个，未处理 { $pending } 个)",
        "progress-pdf-zotero-index-message":
          "正在使用 Zotero 全文索引提取 PDF 文本...",
        "pdf-error-no-attachments": "该条目没有附件",
        "pdf-error-no-pdf-attachment": "该条目没有 PDF 附件",
        "pdf-error-text-empty": "PDF 文本提取失败或 PDF 为空",
        "pdf-error-file-path-not-found": "未找到 PDF 文件路径",
        "pdf-error-attachment-not-pdf": "附件不是 PDF",
        "pdf-error-get-file-path-failed": "获取 PDF 文件路径失败",
        "pdf-error-file-empty-or-unreadable": "PDF 文件为空或无法读取",
        "pdf-error-read-or-encode-failed": "读取或编码 PDF 失败：{ $message }",
      },
      () => {
        expect(
          getString("image-summary-progress-failed", {
            args: { message: "boom" },
          }),
        ).to.equal("生成失败: boom");
        expect(
          getString("mindmap-error-pdf-too-large", {
            args: { size: "51.2", max: 50 },
          }),
        ).to.equal("PDF 文件过大 (51.2 MB)，超过设置的阈值 50 MB");
        expect(
          getString("literature-review-progress-extracting-indexed", {
            args: { current: 2, total: 5, title: "Paper" },
          }),
        ).to.equal("正在提取 (2/5): Paper...");
        expect(
          getString("note-generator-multimodel-endpoint-complete", {
            args: { name: "DeepSeek", completed: 1, total: 2 },
          }),
        ).to.equal("模型总结完成：DeepSeek (1/2)");
        expect(
          getString("note-generator-batch-stopped", {
            args: { success: 3, failed: 1, pending: 2 },
          }),
        ).to.equal("已停止 (已完成 3 个，失败 1 个，未处理 2 个)");
        expect(getString("progress-pdf-zotero-index-message")).to.equal(
          "正在使用 Zotero 全文索引提取 PDF 文本...",
        );
        expect(getString("pdf-error-no-attachments")).to.equal(
          "该条目没有附件",
        );
        expect(getString("pdf-error-no-pdf-attachment")).to.equal(
          "该条目没有 PDF 附件",
        );
        expect(getString("pdf-error-text-empty")).to.equal(
          "PDF 文本提取失败或 PDF 为空",
        );
        expect(getString("pdf-error-file-path-not-found")).to.equal(
          "未找到 PDF 文件路径",
        );
        expect(getString("pdf-error-attachment-not-pdf")).to.equal(
          "附件不是 PDF",
        );
        expect(getString("pdf-error-get-file-path-failed")).to.equal(
          "获取 PDF 文件路径失败",
        );
        expect(getString("pdf-error-file-empty-or-unreadable")).to.equal(
          "PDF 文件为空或无法读取",
        );
        expect(
          getString("pdf-error-read-or-encode-failed", {
            args: { message: "denied" },
          }),
        ).to.equal("读取或编码 PDF 失败：denied");
      },
    );

    withMessages(
      {
        "image-summary-progress-failed": "Generation failed: { $message }",
        "mindmap-error-pdf-too-large":
          "PDF file is too large ({ $size } MB), exceeding the configured threshold of { $max } MB",
        "literature-review-progress-extracting-indexed":
          "Extracting ({ $current }/{ $total }): { $title }...",
        "note-generator-multimodel-endpoint-complete":
          "Model summary complete: { $name } ({ $completed }/{ $total })",
        "note-generator-batch-stopped":
          "Stopped ({ $success } completed, { $failed } failed, { $pending } not processed)",
        "progress-pdf-zotero-index-message":
          "Extracting PDF text using the Zotero full-text index...",
        "pdf-error-no-attachments": "This item has no attachments",
        "pdf-error-no-pdf-attachment": "No PDF attachment found for this item",
        "pdf-error-text-empty":
          "Failed to extract text from PDF or PDF is empty",
        "pdf-error-file-path-not-found": "PDF file path not found",
        "pdf-error-attachment-not-pdf": "Attachment is not a PDF",
        "pdf-error-get-file-path-failed": "Failed to get PDF file path",
        "pdf-error-file-empty-or-unreadable":
          "PDF file is empty or cannot be read",
        "pdf-error-read-or-encode-failed":
          "Failed to read or encode PDF: { $message }",
      },
      () => {
        expect(
          getString("image-summary-progress-failed", {
            args: { message: "boom" },
          }),
        ).to.equal("Generation failed: boom");
        expect(
          getString("mindmap-error-pdf-too-large", {
            args: { size: "51.2", max: 50 },
          }),
        ).to.equal(
          "PDF file is too large (51.2 MB), exceeding the configured threshold of 50 MB",
        );
        expect(
          getString("literature-review-progress-extracting-indexed", {
            args: { current: 2, total: 5, title: "Paper" },
          }),
        ).to.equal("Extracting (2/5): Paper...");
        expect(
          getString("note-generator-multimodel-endpoint-complete", {
            args: { name: "DeepSeek", completed: 1, total: 2 },
          }),
        ).to.equal("Model summary complete: DeepSeek (1/2)");
        expect(
          getString("note-generator-batch-stopped", {
            args: { success: 3, failed: 1, pending: 2 },
          }),
        ).to.equal("Stopped (3 completed, 1 failed, 2 not processed)");
        expect(getString("progress-pdf-zotero-index-message")).to.equal(
          "Extracting PDF text using the Zotero full-text index...",
        );
        expect(getString("pdf-error-no-attachments")).to.equal(
          "This item has no attachments",
        );
        expect(getString("pdf-error-no-pdf-attachment")).to.equal(
          "No PDF attachment found for this item",
        );
        expect(getString("pdf-error-text-empty")).to.equal(
          "Failed to extract text from PDF or PDF is empty",
        );
        expect(getString("pdf-error-file-path-not-found")).to.equal(
          "PDF file path not found",
        );
        expect(getString("pdf-error-attachment-not-pdf")).to.equal(
          "Attachment is not a PDF",
        );
        expect(getString("pdf-error-get-file-path-failed")).to.equal(
          "Failed to get PDF file path",
        );
        expect(getString("pdf-error-file-empty-or-unreadable")).to.equal(
          "PDF file is empty or cannot be read",
        );
        expect(
          getString("pdf-error-read-or-encode-failed", {
            args: { message: "denied" },
          }),
        ).to.equal("Failed to read or encode PDF: denied");
      },
    );
  });

  it("formats localized PDF extraction diagnostics", function () {
    const diagnostics = {
      itemId: 42,
      itemKey: "ABCD1234",
      title: "Paper",
      contentType: "application/pdf",
      filePath: "paper.pdf",
      fileExists: true,
      fileSize: 1024,
      zoteroVersion: "7.0",
      platform: "Win32",
      userAgent: "Zotero",
      startedAt: "2026-07-16T00:00:00.000Z",
      durationMs: 12,
      steps: [
        {
          step: "pdf-file",
          ok: true,
          elapsedMs: 1,
          message: "已找到 PDF 文件",
        },
        {
          step: "cache",
          ok: false,
          elapsedMs: 2,
          cacheExists: false,
          message: "缓存不存在",
        },
      ],
    };

    withMessages(
      {
        "pdf-error-text-extraction-failed": "PDF 文本提取失败：{ $message }",
        "pdf-diagnostic-title": "PDF 文本提取诊断信息",
        "pdf-diagnostic-unknown": "未知",
        "pdf-diagnostic-started-at": "开始时间：{ $value }",
        "pdf-diagnostic-duration-ms": "耗时毫秒：{ $value }",
        "pdf-diagnostic-zotero-version": "Zotero 版本：{ $value }",
        "pdf-diagnostic-platform": "平台：{ $value }",
        "pdf-diagnostic-user-agent": "User-Agent：{ $value }",
        "pdf-diagnostic-item-id": "条目 ID：{ $value }",
        "pdf-diagnostic-item-key": "条目 Key：{ $value }",
        "pdf-diagnostic-note-title": "标题：{ $value }",
        "pdf-diagnostic-content-type": "内容类型：{ $value }",
        "pdf-diagnostic-file-path": "文件路径：{ $value }",
        "pdf-diagnostic-file-exists": "文件是否存在：{ $value }",
        "pdf-diagnostic-file-size": "文件大小：{ $value }",
        "pdf-diagnostic-steps": "步骤：",
        "pdf-diagnostic-step-prefix": "  { $index }. { $step }",
        "pdf-diagnostic-step-ok": "是否成功={ $value }",
        "pdf-diagnostic-step-elapsed-ms": "耗时毫秒={ $value }",
        "pdf-diagnostic-step-indexed-state": "索引状态={ $value }",
        "pdf-diagnostic-step-text-length": "文本长度={ $value }",
        "pdf-diagnostic-step-cache-path": "缓存路径={ $value }",
        "pdf-diagnostic-step-cache-exists": "缓存是否存在={ $value }",
        "pdf-diagnostic-step-cache-size": "缓存大小={ $value }",
        "pdf-diagnostic-step-message": "消息={ $value }",
        "pdf-diagnostic-message-file-found": "已找到 PDF 文件",
        "pdf-diagnostic-message-cache-missing": "缓存不存在",
      },
      () => {
        const text = PDFExtractor.formatDiagnostics(diagnostics as any);
        expect(text).to.contain("PDF 文本提取诊断信息");
        expect(text).to.contain("开始时间：2026-07-16T00:00:00.000Z");
        expect(text).to.contain("是否成功=true");
        expect(text).to.contain("消息=缓存不存在");
        expect(
          new PDFTextExtractionError("boom", diagnostics as any).message,
        ).to.equal("PDF 文本提取失败：boom");
      },
    );

    withMessages(
      {
        "pdf-error-text-extraction-failed":
          "PDF text extraction failed: { $message }",
        "pdf-diagnostic-title": "PDF text extraction diagnostics",
        "pdf-diagnostic-unknown": "unknown",
        "pdf-diagnostic-started-at": "startedAt: { $value }",
        "pdf-diagnostic-duration-ms": "durationMs: { $value }",
        "pdf-diagnostic-zotero-version": "zoteroVersion: { $value }",
        "pdf-diagnostic-platform": "platform: { $value }",
        "pdf-diagnostic-user-agent": "userAgent: { $value }",
        "pdf-diagnostic-item-id": "itemId: { $value }",
        "pdf-diagnostic-item-key": "itemKey: { $value }",
        "pdf-diagnostic-note-title": "title: { $value }",
        "pdf-diagnostic-content-type": "contentType: { $value }",
        "pdf-diagnostic-file-path": "filePath: { $value }",
        "pdf-diagnostic-file-exists": "fileExists: { $value }",
        "pdf-diagnostic-file-size": "fileSize: { $value }",
        "pdf-diagnostic-steps": "steps:",
        "pdf-diagnostic-step-prefix": "  { $index }. { $step }",
        "pdf-diagnostic-step-ok": "ok={ $value }",
        "pdf-diagnostic-step-elapsed-ms": "elapsedMs={ $value }",
        "pdf-diagnostic-step-indexed-state": "indexedState={ $value }",
        "pdf-diagnostic-step-text-length": "textLength={ $value }",
        "pdf-diagnostic-step-cache-path": "cachePath={ $value }",
        "pdf-diagnostic-step-cache-exists": "cacheExists={ $value }",
        "pdf-diagnostic-step-cache-size": "cacheSize={ $value }",
        "pdf-diagnostic-step-message": "message={ $value }",
      },
      () => {
        const text = PDFExtractor.formatDiagnostics({
          ...diagnostics,
          filePath: undefined,
          steps: [
            {
              step: "indexItems",
              ok: true,
              elapsedMs: 3,
              message: "index requested",
            },
          ],
        } as any);
        expect(text).to.contain("PDF text extraction diagnostics");
        expect(text).to.contain("filePath: unknown");
        expect(text).to.contain("ok=true");
        expect(text).to.contain("message=index requested");
        expect(
          new PDFTextExtractionError("boom", diagnostics as any).message,
        ).to.equal("PDF text extraction failed: boom");
      },
    );
  });

  it("formats localized image client errors", function () {
    withMessages(
      {
        "image-client-error-custom-header-name-detail": `Header 名称 "{ $name }" 不合法`,
        "image-client-error-no-image-data-detail":
          "OpenAI 兼容接口响应中未识别到图片数据。请确认接口是否支持图片输出。",
        "image-client-error-text-not-image-detail":
          "模型返回了文本内容而非图片。请检查模型是否支持图片生成。 返回内容: { $text }...",
        "image-client-error-api-key-missing": "一图总结 API Key 未配置",
        "image-client-error-unsupported-downloaded-image":
          "下载的文件不是受支持的图片",
        "image-client-error-unsupported-downloaded-image-detail":
          "图片下载成功，但无法识别为 PNG、JPEG、WebP 或 GIF。",
        "image-client-error-empty-image-url": "图片地址为空",
        "image-client-error-download-status": "未知状态",
      },
      () => {
        expect(
          getString("image-client-error-custom-header-name-detail", {
            args: { name: "Bad Header" },
          }),
        ).to.equal('Header 名称 "Bad Header" 不合法');
        expect(getString("image-client-error-no-image-data-detail")).to.equal(
          "OpenAI 兼容接口响应中未识别到图片数据。请确认接口是否支持图片输出。",
        );
        expect(
          getString("image-client-error-text-not-image-detail", {
            args: { text: "plain text" },
          }),
        ).to.equal(
          "模型返回了文本内容而非图片。请检查模型是否支持图片生成。 返回内容: plain text...",
        );
        expect(getString("image-client-error-api-key-missing")).to.equal(
          "一图总结 API Key 未配置",
        );
        expect(
          getString("image-client-error-unsupported-downloaded-image"),
        ).to.equal("下载的文件不是受支持的图片");
        expect(
          getString("image-client-error-unsupported-downloaded-image-detail"),
        ).to.equal("图片下载成功，但无法识别为 PNG、JPEG、WebP 或 GIF。");
        expect(getString("image-client-error-empty-image-url")).to.equal(
          "图片地址为空",
        );
        expect(getString("image-client-error-download-status")).to.equal(
          "未知状态",
        );
      },
    );

    withMessages(
      {
        "image-client-error-custom-header-name-detail": `Header name "{ $name }" is invalid`,
        "image-client-error-no-image-data-detail":
          "No image data was recognized in the OpenAI-compatible API response.",
        "image-client-error-text-not-image-detail":
          "The model returned text instead of an image. Check whether the model supports image generation. Returned content: { $text }...",
        "image-client-error-api-key-missing":
          "One-image summary API key is not configured",
        "image-client-error-unsupported-downloaded-image":
          "Downloaded file is not a supported image",
        "image-client-error-unsupported-downloaded-image-detail":
          "Image download succeeded, but the response could not be identified as PNG, JPEG, WebP, or GIF.",
        "image-client-error-empty-image-url": "Empty image URL",
        "image-client-error-download-status": "Unknown status",
      },
      () => {
        expect(
          getString("image-client-error-custom-header-name-detail", {
            args: { name: "Bad Header" },
          }),
        ).to.equal('Header name "Bad Header" is invalid');
        expect(getString("image-client-error-no-image-data-detail")).to.equal(
          "No image data was recognized in the OpenAI-compatible API response.",
        );
        expect(
          getString("image-client-error-text-not-image-detail", {
            args: { text: "plain text" },
          }),
        ).to.equal(
          "The model returned text instead of an image. Check whether the model supports image generation. Returned content: plain text...",
        );
        expect(getString("image-client-error-api-key-missing")).to.equal(
          "One-image summary API key is not configured",
        );
        expect(
          getString("image-client-error-unsupported-downloaded-image"),
        ).to.equal("Downloaded file is not a supported image");
        expect(
          getString("image-client-error-unsupported-downloaded-image-detail"),
        ).to.equal(
          "Image download succeeded, but the response could not be identified as PNG, JPEG, WebP, or GIF.",
        );
        expect(getString("image-client-error-empty-image-url")).to.equal(
          "Empty image URL",
        );
        expect(getString("image-client-error-download-status")).to.equal(
          "Unknown status",
        );
      },
    );
  });

  it("formats localized generated-note titles and status tooltips", function () {
    withMessages(
      {
        "deep-read-note-title": "AI 精读 - { $title }",
        "deep-read-chapter-list-item": "第{ $index }章：{ $title }",
        "image-note-title-prefix": "AI 管家一图总结 -",
        "itempane-error-open-dialog-unavailable":
          "无法打开查看器：openDialog 不可用",
        "itempane-error-viewer-window-failed": "打开查看器窗口失败",
        "itempane-error-document-body-unavailable": "当前文档没有可用的 body",
        "library-status-tooltip-failed-with-error":
          "{ $label }失败：{ $error }",
        "library-status-tooltip-idle": "未{ $label }",
      },
      () => {
        expect(
          getString("deep-read-note-title", { args: { title: "Paper" } }),
        ).to.equal("AI 精读 - Paper");
        expect(
          getString("deep-read-chapter-list-item", {
            args: { index: 3, title: "Method" },
          }),
        ).to.equal("第3章：Method");
        expect(getString("image-note-title-prefix")).to.equal(
          "AI 管家一图总结 -",
        );
        expect(getString("itempane-error-open-dialog-unavailable")).to.equal(
          "无法打开查看器：openDialog 不可用",
        );
        expect(getString("itempane-error-viewer-window-failed")).to.equal(
          "打开查看器窗口失败",
        );
        expect(getString("itempane-error-document-body-unavailable")).to.equal(
          "当前文档没有可用的 body",
        );
        expect(
          getString("library-status-tooltip-failed-with-error", {
            args: { label: "AI 总结", error: "boom" },
          }),
        ).to.equal("AI 总结失败：boom");
        expect(
          getString("library-status-tooltip-idle", {
            args: { label: "总结" },
          }),
        ).to.equal("未总结");
      },
    );

    withMessages(
      {
        "deep-read-note-title": "AI Deep Reading - { $title }",
        "deep-read-chapter-list-item": "Chapter { $index}: { $title }",
        "image-note-title-prefix": "AI Butler One-Image Summary -",
        "itempane-error-open-dialog-unavailable":
          "Cannot open viewer: openDialog is not available",
        "itempane-error-viewer-window-failed": "Failed to open viewer window",
        "itempane-error-document-body-unavailable":
          "Document body is not available",
        "library-status-tooltip-failed-with-error":
          "{ $label } failed: { $error }",
        "library-status-tooltip-idle": "No { $label } yet",
      },
      () => {
        expect(
          getString("deep-read-note-title", { args: { title: "Paper" } }),
        ).to.equal("AI Deep Reading - Paper");
        expect(
          getString("deep-read-chapter-list-item", {
            args: { index: 3, title: "Method" },
          }),
        ).to.equal("Chapter 3: Method");
        expect(getString("image-note-title-prefix")).to.equal(
          "AI Butler One-Image Summary -",
        );
        expect(getString("itempane-error-open-dialog-unavailable")).to.equal(
          "Cannot open viewer: openDialog is not available",
        );
        expect(getString("itempane-error-viewer-window-failed")).to.equal(
          "Failed to open viewer window",
        );
        expect(getString("itempane-error-document-body-unavailable")).to.equal(
          "Document body is not available",
        );
        expect(
          getString("library-status-tooltip-failed-with-error", {
            args: { label: "AI Summary", error: "boom" },
          }),
        ).to.equal("AI Summary failed: boom");
        expect(
          getString("library-status-tooltip-idle", {
            args: { label: "summary" },
          }),
        ).to.equal("No summary yet");
      },
    );
  });

  it("formats localized note export warnings", function () {
    withMessages(
      {
        "note-export-warning-docx-failed":
          "{ $kind } DOCX 导出失败：{ $message }",
        "note-export-warning-markdown-failed":
          "{ $kind } Markdown 导出失败：{ $message }",
        "note-export-warning-attachment-unreadable":
          "附件不存在或不可读：{ $title }",
        "note-export-warning-attachment-failed":
          "附件 { $id } 导出失败：{ $message }",
        "note-export-untitled-collection": "未命名分类",
      },
      () => {
        expect(
          getString("note-export-warning-docx-failed", {
            args: { kind: "AI 总结", message: "boom" },
          }),
        ).to.equal("AI 总结 DOCX 导出失败：boom");
        expect(
          getString("note-export-warning-markdown-failed", {
            args: { kind: "AI 精读", message: "boom" },
          }),
        ).to.equal("AI 精读 Markdown 导出失败：boom");
        expect(
          getString("note-export-warning-attachment-unreadable", {
            args: { title: "Paper.pdf" },
          }),
        ).to.equal("附件不存在或不可读：Paper.pdf");
        expect(
          getString("note-export-warning-attachment-failed", {
            args: { id: 12, message: "denied" },
          }),
        ).to.equal("附件 12 导出失败：denied");
        expect(getString("note-export-untitled-collection")).to.equal(
          "未命名分类",
        );
      },
    );

    withMessages(
      {
        "note-export-warning-docx-failed":
          "{ $kind } DOCX export failed: { $message }",
        "note-export-warning-markdown-failed":
          "{ $kind } Markdown export failed: { $message }",
        "note-export-warning-attachment-unreadable":
          "Attachment does not exist or is unreadable: { $title }",
        "note-export-warning-attachment-failed":
          "Attachment { $id } export failed: { $message }",
        "note-export-untitled-collection": "Untitled collection",
      },
      () => {
        expect(
          getString("note-export-warning-docx-failed", {
            args: { kind: "AI Summary", message: "boom" },
          }),
        ).to.equal("AI Summary DOCX export failed: boom");
        expect(
          getString("note-export-warning-markdown-failed", {
            args: { kind: "AI Deep Reading", message: "boom" },
          }),
        ).to.equal("AI Deep Reading Markdown export failed: boom");
        expect(
          getString("note-export-warning-attachment-unreadable", {
            args: { title: "Paper.pdf" },
          }),
        ).to.equal("Attachment does not exist or is unreadable: Paper.pdf");
        expect(
          getString("note-export-warning-attachment-failed", {
            args: { id: 12, message: "denied" },
          }),
        ).to.equal("Attachment 12 export failed: denied");
        expect(getString("note-export-untitled-collection")).to.equal(
          "Untitled collection",
        );
      },
    );
  });

  it("formats localized deep-read body and saved-summary messages", function () {
    withMessages(
      {
        "note-generator-error-invalid-source-item":
          "AI 总结/精读仅支持顶层文献条目，请不要对笔记、附件或子条目运行。",
        "note-generator-deep-read-detected-chapters":
          "识别到章节：{ $chapters }",
        "note-generator-deep-read-chapter-pair": "{ $zh }（{ $en }）",
        "note-generator-deep-read-reading-heading": "### 正在精读：{ $title }",
        "note-generator-deep-read-template-changed-resume-saved":
          "模板已变更；将使用笔记中保存的模板继续。",
        "note-generator-deep-read-template-changed-resume-current":
          "模板已变更；已保存笔记没有模板快照，将使用当前模板继续。",
        "note-generator-deep-read-retry-slot-already-done":
          "该阶段已完成，已跳过重试。",
        "summary-saved-note-not-found": "未找到已保存的 AI 总结笔记。",
        "summary-saved-note-load-failed": "无法加载该条目的已保存总结。",
      },
      () => {
        expect(getString("note-generator-error-invalid-source-item")).to.equal(
          "AI 总结/精读仅支持顶层文献条目，请不要对笔记、附件或子条目运行。",
        );
        const pair = getString("note-generator-deep-read-chapter-pair", {
          args: { zh: "方法", en: "Methods" },
        });
        expect(
          getString("note-generator-deep-read-detected-chapters", {
            args: { chapters: pair },
          }),
        ).to.equal("识别到章节：方法（Methods）");
        expect(
          getString("note-generator-deep-read-reading-heading", {
            args: { title: "方法" },
          }),
        ).to.equal("### 正在精读：方法");
        expect(getString("summary-saved-note-not-found")).to.equal(
          "未找到已保存的 AI 总结笔记。",
        );
        expect(getString("summary-saved-note-load-failed")).to.equal(
          "无法加载该条目的已保存总结。",
        );
      },
    );

    withMessages(
      {
        "note-generator-error-invalid-source-item":
          "AI Summary/Deep Reading only supports top-level literature items. Do not run it on notes, attachments, or child items.",
        "note-generator-deep-read-detected-chapters":
          "Detected chapters: { $chapters }",
        "note-generator-deep-read-chapter-pair": "{ $zh } ({ $en })",
        "note-generator-deep-read-reading-heading": "### Reading: { $title }",
        "note-generator-deep-read-template-changed-resume-saved":
          "Template changed; resuming with the template saved in the note.",
        "note-generator-deep-read-template-changed-resume-current":
          "Template changed; saved note has no template snapshot, resuming with the current template.",
        "note-generator-deep-read-retry-slot-already-done":
          "This stage is already done; retry skipped.",
        "summary-saved-note-not-found": "No saved AI summary note was found.",
        "summary-saved-note-load-failed":
          "Unable to load the saved summary for this item.",
      },
      () => {
        expect(getString("note-generator-error-invalid-source-item")).to.equal(
          "AI Summary/Deep Reading only supports top-level literature items. Do not run it on notes, attachments, or child items.",
        );
        const pair = getString("note-generator-deep-read-chapter-pair", {
          args: { zh: "方法", en: "Methods" },
        });
        expect(
          getString("note-generator-deep-read-detected-chapters", {
            args: { chapters: pair },
          }),
        ).to.equal("Detected chapters: 方法 (Methods)");
        expect(
          getString("note-generator-deep-read-reading-heading", {
            args: { title: "Methods" },
          }),
        ).to.equal("### Reading: Methods");
        expect(getString("summary-saved-note-not-found")).to.equal(
          "No saved AI summary note was found.",
        );
        expect(getString("summary-saved-note-load-failed")).to.equal(
          "Unable to load the saved summary for this item.",
        );
      },
    );
  });

  it("formats localized item-pane editing and quick-chat controls", function () {
    withMessages(
      {
        "itempane-note-edit-summary": "编辑 AI 总结",
        "itempane-note-save-summary-tooltip": "保存侧边栏内的 AI 总结修改",
        "itempane-note-edit-failed": "编辑失败: { $message }",
        "itempane-note-stale-error":
          "当前 AI 总结 / AI 精读已在其他地方更新，请复制草稿后刷新再编辑。",
        "itempane-note-editing-skip-auto-refresh": "编辑中，已跳过自动刷新。",
        "itempane-quick-chat-decrease-font": "减小快速追问字号",
        "itempane-quick-chat-source-label": "来自快速追问",
      },
      () => {
        expect(getString("itempane-note-edit-summary")).to.equal(
          "编辑 AI 总结",
        );
        expect(getString("itempane-note-save-summary-tooltip")).to.equal(
          "保存侧边栏内的 AI 总结修改",
        );
        expect(
          getString("itempane-note-edit-failed", {
            args: { message: "boom" },
          }),
        ).to.equal("编辑失败: boom");
        expect(getString("itempane-note-stale-error")).to.equal(
          "当前 AI 总结 / AI 精读已在其他地方更新，请复制草稿后刷新再编辑。",
        );
        expect(getString("itempane-note-editing-skip-auto-refresh")).to.equal(
          "编辑中，已跳过自动刷新。",
        );
        expect(getString("itempane-quick-chat-decrease-font")).to.equal(
          "减小快速追问字号",
        );
        expect(getString("itempane-quick-chat-source-label")).to.equal(
          "来自快速追问",
        );
      },
    );

    withMessages(
      {
        "itempane-note-edit-summary": "Edit AI Summary",
        "itempane-note-save-summary-tooltip":
          "Save AI Summary edits in the sidebar",
        "itempane-note-edit-failed": "Edit failed: { $message }",
        "itempane-note-stale-error":
          "The current AI Summary / AI Deep Reading note was updated elsewhere. Copy your draft, refresh, and edit again.",
        "itempane-note-editing-skip-auto-refresh":
          "Editing; automatic refresh was skipped.",
        "itempane-quick-chat-decrease-font": "Decrease Quick Ask font size",
        "itempane-quick-chat-source-label": "From Quick Ask",
      },
      () => {
        expect(getString("itempane-note-edit-summary")).to.equal(
          "Edit AI Summary",
        );
        expect(getString("itempane-note-save-summary-tooltip")).to.equal(
          "Save AI Summary edits in the sidebar",
        );
        expect(
          getString("itempane-note-edit-failed", {
            args: { message: "boom" },
          }),
        ).to.equal("Edit failed: boom");
        expect(getString("itempane-note-stale-error")).to.equal(
          "The current AI Summary / AI Deep Reading note was updated elsewhere. Copy your draft, refresh, and edit again.",
        );
        expect(getString("itempane-note-editing-skip-auto-refresh")).to.equal(
          "Editing; automatic refresh was skipped.",
        );
        expect(getString("itempane-quick-chat-decrease-font")).to.equal(
          "Decrease Quick Ask font size",
        );
        expect(getString("itempane-quick-chat-source-label")).to.equal(
          "From Quick Ask",
        );
      },
    );
  });

  it("formats localized summary stop messages and task queue stage labels", function () {
    withMessages(
      {
        "summary-chat-stopped-not-saved": "已终止，本轮不会保存或加入上下文。",
        "summary-chat-stopped-empty": "已终止，未生成内容。",
        "summary-preview-prefix": "摘要：{ $text }",
        "task-queue-stage-waiting": "等待处理",
        "task-queue-tooltip-current-stage": "当前阶段：{ $stage }",
        "task-queue-progress-failed-at": "失败于 { $progress }%",
        "task-queue-status-badge-priority": "🔥 优先处理",
      },
      () => {
        expect(getString("summary-chat-stopped-not-saved")).to.equal(
          "已终止，本轮不会保存或加入上下文。",
        );
        expect(getString("summary-chat-stopped-empty")).to.equal(
          "已终止，未生成内容。",
        );
        expect(
          getString("summary-preview-prefix", { args: { text: "abc" } }),
        ).to.equal("摘要：abc");
        expect(getString("task-queue-stage-waiting")).to.equal("等待处理");
        expect(
          getString("task-queue-tooltip-current-stage", {
            args: { stage: "解析 PDF" },
          }),
        ).to.equal("当前阶段：解析 PDF");
        expect(
          getString("task-queue-progress-failed-at", {
            args: { progress: 42 },
          }),
        ).to.equal("失败于 42%");
        expect(getString("task-queue-status-badge-priority")).to.equal(
          "🔥 优先处理",
        );
      },
    );

    withMessages(
      {
        "summary-chat-stopped-not-saved":
          "Stopped. This round will not be saved or added to the context.",
        "summary-chat-stopped-empty": "Stopped. No content was generated.",
        "summary-preview-prefix": "Summary: { $text }",
        "task-queue-stage-waiting": "Waiting",
        "task-queue-tooltip-current-stage": "Current stage: { $stage }",
        "task-queue-progress-failed-at": "Failed at { $progress }%",
        "task-queue-status-badge-priority": "🔥 Priority",
      },
      () => {
        expect(getString("summary-chat-stopped-not-saved")).to.equal(
          "Stopped. This round will not be saved or added to the context.",
        );
        expect(getString("summary-chat-stopped-empty")).to.equal(
          "Stopped. No content was generated.",
        );
        expect(
          getString("summary-preview-prefix", { args: { text: "abc" } }),
        ).to.equal("Summary: abc");
        expect(getString("task-queue-stage-waiting")).to.equal("Waiting");
        expect(
          getString("task-queue-tooltip-current-stage", {
            args: { stage: "Parsing PDF" },
          }),
        ).to.equal("Current stage: Parsing PDF");
        expect(
          getString("task-queue-progress-failed-at", {
            args: { progress: 42 },
          }),
        ).to.equal("Failed at 42%");
        expect(getString("task-queue-status-badge-priority")).to.equal(
          "🔥 Priority",
        );
      },
    );
  });

  it("formats localized generated-note metadata and note-body labels", function () {
    withMessages(
      {
        "itempane-note-empty-kind": "暂无 { $kind }",
        "itempane-note-kind-summary": "AI 总结",
        "itempane-note-deleted-kind": "已删除 { $kind }",
        "deep-read-slot-running-placeholder": "🔄 正在生成...",
        "image-note-caption": "由 AI 管家自动生成的学术概念海报",
        "llm-metadata-selector-provider-model":
          "供应商: { $provider } 模型: { $model } · { $generated } ⓘ",
        "llm-metadata-unknown-provider": "未知供应商",
        "llm-metadata-unknown-model": "未知",
        "llm-metadata-tooltip-provider": "供应商：{ $provider }",
        "llm-metadata-tooltip-model": "模型：{ $model }",
        "llm-metadata-tooltip-generated": "生成时间：{ $generated }",
        "itempane-note-xml-parse-unknown": "未知 XML 解析错误",
        "itempane-note-xml-location": "第 { $line } 行，第 { $column } 列",
        "itempane-note-xml-copy-title": "XML 解析错误",
        "itempane-note-xml-copy-location": "位置：{ $location }",
        "itempane-note-xml-copy-context": "上下文：",
        "follow-up-note-assistant-label": "🤖 AI 管家:",
      },
      () => {
        const kind = getString("itempane-note-kind-summary");
        expect(
          getString("itempane-note-empty-kind", { args: { kind } }),
        ).to.equal("暂无 AI 总结");
        expect(
          getString("itempane-note-deleted-kind", { args: { kind } }),
        ).to.equal("已删除 AI 总结");
        expect(getString("deep-read-slot-running-placeholder")).to.equal(
          "🔄 正在生成...",
        );
        expect(getString("image-note-caption")).to.equal(
          "由 AI 管家自动生成的学术概念海报",
        );
        expect(
          getString("llm-metadata-selector-provider-model", {
            args: { provider: "OpenAI", model: "gpt", generated: "now" },
          }),
        ).to.equal("供应商: OpenAI 模型: gpt · now ⓘ");
        const zhMetadataTooltip = LLMNoteMetadataService.formatTooltip({
          schema: "AI_BUTLER_LLM_NOTE_BLOCK",
          version: 1,
          blockId: "test",
          task: "summary",
          providerId: "unknown",
          providerName: "Unknown provider",
          modelId: "unknown",
          generatedAt: "2020-01-01T00:00:00.000Z",
        });
        expect(zhMetadataTooltip).to.include("供应商：未知供应商");
        expect(zhMetadataTooltip).to.include("模型：未知");
        expect(zhMetadataTooltip).to.include("生成时间：");
        expect(
          getString("itempane-note-xml-location", {
            args: { line: 3, column: 5 },
          }),
        ).to.equal("第 3 行，第 5 列");
        expect(getString("itempane-note-xml-copy-title")).to.equal(
          "XML 解析错误",
        );
        expect(
          getString("itempane-note-xml-copy-location", {
            args: { location: "第 3 行，第 5 列" },
          }),
        ).to.equal("位置：第 3 行，第 5 列");
        expect(getString("itempane-note-xml-copy-context")).to.equal(
          "上下文：",
        );
        expect(getString("follow-up-note-assistant-label")).to.equal(
          "🤖 AI 管家:",
        );
      },
    );

    withMessages(
      {
        "itempane-note-empty-kind": "No { $kind }",
        "itempane-note-kind-summary": "AI Summary",
        "itempane-note-deleted-kind": "Deleted { $kind }",
        "deep-read-slot-running-placeholder": "🔄 Generating...",
        "image-note-caption":
          "Academic concept poster automatically generated by AI Butler",
        "llm-metadata-selector-provider-model":
          "Provider: { $provider } Model: { $model } · { $generated } ⓘ",
        "llm-metadata-unknown-provider": "Unknown provider",
        "llm-metadata-unknown-model": "unknown",
        "llm-metadata-tooltip-provider": "Provider: { $provider }",
        "llm-metadata-tooltip-model": "Model: { $model }",
        "llm-metadata-tooltip-generated": "Generated: { $generated }",
        "itempane-note-xml-parse-unknown": "Unknown XML parsing error",
        "itempane-note-xml-location": "Line { $line }, Column { $column }",
        "itempane-note-xml-copy-title": "XML Parsing Error",
        "itempane-note-xml-copy-location": "Location: { $location }",
        "itempane-note-xml-copy-context": "Context:",
        "follow-up-note-assistant-label": "🤖 AI Butler:",
      },
      () => {
        const kind = getString("itempane-note-kind-summary");
        expect(
          getString("itempane-note-empty-kind", { args: { kind } }),
        ).to.equal("No AI Summary");
        expect(
          getString("itempane-note-deleted-kind", { args: { kind } }),
        ).to.equal("Deleted AI Summary");
        expect(getString("deep-read-slot-running-placeholder")).to.equal(
          "🔄 Generating...",
        );
        expect(getString("image-note-caption")).to.equal(
          "Academic concept poster automatically generated by AI Butler",
        );
        expect(
          getString("llm-metadata-selector-provider-model", {
            args: { provider: "OpenAI", model: "gpt", generated: "now" },
          }),
        ).to.equal("Provider: OpenAI Model: gpt · now ⓘ");
        const enMetadataTooltip = LLMNoteMetadataService.formatTooltip({
          schema: "AI_BUTLER_LLM_NOTE_BLOCK",
          version: 1,
          blockId: "test",
          task: "summary",
          providerId: "unknown",
          providerName: "Unknown provider",
          modelId: "unknown",
          generatedAt: "2020-01-01T00:00:00.000Z",
        });
        expect(enMetadataTooltip).to.include("Provider: Unknown provider");
        expect(enMetadataTooltip).to.include("Model: unknown");
        expect(enMetadataTooltip).to.include("Generated:");
        expect(
          getString("itempane-note-xml-location", {
            args: { line: 3, column: 5 },
          }),
        ).to.equal("Line 3, Column 5");
        expect(getString("itempane-note-xml-copy-title")).to.equal(
          "XML Parsing Error",
        );
        expect(
          getString("itempane-note-xml-copy-location", {
            args: { location: "Line 3, Column 5" },
          }),
        ).to.equal("Location: Line 3, Column 5");
        expect(getString("itempane-note-xml-copy-context")).to.equal(
          "Context:",
        );
        expect(getString("follow-up-note-assistant-label")).to.equal(
          "🤖 AI Butler:",
        );
      },
    );
  });

  it("formats localized summary view and onboarding task status labels", function () {
    withMessages(
      {
        "task-status-pending": "等待中",
        "task-status-completed": "已完成",
        "summary-title": "AI 总结输出",
        "summary-chat-open": "打开追问",
        "summary-chat-input-placeholder": "在这里输入您的问题...",
        "summary-error-inline": "出错：{ $error }",
        "summary-chat-note-title": "AI 管家追问 - { $title }",
        "summary-loading-elapsed": "已用时 { $seconds } 秒",
        "summary-queue-button-ready": "查看任务队列",
      },
      () => {
        expect(getString("task-status-pending")).to.equal("等待中");
        expect(getString("task-status-completed")).to.equal("已完成");
        expect(getString("summary-title")).to.equal("AI 总结输出");
        expect(getString("summary-chat-open")).to.equal("打开追问");
        expect(getString("summary-chat-input-placeholder")).to.equal(
          "在这里输入您的问题...",
        );
        expect(
          getString("summary-error-inline", { args: { error: "boom" } }),
        ).to.equal("出错：boom");
        expect(
          getString("summary-chat-note-title", { args: { title: "Paper" } }),
        ).to.equal("AI 管家追问 - Paper");
        expect(
          getString("summary-loading-elapsed", { args: { seconds: 12 } }),
        ).to.equal("已用时 12 秒");
        expect(getString("summary-queue-button-ready")).to.equal(
          "查看任务队列",
        );
      },
    );

    withMessages(
      {
        "task-status-pending": "Pending",
        "task-status-completed": "Completed",
        "summary-title": "AI Summary Output",
        "summary-chat-open": "Open Follow-up",
        "summary-chat-input-placeholder": "Type your question here...",
        "summary-error-inline": "Error: { $error }",
        "summary-chat-note-title": "AI Butler Follow-up - { $title }",
        "summary-loading-elapsed": "Elapsed { $seconds }s",
        "summary-queue-button-ready": "View Task Queue",
      },
      () => {
        expect(getString("task-status-pending")).to.equal("Pending");
        expect(getString("task-status-completed")).to.equal("Completed");
        expect(getString("summary-title")).to.equal("AI Summary Output");
        expect(getString("summary-chat-open")).to.equal("Open Follow-up");
        expect(getString("summary-chat-input-placeholder")).to.equal(
          "Type your question here...",
        );
        expect(
          getString("summary-error-inline", { args: { error: "boom" } }),
        ).to.equal("Error: boom");
        expect(
          getString("summary-chat-note-title", { args: { title: "Paper" } }),
        ).to.equal("AI Butler Follow-up - Paper");
        expect(
          getString("summary-loading-elapsed", { args: { seconds: 12 } }),
        ).to.equal("Elapsed 12s");
        expect(getString("summary-queue-button-ready")).to.equal(
          "View Task Queue",
        );
      },
    );
  });

  it("formats localized scanner, settings validation, and task runtime labels", function () {
    withMessages(
      {
        "library-scanner-unfiled-items": "未分类文献",
        "library-scanner-unnamed-item": "未命名条目 { $id }",
        "settings-api-validation-missing-fields":
          "请填写以下必填项: { $fields }",
        "settings-api-field-gemini-api-key": "API 密钥(Gemini)",
        "task-stage-waiting-start": "等待开始",
        "task-title-review": "综述 { $collection }",
        "task-detail-artifact-exists-skipped": "已存在，跳过生成",
        "task-progress-artifact-exists-skipped": "AI 产物已存在，已跳过",
        "task-progress-artifact-ready-completed": "AI 产物已完整，已标记完成",
      },
      () => {
        expect(getString("library-scanner-unfiled-items")).to.equal(
          "未分类文献",
        );
        expect(
          getString("library-scanner-unnamed-item", { args: { id: "#12" } }),
        ).to.equal("未命名条目 #12");
        expect(
          getString("settings-api-validation-missing-fields", {
            args: { fields: "• API 密钥(Gemini)" },
          }),
        ).to.equal("请填写以下必填项: • API 密钥(Gemini)");
        expect(getString("settings-api-field-gemini-api-key")).to.equal(
          "API 密钥(Gemini)",
        );
        expect(getString("task-stage-waiting-start")).to.equal("等待开始");
        expect(
          getString("task-title-review", { args: { collection: "测试分类" } }),
        ).to.equal("综述 测试分类");
        expect(getString("task-detail-artifact-exists-skipped")).to.equal(
          "已存在，跳过生成",
        );
        expect(getString("task-progress-artifact-exists-skipped")).to.equal(
          "AI 产物已存在，已跳过",
        );
        expect(getString("task-progress-artifact-ready-completed")).to.equal(
          "AI 产物已完整，已标记完成",
        );
      },
    );

    withMessages(
      {
        "library-scanner-unfiled-items": "Unfiled papers",
        "library-scanner-unnamed-item": "Untitled item { $id }",
        "settings-api-validation-missing-fields":
          "Please fill in the following required fields: { $fields }",
        "settings-api-field-gemini-api-key": "API Key (Gemini)",
        "task-stage-waiting-start": "Waiting to start",
        "task-title-review": "Review { $collection }",
        "task-detail-artifact-exists-skipped":
          "Already exists; skipped generation",
        "task-progress-artifact-exists-skipped":
          "AI artifact already exists; skipped",
        "task-progress-artifact-ready-completed":
          "AI artifact already complete; marked completed",
      },
      () => {
        expect(getString("library-scanner-unfiled-items")).to.equal(
          "Unfiled papers",
        );
        expect(
          getString("library-scanner-unnamed-item", { args: { id: "#12" } }),
        ).to.equal("Untitled item #12");
        expect(
          getString("settings-api-validation-missing-fields", {
            args: { fields: "• API Key (Gemini)" },
          }),
        ).to.equal(
          "Please fill in the following required fields: • API Key (Gemini)",
        );
        expect(getString("settings-api-field-gemini-api-key")).to.equal(
          "API Key (Gemini)",
        );
        expect(getString("task-stage-waiting-start")).to.equal(
          "Waiting to start",
        );
        expect(
          getString("task-title-review", { args: { collection: "Demo" } }),
        ).to.equal("Review Demo");
        expect(getString("task-detail-artifact-exists-skipped")).to.equal(
          "Already exists; skipped generation",
        );
        expect(getString("task-progress-artifact-exists-skipped")).to.equal(
          "AI artifact already exists; skipped",
        );
        expect(getString("task-progress-artifact-ready-completed")).to.equal(
          "AI artifact already complete; marked completed",
        );
      },
    );
  });

  it("formats localized LLM runtime and main-window errors", function () {
    withMessages(
      {
        "llm-error-no-enabled-endpoints": "未配置可用的 LLM Endpoint",
        "llm-error-endpoint-not-found": "未找到 LLM Endpoint：{ $endpointId }",
        "llm-error-endpoint-disabled": "LLM Endpoint 已禁用：{ $endpoint }",
        "llm-error-unknown-provider-type":
          "Endpoint “{ $endpoint }” 的供应商类型未知：{ $provider }。可用供应商：{ $available }",
        "llm-error-provider-multi-file-unsupported":
          "供应商 { $provider } 不支持多文件生成",
        "llm-error-chat-multi-file-unsupported": "对话请求不支持多文件输入",
        "llm-error-all-endpoints-failed":
          "所有已配置的 LLM Endpoint 均调用失败。",
        "main-window-error-open-dialog-unavailable":
          "无法打开 AI Butler 窗口：Zotero 主窗口不支持 openDialog",
        "llm-note-metadata-error-block-not-found":
          "未找到 LLM 笔记块：{ $blockId }",
      },
      () => {
        expect(getString("llm-error-no-enabled-endpoints")).to.equal(
          "未配置可用的 LLM Endpoint",
        );
        expect(
          getString("llm-error-endpoint-not-found", {
            args: { endpointId: "ep-1" },
          }),
        ).to.equal("未找到 LLM Endpoint：ep-1");
        expect(
          getString("llm-error-endpoint-disabled", {
            args: { endpoint: "Demo" },
          }),
        ).to.equal("LLM Endpoint 已禁用：Demo");
        expect(
          getString("llm-error-unknown-provider-type", {
            args: { endpoint: "Demo", provider: "x", available: "openai" },
          }),
        ).to.equal("Endpoint “Demo” 的供应商类型未知：x。可用供应商：openai");
        expect(
          getString("llm-error-provider-multi-file-unsupported", {
            args: { provider: "ollama" },
          }),
        ).to.equal("供应商 ollama 不支持多文件生成");
        expect(getString("llm-error-chat-multi-file-unsupported")).to.equal(
          "对话请求不支持多文件输入",
        );
        expect(getString("llm-error-all-endpoints-failed")).to.equal(
          "所有已配置的 LLM Endpoint 均调用失败。",
        );
        expect(getString("main-window-error-open-dialog-unavailable")).to.equal(
          "无法打开 AI Butler 窗口：Zotero 主窗口不支持 openDialog",
        );
        expect(
          getString("llm-note-metadata-error-block-not-found", {
            args: { blockId: "summary" },
          }),
        ).to.equal("未找到 LLM 笔记块：summary");
      },
    );

    withMessages(
      {
        "llm-error-no-enabled-endpoints":
          "No enabled LLM endpoints are configured",
        "llm-error-endpoint-not-found":
          "LLM endpoint not found: { $endpointId }",
        "llm-error-endpoint-disabled":
          "LLM endpoint is disabled: { $endpoint }",
        "llm-error-unknown-provider-type":
          "Unknown provider type for endpoint “{ $endpoint }”: { $provider }. Available: { $available }",
        "llm-error-provider-multi-file-unsupported":
          "Provider { $provider } does not support multi-file generation",
        "llm-error-chat-multi-file-unsupported":
          "Chat requests do not support multi-file input",
        "llm-error-all-endpoints-failed":
          "All configured LLM endpoints failed.",
        "main-window-error-open-dialog-unavailable":
          "Cannot open AI Butler window: openDialog is not available on Zotero main window",
        "llm-note-metadata-error-block-not-found":
          "LLM note block not found: { $blockId }",
      },
      () => {
        expect(getString("llm-error-no-enabled-endpoints")).to.equal(
          "No enabled LLM endpoints are configured",
        );
        expect(
          getString("llm-error-endpoint-not-found", {
            args: { endpointId: "ep-1" },
          }),
        ).to.equal("LLM endpoint not found: ep-1");
        expect(
          getString("llm-error-endpoint-disabled", {
            args: { endpoint: "Demo" },
          }),
        ).to.equal("LLM endpoint is disabled: Demo");
        expect(
          getString("llm-error-unknown-provider-type", {
            args: { endpoint: "Demo", provider: "x", available: "openai" },
          }),
        ).to.equal(
          "Unknown provider type for endpoint “Demo”: x. Available: openai",
        );
        expect(
          getString("llm-error-provider-multi-file-unsupported", {
            args: { provider: "ollama" },
          }),
        ).to.equal("Provider ollama does not support multi-file generation");
        expect(getString("llm-error-chat-multi-file-unsupported")).to.equal(
          "Chat requests do not support multi-file input",
        );
        expect(getString("llm-error-all-endpoints-failed")).to.equal(
          "All configured LLM endpoints failed.",
        );
        expect(getString("main-window-error-open-dialog-unavailable")).to.equal(
          "Cannot open AI Butler window: openDialog is not available on Zotero main window",
        );
        expect(
          getString("llm-note-metadata-error-block-not-found", {
            args: { blockId: "summary" },
          }),
        ).to.equal("LLM note block not found: summary");
      },
    );
  });

  it("formats localized provider connection test and diagnostic reports", function () {
    withMessages(
      {
        "provider-test-success-detail":
          "Mode: { $mode }\n✅ 连接成功!\n模型: { $model }\n响应: { $response }\n\n--- 原始响应 ---\n{ $rawResponse }",
        "provider-error-timeout": "Timeout: 请求超过 { $ms } ms",
        "provider-test-error-status-code": "状态码: { $value }",
        "provider-test-error-request-body": "请求体: { $value }",
        "provider-error-model-list-failed": "获取模型列表失败",
      },
      () => {
        expect(
          getString("provider-test-success-detail", {
            args: {
              mode: "Text",
              model: "demo",
              response: "OK",
              rawResponse: "{}",
            },
          }),
        ).to.equal(
          "Mode: Text\n✅ 连接成功!\n模型: demo\n响应: OK\n\n--- 原始响应 ---\n{}",
        );
        expect(
          getString("provider-error-timeout", { args: { ms: 30000 } }),
        ).to.equal("Timeout: 请求超过 30000 ms");
        expect(
          getString("provider-test-error-status-code", {
            args: { value: 429 },
          }),
        ).to.equal("状态码: 429");
        expect(
          getString("provider-test-error-request-body", {
            args: { value: "body" },
          }),
        ).to.equal("请求体: body");
        expect(getString("provider-error-model-list-failed")).to.equal(
          "获取模型列表失败",
        );
      },
    );

    withMessages(
      {
        "provider-test-success-detail":
          "Mode: { $mode }\n✅ Connection succeeded!\nModel: { $model }\nResponse: { $response }\n\n--- Raw response ---\n{ $rawResponse }",
        "provider-error-timeout": "Timeout: request exceeded { $ms } ms",
        "provider-test-error-status-code": "Status code: { $value }",
        "provider-test-error-request-body": "Request body: { $value }",
        "provider-error-model-list-failed": "Failed to fetch model list",
      },
      () => {
        expect(
          getString("provider-test-success-detail", {
            args: {
              mode: "Text",
              model: "demo",
              response: "OK",
              rawResponse: "{}",
            },
          }),
        ).to.equal(
          "Mode: Text\n✅ Connection succeeded!\nModel: demo\nResponse: OK\n\n--- Raw response ---\n{}",
        );
        expect(
          getString("provider-error-timeout", { args: { ms: 30000 } }),
        ).to.equal("Timeout: request exceeded 30000 ms");
        expect(
          getString("provider-test-error-status-code", {
            args: { value: 429 },
          }),
        ).to.equal("Status code: 429");
        expect(
          getString("provider-test-error-request-body", {
            args: { value: "body" },
          }),
        ).to.equal("Request body: body");
        expect(getString("provider-error-model-list-failed")).to.equal(
          "Failed to fetch model list",
        );
      },
    );
  });

  it("formats localized literature review table note structure", function () {
    withMessages(
      {
        "literature-review-table-column-dimension": "维度",
        "literature-review-table-column-content": "内容",
        "literature-review-table-note-title":
          "<h2>📊 文献表格 - { $title }</h2>",
        "literature-review-table-raw-cache-caption":
          "👇 以下为系统缓存的原始 Markdown 数据（用于追加填表，请勿修改）：",
        "literature-review-table-structure-heading":
          "**表格结构定义（以下每篇文献的数据行均遵循此表头）：**",
        "literature-review-table-fill-failed-inline":
          "(填表失败: { $message })",
        "literature-review-table-append-failed-inline":
          "(追加填表失败: { $message })",
        "literature-review-unknown-title": "未知标题",
        "literature-review-unknown-value": "未知",
      },
      () => {
        expect(getString("literature-review-table-column-dimension")).to.equal(
          "维度",
        );
        expect(getString("literature-review-table-column-content")).to.equal(
          "内容",
        );
        expect(
          getString("literature-review-table-note-title", {
            args: { title: "Paper A" },
          }),
        ).to.equal("<h2>📊 文献表格 - Paper A</h2>");
        expect(getString("literature-review-table-raw-cache-caption")).to.equal(
          "👇 以下为系统缓存的原始 Markdown 数据（用于追加填表，请勿修改）：",
        );
        expect(getString("literature-review-table-structure-heading")).to.equal(
          "**表格结构定义（以下每篇文献的数据行均遵循此表头）：**",
        );
        expect(
          getString("literature-review-table-fill-failed-inline", {
            args: { message: "boom" },
          }),
        ).to.equal("(填表失败: boom)");
        expect(
          getString("literature-review-table-append-failed-inline", {
            args: { message: "boom" },
          }),
        ).to.equal("(追加填表失败: boom)");
        expect(getString("literature-review-unknown-title")).to.equal(
          "未知标题",
        );
        expect(getString("literature-review-unknown-value")).to.equal("未知");
      },
    );

    withMessages(
      {
        "literature-review-table-column-dimension": "Dimension",
        "literature-review-table-column-content": "Content",
        "literature-review-table-note-title":
          "<h2>📊 Literature Table - { $title }</h2>",
        "literature-review-table-raw-cache-caption":
          "👇 System-cached raw Markdown data follows. It is used for appending table entries; do not edit it.",
        "literature-review-table-structure-heading":
          "**Table structure definition (each paper row follows this header):**",
        "literature-review-table-fill-failed-inline":
          "(Table fill failed: { $message })",
        "literature-review-table-append-failed-inline":
          "(Append table fill failed: { $message })",
        "literature-review-unknown-title": "Untitled paper",
        "literature-review-unknown-value": "Unknown",
      },
      () => {
        expect(getString("literature-review-table-column-dimension")).to.equal(
          "Dimension",
        );
        expect(getString("literature-review-table-column-content")).to.equal(
          "Content",
        );
        expect(
          getString("literature-review-table-note-title", {
            args: { title: "Paper A" },
          }),
        ).to.equal("<h2>📊 Literature Table - Paper A</h2>");
        expect(getString("literature-review-table-raw-cache-caption")).to.equal(
          "👇 System-cached raw Markdown data follows. It is used for appending table entries; do not edit it.",
        );
        expect(getString("literature-review-table-structure-heading")).to.equal(
          "**Table structure definition (each paper row follows this header):**",
        );
        expect(
          getString("literature-review-table-fill-failed-inline", {
            args: { message: "boom" },
          }),
        ).to.equal("(Table fill failed: boom)");
        expect(
          getString("literature-review-table-append-failed-inline", {
            args: { message: "boom" },
          }),
        ).to.equal("(Append table fill failed: boom)");
        expect(getString("literature-review-unknown-title")).to.equal(
          "Untitled paper",
        );
        expect(getString("literature-review-unknown-value")).to.equal(
          "Unknown",
        );
      },
    );
  });

  it("formats localized LLM multi-PDF warnings", function () {
    withMessages(
      {
        "llm-error-multi-pdf-unsupported":
          "当前 Provider 不支持多 PDF 上传。请将“多 PDF 附件模式”切换为“仅默认 PDF”，或更换支持多 PDF 的 Provider。",
        "llm-warning-pdf-provider-limit":
          "PDF 附件数量超过 Provider 限制，已只发送前 { $count } 个",
      },
      () => {
        expect(getString("llm-error-multi-pdf-unsupported")).to.equal(
          "当前 Provider 不支持多 PDF 上传。请将“多 PDF 附件模式”切换为“仅默认 PDF”，或更换支持多 PDF 的 Provider。",
        );
        expect(
          getString("llm-warning-pdf-provider-limit", { args: { count: 3 } }),
        ).to.equal("PDF 附件数量超过 Provider 限制，已只发送前 3 个");
      },
    );

    withMessages(
      {
        "llm-error-multi-pdf-unsupported":
          "The current provider does not support multi-PDF upload. Switch “Multi-PDF attachment mode” to “Default PDF only”, or choose a provider that supports multiple PDFs.",
        "llm-warning-pdf-provider-limit":
          "The number of PDF attachments exceeds the provider limit, so only the first { $count } were sent",
      },
      () => {
        expect(getString("llm-error-multi-pdf-unsupported")).to.equal(
          "The current provider does not support multi-PDF upload. Switch “Multi-PDF attachment mode” to “Default PDF only”, or choose a provider that supports multiple PDFs.",
        );
        expect(
          getString("llm-warning-pdf-provider-limit", { args: { count: 3 } }),
        ).to.equal(
          "The number of PDF attachments exceeds the provider limit, so only the first 3 were sent",
        );
      },
    );
  });

  it("formats localized note generator status labels", function () {
    withMessages(
      {
        "note-generator-existing-note-skipped": "已存在{ $kind }，跳过",
        "note-generator-model-metadata":
          "供应商: { $provider } 模型: { $model }",
        "note-generator-error-template-missing-sequential":
          "AI 精读模板缺少 sequential_dynamic 阶段",
      },
      () => {
        expect(
          getString("note-generator-existing-note-skipped", {
            args: { kind: "AI 总结" },
          }),
        ).to.equal("已存在AI 总结，跳过");
        expect(
          getString("note-generator-model-metadata", {
            args: { provider: "OpenAI", model: "gpt" },
          }),
        ).to.equal("供应商: OpenAI 模型: gpt");
        expect(
          getString("note-generator-error-template-missing-sequential"),
        ).to.equal("AI 精读模板缺少 sequential_dynamic 阶段");
      },
    );

    withMessages(
      {
        "note-generator-existing-note-skipped":
          "{ $kind } already exists; skipped",
        "note-generator-model-metadata":
          "Provider: { $provider } Model: { $model }",
        "note-generator-error-template-missing-sequential":
          "AI Deep Reading template is missing the sequential_dynamic phase",
      },
      () => {
        expect(
          getString("note-generator-existing-note-skipped", {
            args: { kind: "AI Summary" },
          }),
        ).to.equal("AI Summary already exists; skipped");
        expect(
          getString("note-generator-model-metadata", {
            args: { provider: "OpenAI", model: "gpt" },
          }),
        ).to.equal("Provider: OpenAI Model: gpt");
        expect(
          getString("note-generator-error-template-missing-sequential"),
        ).to.equal(
          "AI Deep Reading template is missing the sequential_dynamic phase",
        );
      },
    );
  });

  it("formats localized mindmap debug, theme, and legacy migration labels", function () {
    withMessages(
      {
        "mindmap-debug-truncated": "...[已截断]",
        "mindmap-debug-base64-truncated":
          "[Base64 PDF] { $content }...[已截断，原长度: { $length }]",
        "mindmap-debug-error-type": "错误类型: { $type }",
        "theme-redstriking-name": "红印",
        "itempane-image-summary-filename-prefix": "AI管家_一图总结",
        "legacy-ai-note-migration-untitled-paper": "未命名文献",
        "legacy-ai-note-migration-renamed-heading-prefix": "AI 总结 -",
      },
      () => {
        expect(getString("mindmap-debug-truncated")).to.equal("...[已截断]");
        expect(
          getString("mindmap-debug-base64-truncated", {
            args: { content: "abc", length: 1000 },
          }),
        ).to.equal("[Base64 PDF] abc...[已截断，原长度: 1000]");
        expect(
          getString("mindmap-debug-error-type", { args: { type: "格式不符" } }),
        ).to.equal("错误类型: 格式不符");
        expect(getString("theme-redstriking-name")).to.equal("红印");
        expect(getString("itempane-image-summary-filename-prefix")).to.equal(
          "AI管家_一图总结",
        );
        expect(getString("legacy-ai-note-migration-untitled-paper")).to.equal(
          "未命名文献",
        );
        expect(
          getString("legacy-ai-note-migration-renamed-heading-prefix"),
        ).to.equal("AI 总结 -");
      },
    );

    withMessages(
      {
        "mindmap-debug-truncated": "...[truncated]",
        "mindmap-debug-base64-truncated":
          "[Base64 PDF] { $content }...[truncated, original length: { $length }]",
        "mindmap-debug-error-type": "Error type: { $type }",
        "theme-redstriking-name": "Redstriking",
        "itempane-image-summary-filename-prefix": "AI_Butler_One_Image_Summary",
        "legacy-ai-note-migration-untitled-paper": "Untitled paper",
        "legacy-ai-note-migration-renamed-heading-prefix": "AI Summary -",
      },
      () => {
        expect(getString("mindmap-debug-truncated")).to.equal("...[truncated]");
        expect(
          getString("mindmap-debug-base64-truncated", {
            args: { content: "abc", length: 1000 },
          }),
        ).to.equal("[Base64 PDF] abc...[truncated, original length: 1000]");
        expect(
          getString("mindmap-debug-error-type", { args: { type: "invalid" } }),
        ).to.equal("Error type: invalid");
        expect(getString("theme-redstriking-name")).to.equal("Redstriking");
        expect(getString("itempane-image-summary-filename-prefix")).to.equal(
          "AI_Butler_One_Image_Summary",
        );
        expect(getString("legacy-ai-note-migration-untitled-paper")).to.equal(
          "Untitled paper",
        );
        expect(
          getString("legacy-ai-note-migration-renamed-heading-prefix"),
        ).to.equal("AI Summary -");
      },
    );
  });

  it("formats localized note export heading numbering settings", function () {
    withMessages(
      {
        "note-export-heading-number-style": "chinese",
        "note-export-chinese-digits": "零一二三四五六七八九",
        "note-export-chinese-ten": "十",
      },
      () => {
        expect(getString("note-export-heading-number-style")).to.equal(
          "chinese",
        );
        expect(getString("note-export-chinese-digits")).to.equal(
          "零一二三四五六七八九",
        );
        expect(getString("note-export-chinese-ten")).to.equal("十");
      },
    );

    withMessages(
      {
        "note-export-heading-number-style": "decimal",
        "note-export-chinese-digits": "0123456789",
        "note-export-chinese-ten": "10",
      },
      () => {
        expect(getString("note-export-heading-number-style")).to.equal(
          "decimal",
        );
        expect(getString("note-export-chinese-digits")).to.equal("0123456789");
        expect(getString("note-export-chinese-ten")).to.equal("10");
      },
    );
  });

  it("formats parameterized audit keys without Node-only fixtures", function () {
    withMessages(
      {
        "itempane-load-failed": "Load failed: { $error }",
        "endpoint-effective-pdf-mode": "Actual: { $mode }",
        "endpoint-follow-global": "Follow global ({ $mode })",
        "collection-clean-type-summary": "AI Summary",
        "collection-clean-type-chat": "follow-up chat records",
      },
      () => {
        expect(
          getString("itempane-load-failed", { args: { error: "boom" } }),
        ).to.equal("Load failed: boom");
        expect(
          getString("endpoint-effective-pdf-mode", {
            args: { mode: "Text extraction" },
          }),
        ).to.equal("Actual: Text extraction");
        expect(
          getString("endpoint-follow-global", {
            args: { mode: "Base64" },
          }),
        ).to.equal("Follow global (Base64)");
        expect(getString("collection-clean-type-summary")).to.equal(
          "AI Summary",
        );
        expect(getString("collection-clean-type-chat")).to.equal(
          "follow-up chat records",
        );
      },
    );
  });
});
