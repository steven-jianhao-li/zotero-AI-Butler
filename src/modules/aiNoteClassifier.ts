export type NoteTag = { tag: string };

const SUMMARY_NOTE_TAG = "AI-Generated";
const TABLE_NOTE_TAG = "AI-Table";
const CHAT_NOTE_TAG = "AI-Butler-Chat";
const MINDMAP_NOTE_TAG = "AI-Mindmap";
const IMAGE_NOTE_TAGS = ["AI-Image-Summary", "AI-ImageSummary"];

const AI_BUTLER_SUMMARY_HEADING_RE = /<h2>\s*AI\s*管家\s*-\s*(?!后续追问)/;
const AI_BUTLER_CHAT_HEADING_RE =
  /<h2>\s*AI\s*管家\s*-\s*后续追问(?:\s*-|\s*笔记|[\s<])/;
const AI_BUTLER_MINDMAP_HEADING_RE = /AI\s*管家思维导图\s*-/;
const AI_BUTLER_IMAGE_HEADING_RE = /AI\s*管家一图总结\s*-/;
const AI_BUTLER_TABLE_HEADING_RE = /AI\s*管家.*(?:填表|表格)/;
const AI_BUTLER_REVIEW_HEADING_RE = /AI\s*管家.*(?:文献综述|综述)/;

export type AiButlerNoteType =
  | "summary"
  | "imageSummary"
  | "mindmap"
  | "tableFill"
  | "chat"
  | "review";

export function hasNoteTag(tags: NoteTag[], tag: string): boolean {
  return tags.some((t) => t.tag === tag);
}

export function isFollowUpChatNote(tags: NoteTag[], noteHtml: string): boolean {
  const hasSummaryTag = hasNoteTag(tags, SUMMARY_NOTE_TAG);
  return (
    hasNoteTag(tags, CHAT_NOTE_TAG) ||
    (!hasSummaryTag && AI_BUTLER_CHAT_HEADING_RE.test(noteHtml))
  );
}

export function isRegularSummaryNote(
  tags: NoteTag[],
  noteHtml: string,
): boolean {
  const isTableNote = hasNoteTag(tags, TABLE_NOTE_TAG);
  const isMindmapNote =
    hasNoteTag(tags, MINDMAP_NOTE_TAG) ||
    AI_BUTLER_MINDMAP_HEADING_RE.test(noteHtml);
  const isImageNote =
    IMAGE_NOTE_TAGS.some((tag) => hasNoteTag(tags, tag)) ||
    AI_BUTLER_IMAGE_HEADING_RE.test(noteHtml);
  const isReviewNote =
    hasNoteTag(tags, "AI-Review") || AI_BUTLER_REVIEW_HEADING_RE.test(noteHtml);

  if (
    isTableNote ||
    isMindmapNote ||
    isImageNote ||
    isReviewNote ||
    isFollowUpChatNote(tags, noteHtml)
  ) {
    return false;
  }

  return (
    hasNoteTag(tags, SUMMARY_NOTE_TAG) ||
    AI_BUTLER_SUMMARY_HEADING_RE.test(noteHtml)
  );
}

export function classifyAiButlerNote(
  tags: NoteTag[],
  noteHtml: string,
): AiButlerNoteType | null {
  if (isFollowUpChatNote(tags, noteHtml)) {
    return "chat";
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
