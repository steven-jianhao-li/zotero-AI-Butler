// 将 markmap 相关依赖打包成单个浏览器可用的 JS 文件
import * as esbuild from "esbuild";
import { writeFileSync } from "fs";
import { join } from "path";

const outDir = "addon/content";

// 创建入口文件内容
const entryContent = `
import * as d3 from "d3";
import { Transformer } from "markmap-lib";
import { Markmap } from "markmap-view";

// 将库挂载到 window 对象上，供 HTML 页面使用
window.d3 = d3;
window.markmap = {
  Transformer,
  Markmap,
};

console.log("[markmap-bundle] 已加载");
`;

// 写入临时入口文件
const entryFile = "scripts/markmap-entry.ts";
writeFileSync(entryFile, entryContent);

// 使用 esbuild 打包
await esbuild.build({
  entryPoints: [entryFile],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  outfile: join(outDir, "markmap-bundle.js"),
  minify: true,
  sourcemap: false,
});

console.log("✅ markmap-bundle.js 已生成到", outDir);
