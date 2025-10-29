/**
 * ================================================================
 * 自动扫描管理器
 * ================================================================
 * 
 * 本模块负责监听 Zotero 库中新添加的文献条目，
 * 并自动将需要 AI 分析的条目加入任务队列
 * 
 * 主要职责:
 * 1. 监听 Zotero item-add 事件
 * 2. 检查新条目是否需要 AI 笔记（是否已有 AI 笔记）
 * 3. 自动将符合条件的条目加入队列
 * 4. 尊重用户的自动扫描开关设置
 * 
 * @module autoScanManager
 * @author AI-Butler Team
 */

import { getPref } from "../utils/prefs";
import { TaskQueueManager } from "./taskQueue";

/**
 * 自动扫描管理器类
 */
export class AutoScanManager {
  /** 单例实例 */
  private static instance: AutoScanManager | null = null;

  /** Zotero notifier ID */
  private notifierID: string | null = null;

  /** 是否正在运行 */
  private running: boolean = false;

  /** 附件未就绪的待观察父条目集合 */
  private pendingParents: Set<number> = new Set();
  /** 轮询重试计时器 */
  private retryTimers: Map<number, number> = new Map();

  /**
   * 私有构造函数（单例模式）
   */
  private constructor() {}

  /**
   * 获取单例实例
   */
  public static getInstance(): AutoScanManager {
    if (!AutoScanManager.instance) {
      AutoScanManager.instance = new AutoScanManager();
    }
    return AutoScanManager.instance;
  }

  /**
   * 启动自动扫描监听
   */
  public start(): void {
    if (this.running) {
      ztoolkit.log("[AutoScan] 已在运行中");
      return;
    }

    // 检查用户是否启用了自动扫描
    const enabled = getPref("autoScan") as boolean;
    if (!enabled) {
      ztoolkit.log("[AutoScan] 自动扫描已禁用");
      return;
    }

    // 注册 Zotero notifier
    this.notifierID = Zotero.Notifier.registerObserver(
      {
        notify: async (
          event: string,
          type: string,
          ids: Array<string | number>,
          extraData: any
        ) => {
          await this.handleNotify(event, type, ids, extraData);
        },
      },
      ["item"],
      "ai-butler-auto-scan"
    );

    this.running = true;
    ztoolkit.log("[AutoScan] 自动扫描已启动");
  }

  /**
   * 停止自动扫描监听
   */
  public stop(): void {
    if (!this.running) {
      return;
    }

    if (this.notifierID) {
      Zotero.Notifier.unregisterObserver(this.notifierID);
      this.notifierID = null;
    }

    this.running = false;
    ztoolkit.log("[AutoScan] 自动扫描已停止");
  }

  /**
   * 处理 Zotero 通知事件
   */
  private async handleNotify(
    event: string,
    type: string,
    ids: Array<string | number>,
    extraData: any
  ): Promise<void> {
    if (type !== "item") return;

    // 检查自动扫描是否仍然启用
    const enabled = getPref("autoScan") as boolean;
    if (!enabled) {
      this.stop();
      return;
    }
    try {
      for (const rawId of ids) {
        const id = rawId as number;
        const item = await Zotero.Items.getAsync(id);
        if (!item) continue;

        // A) 新增顶层条目：延迟检查附件是否就绪
        if (event === "add" && this.shouldProcess(item)) {
          // 初始小延迟，给同步/下载留时间
          await this.delay(2000);
          await this.enqueueIfReady(item);
          continue;
        }

        // B) 新增附件：如果父条目在待观察集合且附件已就绪，则入队
        if (event === "add" && item.isAttachment && item.isAttachment()) {
          const parentID = item.parentID as number | undefined;
          if (parentID && this.pendingParents.has(parentID)) {
            const parent = await Zotero.Items.getAsync(parentID);
            if (parent) {
              await this.enqueueIfReady(parent);
            }
          }
        }
      }
    } catch (error: any) {
      ztoolkit.log("[AutoScan] 处理通知时出错:", error);
    }
  }

  /**
   * 判断条目是否应该被处理
   * 过滤掉笔记、附件等非文献类型
   */
  private shouldProcess(item: Zotero.Item): boolean {
    // 只处理常规条目（排除笔记、附件等）
    if (item.isNote() || item.isAttachment()) {
      return false;
    }

    // 必须是 top-level item
    if (item.parentID) {
      return false;
    }

    // 必须有标题
    const title = item.getField("title") as string;
    if (!title || title.trim() === "") {
      return false;
    }

    return true;
  }

  /** 判断是否存在可用的 PDF 附件 */
  private async hasUsablePDFAttachment(item: Zotero.Item): Promise<boolean> {
    try {
      const attIDs: number[] = ((item as any).getAttachments?.() || []) as number[];
      for (const aid of attIDs) {
        const att = await Zotero.Items.getAsync(aid);
        if (!att || !att.isAttachment()) continue;
        const mime = (att as any).attachmentMIMEType || "";
        const file = await (att as any).getFile?.();
        if (mime === "application/pdf" && file) {
          return true;
        }
        // 若 MIME 未填，退化到扩展名判断
        const path = (att as any).getFilePath?.() || "";
        if (path && /\.pdf$/i.test(path)) {
          return true;
        }
      }
    } catch (e) {
      // 忽略单条异常
    }
    return false;
  }

  /** 如果条目附件已就绪且需要 AI，则入队；否则进入待观察并轮询重试 */
  private async enqueueIfReady(item: Zotero.Item): Promise<void> {
    // 已有 AI 笔记则不处理
    if (await this.hasExistingAINote(item)) return;

    // 检查 PDF 附件
    if (await this.hasUsablePDFAttachment(item)) {
      // 具备条件，入队
      this.pendingParents.delete(item.id);
      const tqm = TaskQueueManager.getInstance();
      await tqm.addTasks([item], false);
      ztoolkit.log(`[AutoScan] 自动加入 1 个新条目到队列: ${item.getField("title")}`);
      // 清理重试计时器
      const timer = this.retryTimers.get(item.id);
      if (timer) {
        clearTimeout(timer);
        this.retryTimers.delete(item.id);
      }
      return;
    }

    // 不具备条件：加入待观察并安排重试（指数退避，最多 5 次）
    this.pendingParents.add(item.id);
    const attemptKey = `__attempt_${item.id}` as const;
    const attempts = ((item as any)[attemptKey] as number) || 0;
    if (attempts >= 5) {
      this.pendingParents.delete(item.id);
      (item as any)[attemptKey] = 0;
      ztoolkit.log(`[AutoScan] 附件仍未就绪，放弃自动加入: ${item.getField("title")}`);
      return;
    }

    (item as any)[attemptKey] = attempts + 1;
    const delayMs = Math.min(30000, 2000 * Math.pow(2, attempts)); // 2s,4s,8s,16s,30s
    const timer = setTimeout(async () => {
      try {
        const latest = await Zotero.Items.getAsync(item.id);
        if (latest) {
          await this.enqueueIfReady(latest);
        }
      } catch {}
    }, delayMs) as unknown as number;
    this.retryTimers.set(item.id, timer);
  }

  /**
   * 筛选出需要 AI 笔记的条目
   * 检查是否已经存在 AI 生成的笔记
   */
  private async filterItemsNeedingAI(
    items: Zotero.Item[]
  ): Promise<Zotero.Item[]> {
    const result: Zotero.Item[] = [];

    for (const item of items) {
      const hasAINote = await this.hasExistingAINote(item);
      if (!hasAINote) {
        result.push(item);
      }
    }

    return result;
  }

  /**
   * 检查条目是否已有 AI 笔记
   */
  private async hasExistingAINote(item: Zotero.Item): Promise<boolean> {
    try {
      const noteIDs = (item as any).getNotes?.() || [];
      for (const nid of noteIDs) {
        const n = await Zotero.Items.getAsync(nid);
        if (!n) continue;

        // 检查标签
        const tags: Array<{ tag: string }> = (n as any).getTags?.() || [];
        const hasTag = tags.some((t) => t.tag === "AI-Generated");
        if (hasTag) return true;

        // 检查标题标记
        const noteHtml: string = (n as any).getNote?.() || "";
        if (/<h2>\s*AI 管家\s*-/.test(noteHtml)) {
          return true;
        }
      }
      return false;
    } catch (error) {
      ztoolkit.log("[AutoScan] 检查 AI 笔记时出错:", error);
      return false;
    }
  }

  /**
   * 重新加载配置（用于设置更改后刷新）
   */
  public reload(): void {
    const enabled = getPref("autoScan") as boolean;
    if (enabled && !this.running) {
      this.start();
    } else if (!enabled && this.running) {
      this.stop();
    }
  }

  /** 小延时工具 */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
