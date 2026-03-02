/**
 * ================================================================
 * PDF文本提取工具模块
 * ================================================================
 *
 * 本模块提供从 Zotero 文献条目中提取 PDF 文本内容的功能
 *
 * 主要职责:
 * 1. 从 Zotero 条目中定位并读取 PDF 附件
 * 2. 利用 Zotero 内置的全文索引系统提取文本
 * 3. 清理和规范化提取的文本内容
 * 4. 根据需要截断文本以适应 API 限制
 *
 * 技术实现:
 * - 可选Zotero 的全文索引功能, 或PDF解析APIMinerU
 * - 自动触发索引,确保文本可用性
 * - 提供多级文本清理,去除 PDF 常见伪影
 *
 * @module pdfExtractor
 * @author AI-Butler Team
 */

import { getPref } from "../utils/prefs";

/**
 * PDF文本提取器类
 *
 * 提供静态方法集合,用于 PDF 文本的提取、清理和处理
 * 采用静态方法设计,简化调用方式,无需实例化
 */
export class PDFExtractor {
  /**
   * 检查条目是否有可用的 PDF 附件
   *
   * 用于在任务处理前快速检测条目是否有 PDF，
   * 避免无附件的条目消耗处理时间
   *
   * @param item Zotero 文献条目对象
   * @returns 是否有 PDF 附件
   */
  public static async hasPDFAttachment(item: Zotero.Item): Promise<boolean> {
    try {
      const attachments = item.getAttachments();
      if (attachments.length === 0) {
        return false;
      }

      for (const attachmentID of attachments) {
        const attachment = await Zotero.Items.getAsync(attachmentID);
        if (attachment.attachmentContentType === "application/pdf") {
          return true;
        }
      }

      return false;
    } catch (error) {
      ztoolkit.log("[PDFExtractor] 检查 PDF 附件时出错:", error);
      return false;
    }
  }

  /**
   * 获取条目的所有 PDF 附件
   *
   * 用于多 PDF 上传模式,返回按添加时间排序的所有 PDF 附件
   *
   * @param item Zotero 文献条目对象
   * @returns 按添加时间排序的 PDF 附件数组
   */
  public static async getAllPdfAttachments(
    item: Zotero.Item,
  ): Promise<Zotero.Item[]> {
    try {
      const attachments = item.getAttachments();
      if (attachments.length === 0) {
        return [];
      }

      const pdfAttachments: Zotero.Item[] = [];

      for (const attachmentID of attachments) {
        const attachment = await Zotero.Items.getAsync(attachmentID);
        if (attachment.attachmentContentType === "application/pdf") {
          pdfAttachments.push(attachment);
        }
      }

      // 按 dateAdded 升序排序 (最早的在前)
      return pdfAttachments.sort((a, b) => {
        const dateA = new Date(a.dateAdded).getTime();
        const dateB = new Date(b.dateAdded).getTime();
        return dateA - dateB;
      });
    } catch (error) {
      ztoolkit.log("[PDFExtractor] 获取所有 PDF 附件时出错:", error);
      return [];
    }
  }

  /**
   * 获取 PDF 附件的文件大小 (MB)
   *
   * 用于在处理前检查文件大小，避免处理过大的扫描版 PDF
   *
   * @param item Zotero 文献条目对象
   * @returns 文件大小 (MB), 如果无法获取则返回 0
   */
  public static async getPdfFileSize(item: Zotero.Item): Promise<number> {
    try {
      const attachments = item.getAttachments();
      if (attachments.length === 0) {
        return 0;
      }

      // 获取所有 PDF 附件并按添加时间排序，取最早的一个
      const pdfAttachments: Zotero.Item[] = [];

      for (const attachmentID of attachments) {
        const attachment = await Zotero.Items.getAsync(attachmentID);
        if (attachment.attachmentContentType === "application/pdf") {
          pdfAttachments.push(attachment);
        }
      }

      if (pdfAttachments.length === 0) {
        return 0;
      }

      // 按 dateAdded 升序排序 (最早的在前)
      const pdfAttachment = pdfAttachments.sort((a, b) => {
        const dateA = new Date(a.dateAdded).getTime();
        const dateB = new Date(b.dateAdded).getTime();
        return dateA - dateB;
      })[0];

      // 获取 PDF 文件路径
      const pdfPath = await pdfAttachment.getFilePathAsync();
      if (!pdfPath) {
        return 0;
      }

      // 获取文件大小 (字节)
      const fileInfo = await IOUtils.stat(pdfPath);
      // 转换为 MB
      return (fileInfo.size ?? 0) / (1024 * 1024);
    } catch (error) {
      ztoolkit.log("[PDFExtractor] 获取 PDF 文件大小时出错:", error);
      return 0;
    }
  }

  /**
   * 从 Zotero 条目中提取 PDF 全文
   *
   * 这是模块的主入口函数,协调整个文本提取流程
   *
   * 执行流程:
   * 1. 获取条目的所有附件
   * 2. 筛选出 PDF 类型的附件
   * 3. 从 PDF 附件中提取文本内容 
   *    3.1 使用Zotero全文索引直接提取文本
   *    3.2 依赖MinerU API提取文本， 需提供MinerU API Key
   * 4. 验证文本有效性
   *
   *
   * 错误处理:
   * - 无附件:抛出明确的错误信息
   * - 无 PDF:提示用户附件类型不匹配
   * - 空文本:可能是纯图像 PDF 或提取失败
   *
   * @param item Zotero 文献条目对象
   * @returns 提取的 PDF 全文内容
   * @throws 当无法提取文本时抛出错误
   *
   * @example
   * ```typescript
   * const item = Zotero.Items.get(itemId);
   * const fullText = await PDFExtractor.extractTextFromItem(item);
   * console.log(`提取了 ${fullText.length} 个字符`);
   * ```
   */
  public static async extractTextFromItem(item: Zotero.Item): Promise<string> {
    // 第一步:获取条目的所有附件 ID
    const attachments = item.getAttachments();

    if (attachments.length === 0) {
      throw new Error("No attachments found for this item");
    }

    // 策略修改: 获取所有 PDF 并按添加时间排序，取最早的一个 (通常是原文)
    const pdfAttachments: Zotero.Item[] = [];

    for (const attachmentID of attachments) {
      const attachment = await Zotero.Items.getAsync(attachmentID);
      // 检查附件的 MIME 类型是否为 PDF
      if (attachment.attachmentContentType === "application/pdf") {
        pdfAttachments.push(attachment);
      }
    }

    if (pdfAttachments.length === 0) {
      throw new Error("No PDF attachment found for this item");
    }

    // 按 dateAdded 升序排序 (最早的在前)
    // 假设 dateAdded 是 ISO 字符串，可以直接比较字符串或转换为 Date
    const pdfAttachment = pdfAttachments.sort((a, b) => {
      const dateA = new Date(a.dateAdded).getTime();
      const dateB = new Date(b.dateAdded).getTime();
      return dateA - dateB;
    })[0];

    ztoolkit.log(
      `[AI Butler] Selected oldest PDF: ${pdfAttachment.getField("title")} (Added: ${pdfAttachment.dateAdded})`,
    );

    // 第三步:从 PDF 附件中提取文本
    const currentPdfMode = (getPref("pdfProcessMode") as string) || "base64";
    const mineruApiKey = (getPref("mineruApiKey") as string) || "";
    // 若选择 MinerU API 模式且已配置 API Key，则使用 MinerU API 提取文本
    if (
      currentPdfMode === "mineru" &&
      mineruApiKey &&
      mineruApiKey.trim().length > 0
    ) {
      ztoolkit.log(
        "[AI Butler] MinerU pdf process mode selected and API Key detected, routing to MineruClient for extraction...",
      );
      try {
        const { MineruClient } = await import("./mineruIntegration");
        return await MineruClient.extractMarkdown(item);
      } catch (e) {
        ztoolkit.log(
          "[AI Butler] MinerU extraction failed, returning to Zotero built-in extraction",
          e,
        );
      }
    }

    // 若选择 Zotero 全文索引模式或MinerU失效，则使用 Zotero 全文索引提取文本
    const text = await this.extractTextFromPDF(pdfAttachment);

    // 第四步:验证文本有效性
    if (!text || text.trim().length === 0) {
      throw new Error("Failed to extract text from PDF or PDF is empty");
    }

    return text;
  }

  /**
   * 从 PDF 附件中提取文本内容
   *
   * 利用 Zotero 的全文索引系统提取 PDF 文本
   *
   * 工作原理:
   * 1. 检查 PDF 是否已被索引
   * 2. 如果未索引,触发全文索引并等待完成
   * 3. 读取索引缓存文件,获取提取的文本
   *
   * 技术优势:
   * - 复用 Zotero 的全文索引,无需重复解析
   * - 支持多种 PDF 格式和编码
   * - 性能优化:已索引的文件直接读取缓存
   *
   * @param pdfAttachment PDF 附件条目对象
   * @returns 提取的文本内容
   * @throws 当文本提取失败时抛出错误
   *
   * @private
   */
  private static async extractTextFromPDF(
    pdfAttachment: Zotero.Item,
  ): Promise<string> {
    try {
      // 获取 PDF 文件的本地路径
      const path = await pdfAttachment.getFilePathAsync();
      if (!path) {
        throw new Error("PDF file path not found");
      }

      // 检查全文索引状态
      const indexedState = await Zotero.Fulltext.getIndexedState(pdfAttachment);

      // 如果未索引,触发索引操作
      if (indexedState !== Zotero.Fulltext.INDEX_STATE_INDEXED) {
        await Zotero.Fulltext.indexItems([pdfAttachment.id]);

        // 等待索引完成
        // 索引是异步操作,需要给系统一些时间处理
        await Zotero.Promise.delay(1000);
      }

      // 读取全文缓存文件
      const cacheFile = Zotero.Fulltext.getItemCacheFile(pdfAttachment);

      // 检查缓存文件是否存在
      if (await IOUtils.exists(cacheFile.path)) {
        // 读取缓存文件内容
        const content = await Zotero.File.getContentsAsync(cacheFile.path);

        if (!content) {
          throw new Error("Empty cache file");
        }

        // 处理不同的内容类型(字符串或二进制)
        const text =
          typeof content === "string"
            ? content
            : new TextDecoder().decode(content as BufferSource);

        // 验证提取的文本
        if (text && text.trim().length > 0) {
          return text;
        }
      }

      // 所有尝试都失败
      throw new Error("Unable to extract text from PDF");
    } catch (error: any) {
      throw new Error(`PDF text extraction failed: ${error.message}`);
    }
  }

  /**
   * 清理和格式化提取的文本
   *
   * PDF 提取的原始文本通常包含大量噪音和格式问题
   * 此函数执行多级清理以提高文本质量
   *
   * 清理操作:
   * 1. 规范化空白字符:将多个连续空格合并为一个
   * 2. 移除控制字符:删除不可见的特殊字符
   * 3. 统一换行符:将各种换行符转换为 \n
   * 4. 压缩空行:将多个连续空行压缩为最多两个
   * 5. 修剪首尾空白
   *
   * 典型的 PDF 伪影:
   * - 页眉页脚重复
   * - 分栏导致的文本交错
   * - 连字符断行
   * - 不可见字符和格式标记
   *
   * @param text 原始 PDF 提取文本
   * @returns 清理后的文本
   *
   * @example
   * ```typescript
   * const rawText = await extractTextFromPDF(attachment);
   * const cleanText = PDFExtractor.cleanText(rawText);
   * ```
   */
  public static cleanText(text: string): string {
    // 步骤1:规范化空白字符
    // 将制表符、多个空格等统一为单个空格
    text = text.replace(/\s+/g, " ");

    // 步骤2:移除控制字符
    // 删除 ASCII 控制字符范围内的字符(除了换行和回车)
    // 这些字符在文本处理中通常是无用的
    // eslint-disable-next-line no-control-regex
    text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "");

    // 步骤3:统一换行符
    // Windows (\r\n) -> Unix (\n)
    text = text.replace(/\r\n/g, "\n");
    // Mac (\r) -> Unix (\n)
    text = text.replace(/\r/g, "\n");

    // 步骤4:压缩多余空行
    // 将三个或更多连续换行符压缩为两个(保留段落分隔)
    text = text.replace(/\n{3,}/g, "\n\n");

    // 步骤5:修剪首尾空白
    return text.trim();
  }

  /**
   * 截断文本以适应 API 长度限制
   *
   * 大多数 API 对输入文本长度有限制
   * 此函数智能截断文本,尽可能保持语义完整性
   *
   * 截断策略:
   * 1. 如果文本长度在限制内,直接返回
   * 2. 如果超出限制,尝试在句子边界截断
   * 3. 如果句子边界过远,在指定长度处强制截断
   *
   * 句子边界识别:
   * - 查找最后一个句号位置
   * - 确保句号不是在文本开头附近(避免过度截断)
   * - 保留至少 80% 的目标长度
   *
   * @param text 待截断的文本
   * @param maxLength 最大允许长度,默认 100,000 字符
   * @returns 截断后的文本
   *
   * @example
   * ```typescript
   * const longText = "很长的文本...";
   * const truncated = PDFExtractor.truncateText(longText, 50000);
   * console.log(`原文 ${longText.length} 字符,截断为 ${truncated.length} 字符`);
   * ```
   */
  public static truncateText(text: string, maxLength: number = 100000): string {
    // 文本长度在限制内,无需截断
    if (text.length <= maxLength) {
      return text;
    }

    // 初步截断到最大长度
    const truncated = text.substring(0, maxLength);

    // 尝试在句子边界截断,提高可读性
    const lastPeriod = truncated.lastIndexOf(".");

    // 如果找到了句号,且位置合理(在后 20% 范围内)
    // 则在句号处截断,保持句子完整性
    if (lastPeriod > maxLength * 0.8) {
      return truncated.substring(0, lastPeriod + 1);
    }

    // 无法找到合适的句子边界,添加省略号标记
    return truncated + "...";
  }

  /**
   * 将 PDF 文件转换为 Base64 编码字符串
   *
   * 用于支持多模态大模型(如 Gemini)直接处理 PDF 文件
   * Base64 编码后的 PDF 可以直接发送给 API,保留完整的文档信息
   * 包括图片、表格、公式等文本提取无法获取的内容
   *
   * @param item Zotero 文献条目对象
   * @returns Base64 编码的 PDF 字符串
   * @throws 当无法读取 PDF 文件时抛出错误
   *
   * @example
   * ```typescript
   * const item = Zotero.Items.get(itemId);
   * const base64Pdf = await PDFExtractor.extractBase64FromItem(item);
   * // 发送给 API: { mimeType: "application/pdf", data: base64Pdf }
   * ```
   */
  public static async extractBase64FromItem(
    item: Zotero.Item,
  ): Promise<string> {
    // 第一步: 获取条目的所有附件 ID
    const attachments = item.getAttachments();

    if (attachments.length === 0) {
      throw new Error("No attachments found for this item");
    }

    // 策略修改: 获取所有 PDF 并按添加时间排序，取最早的一个
    const pdfAttachments: Zotero.Item[] = [];

    for (const attachmentID of attachments) {
      const attachment = await Zotero.Items.getAsync(attachmentID);
      if (attachment.attachmentContentType === "application/pdf") {
        pdfAttachments.push(attachment);
      }
    }

    if (pdfAttachments.length === 0) {
      throw new Error("No PDF attachment found for this item");
    }

    // 按 dateAdded 升序排序
    const pdfAttachment = pdfAttachments.sort((a, b) => {
      const dateA = new Date(a.dateAdded).getTime();
      const dateB = new Date(b.dateAdded).getTime();
      return dateA - dateB;
    })[0];

    ztoolkit.log(
      `[AI Butler] Selected oldest PDF (Base64): ${pdfAttachment.getField("title")} (Added: ${pdfAttachment.dateAdded})`,
    );

    // 第三步: 获取 PDF 文件路径
    const pdfPath = await pdfAttachment.getFilePathAsync();
    if (!pdfPath) {
      throw new Error("Failed to get PDF file path");
    }

    // 第四步: 读取 PDF 文件内容
    try {
      // 使用 Zotero 的 File.readAsync 读取二进制文件
      const pdfData = await Zotero.File.getBinaryContentsAsync(pdfPath);

      if (!pdfData || pdfData.length === 0) {
        throw new Error("PDF file is empty or cannot be read");
      }

      // 第五步: 转换为 Base64 编码
      // pdfData 是字符串形式的二进制数据,需要转换为字节数组
      const bytes = new Uint8Array(pdfData.length);
      for (let i = 0; i < pdfData.length; i++) {
        bytes[i] = pdfData.charCodeAt(i);
      }

      // 使用 btoa 函数进行 Base64 编码
      let binary = "";
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64String = btoa(binary);

      return base64String;
    } catch (error: any) {
      throw new Error(`Failed to read or encode PDF: ${error.message}`);
    }
  }
}
