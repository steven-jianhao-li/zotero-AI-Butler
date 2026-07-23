export type NoteTag = { tag: string };

export const LEGACY_SUMMARY_NOTE_TAG = "AI-Generated";
export const SUMMARY_NOTE_TAG = "AI-Summary";
export const DEEP_READ_NOTE_TAG = "AI-DeepRead";
const TABLE_NOTE_TAG = "AI-Table";
const CHAT_NOTE_TAG = "AI-Butler-Chat";
const MINDMAP_NOTE_TAG = "AI-Mindmap";
const IMAGE_NOTE_TAGS = ["AI-Image-Summary", "AI-ImageSummary"];

const AI_SUMMARY_HEADING_RE =
  /<h[12]>\s*AI\s*(?:\u603b\u7ed3|\u7ba1\u5bb6\s*-\s*(?!\u540e\u7eed\u8ffd\u95ee))/;
const AI_BUTLER_DEEP_READ_HEADING_RE =
  /<h[12]>\s*AI\s*(?:\u7cbe\u8bfb|\u7ba1\u5bb6\s*-\s*\u7cbe\u8bfb)\s*-/;
const DEEP_READ_SLOT_MARKER_RE =
  /<!--\s*zab:(?:slot|deep-read-plan):[\s\S]*?-->/i;
const AI_BUTLER_CHAT_HEADING_RE =
  /<h2>\s*AI\s*管家\s*-\s*后续追问(?:\s*-|\s*笔记|[\s<])/;
const AI_BUTLER_MINDMAP_HEADING_RE = /AI\s*管家思维导图\s*-/;
const AI_BUTLER_IMAGE_HEADING_RE = /AI\s*管家一图总结\s*-/;
const AI_BUTLER_TABLE_HEADING_RE = /AI\s*管家.*(?:填表|表格)/;
const AI_BUTLER_REVIEW_HEADING_RE = /AI\s*管家.*(?:文献综述|综述)/;

export type AiButlerNoteType =
  | "summary"
  | "deepRead"
  | "imageSummary"
  | "mindmap"
  | "tableFill"
  | "chat"
  | "review";

export function hasNoteTag(tags: NoteTag[], tag: string): boolean {
  return tags.some((t) => t.tag === tag);
}

export function isFollowUpChatNote(tags: NoteTag[], noteHtml: string): boolean {
  const hasSummaryTag =
    hasNoteTag(tags, LEGACY_SUMMARY_NOTE_TAG) ||
    hasNoteTag(tags, SUMMARY_NOTE_TAG) ||
    hasNoteTag(tags, DEEP_READ_NOTE_TAG);
  return (
    hasNoteTag(tags, CHAT_NOTE_TAG) ||
    (!hasSummaryTag && AI_BUTLER_CHAT_HEADING_RE.test(noteHtml))
  );
}

export function isRegularSummaryNote(
  tags: NoteTag[],
  noteHtml: string,
): boolean {
  const isMisTaggedSummary = isMisTaggedDeepReadSummaryNote(tags, noteHtml);
  const isTableNote = hasNoteTag(tags, TABLE_NOTE_TAG);
  const isMindmapNote =
    hasNoteTag(tags, MINDMAP_NOTE_TAG) ||
    AI_BUTLER_MINDMAP_HEADING_RE.test(noteHtml);
  const isImageNote =
    IMAGE_NOTE_TAGS.some((tag) => hasNoteTag(tags, tag)) ||
    AI_BUTLER_IMAGE_HEADING_RE.test(noteHtml);
  const isReviewNote =
    hasNoteTag(tags, "AI-Review") || AI_BUTLER_REVIEW_HEADING_RE.test(noteHtml);
  const isDeepRead =
    !isMisTaggedSummary &&
    (hasNoteTag(tags, DEEP_READ_NOTE_TAG) ||
      AI_BUTLER_DEEP_READ_HEADING_RE.test(noteHtml));

  if (
    isDeepRead ||
    isTableNote ||
    isMindmapNote ||
    isImageNote ||
    isReviewNote ||
    isFollowUpChatNote(tags, noteHtml)
  ) {
    return false;
  }

  return (
    isMisTaggedSummary ||
    hasNoteTag(tags, SUMMARY_NOTE_TAG) ||
    hasNoteTag(tags, LEGACY_SUMMARY_NOTE_TAG) ||
    AI_SUMMARY_HEADING_RE.test(noteHtml)
  );
}

export function isDeepReadNote(tags: NoteTag[], noteHtml: string): boolean {
  if (isMisTaggedDeepReadSummaryNote(tags, noteHtml)) {
    return false;
  }
  return (
    hasNoteTag(tags, DEEP_READ_NOTE_TAG) ||
    AI_BUTLER_DEEP_READ_HEADING_RE.test(noteHtml)
  );
}

export function isMisTaggedDeepReadSummaryNote(
  tags: NoteTag[],
  noteHtml: string,
): boolean {
  return (
    hasNoteTag(tags, DEEP_READ_NOTE_TAG) &&
    AI_SUMMARY_HEADING_RE.test(noteHtml) &&
    !AI_BUTLER_DEEP_READ_HEADING_RE.test(noteHtml) &&
    !DEEP_READ_SLOT_MARKER_RE.test(noteHtml)
  );
}

export function isLegacySummaryNote(
  tags: NoteTag[],
  noteHtml: string,
): boolean {
  return (
    hasNoteTag(tags, LEGACY_SUMMARY_NOTE_TAG) &&
    !hasNoteTag(tags, SUMMARY_NOTE_TAG) &&
    !hasNoteTag(tags, DEEP_READ_NOTE_TAG) &&
    isRegularSummaryNote(tags, noteHtml)
  );
}

export function classifyAiButlerNote(
  tags: NoteTag[],
  noteHtml: string,
): AiButlerNoteType | null {
  if (isFollowUpChatNote(tags, noteHtml)) {
    return "chat";
  }
  if (isDeepReadNote(tags, noteHtml)) {
    return "deepRead";
  }
  if (isRegularSummaryNote(tags, noteHtml)) {
    return "summary";
  }
  if (
    IMAGE_NOTE_TAGS.some((tag) => hasNoteTag(tags, tag)) ||
    AI_BUTLER_IMAGE_HEADING_RE.test(noteHtml)
  ) {
    return "imageSummary";
  }
  if (
    hasNoteTag(tags, MINDMAP_NOTE_TAG) ||
    AI_BUTLER_MINDMAP_HEADING_RE.test(noteHtml)
  ) {
    return "mindmap";
  }
  if (
    hasNoteTag(tags, TABLE_NOTE_TAG) ||
    AI_BUTLER_TABLE_HEADING_RE.test(noteHtml)
  ) {
    return "tableFill";
  }
  if (
    hasNoteTag(tags, "AI-Review") ||
    AI_BUTLER_REVIEW_HEADING_RE.test(noteHtml)
  ) {
    return "review";
  }

  return null;
}
