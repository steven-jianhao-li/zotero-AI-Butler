import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  copyFile,
} from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import AdmZip from "adm-zip";
import { build } from "esbuild";
import { createServer } from "node:http";

const executable = process.argv[2];
if (!executable)
  throw new Error(
    "Usage: node scripts/test-zotero-compat.mjs <isolated-zotero-executable>",
  );
const parent = path.resolve(".scaffold/host-tests");
await mkdir(parent, { recursive: true });
const directory = await mkdtemp(path.join(parent, "run-"));
const profile = path.join(directory, "profile");
const library = path.join(directory, "library");
const extensions = path.join(profile, "extensions");
const probe = path.join(directory, "probe");
await mkdir(probe, { recursive: true });
await mkdir(extensions, { recursive: true });
await mkdir(library);
await copyFile(
  process.argv[3] || ".scaffold/build/zotero-ai-butler.xpi",
  path.join(extensions, "zotero-ai-butler@github.com.xpi"),
);
const prefs = {
  "extensions.logging.enabled": true,
  "extensions.autoDisableScopes": 0,
  "extensions.enabledScopes": 15,
  "extensions.zotero.dataDir": library,
  "extensions.zotero.useDataDir": true,
  "extensions.zotero.firstRun.skipFirefoxProfileAccessCheck": true,
  "extensions.zotero.aiButler.onboardingTutorialSeenVersion": "1",
  "extensions.zotero.aiButler.autoScan": false,
  "extensions.zotero.aiButler.noteExportEnabled": false,
  "extensions.zotero.sync.autoSync": false,
  "extensions.zotero.automaticScraperUpdates": false,
  // A fresh test profile must never install integrations into the user's Office folders.
  "extensions.zoteroWinWordIntegration.skipInstallation": true,
  "extensions.zoteroMacWordIntegration.skipInstallation": true,
  "extensions.zoteroOpenOfficeIntegration.skipInstallation": true,
  "app.update.enabled": false,
  "extensions.update.enabled": false,
  "xpinstall.signatures.required": false,
};
await writeFile(
  path.join(profile, "user.js"),
  Object.entries(prefs)
    .map(
      ([key, value]) =>
        "user_pref(" +
        JSON.stringify(key) +
        ", " +
        JSON.stringify(value) +
        ");",
    )
    .join("\n"),
);
await writeFile(
  path.join(probe, "install.rdf"),
  '<?xml version="1.0"?><RDF xmlns="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:em="http://www.mozilla.org/2004/em-rdf#"><Description about="urn:mozilla:install-manifest"><em:id>ai-butler-compat-probe@example.org</em:id><em:name>Compatibility probe</em:name><em:version>1.0</em:version><em:type>2</em:type><em:bootstrap>true</em:bootstrap><em:targetApplication><Description><em:id>zotero@chnm.gmu.edu</em:id><em:minVersion>6.0.27</em:minVersion><em:maxVersion>6.*</em:maxVersion></Description></em:targetApplication></Description></RDF>',
);
const probeManifest = JSON.parse(
  await readFile(".scaffold/build/addon/manifest.json", "utf8"),
);
probeManifest.name = "Compatibility probe";
probeManifest.applications.zotero.id = "ai-butler-compat-probe@example.org";
probeManifest.applications.zotero.update_url =
  "https://example.invalid/compatibility-probe.json";
delete probeManifest.icons;
await writeFile(
  path.join(probe, "manifest.json"),
  JSON.stringify(probeManifest),
);
const reportPath = path.join(directory, "report.json");
const epubProbe = path.join(probe, "epub-probe.js");
await build({
  entryPoints: ["test/epubHost.ts"],
  outfile: epubProbe,
  bundle: true,
  format: "iife",
  globalName: "EPUBProbe",
  target: "firefox60",
  logLevel: "silent",
});
const epubFixture = path.join(directory, "fixture.epub");
const epubZip = new AdmZip();
for (const [name, content] of Object.entries({
  mimetype: "application/epub+zip",
  "META-INF/container.xml":
    '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  "OEBPS/content.opf":
    '<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="fixture"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>EPUB regression fixture</dc:title><dc:identifier id="fixture">fixture</dc:identifier><dc:language>zh</dc:language></metadata><manifest><item id="second" href="a-second.xhtml" media-type="application/xhtml+xml"/><item id="first" href="z-first.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="first"/><itemref idref="second"/></spine></package>',
  "OEBPS/z-first.xhtml":
    '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Fixture</title></head><body><h1>第一章</h1><p>FIRST_SECTION</p><style>HIDDEN_STYLE</style><script>HIDDEN_SCRIPT</script></body></html>',
  "OEBPS/a-second.xhtml":
    '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Fixture</title></head><body><h1>第二章</h1><p>SECOND_SECTION</p></body></html>',
})) {
  epubZip.addFile(name, Buffer.from(content));
}
epubZip.writeZip(epubFixture);
const citationProbe = path.join(probe, "agent-citations.js");
await build({
  stdin: {
    contents:
      "export * from './src/modules/views/agent/AgentMarkdown'; export { runAgentUIHostChecks } from './test/agentUIHost';",
    resolveDir: process.cwd(),
    loader: "ts",
  },
  outfile: citationProbe,
  bundle: true,
  format: "iife",
  globalName: "AgentCitationProbe",
  target: "es2018",
  define: { __env__: '"test"' },
  logLevel: "silent",
});
// The final chunk is withheld until Gecko acknowledges a visible partial reply.
// A buffered-only implementation therefore cannot pass this real transport check.
let pendingStream;
const streamFixture = createServer((request, response) => {
  if (request.url === "/ack") {
    response.end("ok");
    if (pendingStream) {
      pendingStream.end(
        'data: {"choices":[{"index":0,"delta":{"content":" reply"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      );
      pendingStream = undefined;
    }
    return;
  }
  request.resume();
  if (request.url !== "/v1/chat/completions") {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
  });
  pendingStream = response;
  response.write(
    'data: {"choices":[{"index":0,"delta":{"role":"assistant","reasoning_content":"Checking.","content":"Live"},"finish_reason":null}]}\n\n',
  );
  const timeout = setTimeout(() => response.destroy(), 10000);
  response.on("close", () => {
    clearTimeout(timeout);
    if (pendingStream === response) pendingStream = undefined;
  });
});
await new Promise((resolve) => streamFixture.listen(0, "127.0.0.1", resolve));
streamFixture.unref();
const streamFixtureUrl = `http://127.0.0.1:${streamFixture.address().port}`;
// Legacy bootstrap loaders may interpret source bytes as Latin-1. Keep paths
// ASCII in generated JavaScript so workspaces with Chinese names remain valid.
const jsString = (value) =>
  JSON.stringify(value).replace(
    /[\u0080-\uffff]/g,
    (character) =>
      "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"),
  );
await writeFile(
  path.join(probe, "bootstrap.js"),
  "var REPORT_PATH = " +
    jsString(reportPath) +
    ";\nvar EPUB_PROBE_PATH = " +
    jsString(epubProbe) +
    ";\nvar EPUB_FIXTURE_PATH = " +
    jsString(epubFixture) +
    ";\nvar AGENT_CITATION_PROBE_PATH = " +
    jsString(citationProbe) +
    ";\nvar AGENT_STREAM_FIXTURE_URL = " +
    jsString(streamFixtureUrl) +
    ";\n" +
    (await readFile("test/host-smoke.js", "utf8")),
);
const probeZip = new AdmZip();
probeZip.addLocalFolder(probe);
probeZip.writeZip(
  path.join(extensions, "ai-butler-compat-probe@example.org.xpi"),
);
const child = spawn(
  executable,
  ["-wait-for-browser", "-no-remote", "-profile", profile, "-ZoteroDebugText"],
  {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      MOZ_CRASHREPORTER_DISABLE: "1",
    },
  },
);
let output = "";
const captureOutput = (chunk) => {
  output += chunk;
  const diagnostic = String(chunk)
    .split("\n")
    .filter((line) =>
      /AI_BUTLER_PROBE:|invalid manifest|Extension is invalid/i.test(line),
    );
  if (diagnostic.length) console.log(diagnostic.join("\n"));
};
child.stdout.on("data", captureOutput);
child.stderr.on("data", captureOutput);
let timedOut = false;
const timeout = setTimeout(() => {
  timedOut = true;
  if (process.platform === "win32") {
    const terminator = spawn(
      "taskkill",
      ["/PID", String(child.pid), "/T", "/F"],
      {
        windowsHide: true,
        stdio: "ignore",
      },
    );
    terminator.on("error", (error) => {
      console.error("Unable to stop isolated host: " + error.message);
      child.kill();
    });
  } else child.kill();
}, 180000);
let exitCode;
try {
  exitCode = await new Promise((resolve, reject) => {
    child.on("close", resolve);
    child.on("error", reject);
  });
} finally {
  clearTimeout(timeout);
  streamFixture.closeAllConnections();
  streamFixture.close();
  await writeFile(path.join(directory, "console.log"), output);
}
console.log("Isolated evidence: " + directory);
console.log("Host exit: " + exitCode);
const report = JSON.parse(await readFile(reportPath, "utf8"));
console.log(JSON.stringify(report.checks, null, 2));
const required = [
  "finished",
  "installation",
  "toolbar",
  "hostSpecificSidebar",
  "columns",
  "filesystemBoundary",
  "epubCompatibility",
  "mindmap",
  "settings",
  "cleanup",
  "reenable",
];
if (
  exitCode !== 0 ||
  timedOut ||
  report.checks.failure ||
  required.some((key) => report.checks[key] !== true)
)
  process.exitCode = 1;
