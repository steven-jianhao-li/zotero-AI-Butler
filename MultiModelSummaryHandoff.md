# Multi-Model Summary Handoff

本文件给下一轮开发“多模型同时总结”和“侧边栏按模型切换”使用。当前轮已经完成 endpoint 路由、LLM 响应元数据、笔记 metadata block 基础格式和设置页预留项。

## Endpoint Schema

Endpoint 列表存储在 pref `llmEndpoints`，值为 JSON 数组。每个 endpoint 结构如下：

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

管理模块是 `src/modules/llmEndpointManager.ts`。如果 `llmEndpoints` 为空或为 `[]`，会从旧的 `provider`、`*ApiUrl`、`*ApiKey`、`*Model` prefs 迁移出 `endpoint-legacy-primary`。

## Routing

路由策略 pref：

- `llmRoutingStrategy`: `"priority"` 或 `"roundRobin"`，默认 `"priority"`。
- `llmRoundRobinCursor`: 轮询游标 endpoint id。
- `maxApiSwitchCount`: 最大真实 API 请求次数。

`LLMService.generate()` 和 `LLMService.chat()` 会调用 `LLMEndpointManager.prepareRoute()`。优先级策略按 UI 顺序尝试；轮询策略从 cursor 开始。每一次成功或失败的真实 API 请求都会调用 `markEndpointAttempted()`，因此如果 B 失败、C 成功，下一轮会从 D 开始。

## Note Metadata Format

元数据模块是 `src/modules/llmNoteMetadata.ts`。每段 LLM 输出用 HTML comment 包裹：

```html
<!-- AI_BUTLER_LLM_BLOCK_BEGIN::v1::<blockId>::<nonce> -->
<!-- AI_BUTLER_LLM_META_B64URL::v1::<base64url-json> -->
<div data-ai-butler-llm-source="v1">AI 来源：供应商、模型、生成时间</div>
...visible generated content...
<!-- AI_BUTLER_LLM_BLOCK_END::v1::<blockId>::<checksum> -->
```

JSON 至少包含：

```ts
{
  schema: "AI_BUTLER_LLM_NOTE_BLOCK",
  version: 1,
  blockId: string,
  task: "summary" | "mindmap" | "table" | "literature-review" | "chat" | "image-summary" | "custom",
  endpointId?: string,
  providerId: string,
  providerName: string,
  modelId?: string,
  generatedAt: string
}
```

已接入的保存路径：

- 普通总结：`src/modules/noteGenerator.ts`
- 多轮总结最终/拼接回退：`src/modules/noteGenerator.ts`
- 文献综述与目标问题回答：`src/modules/literatureReviewService.ts`
- 表格填充笔记：`src/modules/literatureReviewService.ts`
- 思维导图笔记：`src/modules/mindmapService.ts`
- 保存的追问笔记：`src/modules/views/SummaryView.ts`、`src/modules/ItemPaneSection.ts`

侧边栏摘要渲染在 `src/modules/ItemPaneSection.ts` 中调用 `stripMetadataComments()`，隐藏机器用 HTML comment，但保留可见的 `data-ai-butler-llm-source="v1"` 来源栏。标题旁的 `i` 仍展示最新 block 的 tooltip。下一轮如果一个笔记内有多个 summary block，应改为解析 `parseAll()` 并按 block/endpoint 切换。

## Reserved Prefs

当前轮只保存配置，不改变运行行为：

- `multiModelSummaryEnabled`: boolean
- `multiModelSummaryEndpointIds`: JSON string array

设置页预留 UI 在 `src/modules/views/ui/EndpointSettingsPanel.ts`。

## Next Round Tasks

1. 在 `NoteGenerator.generateNoteForItem()` 中，当 `multiModelSummaryEnabled=true` 时读取 `multiModelSummaryEndpointIds`，并行调用指定 endpoint。
2. 给 `LLMService.generate()` 增加“指定 endpoint id”入口，或新增 `generateWithEndpoint()`，避免多模型总结绕过统一内容策略。
3. 一个 Zotero AI 总结笔记内保存多个 metadata block，每个 block 包含对应模型的可见内容。
4. 修改 `ItemPaneSection`：摘要区域解析 `LLMNoteMetadataService.parseAll()`，提供模型/endpoint 切换控件，切换时只渲染当前 block 的 `content`。
5. 保持其他功能仍走 `llmRoutingStrategy`，不要让多模型并行影响表格、思维导图、综述和追问。
