import { cp, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { transform } from "esbuild";
import { transformAsync } from "@babel/core";
import unicodeProperties from "@babel/plugin-transform-unicode-property-regex";
import unicodeSets from "@babel/plugin-transform-unicode-sets-regex";

export async function compileForFirefox60(source) {
  const rewritten = await transformAsync(source, {
    configFile: false,
    babelrc: false,
    plugins: [unicodeSets, unicodeProperties],
    compact: false,
  });
  return (
    await transform(rewritten.code, {
      target: "firefox60",
      legalComments: "inline",
    })
  ).code;
}

export async function buildCompatibility(context) {
  const modernContent = path.join(context.dist, "addon", "content");
  const directory = path.join(context.dist, "addon", "legacy", "content");
  // Retain modern bytes; only the legacy chrome registration serves these copies.
  await cp(modernContent, directory, { recursive: true });
  await unlink(path.join(modernContent, "scripts", "compatibility.js"));
  for (const entry of await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const filename = path.join(entry.parentPath, entry.name);
    if (filename.endsWith(".js")) {
      await writeFile(
        filename,
        await compileForFirefox60(await readFile(filename, "utf8")),
      );
    } else if (filename.endsWith(".html")) {
      let html = await readFile(filename, "utf8");
      const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
      for (const script of scripts) {
        html = html.replace(
          script[0],
          `<script>\n${await compileForFirefox60(script[1])}</script>`,
        );
      }
      html = html.replace(
        /<head>/i,
        '<head><script src="scripts/compatibility.js"></script>',
      );
      await writeFile(filename, html);
    }
  }
}
