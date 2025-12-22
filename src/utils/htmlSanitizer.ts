/**
 * HTML 清理工具模块
 *
 * 提供 HTML 内容清理功能，用于移除可能导致 innerHTML 操作失败的无效字符
 *
 * @module htmlSanitizer
 */

/**
 * 清理 HTML 字符串中的无效字符
 *
 * 移除可能导致 `innerHTML` 赋值时抛出 `InvalidCharacterError` 的字符：
 * - Unicode 控制字符 (U+0000-U+001F，除了合法的空白字符 \t, \n, \r)
 * - Unicode 控制字符 (U+007F-U+009F)
 * - 孤立的 Unicode 代理对 (U+D800-U+DFFF)
 * - NULL 字符 (U+0000)
 *
 * @param html 原始 HTML 字符串
 * @returns 清理后的 HTML 字符串
 *
 * @example
 * ```typescript
 * const safeHtml = sanitizeForInnerHTML(unsafeContent);
 * element.innerHTML = safeHtml;
 * ```
 */
export function sanitizeForInnerHTML(html: string): string {
  if (!html) return html;

  // 记录是否有内容被清理（用于调试）
  let hasCleaned = false;

  // 清理后的结果
  let result = html;

  // 1. 移除 NULL 字符 (U+0000) - 这是最常见的问题字符
  // 使用 includes + replace 而不是直接在正则中使用控制字符
  if (result.includes("\u0000")) {
    result = result.split("\u0000").join("");
    hasCleaned = true;
  }

  // 2. 移除其他 C0 控制字符 (U+0001-U+0008, U+000B, U+000C, U+000E-U+001F)
  // 保留: \t (U+0009), \n (U+000A), \r (U+000D)
  // eslint-disable-next-line no-control-regex
  const c0ControlChars = /[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g;
  if (c0ControlChars.test(result)) {
    c0ControlChars.lastIndex = 0; // Reset regex state after test()
    result = result.replace(c0ControlChars, "");
    hasCleaned = true;
  }

  // 3. 移除 C1 控制字符 (U+007F-U+009F)
  const c1ControlChars = /[\u007F-\u009F]/g;
  if (c1ControlChars.test(result)) {
    c1ControlChars.lastIndex = 0;
    result = result.replace(c1ControlChars, "");
    hasCleaned = true;
  }

  // 4. 移除孤立的 Unicode 代理对 (U+D800-U+DFFF)
  // 这些字符在 UTF-16 中用于表示 BMP 外的字符，但孤立出现时是无效的
  const loneSurrogates =
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
  if (loneSurrogates.test(result)) {
    loneSurrogates.lastIndex = 0;
    result = result.replace(loneSurrogates, "");
    hasCleaned = true;
  }

  // 5. 移除其他可能导致问题的特殊 Unicode 字符
  // - U+FFFE, U+FFFF: 非字符 (noncharacters)
  const nonChars = /[\uFFFE\uFFFF]/g;
  if (nonChars.test(result)) {
    nonChars.lastIndex = 0;
    result = result.replace(nonChars, "");
    hasCleaned = true;
  }

  // 调试日志：如果有内容被清理
  if (hasCleaned && typeof ztoolkit !== "undefined") {
    try {
      ztoolkit.log(
        "[AI-Butler] sanitizeForInnerHTML: 已清理无效字符，原长度:",
        html.length,
        "新长度:",
        result.length,
      );
    } catch {
      // 忽略日志错误
    }
  }

  return result;
}
