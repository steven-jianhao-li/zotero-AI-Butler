# AI 笔记重构进度与交接计划

本文档给下一轮 session 使用。实施过程中继续维护本文件和 `AI_NOTE_REFACTOR_TODO.md`。

## 当前总目标

把现有“AI 笔记”体系重构为两类笔记：

- **AI 总结**：把文章读薄，对应单轮总结。
- **AI 精读**：把论文读厚，对应固定多轮拼接，以及后续追问 / 临时追问的保存沉淀。

命名统一为“AI 总结”和“AI 精读”，中间有空格。

## 已完成

- 新笔记服务边界已建立：`src/modules/aiNoteService.ts` 统一查找、创建、覆盖、追加追问，并兼容旧 `AI-Generated` 与旧追问笔记。
- 生成路径已拆分：单轮总结写 AI 总结；AI 精读固定多轮拼接；多模型路径写 AI 精读。
- 任务队列已拆分：`summary` 保留为 AI 总结，`deepRead` 作为 AI 精读；任务 ID 使用 `summary-task-<itemId>` / `deepread-task-<itemId>`。
- 自动扫描已支持 `autoScanSummaryEnabled` 与 `autoScanDeepReadEnabled`，总开关仍为 `autoScan`。
- 追问保存已沉淀到 AI 精读，继续复用 chat pair marker。
- 侧边栏已拆分为 AI 总结与 AI 精读两个模块，并补充独立 DOM id、折叠状态、高度、metadata 选择状态。
- AI 状态列已改为综合状态，同时计算 AI 总结和 AI 精读任务 / 笔记状态。
- 清理、重生成、产物探测已支持 AI 精读。
- 一图总结“使用已有 AI 笔记”语义已改为使用 AI 总结。
- 提示词设置已拆成三个独立设置页面：AI 总结提示词、AI 精读提示词、表格总结提示词；页面内已去掉重复标题/说明和外层圆角卡片，继续沿用旧 pref。AI 精读提示词轮次列表已改为紧凑表格式行布局，新增/恢复按钮移到标题栏右侧，内容区不再被按钮占位。
- 批量扫描入口已拆分：仪表盘提供“扫描未总结论文”和“扫描未精读论文”；扫描视图和旧 dialog 均按目标类型检查与入队。
- 数据设置已拆分空笔记清理：清空空 AI 总结、清空空 AI 精读。
- `src/utils/prompts.ts` 默认多轮 final prompt 已改为 AI 精读最终总结语义。
- `docs/quick-start.md`、`docs/faq.md`、`docs/literature-review.md` 已更新 AI 总结 / AI 精读相关说明。
- 新增测试：`test/aiNoteRefactorUi.test.ts` 覆盖扫描目标映射和侧边栏独立状态 key。

## 当前验证结果

本轮已运行并通过：

- `npm test`：输出显示 113 passed，但本次命令在 120s 超时边界返回 124；此前完整通过，当前未见失败用例。
- `npm run lint:check`：通过。
- `npm run build`：通过。

注意：`npm test` 会重新生成 `test/00.env-setup.test.ts`，当前未显示该文件变更。

## 当前工作区状态

- 代码和文档有未提交改动。
- 交接文档 `AI_NOTE_REFACTOR_PROGRESS.md` 与 `AI_NOTE_REFACTOR_TODO.md` 仍是未跟踪文件；除非用户明确要求，不要默认 add / commit。

## 下一轮建议执行顺序

1. 人工验收设置页：确认能一眼看到 AI 总结、AI 精读、表格总结三块配置，保存 / 恢复默认互不影响。
2. 人工验收批量扫描：分别点击“扫描未总结论文”和“扫描未精读论文”，确认列表判断和入队任务类型正确。
3. 人工验收侧边栏：AI 总结和 AI 精读同时显示时，折叠、高度、metadata 选择互不影响，编辑 / 复制 / 删除目标正确。
4. 人工验收生成路径：单轮总结只写 AI 总结，AI 精读固定多轮拼接并只写 AI 精读，追问追加到 AI 精读。
5. 继续扫剩余注释和文档中泛称“AI 笔记”的位置；优先修用户可见文案，内部注释可按需逐步清理。
