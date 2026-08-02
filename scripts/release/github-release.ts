import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { parseReleaseBundleManifest } from "./bundle";
import {
  compareStableVersions,
  latestStableAppVersion,
  normalizeStableVersion,
  sha256File,
  stableVersionFromAppTag,
  tagForVersion,
} from "./model";

interface GitHubAsset {
  readonly digest?: string | null;
  readonly name: string;
  readonly size: number;
}

interface GitHubRelease {
  readonly assets: readonly GitHubAsset[];
  readonly draft: boolean;
  readonly immutable?: boolean;
  readonly prerelease: boolean;
  readonly tag_name: string;
}

interface ReleaseAssetIdentity {
  readonly bytes: number;
  readonly sha256: string;
}

export type PublicationPlan =
  | { readonly kind: "create" }
  | { readonly kind: "resume-draft"; readonly missingAssetNames: readonly string[] }
  | { readonly kind: "verify-published" };

const assertRegularFile = (filePath: string): void => {
  if (!existsSync(filePath)) throw new Error(`Release asset is missing: ${filePath}`);
  const metadata = lstatSync(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Release asset must be a regular file: ${filePath}`);
  }
};

const readBundle = (bundlePath: string) => {
  const resolvedBundle = resolve(bundlePath);
  assertRegularFile(resolvedBundle);
  return {
    bundle: parseReleaseBundleManifest(JSON.parse(readFileSync(resolvedBundle, "utf8"))),
    resolvedBundle,
    root: dirname(resolvedBundle),
  };
};

const verifyChecksumAllowlist = (
  resolvedBundle: string,
  bundle: ReturnType<typeof parseReleaseBundleManifest>,
): string => {
  const checksumPath = join(dirname(resolvedBundle), "SHA256SUMS");
  assertRegularFile(checksumPath);
  const checksumEntries = [
    ...bundle.assets.map(({ name, sha256 }) => ({ name, sha256 })),
    { name: basename(resolvedBundle), sha256: sha256File(resolvedBundle) },
  ].sort((left, right) => left.name.localeCompare(right.name));
  const expectedChecksums = `${checksumEntries.map(({ name, sha256 }) => `${sha256}  ${name}`).join("\n")}\n`;
  if (readFileSync(checksumPath, "utf8") !== expectedChecksums) {
    throw new Error("SHA256SUMS does not match the Release Bundle allowlist.");
  }
  return checksumPath;
};

const gh = (args: readonly string[], options?: { readonly allowFailure?: boolean }): string => {
  try {
    return execFileSync("gh", [...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", options?.allowFailure ? "ignore" : "pipe"],
    }).trim();
  } catch (error) {
    if (options?.allowFailure) return "";
    throw error;
  }
};

export const releaseAssetPaths = (bundlePath: string): readonly string[] => {
  const { bundle, resolvedBundle, root } = readBundle(bundlePath);
  const checksumPath = join(root, "SHA256SUMS");
  const paths = [
    ...bundle.assets.map((asset) => join(root, asset.name)),
    resolvedBundle,
    checksumPath,
  ];
  for (const filePath of paths) assertRegularFile(filePath);
  for (const artifact of bundle.assets) {
    const filePath = join(root, artifact.name);
    if (lstatSync(filePath).size !== artifact.bytes || sha256File(filePath) !== artifact.sha256) {
      throw new Error(`Release asset ${artifact.name} does not match release-bundle.json.`);
    }
  }
  verifyChecksumAllowlist(resolvedBundle, bundle);
  return paths;
};

const expectedLocalAssets = (bundlePath: string): ReadonlyMap<string, ReleaseAssetIdentity> =>
  new Map(releaseAssetPaths(bundlePath).map((filePath) => [
    basename(filePath),
    { bytes: lstatSync(filePath).size, sha256: sha256File(filePath) },
  ]));

export const remoteReleaseAssetIdentities = (
  bundlePath: string,
): ReadonlyMap<string, ReleaseAssetIdentity> => {
  const { bundle, resolvedBundle } = readBundle(bundlePath);
  const checksumPath = verifyChecksumAllowlist(resolvedBundle, bundle);
  return new Map([
    ...bundle.assets.map((asset) => [
      asset.name,
      { bytes: asset.bytes, sha256: asset.sha256 },
    ] as const),
    [
      basename(resolvedBundle),
      { bytes: lstatSync(resolvedBundle).size, sha256: sha256File(resolvedBundle) },
    ],
    [
      basename(checksumPath),
      { bytes: lstatSync(checksumPath).size, sha256: sha256File(checksumPath) },
    ],
  ]);
};

export function planPublication(
  release: GitHubRelease | null,
  expected: ReadonlyMap<string, ReleaseAssetIdentity>,
): PublicationPlan {
  if (!release) return { kind: "create" };
  if (release.prerelease) throw new Error("Stable app release cannot be a prerelease.");
  const actualNames = new Set(release.assets.map((asset) => asset.name));
  for (const asset of release.assets) {
    const identity = expected.get(asset.name);
    if (!identity) throw new Error(`GitHub release contains an unexpected asset: ${asset.name}.`);
    const digest = asset.digest?.replace(/^sha256:/, "");
    if (asset.size !== identity.bytes || digest !== identity.sha256) {
      throw new Error(`GitHub release asset ${asset.name} does not match the local Release Bundle.`);
    }
  }
  const missingAssetNames = [...expected.keys()].filter((name) => !actualNames.has(name)).sort();
  if (!release.draft) {
    if (missingAssetNames.length > 0) {
      throw new Error(`Published release is missing assets: ${missingAssetNames.join(", ")}.`);
    }
    return { kind: "verify-published" };
  }
  return { kind: "resume-draft", missingAssetNames };
}

const readRelease = (repo: string, tag: string): GitHubRelease | null => {
  const response = gh(["api", `repos/${repo}/releases`, "--paginate", "--slurp"]);
  const releases = (JSON.parse(response) as GitHubRelease[][]).flat();
  return releases.find((release) => release.tag_name === tag) ?? null;
};

interface GitReference {
  readonly object: { readonly sha: string; readonly type: "commit" | "tag" };
  readonly ref: string;
}

const readTagReference = (repo: string, tag: string): GitReference | null => {
  const response = gh(["api", `repos/${repo}/git/ref/tags/${tag}`], { allowFailure: true });
  return response ? JSON.parse(response) as GitReference : null;
};

const resolveTagTargetSha = (repo: string, reference: GitReference): string => {
  let object = reference.object;
  for (let depth = 0; depth < 4; depth += 1) {
    if (object.type === "commit") return object.sha;
    const tag = JSON.parse(gh(["api", `repos/${repo}/git/tags/${object.sha}`])) as {
      readonly object: GitReference["object"];
    };
    object = tag.object;
  }
  throw new Error(`Git tag ${reference.ref} contains too many nested tag objects.`);
};

export function planTag(existingTargetSha: string | null, sourceSha: string): "create" | "reuse" {
  if (!/^[a-f0-9]{40}$/u.test(sourceSha)) throw new Error("Release source SHA must be a full commit SHA.");
  if (existingTargetSha === null) return "create";
  if (existingTargetSha !== sourceSha) {
    throw new Error(`Release tag points to ${existingTargetSha}, expected ${sourceSha}; tags never move.`);
  }
  return "reuse";
}

const readStableTagNames = (repo: string): readonly string[] => {
  const response = gh(["api", `repos/${repo}/git/matching-refs/tags/v`, "--paginate", "--slurp"]);
  return (JSON.parse(response) as GitReference[][])
    .flat()
    .map(({ ref }) => ref.replace(/^refs\/tags\//u, ""))
    .filter((tag) => stableVersionFromAppTag(tag) !== null);
};

export function assertRemoteReleaseCandidate(options: {
  readonly repo: string;
  readonly sourceSha: string;
  readonly version: string;
}): { readonly tag: string; readonly tagPlan: "create" | "reuse" } {
  const version = normalizeStableVersion(options.version);
  const tag = tagForVersion(version);
  const reference = readTagReference(options.repo, tag);
  const tagPlan = planTag(
    reference ? resolveTagTargetSha(options.repo, reference) : null,
    options.sourceSha,
  );
  const otherTags = readStableTagNames(options.repo).filter((candidate) => candidate !== tag);
  const latestVersion = latestStableAppVersion(otherTags);
  if (tagPlan === "create" && latestVersion && compareStableVersions(version, latestVersion) <= 0) {
    throw new Error(`Release ${version} must be newer than remote stable app version ${latestVersion}.`);
  }
  return { tag, tagPlan };
}

export function ensureGitHubReleaseTag(options: {
  readonly bundlePath: string;
  readonly repo: string;
}): "create" | "reuse" {
  const bundlePath = resolve(options.bundlePath);
  releaseAssetPaths(bundlePath);
  const bundle = parseReleaseBundleManifest(JSON.parse(readFileSync(bundlePath, "utf8")));
  const candidate = assertRemoteReleaseCandidate({
    repo: options.repo,
    sourceSha: bundle.sourceSha,
    version: bundle.version,
  });
  if (candidate.tagPlan === "reuse") return "reuse";
  const annotation = [
    `Nodex ${bundle.tag}`,
    "",
    `Source: ${bundle.sourceSha}`,
    `Release-Bundle-SHA256: ${sha256File(bundlePath)}`,
  ].join("\n");
  const tagObject = JSON.parse(gh([
    "api", "--method", "POST", `repos/${options.repo}/git/tags`,
    "-f", `tag=${bundle.tag}`,
    "-f", `message=${annotation}`,
    "-f", `object=${bundle.sourceSha}`,
    "-f", "type=commit",
    "-f", "tagger[name]=github-actions[bot]",
    "-f", "tagger[email]=41898282+github-actions[bot]@users.noreply.github.com",
    "-f", `tagger[date]=${new Date().toISOString()}`,
  ])) as { readonly sha?: unknown };
  if (typeof tagObject.sha !== "string") throw new Error("GitHub did not return an annotated tag object SHA.");
  gh([
    "api", "--method", "POST", `repos/${options.repo}/git/refs`,
    "-f", `ref=refs/tags/${bundle.tag}`,
    "-f", `sha=${tagObject.sha}`,
  ]);
  const created = readTagReference(options.repo, bundle.tag);
  if (!created || resolveTagTargetSha(options.repo, created) !== bundle.sourceSha) {
    throw new Error("Created release tag does not resolve to the Release Bundle source SHA.");
  }
  return "create";
}

export function publishGitHubRelease(options: {
  readonly bundlePath: string;
  readonly notesPath: string;
  readonly repo: string;
}): PublicationPlan {
  const bundlePath = resolve(options.bundlePath);
  const bundle = parseReleaseBundleManifest(JSON.parse(readFileSync(bundlePath, "utf8")));
  const expected = expectedLocalAssets(bundlePath);
  const release = readRelease(options.repo, bundle.tag);
  const plan = planPublication(release, expected);
  const filesByName = new Map(releaseAssetPaths(bundlePath).map((filePath) => [basename(filePath), filePath]));

  if (plan.kind === "create") {
    gh([
      "release", "create", bundle.tag,
      ...filesByName.values(),
      "--repo", options.repo,
      "--verify-tag",
      "--latest",
      "--title", `Nodex ${bundle.tag}`,
      "--notes-file", resolve(options.notesPath),
    ]);
    return plan;
  }
  if (plan.kind === "resume-draft") {
    const missingPaths = plan.missingAssetNames.map((name) => {
      const filePath = filesByName.get(name);
      if (!filePath) throw new Error(`Missing local recovery asset ${name}.`);
      return filePath;
    });
    if (missingPaths.length > 0) {
      gh(["release", "upload", bundle.tag, ...missingPaths, "--repo", options.repo]);
    }
    gh([
      "release", "edit", bundle.tag,
      "--repo", options.repo,
      "--draft=false",
      "--latest",
      "--title", `Nodex ${bundle.tag}`,
      "--notes-file", resolve(options.notesPath),
    ]);
  }
  return plan;
}

export function verifyRemoteRelease(options: {
  readonly bundlePath: string;
  readonly repo: string;
  readonly requireImmutable?: boolean;
}): void {
  const bundlePath = resolve(options.bundlePath);
  const bundle = parseReleaseBundleManifest(JSON.parse(readFileSync(bundlePath, "utf8")));
  if (!stableVersionFromAppTag(bundle.tag)) throw new Error("Release Bundle tag is not a stable app tag.");
  const release = readRelease(options.repo, bundle.tag);
  const expected = remoteReleaseAssetIdentities(bundlePath);
  const plan = planPublication(release, expected);
  if (plan.kind !== "verify-published" || !release) throw new Error("GitHub release is not fully published.");
  if (options.requireImmutable !== false && release.immutable !== true) {
    throw new Error("GitHub release is not immutable.");
  }
  const tagReference = readTagReference(options.repo, bundle.tag);
  if (!tagReference || resolveTagTargetSha(options.repo, tagReference) !== bundle.sourceSha) {
    throw new Error("Published release tag does not target the Release Bundle source SHA.");
  }
  const latest = JSON.parse(gh(["api", `repos/${options.repo}/releases/latest`])) as { readonly tag_name?: unknown };
  if (latest.tag_name !== bundle.tag) throw new Error(`GitHub Latest is ${String(latest.tag_name)}, expected ${bundle.tag}.`);
  gh(["release", "verify", bundle.tag, "--repo", options.repo]);

  const downloadRoot = mkdtempSync(join(tmpdir(), "nodex-release-redownload-"));
  try {
    gh(["release", "download", bundle.tag, "--repo", options.repo, "--dir", downloadRoot]);
    for (const [name, identity] of expected) {
      const downloaded = join(downloadRoot, name);
      if (
        !existsSync(downloaded)
        || lstatSync(downloaded).size !== identity.bytes
        || sha256File(downloaded) !== identity.sha256
      ) {
        throw new Error(`Re-downloaded GitHub release asset ${name} failed byte verification.`);
      }
    }
  } finally {
    rmSync(downloadRoot, { force: true, recursive: true });
  }
}
