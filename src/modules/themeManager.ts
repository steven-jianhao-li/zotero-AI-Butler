/**
 * ================================================================
 * Markdown 主题管理模块
 * ================================================================
 *
 * 管理 Markdown 渲染的 CSS 主题
 * 支持内置主题和用户自定义主题
 *
 * @module themeManager
 * @author AI-Butler Team
 */

import { config } from "../../package.json";
import { getPref, setPref } from "../utils/prefs";

// 内置主题列表
const BUILTIN_THEMES = [
  { id: "github", name: "GitHub", file: "github.css" },
  { id: "redstriking", name: "红印 (Redstriking)", file: "redstriking.css" },
  // 可以在这里添加更多内置主题
];

// 默认主题
const DEFAULT_THEME = "github";

/**
 * 主题管理器
 */
export class ThemeManager {
  private static instance: ThemeManager;
  private currentTheme: string = DEFAULT_THEME;
  private cachedCss: Map<string, string> = new Map();

  private constructor() {
    this.currentTheme =
      (getPref("markdownTheme" as any) as string) || DEFAULT_THEME;
  }

  /**
   * 获取单例实例
   */
  public static getInstance(): ThemeManager {
    if (!ThemeManager.instance) {
      ThemeManager.instance = new ThemeManager();
    }
    return ThemeManager.instance;
  }

  /**
   * 获取所有可用主题列表
   */
  public getAvailableThemes(): Array<{ id: string; name: string }> {
    return BUILTIN_THEMES.map((t) => ({ id: t.id, name: t.name }));
  }

  /**
   * 获取当前主题 ID
   */
  public getCurrentTheme(): string {
    return this.currentTheme;
  }

  /**
   * 设置当前主题
   */
  public setCurrentTheme(themeId: string): void {
    this.currentTheme = themeId;
    setPref("markdownTheme" as any, themeId as any);
  }

  /**
   * 加载主题 CSS
   */
  public async loadThemeCss(themeId?: string): Promise<string> {
    const theme = themeId || this.currentTheme;

    // 检查缓存
    if (this.cachedCss.has(theme)) {
      return this.cachedCss.get(theme)!;
    }

    // 查找内置主题
    const builtinTheme = BUILTIN_THEMES.find((t) => t.id === theme);
    if (builtinTheme) {
      const cssUrl = `chrome://${config.addonRef}/content/markdown_themes/${builtinTheme.file}`;
      const css = await this.fetchCss(cssUrl);
      this.cachedCss.set(theme, css);
      return css;
    }

    // 主题不存在，返回默认主题
    return this.loadThemeCss(DEFAULT_THEME);
  }

  /**
   * 加载 KaTeX CSS
   */
  public async loadKatexCss(): Promise<string> {
    const cacheKey = "__katex__";
    if (this.cachedCss.has(cacheKey)) {
      return this.cachedCss.get(cacheKey)!;
    }

    const cssUrl = `chrome://${config.addonRef}/content/katex.min.css`;
    const css = await this.fetchCss(cssUrl);
    this.cachedCss.set(cacheKey, css);
    return css;
  }

  /**
   * 获取 CSS 内容
   */
  private async fetchCss(url: string): Promise<string> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch CSS: ${response.status}`);
      }
      return await response.text();
    } catch (error) {
      ztoolkit.log("[AI-Butler] 加载主题 CSS 失败:", error);
      return "";
    }
  }

  /**
   * 生成适配侧边栏的 CSS
   * 调整为适合狭窄侧边栏的样式
   */
  public adaptCssForSidebar(css: string): string {
    // 替换 body 选择器为容器选择器
    let adapted = css.replace(/body\s*\{/g, ".ai-butler-note-content {");

    // 替换 Typora 专用的 #write 选择器
    adapted = adapted.replace(/#write\s*/g, ".ai-butler-note-content ");
    adapted = adapted.replace(/#write\{/g, ".ai-butler-note-content{");

    // 调整 .markdown-body 的 padding（侧边栏空间有限）
    adapted = adapted.replace(
      /\.markdown-body\s*\{([^}]*?)padding:\s*45px;/g,
      ".markdown-body { $1 padding: 12px;",
    );

    // 调整 max-width
    adapted = adapted.replace(/max-width:\s*\d+px;/g, "max-width: 100%;");

    // 移除外部字体引用（可能无法加载）
    adapted = adapted.replace(
      /@font-face\s*\{[^}]*url\([^)]*\.woff2[^)]*\)[^}]*\}/g,
      "",
    );

    // 添加数学公式样式 - 横向滚动，完整高度显示
    const mathStyles = `
/* 公式容器样式 - 宽度限制，横向滚动 */
.ai-butler-note-content .katex-display,
.ai-butler-note-content .katex-block {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  overflow-y: visible;
  padding: 12px 0;
  margin: 8px 0;
  /* 自定义横向滚动条样式 */
  scrollbar-width: thin;
  scrollbar-color: #888 #f0f0f0;
}
.ai-butler-note-content .katex-display::-webkit-scrollbar,
.ai-butler-note-content .katex-block::-webkit-scrollbar {
  height: 8px;
}
.ai-butler-note-content .katex-display::-webkit-scrollbar-track,
.ai-butler-note-content .katex-block::-webkit-scrollbar-track {
  background: #f0f0f0;
  border-radius: 4px;
}
.ai-butler-note-content .katex-display::-webkit-scrollbar-thumb,
.ai-butler-note-content .katex-block::-webkit-scrollbar-thumb {
  background: #888;
  border-radius: 4px;
}
.ai-butler-note-content .katex-display::-webkit-scrollbar-thumb:hover,
.ai-butler-note-content .katex-block::-webkit-scrollbar-thumb:hover {
  background: #555;
}

.ai-butler-note-content .katex-inline {
  display: inline;
  vertical-align: baseline;
}

.ai-butler-note-content .katex {
  font-size: 1.1em;
  white-space: nowrap;
}

/* 确保公式完整显示高度 */
.ai-butler-note-content .katex .base {
  display: inline-block;
  vertical-align: baseline;
}
.ai-butler-note-content .katex-html {
  white-space: nowrap;
}

/* 暗色模式下的文字颜色修正 */
@media (prefers-color-scheme: dark) {
  .ai-butler-note-content,
  .ai-butler-note-content p,
  .ai-butler-note-content li,
  .ai-butler-note-content h1,
  .ai-butler-note-content h2,
  .ai-butler-note-content h3,
  .ai-butler-note-content h4,
  .ai-butler-note-content h5,
  .ai-butler-note-content h6,
  .ai-butler-note-content blockquote,
  .ai-butler-note-content td,
  .ai-butler-note-content th {
    color: #e0e0e0 !important;
  }
  .ai-butler-note-content {
    background-color: #1e1e1e !important;
  }
  .ai-butler-note-content code {
    background-color: #2d2d2d !important;
    color: #e0e0e0 !important;
  }
  .ai-butler-note-content pre {
    background-color: #2d2d2d !important;
  }
  .ai-butler-note-content blockquote {
    background-color: rgba(255, 255, 255, 0.05) !important;
    border-left-color: #666 !important;
  }
  .ai-butler-note-content table tr:nth-child(2n),
  .ai-butler-note-content thead {
    background-color: rgba(255, 255, 255, 0.05) !important;
  }
  .ai-butler-note-content hr {
    background-color: #444 !important;
  }
}
`;
    adapted += mathStyles;

    return adapted;
  }

  /**
   * 清除缓存
   */
  public clearCache(): void {
    this.cachedCss.clear();
  }
}

// 导出单例
export const themeManager = ThemeManager.getInstance();
