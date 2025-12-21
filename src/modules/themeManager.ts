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
        this.currentTheme = (getPref("markdownTheme" as any) as string) || DEFAULT_THEME;
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

        // 调整 .markdown-body 的 padding（侧边栏空间有限）
        adapted = adapted.replace(
            /\.markdown-body\s*\{([^}]*?)padding:\s*45px;/g,
            ".markdown-body { $1 padding: 12px;",
        );

        // 调整 max-width
        adapted = adapted.replace(
            /max-width:\s*980px;/g,
            "max-width: 100%;",
        );

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
