import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const directory = path.resolve(".scaffold/task-queue-tests");
await mkdir(directory, { recursive: true });
const outfile = path.join(directory, "queue-suite.cjs");
await build({
  stdin: {
    contents: ["taskQueue.artifact-requeue", "taskQueue.batch-enqueue"]
      .map((name) => `import './test/${name}.test.ts';`)
      .join("\n"),
    resolveDir: process.cwd(),
    loader: "ts",
  },
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  define: { __env__: '"test"' },
  // Imports initialize the theme singleton and the older artifact suite uses prefs.
  // All preferences stay in memory; neither Zotero nor API requests are started.
  banner: {
    js: `const fixturePrefs = new Map();
globalThis.Zotero = { Prefs: {
  get: (key) => fixturePrefs.get(key),
  set: (key, value) => fixturePrefs.set(key, value),
  clear: (key) => fixturePrefs.delete(key),
} };
globalThis.addon = { data: {} };
globalThis.ztoolkit = { log() {} };`,
  },
  logLevel: "silent",
});
const result = spawnSync(
  process.execPath,
  [
    "node_modules/mocha/bin/mocha.js",
    outfile,
    "--timeout",
    "15000",
    ...process.argv.slice(2),
  ],
  { stdio: "inherit" },
);
process.exitCode = result.status ?? 1;
