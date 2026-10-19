import { isLegacyHost } from "../compatibility/host";

export async function pickFolder(
  title: string,
  ownerWindow?: Window | null,
): Promise<string | null> {
  const restoreWindow = ownerWindow || getMostRecentWindow();
  const FilePicker = !isLegacyHost()
    ? ChromeUtils.importESModule(
        "chrome://zotero/content/modules/filePicker.mjs",
      ).FilePicker
    : null;
  const fp = FilePicker
    ? new FilePicker()
    : (Components.classes as any)["@mozilla.org/filepicker;1"].createInstance(
        Components.interfaces.nsIFilePicker,
      );
  fp.init(Zotero.getMainWindow(), title, fp.modeGetFolder);

  try {
    const result = FilePicker
      ? await fp.show()
      : await new Promise<number>((resolve) => fp.open(resolve));

    if (result !== fp.returnOK && result !== fp.returnReplace) {
      return null;
    }

    const path = resolvePickerPath(fp.file);
    if (!path) {
      ztoolkit.log("[AI-Butler][FolderPicker] 未能从目录选择器读取路径", {
        result,
        file: fp.file,
      });
    }
    return path;
  } finally {
    restoreWindowFocus(restoreWindow);
  }
}

function getMostRecentWindow(): Window | null {
  try {
    const wm = Services.wm as unknown as {
      getMostRecentWindow?: (windowType?: string | null) => Window | null;
    };
    return wm.getMostRecentWindow?.(null) || Zotero.getMainWindow() || null;
  } catch (_error) {
    return Zotero.getMainWindow() || null;
  }
}

function restoreWindowFocus(win: Window | null): void {
  if (!win || win.closed) return;

  const focus = () => {
    try {
      win.focus();
    } catch (error) {
      ztoolkit.log("[AI-Butler][FolderPicker] 恢复窗口焦点失败:", error);
    }
  };

  focus();
  // Windows 原生文件选择器关闭后，宿主窗口激活有时会被系统延后一拍。
  setTimeout(focus, 50);
  setTimeout(focus, 180);
}

function resolvePickerPath(file: unknown): string | null {
  if (!file) return null;
  if (typeof file === "string") return file.trim() || null;

  const candidate = file as {
    path?: unknown;
    mozFullPath?: unknown;
    nativePath?: unknown;
    file?: unknown;
  };

  for (const value of [
    candidate.path,
    candidate.mozFullPath,
    candidate.nativePath,
  ]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  if (candidate.file && candidate.file !== file) {
    return resolvePickerPath(candidate.file);
  }

  return null;
}
