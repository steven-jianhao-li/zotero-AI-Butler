const STATS_BRANCH = "download-stats";

/** Count published XPI assets across every release and asset page. */
export async function collectDownloadStats(github, repository) {
  const releases = [];
  const seenReleases = new Set();
  const seenAssets = new Set();
  let totalDownloads = 0;

  for await (const page of github.paginate.iterator(
    "GET /repos/{owner}/{repo}/releases",
    { ...repository, per_page: 100 },
  )) {
    for (const release of page.data) {
      if (release.draft || seenReleases.has(release.id)) continue;
      seenReleases.add(release.id);
      const assets = [];

      for await (const assetPage of github.paginate.iterator(
        "GET /repos/{owner}/{repo}/releases/{release_id}/assets",
        { ...repository, release_id: release.id, per_page: 100 },
      )) {
        for (const asset of assetPage.data) {
          if (
            !asset.name.toLowerCase().endsWith(".xpi") ||
            asset.state !== "uploaded" ||
            seenAssets.has(asset.id)
          ) {
            continue;
          }
          if (
            !Number.isSafeInteger(asset.download_count) ||
            asset.download_count < 0
          ) {
            throw new Error(`Invalid download count for asset ${asset.id}`);
          }
          seenAssets.add(asset.id);
          totalDownloads += asset.download_count;
          assets.push({
            id: asset.id,
            name: asset.name,
            downloads: asset.download_count,
          });
        }
      }
      releases.push({
        tag: release.tag_name,
        prerelease: release.prerelease,
        assets,
      });
    }
  }

  return {
    repository: `${repository.owner}/${repository.repo}`,
    updatedAt: new Date().toISOString(),
    totalDownloads,
    releaseCount: releases.length,
    assetCount: seenAssets.size,
    releases,
  };
}

/** Publish only after a complete successful scan, preserving the previous snapshot on failure. */
export async function updateDownloadStats(github, repository) {
  const stats = await collectDownloadStats(github, repository);
  const badge = {
    schemaVersion: 1,
    label: "XPI downloads",
    message: stats.totalDownloads.toLocaleString("en-US"),
    color: "brightgreen",
  };

  let previousRef;
  try {
    const { data } = await github.rest.git.getRef({
      ...repository,
      ref: `heads/${STATS_BRANCH}`,
    });
    previousRef = data;
  } catch (error) {
    // A missing branch is expected on the first run; other failures must abort.
    if (error.status !== 404) throw error;
  }
  const previousCommit = previousRef
    ? (
        await github.rest.git.getCommit({
          ...repository,
          commit_sha: previousRef.object.sha,
        })
      ).data
    : undefined;

  const { data: tree } = await github.rest.git.createTree({
    ...repository,
    ...(previousCommit ? { base_tree: previousCommit.tree.sha } : {}),
    tree: Object.entries({
      "downloads.json": badge,
      "downloads-detail.json": stats,
    }).map(([path, data]) => ({
      path,
      mode: "100644",
      type: "blob",
      content: `${JSON.stringify(data, null, 2)}\n`,
    })),
  });
  const { data: commit } = await github.rest.git.createCommit({
    ...repository,
    message: `chore: update XPI downloads to ${stats.totalDownloads}`,
    tree: tree.sha,
    parents: previousCommit ? [previousCommit.sha] : [],
  });

  if (previousCommit) {
    await github.rest.git.updateRef({
      ...repository,
      ref: `heads/${STATS_BRANCH}`,
      sha: commit.sha,
      force: false,
    });
  } else {
    await github.rest.git.createRef({
      ...repository,
      ref: `refs/heads/${STATS_BRANCH}`,
      sha: commit.sha,
    });
  }
  return stats;
}
