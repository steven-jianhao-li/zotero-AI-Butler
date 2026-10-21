# Isolated Zotero compatibility / 隔离式 Zotero 兼容

## 中文

### 目标与边界

同一个 XPI 为 Zotero 6 提供 `install.rdf`，为现代 Zotero 保留 `manifest.json`。安装器读取自身支持的清单；启动入口解析宿主大版本，仅 `6` 进入旧版路径。现代清单保持原有 `7.0.0` 至 `10.*` 范围，不能把模拟未来版本的单元测试当成已验证的安装支持。

现代宿主缺少必需能力时给出诊断，不悄悄降级到旧版实现。新大版本仍采用现代路径；只有完成该版本验证后才应扩大清单范围。用户的文献库、配置与 API 密钥不迁移。

### 实现与权衡

- 原始现代资源保留在 `content/`；构建复制到 `legacy/content/` 后仅转换旧版副本。
- 旧版 JavaScript 目标为 Firefox 60，Unicode 正则由 Babel 转换，旧版页面加载隔离 polyfill。
- 插件沙盒防止 core-js 修改 Zotero 或其他插件的全局原型。旧版文件操作使用 OS.File，现代端保留原生 IOUtils/PathUtils/Localization。
- 旧版 UI 适配器提供侧栏、状态列、阅读器按钮和偏好设置入口；HTML 控件显式使用 XHTML 命名空间。
- 定时器取自对应 Gecko Timer 模块，而非现代 Zotero 已删除的 `Zotero.setTimeout`。禁用时释放监听器、工具栏、窗口与扫描任务。
- 代价是 XPI 包含两套资源。构建处理复杂度为 O(B)，B 为打包资源总字节；旧版额外资源空间为 O(B)。版本选择为 O(1)，现代路径不执行 core-js。未测量运行时性能基准，不宣称性能提升。

### 验证

先运行 `npm run build`，再运行 `npm run test:compat`、`npm run test:epub`、`npm run test:agent` 和 `npm run lint:check`。兼容回归在 CI 的构建之后执行。

原生测试命令：`npm run test:compat:host -- <isolated-zotero-executable>`。可追加一个 XPI 路径以检查对照包。测试创建独立 profile 和文献库，不读取用户真实 profile，也不调用 LLM。证据保存在 `.scaffold/host-tests/run-*/`，应使用具备足够空间的工作盘。

兼容层已有 Windows 上 Zotero 6.0.27 与 10.0.6 的验证记录：安装、工具栏、版本专属侧栏边界、状态列、文件 API 边界、脑图、设置窗口、禁用清理、重新启用。单元测试覆盖 7、8、10、模拟未来大版本、无效版本、能力缺失、现代 DOM 不变及失败启动清理。

EPUB 回归另在 Windows 的 Zotero 6.0.27、7.0.32 和 9.0.6 上通过：6.0.27 安全拒绝 EPUB 分析，7.0.32 的 JSM 与 9.0.6 的 ESM 原生模块均能按阅读顺序提取中文章节。原生测试使用临时生成的 EPUB，并检查插件禁用、重新启用；不调用 LLM。生成的测试脚本对路径使用 Unicode 转义，以兼容旧版加载器和中文工作目录。Zotero 8、macOS/Linux 尚未实机验证。

本 PR 不包含独立的 PDF 恢复、教程窗口和侧栏滚动修复。

已知限制：Zotero 10 冷启动的 `_resetColumns` 警告也在不含本兼容功能的对照包中复现；本次没有把无关宿主生命周期重构混入兼容 PR。设置页仍会触发已有的 `getSelectedLibraryID` 弃用诊断，应另行跟进该 API 迁移。原生冒烟通过不等于全部日志无警告。

## English

### Goal and boundary

One XPI supplies `install.rdf` for Zotero 6 and retains `manifest.json` for modern Zotero. Each installer reads its supported manifest. Bootstrap parses the host major version and selects the legacy path only for major 6. The modern manifest retains its existing `7.0.0`–`10.*` range; simulated future-major unit tests do not establish installation support.

Missing required modern capabilities produce a diagnostic, never a silent legacy fallback. Future majors retain the modern path; expand the manifest only after validating the new host. No user library, preference or API credential migration is performed.

### Implementation and trade-offs

- Preserve original modern assets in `content/`; copy to `legacy/content/` and transform only the legacy copy.
- Target Firefox 60 for legacy JavaScript, transform Unicode regex through Babel, and load isolated polyfills only in legacy pages.
- A plugin sandbox keeps core-js changes out of Zotero and other plugins. Legacy filesystem operations use OS.File; modern hosts retain native IOUtils/PathUtils/Localization.
- Legacy UI adapters provide sidebar, status columns, reader buttons and a preferences entry. HTML controls explicitly retain the XHTML namespace.
- Timers use the appropriate Gecko Timer module instead of the removed modern `Zotero.setTimeout` API. Disable releases listeners, toolbar elements, windows and scan tasks.
- Shipping two asset trees increases XPI size. Build processing is O(B), where B is total packaged asset bytes, and legacy resources add O(B) storage. Version dispatch is O(1); modern hosts do not execute core-js. No runtime benchmark was measured and no speed improvement is claimed.

### Validation

Run `npm run build`, then `npm run test:compat`, `npm run test:epub`, `npm run test:agent` and `npm run lint:check`. CI executes compatibility regressions after building the artifact.

Native smoke command: `npm run test:compat:host -- <isolated-zotero-executable>`. An optional additional XPI path supports control artifacts. The runner creates independent profiles/libraries, never reads the real user profile and does not call an LLM. Evidence lives in `.scaffold/host-tests/run-*/`; select a workspace drive with sufficient storage.

The compatibility layer has prior Windows validation with Zotero 6.0.27 and 10.0.6: installation, toolbar, host-specific sidebar boundary, columns, filesystem boundary, mindmap, settings, disable cleanup and re-enable. Unit coverage includes majors 7/8/10 and a simulated future major, invalid versions, missing capabilities, untouched modern DOM and failed-startup cleanup.

EPUB regressions also passed on Windows with Zotero 6.0.27, 7.0.32 and 9.0.6: 6.0.27 safely declines EPUB analysis; the native JSM module on 7.0.32 and ESM module on 9.0.6 extract Chinese sections in reading order. Native tests use a generated EPUB fixture, check disable/re-enable, and make no LLM calls. Generated probe scripts escape Unicode paths for legacy loaders and workspaces with Chinese names. Native Zotero 8 and macOS/Linux remain unverified.

Independent PDF recovery, tutorial-window and sidebar-scroll fixes are deliberately excluded from this PR.

Known limitations: the Zotero 10 cold-start `_resetColumns` warning also reproduces with a control artifact that excludes this compatibility feature; unrelated host lifecycle restructuring is not included. The settings page still triggers the existing `getSelectedLibraryID` deprecation diagnostic, which requires a separate API migration. Passing native smoke checks does not imply warning-free logs.
