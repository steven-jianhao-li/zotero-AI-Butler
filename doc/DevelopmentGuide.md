## 常用命令

- 发布新版本：`npm run release`
- 打包插件：`npm run build`
- 本地测试：`npm start`
- 修改zotero profile： `./zotero.exe -p`(在Windows zotero安装目录下运行)
- 统一代码格式：`npx prettier --write .`
- 检查代码格式：`npm run lint:check`

# zotero-AI-Butler

> **文献下载一时爽，打开阅读火葬场。**
> **天书难啃骨头硬，管家嚼碎再喂粮。**

想着稍后阅读的论文，最后却变成了永不阅读？
长篇大论的学术论文，有翻译却也抓不住重点？

你是否也被以下问题困扰？

- 痛点一：文章太多，读不过来。即便让AI辅助阅读，却还要一篇一篇的发给AI，效率低下。
- 痛点二：读完就忘，需要反复重新阅读。 辛辛苦苦读完一篇，两天后就忘了，想回忆又得从头看起，浪费时间。
- 痛点三：文章太长，即使有翻译插件，也难以抓住重点，读下一页忘上一页。

别慌！您的专属AI管家 `Zotero-AI-Butler` 已闪亮登场！

TA 是您7x24小时待命、不知疲倦且绝对忠诚的私人管家。
您只管像往常一样把文献丢进 Zotero，剩下的体力活全交给TA！
管家会自动帮您精读论文，将文章揉碎了总结为笔记，让您“十分钟完全了解”这篇论文！

**核心功能：**

1.  **自动巡视 (自动扫描)**：管家会在后台默默巡视您的文献库，一旦发现您“丢”进来了新论文（或是您想对积压已久的旧论文开刀），只要还没有笔记，TA 就会自动开工。
2.  **深度解析 (生成笔记)**：管家的核心任务——利用大模型将论文精读、揉碎、嚼烂后，整理成一份热腾腾、条理清晰的 Markdown 笔记塞进您的 Zotero 条目下。
3.  **随时待命 (右键菜单)**：除了“全自动”托管，您也可以随时右键点击任何一篇论文，让管家现在、立刻、最高优先级地分析这篇文章。
4.  **管家智能（无损阅读）**：管家会根据自己模型的多模态能力直接处理PDF文件，不经过本地OCR或文本提取，最大程度保留论文内容的完整性和准确性，图片、表格、公式等都不在话下！

推荐使用 Google Gemini 2.5 pro 模型，Gemini读论文讲的很到位。

> **您只负责思考，`Zotero-AI-Butler` 负责为您的阅读扫清障碍！**

## 核心功能列表

1.  **自动化笔记生成工作流**
    - **自动扫描**:插件会监听Zotero的条目添加事件,自动为新添加的论文条目(PDF附件)进行处理。
    - **手动触发**:在插件的仪表盘界面能够对用户库中的所有论文进行扫描,在用户筛选后,将未处理的论文加入分析队列。
    - **状态判断**:通过检查条目是否已附加符合特定命名规则(例如包含插件标识名)的笔记,来判断该论文是否已被处理。
    - **跳过已处理**:如果笔记已存在,则跳过该论文,避免重复工作。
    - **执行分析**:如果笔记不存在,则自动将该论文加入处理队列。

2.  **集成大型语言模型(LLM)分析**
    - **调用API**:提取论文PDF的文本内容,与用户预设的提示词(Prompt)结合,发送给指定的大模型API。
    - **保存结果**:将大模型返回的分析结果(Markdown格式)自动保存为该论文条目下的一个新笔记。
    - **笔记标识**:生成的笔记标题将包含特定的插件标识名(例如 `[AI-Butler] 论文标题`),用于功能1的状态判断。

3.  **灵活的插件配置中心**
    - **API配置**:
      - 支持Google Gemini大模型。
      - 支持Anthropic Claude大模型。
      - 支持OpenAI及兼容接口。
      - 支持设置自定义API端点(URL),以兼容各类本地部署或第三方模型服务。
    - **提示词配置**:
      - 提供默认的分析提示词(Prompt)。
      - 允许用户完全自定义预设的提示词内容。
    - **调度配置**:
      - 可设置自动扫描的时间间隔(例如:每 5 分钟刷新一次)。
      - 可设置每批次处理的论文数量(默认为1篇)。
      - 可设置每批次之间的执行间隔时间(例如:每批间隔60秒),用于API限流。

4.  **即时处理(手动触发)**
    - **右键菜单**:在Zotero条目列表(中栏)和PDF附件上提供右键快捷菜单。
    - **立即分析**:用户可选中一篇或多篇论文,通过右键菜单立即将其加入处理队列,无需等待后台自动扫描。

5.  **PDF文件解析**
    - **交由多模态大模型处理**:将PDF文件转换为 Base64 编码字符串,直接发送给支持多模态输入的大模型API进行处理。
    - **以Gemini为例**:PDF 文件的 Base64 字符串被放置在 `contents.parts.inlineData.data` 字段中,并附上其 `mimeType` 为 `application/pdf`。

6.  **任务队列与状态反馈**
    - **处理队列**:所有待分析的论文(无论是自动扫描还是手动触发)都将进入一个统一的"待处理"队列。
    - **状态显示**:在Zotero条目列表中增加一个自定义列("AI管家正在废寝忘食地工作🧐"/"AI管家正在休息😴"),显示当前工作状态(工作模式,管家正在阅读 X 篇文献,还剩 Y 篇文献)/历史工作总结(休息模式,管家已为您总结 X 篇文献),点击详情后,可展示所有论文的处理状态(待处理、处理中、已完成、失败,优先处理中、其次待处理、其次失败、最后已完成,记录完成的时间)。
    - **顺序执行**:后台任务严格按照队列顺序,根据用户设置的批次大小和间隔时间消费队列。

7.  **精细化错误处理与重试**
    - **API错误捕获**:能捕获API调用时的常见错误(如网络超时、连接拒绝、API密钥无效、429限流、5xx服务器错误等)。
    - **PDF解析错误**:能捕获PDF文本提取失败(如文件损坏、纯扫描件)的错误。
    - **重试机制**:
      - 在插件设置中允许配置"最大重试次数"(例如 3 次)。
      - 发生可重试错误(如网络超时、429)时,任务将返回队列尾部,等待下次调度时重试。
    - **失败标记**:达到最大重试次数后仍失败的论文,状态标记为"失败",并在状态列中提示,或在笔记中记录错误原因。

8.  **笔记管理策略**
    - **策略配置**:当插件检测到该论文已存在分析笔记时,允许用户在设置中选择执行策略:
      - **跳过 (默认)**:不执行任何操作。
      - **覆盖**:删除旧的分析笔记,调用API生成一篇全新的笔记。
      - **追加**:保留旧笔记,在旧笔记内容的末尾追加本次API返回的新内容。

9.  **Markdown 格式支持**
    - **格式保存**:假定大模型API返回的是Markdown格式文本。
    - **直接存储**:插件将返回的Markdown原文直接保存到Zotero笔记中。Zotero笔记编辑器(6.0.x以上版本)支持Markdown渲染。

10. **后续追问功能**
    - **对话界面**:在AI总结视图中提供"后续追问"按钮,允许用户与大模型进行多轮对话。
    - **上下文保持**:每次对话都会携带论文内容和完整对话历史,确保模型理解上下文。
    - **错误显示**:如果调用模型时出错,错误信息会直接显示在对话界面中。
    - **对话保存**:可选择将对话历史保存到论文的AI管家笔记中(需在设置中开启)。
    - **动态输入框**:输入框可根据内容自动调整大小,交互体验类似Cherry Studio。

## 🧠 LLM Provider 架构深入

系统采用“统一门面 + Provider 自注册”模式：

- `LLMClient` (文件 `src/modules/llmClient.ts`)：组装通用 `LLMOptions` 后调用具体 Provider；不包含任意 Vendor 专属流式解析代码。
- `ProviderRegistry`：集中管理注册的 Provider，通过 id 查找；新增 Provider 不需修改已有文件。
- Provider 能力标记：在类上定义 `capabilities`，例如 `supportsStreaming`、`supportsPdfBase64`，测试与界面可据此自适应。

### 新增 Provider 完整检查清单

> ⚠️ **重要**: 新增 Provider 需要修改多个文件，遗漏任何一项都可能导致功能异常。请严格按照以下清单逐项完成。

#### 1. 创建 Provider 类文件

```powershell
# 可使用脚本生成模板（如有）
node scripts/create-provider.mjs myNewProvider
```

或手动创建 `src/modules/llmproviders/MyNewProvider.ts`，实现 `ILlmProvider` 接口：

- [ ] 实现 `generateSummary(content, isBase64, prompt, options, onProgress)`
- [ ] 实现 `chat(pdfContent, isBase64, conversation, options, onProgress)`
- [ ] 实现 `testConnection(options)`
- [ ] 实现 `generateMultiFileSummary(pdfFiles, prompt, options, onProgress)`（如支持多文件）
- [ ] 在文件末尾添加自注册代码：`ProviderRegistry.register(new MyNewProvider())`

#### 2. 导出 Provider

**文件**: `src/modules/llmproviders/index.ts`

```typescript
export { default as MyNewProvider } from "./MyNewProvider";
```

#### 3. 配置 API Key 管理

**文件**: `src/modules/apiKeyManager.ts`

- [ ] 在 `ProviderId` 类型中添加新 ID
- [ ] 在 `PROVIDER_KEY_MAPPINGS` 中添加映射：

```typescript
mynewprovider: {
  primaryPrefKey: "myNewProviderApiKey",
  extraKeysPrefKey: "myNewProviderApiKeysFallback",
},
```

#### 4. 添加默认偏好设置

**文件**: `addon/prefs.js`

```javascript
pref("__prefsPrefix__.myNewProviderApiUrl", "https://api.example.com");
pref("__prefsPrefix__.myNewProviderApiKey", "");
pref("__prefsPrefix__.myNewProviderModel", "default-model");
```

#### 5. 添加类型定义

**文件**: `typings/prefs.d.ts`

```typescript
"myNewProviderApiUrl": string;
"myNewProviderApiKey": string;
"myNewProviderModel": string;
```

#### 6. 更新 LLM 客户端映射

**文件**: `src/modules/llmClient.ts`

- [ ] 在 `buildOptions` 方法中添加 `else if (id === "mynewprovider")` 分支
- [ ] 在 `mapToKeyManagerId` 方法中添加映射：`if (id === "mynewprovider") return "mynewprovider";`

#### 7. 添加 UI 设置界面 ⚠️ 容易遗漏

**文件**: `src/modules/views/settings/ApiSettingsPage.ts`

需要修改 **5 个位置**：

1. **Provider 下拉选项** (约 line 76-88)

   ```typescript
   { value: "mynewprovider", label: "My New Provider" },
   ```

2. **添加设置区域 Section** (约 line 400-480)
   - 创建 `sectionMyNewProvider` 元素
   - 添加 API URL、API Key、Model 输入框
   - 添加到 `form.appendChild(sectionMyNewProvider)`

3. **`renderProviderSections` 函数** (约 line 490-520)

   ```typescript
   const isMyNewProvider = prov === "mynewprovider";
   (sectionMyNewProvider as HTMLElement).style.display = isMyNewProvider
     ? "block"
     : "none";
   ```

4. **`saveSettings` 方法中的 DOM 元素获取** (约 line 1750-1820)

   ```typescript
   const mnpUrlEl = this.container.querySelector(
     "#setting-myNewProviderApiUrl",
   ) as HTMLInputElement;
   const mnpKeyEl = this.container.querySelector(
     "#setting-myNewProviderApiKey",
   ) as HTMLInputElement;
   const mnpModelEl = this.container.querySelector(
     "#setting-myNewProviderModel",
   ) as HTMLInputElement;
   ```

5. **`saveSettings` 方法中的 values 对象、验证和保存**
   - [ ] 在 `values` 对象中添加属性
   - [ ] 添加 `else if (provider === "mynewprovider")` 验证分支
   - [ ] 添加 `setPref` 保存调用

6. **`resetSettings` 方法中添加默认值重置**
   - [ ] 添加新 Provider 的 URL、API Key、Model 默认值

#### 8. 更新 API Key 验证逻辑 ⚠️ 容易遗漏

**文件**: `src/hooks.ts`

在 `handleGenerateSummary` 函数中添加新 Provider 的 API Key 检查分支：

```typescript
} else if (pLower === "mynewprovider") {
  selectedApiKey = Zotero.Prefs.get(
    `${config.prefsPrefix}.myNewProviderApiKey`,
    true,
  ) as string;
  providerName = "My New Provider";
}
```

> ⚠️ **重要**: 如果遗漏此步骤，用户选择新 Provider 时会显示错误的提示信息（如"请先在设置中配置 OpenAI API Key"）。

#### 9. 更新文档

- [ ] `README.md` - 支持平台表格
- [ ] `doc/DevelopmentGuide.md` - 环境变量示例
- [ ] `docs/api-configuration.md` - 配置指南

### 选项传递约定 (LLMOptions)

| 字段           | 说明              | 是否必填         |
| -------------- | ----------------- | ---------------- |
| provider       | Provider id       | 是               |
| temperature    | 采样温度          | 否               |
| stream         | 请求流式输出      | 否               |
| maxTokens      | 最大输出长度      | 否               |
| pdfMode        | `base64` / `text` | 是（由偏好决定） |
| promptTemplate | 提示词模板名      | 是               |
| timeoutMs      | 请求超时时间      | 否               |

Provider 若不支持某字段（例如不支持 `temperature`），应忽略而非报错，保证兼容性。

## 🔐 环境变量注入与测试机制

测试前置脚本 `scripts/gen-env-setup.mjs` 会读取 `.env` 并生成 `test/00.env-setup.test.ts` 将键值写入 Zotero 偏好。关键变量示例：

```
ACTIVE_LLM_PROVIDER=openai
OPENAI_API_KEY=sk-xxxxx
OPENAI_BASE_URL=https://api.openai.com/v1
GEMINI_API_KEY=ya29.xxxxx
GEMINI_BASE_URL=https://generativelanguage.googleapis.com
ANTHROPIC_API_KEY=sk-ant-xxxxx
ANTHROPIC_BASE_URL=https://api.anthropic.com
VOLCANOARK_API_KEY=ark-xxxxx
VOLCANOARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3/responses
TEMPERATURE=0.7
STREAM=true
MAX_TOKENS=4096
PDF_MODE=base64
```

### ACTIVE_LLM_PROVIDER 作用

- 仅对该 Provider 执行耗时的摘要/多模态测试。
- 其它 Provider 标记 `pending`，并记录原因（inactive 或缺少密钥）。
- 避免 CI 中出现大量由于未配置而失败的用例。

### Base64 PDF 测试说明

当 `PDF_MODE=base64` 且 Provider 声明 `supportsPdfBase64`：

1. 测试构造（或读取）一个小型 PDF（未来可替换为固定 fixture）。
2. 将其 Base64 写入请求数据结构中（不同服务字段可能不同）。
3. 验证返回是否含有结构化摘要（至少包含几个 Markdown 标题）。
4. 不支持时直接 `this.skip()`。

## 🧪 测试分层策略

| 层级               | 内容                            | 目的                                |
| ------------------ | ------------------------------- | ----------------------------------- |
| 连接测试           | `testConnection`                | 校验密钥/端点正确性与错误提示可读性 |
| 文本摘要（流式）   | `generateSummary(stream=true)`  | 校验分块拼接与最终完整性            |
| 文本摘要（非流式） | `generateSummary(stream=false)` | 验证降级路径逻辑                    |
| Base64 PDF         | `pdfMode=base64`                | 多模态能力验证/自动跳过             |

## 🔄 错误与重试策略（扩展）

建议 Provider 内部：

- 识别速率限制 (`429`) → 抛出带 `code='rate_limit'` 的错误，由队列层决定是否重试。
- 识别网络超时 → 抛出 `code='timeout'`。
- JSON 解析失败 → 附加原始片段便于调试。

## 🧪 本地调试小贴士

- 仅调试某 Provider：直接改 `.env` 的 `ACTIVE_LLM_PROVIDER`。
- 临时禁用流式：设置 `STREAM=false`。
- 快速验证 token 限制：将 `MAX_TOKENS` 调低，比如 256，观察截断行为。

## 🎨 UI 显示配置常量

以下常量位于 `src/modules/ItemPaneSection.ts`，可根据需要调整：

| 常量名                              | 默认值 | 说明                                                         |
| ----------------------------------- | ------ | ------------------------------------------------------------ |
| `INLINE_FORMULA_TO_BLOCK_THRESHOLD` | 2000   | 内联公式渲染后 HTML 字符数阈值，超过则转换为可滚动的块级公式 |

**调整方法**：

```typescript
// src/modules/ItemPaneSection.ts 文件头部
const INLINE_FORMULA_TO_BLOCK_THRESHOLD = 2000; // 调整此值
```

**工作原理**：

- 当 KaTeX 渲染内联公式后，检查生成的 HTML 字符串长度
- 如果超过阈值，自动将其包装为 `katex-scroll-container` 块级容器
- 块级容器带有横向滚动条，避免撑宽侧边栏

## 📝 提示词模板扩展

新增模板步骤：

1. 在 `src/utils/prompts.ts` 中添加模板结构。
2. 在偏好/设置页面增加下拉选项。
3. （可选）在测试中添加一个使用新模板的 smoke case。

## ✅ 质量门控建议

- 构建：`npm run build` 应无类型错误。
- 测试：活动 Provider 全部通过，非活动仅 pending。
- Lint：`npm run lint:check` 通过。
- 后续可引入：Provider 契约的 API 变更 diff 检测（利用 TypeScript `dts` 输出）。
