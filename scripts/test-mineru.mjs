import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const directory = path.resolve(".scaffold/mineru-tests");
await mkdir(directory, { recursive: true });
const outfile = path.join(directory, "mineru-suite.cjs");
await build({
  entryPoints: ["test/mineruIntegration.test.ts"],
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  define: { __env__: '"test"' },
  logLevel: "silent",
});
const result = spawnSync(
  process.execPath,
  ["node_modules/mocha/bin/mocha.js", outfile, "--timeout", "15000"],
  { stdio: "inherit" },
);
process.exitCode = result.status ?? 1;
