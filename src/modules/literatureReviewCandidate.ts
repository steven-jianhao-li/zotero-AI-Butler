type LiteratureReviewCandidateMethods = {
  isRegularItem?: () => boolean;
  isNote?: () => boolean;
  isAttachment?: () => boolean;
};

export function isLiteratureReviewCandidateItem(item: Zotero.Item): boolean {
  const candidate = item as LiteratureReviewCandidateMethods;
  const isRegularItem = candidate.isRegularItem;
  if (typeof isRegularItem === "function") {
    return Boolean(isRegularItem.call(item));
  }

  const isNote = candidate.isNote;
  if (typeof isNote === "function" && isNote.call(item)) {
    return false;
  }

  const isAttachment = candidate.isAttachment;
  if (typeof isAttachment === "function" && isAttachment.call(item)) {
    return false;
  }

  return true;
}
