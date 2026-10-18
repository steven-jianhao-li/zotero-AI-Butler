# Sidebar viewport scrolling

## 中文

侧栏使用所属文档的可见高度，扣除偏移及底边距；不再用顶层窗口高度或 320px 最小高度撑出可视区。原生滚动候选必须具有 auto/scroll 溢出属性，避免隐藏容器吞掉滚轮。

回归测试：`test:sidebar`。测试覆盖取消/边界与现有行为，使用隔离 fixture，不读取个人库或调用真实 AI。实机测试范围以 PR 描述列出的结果为准。

## English

Size the sidebar from its owning document viewport, offset, and bottom inset rather than the taller top window or a 320px minimum. Native wheel candidates must use auto/scroll overflow so clipped containers cannot consume scrolling.

Regression command: `npm run test:sidebar`. Tests exercise boundaries and existing behavior with isolated fixtures, without personal libraries or live AI requests. Refer to the PR description for the actual native-host validation scope.
