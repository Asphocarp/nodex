import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { inspectOfficialAgentSkillsArtifact } from "./official-agent-skills-artifact.mjs";
import { verifyPackagedBuildProvenance } from "./package-provenance.mjs";

interface VerifyPackagedAgentSkillsOptions {
  readonly appPath: string;
  readonly expectedManifestSha256?: string;
  readonly expectedTreeSha256?: string;
}

interface CapabilityEnvelope {
  readonly version?: unknown;
  readonly ok?: unknown;
  readonly result?: {
    readonly schemaVersion?: unknown;
    readonly commands?: Record<string, unknown>;
    readonly bundle?: {
      readonly status?: unknown;
      readonly releaseVersion?: unknown;
      readonly treeSha256?: unknown;
    };
  };
}

const assertExpectedDigest = (
  actual: string,
  expected: string | undefined,
  label: string,
): void => {
  if (expected && actual !== expected) {
    throw new Error(`Packaged official Agent Skills ${label} does not match the expected digest`);
  }
};

export function verifyPackagedAgentSkills(options: VerifyPackagedAgentSkillsOptions): void {
  const appPath = path.resolve(options.appPath);
  const resourcesPath = path.join(appPath, "Contents/Resources");
  const artifact = inspectOfficialAgentSkillsArtifact(path.join(resourcesPath, "agent-skills"));
  assertExpectedDigest(artifact.manifestSha256, options.expectedManifestSha256, "manifest");
  assertExpectedDigest(artifact.treeSha256, options.expectedTreeSha256, "tree");

  const provenance = verifyPackagedBuildProvenance(appPath);
  if (
    provenance.agentSkills.manifestSha256 !== artifact.manifestSha256 ||
    provenance.agentSkills.treeSha256 !== artifact.treeSha256
  ) {
    throw new Error("Packaged official Agent Skills do not match build provenance");
  }

  const cli = path.join(resourcesPath, "bin/nodex");
  const cliMetadata = lstatSync(cli);
  if (cliMetadata.isSymbolicLink() || !cliMetadata.isFile()) {
    throw new Error("Packaged nodex CLI must be a regular file");
  }

  const home = mkdtempSync(path.join(tmpdir(), "nodex-agent-skills-verify-"));
  const nodexHome = path.join(home, "profile-that-must-not-exist");
  try {
    const result = spawnSync(cli, ["--json", "capabilities"], {
      cwd: home,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        NODEX_HOME: nodexHome,
        PATH: "/usr/bin:/bin",
      },
      timeout: 30_000,
    });
    if (result.error || result.status !== 0) {
      throw new Error(
        `Packaged nodex capabilities failed: ${
          result.error?.message ?? (result.stderr || result.stdout).trim()
        }`,
      );
    }
    const envelope = JSON.parse(result.stdout) as CapabilityEnvelope;
    const bundle = envelope.result?.bundle;
    if (
      envelope.version !== 1 ||
      envelope.ok !== true ||
      envelope.result?.schemaVersion !== 1 ||
      envelope.result.commands?.skills !== 1 ||
      bundle?.status !== "available" ||
      bundle.releaseVersion !== artifact.releaseVersion ||
      bundle.treeSha256 !== artifact.treeSha256
    ) {
      throw new Error("Packaged nodex capabilities do not advertise the bundled Skill contract");
    }
    if (existsSync(nodexHome)) {
      throw new Error("Packaged nodex capabilities unexpectedly created a Profile");
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }

  process.stdout.write(
    `Verified packaged official Agent Skill ${artifact.releaseVersion} (${artifact.treeSha256}).\n`,
  );
}

const readOption = (arguments_: readonly string[], option: string): string | null => {
  const index = arguments_.indexOf(option);
  if (index < 0) return null;
  const value = arguments_[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
};

const main = (): void => {
  const arguments_ = process.argv.slice(2);
  const appPath = readOption(arguments_, "--app-path");
  if (!appPath) {
    throw new Error(
      "usage: verify-packaged-agent-skills --app-path <Nodex.app> " +
        "[--expected-manifest-sha256 <sha256>] [--expected-tree-sha256 <sha256>]",
    );
  }
  verifyPackagedAgentSkills({
    appPath,
    expectedManifestSha256: readOption(arguments_, "--expected-manifest-sha256") ?? undefined,
    expectedTreeSha256: readOption(arguments_, "--expected-tree-sha256") ?? undefined,
  });
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
