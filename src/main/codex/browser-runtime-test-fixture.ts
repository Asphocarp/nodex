import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  BROWSER_RUNTIME_MANIFEST_FILENAME,
  type BrowserRuntimeArtifact,
  type BrowserRuntimeManifest,
} from "../../shared/browser-runtime-metadata";

type BrowserRuntimeFixtureOptions = {
  codexCompatibilityVersion?: string;
  targetArch?: "arm64" | "x64";
  targetPlatform?: "darwin" | "linux" | "win32";
};

const FIXTURE_FILES = [
  { architecture: "arm64", executable: true, kind: "executable", path: "bin/codex" },
  { architecture: "arm64", executable: true, kind: "executable", path: "bin/node" },
  { architecture: "arm64", executable: true, kind: "executable", path: "bin/node_repl" },
  {
    architecture: "arm64",
    executable: false,
    kind: "native-addon",
    path: "peer/authorize.node",
  },
  {
    architecture: "any",
    executable: false,
    kind: "data",
    path: "marketplace/plugins/browser/manifest.json",
  },
  {
    architecture: "any",
    executable: false,
    kind: "data",
    path: "marketplace/plugins/browser/client.js",
  },
  {
    architecture: "any",
    executable: false,
    kind: "data",
    path: "marketplace/plugins/browser/docs/SKILL.md",
  },
  {
    architecture: "any",
    executable: false,
    kind: "data",
    path: "marketplace/.agents/plugins/marketplace.json",
  },
] as const;

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function writeBrowserRuntimeFixture(
  bundleRoot: string,
  options: BrowserRuntimeFixtureOptions = {},
): BrowserRuntimeManifest {
  const targetArch = options.targetArch ?? "arm64";
  const artifacts: BrowserRuntimeArtifact[] = FIXTURE_FILES.map((definition) => {
    const content = `fixture:${definition.path}\n`;
    const artifactPath = path.join(bundleRoot, ...definition.path.split("/"));
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, content);
    if (definition.executable) fs.chmodSync(artifactPath, 0o755);
    return {
      ...definition,
      architecture: definition.architecture === "arm64" ? targetArch : definition.architecture,
      sha256: sha256(content),
      size: Buffer.byteLength(content),
    };
  });
  fs.mkdirSync(path.join(bundleRoot, "marketplace", "plugins", "browser", "node_modules"), {
    recursive: true,
  });

  const manifest = {
    artifacts,
    browserPlugin: {
      client: "marketplace/plugins/browser/client.js",
      docs: "marketplace/plugins/browser/docs/SKILL.md",
      id: "browser@openai-bundled",
      manifest: "marketplace/plugins/browser/manifest.json",
      marketplaceManifest: "marketplace/.agents/plugins/marketplace.json",
      marketplaceRoot: "marketplace",
      nodeModuleDirs: ["marketplace/plugins/browser/node_modules"],
      root: "marketplace/plugins/browser",
      version: "1.0.0-test",
    },
    buildFlavor: "test",
    codexCompatibilityVersion: options.codexCompatibilityVersion ?? "0.144.6",
    contractVersion: 1,
    desktopBuild: "test-build",
    desktopBuildNumber: "123",
    entrypoints: {
      codexCli: "bin/codex",
      node: "bin/node",
      nodeRepl: "bin/node_repl",
      peerAuthorization: "peer/authorize.node",
    },
    peerAuthorization: {
      nodeApiVersion: "127",
      signingTeamId: "TESTTEAM",
    },
    runtimeVersions: {
      codexCli: "0.144.6",
      cuaRuntime: "0.0.6/test",
      node: "24.0.0",
      peerAuthorization: "test",
    },
    schemaVersion: 3,
    supportedBackends: ["iab", "chrome"],
    targetArch,
    targetPlatform: options.targetPlatform ?? "darwin",
  } satisfies BrowserRuntimeManifest;
  fs.writeFileSync(
    path.join(bundleRoot, BROWSER_RUNTIME_MANIFEST_FILENAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}
