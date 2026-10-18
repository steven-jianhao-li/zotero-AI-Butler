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
await writeFile(
  path.join(probe, "bootstrap.js"),
  "var REPORT_PATH = " +
    JSON.stringify(reportPath) +
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
