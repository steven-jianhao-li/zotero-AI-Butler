/**
 * @file 插件的默认首选项
 * @description 此文件定义了插件首次启动或重置时的默认配置。
 * 注意：默认提示词主要在 src/utils/prompts.ts 中进行管理。
 * 此文件中的 summaryPrompt 仅作为备用值，在实际初始化时会被覆盖。
 */

// ==================== API 配置 ====================
pref("__prefsPrefix__.provider", "openai");
pref("__prefsPrefix__.openaiApiKey", "");
pref("__prefsPrefix__.openaiApiUrl", "https://api.openai.com/v1/responses");
pref("__prefsPrefix__.openaiApiModel", "gpt-3.5-turbo");
pref(
  "__prefsPrefix__.geminiApiUrl",
  "https://generativelanguage.googleapis.com",
);
pref("__prefsPrefix__.geminiApiKey", "");
pref("__prefsPrefix__.geminiModel", "gemini-2.5-pro");
pref("__prefsPrefix__.anthropicApiUrl", "https://api.anthropic.com");
pref("__prefsPrefix__.anthropicApiKey", "");
pref("__prefsPrefix__.anthropicModel", "claude-3-5-sonnet-20241022");
pref("__prefsPrefix__.temperature", "0.7");
pref("__prefsPrefix__.enableTemperature", true);
pref("__prefsPrefix__.maxTokens", "8192");
pref("__prefsPrefix__.enableMaxTokens", true);
pref("__prefsPrefix__.topP", "1.0");
pref("__prefsPrefix__.enableTopP", true);
pref("__prefsPrefix__.stream", true);
pref("__prefsPrefix__.requestTimeout", "300000"); // 5分钟超时

// ==================== 提示词配置 ====================
pref(
  "__prefsPrefix__.summaryPrompt",
  "# 角色\n您好，我是您的AI管家。我将为您 meticulously 地阅读这篇论文，并为您整理一份详尽的笔记。\n\n# 任务\n请为我分析下方提供的学术论文，并生成一份包含以下三个部分的综合性总结：\n\n### 第一部分：核心摘要\n请用一个段落高度概括论文的核心内容，包括研究问题、方法、关键发现和主要结论，让我能迅速掌握论文的精髓。\n\n### 第二部分：章节详解\n请识别并划分论文的主要章节（如引言、方法、结果、讨论等），并为每个章节提供一个清晰的标题和详细的内容总结。\n\n### 第三部分：创新与局限\n请根据论文内容，分析并总结其主要创新点和存在的局限性，并指出未来可能的研究方向。\n\n# 输出要求\n- 结构清晰，逻辑严谨。\n- 语言精炼，准确传达。\n- 请使用中文进行回答。",
);
pref("__prefsPrefix__.customPrompts", "[]");

// ==================== 任务队列配置 ====================
pref("__prefsPrefix__.maxRetries", "3");
pref("__prefsPrefix__.batchSize", "1");
pref("__prefsPrefix__.batchInterval", "60");
pref("__prefsPrefix__.autoScan", false);
pref("__prefsPrefix__.scanInterval", "300");
pref("__prefsPrefix__.pdfProcessMode", "base64"); // "text" 或 "base64"

// ==================== UI 配置 ====================
pref("__prefsPrefix__.theme", "auto");
pref("__prefsPrefix__.fontSize", "14");
pref("__prefsPrefix__.autoScroll", true);
pref("__prefsPrefix__.windowWidth", "900");
pref("__prefsPrefix__.windowHeight", "700");
pref("__prefsPrefix__.saveChatHistory", false);

// ==================== 数据管理 ====================
pref("__prefsPrefix__.notePrefix", "[AI-Butler]");
pref("__prefsPrefix__.noteStrategy", "skip");
