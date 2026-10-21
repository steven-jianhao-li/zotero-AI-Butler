import { expect } from "chai";
import {
  agentCitationURL,
  openAgentCitation,
} from "../src/modules/views/agent/AgentMarkdown";

describe("Agent citation navigation", function () {
  const globals = globalThis as unknown as Record<string, unknown>;
  let original: unknown;
  let resolved: [number, string][];
  let selected: number[];
  let launched: string[];
  let focused: boolean;
  let unavailable: boolean;
  let deleted: boolean;
  let groupLibrary: number | false;
  let mainClosed: boolean;

  beforeEach(function () {
    original = globals.Zotero;
    resolved = [];
    selected = [];
    launched = [];
    focused = false;
    unavailable = deleted = mainClosed = false;
    groupLibrary = 9;
    globals.Zotero = {
      Libraries: { userLibraryID: 1 },
      Groups: {
        getLibraryIDFromGroupID: (id: number) =>
          id === 77 ? groupLibrary : false,
      },
      Items: {
        getByLibraryAndKeyAsync: async (libraryID: number, key: string) => {
          resolved.push([libraryID, key]);
          return unavailable
            ? false
            : { id: libraryID === 1 ? 101 : 202, deleted };
        },
      },
      getMainWindow: () => ({
        closed: mainClosed,
        focus: () => {
          focused = true;
        },
        ZoteroPane: {
          selectItem: async (id: number) => {
            selected.push(id);
            return true;
          },
        },
      }),
      launchURL: (url: string) => launched.push(url),
    };
  });

  afterEach(function () {
    globals.Zotero = original;
  });

  it("selects personal-library citations directly and focuses Zotero without launching a protocol", async function () {
    await openAgentCitation("zotero://select/library/items/AB12CD34");
    expect(resolved).to.deep.equal([[1, "AB12CD34"]]);
    expect(selected).to.deep.equal([101]);
    expect(focused).to.equal(true);
    expect(launched).to.deep.equal([]);
  });

  it("maps group IDs to local library IDs before resolving item keys", async function () {
    await openAgentCitation("zotero://select/groups/77/items/EF56GH78");
    expect(resolved).to.deep.equal([[9, "EF56GH78"]]);
    expect(selected).to.deep.equal([202]);
    expect(launched).to.deep.equal([]);
  });

  it("opens ordinary web citations through the external browser", async function () {
    await openAgentCitation("https://example.org/paper?a=1&amp;b=2");
    expect(launched).to.deep.equal(["https://example.org/paper?a=1&b=2"]);
    expect(selected).to.deep.equal([]);
  });

  it("reports missing, trashed or inaccessible items and missing windows instead of launching externally", async function () {
    for (const scenario of ["missing", "trash", "group", "window"]) {
      unavailable = scenario === "missing";
      deleted = scenario === "trash";
      groupLibrary = scenario === "group" ? false : 9;
      mainClosed = scenario === "window";
      let error: unknown;
      try {
        await openAgentCitation("zotero://select/groups/77/items/EF56GH78");
      } catch (failure) {
        error = failure;
      }
      expect(error).to.be.instanceOf(Error);
    }
    expect(selected).to.deep.equal([]);
    expect(launched).to.deep.equal([]);
  });

  it("keeps executable and malformed citation targets inert", async function () {
    for (const href of [
      "javascript:alert(1)",
      "data:text/html,x",
      "zotero://open-pdf/library/items/AB12CD34",
      "zotero://select/library/items/../../x",
      "https://example.org\\evil",
      "https://user:pass@example.org",
      "https://exam&#10;ple.org",
    ]) {
      expect(agentCitationURL(href)).to.equal(undefined);
      let error: unknown;
      try {
        await openAgentCitation(href);
      } catch (failure) {
        error = failure;
      }
      expect(error).to.be.instanceOf(Error);
    }
    expect(launched).to.deep.equal([]);
  });
});
