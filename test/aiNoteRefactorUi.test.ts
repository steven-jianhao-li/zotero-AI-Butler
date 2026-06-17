import { expect } from "chai";
import {
  getLibraryScannerTargetLabel,
  getLibraryScannerTaskType,
} from "../src/modules/views/LibraryScannerView";
import {
  getSidebarMetadataSelectionKey,
  getSidebarNoteCollapsedPrefKey,
  getSidebarNoteElementId,
  getSidebarNoteHeightPrefKey,
} from "../src/modules/ItemPaneSection";

describe("AI note refactor UI helpers", function () {
  it("maps scanner targets to separate labels and task types", function () {
    expect(getLibraryScannerTargetLabel("summary")).to.equal("AI 总结");
    expect(getLibraryScannerTargetLabel("deepRead")).to.equal("AI 精读");
    expect(getLibraryScannerTaskType("summary")).to.equal("summary");
    expect(getLibraryScannerTaskType("deepRead")).to.equal("deepRead");
  });

  it("keeps sidebar summary and deep-read element IDs separate", function () {
    expect(
      getSidebarNoteElementId("ai-butler-note-content", "summary"),
    ).to.equal("ai-butler-note-content");
    expect(
      getSidebarNoteElementId("ai-butler-note-content", "deepRead"),
    ).to.equal("ai-butler-note-content-deepRead");
  });

  it("keeps sidebar persisted state keys separate with summary fallback keys", function () {
    expect(getSidebarNoteHeightPrefKey("summary")).to.equal(
      "sidebarNoteHeight",
    );
    expect(getSidebarNoteHeightPrefKey("deepRead")).to.equal(
      "sidebarDeepReadHeight",
    );
    expect(getSidebarNoteCollapsedPrefKey("summary")).to.equal(
      "sidebarNoteCollapsed",
    );
    expect(getSidebarNoteCollapsedPrefKey("deepRead")).to.equal(
      "sidebarDeepReadCollapsed",
    );
    expect(getSidebarMetadataSelectionKey(1, 2, "summary")).to.equal(
      "summary:1:2",
    );
    expect(getSidebarMetadataSelectionKey(1, 2, "deepRead")).to.equal(
      "deepRead:1:2",
    );
  });
});
