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
export const DEFAULT_SUMMARY_PROMPT = 
`帮我用中文讲一下这篇论文，讲的越详细越好，我有通用计算机专业基础，但是没有这个小方向的基础。`;

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
export function shouldUpdatePrompt(currentPromptVersion?: number, currentPrompt?: string): boolean {
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
