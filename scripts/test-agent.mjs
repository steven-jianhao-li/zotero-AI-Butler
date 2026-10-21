import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const directory = path.resolve(".scaffold/agent-tests");
await mkdir(directory, { recursive: true });
const outfile = path.join(directory, "agent-suite.cjs");
await build({
  stdin: {
    contents: [
      "agentContext",
      "agentRuntime",
      "agentTransport",
      "agentLibraryTools",
      "agentCitations",
      "agentTranscript",
    ]
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
  // Workflow tools import the queue and its theme singleton. Keep startup prefs local.
  banner: {
    js: `globalThis.Zotero = { Prefs: { get() {} } };
globalThis.addon = { data: {} };
globalThis.ztoolkit = { log() {} };`,
  },
  logLevel: "silent",
});
const result = spawnSync(
  process.execPath,
  ["node_modules/mocha/bin/mocha.js", outfile, "--timeout", "15000"],
  { stdio: "inherit" },
);
process.exitCode = result.status ?? 1;
