# zotero-AI-Butler(Zotero插件)

<!-- Badges -->
<p>
    <a href="https://github.com/steven-jianhao-li/zotero-AI-Butler/releases/latest"><img src="https://img.shields.io/github/v/release/steven-jianhao-li/zotero-AI-Butler" alt="Latest Release"></a>
    <a href="https://github.com/steven-jianhao-li/zotero-AI-Butler/releases"><img src="https://img.shields.io/github/downloads/steven-jianhao-li/zotero-AI-Butler/total.svg" alt="Downloads"></a>
    <a href="https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github"><img src="https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github" alt="Using Zotero Plugin Template"></a>
    <a href="https://github.com/steven-jianhao-li/zotero-AI-Butler/stargazers"><img src="https://img.shields.io/github/stars/steven-jianhao-li/zotero-AI-Butler?style=social" alt="Stars"></a>
    <a href="https://github.com/steven-jianhao-li/zotero-AI-Butler/network/members"><img src="https://img.shields.io/github/forks/steven-jianhao-li/zotero-AI-Butler?style=social" alt="Forks"></a>
</p>
</div>

> **文献下载一时爽，打开阅读火葬场。**
> **天书难啃骨头硬，管家嚼碎再喂粮。**

想着稍后阅读的论文，最后却变成了永不阅读？
长篇大论的学术论文，有翻译却也抓不住重点？

别慌！您的专属AI管家 `Zotero-AI-Butler` 已闪亮登场！

TA 是您7x24小时待命、不知疲倦且绝对忠诚的私人管家。
您只管像往常一样把文献丢进 Zotero，剩下的体力活全交给TA！
管家会自动帮您精读论文，将文章揉碎了总结为笔记，让您“十分钟完全了解”这篇论文！

## 🎖️ 核心功能

1.  **自动巡视 (自动扫描)**：管家会在后台默默巡视您的文献库，一旦发现您“丢”进来了新论文（或是您想对积压已久的旧论文开刀），只要还没有笔记，TA 就会自动开工。
2.  **深度解析 (生成笔记)**：管家的核心任务——利用大模型将论文精读、揉碎、嚼烂后，整理成一份热腾腾、条理清晰的 Markdown 笔记塞进您的 Zotero 条目下。
3.  **随时待命 (右键菜单)**：除了“全自动”托管，您也可以随时右键点击任何一篇论文，让管家现在、立刻、最高优先级地分析这篇文章。
4.  **管家智能（无损阅读）**：管家会根据自己模型的多模态能力直接处理PDF文件，不经过本地OCR或文本提取，最大程度保留论文内容的完整性和准确性，图片、表格、公式等都不在话下！

推荐使用 Google Gemini 2.5 pro 模型，Gemini读论文讲的很到位。

> **您只负责思考，`Zotero-AI-Butler` 负责为您的阅读扫清障碍！**

## ✨ 功能介绍

### 1. 智能笔记生成与查阅

AI管家的核心使命是利用大模型（如 Gemini 或 OpenAI）深度阅读论文，并将总结内容自动整理为条理清晰的 Markdown 笔记，保存至 Zotero 条目下。

- 笔记自动保存： 生成的笔记会自动保存到 Zotero 对应的条目下，笔记交互逻辑与 Zotero 原生笔记一致。
  - 笔记查阅： 点击笔记条目进行查看。
    ![Zotero中由AI管家生成的笔记](./assets/images/Zotero中由AI管家生成的笔记.png)
  - 对照阅读： 在阅读论文原文时，可以同时打开笔记，与原文一同阅读。
    ![生成的笔记在阅读论文时可并排查看](./assets/images/生成的笔记在阅读论文时可并排查看.png)

### 2. 灵活的三种任务触发方式

AI管家提供三种方式来获取和分析您的论文。

- 方式一：右键唤醒 (即时处理)
  这是最直接的交互方式。当您需要立即分析某篇特定论文时：
  - 在论文条目上右键，选择 “召唤AI管家进行分析”。
  - 任务将立即进入队列。您可以点击**“详情”**，实时查看大模型的分析响应过程。

![右键菜单中唤醒AI管家进行分析](./assets/images/右键菜单中唤醒AI管家进行分析.gif)

- 方式二：自动巡航 (新文献自动处理)
  实现“一劳永逸”的自动化工作流。
  - 默认关闭： 为最小化对 Zotero 性能的影响，此功能默认关闭。
  - 一键开启： 您可以在 “仪表盘” -> “界面设置” 中开启 “自动扫描新文献” 功能。
  - 自动运行： 开启后，当您将新论文（如PDF）拖入 Zotero，管家会等待 Zotero 完成元数据检索，然后自动开始分析。
  - 持久化设置： 该设置会自动保存，Zotero 重启后依然生效。

![在仪表盘中开启自动扫描新文献功能后，AI管家会自动处理新添加的论文](./assets/images/在仪表盘中开启自动扫描新文献功能后，AI管家会自动处理新添加的论文.gif)

- 方式三：批量处理 (旧文献回溯补充)
  适用于补充总结您文献库中积压已久的旧论文。
  - 未总结论文扫描： 在 “仪表盘” 中，点击 “扫描未分析论文”。AI管家会自动找出所有没有AI管家笔记的论文，并按您的 Zotero 目录结构清晰排列。
  - 批量选择添加：您可以自由勾选需要补充笔记的论文（可按目录全选），点击 “添加到队列”。
  - 后台处理：AI管家会在后台按照您设置的速度，慢慢处理这些积压的论文。

![批量扫描未分析论文并添加到任务队列](./assets/images/批量扫描未分析论文并添加到任务队列.gif)

### 3. AI管家主界面

AI管家拥有主页面，是管理所有任务和配置的核心界面。可以通过以下两种方式打开：
a. Zotero 顶部菜单：“编辑” -> “设置” -> “AI管家” 选项卡。
b. 任意条目上右键 -> “AI管家仪表盘”。

仪表盘主要包含四大页面：- 仪表盘：提供统计信息和快捷操作。

- 仪表盘：提供统计信息和快捷操作。

![仪表盘页面](./assets/images/仪表盘页面.png)

- 任务队列：管理和监控所有论文分析任务。所有论文分析都基于“生产者-消费者”模式进行。可以在此页面查看所有待处理、进行中、已完成或失败的论文任务状态。

![任务队列页面](./assets/images/任务队列页面.png)

- 快捷设置：这是插件的配置中心，支持配置：
  - API配置： 目前支持 OpenAI 和 Gemini 两大平台。配置密钥后可点击 “测试连接” 验证可用性。
    ![API配置与连接测试](./assets/images/API配置与连接测试.png)
  - 任务处理速度： 控制每分钟处理论文的数量，避免API调用超限。
  - PDF处理方式： 可选择多模态处理（Base64编码）或文字提取模式。Base64编码适用于多模态大模型（如Gemini 2.5 Pro），此方式能让模型直接“看到”PDF原文，对图片、公式、表格的理解能力更强；文字提取模式适用于不支持多模态的模型。
    ![设置任务处理速度与PDF处理方式](./assets/images/设置任务处理速度与PDF处理方式.png)

  - 提示词模板： 内置多种提示词模板，并支持用户自定义。
    ![提示词模板设置](./assets/images/提示词模板设置.png)

## 🚀 安装与快速上手

### 安装插件

1. 访问本项目的 GitHub Releases 页面。
2. 下载最新的Release版本的 `.xpi` 文件。
3. 打开 Zotero 桌面端，点击顶部菜单的 “工具” -> “插件”。
4. 将下载好的 .xpi 文件拖拽到插件窗口中，完成安装。

### 快速配置与使用

1. 在任意论文上右键 -> “AI管家仪表盘” -> 打开 “设置” 选项卡。
2. 配置API： 填入您的 API 密钥（推荐Gemini），点击 “测试连接” 确保网络通畅。
3. 开启自动扫描： 转到 “界面设置” 选项卡，勾选 “自动扫描新文献”。

> 现在，当您拖入新的PDF论文时，AI管家将在1分钟左右（取决于模型速度）自动为您生成精读笔记。

### 贡献者

感谢以下贡献者对本项目的支持与帮助：

<a href="https://contrib.rocks/image?repo=steven-jianhao-li/zotero-AI-Butler">
  <img src="https://contrib.rocks/image?repo=steven-jianhao-li/zotero-AI-Butler" />
</a>

## 致谢

感谢下面的开源项目：

- [Zotero Plugin Template](https://github.com/zotero/zotero-plugin-template)
- [zotero-ainote](https://github.com/BlueBlueKitty/zotero-ainote)

尤其感谢 `zotero-ainote` 项目的作者 `BlueBlueKitty`，其项目为本插件提供了宝贵的代码参考。由于本项目在实现上与 `zotero-ainote` 存在较大差异，因此未直接fork该项目，而是基于 `Zotero Plugin Template` 重新开发。大家有兴趣可以给 `zotero-ainote` 点个star以示支持！

## ⭐ Star History

如果你觉得这个项目对你有帮助，请不要吝啬你的 ⭐️！

[![Star History Chart](https://api.star-history.com/svg?repos=steven-jianhao-li/zotero-AI-Butler&type=Date)](https://star-history.com/#steven-jianhao-li/zotero-AI-Butler&Date)
