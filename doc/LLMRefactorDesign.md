# LLM 客户端重构设计（分离多供应商 + 统一抽象）

本文档描述将当前 `src/modules/llmClient.ts` 中耦合的多家 LLM 供应商调用逻辑抽离为独立、可扩展的 Provider 模块的设计方案，目标是让新增供应商成为一个机械化的工作，并确保通用配置（如温度、流式输出等）一视同仁地传递和处理。

## 背景与目标

现状：

- `llmClient.ts` 同时包含 OpenAI/Gemini/Anthropic 的调用、SSE 解析、非流式调用、对话与总结等多种逻辑，文件庞大、耦合高。
- 通用参数（如 temperature、topP、maxTokens、stream、timeout）与各供应商特性交织，影响后续维护和扩展。

重构目标：

- 将“供应商适配层”从 `llmClient.ts` 拆分到 `src/modules/llmproviders/`，不同供应商各自独立实现，互不干扰。
- 抽象统一的 Provider 接口，LLMClient 仅负责：读取偏好、组装通用选项、挑选 Provider、分发调用与回调。
- 通用选项一视同仁地传入 Provider；是否支持与如何映射由 Provider 自行决定（例如：某供应商不支持 maxTokens，则忽略或做合理降级）。
- 提供 Provider 注册与发现机制（Registry），后续新增供应商无需修改核心代码，只需注册一次。
- 保留/增强流式（SSE）与非流式模式；统一 onProgress 回调语义。
- 测试连接（testConnection）能力标准化。

## 总体架构

```
UI/业务调用层 (Views, noteGenerator, 等)
        │
        ▼
   LLMClient（精简门面）
   ├─ 读取偏好（getPref）/ 组装 LLMOptions
   ├─ ProviderRegistry 选择具体 Provider
   └─ 委派 generateSummary / chat / testConnection
        │
        ▼
llmproviders/*（供应商适配层）
   ├─ OpenAIProvider
   ├─ GeminiProvider
   ├─ AnthropicProvider
   ├─ … NewVendorProvider
   └─ shared/（SSE/HTTP/工具）
```

## 目录与文件结构

```
src/
  modules/
    llmproviders/
      types.ts                # 通用类型（LLMOptions、ProgressCb、ConversationMessage、LLMError等）
      ILlmProvider.ts         # Provider 接口定义
      ProviderRegistry.ts     # Provider 注册/发现
      shared/
        http.ts               # 封装 Zotero.HTTP.request + 常用 header/超时/错误解析
        sse.ts                # 通用 SSE 逐行解析器（data: 行拼接、[DONE] 终止、错误包）
        llmutils.ts              # 小工具：安全 JSON 解析、字符串累积器等
      OpenAIProvider.ts       # OpenAI 兼容实现（Chat Completions + Responses 多模态）
      GeminiProvider.ts       # Google Gemini 实现（streamGenerateContent）
      AnthropicProvider.ts    # Anthropic Claude 实现（/v1/messages 流式）
      index.ts                # 对外导出（便于 tree-shaking）

modules/
  llmClient.ts                # 仅保留门面逻辑，调用 Registry + Provider
```

> 说明：目前 `src/modules/llmproviders` 目录存在但为空；本重构将按上述结构补齐。

## 接口与类型（契约）

关键目标：统一外部调用签名，内部各 Provider 自主映射参数与处理差异。

```ts
// src/modules/llmproviders/types.ts
export type ProgressCb = (chunk: string) => Promise<void> | void;

export type ConversationMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LLMOptions = {
  // 通用：所有供应商都能拿到同一份
  apiUrl?: string; // 基础 URL/端点（供应商若有默认可忽略）
  apiKey?: string; // 认证密钥（部分供应商可能不需要）
  model?: string;
  stream?: boolean; // 期望流式；Provider 可按能力降级
  requestTimeoutMs?: number;

  // 生成控制：通用意图，由 Provider 决定是否/如何映射
  temperature?: number;
  topP?: number;
  maxTokens?: number;

  // 额外的供应商私有选项（避免接口污染）
  // 如：organization、customHeaders、extraQuery 等
  vendorOptions?: Record<string, unknown>;
};

export type LLMError = {
  code?: string; // 例如 http_status、api_error_code
  message: string; // 面向用户的简短错误
  details?: unknown; // 原始响应片段/调试信息
};
```

```ts
// src/modules/llmproviders/ILlmProvider.ts
import { LLMOptions, ProgressCb, ConversationMessage } from "./types";

export interface ILlmProvider {
  /** 供应商唯一标识（例如：'openai' | 'google' | 'anthropic' | 'deepseek' ...） */
  readonly id: string;

  /**
   * 单轮“总结/生成”
   * - 支持 Base64（如 PDF）与纯文本
   * - onProgress: 流式/非流式均应调用（非流式在完成时一次性回调全文）
   */
  generateSummary(
    content: string,
    isBase64: boolean,
    prompt: string | undefined,
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<string>;

  /** 多轮对话 */
  chat(
    pdfContent: string,
    isBase64: boolean,
    conversation: ConversationMessage[],
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<string>;

  /** 连接性/鉴权测试（返回可读字符串） */
  testConnection(options: LLMOptions): Promise<string>;
}
```

## Provider 注册与发现

```ts
// src/modules/llmproviders/ProviderRegistry.ts
import { ILlmProvider } from "./ILlmProvider";

export class ProviderRegistry {
  private static providers = new Map<string, ILlmProvider>();

  static register(provider: ILlmProvider) {
    this.providers.set(provider.id.toLowerCase(), provider);
  }

  static get(id: string): ILlmProvider | undefined {
    return this.providers.get(id.toLowerCase());
  }

  static list(): string[] {
    return Array.from(this.providers.keys());
  }
}
```

- 每个 Provider 在其模块初始化时调用 `ProviderRegistry.register(...)` 完成自注册；
- `llmClient.ts` 从用户偏好读取 `provider`，再通过 `ProviderRegistry.get(provider)` 获取实例；
- 未注册或未知供应商时，给出友好错误并提示已支持列表。

## LLMClient（门面）职责与精简

`src/modules/llmClient.ts` 中仅保留：

- 从偏好读取“通用选项”：`apiUrl/apiKey/model/temperature/topP/maxTokens/stream/requestTimeout` 以及供应商私有字段（如 `geminiApiUrl/geminiApiKey` 可归并至 vendorOptions 或在 Provider 内部自行读取）；
- 组装 `LLMOptions` 并传入 Provider；
- 暴露与现有一致的入口：`generateSummary(...)`、`chat(...)`、`testConnection()`；
- 统一错误展示：捕获 Provider 抛出的错误并用 `notifyError` 呈现；
- 不再包含具体 HTTP 与 SSE 细节（这些进入 `llmproviders/*`）。

> 兼容性建议：保留现有导出名与方法签名，确保上层调用（如 Views、noteGenerator）无感知迁移。

## 通用设置的一视同仁传递

- `LLMClient` 读取的通用项：
  - `model`, `stream`, `temperature`, `topP`, `maxTokens`, `requestTimeoutMs`
  - 认证与基础：`apiUrl`, `apiKey`
- 全量装入 `LLMOptions` 传递给 Provider；
- Provider 映射规则：
  - 支持的参数：按供应商 API 填入；
  - 不支持的参数：忽略或做“最接近”的降级（需在源码注释中注明）；
  - 示例：若某 OpenAI 兼容实现不接受 `maxTokens`，则不设置；Gemini 支持 `generationConfig.maxOutputTokens` 则映射。

## 流式回调与 SSE 解析约定

- 所有 Provider 在流式模式下：
  - 逐段解析 SSE `data:` 行，抽取增量文本，立即调用 `onProgress(chunk)`；
  - 完成时返回拼接后的完整文本；
- 在非流式模式下：
  - 响应解析出完整文本后，若提供 `onProgress`，需“补发”一次完整文本（与现有行为一致），最后返回。
- `shared/sse.ts` 提供轻量通用工具：
  - 处理粘包/分段（partial line）
  - 行级解析与 `[DONE]` 识别
  - 安全 JSON 解析（不同供应商 JSON 结构由 Provider 自行抽取）

## 统一错误处理

- `shared/http.ts` 封装 `Zotero.HTTP.request`：
  - 统一超时、Header 拼接、错误码与响应体收集；
  - 将 HTTP 非 2xx 统一抛出为 `LLMError`（含 status、body 片段），供 Provider 转译更语义化的信息；
- Provider 应保证抛出错误时尽量包含：`message`（友好）、`code`（可选，便于上报/定位）、`details`（原始响应片段）；
- `LLMClient` 捕获后调用 `notifyError`，并向上抛出，以便调用层可做兜底处理。

## 供应商适配要点

- OpenAI 兼容（`OpenAIProvider.ts`）
  - 文本：Chat Completions
  - Base64 PDF：Responses API（多模态）
  - 支持流式/非流式；按 API 规范映射 `temperature/topP/maxTokens`（若目标服务不支持，则忽略）
  - 错误：解析 `error.message` 或 `choices` 为空等情况

- Google Gemini（`GeminiProvider.ts`）
  - 使用 `:streamGenerateContent?alt=sse` 流式
  - `generationConfig` 映射温度等配置；Base64 通过 `inline_data`
  - 事件中 `candidates[].content.parts[].text` 聚合

- Anthropic Claude（`AnthropicProvider.ts`）
  - `/v1/messages`，流式事件类型多样（`content_block_start/delta/...`），需按类型累积文本
  - `max_tokens`、`temperature` 映射；Base64 以 `input: [{type:'document',...}]` 或官方支持的结构（依据当前实现）

> 注：各 Provider 的 JSON 结构与细节在其模块内注释清晰说明；本门面不感知差异。

## 如何新增供应商（机械化步骤）

1. 新建文件

- 在 `src/modules/llmproviders/` 下创建 `{VendorName}Provider.ts`：
  - 导出类 `VendorNameProvider implements ILlmProvider`；
  - `readonly id = '{vendor-id}';`（建议小写英文字母）。

2. 实现接口

- 实现 `generateSummary` / `chat` / `testConnection`：
  - 从 `options: LLMOptions` 取通用项并映射到供应商 API；
  - 根据 `options.stream` 选择流式/非流式；
  - 流式下使用 `shared/sse.ts` 帮助解析，逐段调用 `onProgress`；
  - 非流式下解析完整文本并在结束前（若 onProgress 存在）补发一次全文；
  - 捕获 HTTP 错误并包装为可读的 `LLMError`。

3. 自注册到 Registry

- 在文件底部或 `llmproviders/index.ts` 中：

```ts
import { ProviderRegistry } from "./ProviderRegistry";
ProviderRegistry.register(new VendorNameProvider());
```

4)（可选）供应商私有配置

- 若需要额外字段（如组织ID、自定义 Header）：
  - 优先通过 `options.vendorOptions` 传入；
  - 或在 Provider 内部自行读取 `getPref('vendorXxx')`（不推荐，建议集中在 LLMClient 统一注入）。

5. 测试

- 调用 `LLMClient.testConnection()` 验证连接；
- 通过 UI 进行一次流式与一次非流式的冒烟测试，确认 onProgress 行为一致。

完成以上 5 步，新增供应商无需改动核心逻辑。

## 迁移计划（从现有实现到新架构）

- 第 1 步：落地 `llmproviders/` 目录及基础类型与 Registry；
- 第 2 步：将 `llmClient.ts` 中 Gemini/Anthropic/OpenAI 的实现迁移到各自 Provider：
  - 复制 HTTP/SSE 细节到对应 Provider；
  - 在 Provider 内部保留/优化现有错误提示与降级逻辑；
- 第 3 步：精简 `llmClient.ts`：
  - 读取偏好 → 组装 `LLMOptions` → 调用 `ProviderRegistry.get(provider)` → 委派；
  - 保留 `notifyError`、`getRequestTimeout()` 等通用方法；
- 第 4 步：手动/自动测试：
  - `generateSummary`：文本/Base64、流式/非流式各一例；
  - `chat`：对话历史存在/不存在；
  - `testConnection`：返回 OK 文本；
- 第 5 步：删除旧的供应商内联代码与注释，保留迁移说明与变更记录。

## 验收与回归检查

- 通用功能：
  - [ ] 三家供应商均能成功生成内容；
  - [ ] 流式 onProgress 正常触发；非流式能补发一次全文；
  - [ ] `testConnection` 返回明确状态文本；
  - [ ] 常见错误（鉴权失败、超时、无响应）提示友好；
- 参数传递：
  - [ ] temperature/topP/maxTokens/stream/requestTimeout 能正确传递与映射；
  - [ ] 不支持的参数被安全忽略（无异常、无误导日志）。

## 后续可选优化

- 在 `shared/http.ts` 增加重试/指数退避；
- 统一打点：记录供应商耗时、token 成本（如可得）以便后续优化；
- 在 `ProviderRegistry` 支持懒加载（按需导入）以减少首包体积；
- 提供 `New Provider` 脚手架脚本：一键生成 Provider 模板文件与测试样例。

## 附：旧实现到新实现的对应关系

- 旧 `LLMClient.generateSummary` → 新：`LLMClient.generateSummary`（门面不变）内部委派至 `Provider.generateSummary`。
- 旧 `generateWithGemini` → 新：`GeminiProvider.generateSummary` / `chat`。
- 旧 `generateWithAnthropic` → 新：`AnthropicProvider.generateSummary` / `chat`。
- 旧 `chatWithOpenAI/Gemini/Anthropic` → 新：各 Provider 的 `chat`。
- 旧 `nonStreamCompletion` → 新：各 Provider 内部的“非流式分支”实现；可复用 `shared/http.ts`。
- 旧 `testConnection` → 新：`Provider.testConnection`（各自实现），门面统一调用。

---

以上设计保证：

- 新增供应商时有清晰模板与注册点；
- 通用参数一致传递，差异映射在适配层内闭环；
- `llmClient.ts` 变为稳定门面，上层调用无需跟随变动。
