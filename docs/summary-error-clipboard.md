# Copying summary errors / 复制摘要错误

## 中文

旧版 Zotero 的 XUL 文档可能缺少浏览器剪贴板 API，普通 `createElement` 也不保证创建 HTML 文本框。复制错误信息时优先使用 Zotero 原生接口，失败后尝试浏览器接口，再使用显式 HTML 命名空间的文本框。

检查 `execCommand` 返回值，避免将失败误报为成功；无论成功与否都移除临时节点。运行 `npm run test:summary-clipboard`，覆盖原生复制与回退失败及清理。无新增依赖或公开 API；复制文本的时间和空间均为 O(N)。

## English

Legacy Zotero XUL documents may lack the browser clipboard API, and plain `createElement` does not guarantee an HTML textarea. Error copying now prefers Zotero's native clipboard API, then the browser API, and finally an explicitly HTML-namespaced textarea.

The fallback checks `execCommand`'s return value rather than reporting false success and always removes its temporary node. Run `npm run test:summary-clipboard` for native copying, fallback failure, and cleanup. No dependencies or public APIs change; copying text takes O(N) time and space.
