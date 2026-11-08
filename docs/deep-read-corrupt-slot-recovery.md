# Repairing existing deep-read notes / 修复存量精读笔记

## 中文

早期字符串替换可能把 `$&` 展开为正在生成的章节占位 HTML，并写入已完成章节的数学表达式。此修复不重复上游已合并的替换逻辑修复，而是在用户明确继续已有笔记时保守修复存量内容。

只匹配已完成章节内同 ID 的运行中占位、已知占位文本、数学 span 与紧邻的 HTML 实体后缀。真实未完成章节及无关内容保持不变；重复执行幂等，修复本身不调用模型。运行 `npm run test:deepread-recovery`，覆盖重复展开、保留正常内容及保存次数。最坏时间 O(N×K)，空间 O(N+K)，N 为笔记长度、K 为标记数；仅在继续任务时运行，不在流式热路径运行。

## English

Earlier string replacement could expand `$&` into running chapter placeholder HTML inside a completed chapter's math expression. This does not duplicate the upstream replacement fix; it conservatively repairs already-persisted notes when the user explicitly resumes them.

Repair requires a completed parent, a same-ID running placeholder with known placeholder text, a math span, and an adjacent HTML entity suffix. Genuine unfinished chapters and unrelated content remain unchanged. Repair is idempotent and makes no model request. Run `npm run test:deepread-recovery` for repeated expansions, preservation, and persistence counts. Worst-case time is O(N×K), space O(N+K), for note length N and marker count K; repair runs on resume, not the streaming hot path.
