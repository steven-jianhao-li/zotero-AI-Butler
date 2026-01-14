/**
 * ================================================================
 * AI 提示词配置管理模块
 * ================================================================
 *
 * 本模块集中管理所有与 AI 提示词相关的配置和逻辑
 *
 * 主要职责:
 * 1. 定义和维护默认的论文总结提示词模板
 * 2. 管理提示词版本,支持自动升级机制
 * 3. 提供提示词构建和格式化工具函数
 * 4. 确保提示词的一致性和可维护性
 *
 * 设计理念:
 * - 集中管理:所有提示词相关代码集中在此模块,便于修改和维护
 * - 版本控制:通过版本号机制,支持提示词的平滑升级
 * - 灵活扩展:提供工具函数,支持动态构建提示词
 * - 国际化友好:提示词结构清晰,易于翻译和本地化
 *
 * @module prompts
 * @author AI-Butler Team
 */

/**
 * 提示词版本号
 *
 * 版本管理策略:
 * - 每次修改默认提示词时,必须递增此版本号
 * - 插件启动时会检查用户的提示词版本
 * - 如果用户使用旧版本且未自定义,会自动升级到新版本
 *
 * 升级触发条件:
 * 1. 用户的提示词版本号小于当前版本号
 * 2. 用户未进行过自定义修改(或修改内容与旧版本默认值一致)
 *
 * 版本变更记录:
 * - v1: 初始版本,包含角色定义、任务说明、输出要求
 *
 * @const {number} PROMPT_VERSION 当前提示词版本号
 */
export const PROMPT_VERSION = 1;

/**
 * 默认的论文总结提示词模板
 *
 * 此模板定义了 AI 生成论文总结的详细指令
 *
 * 模板结构:
 * 1. 角色定义:明确 AI 的身份和专业能力
 * 2. 任务说明:详细描述需要 AI 完成的工作
 *    - 全文核心摘要:一段式高度概括
 *    - 分章节详细解析:结构化的深入分析
 *    - 创新性与局限性评估:批判性思维评价
 * 3. 输出要求:规范输出格式和语言风格
 *
 * 设计原则:
 * - 指令明确:避免歧义,确保 AI 理解任务
 * - 结构化输出:便于用户快速理解论文内容
 * - 深度与广度兼顾:既有宏观概括,又有细节分析
 * - 批判性思维:不仅总结,还要评价创新点和局限性
 *
 * 使用场景:
 * - 用户首次安装插件时的默认提示词
 * - 用户重置提示词设置时的参考模板
 * - 提示词版本升级时的新版本内容
 *
 * @const {string} DEFAULT_SUMMARY_PROMPT 默认提示词文本
 */
export const DEFAULT_SUMMARY_PROMPT = `帮我用中文讲一下这篇论文，讲的越详细越好，我有这个领域的通用基础，但是没有这个小方向的基础。输出的时候只包含关于论文的讲解，不要包含寒暄的内容。开始时先用一段话总结这篇论文的核心内容。如果有公式，应该用$内联公式$和$$行间公式$$格式。`;

/**
 * 系统角色提示词
 *
 * 在与大模型的对话中,系统角色定义了 AI 助手的基本身份和行为准则
 *
 * 作用:
 * - 设定 AI 的总体定位和态度
 * - 影响 AI 的回复风格和专业度
 * - 提供稳定的行为基线
 *
 * 当前设定:
 * - 定位为学术助理,强调专业性和辅助性
 * - 保持简洁,避免过度约束 AI 的创造力
 *
 * @const {string} SYSTEM_ROLE_PROMPT 系统角色定义
 */
export const SYSTEM_ROLE_PROMPT = "You are a helpful academic assistant.";

/**
 * 构建完整的用户消息
 *
 * 将用户自定义的提示词和论文全文组合成完整的 API 请求消息
 *
 * 消息结构:
 * 1. 用户提示词:定义任务和输出要求
 * 2. 语言要求:明确使用中文回答(可配置)
 * 3. 论文全文:包裹在 XML 标签中,清晰标识内容边界
 *
 * 技术细节:
 * - 使用 <Paper> XML 标签包裹论文内容
 * - XML 标签帮助 AI 识别论文正文的起止位置
 * - 避免论文内容干扰提示词指令的解析
 *
 * @param prompt 用户自定义的提示词模板
 * @param text 论文全文内容
 * @returns 格式化后的完整消息文本
 *
 * @example
 * ```typescript
 * const message = buildUserMessage(
 *   getDefaultSummaryPrompt(),
 *   paperFullText
 * );
 * // 输出:
 * // "帮我用中文讲一下这篇论文...\n\n<Paper>\n论文内容...\n</Paper>"
 * ```
 */
export function buildUserMessage(prompt: string, text: string): string {
  return `${prompt}\n\n请用中文回答。\n\n<Paper>\n${text}\n</Paper>`;
}

/**
 * 获取默认的总结提示词
 *
 * 简单的封装函数,返回默认提示词常量
 *
 * 设计目的:
 * - 提供统一的访问接口
 * - 便于未来扩展(如动态提示词选择)
 * - 提高代码可读性
 *
 * @returns 默认提示词文本
 *
 * @example
 * ```typescript
 * const prompt = getDefaultSummaryPrompt();
 * setPref("summaryPrompt", prompt);
 * ```
 */
export function getDefaultSummaryPrompt(): string {
  return DEFAULT_SUMMARY_PROMPT;
}

/**
 * 检查是否需要更新用户的提示词
 *
 * 判断逻辑:
 * 1. 如果用户没有提示词版本号记录,需要更新(首次使用或旧版本插件)
 * 2. 如果用户的版本号低于当前版本,需要更新(版本过时)
 *
 * 更新策略:
 * - 自动更新:仅当用户使用默认提示词且未自定义时
 * - 保留自定义:如果用户修改过提示词,不会被自动覆盖
 *
 * 使用场景:
 * - 插件启动时的配置初始化
 * - 检测并执行提示词版本升级
 *
 * @param currentPromptVersion 用户当前的提示词版本号
 * @param currentPrompt 用户当前的提示词内容(可选,用于高级判断)
 * @returns 如果需要更新返回 true,否则返回 false
 *
 * @example
 * ```typescript
 * const version = getPref("promptVersion");
 * const prompt = getPref("summaryPrompt");
 *
 * if (shouldUpdatePrompt(version, prompt)) {
 *   setPref("summaryPrompt", getDefaultSummaryPrompt());
 *   setPref("promptVersion", PROMPT_VERSION);
 * }
 * ```
 */
export function shouldUpdatePrompt(
  currentPromptVersion?: number,
  currentPrompt?: string,
): boolean {
  // 情况1:没有版本号记录,强制更新为默认提示词
  // 这通常发生在首次安装或从旧版本升级时
  if (currentPromptVersion === undefined) {
    return true;
  }

  // 情况2:版本号低于当前版本,需要升级
  // 注意:仅在用户未自定义提示词时才会执行更新
  // 自定义判断由调用方负责(通过比较 currentPrompt 与旧版本默认值)
  return currentPromptVersion < PROMPT_VERSION;
}

// ================================================================
// 多轮对话提示词相关功能
// ================================================================

/**
 * 多轮提示词条目类型
 */
export interface MultiRoundPromptItem {
  id: string;
  title: string;
  prompt: string;
  order: number;
}

/**
 * 总结模式类型
 * - single: 单次对话总结（默认，Token消耗最少）
 * - multi_concat: 多轮拼接模式（将所有对话内容拼接作为笔记）
 * - multi_summarize: 多轮总结模式（多轮对话后再进行汇总）
 */
export type SummaryMode = "single" | "multi_concat" | "multi_summarize";

/**
 * 默认的多轮提示词数组
 *
 * 包含四轮提示词，分别针对：
 * 1. 研究背景与问题
 * 2. 研究方法与技术
 * 3. 实验设计与结果
 * 4. 结论与展望
 */
export const DEFAULT_MULTI_ROUND_PROMPTS: MultiRoundPromptItem[] = [
  {
    id: "round1",
    title: "研究背景与问题",
    prompt:
      "请详细介绍这篇论文的研究背景和动机。具体包括：1) 这个研究领域目前面临哪些主要挑战？2) 现有方法存在什么不足？3) 本文要解决的核心问题是什么？请用中文回答。",
    order: 1,
  },
  {
    id: "round2",
    title: "研究方法与技术",
    prompt:
      "请详细解释这篇论文提出的方法和技术。具体包括：1) 核心方法/算法/框架是什么？2) 关键技术细节和创新点有哪些？3) 与现有方法相比有什么改进？请用中文回答。",
    order: 2,
  },
  {
    id: "round3",
    title: "实验设计与结果",
    prompt:
      "请详细分析这篇论文的实验部分。具体包括：1) 使用了哪些数据集和评价指标？2) 主要的实验结果是什么？3) 与基线方法相比表现如何？4) 有哪些消融实验和分析？请用中文回答。",
    order: 3,
  },
  {
    id: "round4",
    title: "结论与展望",
    prompt:
      "请总结这篇论文的结论和贡献。具体包括：1) 论文的主要贡献和创新点是什么？2) 存在哪些局限性？3) 未来可能的研究方向有哪些？请用中文回答。",
    order: 4,
  },
];

/**
 * 默认的多轮对话最终总结提示词
 */
export const DEFAULT_MULTI_ROUND_FINAL_PROMPT = `基于以上多轮对话的内容，请为我生成一份完整、结构化的论文总结笔记。要求：
1. 开头用一段话概括论文的核心内容
2. 分章节整理各部分的关键信息
3. 突出论文的创新点和贡献
4. 指出论文的局限性和未来方向
5. 语言简洁清晰，使用中文`;

/**
 * 获取默认的多轮提示词数组
 *
 * @returns 默认多轮提示词数组
 */
export function getDefaultMultiRoundPrompts(): MultiRoundPromptItem[] {
  return DEFAULT_MULTI_ROUND_PROMPTS;
}

/**
 * 获取默认的多轮对话最终总结提示词
 *
 * @returns 默认最终总结提示词
 */
export function getDefaultMultiRoundFinalPrompt(): string {
  return DEFAULT_MULTI_ROUND_FINAL_PROMPT;
}

/**
 * 解析存储的多轮提示词 JSON 字符串
 *
 * @param jsonStr 存储的 JSON 字符串
 * @returns 解析后的多轮提示词数组，解析失败则返回默认值
 */
export function parseMultiRoundPrompts(
  jsonStr: string | undefined,
): MultiRoundPromptItem[] {
  if (!jsonStr || !jsonStr.trim()) {
    return getDefaultMultiRoundPrompts();
  }
  try {
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed) && parsed.length > 0) {
      // 按 order 排序
      return parsed.sort(
        (a: MultiRoundPromptItem, b: MultiRoundPromptItem) => a.order - b.order,
      );
    }
    return getDefaultMultiRoundPrompts();
  } catch (e) {
    return getDefaultMultiRoundPrompts();
  }
}

// ================================================================
// 一图总结提示词相关功能
// ================================================================

/**
 * 默认的视觉信息提取提示词
 *
 * 用于从论文中提取适合生成学术概念海报的关键视觉信息
 */
export const DEFAULT_IMAGE_SUMMARY_PROMPT = `请阅读我提供的论文内容，提取用于生成"学术概念海报"的关键视觉信息。

请确保描述具体、形象，适合画面呈现。
请输出如下内容（只输出内容，不要废话），使用\${language}：
1. 研究问题：提到的核心问题
2. 创新方法：论文提出的主要方法或技术，要找到Aha！的那个点。
3. 工作流程：从输入到输出的处理流程
4. 关键结果：主要实验发现或性能提升
5. 应用价值：该研究的实际意义
---
论文内容如下：
\${context}`;

/**
 * 默认的生图提示词
 *
 * 用于根据视觉摘要生成学术概念海报图片
 */
export const DEFAULT_IMAGE_GENERATION_PROMPT = `根据"\${summaryForImage}"，生成一张学术论文概念图，清晰展示以下内容：

研究问题：提到的核心问题
创新方法：论文提出的主要方法或技术
工作流程：从输入到输出的处理流程
关键结果：主要实验发现或性能提升
应用价值：该研究的实际意义
论文标题：\${title}
要求：
**设计要求 (Design Guidelines - STRICTLY FOLLOW):**
1.  **艺术风格 (Style):**
    *   Modern Minimalist Tech Infographic (现代极简科技信息图).
    *   Flat vector illustration with subtle isometric elements (带有微妙等距元素的扁平矢量插画).
    *   High-quality corporate Memphis design style (高质量企业级孟菲斯设计风格).
    *   Clean lines, geometric shapes (线条干净，几何形状).
2.  **构图 (Composition):**
    *   **Layout:** Central composition or Left-to-Right Process Flow (居中构图或从左到右的流程).
    *   **Background:** Clean, solid off-white or very light grey background (#F5F5F7). No clutter. (干净的米白或浅灰背景，无杂乱).
    *   **Structure:** Organize elements logically like a presentation slide or a academic poster.
3.  **配色方案 (Color Palette):**
    *   Primary: Deep Academic Blue (深学术蓝) & Slate Grey (板岩灰).
    *   Accent: Vibrant Orange or Teal for highlights (活力橙或青色用于高亮).
    *   High contrast, professional color grading (高对比度，专业调色).
4.  **文字渲染 (Text Rendering):**
    *   Use Times New Roman font for English.
    *   Use SimSun font for Chinese.
    *   Main text language: \${language} (User defined language).
    *   The title does not need to be reflected in the figure.
    *   The text, especially Chinese, needs to be clear and free of garbled characters.
5.  **负面提示 (Negative Prompt - Avoid these):**
    *   No photorealism (不要照片写实风格).
    *   No messy sketches (不要草图).
    *   No blurry text (不要模糊文字).
    *   No chaotic background (不要混乱背景).
**Generation Instructions:**
Generate an academic infographic poster.`;

/**
 * 获取默认的视觉信息提取提示词
 *
 * @returns 默认视觉提取提示词
 */
export function getDefaultImageSummaryPrompt(): string {
  return DEFAULT_IMAGE_SUMMARY_PROMPT;
}

/**
 * 获取默认的生图提示词
 *
 * @returns 默认生图提示词
 */
export function getDefaultImageGenerationPrompt(): string {
  return DEFAULT_IMAGE_GENERATION_PROMPT;
}

// ================================================================
// 文献综述提示词相关功能
// ================================================================

/**
 * 默认的文献综述提示词
 *
 * 用于综合多篇论文生成文献综述报告
 */
export const DEFAULT_LITERATURE_REVIEW_PROMPT = `请阅读以下多篇学术论文，生成一份综合性文献综述报告，包括：

1. **研究主题概述**: 简述这些论文共同关注的研究领域和核心问题
2. **各论文主要贡献**: 逐一总结每篇论文的核心观点、方法和发现
3. **研究方法对比**: 分析各论文采用的研究方法的异同
4. **主要发现汇总**: 综合各论文的主要结论和发现
5. **研究趋势与展望**: 基于这些论文，分析该领域的发展趋势和未来研究方向

请使用清晰的结构和学术性语言，确保综述内容准确、逻辑连贯。使用中文输出。`;

/**
 * 获取默认的文献综述提示词
 *
 * @returns 默认文献综述提示词
 */
export function getDefaultLiteratureReviewPrompt(): string {
  return DEFAULT_LITERATURE_REVIEW_PROMPT;
}
