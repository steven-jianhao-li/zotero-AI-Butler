# Onboarding visibility

## 中文

教程跟踪真实窗口与导航状态，避免异步打开窗口后停在旧步骤；导入步骤允许选择现有 PDF。默认窗口为 1100 × 800 并受可用屏幕限幅。自动精读说明滚动到对应设置但不切换开关；设置导航保留滚动能力。

回归测试：`test:onboarding`。测试覆盖取消/边界与现有行为，使用隔离 fixture，不读取个人库或调用真实 AI。实机测试范围以 PR 描述列出的结果为准。

## English

Track actual window and navigation state, including delayed dashboard readiness and existing PDF selection. Default the dashboard to 1100 × 800 within available screen bounds. Reveal the automatic deep-reading setting without toggling it; preserve scrollable settings navigation.

Regression command: `npm run test:onboarding`. Tests exercise boundaries and existing behavior with isolated fixtures, without personal libraries or live AI requests. Refer to the PR description for the actual native-host validation scope.
