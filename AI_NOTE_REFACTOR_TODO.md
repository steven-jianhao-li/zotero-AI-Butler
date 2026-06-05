# AI 笔记重构 TODO

## 已完成

- [x] 建立 `AiNoteService`，统一 AI 总结 / AI 精读笔记查找、创建、覆盖、追问追加与旧笔记兼容。
- [x] 单轮总结写 AI 总结；AI 精读固定多轮拼接，多模型路径写 AI 精读。
- [x] 任务队列拆分 `summary` / `deepRead`，并使用不冲突任务 ID。
- [x] 自动扫描支持 AI 总结和 AI 精读独立开关。
- [x] 完整追问和侧边栏临时追问保存到 AI 精读。
- [x] 侧边栏新增 AI 精读模块，原 note 模块语义改为 AI 总结。
- [x] AI 状态列综合显示 AI 总结和 AI 精读状态。
- [x] 清理、重生成、产物探测支持 AI 精读。
- [x] 一图总结使用已有 AI 总结语义。
- [x] 提示词设置拆成 AI 总结提示词 / AI 精读提示词 / 表格总结提示词三个独立设置页面，并移除页面内重复说明和外层圆角卡片；AI 精读轮次列表紧凑表格式排版已完成，新增/恢复按钮已移至标题栏。
- [x] 批量扫描入口拆成“扫描未总结论文”和“扫描未精读论文”。
- [x] `LibraryScannerView` 和 `libraryScannerDialog` 按目标类型检查缺失笔记并入队。
- [x] 侧边栏 AI 总结 / AI 精读折叠、高度、metadata 选择状态独立保存，summary 保留旧 pref fallback。
- [x] `DataSettingsPage` 拆成清空空 AI 总结、清空空 AI 精读。
- [x] 更新默认 AI 精读 final prompt、关键 docs 和新增 UI helper 测试。

## 仍需人工验收

- [ ] 设置左侧导航中的三个提示词页面显示清晰，AI 总结 / AI 精读 / 表格总结保存和恢复默认互不影响。
- [ ] “扫描未总结论文”只列出缺 AI 总结的文献，并入队 `summary` / `summary-task-<itemId>`。
- [ ] “扫描未精读论文”只列出缺 AI 精读的文献，并入队 `deepRead` / `deepread-task-<itemId>`。
- [ ] 单轮总结只创建 / 更新 AI 总结。
- [ ] AI 精读只创建 / 更新 AI 精读笔记，固定多轮拼接。
- [ ] 完整追问和侧边栏临时追问追加到 AI 精读。
- [ ] 侧边栏 AI 总结和 AI 精读同时显示时，编辑 / 复制 / 删除 / metadata 切换目标正确。
- [ ] 侧边栏 AI 总结和 AI 精读折叠、高度、metadata 选择互不影响。
- [ ] 旧用户升级提示仍能识别旧 `AI-Generated` 笔记并提示更名为 AI 总结。

## 可继续清理

- [ ] 继续检查 `docs/` 其它页面和 `addon/locale/en-US` / `zh-CN` 是否还有用户可见旧“AI 笔记”泛称。
- [ ] 继续清理源码注释中的旧“AI 笔记”描述；不要为了注释做大范围风险改动。
- [ ] 如人工验收发现批量扫描旧 dialog 已无入口，可考虑后续删除或合并。
- [ ] `AI_NOTE_REFACTOR_PROGRESS.md` 和本文件是交接文档，当前未跟踪；除非用户要求，不要提交。

## 自动验证

- [x] `npm test` 输出显示 113 passed；本次命令在 120s 超时边界返回 124，未见失败用例。
- [x] `npm run lint:check` 通过。
- [x] `npm run build` 通过。
