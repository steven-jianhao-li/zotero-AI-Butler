# Chapter planning failures / 章节规划失败

## 中文

全文可读但没有显式分节标题的 Letter 和短文不等于输入缺失：中英文默认提示词现在要求将前者作为一个 `whole_paper` 阅读单元，而不是虚构原文章节。全文缺失或不可读时仍返回空规划并安全停止；不覆盖用户已有自定义模板。

模型未读到 PDF 或返回无效规划时，原先的默认章节与手动弹窗会掩盖输入失败并继续产生无效请求。现在保留可解析的章节对象、JSON 数组及正则提取；不能识别章节时以可定位错误终止，不写入虚构笔记，也不自动重试终止型错误。

错误包含输入模式和最多 600 字符的模型响应预览；默认提示词明确禁止猜测章节。现有不完整响应错误处理与非终止错误的会话回退保持不变。运行 `npm run test:deepread-planning`，覆盖有效格式、空/无效响应、零写入、无弹窗以及终止/非终止回退。无新增依赖或公开 API；响应解析为 O(N)，预览有长度上限。不代表所有模型都支持 Base64 PDF，也不自动切换用户配置。

## English

Readable Letters and short articles without explicit section headings are distinct from missing input: both default prompt languages now request one `whole_paper` reading unit for the former, not invented source headings. Missing or unreadable input still returns an empty plan and stops. Existing custom templates are not overwritten.

When a model cannot read a PDF or returns invalid planning output, invented default chapters and modal input conceal the input failure and trigger useless requests. Recognizable chapter objects, JSON arrays, and regex extraction remain supported; unrecognizable planning now stops with an actionable error, without fabricated notes or automatic retries of terminal failures.

Diagnostics include the input mode and at most 600 characters of model response. The default prompt explicitly forbids guessing chapters. Existing incomplete-response handling and nonterminal session fallback are preserved. Run `npm run test:deepread-planning` for valid formats, invalid/empty responses, zero writes, no modal, and terminal/nonterminal fallback. No dependencies or public APIs change; parsing costs O(N), with a bounded preview. This does not make every model support Base64 PDFs or automatically change user configuration.
