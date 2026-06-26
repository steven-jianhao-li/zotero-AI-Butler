import { markdownToZoteroNoteHtml, escapeHtml } from "./noteMarkdown";
import {
  generateChapterPrompts,
  type ChapterInfo,
  type DeepReadSlotStatus,
  type MultiRoundIndependentPhase,
  type MultiRoundPromptItem,
  type MultiRoundPromptPhase,
  type MultiRoundPromptTemplate,
  type MultiRoundSequentialDynamicPhase,
} from "../utils/prompts";

export type DeepReadSlot = {
  id: string;
  title: string;
  prompt: string;
  phaseId: string;
  phaseTitle: string;
  phaseType: "sequential_dynamic" | "independent";
  status: DeepReadSlotStatus;
};

export type PlannedDeepRead = {
  chapters: ChapterInfo[];
  slots: DeepReadSlot[];
  sequentialSlots: DeepReadSlot[];
  independentSlots: DeepReadSlot[];
};

export type DeepReadPlanMetadata = {
  templateId: string;
  chapters: ChapterInfo[];
  template?: MultiRoundPromptTemplate;
};

export const DEEP_READ_SLOT_PREFIX = "zab:slot";
export const DEEP_READ_PLAN_META_PREFIX = "zab:deep-read-plan";

export function planDeepReadSlots(
  template: MultiRoundPromptTemplate,
  chapters: ChapterInfo[],
): PlannedDeepRead {
  const slots: DeepReadSlot[] = [];
  const sequentialSlots: DeepReadSlot[] = [];
  const independentSlots: DeepReadSlot[] = [];

  for (const phase of template.phases) {
    if (phase.type === "sequential_dynamic") {
      const phaseSlots = createSequentialSlots(phase, chapters);
      slots.push(...phaseSlots);
      sequentialSlots.push(...phaseSlots);
      continue;
    }

    const phaseSlots = createIndependentSlots(phase);
    slots.push(...phaseSlots);
    independentSlots.push(...phaseSlots);
  }

  validatePlannedSlotIds(slots);
  return { chapters, slots, sequentialSlots, independentSlots };
}

export function buildDeepReadSkeletonHtml(
  itemTitle: string,
  template: MultiRoundPromptTemplate,
  planned: PlannedDeepRead,
): string {
  const parts: string[] = [
    buildPlanMetadataComment(template, planned.chapters),
    `<h1>AI 精读 - ${escapeHtml(truncateTitle(itemTitle))}</h1>`,
    `<h2>章节解析</h2>`,
    ...buildChapterListHtml(planned.chapters),
  ];

  for (const phase of template.phases) {
    const phaseSlots = planned.slots.filter(
      (slot) => slot.phaseId === phase.id,
    );
    if (!phaseSlots.length) continue;
    for (let index = 0; index < phaseSlots.length; index++) {
      const slot = phaseSlots[index];
      parts.push(buildPendingSlotHtml(slot));
      if (index < phaseSlots.length - 1) {
        parts.push("<hr/>");
      }
    }
  }

  return parts.join("\n");
}

export function ensureDeepReadSlotsHtml(
  noteHtml: string,
  planned: PlannedDeepRead,
): string {
  const missingSlots = planned.slots.filter(
    (slot) => getDeepReadSlotStatus(noteHtml, slot.id) === null,
  );
  if (!missingSlots.length) return noteHtml;

  return [
    noteHtml,
    "<hr/>",
    ...missingSlots.flatMap((slot, index) => {
      const parts = [buildPendingSlotHtml(slot)];
      if (index < missingSlots.length - 1) parts.push("<hr/>");
      return parts;
    }),
  ].join("\n");
}

export function migrateLegacyDeepReadHtmlToSlots(
  noteHtml: string,
  itemTitle: string,
  template: MultiRoundPromptTemplate,
  planned: PlannedDeepRead,
): string {
  let migratedHtml = buildDeepReadSkeletonHtml(itemTitle, template, planned);
  const matchedSlotIds = new Set<string>();

  for (const section of extractHeadingSections(noteHtml)) {
    const slot = planned.slots.find(
      (candidate) =>
        !matchedSlotIds.has(candidate.id) &&
        getComparableSlotTitles(candidate).some((title) =>
          titlesMatch(section.title, title),
        ),
    );
    if (!slot || !hasGeneratedSectionContent(section.html)) continue;

    migratedHtml = replaceDeepReadSlotHtml(
      migratedHtml,
      slot.id,
      stripStrikethroughHtml(section.html),
      "done",
    );
    matchedSlotIds.add(slot.id);
  }

  return migratedHtml;
}

export function fillDeepReadSlot(
  noteHtml: string,
  slotId: string,
  markdown: string,
  slotTitle?: string,
  status: "done" | "error" = "done",
): string {
  const headingHtml = shouldPrependSlotHeading(markdown, slotTitle)
    ? `<h2>${escapeHtml(slotTitle || "")}</h2>\n`
    : "";
  const htmlContent =
    status === "done"
      ? `${headingHtml}${markdownToDeepReadSlotHtml(markdown)}`
      : `${headingHtml}<p>❌ ${escapeHtml(markdown)}</p>`;
  return replaceDeepReadSlotHtml(noteHtml, slotId, htmlContent, status);
}

function markdownToDeepReadSlotHtml(markdown: string): string {
  const normalizedMarkdown = normalizeDeepReadSlotMarkdown(
    neutralizeStrikethroughMarkdown(markdown),
  );
  const html = markdownToZoteroNoteHtml(normalizedMarkdown);
  return normalizeDeepReadSlotHtml(stripStrikethroughHtml(html));
}

function normalizeDeepReadSlotMarkdown(markdown: string): string {
  return markdown.replace(
    /^(#{1,6})\s+(.+?)\s*#*\s*$/gm,
    (match, markers: string, rawTitle: string) => {
      const title = rawTitle.trim();
      if (!title) return match;
      if (markers.length === 1 && looksLikeProseHeading(title)) {
        return title;
      }
      const level = Math.max(2, markers.length);
      return `${"#".repeat(level)} ${title}`;
    },
  );
}

function normalizeDeepReadSlotHtml(html: string): string {
  return html.replace(/<h1>([\s\S]*?)<\/h1>/g, (_match, title: string) => {
    const plainTitle = stripHtml(title).trim();
    if (looksLikeProseHeading(plainTitle)) {
      return `<p>${title}</p>`;
    }
    return `<h2>${title}</h2>`;
  });
}

function neutralizeStrikethroughMarkdown(markdown: string): string {
  return markdown.replace(/~~/g, "\\~\\~");
}

function stripStrikethroughHtml(html: string): string {
  return html
    .replace(/<\/?(?:del|s|strike)\b[^>]*>/gi, "")
    .replace(/\sstyle="[^"]*text-decoration\s*:\s*line-through;?[^"]*"/gi, "")
    .replace(/\sstyle='[^']*text-decoration\s*:\s*line-through;?[^']*'/gi, "");
}

function looksLikeProseHeading(text: string): boolean {
  const normalized = text.replace(/\s+/g, "").trim();
  return normalized.length >= 60 && /[。！？.!?]$/.test(normalized);
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

type HeadingSection = {
  title: string;
  html: string;
};

function extractHeadingSections(noteHtml: string): HeadingSection[] {
  const headingPattern = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  const headings: Array<{ index: number; title: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = headingPattern.exec(noteHtml))) {
    const title = decodeBasicHtmlEntities(stripHtml(match[2])).trim();
    if (!title) continue;
    headings.push({ index: match.index, title });
  }

  return headings.map((heading, index) => ({
    title: heading.title,
    html: noteHtml.slice(
      heading.index,
      headings[index + 1]?.index ?? noteHtml.length,
    ),
  }));
}

function titlesMatch(left: string, right: string): boolean {
  const normalize = (value: string) =>
    value
      .replace(/^第\s*\d+\s*章(?:精读)?[：:、\s-]*/i, "")
      .replace(/^(?:AI\s*)?精读[：:、\s-]*/i, "")
      .replace(/[\s\p{P}\p{S}]+/gu, "")
      .toLowerCase();
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  return (
    !!normalizedLeft &&
    !!normalizedRight &&
    (normalizedLeft === normalizedRight ||
      normalizedLeft.includes(normalizedRight) ||
      normalizedRight.includes(normalizedLeft))
  );
}

function getComparableSlotTitles(slot: DeepReadSlot): string[] {
  const titles = [slot.title];
  const promptHeading = slot.prompt.match(/^\s*#{1,6}\s+(.+?)\s*$/m)?.[1];
  if (promptHeading) titles.push(promptHeading);
  const quotedHeading = slot.prompt.match(/#{1,6}\s+([^」\n\r]+)/)?.[1];
  if (quotedHeading) titles.push(quotedHeading);
  return titles;
}

function hasGeneratedSectionContent(html: string): boolean {
  const text = decodeBasicHtmlEntities(stripHtml(html))
    .replace(/\s+/g, "")
    .trim();
  return (
    text.length > 20 &&
    !/(?:等待生成|正在生成|已取消，重新运行AI精读时会从这里继续)/.test(text)
  );
}

function shouldPrependSlotHeading(
  markdown: string,
  slotTitle?: string,
): boolean {
  if (!slotTitle) return false;
  return !/^\s*#{1,2}\s+\S/m.test(markdown);
}

export function replaceDeepReadSlotHtml(
  noteHtml: string,
  slotId: string,
  innerHtml: string,
  status: DeepReadSlotStatus,
): string {
  const pattern = new RegExp(
    `<!-- ${DEEP_READ_SLOT_PREFIX}:${escapeRegExp(slotId)}:(?:pending|running|done|error) -->[\\s\\S]*?<!-- ${DEEP_READ_SLOT_PREFIX}:${escapeRegExp(slotId)}:end -->`,
  );
  if (!pattern.test(noteHtml)) {
    return noteHtml;
  }
  return noteHtml.replace(
    pattern,
    `<!-- ${DEEP_READ_SLOT_PREFIX}:${slotId}:${status} -->\n${stripStrikethroughHtml(innerHtml)}\n<!-- ${DEEP_READ_SLOT_PREFIX}:${slotId}:end -->`,
  );
}

export function getDeepReadSlotStatus(
  noteHtml: string,
  slotId: string,
): DeepReadSlotStatus | null {
  const match = noteHtml.match(
    new RegExp(
      `<!-- ${DEEP_READ_SLOT_PREFIX}:${escapeRegExp(slotId)}:(pending|running|done|error) -->`,
    ),
  );
  return (match?.[1] as DeepReadSlotStatus | undefined) || null;
}

export function shouldRunDeepReadSlot(
  noteHtml: string,
  slotId: string,
): boolean {
  const status = getDeepReadSlotStatus(noteHtml, slotId);
  return status === "pending" || status === "running" || status === "error";
}

export function isDeepReadSlotDone(noteHtml: string, slotId: string): boolean {
  return getDeepReadSlotStatus(noteHtml, slotId) === "done";
}

export function hasDeepReadV2Slots(noteHtml: string): boolean {
  return noteHtml.includes(`<!-- ${DEEP_READ_SLOT_PREFIX}:`);
}

export function hasRunnableDeepReadSlots(noteHtml: string): boolean {
  return new RegExp(
    `<!--\\s*${escapeRegExp(DEEP_READ_SLOT_PREFIX)}:(?![^>]*:end\\s*-->)[\\s\\S]*?:(?:pending|running|error)\\s*-->`,
  ).test(noteHtml);
}

export function hasIncompleteDeepReadContent(noteHtml: string): boolean {
  if (hasRunnableDeepReadSlots(noteHtml)) return true;
  const textContent = decodeBasicHtmlEntities(stripHtml(noteHtml))
    .replace(/\s+/g, "")
    .trim();
  return /(?:等待生成|正在生成|已取消，重新运行AI精读时会从这里继续)/.test(
    textContent,
  );
}

export function markDeepReadSlotRunning(
  noteHtml: string,
  slotId: string,
  slotTitle?: string,
): string {
  return replaceDeepReadSlotHtml(
    noteHtml,
    slotId,
    `<h2>${escapeHtml(slotTitle || "")}</h2>\n<p>🔄 正在生成...</p>`,
    "running",
  );
}

export function resetRunningDeepReadSlots(noteHtml: string): string {
  return noteHtml.replace(
    /<!-- zab:slot:([^:]+):running -->[\s\S]*?<!-- zab:slot:\1:end -->/g,
    (_match, slotId: string) =>
      `<!-- ${DEEP_READ_SLOT_PREFIX}:${slotId}:pending -->\n<p>已取消，重新运行 AI 精读时会从这里继续。</p>\n<!-- ${DEEP_READ_SLOT_PREFIX}:${slotId}:end -->`,
  );
}

export function extractDeepReadPlanMetadata(
  noteHtml: string,
): DeepReadPlanMetadata | null {
  const match = noteHtml.match(
    new RegExp(`<!-- ${DEEP_READ_PLAN_META_PREFIX}:([\\s\\S]*?) -->`),
  );
  if (!match?.[1]) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(match[1]));
    if (!parsed || !Array.isArray(parsed.chapters)) return null;
    return {
      templateId:
        typeof parsed.templateId === "string" ? parsed.templateId : "",
      chapters: parsed.chapters,
      template: parsed.template,
    };
  } catch {
    return null;
  }
}

export function extractDeepReadChaptersFromHtml(
  noteHtml: string,
): ChapterInfo[] {
  const chapters: ChapterInfo[] = [];
  const seen = new Set<string>();
  const pattern = /第\s*(\d+)\s*章\s*[：:]\s*([^<\n\r]+)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(noteHtml))) {
    const index = Number(match[1]);
    const rawTitle = decodeBasicHtmlEntities(stripHtml(match[2])).trim();
    if (!Number.isInteger(index) || index <= 0 || !rawTitle) continue;

    const parsed = parseRenderedChapterTitle(rawTitle);
    const id = `ch${index}`;
    if (seen.has(id)) continue;
    seen.add(id);
    chapters.push({ id, ...parsed });
  }

  return chapters;
}

function parseRenderedChapterTitle(title: string): {
  title_zh: string;
  title_en: string;
} {
  const normalized = title.replace(/\s+/g, " ").trim();
  const pair = normalized.match(/^(.+?)（(.+?)）$/);
  if (pair) {
    return { title_zh: pair[1].trim(), title_en: pair[2].trim() };
  }

  const asciiPair = normalized.match(/^(.+?)\((.+?)\)$/);
  if (asciiPair) {
    return { title_zh: asciiPair[1].trim(), title_en: asciiPair[2].trim() };
  }

  return { title_zh: normalized, title_en: "" };
}

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function buildPlanMetadataComment(
  template: MultiRoundPromptTemplate,
  chapters: ChapterInfo[],
): string {
  return `<!-- ${DEEP_READ_PLAN_META_PREFIX}:${encodeURIComponent(
    JSON.stringify({ templateId: template.id, template, chapters }),
  )} -->`;
}

function validatePlannedSlotIds(slots: DeepReadSlot[]): void {
  const seen = new Set<string>();
  for (const slot of slots) {
    if (seen.has(slot.id)) {
      throw new Error(`精读模板 slot ID 重复: ${slot.id}`);
    }
    seen.add(slot.id);
  }
}

function createSequentialSlots(
  phase: MultiRoundSequentialDynamicPhase,
  chapters: ChapterInfo[],
): DeepReadSlot[] {
  const maxChapters = phase.maxChapters || chapters.length;
  const prompts = [
    ...phase.fixedPrompts,
    ...generateChapterPrompts(
      chapters,
      phase.chapterTemplate,
      phase.fixedPrompts.length,
      maxChapters,
    ),
  ].sort((left, right) => left.order - right.order);

  return prompts.map((prompt) => promptToSlot(prompt, phase));
}

function createIndependentSlots(
  phase: MultiRoundIndependentPhase,
): DeepReadSlot[] {
  return phase.prompts
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((prompt) => promptToSlot(prompt, phase));
}

function promptToSlot(
  prompt: MultiRoundPromptItem,
  phase: MultiRoundPromptPhase,
): DeepReadSlot {
  return {
    id: prompt.id,
    title: normalizeDeepReadPromptTitle(prompt.title),
    prompt: prompt.prompt,
    phaseId: phase.id,
    phaseTitle: phase.title,
    phaseType: phase.type,
    status: "pending",
  };
}

function normalizeDeepReadPromptTitle(title: string): string {
  return title.trim() === "\u7efc\u8ff0\u6458\u8981\u7cbe\u8bfb"
    ? "\u6587\u7ae0\u6574\u4f53\u901a\u8bfb"
    : title;
}

function buildPendingSlotHtml(slot: DeepReadSlot): string {
  return [
    `<!-- ${DEEP_READ_SLOT_PREFIX}:${slot.id}:pending -->`,
    `<h2>${escapeHtml(slot.title)}</h2>`,
    `<p>⏳ 等待生成...</p>`,
    `<!-- ${DEEP_READ_SLOT_PREFIX}:${slot.id}:end -->`,
  ].join("\n");
}

function buildChapterListHtml(chapters: ChapterInfo[]): string[] {
  if (!chapters.length) {
    return ["<p>未识别到章节结构。</p>"];
  }

  return chapters.map((chapter, index) => {
    const title = formatChapterTitle(chapter);
    return `<p>第${index + 1}章：${escapeHtml(title)}</p>`;
  });
}

function formatChapterTitle(chapter: ChapterInfo): string {
  const titleZh = chapter.title_zh.trim();
  const titleEn = chapter.title_en.trim();
  if (titleZh && titleEn && titleZh !== titleEn) {
    return `${titleZh}（${titleEn}）`;
  }
  return titleZh || titleEn || "未命名章节";
}

function truncateTitle(title: string): string {
  return title.length > 100 ? `${title.slice(0, 100)}...` : title;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
