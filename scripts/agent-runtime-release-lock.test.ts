import { expect, test } from "vitest";
import { parseOpenInterpreterReleaseLock } from "./agent-runtime-release-lock";

const HASH = "a".repeat(64);
const SOURCE_COMMIT = "855ab60c0e10dac6bc89f3e248cba3746d44f034";
const RELEASE_TAG = "agent-runtime-v0.146.0-855ab60c";

function makeLock(): Record<string, unknown> {
  const asset = (targetTriple: string, assetName: string) => ({
    archiveSha256: HASH,
    archiveSize: 123,
    assetName,
    runtimeMetadataSha256: HASH,
    targetTriple,
    url: `https://github.com/junyudev/nodex/releases/download/${RELEASE_TAG}/${assetName}`,
  });
  return {
    assets: {
      "darwin-arm64": asset(
        "aarch64-apple-darwin",
        "open-interpreter-package-aarch64-apple-darwin.tar.gz",
      ),
      "darwin-x64": asset(
        "x86_64-apple-darwin",
        "open-interpreter-package-x86_64-apple-darwin.tar.gz",
      ),
    },
    codexCompatibilityVersion: "0.146.0",
    notices: {
      licensePath: "resources/third-party/open-interpreter/LICENSE",
      licenseSha256: HASH,
      noticePath: "resources/third-party/open-interpreter/NOTICE",
      noticeSha256: HASH,
    },
    packageManifest: {
      entrypoint: "bin/interpreter",
      layoutVersion: 1,
      pathDir: "codex-path",
      resourcesDir: "codex-resources",
      variant: "open-interpreter",
      version: "0.146.0",
    },
    protocolSchemaSha256: HASH,
    release: {
      repository: "junyudev/nodex",
      tag: RELEASE_TAG,
    },
    requiredArtifacts: [
      "codex-package.json",
      "bin/interpreter",
      "bin/codex-code-mode-host",
      "codex-path/rg",
      "codex-resources/zsh/bin/zsh",
    ],
    runtimeFamily: "open-interpreter",
    runtimeVersion: "0.146.0",
    schemaVersion: 2,
    source: {
      commit: SOURCE_COMMIT,
      patches: [],
      repository: "openinterpreter/openinterpreter",
    },
  };
}

test("Agent runtime lock separates the exact source revision from its artifact release", () => {
  const lock = parseOpenInterpreterReleaseLock(makeLock());

  expect(lock.source.commit).toBe(SOURCE_COMMIT);
  expect(lock.release.tag).toBe(RELEASE_TAG);
});

test("Agent runtime lock rejects an asset URL outside its artifact release", () => {
  const lock = makeLock();
  const assets = lock.assets as Record<string, Record<string, unknown>>;
  assets["darwin-arm64"]!.url = "https://github.com/other/repo/releases/download/wrong/runtime.tar.gz";

  expect(() => parseOpenInterpreterReleaseLock(lock)).toThrow(
    "does not match its artifact release",
  );
});

test("Agent runtime lock requires a full immutable source commit", () => {
  const lock = makeLock();
  (lock.source as Record<string, unknown>).commit = "855ab60c";

  expect(() => parseOpenInterpreterReleaseLock(lock)).toThrow("source.commit");
});
