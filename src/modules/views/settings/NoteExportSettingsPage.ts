import {
  addWatchedCollection,
  getNoteExportConfig,
  removeWatchedCollection,
  setNoteExportConfig,
  type NoteExportConflictStrategy,
  type NoteExportFormats,
} from "../../noteExportConfig";
import { AutoNoteExportManager } from "../../autoNoteExportManager";
import { pickFolder } from "../../folderPicker";
import {
  createCheckbox,
  createFormGroup,
  createInput,
  createNotice,
  createSectionTitle,
  createSelect,
  createStyledButton,
} from "../ui/components";

export class NoteExportSettingsPage {
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  public render(): void {
    this.container.innerHTML = "";
    const doc = this.container.ownerDocument || Zotero.getMainWindow().document;
    const config = getNoteExportConfig();

    const title = doc.createElement("h2");
    title.textContent = "📤 自动导出";
    Object.assign(title.style, {
      color: "var(--ai-accent)",
      marginBottom: "20px",
      fontSize: "20px",
      borderBottom: "2px solid var(--ai-accent)",
      paddingBottom: "10px",
    });
    this.container.appendChild(title);

    const form = doc.createElement("div");
    Object.assign(form.style, {
      maxWidth: "920px",
      display: "grid",
      gap: "16px",
    });

    form.appendChild(
      createNotice(
        "自动导出会在监听分类中的论文同时拥有 AI 总结和 AI 精读后，将附件、DOCX 和 Markdown 导出到指定目录。",
        "info",
      ),
    );

    form.appendChild(createSectionTitle("基础设置"));
    form.appendChild(
      createFormGroup(
        "启用自动导出",
        createCheckbox("noteExportEnabled", config.enabled),
        "开启后，任务队列完成 AI 总结或 AI 精读时会自动检查是否需要导出。",
      ),
    );

    const pathInput = createInput(
      "noteExportRootPath",
      "text",
      config.rootPath,
      "请选择或输入导出根目录...",
    );
    pathInput.style.width = "100%";
    form.appendChild(
      createFormGroup(
        "导出根目录",
        pathInput,
        "导出结构为：根目录 / 分类路径 / 论文名 / 导出文件。",
      ),
    );

    const pathActions = doc.createElement("div");
    Object.assign(pathActions.style, {
      display: "flex",
      gap: "10px",
      flexWrap: "wrap",
    });
    const browseButton = createStyledButton("选择目录", "#2196f3", "medium");
    browseButton.addEventListener("click", async () => {
      try {
        const selected = await pickFolder("选择 AI 笔记导出目录");
        if (selected) (pathInput as HTMLInputElement).value = selected;
      } catch (error) {
        ztoolkit.log("[AI-Butler][NoteExport] 选择导出目录失败:", error);
        showToast("选择目录失败，请手动输入目录", "error");
      }
    });
    pathActions.appendChild(browseButton);
    form.appendChild(pathActions);

    form.appendChild(createSectionTitle("监听分类"));
    form.appendChild(
      this.renderWatchedCollections(config.watchedCollectionIds),
    );
    const collectionActions = doc.createElement("div");
    Object.assign(collectionActions.style, {
      display: "flex",
      gap: "10px",
      flexWrap: "wrap",
    });
    const addSelectedButton = createStyledButton(
      "添加当前选中分类",
      "#4caf50",
      "medium",
    );
    addSelectedButton.addEventListener("click", () => {
      const collection = Zotero.getActiveZoteroPane().getSelectedCollection();
      if (!collection) {
        showToast("请先在 Zotero 左侧选择一个分类", "warning");
        return;
      }
      addWatchedCollection(collection.id);
      this.render();
    });
    collectionActions.appendChild(addSelectedButton);
    form.appendChild(collectionActions);
    form.appendChild(
      createFormGroup(
        "包含子分类",
        createCheckbox(
          "noteExportIncludeSubcollections",
          config.includeSubcollections,
        ),
        "开启后，监听分类下的所有子分类也会触发自动导出。",
      ),
    );

    form.appendChild(createSectionTitle("导出内容"));
    for (const [key, label] of getFormatRows()) {
      form.appendChild(
        createFormGroup(
          label,
          createCheckbox(`noteExportFormat-${key}`, config.formats[key]),
        ),
      );
    }

    const strategySelect = createSelect(
      "noteExportConflictStrategy",
      [
        { value: "skip", label: "跳过已有文件" },
        { value: "overwrite", label: "覆盖已有文件" },
      ],
      config.conflictStrategy,
    );
    form.appendChild(
      createFormGroup(
        "已存在文件策略",
        strategySelect,
        "默认跳过，避免覆盖手动修改后的文件。",
      ),
    );
    form.appendChild(
      createFormGroup(
        "右键导出不再提醒目录",
        createCheckbox(
          "noteExportSuppressDirectoryPrompt",
          config.suppressDirectoryPrompt,
        ),
        "开启后，右键分类导出会优先使用这里保存的目录。",
      ),
    );

    const actions = doc.createElement("div");
    Object.assign(actions.style, {
      display: "flex",
      gap: "12px",
      marginTop: "8px",
    });
    const saveButton = createStyledButton("保存设置", "#4caf50", "medium");
    saveButton.addEventListener("click", () => {
      setNoteExportConfig({
        enabled: getCheckboxValue("noteExportEnabled", false),
        rootPath: (pathInput as HTMLInputElement).value,
        includeSubcollections: getCheckboxValue(
          "noteExportIncludeSubcollections",
          true,
        ),
        formats: readFormats(),
        conflictStrategy: getSelectValue(
          strategySelect,
          "skip",
        ) as NoteExportConflictStrategy,
        suppressDirectoryPrompt: getCheckboxValue(
          "noteExportSuppressDirectoryPrompt",
          false,
        ),
      });
      AutoNoteExportManager.getInstance().reload();
      showToast("自动导出设置已保存", "success");
      this.render();
    });
    actions.appendChild(saveButton);
    form.appendChild(actions);

    this.container.appendChild(form);
  }

  private renderWatchedCollections(collectionIds: number[]): HTMLElement {
    const doc = this.container.ownerDocument || Zotero.getMainWindow().document;
    const list = doc.createElement("div");
    Object.assign(list.style, { display: "grid", gap: "8px" });

    if (!collectionIds.length) {
      list.appendChild(createNotice("尚未添加监听分类。", "warn"));
      return list;
    }

    for (const collectionId of collectionIds) {
      const collection = Zotero.Collections.get(
        collectionId,
      ) as Zotero.Collection;
      const row = doc.createElement("div");
      Object.assign(row.style, {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "12px",
        padding: "10px 12px",
        border: "1px solid var(--ai-border)",
        borderRadius: "8px",
        background: "var(--ai-card-bg)",
      });
      const label = doc.createElement("span");
      label.textContent = collection
        ? getCollectionPathLabel(collection)
        : `分类 ${collectionId}（已不存在）`;
      row.appendChild(label);
      const removeButton = createStyledButton("移除", "#f44336", "small");
      removeButton.addEventListener("click", () => {
        removeWatchedCollection(collectionId);
        this.render();
      });
      row.appendChild(removeButton);
      list.appendChild(row);
    }

    return list;
  }
}

function getFormatRows(): Array<[keyof NoteExportFormats, string]> {
  return [
    ["summaryDocx", "AI 总结 DOCX"],
    ["deepReadDocx", "AI 精读 DOCX"],
    ["summaryMd", "AI 总结 Markdown"],
    ["deepReadMd", "AI 精读 Markdown"],
  ];
}

function readFormats(): NoteExportFormats {
  return {
    summaryDocx: getCheckboxValue("noteExportFormat-summaryDocx", true),
    deepReadDocx: getCheckboxValue("noteExportFormat-deepReadDocx", true),
    summaryMd: getCheckboxValue("noteExportFormat-summaryMd", true),
    deepReadMd: getCheckboxValue("noteExportFormat-deepReadMd", true),
  };
}

function getCheckboxValue(id: string, fallback: boolean): boolean {
  const checkbox = Zotero.getMainWindow().document.querySelector(
    `#setting-${id} input[type="checkbox"], #setting-${id}`,
  ) as HTMLInputElement | null;
  return typeof checkbox?.checked === "boolean" ? checkbox.checked : fallback;
}

function getSelectValue(select: HTMLElement, fallback: string): string {
  return (
    (select as any).getValue?.() ||
    select.getAttribute("data-value") ||
    fallback
  );
}

function getCollectionPathLabel(collection: Zotero.Collection): string {
  const names: string[] = [];
  let current: Zotero.Collection | false | undefined = collection;
  while (current) {
    names.unshift((current as any).name || `collection-${current.id}`);
    const parentId: number | undefined = (current as any).parentID;
    current = parentId ? (Zotero.Collections.get(parentId) as any) : false;
  }
  return names.join(" / ");
}

function showToast(
  message: string,
  type: "success" | "warning" | "error",
): void {
  new ztoolkit.ProgressWindow("AI 笔记导出", {
    closeOnClick: true,
    closeTime: 3000,
  })
    .createLine({ text: message, type })
    .show();
}
