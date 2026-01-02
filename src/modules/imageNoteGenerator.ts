/**
 * ================================================================
 * 一图总结笔记生成器模块
 * ================================================================
 *
 * 本模块负责将 AI 生成的学术概念海报图片插入 Zotero 笔记
 *
 * 主要职责:
 * 1. 将 Base64 编码的图片嵌入 Zotero 笔记
 * 2. 创建独立的"一图总结"笔记条目
 * 3. 管理已存在的一图总结笔记(避免重复)
 *
 * @module imageNoteGenerator
 * @author AI-Butler Team
 */

/**
 * 一图总结笔记生成器类
 *
 * 提供静态方法集合，封装图片笔记生成的核心逻辑
 */
export class ImageNoteGenerator {
  /** 一图总结笔记的标识标签 */
  private static readonly IMAGE_NOTE_TAG = "AI-Image-Summary";

  /** 一图总结笔记标题前缀 */
  private static readonly NOTE_TITLE_PREFIX = "AI 管家一图总结 - ";

  /**
   * 创建一图总结笔记
   *
   * 将 Base64 编码的图片嵌入到新建的 Zotero 笔记中
   *
   * @param item Zotero 文献条目对象
   * @param imageBase64 Base64 编码的图片数据 (不含 data URI 前缀)
   * @param mimeType 图片 MIME 类型，如 "image/png"
   * @returns 创建的笔记对象
   */
  public static async createImageNote(
    item: Zotero.Item,
    imageBase64: string,
    mimeType: string = "image/png",
  ): Promise<Zotero.Item> {
    const itemTitle = item.getField("title") as string;

    // 构建 data URI
    const dataUri = `data:${mimeType};base64,${imageBase64}`;

    // 格式化笔记内容
    const noteContent = this.formatImageNoteContent(itemTitle, dataUri);

    // 检查是否已存在一图总结笔记
    const existing = await this.findExistingImageNote(item);
    if (existing) {
      // 更新已存在的笔记
      (existing as any).setNote?.(noteContent);
      await (existing as any).saveTx?.();
      ztoolkit.log(`[AI-Butler] 更新已存在的一图总结笔记: ${existing.id}`);
      return existing;
    }

    // 创建新笔记
    const note = new Zotero.Item("note");
    note.parentID = item.id;
    note.setNote(noteContent);
    note.addTag(this.IMAGE_NOTE_TAG);
    await note.saveTx();

    ztoolkit.log(`[AI-Butler] 创建一图总结笔记: ${note.id}`);
    return note;
  }

  /**
   * 使用本地文件路径创建一图总结笔记 (测试用)
   *
   * 读取本地图片文件并转换为 Base64 后创建笔记
   *
   * @param item Zotero 文献条目对象
   * @param imagePath 本地图片文件的绝对路径
   * @returns 创建的笔记对象
   */
  public static async createImageNoteFromFile(
    item: Zotero.Item,
    imagePath: string,
  ): Promise<Zotero.Item> {
    try {
      // 使用 Zotero 的文件 API 读取图片
      const file = Zotero.File.pathToFile(imagePath);
      if (!file.exists()) {
        throw new Error(`图片文件不存在: ${imagePath}`);
      }

      // 读取文件内容为字节数组
      const contents = await Zotero.File.getBinaryContentsAsync(imagePath);

      // 将字节数组转换为 Base64
      // 使用 btoa 进行 Base64 编码
      const base64 = btoa(contents);

      // 根据文件扩展名确定 MIME 类型
      const ext = imagePath.toLowerCase().split(".").pop();
      const mimeMap: Record<string, string> = {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
      };
      const mimeType = mimeMap[ext || "png"] || "image/png";

      return this.createImageNote(item, base64, mimeType);
    } catch (error: any) {
      ztoolkit.log(`[AI-Butler] 从文件创建一图总结笔记失败:`, error);
      throw new Error(`读取图片文件失败: ${error.message || error}`);
    }
  }

  /**
   * 查找已有的一图总结笔记
   *
   * 通过标签或标题标识查找文献条目下已存在的一图总结笔记
   *
   * @param item Zotero 文献条目对象
   * @returns 找到的笔记对象，如果不存在则返回 null
   */
  public static async findExistingImageNote(
    item: Zotero.Item,
  ): Promise<Zotero.Item | null> {
    try {
      const noteIDs = (item as any).getNotes?.() || [];

      for (const nid of noteIDs) {
        const n = await Zotero.Items.getAsync(nid);
        if (!n) continue;

        // 检查是否有一图总结标签
        const tags: Array<{ tag: string }> = (n as any).getTags?.() || [];
        const hasTag = tags.some((t) => t.tag === this.IMAGE_NOTE_TAG);

        // 检查标题是否匹配
        const noteHtml: string = (n as any).getNote?.() || "";
        const titleMatch = new RegExp(
          `<h2>\\s*${this.escapeRegExp(this.NOTE_TITLE_PREFIX)}`,
        ).test(noteHtml);

        if (hasTag || titleMatch) {
          return n as Zotero.Item;
        }
      }

      return null;
    } catch (error) {
      ztoolkit.log(`[AI-Butler] 查找一图总结笔记失败:`, error);
      return null;
    }
  }

  /**
   * 格式化图片笔记的 HTML 内容
   *
   * @param itemTitle 文献标题
   * @param imageDataUri 图片的 data URI (含完整前缀)
   * @returns 格式化后的 HTML 内容
   */
  private static formatImageNoteContent(
    itemTitle: string,
    imageDataUri: string,
  ): string {
    // 截断过长的标题
    const maxTitleLength = 80;
    let truncatedTitle = itemTitle;
    if (truncatedTitle.length > maxTitleLength) {
      truncatedTitle = truncatedTitle.substring(0, maxTitleLength) + "...";
    }

    // 构建笔记 HTML
    // 使用简单的 HTML 结构，确保 Zotero 兼容性
    return `<h2>${this.NOTE_TITLE_PREFIX}${this.escapeHtml(truncatedTitle)}</h2>
<div style="text-align: center; padding: 10px;">
  <img src="${imageDataUri}" alt="学术概念海报" style="max-width: 100%; height: auto;" />
</div>
<p style="text-align: center; color: #666; font-size: 12px;">
  由 AI 管家自动生成的学术概念海报
</p>`;
  }

  /**
   * HTML 转义工具函数
   *
   * @param text 待转义的文本
   * @returns 转义后的安全 HTML 文本
   */
  private static escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * 正则转义工具函数
   *
   * @param str 待转义的字符串
   * @returns 转义后可用于正则的字符串
   */
  private static escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}

export default ImageNoteGenerator;
