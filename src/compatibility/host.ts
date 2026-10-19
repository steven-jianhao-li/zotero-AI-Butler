// Bootstrap validates the version before any plugin integration is registered.
export function isLegacyHost(): boolean {
  return /^6(?:\.|$)/.test(Zotero.version);
}
