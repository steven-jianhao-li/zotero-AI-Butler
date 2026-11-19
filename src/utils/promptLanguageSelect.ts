/**
 * 提示词语言选择项（纯逻辑，便于测试）
 *
 * 控件值 → 选项列表的映射从视图层抽出，避免在 Zotero 6/7 的原生 `<select>`
 * 分支里重复书写，并让顺序/标签/兜底逻辑可以被单测覆盖。
 *
 * @module promptLanguageSelect
 */

import {
  getDefaultPromptLanguagePreference,
  normalizeDefaultPromptLanguage,
  type DefaultPromptLanguage,
} from "./prompts";

export type PromptLanguageOption = {
  value: DefaultPromptLanguage;
  label: string;
};

/** 选项顺序固定：跟随界面语言 → 中文 → English */
export const PROMPT_LANGUAGE_ORDER: readonly DefaultPromptLanguage[] = [
  "auto",
  "zh-CN",
  "en-US",
];

export const PROMPT_LANGUAGE_LABEL_KEYS: Record<DefaultPromptLanguage, string> =
  {
    auto: "settings-prompts-language-auto",
    "zh-CN": "settings-prompts-language-zh",
    "en-US": "settings-prompts-language-en",
  };

/**
 * 构造用于渲染的选项列表。
 *
 * @param translate 本地化函数，通常传入 `getString`
 */
export function getPromptLanguageOptions(
  translate: (key: string) => string,
): PromptLanguageOption[] {
  return PROMPT_LANGUAGE_ORDER.map((value) => ({
    value,
    label: translate(PROMPT_LANGUAGE_LABEL_KEYS[value]),
  }));
}

/**
 * 把任意输入收敛为合法的语言值，用于 `<select>` 的初始选中项。
 * 未知值回退到当前偏好，避免脏数据导致空白选择框。
 */
export function normalizePromptLanguageSelection(
  value: unknown,
  fallback?: DefaultPromptLanguage,
): DefaultPromptLanguage {
  const resolvedFallback = fallback || getDefaultPromptLanguagePreference();
  return normalizeDefaultPromptLanguage(value) || resolvedFallback;
}
