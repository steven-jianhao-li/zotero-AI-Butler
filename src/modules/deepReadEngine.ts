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
    `<h2>AI 精读 - ${escapeHtml(truncateTitle(itemTitle))}</h2>`,
    `<p>AI \u7cbe\u8bfb\u5c06\u5148\u89e3\u6790\u7ae0\u8282\u7ed3\u6784\uff0c\u518d\u6309\u7ae0\u8282\u987a\u5e8f\u5199\u5165\u9010\u7ae0\u7cbe\u8bfb\u7ed3\u679c\uff0c\u5e76\u8865\u5145\u91cd\u70b9\u8ffd\u95ee\u3002</p>`,
  ];

  for (const phase of template.phases) {
    const phaseSlots = planned.slots.filter(
      (slot) => slot.phaseId === phase.id,
    );
    if (!phaseSlots.length) continue;
    parts.push(buildPhaseHeader(phase));
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
  status: "done" | "error" = "done",
): string {
  const htmlContent =
    status === "done"
      ? markdownToZoteroNoteHtml(markdown)
      : `<p>❌ ${escapeHtml(markdown)}</p>`;
  return replaceDeepReadSlotHtml(noteHtml, slotId, htmlContent, status);
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

function buildPhaseHeader(phase: MultiRoundPromptPhase): string {
  return [
    `<h2>${escapeHtml(phase.title)} <span title="${escapeHtml(phase.description)}">ⓘ</span></h2>`,
    phase.description ? `<p>${escapeHtml(phase.description)}</p>` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildPendingSlotHtml(slot: DeepReadSlot): string {
  return [
    `<!-- ${DEEP_READ_SLOT_PREFIX}:${slot.id}:pending -->`,
    `<h3>${escapeHtml(slot.title)}</h3>`,
    `<p>⏳ 等待生成...</p>`,
    `<!-- ${DEEP_READ_SLOT_PREFIX}:${slot.id}:end -->`,
  ].join("\n");
}

function truncateTitle(title: string): string {
  return title.length > 100 ? `${title.slice(0, 100)}...` : title;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
