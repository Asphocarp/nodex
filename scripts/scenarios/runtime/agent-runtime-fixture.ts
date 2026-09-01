import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  AGENT_RUNTIME_LAYOUT_VERSION,
  parseBundledAgentRuntimeMetadata,
} from "../../../src/shared/codex-runtime-metadata";

export interface AgentRuntimeFixture {
  readonly root: string;
  readonly executable: string;
  readonly metadataPath: string;
}

const writeScenarioAgentRuntime = (
  repositoryRoot: string,
  executableBody: string,
  version: string,
): AgentRuntimeFixture => {
  const runtimeRoot = path.join(repositoryRoot, ".generated/codex-runtime/agent-runtime");
  const executable = path.join(runtimeRoot, "bin/interpreter");
  const packagePath = path.join(runtimeRoot, "codex-package.json");
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.mkdirSync(path.join(runtimeRoot, "codex-path"), { recursive: true });
  fs.mkdirSync(path.join(runtimeRoot, "codex-resources"), { recursive: true });
  const packageBody = JSON.stringify({
    entrypoint: "bin/interpreter",
    layoutVersion: 1,
    pathDir: "codex-path",
    resourcesDir: "codex-resources",
    target: `${process.arch}-${process.platform}`,
    variant: "open-interpreter",
    version,
  });
  fs.writeFileSync(executable, executableBody, { mode: 0o755 });
  fs.writeFileSync(packagePath, packageBody);
  fs.chmodSync(executable, 0o755);

  const artifacts = [
    ["bin/interpreter", executableBody, true],
    ["codex-package.json", packageBody, false],
  ] as const;
  const metadata = {
    artifactRelease: {
      archiveSha256: "0".repeat(64),
      assetName: "nodex-scenario-fixture.tar.gz",
      repository: "junyudev/nodex",
      tag: "agent-runtime-v0.0.0-scenario",
    },
    artifacts: artifacts.map(([artifactPath, body, isExecutable]) => ({
      executable: isExecutable,
      path: artifactPath,
      sha256: createHash("sha256").update(body).digest("hex"),
      size: Buffer.byteLength(body),
    })),
    codexCompatibilityVersion: version,
    entrypoint: "bin/interpreter",
    layoutVersion: AGENT_RUNTIME_LAYOUT_VERSION,
    packageManifest: JSON.parse(packageBody) as object,
    runtimeFamily: "open-interpreter",
    runtimeVersion: version,
    searchPaths: ["codex-path"],
    sourceRevision: {
      commit: "0".repeat(40),
      patches: [],
      repository: "openinterpreter/openinterpreter",
    },
    targetArch: process.arch,
    targetPlatform: process.platform,
    targetTriple: `${process.arch}-${process.platform}`,
  };
  if (!parseBundledAgentRuntimeMetadata(metadata)) {
    throw new Error("Scenario Agent runtime fixture is invalid");
  }
  const metadataPath = path.join(runtimeRoot, "agent-runtime.json");
  fs.writeFileSync(metadataPath, JSON.stringify(metadata));
  return { root: runtimeRoot, executable, metadataPath };
};

export const prepareScenarioAgentRuntimeSync = (repositoryRoot: string): AgentRuntimeFixture =>
  writeScenarioAgentRuntime(repositoryRoot, "#!/bin/sh\nexit 0\n", "0.0.0-scenario");

export const prepareScenarioCodexAppServerRuntimeSync = (
  repositoryRoot: string,
  mockPeerPath: string,
): AgentRuntimeFixture =>
  writeScenarioAgentRuntime(
    repositoryRoot,
    fs.readFileSync(mockPeerPath, "utf8"),
    "0.145.0-alpha.15",
  );

export const prepareScenarioAgentRuntime = async (
  repositoryRoot: string,
): Promise<AgentRuntimeFixture> => prepareScenarioAgentRuntimeSync(repositoryRoot);
