# Renderer-matched KaTeX assets / KaTeX 渲染资源一致性

## 中文

### 根因与修复

构建依赖中的 KaTeX 已升级至 0.18.1，但静态样式仍来自 0.16.27。新渲染器输出 `katex-base`、`katex-strut` 与 `katex-sizing`，旧 CSS 使用旧类名，造成公式基线、撑高和上下标尺寸规则失效。内容仍在笔记中，重新生成精读不能修复这个资源版本问题。

构建 hook 从实际解析到的 KaTeX 依赖中复制官方 CSS 和字体，然后才创建 Zotero 6 的 legacy 资源副本。现代和旧版包都使用相同来源，不依赖人工同步第三方文件，不修改笔记数据或用户配置，也不新增运行时依赖。

构建复制的时间和输出空间复杂度为 O(B)，B 为 CSS 和字体文件总字节数。运行时渲染路径没有新增工作。已安装的旧包需要正常重启以载入新资源；若宿主仍缓存旧资源，应刷新宿主启动缓存，而不是修改保存的数学内容。

### 回归验证

运行 `npm run test:katex-assets`。测试调用真正的构建 hook，并核对现代与 legacy 两份输出的 CSS 版本、布局规则以及每个引用字体的内容，确保与运行时依赖完全匹配。旧 hook 会因 0.16.27 与 0.18.1 不一致而失败。

实际 Zotero 6.0.27 的组合包验证中，匹配资源恢复了 `inline-block` 基础布局、非零 strut 高度和正常上下标尺寸。对已有笔记的 78 个公式进行重渲染，字体成功加载，12px 和 20px 的实际渲染截图显示数值、化学式、上下标与分数；保存的笔记没有改动，也没有新模型请求。这是组合包的宿主验证，不等同于独立分支在所有 Zotero 版本上的实测。

原报告中的完全空白字形在刷新缓存后的基线运行中未再复现。因此，已确认的是资源版本错配及其布局影响，不将所有可能的空白渲染现象都归因于同一个机制。私有笔记、截图、配置和日志不随本修复提交。

## English

### Cause and repair

The resolved KaTeX renderer is 0.18.1, but the vendored stylesheet is 0.16.27. The renderer emits `katex-base`, `katex-strut`, and `katex-sizing`; the stale selectors target their old names, leaving baseline, strut, and script-size rules unapplied. Regenerating note content cannot resolve this asset mismatch.

The build hook copies official CSS and fonts from the resolved renderer dependency before creating Zotero 6 legacy assets. Both host paths therefore use one source of truth without manually maintaining third-party copies. Stored notes and user preferences are unchanged, and no runtime dependency is added.

Copying costs O(B) build time and output space for B total asset bytes, with no additional runtime rendering work. Restart the host normally after installation; if old resources remain cached, refresh its startup cache rather than rewriting mathematical content.

### Regression validation

Run `npm run test:katex-assets`. The regression invokes the actual build hook and checks both modern and legacy stylesheet versions, layout selectors, and every referenced font against the resolved dependency. The original hook fails on the 0.16.27/0.18.1 mismatch.

Combined-package validation on actual Zotero 6.0.27 restored inline-block bases, nonzero strut heights, and correct script sizes. Re-rendering an existing note produced 78 formulas with successfully loaded fonts; actual 12px/20px captures show values, chemical formulas, scripts, and fractions. Stored content remained unchanged, with no new model requests. This is combined-package host evidence, not independent-branch testing across every Zotero version.

Complete glyph disappearance from the original report did not recur in a cache-refreshed baseline. The confirmed defect is the asset mismatch and its layout effects; this does not attribute every possible blank-rendering symptom to the same mechanism. No private notes, screenshots, preferences, or logs are included.
