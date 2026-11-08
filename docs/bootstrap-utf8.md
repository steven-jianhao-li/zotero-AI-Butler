# Packaged script decoding / 打包脚本解码

## 中文

启动器使用两种 Gecko 子脚本加载 API 时都显式指定 UTF-8，避免依赖宿主默认编码解释插件中的中文及其他非 ASCII 文本。此变更不修改安装状态、用户 profile 或扩展缓存，也不将所有启动失败归因于编码。

回归测试分别捕获两条加载路径传入的字符集。运行 `npm run build` 后执行 `npm run test:compat`。不增加依赖或改变公开 API；时间和空间复杂度仍随脚本大小线性增长。

## English

Both Gecko subscript-loading APIs explicitly receive UTF-8 rather than relying on host defaults for Chinese and other non-ASCII packaged text. This does not change installation state, user profiles, or extension caches, and does not attribute every startup failure to encoding.

Regression tests capture the charset for both loader paths. Run `npm run build` followed by `npm run test:compat`. No dependencies or public APIs change; loading remains linear in script size.
