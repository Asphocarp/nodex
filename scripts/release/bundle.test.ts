import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dump } from "js-yaml";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  assembleReleaseBundle,
  type ArchitectureBuildManifest,
  type MacArchitecture,
} from "./bundle";
import { sha256File } from "./model";
import { releaseAssetPaths } from "./github-release";

let fixture = "";

const sha512 = (path: string): string => createHash("sha512").update(readFileSync(path)).digest("base64");

const makeArchitecture = (architecture: MacArchitecture, sourceSha = "1".repeat(40)): string => {
  const root = join(fixture, architecture);
  mkdirSync(root);
  const version = "0.2.0";
  const names = [
    `Nodex-${version}-${architecture}.dmg`,
    `Nodex-${version}-${architecture}.zip`,
    `Nodex-${version}-${architecture}.zip.blockmap`,
  ];
  for (const name of names) writeFileSync(join(root, name), `${architecture}:${name}`);
  const zipName = names[1];
  writeFileSync(join(root, "latest-mac.yml"), dump({
    version,
    files: [{ url: zipName, sha512: sha512(join(root, zipName)) }],
    path: zipName,
    sha512: sha512(join(root, zipName)),
  }));
  const artifacts = [...names, "latest-mac.yml"].map((name) => ({
    architecture,
    bytes: readFileSync(join(root, name)).byteLength,
    name,
    role: name.endsWith(".dmg") ? "dmg" as const
      : name.endsWith(".zip") ? "zip" as const
      : name.endsWith(".blockmap") ? "blockmap" as const
      : "update-manifest" as const,
    sha256: sha256File(join(root, name)),
  }));
  const manifest: ArchitectureBuildManifest = {
    architecture,
    artifacts,
    packageProvenanceSha256: "2".repeat(64),
    preparedBuild: {
      generation: (architecture === "arm64" ? "7" : "8").repeat(64),
      manifestSha256: "3".repeat(64),
      state: "clean",
    },
    runner: { image: "test" },
    runtimeLocks: { agentSha256: "4".repeat(64), browserSha256: "5".repeat(64) },
    schemaVersion: 1,
    sourceSha,
    sourceTree: "6".repeat(40),
    tag: "v0.2.0",
    version,
  };
  writeFileSync(join(root, "architecture-build.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return root;
};

beforeEach(() => { fixture = mkdtempSync(join(tmpdir(), "nodex-release-bundle-")); });
afterEach(() => rmSync(fixture, { recursive: true, force: true }));

test("assembleReleaseBundle binds both architectures and publishes one canonical DMG each", () => {
  const arm64 = makeArchitecture("arm64");
  const x64 = makeArchitecture("x64");
  const output = join(fixture, "output");
  const bundle = assembleReleaseBundle({
    arm64Directory: arm64,
    outputDirectory: output,
    sourceSha: "1".repeat(40),
    version: "0.2.0",
    x64Directory: x64,
  });

  expect(bundle.assets.filter((asset) => asset.role === "dmg").map((asset) => asset.name).sort()).toEqual([
    "Nodex-latest-arm64.dmg",
    "Nodex-latest-x64.dmg",
  ]);
  expect(readFileSync(join(output, "latest-mac.yml"), "utf8")).toContain("Nodex-0.2.0-x64.zip");
  expect(readFileSync(join(output, "SHA256SUMS"), "utf8")).toContain("release-bundle.json");
  expect(releaseAssetPaths(join(output, "release-bundle.json"))).toHaveLength(bundle.assets.length + 2);
  appendFileSync(join(output, "Nodex-latest-arm64.dmg"), "tampered");
  expect(() => releaseAssetPaths(join(output, "release-bundle.json"))).toThrow("does not match");
});

test("assembleReleaseBundle rejects different source identities", () => {
  const arm64 = makeArchitecture("arm64");
  const x64 = makeArchitecture("x64", "7".repeat(40));
  expect(() => assembleReleaseBundle({
    arm64Directory: arm64,
    outputDirectory: join(fixture, "output"),
    sourceSha: "1".repeat(40),
    version: "0.2.0",
    x64Directory: x64,
  })).toThrow("release identity");
});

test("assembleReleaseBundle rejects updater hashes that do not match the ZIP", () => {
  const arm64 = makeArchitecture("arm64");
  const x64 = makeArchitecture("x64");
  writeFileSync(join(arm64, "latest-mac.yml"), dump({
    version: "0.2.0",
    files: [{ url: "Nodex-0.2.0-arm64.zip", sha512: "wrong" }],
  }));
  const manifest = JSON.parse(readFileSync(join(arm64, "architecture-build.json"), "utf8")) as ArchitectureBuildManifest;
  const artifacts = manifest.artifacts.map((artifact) => artifact.name === "latest-mac.yml"
    ? { ...artifact, bytes: readFileSync(join(arm64, artifact.name)).byteLength, sha256: sha256File(join(arm64, artifact.name)) }
    : artifact);
  writeFileSync(join(arm64, "architecture-build.json"), `${JSON.stringify({ ...manifest, artifacts }, null, 2)}\n`);
  expect(() => assembleReleaseBundle({
    arm64Directory: arm64,
    outputDirectory: join(fixture, "output"),
    sourceSha: "1".repeat(40),
    version: "0.2.0",
    x64Directory: x64,
  })).toThrow("SHA512");
});

test("assembleReleaseBundle rejects updater entries outside the published ZIP closure", () => {
  const arm64 = makeArchitecture("arm64");
  const x64 = makeArchitecture("x64");
  const zipName = "Nodex-0.2.0-arm64.zip";
  writeFileSync(join(arm64, "latest-mac.yml"), dump({
    version: "0.2.0",
    files: [
      { url: zipName, sha512: sha512(join(arm64, zipName)) },
      { url: "unpublished.zip", sha512: "unused" },
    ],
  }));
  const manifest = JSON.parse(readFileSync(join(arm64, "architecture-build.json"), "utf8")) as ArchitectureBuildManifest;
  const artifacts = manifest.artifacts.map((artifact) => artifact.name === "latest-mac.yml"
    ? { ...artifact, bytes: readFileSync(join(arm64, artifact.name)).byteLength, sha256: sha256File(join(arm64, artifact.name)) }
    : artifact);
  writeFileSync(join(arm64, "architecture-build.json"), `${JSON.stringify({ ...manifest, artifacts }, null, 2)}\n`);

  expect(() => assembleReleaseBundle({
    arm64Directory: arm64,
    outputDirectory: join(fixture, "output"),
    sourceSha: "1".repeat(40),
    version: "0.2.0",
    x64Directory: x64,
  })).toThrow("must contain exactly");
});

test("assembleReleaseBundle rejects architecture artifacts outside the release allowlist", () => {
  const arm64 = makeArchitecture("arm64");
  const x64 = makeArchitecture("x64");
  const manifestPath = join(arm64, "architecture-build.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ArchitectureBuildManifest;
  writeFileSync(join(arm64, "debug-symbols.zip"), "not a public release artifact");
  writeFileSync(manifestPath, `${JSON.stringify({
    ...manifest,
    artifacts: [
      ...manifest.artifacts,
      {
        architecture: "arm64",
        bytes: readFileSync(join(arm64, "debug-symbols.zip")).byteLength,
        name: "debug-symbols.zip",
        role: "zip",
        sha256: sha256File(join(arm64, "debug-symbols.zip")),
      },
    ],
  }, null, 2)}\n`);

  expect(() => assembleReleaseBundle({
    arm64Directory: arm64,
    outputDirectory: join(fixture, "output"),
    sourceSha: "1".repeat(40),
    version: "0.2.0",
    x64Directory: x64,
  })).toThrow("architecture artifacts do not match");
});
