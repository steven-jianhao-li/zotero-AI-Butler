import { markdownToZoteroNoteHtml, escapeHtml } from "./noteMarkdown";
import {
  DEFAULT_DEEP_READ_CHAPTER_LIMIT,
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

export const DEEP_READ_SLOT_PREFIX = "zab:slot";

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

  return { chapters, slots, sequentialSlots, independentSlots };
}

export function buildDeepReadSkeletonHtml(
  itemTitle: string,
  template: MultiRoundPromptTemplate,
  planned: PlannedDeepRead,
): string {
  const parts: string[] = [
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
      ? `${headingHtml}${markdownToZoteroNoteHtml(markdown)}`
      : `${headingHtml}<p>❌ ${escapeHtml(markdown)}</p>`;
  return replaceDeepReadSlotHtml(noteHtml, slotId, htmlContent, status);
}

function shouldPrependSlotHeading(markdown: string, slotTitle?: string): boolean {
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
    `<!-- ${DEEP_READ_SLOT_PREFIX}:${slotId}:${status} -->\n${innerHtml}\n<!-- ${DEEP_READ_SLOT_PREFIX}:${slotId}:end -->`,
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

export function hasDeepReadV2Slots(noteHtml: string): boolean {
  return noteHtml.includes(`<!-- ${DEEP_READ_SLOT_PREFIX}:`);
}

export function hasRunnableDeepReadSlots(noteHtml: string): boolean {
  return /<!-- zab:slot:[^:]+:(?:pending|running|error) -->/.test(noteHtml);
}

function createSequentialSlots(
  phase: MultiRoundSequentialDynamicPhase,
  chapters: ChapterInfo[],
): DeepReadSlot[] {
  const maxChapters = phase.maxChapters || DEFAULT_DEEP_READ_CHAPTER_LIMIT;
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
    title: prompt.title,
    prompt: prompt.prompt,
    phaseId: phase.id,
    phaseTitle: phase.title,
    phaseType: phase.type,
    status: "pending",
  };
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
