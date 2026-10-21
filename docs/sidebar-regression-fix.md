# Sidebar viewport scrolling

## 中文

侧栏使用所属文档的可见高度，扣除偏移及底边距；不再用顶层窗口高度或 320px 最小高度撑出可视区。原生滚动候选必须具有 auto/scroll 溢出属性，避免隐藏容器吞掉滚轮。

回归测试：`test:sidebar`。测试覆盖取消/边界与现有行为，使用隔离 fixture，不读取个人库或调用真实 AI。实机测试范围以 PR 描述列出的结果为准。

追问历史回归：`node --test test/followUpChatHistory.test.mjs`。覆盖快速追问保存后在完整追问中恢复问答、旧笔记格式、重复保存和并发保存。

界面刷新回归：`node --test test/uiRefresh.test.mjs`。覆盖自动滚动设置即时生效、状态列重绘和侧栏重绘保护。测试使用模拟宿主，不代替 Zotero 原生编辑器的实机验证。

原生验证：`node scripts/test-zotero-compat.mjs <Zotero可执行文件路径>` 会创建隔离配置与文献库。Zotero 9.0.6 已通过输入文字、回车、自动保存后的状态列重绘检查，原生笔记编辑器保留焦点与条目选择。

## English

Size the sidebar from its owning document viewport, offset, and bottom inset rather than the taller top window or a 320px minimum. Native wheel candidates must use auto/scroll overflow so clipped containers cannot consume scrolling.

Regression command: `npm run test:sidebar`. Tests exercise boundaries and existing behavior with isolated fixtures, without personal libraries or live AI requests. Refer to the PR description for the actual native-host validation scope.

Chat history: `node --test test/followUpChatHistory.test.mjs`. These fixtures cover saved quick-to-full chat history, legacy notes, and duplicate and concurrent saves.

UI refresh: `node --test test/uiRefresh.test.mjs`. These fixtures cover live auto-scroll preferences, row redraws, and sidebar editing guards. They do not replace native Zotero editor testing.

Native verification: `node scripts/test-zotero-compat.mjs <Zotero executable>` creates an isolated profile and library. Zotero 9.0.6 passed the text insertion, paragraph insertion, autosave, and status redraw check while retaining the native note editor's focus and item selection.
