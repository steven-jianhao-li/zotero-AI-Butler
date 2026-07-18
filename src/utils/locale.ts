/**
 * i18n helpers for Zotero AI Butler.
 */

import { config } from "../../package.json";
import { FluentMessageId } from "../../typings/i10n";

export {
  initLocale,
  getString,
  getLocaleID,
  localizeText,
  localizeTitle,
  localizePlaceholder,
  localizeLabel,
  localizeTooltip,
  localizeAttribute,
};

type LocaleArgs = Record<string, unknown>;
type LocaleOptions = { branch?: string | undefined; args?: LocaleArgs };

function initLocale() {
  const LocalizationCtor =
    typeof Localization === "undefined"
      ? ztoolkit.getGlobal("Localization")
      : Localization;

  const l10n = new LocalizationCtor(
    [
      config.addonRef + "-addon.ftl",
      config.addonRef + "-mainWindow.ftl",
      config.addonRef + "-preferences.ftl",
    ],
    true,
  );

  addon.data.locale = {
    current: l10n,
  };
}

function getString(localString: FluentMessageId | string): string;
function getString(
  localString: FluentMessageId | string,
  branch: string,
): string;
function getString(
  localeString: FluentMessageId | string,
  options: LocaleOptions,
): string;
function getString(...inputs: any[]) {
  if (inputs.length === 1) return _getString(inputs[0]);
  if (inputs.length === 2) {
    if (typeof inputs[1] === "string") {
      return _getString(inputs[0], { branch: inputs[1] });
    }
    return _getString(inputs[0], inputs[1]);
  }
  throw new Error("Invalid arguments");
}

function _getString(
  localeString: FluentMessageId | string,
  options: LocaleOptions = {},
): string {
  const rawId = String(localeString);
  const prefixedId = config.addonRef + "-" + rawId;
  const { branch, args } = options;
  const l10n = addon.data.locale?.current;
  if (!l10n) return rawId;

  const hasPatternContent = (pattern: any) =>
    Boolean(pattern?.value) || Boolean(pattern?.attributes?.length);

  const [prefixed] = l10n.formatMessagesSync([{ id: prefixedId, args }]) || [];
  const [raw] = !hasPatternContent(prefixed)
    ? l10n.formatMessagesSync([{ id: rawId, args }]) || []
    : [];
  const pattern = hasPatternContent(prefixed) ? prefixed : raw;
  if (!hasPatternContent(pattern)) return rawId;

  if (branch) {
    for (const attr of pattern.attributes || []) {
      if (attr.name === branch) return attr.value;
    }
    return rawId;
  }
  return pattern.value || rawId;
}

function getLocaleID(id: FluentMessageId | string) {
  return config.addonRef + "-" + id;
}

function localizeText(
  element: Element | null | undefined,
  id: FluentMessageId | string,
  options?: LocaleOptions,
) {
  if (element) element.textContent = getString(id, options || {});
}

function localizeTitle(
  element: Element | null | undefined,
  id: FluentMessageId | string,
  options?: LocaleOptions,
) {
  if (element) element.setAttribute("title", getString(id, options || {}));
}

function localizePlaceholder(
  element: Element | null | undefined,
  id: FluentMessageId | string,
  options?: LocaleOptions,
) {
  if (element) {
    element.setAttribute("placeholder", getString(id, options || {}));
  }
}

function localizeLabel(
  element: Element | null | undefined,
  id: FluentMessageId | string,
  options?: LocaleOptions,
) {
  localizeAttribute(element, "label", id, options);
}

function localizeTooltip(
  element: Element | null | undefined,
  id: FluentMessageId | string,
  options?: LocaleOptions,
) {
  localizeAttribute(element, "tooltiptext", id, options);
}

function localizeAttribute(
  element: Element | null | undefined,
  attribute: string,
  id: FluentMessageId | string,
  options?: LocaleOptions,
) {
  if (element) element.setAttribute(attribute, getString(id, options || {}));
}
