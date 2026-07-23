/**
 * @file 插件的默认首选项
 * @description 此文件定义了插件首次启动或重置时的默认配置。
 * 注意：默认提示词主要在 src/utils/prompts.ts 中进行管理。
 * 此文件中的 summaryPrompt 仅作为备用值，在实际初始化时会被覆盖。
 */

// ==================== API 配置 ====================
pref("__prefsPrefix__.provider", "openai-compat");
pref("__prefsPrefix__.openaiApiKey", "");
pref("__prefsPrefix__.openaiApiUrl", "https://api.openai.com/v1/responses");
pref("__prefsPrefix__.openaiApiModel", "gpt-3.5-turbo");
pref("__prefsPrefix__.openaiCompatApiKey", "");
pref(
  "__prefsPrefix__.openaiCompatApiUrl",
  "https://api.openai.com/v1/chat/completions",
);
pref("__prefsPrefix__.openaiCompatModel", "gpt-3.5-turbo");
pref(
  "__prefsPrefix__.geminiApiUrl",
  "https://generativelanguage.googleapis.com",
);
pref("__prefsPrefix__.geminiApiKey", "");
pref("__prefsPrefix__.geminiModel", "gemini-2.5-pro");
pref("__prefsPrefix__.anthropicApiUrl", "https://api.anthropic.com");
pref("__prefsPrefix__.anthropicApiKey", "");
pref("__prefsPrefix__.anthropicModel", "claude-3-5-sonnet-20241022");
pref(
  "__prefsPrefix__.openRouterApiUrl",
  "https://openrouter.ai/api/v1/chat/completions",
);
pref("__prefsPrefix__.openRouterApiKey", "");
pref("__prefsPrefix__.openRouterModel", "google/gemma-3-27b-it");
pref(
  "__prefsPrefix__.volcanoArkApiUrl",
  "https://ark.cn-beijing.volces.com/api/v3/responses",
);
pref("__prefsPrefix__.volcanoArkApiKey", "");
pref("__prefsPrefix__.volcanoArkModel", "doubao-seed-1-8-251228");
pref("__prefsPrefix__.ollamaApiUrl", "http://localhost:11434");
pref("__prefsPrefix__.ollamaApiKey", "");
pref("__prefsPrefix__.ollamaModel", "llama3.2");
pref("__prefsPrefix__.llmEndpoints", "[]");
pref("__prefsPrefix__.llmRoutingStrategy", "priority");
pref("__prefsPrefix__.llmRoundRobinCursor", "");
pref("__prefsPrefix__.multiModelSummaryEnabled", false);
pref("__prefsPrefix__.multiModelSummaryEndpointIds", "[]");
pref("__prefsPrefix__.temperature", "0.7");
pref("__prefsPrefix__.enableTemperature", false);
pref("__prefsPrefix__.maxTokens", "81920");
pref("__prefsPrefix__.enableMaxTokens", false);
pref("__prefsPrefix__.topP", "1.0");
pref("__prefsPrefix__.enableTopP", false);
pref("__prefsPrefix__.reasoningEffort", "default");
pref("__prefsPrefix__.stream", true);
pref("__prefsPrefix__.enablePromptCacheOptimization", true);
pref("__prefsPrefix__.requestTimeout", "300000"); // 5分钟超时
// MINERU API KEY
pref("__prefsPrefix__.mineruApiKey", "");
pref("__prefsPrefix__.mineruModelVersion", "vlm");
pref("__prefsPrefix__.mineruSaveMarkdown", false);
pref("__prefsPrefix__.mineruSaveAsAttachment", true);
pref("__prefsPrefix__.mineruSyncExternal", false);
pref("__prefsPrefix__.mineruExternalPath", "");
pref("__prefsPrefix__.mineruFileNameMode", "citationKey-title");

// ==================== 提示词配置 ====================
pref(
  "__prefsPrefix__.summaryPrompt",
  "# 角色\n您好，我是您的AI管家。我将为您 meticulously 地阅读这篇论文，并为您整理一份详尽的笔记。\n\n# 任务\n请为我分析下方提供的学术论文，并生成一份包含以下三个部分的综合性总结：\n\n### 第一部分：核心摘要\n请用一个段落高度概括论文的核心内容，包括研究问题、方法、关键发现和主要结论，让我能迅速掌握论文的精髓。\n\n### 第二部分：章节详解\n请识别并划分论文的主要章节（如引言、方法、结果、讨论等），并为每个章节提供一个清晰的标题和详细的内容总结。\n\n### 第三部分：创新与局限\n请根据论文内容，分析并总结其主要创新点和存在的局限性，并指出未来可能的研究方向。\n\n# 输出要求\n- 结构清晰，逻辑严谨。\n- 语言精炼，准确传达。\n- 请使用中文进行回答。",
);
pref("__prefsPrefix__.customPrompts", "[]");
// Summary mode: "single" for AI summary; "deepRead" for AI deep read v2
pref("__prefsPrefix__.summaryMode", "single");
// AI deep read prompt template library
pref("__prefsPrefix__.multiRoundPromptTemplates", "[]");
pref("__prefsPrefix__.multiRoundPromptTemplateId", "");
// AI deep read settings
pref("__prefsPrefix__.multiRoundContextStrategy", "last_round");
pref("__prefsPrefix__.multiRoundIndependentParallelEnabled", false);
pref("__prefsPrefix__.multiRoundIndependentMaxConcurrency", 1);
pref("__prefsPrefix__.legacyAiNoteRenamePromptState", "");

// ==================== 任务队列配置 ====================
pref("__prefsPrefix__.maxRetries", "3");
pref("__prefsPrefix__.batchSize", "1");
pref("__prefsPrefix__.batchInterval", "60");
pref("__prefsPrefix__.autoScan", false);
pref("__prefsPrefix__.autoScanSummaryEnabled", true);
pref("__prefsPrefix__.autoScanDeepReadEnabled", false);
pref("__prefsPrefix__.scanInterval", "300");
pref("__prefsPrefix__.pdfProcessMode", "base64"); // "text"、"base64" 或 "mineru"
pref("__prefsPrefix__.pdfAttachmentMode", "default"); // "default" 或 "all"

// ==================== 一图总结配置 ====================
pref("__prefsPrefix__.imageSummaryCustomHeaders", ""); // 额外请求 Headers，JSON/Python dict 对象字符串
pref("__prefsPrefix__.imageSummaryRequestTimeoutSeconds", "600"); // 生图请求超时，默认10分钟
pref("__prefsPrefix__.imageSummaryAspectRatioEnabled", false); // 是否发送宽高比/size 参数
pref("__prefsPrefix__.imageSummaryAspectRatio", "16:9"); // 图片宽高比，如 "1:1", "16:9", "9:16"
pref("__prefsPrefix__.imageSummaryResolutionEnabled", false); // 是否发送分辨率/size 参数
pref("__prefsPrefix__.imageSummaryResolution", "1K"); // 图片分辨率: "1K", "2K", "4K"

// ==================== UI 配置 ====================
pref("__prefsPrefix__.theme", "auto");
pref("__prefsPrefix__.fontSize", "14");
pref("__prefsPrefix__.autoScroll", true);
pref("__prefsPrefix__.windowWidth", "900");
pref("__prefsPrefix__.windowHeight", "700");
pref("__prefsPrefix__.saveChatHistory", true);
pref("__prefsPrefix__.openTaskPanelOnSummon", false);
pref("__prefsPrefix__.enableTableFeature", true);
pref("__prefsPrefix__.contextMenuCollapsed", false);
pref(
  "__prefsPrefix__.contextMenuItemVisibility",
  '{"generateSummary":true,"multiRoundReanalyze":true,"dashboard":true,"imageSummary":true,"mindmap":true,"chatWithAI":true,"literatureReview":true,"clearCollectionAiNotes":true,"exportCollectionNotes":true}',
);
pref(
  "__prefsPrefix__.contextMenuItemOrder",
  '["generateSummary","multiRoundReanalyze","dashboard","imageSummary","mindmap","chatWithAI","literatureReview","clearCollectionAiNotes","exportCollectionNotes"]',
);
pref(
  "__prefsPrefix__.sidebarModuleVisibility",
  '{"actionButtons":true,"note":true,"table":true,"imageSummary":true,"mindmap":true,"quickChat":true}',
);
pref(
  "__prefsPrefix__.sidebarModuleOrder",
  '["actionButtons","note","table","imageSummary","mindmap","quickChat"]',
);
pref("__prefsPrefix__.sidebarNoteCollapsed", false);
pref("__prefsPrefix__.sidebarImageCollapsed", false);
pref("__prefsPrefix__.quickChatSuppressNewConversationWarning", false);

// ==================== 数据管理 ====================
pref("__prefsPrefix__.notePrefix", "[AI-Butler]");
pref("__prefsPrefix__.noteStrategy", "skip");

// ==================== AI 笔记导出配置 ====================
pref("__prefsPrefix__.noteExportEnabled", false);
pref("__prefsPrefix__.noteExportRootPath", "");
pref("__prefsPrefix__.noteExportWatchedCollections", "[]");
pref("__prefsPrefix__.noteExportIncludeSubcollections", true);
pref(
  "__prefsPrefix__.noteExportFormats",
  '{"summaryDocx":true,"deepReadDocx":true,"summaryMd":true,"deepReadMd":true}',
);
pref("__prefsPrefix__.noteExportConflictStrategy", "skip");
pref("__prefsPrefix__.noteExportSuppressDirectoryPrompt", false);

// ==================== 思维导图配置 ====================
pref("__prefsPrefix__.mindmapPrompt", ""); // 空表示使用默认提示词
pref("__prefsPrefix__.mindmapExportPath", ""); // 空表示使用桌面目录

// ==================== 新手教程配置 ====================
pref("__prefsPrefix__.onboardingTutorialSeenVersion", "");
