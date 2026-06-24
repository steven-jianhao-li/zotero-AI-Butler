export async function pickFolder(title: string): Promise<string | null> {
  const FilePicker = ChromeUtils.importESModule(
    "chrome://zotero/content/modules/filePicker.mjs",
  ).FilePicker;
  const fp = new FilePicker();
  fp.init(Zotero.getMainWindow(), title, fp.modeGetFolder);
  const result = await fp.show();

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
