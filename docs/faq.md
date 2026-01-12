# 常见问题 FAQ

本页面整理了用户最常遇到的问题及解决方案。

---

## 🔴 Gemini 429 报错 / 速率限制

### 问题描述

使用 Google Gemini API 时报错 `429`，提示超出速率限制或配额用尽。

### 原因分析

Google AI Studio 免费层级对 API 调用有配额限制，不同模型的限制不同。例如：

- 某些模型在免费层级下不可用（如曾经的 `gemini-2.5-pro`）
- 批量处理论文时容易超出每分钟请求限制

### 解决方案

**方案一：更换为免费层级支持的模型**

1. 访问 [AI Studio 用量页面](https://aistudio.google.com/usage)
2. 点击 **"速率限制"** → **"所有模型"**
3. 查看当前免费层级支持的模型（如 `gemini-2.0-flash`）
4. 在插件中修改模型名称为支持的模型

![AI Studio 免费层级模型](images/faq-gemini-free-tier.png)

<!-- 占位图：展示 AI Studio 速率限制页面，显示免费层级支持的模型 -->
<!-- 截图时间：2025年12月22日 -->

> ⚠️ **注意**：上图截取于 2025 年 12 月 22 日，Google 可能随时调整政策，请以实际页面为准。

**方案二：使用 gcli2api 获取免费额度**

参考 [Discussion #54](https://github.com/steven-jianhao-li/zotero-AI-Butler/discussions/54#discussioncomment-15199692) 部署 [gcli2api](https://github.com/su-kaka/gcli2api)。

---

## 🔴 错误 20015: The parameter is invalid

### 问题描述

使用第三方平台（如硅基流动 SiliconFlow）时报错：

```
错误: 20015: The parameter is invalid. Please check again.
```

### 原因分析

部分第三方模型不支持多模态（Base64 编码的 PDF）输入。

### 解决方案

1. 打开 **AI 管家仪表盘** → **快捷设置**
2. 将 **PDF 处理模式** 切换为 **"文本提取 (仅文字内容)"**
3. 重新尝试分析论文

![切换 PDF 处理模式](images/faq-switch-pdf-mode.png)

<!-- 占位图：展示 PDF 处理模式切换界面 -->

---

## 🔴 错误 20041: The model is not a VLM

### 问题描述

分析论文时报错：

```
错误: 20041: The model is not a VLM (Vision Language Model). Please use text-only prompts.
```

### 原因分析

您使用的模型不支持多模态输入（不能直接处理 PDF/图片），但插件当前配置为多模态模式。

### 解决方案

1. 打开 **AI 管家仪表盘** → **快捷设置**
2. 将 **PDF 处理模式** 切换为 **"文本提取 (仅文字内容)"**
3. 重新尝试分析论文

---

## 🟡 AI 总结只有一句话 / 反应时间为 0

### 问题描述

分析完成后，笔记内容极少（只有一句话），且显示反应时间为 0。

### 原因分析

这通常是 API 调用失败的表现，可能原因包括：

- API 密钥配置错误
- 遇到了 429 速率限制
- 网络连接问题

### 解决方案

1. **检查 API 配置**：确认密钥正确，点击 **"测试连接"** 验证
2. **检查是否触发速率限制**：参考上方 "429 报错" 解决方案
3. **查看任务详情**：在任务队列中点击失败任务的 **"详情"**，查看具体错误信息

---

## 🟡 论文无法再次被 AI 自动总结

### 问题描述

之前尝试分析某篇论文时失败（例如 API 密钥未配置或返回为空），之后该论文无法再次被自动分析。

### 原因分析

早期版本中，即使 API 调用失败或返回空内容，也可能会创建一个只有标题的"空笔记"。由于系统检测到已存在 AI 笔记，因此跳过了该论文的自动分析。

### 解决方案

**新版本已修复此问题：** 现在如果 AI 返回内容为空，系统不会创建空笔记。

**对于已存在的空笔记，可使用「清空空笔记」功能批量清理：**

1. 打开 **AI 管家仪表盘** → **快捷设置** → **数据管理**
2. 点击 **"🧹 清空空笔记"** 按钮
3. 确认后，系统将扫描库中所有论文，删除只有标题没有实际内容的 AI 笔记
4. 之后这些论文可以重新被 AI 分析

> 💡 **提示**：清理完成后会显示扫描论文数量和删除空笔记数量。

## 更多问题？

如果您的问题未在此列出，欢迎：

- 查看 [故障排除指南](troubleshooting.md) 进行自查
- 在 [GitHub Discussions](https://github.com/steven-jianhao-li/zotero-AI-Butler/discussions) 中提问
- 提交 [Issue](https://github.com/steven-jianhao-li/zotero-AI-Butler/issues) 反馈 Bug
