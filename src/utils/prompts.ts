import deepReadPromptDefaults from "../defaults/prompts/deep-read.json";

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
 * - v2: 将公式格式要求移动到系统提示词,默认总结模板不再重复声明
 *
 * @const {number} PROMPT_VERSION 当前提示词版本号
 */
export const PROMPT_VERSION = 2;

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
export const DEFAULT_SUMMARY_PROMPT = `帮我用中文讲一下这篇论文，讲的越详细越好，我有这个领域的通用基础，但是没有这个小方向的基础。输出的时候只包含关于论文的讲解，不要包含寒暄的内容。开始时先用一段话总结这篇论文的核心内容。`;

const LEGACY_DEFAULT_SUMMARY_PROMPTS = [
  `帮我用中文讲一下这篇论文，讲的越详细越好，我有这个领域的通用基础，但是没有这个小方向的基础。输出的时候只包含关于论文的讲解，不要包含寒暄的内容。开始时先用一段话总结这篇论文的核心内容。如果有公式，应该用$内联公式$和$$行间公式$$格式。`,
];

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
export const SYSTEM_ROLE_PROMPT =
  "You are a helpful academic assistant. 如果有公式，应该用$内联公式$和$$行间公式$$格式。";

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

  // 情况2:版本号低于当前版本,且仍在使用内置默认提示词,需要升级
  if (
    currentPrompt !== undefined &&
    currentPrompt !== DEFAULT_SUMMARY_PROMPT &&
    !LEGACY_DEFAULT_SUMMARY_PROMPTS.includes(currentPrompt)
  ) {
    return false;
  }

  return currentPromptVersion < PROMPT_VERSION;
}

// ================================================================
// AI \u7cbe\u8bfb v2 \u63d0\u793a\u8bcd\u76f8\u5173\u529f\u80fd
// ================================================================

export interface MultiRoundPromptItem {
  id: string;
  title: string;
  prompt: string;
  order: number;
}

export interface ChapterInfo {
  id: string;
  title_zh: string;
  title_en: string;
}

export type ChapterParseSource = "json" | "regex" | "manual" | "fallback";

export interface ChapterParseResult {
  chapters: ChapterInfo[];
  source: ChapterParseSource;
}

export type DeepReadSlotStatus = "pending" | "running" | "done" | "error";
export type MultiRoundPhaseType = "sequential_dynamic" | "independent";
export type MultiRoundContextStrategy = "full_history" | "last_round";

export interface MultiRoundSequentialDynamicPhase {
  id: string;
  title: string;
  type: "sequential_dynamic";
  description: string;
  contextStrategy: MultiRoundContextStrategy;
  planningPrompt: string;
  fixedPrompts: MultiRoundPromptItem[];
  chapterTemplate: string;
  maxChapters?: number;
}

export interface MultiRoundIndependentPhase {
  id: string;
  title: string;
  type: "independent";
  description: string;
  parallelizable: boolean;
  maxConcurrency: number;
  prompts: MultiRoundPromptItem[];
}

export type MultiRoundPromptPhase =
  | MultiRoundSequentialDynamicPhase
  | MultiRoundIndependentPhase;

export const MULTI_ROUND_PROMPT_TEMPLATE_SCHEMA =
  "zotero-ai-butler.multi-round-prompt-template";
export const MULTI_ROUND_PROMPT_TEMPLATE_EXPORT_VERSION = 2;
export const DEFAULT_DEEP_READ_CHAPTER_LIMIT = 12;
export const MAX_DEEP_READ_CHAPTER_LIMIT = 12;

export interface MultiRoundPromptTemplate {
  id: string;
  name: string;
  description: string;
  version: number;
  phases: MultiRoundPromptPhase[];
  prompts: MultiRoundPromptItem[];
}

export interface MultiRoundPromptTemplateExport {
  schema: typeof MULTI_ROUND_PROMPT_TEMPLATE_SCHEMA;
  version: typeof MULTI_ROUND_PROMPT_TEMPLATE_EXPORT_VERSION;
  exportedAt: string;
  template: MultiRoundPromptTemplate;
}

export type SummaryMode = "single" | "deepRead";

type DeepReadPromptText = string | string[];

interface DeepReadSequentialDynamicPhaseDefaults extends Omit<
  MultiRoundSequentialDynamicPhase,
  "planningPrompt" | "chapterTemplate"
> {
  planningPrompt?: string;
  planningPromptLines?: string[];
  chapterTemplate?: string;
  chapterTemplateLines?: string[];
}

type DeepReadPromptPhaseDefaults =
  | DeepReadSequentialDynamicPhaseDefaults
  | MultiRoundIndependentPhase;

interface DeepReadPromptTemplateDefaults extends Omit<
  MultiRoundPromptTemplate,
  "phases"
> {
  phases: DeepReadPromptPhaseDefaults[];
}

interface DeepReadPromptDefaults {
  chapterFallbacks: ChapterInfo[];
  template: DeepReadPromptTemplateDefaults;
}

function joinPromptLines(value: DeepReadPromptText | undefined): string {
  if (Array.isArray(value)) {
    return value.join("\n");
  }
  return value ?? "";
}

function normalizeDeepReadPromptTemplate(
  defaults: DeepReadPromptDefaults,
): MultiRoundPromptTemplate {
  return {
    ...defaults.template,
    phases: defaults.template.phases.map((phase) => {
      if (phase.type !== "sequential_dynamic") {
        return phase;
      }
      const {
        planningPrompt,
        planningPromptLines,
        chapterTemplate,
        chapterTemplateLines,
        ...phaseBase
      } = phase;
      return {
        ...phaseBase,
        planningPrompt: joinPromptLines(planningPromptLines ?? planningPrompt),
        chapterTemplate: joinPromptLines(
          chapterTemplateLines ?? chapterTemplate,
        ),
      };
    }),
  };
}

const DEEP_READ_PROMPT_DEFAULTS =
  deepReadPromptDefaults as DeepReadPromptDefaults;

export const DEFAULT_CHAPTER_FALLBACKS: ChapterInfo[] =
  DEEP_READ_PROMPT_DEFAULTS.chapterFallbacks;

export const DEFAULT_MULTI_ROUND_PROMPT_TEMPLATE: MultiRoundPromptTemplate =
  normalizeDeepReadPromptTemplate(DEEP_READ_PROMPT_DEFAULTS);

const defaultChapterReadingPhase =
  DEFAULT_MULTI_ROUND_PROMPT_TEMPLATE.phases.find(
    (phase): phase is MultiRoundSequentialDynamicPhase =>
      phase.type === "sequential_dynamic",
  );

export const DEFAULT_MULTI_ROUND_PLANNING_PROMPT =
  defaultChapterReadingPhase?.planningPrompt ?? "";

export const DEFAULT_MULTI_ROUND_CHAPTER_TEMPLATE =
  defaultChapterReadingPhase?.chapterTemplate ?? "";

export function getDefaultMultiRoundPromptTemplate(): MultiRoundPromptTemplate {
  return cloneMultiRoundPromptTemplate(DEFAULT_MULTI_ROUND_PROMPT_TEMPLATE);
}

export function getBuiltinMultiRoundPromptTemplates(): MultiRoundPromptTemplate[] {
  return [getDefaultMultiRoundPromptTemplate()];
}

export function parseMultiRoundPromptTemplates(
  jsonStr: string | undefined,
): MultiRoundPromptTemplate[] {
  if (!jsonStr || !jsonStr.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.reduce<MultiRoundPromptTemplate[]>((templates, entry) => {
      try {
        templates.push(normalizeMultiRoundPromptTemplate(entry));
      } catch {
        // Skip invalid custom templates without breaking the settings page.
      }
      return templates;
    }, []);
  } catch {
    return [];
  }
}

export function mergeMultiRoundPromptTemplates(
  builtinTemplates: MultiRoundPromptTemplate[],
  customTemplates: MultiRoundPromptTemplate[],
): MultiRoundPromptTemplate[] {
  const templatesById = new Map<string, MultiRoundPromptTemplate>();
  [...builtinTemplates, ...customTemplates].forEach((template) => {
    templatesById.set(template.id, cloneMultiRoundPromptTemplate(template));
  });
  return Array.from(templatesById.values());
}

export function createMultiRoundPromptTemplateExport(
  template: MultiRoundPromptTemplate,
  exportedAt: string = new Date().toISOString(),
): MultiRoundPromptTemplateExport {
  return {
    schema: MULTI_ROUND_PROMPT_TEMPLATE_SCHEMA,
    version: MULTI_ROUND_PROMPT_TEMPLATE_EXPORT_VERSION,
    exportedAt,
    template: normalizeMultiRoundPromptTemplate(template),
  };
}

export function serializeMultiRoundPromptTemplate(
  template: MultiRoundPromptTemplate,
): string {
  return JSON.stringify(
    createMultiRoundPromptTemplateExport(template),
    null,
    2,
  );
}

export function parseMultiRoundPromptTemplateExport(
  jsonStr: string,
): MultiRoundPromptTemplate {
  const parsed = JSON.parse(jsonStr);
  if (!isRecord(parsed)) {
    throw new Error(
      "\u5bfc\u5165\u5185\u5bb9\u5fc5\u987b\u662f JSON \u5bf9\u8c61",
    );
  }
  if (parsed.schema !== MULTI_ROUND_PROMPT_TEMPLATE_SCHEMA) {
    throw new Error("\u6a21\u677f JSON schema \u4e0d\u5339\u914d");
  }
  if (parsed.version !== MULTI_ROUND_PROMPT_TEMPLATE_EXPORT_VERSION) {
    throw new Error("\u6a21\u677f JSON \u7248\u672c\u4e0d\u53d7\u652f\u6301");
  }
  return normalizeMultiRoundPromptTemplate(parsed.template);
}

export function normalizeMultiRoundPromptTemplate(
  value: unknown,
): MultiRoundPromptTemplate {
  if (!isRecord(value)) {
    throw new Error("\u6a21\u677f\u5fc5\u987b\u662f\u5bf9\u8c61");
  }

  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name) {
    throw new Error("\u6a21\u677f\u540d\u79f0\u4e0d\u80fd\u4e3a\u7a7a");
  }

  const phases = normalizeMultiRoundPromptPhases(value.phases);
  validateMultiRoundSlotIds(phases);

  const version =
    typeof value.version === "number" && Number.isFinite(value.version)
      ? Math.max(2, Math.round(value.version))
      : 2;
  const description =
    typeof value.description === "string" ? value.description.trim() : "";

  return {
    id: normalizeMultiRoundTemplateId(value.id, name),
    name,
    description,
    version,
    phases,
    prompts: [],
  };
}

export function normalizeMultiRoundPromptPhases(
  value: unknown,
): MultiRoundPromptPhase[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("\u6a21\u677f\u81f3\u5c11\u9700\u8981\u4e00\u4e2a phase");
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(
        `\u7b2c ${index + 1} \u4e2a phase \u5fc5\u987b\u662f\u5bf9\u8c61`,
      );
    }
    const type = entry.type;
    if (type === "sequential_dynamic") {
      return normalizeSequentialDynamicPhase(entry, index);
    }
    if (type === "independent") {
      return normalizeIndependentPhase(entry, index);
    }
    throw new Error(
      `\u7b2c ${index + 1} \u4e2a phase \u7c7b\u578b\u4e0d\u53d7\u652f\u6301`,
    );
  });
}

export function normalizeMultiRoundPromptItems(
  value: unknown,
  options: { strict?: boolean } = {},
): MultiRoundPromptItem[] {
  if (!Array.isArray(value)) {
    if (options.strict) {
      throw new Error(
        "\u8f6e\u6b21\u63d0\u793a\u8bcd\u5fc5\u987b\u662f\u6570\u7ec4",
      );
    }
    return [];
  }

  const prompts: MultiRoundPromptItem[] = [];
  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      if (options.strict) {
        throw new Error(
          `\u7b2c ${index + 1} \u8f6e\u63d0\u793a\u8bcd\u5fc5\u987b\u662f\u5bf9\u8c61`,
        );
      }
      return;
    }

    const title = normalizeImportedTitle(entry.title);
    const prompt = typeof entry.prompt === "string" ? entry.prompt.trim() : "";
    if (!title || !prompt) {
      if (options.strict) {
        throw new Error(
          `\u7b2c ${index + 1} \u8f6e\u6807\u9898\u548c\u63d0\u793a\u8bcd\u4e0d\u80fd\u4e3a\u7a7a`,
        );
      }
      return;
    }

    const order =
      typeof entry.order === "number" && Number.isFinite(entry.order)
        ? Math.max(1, Math.round(entry.order))
        : index + 1;

    prompts.push({
      id: normalizeMultiRoundPromptId(entry.id, index),
      title,
      prompt,
      order,
    });
  });

  return prompts
    .sort((a, b) => a.order - b.order)
    .map((prompt, index) => ({ ...prompt, order: index + 1 }));
}

export function parseChapterStructureResult(
  responseText: string,
): ChapterParseResult {
  const jsonCandidates = [
    ...responseText.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi),
  ].map((match) => match[1]);
  const objectMatch = responseText.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    jsonCandidates.push(objectMatch[0]);
  }
  jsonCandidates.push(responseText);

  for (const candidate of jsonCandidates) {
    try {
      const parsed = JSON.parse(candidate.trim());
      const chapters = normalizeChapterArray(
        (parsed as { chapters?: unknown }).chapters,
        DEFAULT_DEEP_READ_CHAPTER_LIMIT,
      );
      if (chapters.length > 0) {
        return { chapters, source: "json" };
      }
    } catch {
      // Continue to regex fallback.
    }
  }

  const zhMatches = [...responseText.matchAll(/"title_zh"\s*:\s*"([^"]+)"/g)];
  const enMatches = [...responseText.matchAll(/"title_en"\s*:\s*"([^"]+)"/g)];
  if (zhMatches.length > 0) {
    return {
      source: "regex",
      chapters: zhMatches.map((match, index) => ({
        id: `ch${index + 1}`,
        title_zh: match[1].trim(),
        title_en: enMatches[index]?.[1]?.trim() || "",
      })),
    };
  }

  return {
    chapters: cloneChapterInfos(DEFAULT_CHAPTER_FALLBACKS),
    source: "fallback",
  };
}

export function parseChapterStructure(responseText: string): ChapterInfo[] {
  return parseChapterStructureResult(responseText).chapters;
}

export function parseManualChapterStructure(input: string): ChapterInfo[] {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.reduce<ChapterInfo[]>((chapters, line, index) => {
    const normalized = line
      .replace(/^第\s*\d+\s*章\s*[:：.-]?\s*/i, "")
      .replace(/^chapter\s*\d+\s*[:：.-]?\s*/i, "")
      .trim();
    if (!normalized) return chapters;
    const pair = normalized.match(/^(.+?)[（(]([^()（）]+)[）)]$/);
    chapters.push({
      id: `ch${index + 1}`,
      title_zh: (pair?.[1] || normalized).trim(),
      title_en: (pair?.[2] || "").trim(),
    });
    return chapters;
  }, []);
}

export function generateChapterPrompts(
  chapters: ChapterInfo[],
  chapterTemplate: string,
  fixedPromptsCount = 0,
  maxChapters = DEFAULT_DEEP_READ_CHAPTER_LIMIT,
): MultiRoundPromptItem[] {
  const limit = Math.min(
    MAX_DEEP_READ_CHAPTER_LIMIT,
    Math.max(
      1,
      Number.isFinite(maxChapters)
        ? Math.round(maxChapters)
        : DEFAULT_DEEP_READ_CHAPTER_LIMIT,
    ),
  );
  return chapters.slice(0, limit).map((chapter, index) => ({
    id: `chapter_${chapter.id || `ch${index + 1}`}`,
    title: chapter.title_zh || chapter.title_en || `第 ${index + 1} 章`,
    prompt: chapterTemplate
      .replace(/\{\{chapter_index\}\}/g, String(index + 1))
      .replace(/\{\{title_zh\}\}/g, chapter.title_zh || "")
      .replace(/\{\{title_en\}\}/g, chapter.title_en || "")
      .replace(/\{\{chapter_title_zh\}\}/g, chapter.title_zh || "")
      .replace(/\{\{chapter_title_en\}\}/g, chapter.title_en || ""),
    order: fixedPromptsCount + index + 1,
  }));
}
export function cloneMultiRoundPromptTemplate(
  template: MultiRoundPromptTemplate,
): MultiRoundPromptTemplate {
  return {
    ...template,
    prompts: cloneMultiRoundPrompts(template.prompts || []),
    phases: template.phases.map((phase) =>
      phase.type === "sequential_dynamic"
        ? {
            ...phase,
            fixedPrompts: cloneMultiRoundPrompts(phase.fixedPrompts),
          }
        : {
            ...phase,
            prompts: cloneMultiRoundPrompts(phase.prompts),
          },
    ),
  };
}

function normalizeSequentialDynamicPhase(
  value: Record<string, unknown>,
  index: number,
): MultiRoundSequentialDynamicPhase {
  const planningPrompt =
    typeof value.planningPrompt === "string" ? value.planningPrompt.trim() : "";
  const chapterTemplate =
    typeof value.chapterTemplate === "string"
      ? value.chapterTemplate.trim()
      : "";
  if (!planningPrompt) {
    throw new Error("sequential_dynamic phase \u7f3a\u5c11 planningPrompt");
  }
  if (!chapterTemplate) {
    throw new Error("sequential_dynamic phase \u7f3a\u5c11 chapterTemplate");
  }
  const contextStrategy =
    value.contextStrategy === "full_history" ? "full_history" : "last_round";
  const maxChapters =
    typeof value.maxChapters === "number" && Number.isFinite(value.maxChapters)
      ? Math.min(
          MAX_DEEP_READ_CHAPTER_LIMIT,
          Math.max(1, Math.round(value.maxChapters)),
        )
      : DEFAULT_DEEP_READ_CHAPTER_LIMIT;

  return {
    id: normalizeMultiRoundPromptId(value.id, index),
    title: normalizeNonEmptyString(value.title, `\u9636\u6bb5 ${index + 1}`),
    type: "sequential_dynamic",
    description: normalizeOptionalString(value.description),
    contextStrategy,
    planningPrompt,
    fixedPrompts: normalizeMultiRoundPromptItems(value.fixedPrompts),
    chapterTemplate,
    maxChapters,
  };
}

function normalizeIndependentPhase(
  value: Record<string, unknown>,
  index: number,
): MultiRoundIndependentPhase {
  const prompts = normalizeMultiRoundPromptItems(value.prompts, {
    strict: true,
  });
  if (prompts.length === 0) {
    throw new Error(
      "independent phase \u81f3\u5c11\u9700\u8981\u4e00\u4e2a\u63d0\u793a\u8bcd",
    );
  }
  const maxConcurrency =
    typeof value.maxConcurrency === "number" &&
    Number.isFinite(value.maxConcurrency)
      ? Math.min(8, Math.max(1, Math.round(value.maxConcurrency)))
      : 1;

  return {
    id: normalizeMultiRoundPromptId(value.id, index),
    title: normalizeNonEmptyString(value.title, `\u9636\u6bb5 ${index + 1}`),
    type: "independent",
    description: normalizeOptionalString(value.description),
    parallelizable: value.parallelizable === true,
    maxConcurrency,
    prompts,
  };
}

function validateMultiRoundSlotIds(phases: MultiRoundPromptPhase[]): void {
  const seen = new Set<string>();
  const register = (id: string) => {
    if (seen.has(id)) {
      throw new Error(`\u7cbe\u8bfb\u6a21\u677f slot ID \u91cd\u590d: ${id}`);
    }
    seen.add(id);
  };

  phases.forEach((phase) => {
    if (phase.type === "sequential_dynamic") {
      phase.fixedPrompts.forEach((prompt) => register(prompt.id));
      return;
    }
    phase.prompts.forEach((prompt) => register(prompt.id));
  });
}

function normalizeChapterArray(
  value: unknown,
  maxChapters = DEFAULT_DEEP_READ_CHAPTER_LIMIT,
): ChapterInfo[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const limit = Math.min(MAX_DEEP_READ_CHAPTER_LIMIT, Math.max(1, maxChapters));
  return value.reduce<ChapterInfo[]>((chapters, entry, index) => {
    if (chapters.length >= limit) {
      return chapters;
    }
    if (!isRecord(entry)) {
      return chapters;
    }
    const titleZh = normalizeOptionalString(entry.title_zh);
    const titleEn = normalizeOptionalString(entry.title_en);
    if (!titleZh && !titleEn) {
      return chapters;
    }
    const normalizedTitleZh = titleZh || titleEn;
    const normalizedTitleEn = titleEn;
    const key = `${normalizedTitleZh}\n${normalizedTitleEn}`.toLowerCase();
    if (seen.has(key)) {
      return chapters;
    }
    seen.add(key);
    chapters.push({
      id: normalizeMultiRoundPromptId(entry.id, index).replace(/^chapter_/, ""),
      title_zh: normalizedTitleZh,
      title_en: normalizedTitleEn,
    });
    return chapters;
  }, []);
}

function cloneChapterInfos(chapters: ChapterInfo[]): ChapterInfo[] {
  return chapters.map((chapter) => ({ ...chapter }));
}

function cloneMultiRoundPrompts(
  prompts: MultiRoundPromptItem[],
): MultiRoundPromptItem[] {
  return prompts.map((prompt) => ({ ...prompt }));
}

function normalizeMultiRoundPromptId(value: unknown, index: number): string {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : `round${index + 1}`;
}

function normalizeMultiRoundTemplateId(
  value: unknown,
  fallbackName: string,
): string {
  const raw = typeof value === "string" && value.trim() ? value : fallbackName;
  const normalized = raw
    .trim()
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || `template-${Date.now()}`;
}

function normalizeNonEmptyString(value: unknown, fallback: string): string {
  const normalized = normalizeOptionalString(value);
  return normalized || fallback;
}

function normalizeImportedTitle(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .replace(/\uFFFD/g, "\u00b7")
    .replace(/\u00c2\u00b7/g, "\u00b7")
    .replace(/\s*\u00b7\s*/g, "\u00b7");
}

function normalizeOptionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

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

// ================================================================
// 文献综述表格填写相关功能
// ================================================================

/**
 * 默认的文献综述表格模板（Markdown 格式）
 *
 * 用户可在设置界面自定义此模板
 * LLM 会按此模板结构为每篇论文填写信息
 */
export const DEFAULT_TABLE_TEMPLATE = `| 维度 | 内容 |
|------|------|
| 论文标题 | |
| 作者 | |
| 发表年份 | |
| 研究问题 | |
| 研究方法 | |
| 主要发现 | |
| 创新点 | |
| 局限性 | |
| 与本研究的关联 | |`;

/**
 * 默认的逐篇填表提示词
 *
 * 指导 LLM 阅读单篇论文并按表格模板填写结构化信息
 */
export const DEFAULT_TABLE_FILL_PROMPT = `请仔细阅读以下学术论文的内容，并按照给定的表格模板填写每个维度的信息。

要求：
1. 严格按照表格模板的格式输出，保持 Markdown 表格语法
2. 每个维度都需要填写，如果论文中没有相关信息，填写"未提及"
3. 内容应简洁精准，每个维度控制在 1-3 句话
4. 使用中文填写
5. 只输出填好的表格，不要添加额外说明

表格模板：
\${tableTemplate}`;

/**
 * 默认的汇总综述提示词
 *
 * 基于多篇论文的填表结果生成综合文献综述
 */
export const DEFAULT_TABLE_REVIEW_PROMPT = `请阅读以下多篇学术论文，生成一份综合性文献综述报告，包括：

1. **研究主题概述**: 简述这些论文共同关注的研究领域和核心问题
2. **各论文主要贡献**: 逐一总结每篇论文的核心观点、方法和发现
3. **研究方法对比**: 分析各论文采用的研究方法的异同
4. **主要发现汇总**: 综合各论文的主要结论和发现
5. **研究趋势与展望**: 基于这些论文，分析该领域的发展趋势和未来研究方向

对于所有引用的内容或结论，使用[num]格式标注（如[1]、[2]），其中num对应各文献的编号。有多个引用来源时使用[1][2][3]格式。无需在最后给出完整参考文献列表。请使用清晰的结构和学术性语言，确保综述内容准确、逻辑连贯。使用中文输出。`;

/**
 * 获取默认的表格模板
 *
 * @returns 默认 Markdown 表格模板
 */
export function getDefaultTableTemplate(): string {
  return DEFAULT_TABLE_TEMPLATE;
}

/**
 * 获取默认的逐篇填表提示词
 *
 * @returns 默认填表提示词
 */
export function getDefaultTableFillPrompt(): string {
  return DEFAULT_TABLE_FILL_PROMPT;
}

/**
 * 获取默认的汇总综述提示词
 *
 * @returns 默认汇总综述提示词
 */
export function getDefaultTableReviewPrompt(): string {
  return DEFAULT_TABLE_REVIEW_PROMPT;
}

// ================================================================
// 思维导图提示词相关功能
// ================================================================

/**
 * 默认的思维导图生成提示词
 *
 * 用于从论文中生成结构化 Markdown 列表，供 Markmap 渲染为思维导图
 *
 * 设计要点：
 * - 使用 One-Shot 提示让 LLM 模仿固定格式
 * - 根节点为论文标题
 * - 一级分支固定为四个核心章节
 * - 子节点层级控制在 3-4 层以内
 */
export const DEFAULT_MINDMAP_PROMPT = `# Role
你是一个专业的学术论文分析助手。你的任务是将论文内容转化为结构化的思维导图数据。

# Output Format Rules (必须严格遵守)
1. 输出格式必须是 **Markdown 标题和无序列表**。
2. **根节点 (\`#\`)**: 必须是论文的标题。
3. **一级分支 (\`##\`)**: 必须严格包含且仅包含以下四个部分：
   - 研究背景与目标
   - 研究方法
   - 关键研究结果
   - 研究结论与意义
4. **子节点 (\`-\`)**: 根据论文内容进行细分，层级控制在 3-4 层以内，保持精简。
5. 不要输出任何 Markdown 代码块标记（如 \`\`\`markdown），直接输出内容即可。
6. 语言：使用**中文**输出。

# One-Shot Example (参考范例)
## Input Text:
[一篇关于 Deep Residual Learning (ResNet) 的论文摘要...]

## Expected Output:
# Deep Residual Learning for Image Recognition

## 研究背景与目标
- 梯度消失/爆炸
  - 阻碍了深度神经网络的收敛
- 退化问题 (Degradation Problem)
  - 网络加深导致准确率饱和甚至下降
- 核心目标
  - 训练极深的网络 (100层+)
  - 解决退化问题

## 研究方法
- 残差学习框架 (Residual Learning)
  - 引入恒等映射 (Identity Mapping)
  - 拟合残差函数 F(x) = H(x) - x
- 网络架构
  - 使用 3x3 卷积核
  - 引入全局平均池化层
- 训练策略
  - 批量归一化 (Batch Normalization)

## 关键研究结果
- ImageNet 竞赛冠军
  - Top-5 错误率降低至 3.57%
- 深度优势验证
  - 152层网络显著优于 VGG-16
- 优化难易度
  - ResNet 比普通平原网络更容易优化

## 研究结论与意义
- 核心贡献
  - 证实了残差结构在深层网络中的有效性
- 广泛影响
  - 成为计算机视觉领域的标准骨干网络 (Backbone)
- 局限性
  - 极深网络的训练时间成本较高

---
# Current Task
请阅读以下论文内容，并按照上述格式生成思维导图数据：`;

/**
 * 获取默认的思维导图提示词
 *
 * @returns 默认思维导图提示词
 */
export function getDefaultMindmapPrompt(): string {
  return DEFAULT_MINDMAP_PROMPT;
}
