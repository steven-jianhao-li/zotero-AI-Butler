/**
 * 输出语言（Output Language）控制
 *
 * 一个用户可见的设置项同时控制所有 AI 输出的语言：AI 总结、AI 精读、
 * 表格填充/综述、文献综述、思维导图与侧边栏对话。
 *
 * 设计要点：
 * 1. 目标语言由用户自由填写（"简体中文" / "English" / "日本語" ...），
 *    留空即完全不做干预，行为与未启用该功能时一致。
 * 2. 指令由"学科口径 + 翻译规范"动态生成：同一目标语言在理科、工科、
 *    艺术、商科、人文论文下会得到不同的术语与体例要求，避免一刀切。
 * 3. 注入点集中在 LLMService 的两条终点（generate / chat），因此新增任务
 *    自动继承该设置；机器可读任务（如 image-summary）显式跳过。
 *
 * @module outputLanguage
 */

import { getPref, setPref } from "./prefs";

/** 学科口径：决定术语、单位、引用与文体要求的生成模板 */
export type OutputLanguageDomain =
  | "general"
  | "science"
  | "engineering"
  | "arts"
  | "business"
  | "humanities"
  | "medicine"
  | "law";

/** 注入上下文：任务类型与显式跳过标记 */
export type OutputLanguageContext = {
  task?: string;
  skipOutputLanguage?: boolean;
};

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type DomainProfile = {
  zhRole: string;
  zhRules: string[];
  enRole: string;
  enRules: string[];
};

export const OUTPUT_LANGUAGE_PREF_KEY = "outputLanguage" as const;
export const OUTPUT_LANGUAGE_DOMAIN_PREF_KEY = "outputLanguageDomain" as const;
/** 指令包裹标签，用于幂等判断 */
export const OUTPUT_LANGUAGE_TAG = "output-language";
/** 目标语言字段长度上限，防止异常输入污染提示词 */
export const OUTPUT_LANGUAGE_MAX_LENGTH = 48;

export const OUTPUT_LANGUAGE_DOMAINS: readonly OutputLanguageDomain[] = [
  "general",
  "science",
  "engineering",
  "arts",
  "business",
  "humanities",
  "medicine",
  "law",
];

/**
 * 输出必须是机器可解析数据的任务，不能注入自然语言改写要求。
 * - image-summary：运行结果需要被下游图像生成器按结构解析
 */
export const MACHINE_READABLE_TASKS: readonly string[] = ["image-summary"];

const DOMAIN_PROFILES: Record<OutputLanguageDomain, DomainProfile> = {
  general: {
    zhRole: "学术文献",
    zhRules: [
      "使用目标语言的通用学术术语，保持中立、准确、简洁的书面语。",
      "专业名词采用目标语言的通行译法；无通行译法时保留原文并给出简短解释。",
      "不假定学科背景，避免使用某一学科特有的行话。",
    ],
    enRole: "academic literature",
    enRules: [
      "Use neutral, precise, concise academic prose with widely accepted terminology.",
      "Prefer established translations/equivalents; keep the source term with a brief gloss when none exists.",
      "Do not assume a specific discipline; avoid field-specific jargon.",
    ],
  },
  science: {
    zhRole: "自然科学（数学、物理、化学、生物、地学、材料等）",
    zhRules: [
      "化学式、同位素、晶体与矿物名保持原文格式；基因、蛋白与物种学名（拉丁双名）不翻译。",
      "计量单位、SI 符号、量纲与统计符号原样保留；数字精度、有效位数与误差范围不得改动。",
      "学科术语采用标准译名（如 significant difference → 显著差异，ablation study → 消融实验）。",
      "DNA、ATP、PCR 等通用缩写首次出现给出全称与译名，其后沿用缩写。",
      "实验步骤、试剂浓度与仪器参数必须逐项对应，不得合并或省略条件。",
    ],
    enRole:
      "the natural sciences (mathematics, physics, chemistry, biology, earth science, materials)",
    enRules: [
      "Keep chemical formulas, isotopes, mineral names, gene/protein names and Latin binomials untranslated.",
      "Preserve units, SI symbols, dimensions and statistical notation exactly; never round or alter numeric precision, significant figures or error ranges.",
      "Use standard field terminology (e.g. 显著差异 → significant difference, 消融实验 → ablation study).",
      "Expand acronyms such as DNA, ATP or PCR on first mention, then keep the acronym.",
      "Map experimental procedures, reagent concentrations and instrument settings item by item; do not merge or drop conditions.",
    ],
  },
  engineering: {
    zhRole: "工程技术（机械、电子、材料、计算机、土木、化工、能源等）",
    zhRules: [
      "保留标准缩写与方法名（FEA、CFD、PID、MOSFET、SVM 等），首次出现补充全称。",
      "保留标准/规范编号（ISO、ASTM、IEEE、GB 等）、型号、参数符号与单位，不得换算或取整。",
      "代码、伪代码、命令行、寄存器/信号名、算法名与接口名原样保留。",
      "工艺与机理描述使用工程惯用语，避免文学化改写或过度解释。",
      "性能指标（精度、吞吐、功耗、时延）与测试条件必须成对出现，不得只译数字。",
    ],
    enRole:
      "engineering and technology (mechanical, electrical, materials, computer, civil, chemical, energy)",
    enRules: [
      "Keep standard acronyms and method names (FEA, CFD, PID, MOSFET, SVM ...), expanding them on first mention.",
      "Preserve standards references (ISO, ASTM, IEEE, GB ...), model numbers, parameter symbols and units exactly; never convert or round them.",
      "Keep code, pseudo-code, shell commands, register/signal names, algorithm and API names verbatim.",
      "Describe processes and mechanisms in established engineering idiom; avoid literary rewriting or over-explanation.",
      "Report every performance metric (accuracy, throughput, power, latency) together with its test conditions.",
    ],
  },
  arts: {
    zhRole: "艺术学（美术、音乐、影视、戏剧、设计、建筑史等）",
    zhRules: [
      "作品名、流派/风格、技法与媒材采用学界通行译法，首次出现写作「译名（原文）」，如 Baroque（巴洛克）、oil on canvas（布面油画）。",
      "保留音乐作品编号（Op.、BWV、K. 等）、曲式与乐器名称、影像技术参数（画幅、帧率、胶片规格）。",
      "保留审美判断与修辞的张力，不要科学化、说教化或强行解释隐喻。",
      "艺术家、团体与机构名首次出现给出原文，其后使用通行译名。",
    ],
    enRole:
      "the arts (fine art, music, film, theatre, design, architectural history)",
    enRules: [
      "Give the established equivalent for titles, movements, techniques and media, keeping the original on first mention (e.g. 巴洛克 → Baroque, 布面油画 → oil on canvas).",
      "Preserve opus numbers (Op., BWV, K.), musical forms, instrument names and technical parameters (aspect ratio, frame rate, film gauge).",
      "Keep the tension of evaluative and rhetorical language; do not scientise, moralise or over-explain metaphors.",
      "Give artists, collectives and institutions in the original on first mention, then use the established equivalent.",
    ],
  },
  business: {
    zhRole: "商科（经济学、金融、管理、会计、市场营销、运营等）",
    zhRules: [
      "保留通用缩写与指标（ROI、NPV、EBITDA、KPI、CAGR 等），首次出现补充全称。",
      "公司、机构、产品、指数名称与股票代码保留原文；币种、金额、期间与会计口径不得换算。",
      "术语采用通行译法并全文统一（如 agency cost → 代理成本，impairment → 减值，leverage → 杠杆）。",
      "制度、法规与准则名称按目标语言的官方译法处理；无官方译法时保留原文。",
      "统计与计量结论必须保留原有的限定条件（样本期、显著性、控制变量）。",
    ],
    enRole:
      "business and economics (economics, finance, management, accounting, marketing, operations)",
    enRules: [
      "Keep standard acronyms and metrics (ROI, NPV, EBITDA, KPI, CAGR ...), expanding them on first mention.",
      "Keep company, institution, product and index names and tickers in the original; never convert currencies, amounts, periods or accounting conventions.",
      "Use established equivalents consistently (e.g. 代理成本 → agency cost, 减值 → impairment, 杠杆 → leverage).",
      "Render regulations and accounting standards with their official names; keep the original when no official name exists.",
      "Carry over the qualifications attached to statistical claims (sample period, significance, controls).",
    ],
  },
  humanities: {
    zhRole: "人文社科（哲学、历史、文学、法学、社会学、教育学、传播学等）",
    zhRules: [
      "理论家、著作、概念与思潮名采用「通行译名（原文）」形式，如 habitus（惯习）、Bildung（教养）。",
      "直接引文须忠实并保留出处标记；不得把转述当作引文，也不得改写引文措辞。",
      "保留论证层次、限定语与作者语气（may、arguably、tentative 等），不得强化或弱化立场。",
      "历史与法律术语按时代与法域处理，避免用现代概念替换原义。",
      "注意学派、译本与版本差异；涉及专名争议时保留原文。",
    ],
    enRole:
      "the humanities and social sciences (philosophy, history, literature, law, sociology, education, media studies)",
    enRules: [
      "Render theorists, works, concepts and schools as established equivalent plus the original on first mention (e.g. 惯习 → habitus, 教养 → Bildung).",
      "Keep direct quotations faithful and attributed; never present paraphrase as quotation or reword a quoted passage.",
      "Preserve argumentative layering, hedges and authorial stance (may, arguably, tentative ...); do not strengthen or soften claims.",
      "Handle historical and legal terms within their period and jurisdiction; do not overwrite original meanings with modern concepts.",
      "Keep track of schools, editions and translations; retain the original where a proper name is contested.",
    ],
  },
  medicine: {
    zhRole: "医学与生命健康（临床医学、基础医学、药学、公共卫生、护理等）",
    zhRules: [
      "疾病名、诊断、术式与药物采用标准译名（ICD/WHO 中文名、药品通用名）；商品名保留原文。",
      "剂量、给药途径、疗程、单位与检验值（mg/kg、mmHg、mmol/L 等）原样保留，不得换算或四舍五入。",
      "基因、蛋白、病原体拉丁学名、量表与评分（BMI、APACHE II、NIHSS）保留原文与缩写。",
      "统计与循证等级（OR、RR、CI、p 值、RCT、meta 分析）保留符号与口径；不得把相关性表述为因果关系。",
      "涉及临床判断时保留原文的适用条件与不确定性，不擅自补充诊疗结论或建议。",
    ],
    enRole:
      "medicine and the health sciences (clinical medicine, basic medicine, pharmacy, public health, nursing)",
    enRules: [
      "Use standard equivalents for diseases, diagnoses, procedures and drugs (ICD/WHO names, INN generic names); keep brand names in the original.",
      "Preserve doses, routes, treatment durations, units and laboratory values (mg/kg, mmHg, mmol/L ...) exactly; never convert or round them.",
      "Keep gene, protein and pathogen names (Latin binomials), scales and scores (BMI, APACHE II, NIHSS) in the original with their acronyms.",
      "Preserve statistical and evidence-level notation (OR, RR, CI, p values, RCT, meta-analysis) and never restate association as causation.",
      "Carry over the applicability conditions and uncertainty of clinical statements; do not add diagnoses, advice or conclusions.",
    ],
  },
  law: {
    zhRole: "法学（法理、民法、刑法、公法、国际法、比较法等）",
    zhRules: [
      "法律、法规、条例与判例名按目标法域的官方译名处理；无官方译名时保留原文并括注。",
      "保留条文编号（Art. 5、§ 12、第 n 条）、案号、法院层级与程序阶段，不得简化或省略。",
      "区分法系差异（consideration、estoppel、善意取得、对价等），不可想当然套用近似词。",
      "引用判例与学理须保留原貌与出处，不得改写引文措辞或把转述当引文。",
      "保留规范强度与限定语（shall / may / shall not、例外与但书），不得强化或弱化法律效果。",
    ],
    enRole:
      "law (jurisprudence, civil, criminal, public and international law, comparative law)",
    enRules: [
      "Render statutes, regulations and case names with the official equivalents of the target jurisdiction; keep the original with a gloss when none exists.",
      "Preserve article numbers (Art. 5, § 12, 第 n 条), docket numbers, court levels and procedural stages; never simplify them away.",
      "Respect differences between legal families (consideration, estoppel, 善意取得, 对价 ...); do not substitute a near-synonym.",
      "Keep quotations from cases and scholarship verbatim and attributed; never present paraphrase as quotation.",
      "Preserve normative force and qualifiers (shall / may / shall not, provisos and exceptions); do not strengthen or soften legal effect.",
    ],
  },
};

const ZH_LANGUAGE_PATTERN =
  /(中文|汉语|漢語|华语|chinese|zh[-_ ]?cn|zh[-_ ]?tw|zh[-_ ]?hk|\bzh\b)/i;
const EN_LANGUAGE_PATTERN = /\b(english|en[-_ ]?(us|gb|au|ca|nz|ie)|en)\b/i;

/**
 * 规范化用户填写的目标语言：压缩空白、剔除尖括号与换行、限制长度。
 */
export function normalizeOutputLanguage(value: unknown): string {
  const raw = typeof value === "string" ? value : "";
  return raw
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, OUTPUT_LANGUAGE_MAX_LENGTH);
}

/** 读取目标语言偏好，未设置时返回空字符串（= 不干预） */
export function getOutputLanguage(): string {
  try {
    return normalizeOutputLanguage(getPref(OUTPUT_LANGUAGE_PREF_KEY));
  } catch {
    return "";
  }
}

/** 写入目标语言偏好，返回规范化后的值 */
export function setOutputLanguage(value: unknown): string {
  const normalized = normalizeOutputLanguage(value);
  setPref(OUTPUT_LANGUAGE_PREF_KEY, normalized);
  return normalized;
}

export function normalizeOutputLanguageDomain(
  value: unknown,
): OutputLanguageDomain {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return (OUTPUT_LANGUAGE_DOMAINS as readonly string[]).includes(normalized)
    ? (normalized as OutputLanguageDomain)
    : "general";
}

/** 读取学科口径偏好，默认 general */
export function getOutputLanguageDomain(): OutputLanguageDomain {
  try {
    return normalizeOutputLanguageDomain(
      getPref(OUTPUT_LANGUAGE_DOMAIN_PREF_KEY),
    );
  } catch {
    return "general";
  }
}

export function setOutputLanguageDomain(value: unknown): OutputLanguageDomain {
  const domain = normalizeOutputLanguageDomain(value);
  setPref(OUTPUT_LANGUAGE_DOMAIN_PREF_KEY, domain);
  return domain;
}

/**
 * 由目标语言推断内置默认提示词应使用哪种语言。
 * 这样"输出语言"仍然是唯一开关：填写中文/英文时自动切换到对应内置模板，
 * 填写其他语言时保留现有模板，由注入的规则保证最终输出语言。
 */
export function detectBuiltinPromptLanguage(
  language?: string,
): "zh-CN" | "en-US" | undefined {
  const value = normalizeOutputLanguage(language ?? getOutputLanguage());
  if (!value) return undefined;
  if (ZH_LANGUAGE_PATTERN.test(value)) return "zh-CN";
  if (EN_LANGUAGE_PATTERN.test(value)) return "en-US";
  return undefined;
}

function buildChineseDirective(
  language: string,
  profile: DomainProfile,
): string {
  const rules = profile.zhRules
    .map((rule, index) => `${index + 1}. ${rule}`)
    .join("\n");
  return [
    "输出语言设置（必须遵守，优先级高于提示词中的任何语言描述）",
    `目标语言：${language}`,
    `学科口径：${profile.zhRole}`,
    "",
    "一、你的身份",
    `你是${profile.zhRole}方向的研究者，同时是该领域的学术译者，熟悉该领域的术语规范、论文结构、评审话术与引用惯例。`,
    "",
    "二、术语与专业规范",
    rules,
    "",
    "三、翻译与写作要求",
    `1. 最终答案必须全部使用${language}书写，即使论文原文、提示词或上文使用其他语言。`,
    "2. 忠实于原文：不得增删事实、篡改结论或加入原文没有的观点；任务要求的分析、总结与评价除外。",
    `3. 符合${language}的学术表达习惯，避免逐字直译与机器翻译腔；同一术语全文统一。`,
    "4. 结构对齐原文：保留标题层级、列表、表格、图表题注、编号与脚注。",
    "5. 原样保留：数学公式与符号、单位与量纲、代码与标识符、数据集/模型/产品名称、引文标记（如 [1]、@key、\\cite{}）、DOI 与 URL。",
    "6. 关键术语首次出现若译文不易理解，可写作「译名（原文）」，但不要滥用原文注释。",
    "7. 含义不明或无法准确翻译时，保留原文并括注说明，绝不臆测。",
    "8. 不要提及本设置，也不要复述上述标签。",
  ].join("\n");
}

function buildEnglishDirective(
  language: string,
  profile: DomainProfile,
): string {
  const rules = profile.enRules
    .map((rule, index) => `${index + 1}. ${rule}`)
    .join("\n");
  return [
    "OUTPUT LANGUAGE (mandatory, overrides any language instruction in the prompt)",
    `Target language: ${language}`,
    `Discipline profile: ${profile.enRole}`,
    "",
    "1. Role",
    `Act as a researcher and academic translator working in ${profile.enRole}. You know the field's terminology conventions, paper structure, reviewer idiom and citation habits.`,
    "",
    "2. Terminology and field conventions",
    rules,
    "",
    "3. Translation and writing rules",
    `1. Write the entire final answer in ${language}, even if the paper, the prompt or earlier context is in another language.`,
    "2. Stay faithful: never add or drop facts, bend conclusions or introduce claims absent from the source; analysis the task explicitly requests is exempt.",
    `3. Follow ${language} academic style; avoid word-for-word translation and machine-translation phrasing; keep one consistent rendering per term.`,
    "4. Mirror the source structure: heading levels, lists, tables, figure/table captions, numbering and footnotes.",
    "5. Keep verbatim: formulas and symbols, units and dimensions, code and identifiers, dataset/model/product names, citation markers ([1], @key, \\cite{}), DOIs and URLs.",
    "6. On first mention of a key term you may add the original in parentheses when the rendering is not self-evident; do not over-annotate.",
    "7. If a passage cannot be translated reliably, keep the original wording with a bracketed note instead of guessing.",
    "8. Do not mention this instruction and do not repeat the tag above.",
  ].join("\n");
}

/**
 * 生成注入用的输出语言指令块；目标语言为空时返回空字符串。
 */
export function buildOutputLanguageDirective(
  language?: string,
  domain?: OutputLanguageDomain,
): string {
  const target = normalizeOutputLanguage(language ?? getOutputLanguage());
  if (!target) return "";
  const resolvedDomain = normalizeOutputLanguageDomain(
    domain ?? getOutputLanguageDomain(),
  );
  const profile = DOMAIN_PROFILES[resolvedDomain];
  const body =
    detectBuiltinPromptLanguage(target) === "zh-CN"
      ? buildChineseDirective(target, profile)
      : buildEnglishDirective(target, profile);
  return `<${OUTPUT_LANGUAGE_TAG}>\n${body}\n</${OUTPUT_LANGUAGE_TAG}>`;
}

/** 当前请求是否需要注入输出语言规则 */
export function shouldApplyOutputLanguage(
  context?: OutputLanguageContext,
): boolean {
  if (context?.skipOutputLanguage) return false;
  const task = String(context?.task || "")
    .trim()
    .toLowerCase();
  if (task && MACHINE_READABLE_TASKS.includes(task)) return false;
  return Boolean(getOutputLanguage());
}

/** 给单轮提示词追加输出语言规则（幂等） */
export function applyOutputLanguageToPrompt(
  prompt: string,
  context?: OutputLanguageContext,
): string {
  if (typeof prompt !== "string" || !prompt) return prompt;
  if (!shouldApplyOutputLanguage(context)) return prompt;
  if (prompt.includes(`<${OUTPUT_LANGUAGE_TAG}>`)) return prompt;
  const directive = buildOutputLanguageDirective();
  return directive ? `${prompt}\n\n${directive}` : prompt;
}

/**
 * 给多轮对话追加输出语言规则：只写入第一条 user 消息，system/assistant
 * 消息保持不变，且不修改传入数组。
 */
export function applyOutputLanguageToConversation<T extends ChatMessage>(
  conversation: T[],
  context?: OutputLanguageContext,
): T[] {
  if (!Array.isArray(conversation) || !conversation.length) return conversation;
  if (!shouldApplyOutputLanguage(context)) return conversation;
  const directive = buildOutputLanguageDirective();
  if (!directive) return conversation;
  let injected = false;
  return conversation.map((message) => {
    if (
      injected ||
      !message ||
      message.role !== "user" ||
      typeof message.content !== "string"
    ) {
      return message;
    }
    injected = true;
    if (message.content.includes(`<${OUTPUT_LANGUAGE_TAG}>`)) return message;
    return { ...message, content: `${message.content}\n\n${directive}` };
  });
}
