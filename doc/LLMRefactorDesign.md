# LLM 调用标准化设计

本文档记录当前已落地的 LLM 调用架构。目标是让业务功能只描述任务和内容来源，把 PDF 输入形态、Provider 能力差异、参数映射、响应解析、重试和密钥轮换统一收敛到中间件。

## 架构总览

```
业务功能层
  noteGenerator / mindmapService / literatureReviewService / SummaryView / ItemPaneSection
        │
        ▼
LLMService
  ├─ 读取偏好与 API Key
  ├─ 按用户选择准备 text / pdf-base64 / multi-pdf
  ├─ 组装 LLMOptions
  ├─ 执行重试与多密钥轮换
  └─ 返回 LLMResponse
        │
        ▼
ProviderRegistry
        │
        ▼
llmproviders/*
  OpenAI / OpenAI-compatible / Gemini / Anthropic / OpenRouter / VolcanoArk
```

- `src/modules/llmService.ts` 是新业务代码的标准入口。
- `src/modules/llmClient.ts` 只保留旧方法签名，作为兼容壳委托给 `LLMService`。
- Provider 继续自注册到 `ProviderRegistry`，但必须声明 `capabilities`。
- Provider 内部只处理供应商协议差异，例如 HTTP payload、SSE 事件、非流式响应结构、错误响应解析。

## 标准接口

### LLMGenerateRequest

`LLMService.generate()` 接收统一请求：

```ts
await LLMService.generate({
  task: "table",
  prompt,
  content: {
    kind: "pdf-attachment",
    item,
    attachment: pdfAttachment,
  },
  output: { format: "markdown" },
  onProgress,
});
```

支持的内容来源：

| kind             | 说明                                   |
| ---------------- | -------------------------------------- |
| `text`           | 调用方已准备好的文本                   |
| `zotero-item`    | 中间件从 Zotero 条目读取默认或全部 PDF |
| `pdf-attachment` | 只分析指定 PDF 附件                    |
| `pdf-files`      | 多 PDF 输入，适配多文件或文本降级      |
| `legacy`         | `LLMClient` 兼容层使用                 |

`content.policy` 支持：

| policy       | 行为                                              |
| ------------ | ------------------------------------------------- |
| `auto`       | 根据 Provider 能力选择 Base64 或文本              |
| `text`       | 强制文本提取                                      |
| `pdf-base64` | 准备 PDF Base64，并交给 Provider 按其适配结构发送 |
| `mineru`     | 走 MinerU/文本提取链路                            |

### LLMResponse

Provider 旧接口仍返回字符串；`LLMService` 对外统一包装为：

```ts
type LLMResponse = {
  text: string;
  providerId: string;
  model?: string;
  requestId?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  finishReason?: string;
  warnings?: string[];
  rawExcerpt?: string;
};
```

当前第一阶段重点统一 `text`、`providerId`、`model`、`warnings`；后续可逐个 Provider 补齐 usage 和 requestId。

## Provider Contract

Provider 必须实现 `ILlmProvider`：

- `generateSummary(content, isBase64, prompt, options, onProgress)`
- `chat(pdfContent, isBase64, conversation, options, onProgress)`
- `testConnection(options)`
- `generateMultiFileSummary(pdfFiles, prompt, options, onProgress)`（可选）

Provider 还应声明：

```ts
readonly capabilities = {
  supportsText: true,
  supportsStreaming: true,
  supportsPdfBase64: false,
  maxPdfFiles: 0,
  supportsSystemPrompt: true,
  supportedParams: ["temperature", "topP", "maxTokens", "stream"],
};
```

约定：

- 不支持的生成参数必须忽略，不应抛错。
- 用户选择 PDF/Base64 时，`LLMService` 不按 Provider 名称提前拦截；它只负责准备 Base64 内容，并交给 Provider 按官方或兼容接口结构发送。
- 多 PDF 只有在 `maxPdfFiles > 1` 且 Provider 实现 `generateMultiFileSummary` 时启用。
- 业务层不得直接判断 Provider 名称来决定输入形态。

## PDF 输入策略

`LLMService` 集中读取：

- `pdfProcessMode`: `base64` / `text` / `mineru`
- `pdfAttachmentMode`: `default` / `all`

规则：

- `text` 模式下，所有功能（总结、思维导图、填表、综述、追问）都走文本提取。
- `base64` 模式下，始终准备并发送 PDF Base64；如果 API、中转站或目标模型不兼容，应展示真实 API 错误。
- `auto` 模式可以根据 Provider 能力自动选择输入形态，但用户设置页当前暴露的是明确模式，不能静默改写用户选择。
- `all` 附件模式只在 Provider 支持多 PDF 时上传多个附件；否则使用文本合并或默认 PDF。
- 填表功能不再直接读取 PDF 并转换 Base64，必须通过 `LLMService.generate({ task: "table" })`。

## OpenAI Responses

OpenAI 官方 Provider 使用 Responses API：

- 文本和 PDF 都可以走 `/v1/responses`。
- PDF 使用 `input_file` 和 `file_data: data:application/pdf;base64,...`。
- 文本使用 `input_text`。
- 流式解析 `response.output_text.delta`。
- 非流式解析必须使用 `shared/openaiResponses.ts`：
  - 先读顶层 `output_text`
  - 再遍历 `output[].content[]` 的 `text` / `output_text.text`
- `testConnection` 和正式生成共用同一解析函数，避免“接口有结果但插件读空”的问题。

## 新增 Provider 步骤

1. 新建 `src/modules/llmproviders/{Vendor}Provider.ts`。
2. 实现 `ILlmProvider` 并声明 `capabilities`。
3. 在文件底部自注册：`ProviderRegistry.register(new VendorProvider())`。
4. 在 `llmproviders/index.ts` 导出 Provider。
5. 更新 `ApiKeyManager` 的 ProviderId 和密钥偏好映射。
6. 在 `addon/prefs.js`、`typings/prefs.d.ts`、设置页中加入 URL、Key、Model。
7. 在 `LLMService.buildOptions()` 和 `mapToKeyManagerId()` 加入 Provider 映射。
8. 补充测试连接、文本流式/非流式、Base64 降级、多 PDF 能力测试。

## 回归测试重点

- OpenAI Responses 非流式：`output[1].content[0].type="output_text"` 必须能解析出文本。
- `pdfProcessMode=text` 时，填表和思维导图不得发送 Base64。
- `base64` 偏好下不得提前拦截 OpenAI-compatible、OpenRouter 等 Provider；应走对应 Provider 的 Base64 请求路径，并验证错误能原样向用户呈现。
- `pdfAttachmentMode=all` 时，只有支持多 PDF 的 Provider 上传多个附件。
- `npm run build` 必须通过。

## Endpoint Routing And Metadata

2026-05 新增的主路由来源是 `llmEndpoints`，旧的 `provider` 和各 provider 的 URL/key/model prefs 只用于兼容迁移和旧 UI。`src/modules/llmEndpointManager.ts` 负责读写 endpoint JSON、迁移旧配置、按启用状态过滤、排序、轮询 cursor 和最大请求次数。

Endpoint JSON:

```ts
type LLMEndpoint = {
  id: string;
  name: string;
  providerType:
    | "openai"
    | "openai-compat"
    | "google"
    | "anthropic"
    | "openrouter"
    | "volcanoark";
  apiUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};
```

路由策略：

- `llmRoutingStrategy="priority"`：按设置页排序尝试；失败后尝试下一个，到尾后回到第一个。
- `llmRoutingStrategy="roundRobin"`：每次请求从 `llmRoundRobinCursor` 指向的 endpoint 开始；每一次真实 API 请求后 cursor 都推进到下一个 endpoint。
- `maxApiSwitchCount` 表示最大真实 API 请求次数，不再表示 provider key 轮换次数。

`LLMResponse` 现在包含 `endpointId`、`providerName`、`providerId`、`model`、`generatedAt`。保存到 Zotero 的 LLM 笔记应通过 `src/modules/llmNoteMetadata.ts` 写入 HTML comment metadata block：

```html
<!-- AI_BUTLER_LLM_BLOCK_BEGIN::v1::<blockId>::<nonce> -->
<!-- AI_BUTLER_LLM_META_B64URL::v1::<base64url-json> -->
<h2>AI 管家 - paper title</h2>
<div data-ai-butler-llm-source="v1">AI 来源：供应商、模型、生成时间</div>
...visible generated content...
<!-- AI_BUTLER_LLM_BLOCK_END::v1::<blockId>::<checksum> -->
```

侧边栏渲染正文前必须调用 `LLMNoteMetadataService.stripSidebarMetadata()`，不要把机器用注释或正文来源栏重复显示到侧边栏正文里；`data-ai-butler-llm-source="v1"` 来源栏是面向 Zotero 笔记正文的可见内容。侧边栏需要读取结构化来源时，用 `getLatest()` 或多模型场景中的 `parseAll()`，并通过标题旁的供应商选择框切换 block。

多模型同时总结通过 `multiModelSummaryEnabled` 和 `multiModelSummaryEndpointIds` 控制，只在 `NoteGenerator.generateNoteForItem()` 中生效。开启后，总结工作流会按用户选择并行调用 `LLMService.generateWithEndpoint()` / `chatWithEndpoint()`，每个成功模型写入一个独立 metadata block；其他 LLM 功能仍使用主路由策略。部分供应商失败时保存成功结果，全部失败时抛错且不创建错误笔记。
