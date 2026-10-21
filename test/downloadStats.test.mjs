import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collectDownloadStats,
  updateDownloadStats,
} from "../scripts/update-download-stats.mjs";

const repository = { owner: "example", repo: "plugin" };
const release = (id, extra = {}) => ({
  id,
  tag_name: `v${id}`,
  draft: false,
  prerelease: false,
  ...extra,
});
const asset = (id, downloads, name = "plugin.xpi") => ({
  id,
  name,
  state: "uploaded",
  download_count: downloads,
});

function fixture(releases, assets, existingBranch = false) {
  const calls = [];
  const github = {
    paginate: {
      async *iterator(route, parameters) {
        calls.push({ route, parameters });
        const items = route.endsWith("/assets")
          ? assets.get(parameters.release_id) || []
          : releases;
        if (items instanceof Error) throw items;
        for (let offset = 0; offset < items.length; offset += 100) {
          yield { data: items.slice(offset, offset + 100) };
        }
      },
    },
    rest: {
      git: {
        async getRef() {
          if (!existingBranch) {
            throw Object.assign(new Error("Not Found"), { status: 404 });
          }
          return { data: { object: { sha: "previous-commit" } } };
        },
        async getCommit() {
          return {
            data: { sha: "previous-commit", tree: { sha: "previous-tree" } },
          };
        },
        ...Object.fromEntries(
          ["createTree", "createCommit", "createRef", "updateRef"].map(
            (method) => [
              method,
              async (parameters) => {
                calls.push({ method, parameters });
                return { data: { sha: `${method}-sha` } };
              },
            ],
          ),
        ),
      },
    },
  };
  return { github, calls };
}

test("counts release and asset pages beyond 100, including prereleases but excluding manifests and drafts", async () => {
  const releases = Array.from({ length: 100 }, (_, index) =>
    release(index + 1),
  );
  releases.push(
    release(101, { prerelease: true }),
    release(102, { draft: true }),
  );
  const assets = new Map([
    [1, [asset(1, 163962), asset(2, 447816, "update.json")]],
    [
      101,
      [
        ...Array.from({ length: 100 }, (_, index) => asset(index + 10, 1)),
        asset(110, 7600, "plugin.XPI"),
        asset(111, 500, "update-beta.json"),
        asset(112, 900, "source.zip"),
        { ...asset(113, 50), state: "starter" },
      ],
    ],
    [102, [asset(200, 1000)]],
  ]);
  const { github, calls } = fixture(releases, assets);
  const stats = await collectDownloadStats(github, repository);

  assert.equal(stats.totalDownloads, 171662);
  assert.equal(stats.releaseCount, 101);
  assert.equal(stats.assetCount, 102);
  assert.equal(stats.releases.at(-1).prerelease, true);
  assert.ok(!calls.some((call) => call.parameters?.release_id === 102));
});

test("does not double count overlapping pages", async () => {
  const { github } = fixture(
    [release(1), release(1), release(2)],
    new Map([
      [1, [asset(1, 7), asset(1, 7)]],
      [2, [asset(2, 3)]],
    ]),
  );
  const stats = await collectDownloadStats(github, repository);
  assert.equal(stats.totalDownloads, 10);
  assert.equal(stats.releaseCount, 2);
  assert.equal(stats.assetCount, 2);
});

test("leaves the published snapshot untouched if a later API call fails", async () => {
  const { github, calls } = fixture(
    [release(1), release(2)],
    new Map([
      [1, [asset(1, 7)]],
      [2, new Error("GitHub request failed")],
    ]),
    true,
  );
  await assert.rejects(
    updateDownloadStats(github, repository),
    /GitHub request failed/,
  );
  assert.ok(!calls.some((call) => call.method));
});

test("rejects invalid counts instead of publishing an incorrect total", async () => {
  const { github, calls } = fixture(
    [release(1)],
    new Map([[1, [asset(1, -1)]]]),
  );
  await assert.rejects(
    updateDownloadStats(github, repository),
    /Invalid download count/,
  );
  assert.ok(!calls.some((call) => call.method));
});

for (const existingBranch of [false, true]) {
  test(`publishes a compact badge and exact totals atomically (${existingBranch ? "existing" : "new"} stats branch)`, async () => {
    const { github, calls } = fixture(
      [release(1)],
      new Map([[1, [asset(1, 171662)]]]),
      existingBranch,
    );
    await updateDownloadStats(github, repository);
    const tree = calls.find((call) => call.method === "createTree").parameters;
    const badge = JSON.parse(
      tree.tree.find((entry) => entry.path === "downloads.json").content,
    );
    const detail = JSON.parse(
      tree.tree.find((entry) => entry.path === "downloads-detail.json").content,
    );
    assert.equal(badge.schemaVersion, 1);
    assert.equal(badge.label, "downloads");
    assert.equal(badge.message, "172k");
    assert.equal(detail.totalDownloads, 171662);
    assert.equal(detail.releases[0].assets[0].downloads, 171662);
    assert.equal(tree.base_tree, existingBranch ? "previous-tree" : undefined);
    const ref = calls.at(-1);
    assert.equal(ref.method, existingBranch ? "updateRef" : "createRef");
    assert.equal(
      ref.parameters.ref,
      existingBranch ? "heads/download-stats" : "refs/heads/download-stats",
    );
    if (existingBranch) assert.equal(ref.parameters.force, false);
  });
}
