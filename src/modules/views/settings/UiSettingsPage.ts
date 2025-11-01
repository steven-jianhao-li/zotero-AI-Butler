/**
 * UI 设置页面
 */

import { getPref, setPref } from "../../../utils/prefs";
import { AutoScanManager } from "../../autoScanManager";
import {
  createFormGroup,
  createSelect,
  createSlider,
  createInput,
  createCheckbox,
  createStyledButton,
  createNotice,
} from "../ui/components";

export class UiSettingsPage {
  private container: HTMLElement;
  private preview!: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  public render(): void {
    this.container.innerHTML = "";

    const title = Zotero.getMainWindow().document.createElement("h2");
    title.textContent = "🎨 界面设置";
    Object.assign(title.style, {
      color: "#59c0bc",
      marginBottom: "20px",
      fontSize: "20px",
      borderBottom: "2px solid #59c0bc",
      paddingBottom: "10px",
    });
    this.container.appendChild(title);

    this.container.appendChild(
      createNotice(
        "界面与行为设置：自动滚动、自动扫描；以及已有 AI 笔记时的处理策略。",
      ),
    );

    const form = Zotero.getMainWindow().document.createElement("div");
    Object.assign(form.style, { maxWidth: "820px" });

    // 自动滚动
    const autoScroll = (getPref("autoScroll") as boolean) ?? true;
    const autoScrollBox = createCheckbox("autoScroll", !!autoScroll);
    form.appendChild(
      createFormGroup(
        "自动滚动到最新输出",
        autoScrollBox,
        "生成笔记时，自动滚动到输出窗口底部",
      ),
    );

    // 自动扫描
    const autoScan = (getPref("autoScan") as boolean) ?? true;
    const autoScanBox = createCheckbox("autoScan", !!autoScan);
    form.appendChild(
      createFormGroup(
        "自动扫描新文献",
        autoScanBox,
        "监听文献库变化，新加入的文献自动加入分析队列",
      ),
    );

    // 保存对话历史
    const saveChatHistory = (getPref("saveChatHistory") as boolean) ?? false;
    const saveChatHistoryBox = createCheckbox(
      "saveChatHistory",
      !!saveChatHistory,
    );
    form.appendChild(
      createFormGroup(
        "保存追问对话记录（试验性功能，谨慎启用）",
        saveChatHistoryBox,
        "开启后，追问对话的内容会自动保存到论文的 AI 管家笔记中",
      ),
    );

    // 笔记管理策略
    const policy = (
      (getPref("noteStrategy" as any) as string) || "skip"
    ).toString();
    const policySelect = createSelect(
      "notePolicy",
      [
        { value: "skip", label: "跳过(默认)" },
        { value: "overwrite", label: "覆盖" },
        { value: "append", label: "追加" },
      ],
      policy,
    );
    form.appendChild(
      createFormGroup(
        "已有 AI 笔记时的策略",
        policySelect,
        "当检测到条目已有 AI 总结笔记时该如何处理",
      ),
    );

    // 预览区域（移除字号预览，不再提供字体大小设置）

    // 按钮
    const actions = Zotero.getMainWindow().document.createElement("div");
    Object.assign(actions.style, {
      display: "flex",
      gap: "12px",
      marginTop: "16px",
    });
    const btnSave = createStyledButton("💾 保存设置", "#4caf50");
    btnSave.addEventListener("click", () => {
      const autoVal =
        (form.querySelector("#setting-autoScroll") as HTMLInputElement)
          ?.checked ?? true;
      const autoScanVal =
        (form.querySelector("#setting-autoScan") as HTMLInputElement)
          ?.checked ?? true;
      const saveChatHistoryVal =
        (form.querySelector("#setting-saveChatHistory") as HTMLInputElement)
          ?.checked ?? false;
      const policyVal = (policySelect as any).getValue
        ? (policySelect as any).getValue()
        : policy;

      setPref("autoScroll", !!autoVal as any);
      setPref("autoScan", !!autoScanVal as any);
      setPref("saveChatHistory", !!saveChatHistoryVal as any);
      setPref("noteStrategy" as any, policyVal);

      // 重新加载自动扫描管理器
      AutoScanManager.getInstance().reload();

      new ztoolkit.ProgressWindow("界面设置")
        .createLine({ text: "✅ 设置已保存", type: "success" })
        .show();
    });

    const btnReset = createStyledButton("🔄 重置默认", "#9e9e9e");
    btnReset.addEventListener("click", () => {
      setPref("autoScroll", true as any);
      setPref("autoScan", true as any);
      setPref("saveChatHistory", false as any);
      setPref("noteStrategy" as any, "skip");
      AutoScanManager.getInstance().reload();
      this.render();
      new ztoolkit.ProgressWindow("界面设置")
        .createLine({ text: "已重置为默认", type: "success" })
        .show();
    });
    actions.appendChild(btnSave);
    actions.appendChild(btnReset);
    form.appendChild(actions);

    this.container.appendChild(form);

    // 无字号预览
  }

  private applyPreview(fontSize: number): void {
    if (!this.preview) return;
    this.preview.style.fontSize = `${fontSize}px`;
  }
}
