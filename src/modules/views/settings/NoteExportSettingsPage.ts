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
  createInput,
  createSelect,
  createStyledButton,
} from "../ui/components";

export class NoteExportSettingsPage {
  private container: HTMLElement;
  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  public render(): void {
    this.container.innerHTML = "";
    const doc = this.container.ownerDocument || Zotero.getMainWindow().document;
    const config = getNoteExportConfig();

    const page = doc.createElement("div");
    page.className = "ai-note-export-page";
    Object.assign(page.style, {
      maxWidth: "980px",
      display: "grid",
      gap: "18px",
      color: "var(--ai-text)",
    });

    const hero = createPanel(
      doc,
      "linear-gradient(135deg, rgba(89, 192, 188, 0.16), rgba(255, 255, 255, 0.02))",
    );
    Object.assign(hero.style, {
      padding: "22px 24px",
      overflow: "hidden",
      position: "relative",
    });

    const heroGlow = doc.createElement("div");
    Object.assign(heroGlow.style, {
      position: "absolute",
      right: "-56px",
      top: "-70px",
      width: "190px",
      height: "190px",
      borderRadius: "999px",
      background:
        "radial-gradient(circle, rgba(89, 192, 188, 0.28), rgba(89, 192, 188, 0))",
      pointerEvents: "none",
    });
    hero.appendChild(heroGlow);

    const heroContent = doc.createElement("div");
    Object.assign(heroContent.style, {
      position: "relative",
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr) auto",
      gap: "18px",
      alignItems: "center",
    });

    const copy = doc.createElement("div");
    const eyebrow = doc.createElement("div");
    eyebrow.textContent = "AI Butler · Note Export";
    Object.assign(eyebrow.style, {
      color: "var(--ai-accent)",
      fontSize: "12px",
      fontWeight: "700",
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      marginBottom: "8px",
    });
    const title = doc.createElement("h2");
    title.textContent = "📤 笔记自动导出";
    Object.assign(title.style, {
      margin: "0 0 8px 0",
      fontSize: "24px",
      lineHeight: "1.2",
      color: "var(--ai-text)",
      border: "0",
      padding: "0",
    });
    const subtitle = doc.createElement("p");
    subtitle.textContent =
      "当监听分类中的论文已生成 AI 总结与 AI 精读后，自动整理附件、DOCX 与 Markdown 到指定目录。";
    Object.assign(subtitle.style, {
      margin: "0",
      maxWidth: "680px",
      color: "var(--ai-text-secondary)",
      fontSize: "14px",
      lineHeight: "1.65",
    });
    copy.appendChild(eyebrow);
    copy.appendChild(title);
    copy.appendChild(subtitle);

    const status = createStatusBadge(
      doc,
      config.enabled,
      !!config.rootPath,
      config.watchedCollectionIds.length,
    );
    heroContent.appendChild(copy);
    heroContent.appendChild(status);
    hero.appendChild(heroContent);
    page.appendChild(hero);

    const quickGrid = doc.createElement("div");
    Object.assign(quickGrid.style, {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
      gap: "12px",
    });
    quickGrid.appendChild(
      createMetricCard(
        doc,
        "监听分类",
        String(config.watchedCollectionIds.length),
        config.includeSubcollections ? "包含子分类" : "仅当前分类",
      ),
    );
    quickGrid.appendChild(
      createMetricCard(
        doc,
        "导出格式",
        `${countEnabledFormats(config.formats)}/4`,
        getFormatSummary(config.formats),
      ),
    );
    quickGrid.appendChild(
      createMetricCard(
        doc,
        "冲突策略",
        config.conflictStrategy === "overwrite" ? "覆盖" : "跳过",
        config.conflictStrategy === "overwrite"
          ? "已有文件会被替换"
          : "保护已修改文件",
      ),
    );
    page.appendChild(quickGrid);

    const basics = createPanel(doc);
    basics.appendChild(
      createPanelHeader(
        doc,
        "基础设置",
        "控制笔记自动导出的启用状态与根目录。",
      ),
    );
    basics.appendChild(
      createSettingRow(
        doc,
        "启用笔记自动导出",
        "开启后，任务队列完成 AI 总结或 AI 精读时会自动检查是否满足导出条件。",
        createCheckbox("noteExportEnabled", config.enabled),
      ),
    );

    const pathInput = createInput(
      "noteExportRootPath",
      "text",
      config.rootPath,
      "请选择或输入导出根目录...",
    );
    Object.assign(pathInput.style, {
      borderRadius: "10px",
      minHeight: "38px",
      fontFamily: "Consolas, Menlo, monospace",
    });

    const pathControl = doc.createElement("div");
    Object.assign(pathControl.style, {
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr) auto",
      gap: "10px",
      alignItems: "center",
      width: "100%",
    });
    const browseButton = createStyledButton("选择目录", "#59c0bc", "medium");
    Object.assign(browseButton.style, {
      borderRadius: "10px",
      minHeight: "38px",
    });
    browseButton.addEventListener("click", async () => {
      try {
        const selected = await pickFolder(
          "选择 AI 笔记导出目录",
          this.container.ownerDocument?.defaultView || null,
        );
        if (selected) {
          (pathInput as HTMLInputElement).value = selected;
          saveCurrentSettings(true);
        }
      } catch (error) {
        ztoolkit.log("[AI-Butler][NoteExport] 选择导出目录失败:", error);
        showToast("选择目录失败，请手动输入目录", "error");
      }
    });
    pathControl.appendChild(pathInput);
    pathControl.appendChild(browseButton);
    basics.appendChild(
      createSettingRow(
        doc,
        "导出根目录",
        "导出结构为：根目录 / 分类路径 / 论文名 / 导出文件。",
        pathControl,
      ),
    );
    page.appendChild(basics);

    const collections = createPanel(doc);
    collections.appendChild(
      createPanelHeader(
        doc,
        "监听分类",
        "只有位于这些分类中的论文会进入笔记自动导出检查。",
      ),
    );
    collections.appendChild(
      this.renderWatchedCollections(config.watchedCollectionIds),
    );

    const collectionFooter = doc.createElement("div");
    Object.assign(collectionFooter.style, {
      display: "grid",
      gap: "12px",
      marginTop: "12px",
    });
    const collectionActions = doc.createElement("div");
    Object.assign(collectionActions.style, {
      display: "flex",
      gap: "10px",
      flexWrap: "wrap",
      alignItems: "center",
    });
    const addSelectedButton = createStyledButton(
      "添加当前选中分类",
      "#34a853",
      "medium",
    );
    Object.assign(addSelectedButton.style, { borderRadius: "10px" });
    addSelectedButton.addEventListener("click", () => {
      const collection = Zotero.getActiveZoteroPane().getSelectedCollection();
      if (!collection) {
        showToast("请先在 Zotero 左侧选择一个分类", "warning");
        return;
      }
      addWatchedCollection(collection.id);
      AutoNoteExportManager.getInstance().reload();
      showToast("笔记自动导出设置已保存", "success");
      this.render();
    });
    collectionActions.appendChild(addSelectedButton);
    collectionFooter.appendChild(collectionActions);
    collectionFooter.appendChild(
      createSettingRow(
        doc,
        "包含子分类",
        "开启后，监听分类下的所有子分类也会触发笔记自动导出。",
        createCheckbox(
          "noteExportIncludeSubcollections",
          config.includeSubcollections,
        ),
        true,
      ),
    );
    collections.appendChild(collectionFooter);
    page.appendChild(collections);

    const output = createPanel(doc);
    output.appendChild(
      createPanelHeader(doc, "导出内容", "选择需要自动生成的笔记文件格式。"),
    );
    const formatGrid = doc.createElement("div");
    Object.assign(formatGrid.style, {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
      gap: "10px",
    });
    for (const [key, label, description] of getFormatRows()) {
      formatGrid.appendChild(
        createFormatCard(
          doc,
          label,
          description,
          createCheckbox(`noteExportFormat-${key}`, config.formats[key]),
        ),
      );
    }
    output.appendChild(formatGrid);

    const strategySelect = createSelect(
      "noteExportConflictStrategy",
      [
        { value: "skip", label: "跳过已有文件" },
        { value: "overwrite", label: "覆盖已有文件" },
      ],
      config.conflictStrategy,
    );
    Object.assign(strategySelect.style, { maxWidth: "320px" });
    output.appendChild(
      createSettingRow(
        doc,
        "已存在文件策略",
        "默认跳过，避免覆盖手动修改后的文件。",
        strategySelect,
      ),
    );
    output.appendChild(
      createSettingRow(
        doc,
        "右键导出不再提醒目录",
        "开启后，右键分类导出会优先使用这里保存的目录。",
        createCheckbox(
          "noteExportSuppressDirectoryPrompt",
          config.suppressDirectoryPrompt,
        ),
        true,
      ),
    );
    page.appendChild(output);

    const saveCurrentSettings = (showNotice = true) => {
      setNoteExportConfig({
        enabled: getCheckboxValue(this.container, "noteExportEnabled", false),
        rootPath: (pathInput as HTMLInputElement).value,
        includeSubcollections: getCheckboxValue(
          this.container,
          "noteExportIncludeSubcollections",
          true,
        ),
        formats: readFormats(this.container),
        conflictStrategy: getSelectValue(
          strategySelect,
          "skip",
        ) as NoteExportConflictStrategy,
        suppressDirectoryPrompt: getCheckboxValue(
          this.container,
          "noteExportSuppressDirectoryPrompt",
          false,
        ),
      });
      AutoNoteExportManager.getInstance().reload();
      if (showNotice) showToast("笔记自动导出设置已保存", "success");
    };
    const scheduleAutoSave = () => {
      if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = setTimeout(() => {
        this.autoSaveTimer = null;
        saveCurrentSettings(true);
      }, 500);
    };
    page.addEventListener("input", scheduleAutoSave);
    page.addEventListener("change", scheduleAutoSave);

    this.container.appendChild(page);
  }

  private renderWatchedCollections(collectionIds: number[]): HTMLElement {
    const doc = this.container.ownerDocument || Zotero.getMainWindow().document;
    const list = doc.createElement("div");
    Object.assign(list.style, { display: "grid", gap: "10px" });

    if (!collectionIds.length) {
      const empty = doc.createElement("div");
      Object.assign(empty.style, {
        border: "1px dashed var(--ai-border)",
        borderRadius: "14px",
        padding: "18px",
        background: "rgba(127, 127, 127, 0.05)",
        color: "var(--ai-text-secondary)",
        display: "grid",
        gap: "6px",
      });
      const title = doc.createElement("div");
      title.textContent = "尚未添加监听分类";
      Object.assign(title.style, {
        color: "var(--ai-text)",
        fontWeight: "700",
      });
      const text = doc.createElement("div");
      text.textContent =
        "在 Zotero 左侧选择一个分类后，点击下方按钮即可加入笔记自动导出范围。";
      Object.assign(text.style, { fontSize: "13px", lineHeight: "1.6" });
      empty.appendChild(title);
      empty.appendChild(text);
      list.appendChild(empty);
      return list;
    }

    for (const collectionId of collectionIds) {
      const collection = Zotero.Collections.get(
        collectionId,
      ) as Zotero.Collection;
      const row = doc.createElement("div");
      Object.assign(row.style, {
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        alignItems: "center",
        gap: "12px",
        padding: "12px 14px",
        border: "1px solid var(--ai-border)",
        borderRadius: "14px",
        background: "var(--ai-card-bg)",
        boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
      });
      const labelWrap = doc.createElement("div");
      Object.assign(labelWrap.style, {
        minWidth: "0",
        display: "grid",
        gap: "4px",
      });
      const label = doc.createElement("div");
      label.textContent = collection
        ? getCollectionPathLabel(collection)
        : `分类 ${collectionId}（已不存在）`;
      Object.assign(label.style, {
        fontWeight: "700",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      });
      const hint = doc.createElement("div");
      hint.textContent = collection
        ? "监听该分类中的 AI 笔记生成状态"
        : "该分类可能已被删除，可移除本条记录";
      Object.assign(hint.style, {
        color: "var(--ai-text-secondary)",
        fontSize: "12px",
      });
      labelWrap.appendChild(label);
      labelWrap.appendChild(hint);
      row.appendChild(labelWrap);
      const removeButton = createStyledButton("移除", "#e25555", "small");
      Object.assign(removeButton.style, { borderRadius: "9px" });
      removeButton.addEventListener("click", () => {
        removeWatchedCollection(collectionId);
        AutoNoteExportManager.getInstance().reload();
        showToast("笔记自动导出设置已保存", "success");
        this.render();
      });
      row.appendChild(removeButton);
      list.appendChild(row);
    }

    return list;
  }
}

function createPanel(
  doc: Document,
  background = "var(--ai-card-bg)",
): HTMLElement {
  const panel = doc.createElement("section");
  Object.assign(panel.style, {
    border: "1px solid var(--ai-border)",
    borderRadius: "18px",
    background,
    padding: "18px",
    boxShadow: "0 10px 30px rgba(15, 23, 42, 0.06)",
  });
  return panel;
}

function createPanelHeader(
  doc: Document,
  titleText: string,
  description: string,
): HTMLElement {
  const header = doc.createElement("div");
  Object.assign(header.style, {
    display: "grid",
    gap: "5px",
    marginBottom: "14px",
  });
  const title = doc.createElement("h3");
  title.textContent = titleText;
  Object.assign(title.style, {
    margin: "0",
    fontSize: "16px",
    color: "var(--ai-text)",
  });
  const desc = doc.createElement("div");
  desc.textContent = description;
  Object.assign(desc.style, {
    color: "var(--ai-text-secondary)",
    fontSize: "13px",
    lineHeight: "1.55",
  });
  header.appendChild(title);
  header.appendChild(desc);
  return header;
}

function createSettingRow(
  doc: Document,
  titleText: string,
  description: string,
  control: HTMLElement,
  compact = false,
): HTMLElement {
  const row = doc.createElement("div");
  Object.assign(row.style, {
    display: "grid",
    gridTemplateColumns: compact
      ? "minmax(0, 1fr) auto"
      : "minmax(220px, 0.85fr) minmax(260px, 1.15fr)",
    gap: "14px",
    alignItems: "center",
    padding: compact ? "12px 0" : "14px 0",
    borderTop: "1px solid rgba(127, 127, 127, 0.16)",
  });
  const copy = doc.createElement("div");
  Object.assign(copy.style, { display: "grid", gap: "4px", minWidth: "0" });
  const title = doc.createElement("div");
  title.textContent = titleText;
  Object.assign(title.style, { fontWeight: "700", color: "var(--ai-text)" });
  const desc = doc.createElement("div");
  desc.textContent = description;
  Object.assign(desc.style, {
    color: "var(--ai-text-secondary)",
    fontSize: "12px",
    lineHeight: "1.55",
  });
  copy.appendChild(title);
  copy.appendChild(desc);
  row.appendChild(copy);
  const controlWrap = doc.createElement("div");
  Object.assign(controlWrap.style, {
    justifySelf: compact ? "end" : "stretch",
    minWidth: "0",
  });
  controlWrap.appendChild(control);
  row.appendChild(controlWrap);
  return row;
}

function createMetricCard(
  doc: Document,
  label: string,
  value: string,
  detail: string,
): HTMLElement {
  const card = doc.createElement("div");
  Object.assign(card.style, {
    border: "1px solid var(--ai-border)",
    borderRadius: "16px",
    background: "var(--ai-card-bg)",
    padding: "14px 16px",
    display: "grid",
    gap: "4px",
  });
  const labelEl = doc.createElement("div");
  labelEl.textContent = label;
  Object.assign(labelEl.style, {
    color: "var(--ai-text-secondary)",
    fontSize: "12px",
  });
  const valueEl = doc.createElement("div");
  valueEl.textContent = value;
  Object.assign(valueEl.style, {
    fontSize: "20px",
    fontWeight: "800",
    color: "var(--ai-text)",
  });
  const detailEl = doc.createElement("div");
  detailEl.textContent = detail;
  Object.assign(detailEl.style, {
    color: "var(--ai-text-secondary)",
    fontSize: "12px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  });
  card.appendChild(labelEl);
  card.appendChild(valueEl);
  card.appendChild(detailEl);
  return card;
}

function createStatusBadge(
  doc: Document,
  enabled: boolean,
  hasPath: boolean,
  collectionCount: number,
): HTMLElement {
  const ready = enabled && hasPath && collectionCount > 0;
  const badge = doc.createElement("div");
  Object.assign(badge.style, {
    borderRadius: "999px",
    padding: "9px 13px",
    border: ready
      ? "1px solid rgba(52, 168, 83, 0.45)"
      : "1px solid rgba(251, 188, 5, 0.45)",
    background: ready ? "rgba(52, 168, 83, 0.12)" : "rgba(251, 188, 5, 0.14)",
    color: ready ? "#188038" : "#b06000",
    fontSize: "12px",
    fontWeight: "800",
    whiteSpace: "nowrap",
  });
  badge.textContent = ready ? "● 已就绪" : "● 待完善";
  return badge;
}

function createFormatCard(
  doc: Document,
  label: string,
  description: string,
  checkbox: HTMLElement,
): HTMLElement {
  const card = doc.createElement("label");
  Object.assign(card.style, {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    gap: "12px",
    alignItems: "start",
    border: "1px solid var(--ai-border)",
    borderRadius: "14px",
    background: "rgba(127, 127, 127, 0.04)",
    padding: "13px",
    cursor: "pointer",
  });
  card.appendChild(checkbox);
  const copy = doc.createElement("div");
  const title = doc.createElement("div");
  title.textContent = label;
  Object.assign(title.style, { fontWeight: "700", color: "var(--ai-text)" });
  const desc = doc.createElement("div");
  desc.textContent = description;
  Object.assign(desc.style, {
    marginTop: "4px",
    color: "var(--ai-text-secondary)",
    fontSize: "12px",
    lineHeight: "1.45",
  });
  copy.appendChild(title);
  copy.appendChild(desc);
  card.appendChild(copy);
  return card;
}

function getFormatRows(): Array<[keyof NoteExportFormats, string, string]> {
  return [
    ["summaryDocx", "AI 总结 DOCX", "适合归档与二次编辑"],
    ["deepReadDocx", "AI 精读 DOCX", "保留分轮精读结构"],
    ["summaryMd", "AI 总结 Markdown", "适合知识库和版本管理"],
    ["deepReadMd", "AI 精读 Markdown", "适合纯文本工作流"],
  ];
}

function countEnabledFormats(formats: NoteExportFormats): number {
  return Object.values(formats).filter(Boolean).length;
}

function getFormatSummary(formats: NoteExportFormats): string {
  const enabled = getFormatRows()
    .filter(([key]) => formats[key])
    .map(([, label]) => label.replace("AI ", "").replace(" Markdown", " MD"));
  return enabled.length ? enabled.join("、") : "未选择格式";
}

function readFormats(root: ParentNode): NoteExportFormats {
  return {
    summaryDocx: getCheckboxValue(root, "noteExportFormat-summaryDocx", true),
    deepReadDocx: getCheckboxValue(root, "noteExportFormat-deepReadDocx", true),
    summaryMd: getCheckboxValue(root, "noteExportFormat-summaryMd", true),
    deepReadMd: getCheckboxValue(root, "noteExportFormat-deepReadMd", true),
  };
}

function getCheckboxValue(
  root: ParentNode,
  id: string,
  fallback: boolean,
): boolean {
  const checkbox = root.querySelector(
    `input[type="checkbox"]#setting-${id}`,
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
