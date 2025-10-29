# zotero-AI-Butler

[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

> **文献下载一时爽，打开阅读火葬场。**
> **天书难啃骨头硬，管家嚼碎再喂粮。**

想着稍后阅读的论文，最后却变成了永不阅读？
长篇大论的学术论文，有翻译却也抓不住重点？

别慌！您的专属AI管家 `Zotero-AI-Butler` 已闪亮登场！

TA 是您7x24小时待命、不知疲倦且绝对忠诚的私人管家。
您只管像往常一样把文献丢进 Zotero，剩下的体力活全交给TA！
管家会自动帮您精读论文，将文章揉碎了总结为笔记，让您“十分钟完全了解”这篇论文！

**核心功能：**

1.  **自动巡视 (自动扫描)**：管家会在后台默默巡视您的文献库，一旦发现您“丢”进来了新论文（或是您想对积压已久的旧论文开刀），只要还没有笔记，TA 就会自动开工。
2.  **深度解析 (生成笔记)**：管家的核心任务——利用大模型将论文精读、揉碎、嚼烂后，整理成一份热腾腾、条理清晰的 Markdown 笔记塞进您的 Zotero 条目下。
3.  **随时待命 (右键菜单)**：除了“全自动”托管，您也可以随时右键点击任何一篇论文，让管家现在、立刻、最高优先级地分析这篇文章。
4.  **管家智能（无损阅读）**：管家会根据自己模型的多模态能力直接处理PDF文件，不经过本地OCR或文本提取，最大程度保留论文内容的完整性和准确性，图片、表格、公式等都不在话下！

推荐使用 Google Gemini 2.5 pro 模型，Gemini读论文讲的很到位。

> **您只负责思考，`Zotero-AI-Butler` 负责为您的阅读扫清障碍！**

## 致谢

感谢下面的开源项目：

- [Zotero Plugin Template](https://github.com/zotero/zotero-plugin-template)
- [zotero-ainote](https://github.com/BlueBlueKitty/zotero-ainote)

尤其感谢 `zotero-ainote` 项目的作者 `BlueBlueKitty`，其项目为本插件提供了宝贵的代码参考。
由于本项目在实现上与 `zotero-ainote` 存在较大差异，因此未直接fork该项目，而是基于官方的 `Zotero Plugin Template` 重新开发。大家有兴趣可以给 `zotero-ainote` 点个star以示支持！
