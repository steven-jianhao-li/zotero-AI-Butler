import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { URL } from "node:url";
import vm from "node:vm";
import { transformSync } from "esbuild";
import katex from "katex";

const root = new URL("../", import.meta.url);
const require = createRequire(
  new URL("../zotero-plugin.config.ts", import.meta.url),
);
const compiled = transformSync(
  await readFile(new URL("zotero-plugin.config.ts", root), "utf8"),
  { loader: "ts", format: "cjs" },
);
const module = { exports: {} };
vm.runInNewContext(compiled.code, {
  module,
  exports: module.exports,
  process,
  require: (specifier) =>
    specifier === "zotero-plugin-scaffold"
      ? { defineConfig: (config) => config }
      : require(specifier),
});

test("build bundles renderer-matched KaTeX CSS and fonts before legacy copies", async () => {
  const parent = new URL(".scaffold/katex-tests/", root);
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(new URL("build-", parent));
  const content = path.join(directory, "addon", "content");
  try {
    await mkdir(path.join(content, "scripts"), { recursive: true });
    await writeFile(
      path.join(content, "scripts", "compatibility.js"),
      "var legacy = true;",
    );
    await cp(
      new URL("addon/content/katex.min.css", root),
      path.join(content, "katex.min.css"),
    );
    await cp(
      new URL("addon/content/fonts/", root),
      path.join(content, "fonts"),
      { recursive: true },
    );
    await module.exports.default.build.hooks["build:bundle"]({
      dist: directory,
    });

    const expectedCss = await readFile(
      require.resolve("katex/dist/katex.min.css"),
      "utf8",
    );
    const rendered = katex.renderToString("h_0=203\\,\\mathrm{nm}", {
      output: "html",
    });
    assert.match(rendered, /class="katex-base"/);
    for (const directoryName of ["content", "legacy/content"]) {
      const bundled = path.join(directory, "addon", directoryName);
      const css = await readFile(path.join(bundled, "katex.min.css"), "utf8");
      const cssVersion = css.match(
        /\.katex-version\s*::?after\s*\{[^}]*content:\s*["']([^"']+)/,
      )?.[1];
      assert.equal(
        cssVersion,
        katex.version,
        `${directoryName}: stylesheet must match renderer`,
      );
      assert.equal(css, expectedCss);
      for (const selector of [".katex .katex-base", ".katex .katex-strut"]) {
        const rules = Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g));
        assert.ok(
          rules.some(
            ([, selectors, declarations]) =>
              selectors
                .split(",")
                .map((entry) => entry.trim())
                .includes(selector) &&
              /display:\s*inline-block/.test(declarations),
          ),
          `${selector} must establish its layout box`,
        );
      }
      for (const [, filename] of css.matchAll(/url\(fonts\/([^)]*)\)/g)) {
        assert.deepEqual(
          await readFile(path.join(bundled, "fonts", filename)),
          await readFile(require.resolve(`katex/dist/fonts/${filename}`)),
          `${directoryName}: ${filename} must match the installed renderer`,
        );
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
