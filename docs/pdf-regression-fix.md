# PDF extraction recovery

## 中文

索引状态不能证明缓存有文本。先读取可用缓存，再至多修复一次索引；取消操作立即传播。Windows Zotero 6 转换失败时使用私有 ASCII 路径副本，并在完成后清理；提取错误不触发 API 切换或队列重试，保留可复制诊断。

回归测试：`test:pdf`。测试覆盖取消/边界与现有行为，使用隔离 fixture，不读取个人库或调用真实 AI。实机测试范围以 PR 描述列出的结果为准。

## English

Index status can outlive readable cache content. Read available text, repair the index once, and propagate cancellation. On Windows Zotero 6 converter failures, stage a private ASCII-path copy and clean it after completion. Extraction errors bypass endpoint and task retries and retain copyable diagnostics.

Regression command: `npm run test:pdf`. Tests exercise boundaries and existing behavior with isolated fixtures, without personal libraries or live AI requests. Refer to the PR description for the actual native-host validation scope.
