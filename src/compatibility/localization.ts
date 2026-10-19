import { FluentBundle, FluentResource } from "@fluent/bundle";
import { config } from "../../package.json";

export class LegacyLocalization {
  private bundles: FluentBundle[];

  constructor() {
    const locale = Zotero.locale?.startsWith("zh") ? "zh-CN" : "en-US";
    this.bundles = [...new Set([locale, "en-US"])].map((language) => {
      const bundle = new FluentBundle(language, { useIsolating: false });
      for (const resource of ["addon", "mainWindow", "preferences"]) {
        const source = Zotero.File.getContentsFromURL(
          `${rootURI}locale/${language}/${config.addonRef}-${resource}.ftl`,
        );
        const errors = bundle.addResource(new FluentResource(source));
        if (errors.length) throw errors[0];
      }
      return bundle;
    });
  }

  formatMessagesSync(requests: { id: string; args?: Record<string, any> }[]) {
    return requests.map(({ id, args }) => {
      for (const bundle of this.bundles) {
        const message = bundle.getMessage(id);
        if (!message) continue;
        const errors: Error[] = [];
        const format = (
          pattern: Parameters<FluentBundle["formatPattern"]>[0],
        ) => bundle.formatPattern(pattern, args, errors);
        const formatted = {
          value: message.value ? format(message.value) : null,
          attributes: Object.entries(message.attributes).map(
            ([name, pattern]) => ({ name, value: format(pattern) }),
          ),
        };
        for (const error of errors) Zotero.logError(error);
        return formatted;
      }
      return { value: null, attributes: [] };
    });
  }
}
