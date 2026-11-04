# Legacy Windows PDF paths / 旧版 Windows PDF 路径

## 中文

Zotero 6 的 Windows PDF 转换器可能无法读取 Unicode 路径。遇到这一已知边界时优先读取已有全文缓存；无缓存才直接使用已有的私有 ASCII 工作目录转换，避免先重复调用已知失败的宿主索引链路。保留取消信号和可定位的提取错误。

工作目录优先使用系统配置的临时目录，再尝试宿主临时目录和资料库。新版本及 ASCII 路径保持原有流程。运行 `npm run test:pdf`；测试覆盖缓存命中、直接转换、取消及错误传播。文件复制的时间和临时空间均为 O(P)，P 为 PDF 大小；不增加依赖。

## English

The Zotero 6 Windows PDF converter can fail on Unicode paths. At this known compatibility boundary, read the existing full-text cache first, then use the existing private ASCII workspace directly instead of repeating known-failing host indexing. Cancellation and actionable extraction errors remain intact.

Workspace selection prefers the configured system temporary directory, then the host temporary directory and library. Modern hosts and ASCII paths retain their existing flow. Run `npm run test:pdf` for cache hits, direct conversion, cancellation, and error propagation. Copying costs O(P) time and temporary space for PDF size P; no dependency is added.
