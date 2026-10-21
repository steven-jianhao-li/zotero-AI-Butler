# AI 笔记导出

在 **快捷设置 → 自动导出** 中设置导出根目录、监听分类和格式。自动导出会在论文已完成 AI 总结与 AI 精读后检查导出条件；也可以右键 Zotero 分类，一键导出已有的 AI 笔记。

导出目录结构为 `根目录 / Zotero 分类层级 / 论文题目 / 导出文件`，论文附件放在 `attachments` 子目录中。

## 自定义文件命名

“导出文件命名”同时用于自动导出和右键分类导出，Markdown 与 DOCX 使用相同的命名规则。默认模板为：

```text
{collectionPath} - {title} - {noteType}
```

例如，位于“机器学习 / Transformer”分类中的论文 _Attention Is All You Need_，导出的文件名为：

```text
机器学习 - Transformer - Attention Is All You Need - summary.md
机器学习 - Transformer - Attention Is All You Need - summary.docx
机器学习 - Transformer - Attention Is All You Need - deep-read.md
机器学习 - Transformer - Attention Is All You Need - deep-read.docx
```

分类层级会以 `-` 连接到文件名中，便于在 Obsidian 图谱中区分论文。这里的“目录”指 Zotero 分类层级。

可以直接编辑模板，也可以点击字段按钮，在光标处插入字段。下方会实时显示示例论文的导出文件名；点击“恢复默认”可还原默认模板。

| 字段               | 内容                                           |
| ------------------ | ---------------------------------------------- |
| `{collectionPath}` | 当前导出分类的完整层级，以 `-` 连接            |
| `{collection}`     | 当前导出分类名称                               |
| `{title}`          | 论文题目；缺少题目时使用条目 Key 兜底          |
| `{firstAuthor}`    | 第一作者姓氏或机构名；没有作者时取第一位贡献者 |
| `{year}`           | 发表日期中的年份                               |
| `{itemKey}`        | Zotero 条目的稳定 Key                          |
| `{model}`          | 笔记实际记录的模型名；多个不同模型以 `+` 连接  |
| `{noteType}`       | `summary`（总结）或 `deep-read`（精读）        |

例如，按作者、年份和论文题目命名：

```text
{firstAuthor} - {year} - {title} - {noteType}
```

按论文题目和生成模型命名：

```text
{title} - {model} - {noteType}
```

不需要在模板中填写 `.md` 或 `.docx`。省略 `{noteType}` 时会自动添加类型后缀，避免总结与精读互相覆盖。旧笔记若没有记录模型，该字段留空；不会使用当前 API 设置中的模型代替。

空模板使用默认规则，字段拼写或花括号错误时保留上次有效设置。文件名中的不允许字符会替换为下划线；过长名称会缩短，并保留笔记类型和稳定标识以减少冲突。

新规则在后续导出时生效，已有导出文件不会自动重命名。重复导出同名文件时，继续遵循设置中的“跳过”或“覆盖”策略；如修改模板导致文件名变化，会生成新文件。
