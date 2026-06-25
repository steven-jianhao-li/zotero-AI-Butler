let installed = false;

export async function withZoteroBrowserGlobals<T>(
  runner: () => Promise<T>,
): Promise<T> {
  installZoteroBrowserGlobals();
  return runner();
}

function installZoteroBrowserGlobals(): void {
  if (installed) return;
  installed = true;

  const target = globalThis as any;
  const win = Zotero.getMainWindow() as any;
  const doc = win?.document;

  defineMissingGlobal(target, "global", target);
  defineMissingGlobal(target, "window", win);
  defineMissingGlobal(target, "self", win);
  defineMissingGlobal(target, "document", doc);
  defineMissingGlobal(target, "navigator", win?.navigator);
  defineMissingGlobal(target, "location", win?.location);
  defineMissingGlobal(target, "XMLHttpRequest", win?.XMLHttpRequest);
  defineMissingGlobal(target, "DOMParser", win?.DOMParser);
  defineMissingGlobal(target, "Node", win?.Node);
  defineMissingGlobal(target, "Element", win?.Element);
  defineMissingGlobal(target, "HTMLElement", win?.HTMLElement);
  defineMissingGlobal(target, "Blob", win?.Blob);
  defineMissingGlobal(target, "FileReader", win?.FileReader);
  defineMissingGlobal(target, "URL", win?.URL);
  defineMissingGlobal(target, "atob", win?.atob?.bind(win));
  defineMissingGlobal(target, "btoa", win?.btoa?.bind(win));
  defineMissingGlobal(
    target,
    "setImmediate",
    (callback: (...args: unknown[]) => void, ...args: unknown[]) =>
      setTimeout(() => callback(...args), 0),
  );
  defineMissingGlobal(target, "clearImmediate", (id: number) =>
    clearTimeout(id),
  );
}

function defineMissingGlobal(target: any, key: string, value: unknown): void {
  if (value === undefined || value === null || target[key] !== undefined)
    return;
  try {
    target[key] = value;
  } catch {
    try {
      Object.defineProperty(target, key, {
        configurable: true,
        writable: true,
        value,
      });
    } catch (error) {
      ztoolkit.log(
        `[AI-Butler][NoteExport] 注入浏览器全局对象失败: ${key}`,
        error,
      );
    }
  }
}
