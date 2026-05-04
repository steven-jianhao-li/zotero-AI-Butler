# Multi-Model Summary Handoff

本文件记录 2026-05 多供应商 endpoint、LLM 笔记元数据、多模型同时总结和侧边栏按来源切换的接入点。

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
<h2>AI 管家 - paper title</h2>
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

侧边栏摘要渲染在 `src/modules/ItemPaneSection.ts` 中调用 `stripSidebarMetadata()`，隐藏机器用 HTML comment 和正文内可见的 `data-ai-butler-llm-source="v1"` 来源栏。侧边栏标题旁的供应商选择框读取 `parseAll()`，可按 block/endpoint 切换展示内容，选项 tooltip 展示 provider/model/generatedAt。

## Multi-Model Summary

多模型总结只影响 `NoteGenerator.generateNoteForItem()` 这一条 AI 总结工作流；思维导图、填表、文献综述、追问和一图总结前置分析仍走 `llmRoutingStrategy`。

- `multiModelSummaryEnabled`: boolean
- `multiModelSummaryEndpointIds`: JSON string array

设置页 UI 在 `src/modules/views/ui/EndpointSettingsPanel.ts` 的“多模型同时总结”面板。开启时如果尚未选择供应商，UI 会默认选中所有已启用 endpoint。运行时会通过 `LLMEndpointManager.getMultiModelSummaryEndpoints()` 按用户选择顺序取出仍然启用的 endpoint；如果没有可用 endpoint，会给出明确错误。

`LLMService.generateWithEndpoint(endpointId, request)` 和 `LLMService.chatWithEndpoint(endpointId, request)` 是指定 endpoint 的调用入口，不推进轮询游标，也不使用主路由 fallback。多模型总结会并行调用这些入口，并把成功结果写入同一个 Zotero 笔记：

```html
<!-- endpoint A metadata block -->
<h2>AI 管家 - paper title</h2>
<p data-ai-butler-llm-source="v1">AI 来源：供应商 A、模型、生成时间</p>
...
<hr />
<!-- endpoint B metadata block -->
<h2>AI 管家 - paper title</h2>
<p data-ai-butler-llm-source="v1">AI 来源：供应商 B、模型、生成时间</p>
...
```

如果部分供应商失败，成功结果仍会保存；如果全部失败，则不创建错误笔记并向上抛出错误。

## Future Tasks

1. 可继续优化生成窗口的并行流式展示，目前为各模型完成后汇总显示，避免多模型流式输出互相穿插。
2. 如果后续需要“一图总结”的图片模型来源元数据，应单独设计图片生成 metadata，不复用本轮 LLM 文本 block。
