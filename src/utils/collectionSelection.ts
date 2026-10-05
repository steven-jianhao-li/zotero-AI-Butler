export function getSelectedCollection(
  zoteroPane: any = Zotero.getActiveZoteroPane?.(),
): Zotero.Collection | null {
  if (!zoteroPane) return null;

  if (typeof zoteroPane.getSelectedCollections === "function") {
    const collections = zoteroPane.getSelectedCollections();
    const collection = Array.isArray(collections)
      ? collections[0]
      : collections;

    const id =
      typeof collection === "number"
        ? collection
        : typeof (collection as any)?.id === "number"
          ? (collection as any).id
          : null;

    return typeof id === "number"
      ? (Zotero.Collections.get(id) as Zotero.Collection | false) || null
      : null;
  }

  if (typeof zoteroPane.getSelectedCollection === "function") {
    return (
      (zoteroPane.getSelectedCollection() as
        Zotero.Collection | false | null) || null
    );
  }

  return null;
}
