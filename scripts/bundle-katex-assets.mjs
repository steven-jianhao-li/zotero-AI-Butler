import { copyFile, cp } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

export async function bundleKatexAssets(dist) {
  const stylesheet = require.resolve("katex/dist/katex.min.css");
  const content = path.join(dist, "addon", "content");
  await copyFile(stylesheet, path.join(content, "katex.min.css"));
  await cp(
    path.join(path.dirname(stylesheet), "fonts"),
    path.join(content, "fonts"),
    {
      recursive: true,
    },
  );
}
