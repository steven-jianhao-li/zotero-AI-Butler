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
  it("maps scanner targets to localized labels and separate task types", function () {
    const globalAddon = (globalThis as any).addon || { data: {} };
    (globalThis as any).addon = globalAddon;
    const previousLocale = globalAddon.data?.locale;
    globalAddon.data = globalAddon.data || {};

    const withMessages = <T>(
      messages: Record<string, string>,
      run: () => T,
    ): T => {
      globalAddon.data.locale = {
        current: {
          formatMessagesSync(requests: Array<{ id: string }>) {
            return requests.map(({ id }) => {
              const key = Object.keys(messages).find(
                (candidate) => id === candidate || id.endsWith(`-${candidate}`),
              );
              return { value: key ? messages[key] : undefined };
            });
          },
        },
      };
      try {
        return run();
      } finally {
        globalAddon.data.locale = previousLocale;
      }
    };

    withMessages(
      {
        "library-scanner-target-summary": "AI 总结",
        "library-scanner-target-deep-read": "AI 精读",
      },
      () => {
        expect(getLibraryScannerTargetLabel("summary")).to.equal("AI 总结");
        expect(getLibraryScannerTargetLabel("deepRead")).to.equal("AI 精读");
      },
    );

    withMessages(
      {
        "library-scanner-target-summary": "AI Summary",
        "library-scanner-target-deep-read": "AI Deep Reading",
      },
      () => {
        expect(getLibraryScannerTargetLabel("summary")).to.equal("AI Summary");
        expect(getLibraryScannerTargetLabel("deepRead")).to.equal(
          "AI Deep Reading",
        );
      },
    );

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
