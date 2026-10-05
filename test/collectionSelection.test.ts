import { expect } from "chai";
import { getSelectedCollection } from "../src/utils/collectionSelection";

describe("collection selection compatibility", function () {
  let originalCollectionsGet: typeof Zotero.Collections.get;

  before(function () {
    originalCollectionsGet = Zotero.Collections.get;
  });

  afterEach(function () {
    Zotero.Collections.get = originalCollectionsGet;
  });

  function stubCollectionLookup(collection: Zotero.Collection): void {
    Zotero.Collections.get = ((id: number) =>
      id === collection.id
        ? collection
        : false) as typeof Zotero.Collections.get;
  }

  it("uses the Zotero 10 plural API and resolves collection objects", function () {
    const collection = { id: 42, name: "Selected" } as Zotero.Collection;
    let legacyCallCount = 0;
    stubCollectionLookup(collection);

    const result = getSelectedCollection({
      getSelectedCollections: () => [collection],
      getSelectedCollection: () => {
        legacyCallCount += 1;
        return false;
      },
    });

    expect(result).to.equal(collection);
    expect(legacyCallCount).to.equal(0);
  });

  it("resolves numeric IDs returned by the Zotero 10 API", function () {
    const collection = { id: 84, name: "Selected by ID" } as Zotero.Collection;
    stubCollectionLookup(collection);

    const result = getSelectedCollection({
      getSelectedCollections: () => [collection.id],
    });

    expect(result).to.equal(collection);
  });

  it("returns null for empty or invalid Zotero 10 selections", function () {
    Zotero.Collections.get = (() => false) as typeof Zotero.Collections.get;

    expect(
      getSelectedCollection({ getSelectedCollections: () => [] }),
    ).to.equal(null);
    expect(
      getSelectedCollection({ getSelectedCollections: () => [{ id: 999 }] }),
    ).to.equal(null);
  });

  it("falls back to the Zotero 7 singular API", function () {
    const collection = { id: 126, name: "Legacy" } as Zotero.Collection;

    expect(
      getSelectedCollection({ getSelectedCollection: () => collection }),
    ).to.equal(collection);
    expect(
      getSelectedCollection({ getSelectedCollection: () => false }),
    ).to.equal(null);
  });
});
