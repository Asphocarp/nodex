import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { build } from "esbuild";

import {
  LEGACY_PROFILE_MIGRATOR_LEGAL_PATH,
  LEGACY_PROFILE_MIGRATOR_MANIFEST_PATH,
  LEGACY_PROFILE_MIGRATOR_OUTPUT_PATH,
  LEGACY_PROFILE_MIGRATOR_SOURCE_COMMIT,
  LEGACY_PROFILE_MIGRATOR_SOURCE_VERSIONS,
  type LegacyProfileMigratorManifest,
  serializeLegacyProfileMigratorManifest,
  verifyLegacyProfileMigratorArtifacts,
} from "./legacy-profile-migrator-artifacts";
import { sha256File } from "./native-runtime-manifest";

type Command = "build" | "verify" | "verify-reproducible";

interface GeneratedArtifacts {
  readonly bundlePath: string;
  readonly legalPath: string;
  readonly manifest: LegacyProfileMigratorManifest;
  readonly temporaryRoot: string;
}

const repositoryRoot = path.resolve(".");
const sourceRoot = path.join(repositoryRoot, "scripts/legacy-profile-migrator");
const scratchRoot = path.join(
  repositoryRoot,
  ".generated/legacy-profile-migrator-builds",
);

const parseCommand = (): Command => {
  const [argument, ...extraArguments] = process.argv.slice(2);
  if (extraArguments.length > 0) {
    throw new Error("Legacy profile migrator build accepts at most one command");
  }
  if (argument === undefined) return "build";
  if (argument === "--verify") return "verify";
  if (argument === "--verify-reproducible") return "verify-reproducible";
  throw new Error(`Unknown legacy profile migrator build command: ${argument}`);
};

const resolveSourceCommit = (): typeof LEGACY_PROFILE_MIGRATOR_SOURCE_COMMIT => {
  let sourceCommit: string;
  try {
    sourceCommit = execFileSync(
      "git",
      ["rev-parse", `${LEGACY_PROFILE_MIGRATOR_SOURCE_COMMIT}^{commit}`],
      { cwd: repositoryRoot, encoding: "utf8" },
    ).trim();
  } catch {
    throw new Error(
      `Legacy profile migrator source commit is unavailable: ${LEGACY_PROFILE_MIGRATOR_SOURCE_COMMIT}`,
    );
  }
  if (sourceCommit !== LEGACY_PROFILE_MIGRATOR_SOURCE_COMMIT) {
    throw new Error(`Unexpected legacy profile migrator source commit: ${sourceCommit}`);
  }
  return LEGACY_PROFILE_MIGRATOR_SOURCE_COMMIT;
};

const assertPortableBundle = (bundle: string): void => {
  const candidateRoots = new Set([
    repositoryRoot,
    repositoryRoot.split(path.sep).join("/"),
    repositoryRoot.split(path.sep).join("\\"),
  ]);
  if ([...candidateRoots].some((candidate) => bundle.includes(candidate))) {
    throw new Error("Legacy profile migrator bundle contains its build checkout path");
  }
};

const generateArtifacts = async (): Promise<GeneratedArtifacts> => {
  const sourceCommit = resolveSourceCommit();
  mkdirSync(scratchRoot, { recursive: true });
  const temporaryRoot = mkdtempSync(path.join(scratchRoot, "build-"));
  const archivePath = path.join(temporaryRoot, "source.tar");
  const checkoutRoot = path.join(temporaryRoot, "checkout");
  const outputRoot = path.join(temporaryRoot, "output");
  const bundlePath = path.join(outputRoot, path.basename(LEGACY_PROFILE_MIGRATOR_OUTPUT_PATH));
  const legalPath = `${bundlePath}.LEGAL.txt`;

  try {
    mkdirSync(checkoutRoot, { recursive: true });
    mkdirSync(outputRoot, { recursive: true });
    execFileSync(
      "git",
      [
        "archive",
        "--format=tar",
        `--output=${archivePath}`,
        LEGACY_PROFILE_MIGRATOR_SOURCE_COMMIT,
      ],
      { cwd: repositoryRoot },
    );
    execFileSync("tar", ["-xf", archivePath, "-C", checkoutRoot]);

    const migrationSource = path.join(checkoutRoot, "legacy-source");
    mkdirSync(migrationSource, { recursive: true });
    for (const entry of ["src", "packages", "third_party"]) {
      renameSync(path.join(checkoutRoot, entry), path.join(migrationSource, entry));
    }
    copyFileSync(
      path.join(sourceRoot, "entry.ts.template"),
      path.join(checkoutRoot, "entry.ts"),
    );
    copyFileSync(
      path.join(sourceRoot, "sqlite-adapter.ts.template"),
      path.join(checkoutRoot, "sqlite-adapter.ts"),
    );

    await build({
      absWorkingDir: checkoutRoot,
      alias: { "better-sqlite3": "./sqlite-adapter.ts" },
      bundle: true,
      entryPoints: ["entry.ts"],
      format: "esm",
      legalComments: "linked",
      nodePaths: [path.join(repositoryRoot, "node_modules")],
      outfile: bundlePath,
      platform: "node",
      plugins: [
        {
          name: "discard-browser-css",
          setup(buildContext) {
            buildContext.onLoad({ filter: /\.css$/ }, () => ({
              contents: "",
              loader: "js",
            }));
          },
        },
      ],
      target: "node24",
    });
    const normalizedBundle = readFileSync(bundlePath, "utf8").replace(/[ \t]+$/gmu, "");
    assertPortableBundle(normalizedBundle);
    writeFileSync(bundlePath, normalizedBundle);
    const manifest: LegacyProfileMigratorManifest = {
      schemaVersion: 1,
      sourceCommit,
      supportedSourceVersions: LEGACY_PROFILE_MIGRATOR_SOURCE_VERSIONS,
      targetSchemaVersion: 84,
      bundle: {
        path: LEGACY_PROFILE_MIGRATOR_OUTPUT_PATH,
        sha256: sha256File(bundlePath),
        size: lstatSync(bundlePath).size,
      },
      legalNotices: {
        path: LEGACY_PROFILE_MIGRATOR_LEGAL_PATH,
        sha256: sha256File(legalPath),
        size: lstatSync(legalPath).size,
      },
    };
    return { bundlePath, legalPath, manifest, temporaryRoot };
  } catch (error) {
    rmSync(temporaryRoot, { force: true, recursive: true });
    throw error;
  }
};

const promoteFile = (sourcePath: string, destinationPath: string): void => {
  const stagingPath = `${destinationPath}.${randomUUID()}.tmp`;
  try {
    copyFileSync(sourcePath, stagingPath);
    renameSync(stagingPath, destinationPath);
  } finally {
    rmSync(stagingPath, { force: true });
  }
};

const promoteText = (contents: string, destinationPath: string): void => {
  const stagingPath = `${destinationPath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(stagingPath, contents);
    renameSync(stagingPath, destinationPath);
  } finally {
    rmSync(stagingPath, { force: true });
  }
};

const installGeneratedArtifacts = (artifacts: GeneratedArtifacts): void => {
  const bundlePath = path.join(repositoryRoot, LEGACY_PROFILE_MIGRATOR_OUTPUT_PATH);
  const legalPath = path.join(repositoryRoot, LEGACY_PROFILE_MIGRATOR_LEGAL_PATH);
  const manifestPath = path.join(repositoryRoot, LEGACY_PROFILE_MIGRATOR_MANIFEST_PATH);
  mkdirSync(path.dirname(bundlePath), { recursive: true });
  promoteFile(artifacts.bundlePath, bundlePath);
  promoteFile(artifacts.legalPath, legalPath);
  promoteText(serializeLegacyProfileMigratorManifest(artifacts.manifest), manifestPath);
};

const assertEqualFile = (actualPath: string, expectedPath: string, label: string): void => {
  if (readFileSync(actualPath).equals(readFileSync(expectedPath))) return;
  throw new Error(`Legacy profile migrator ${label} is not reproducible`);
};

const verifyReproducibleArtifacts = async (): Promise<LegacyProfileMigratorManifest> => {
  const checkedManifest = verifyLegacyProfileMigratorArtifacts(repositoryRoot);
  const generated = await generateArtifacts();
  try {
    const generatedManifest = serializeLegacyProfileMigratorManifest(generated.manifest);
    const checkedManifestPath = path.join(
      repositoryRoot,
      LEGACY_PROFILE_MIGRATOR_MANIFEST_PATH,
    );
    if (readFileSync(checkedManifestPath, "utf8") !== generatedManifest) {
      throw new Error("Legacy profile migrator manifest is not reproducible");
    }
    assertEqualFile(
      generated.bundlePath,
      path.join(repositoryRoot, LEGACY_PROFILE_MIGRATOR_OUTPUT_PATH),
      "bundle",
    );
    assertEqualFile(
      generated.legalPath,
      path.join(repositoryRoot, LEGACY_PROFILE_MIGRATOR_LEGAL_PATH),
      "legal notices",
    );
    return checkedManifest;
  } finally {
    rmSync(generated.temporaryRoot, { force: true, recursive: true });
  }
};

const main = async (): Promise<void> => {
  const command = parseCommand();
  if (command === "verify") {
    const manifest = verifyLegacyProfileMigratorArtifacts(repositoryRoot);
    process.stdout.write(`${JSON.stringify(manifest)}\n`);
    return;
  }
  if (command === "verify-reproducible") {
    const manifest = await verifyReproducibleArtifacts();
    process.stdout.write(`${JSON.stringify(manifest)}\n`);
    return;
  }

  const generated = await generateArtifacts();
  try {
    installGeneratedArtifacts(generated);
    process.stdout.write(`${JSON.stringify(generated.manifest)}\n`);
  } finally {
    rmSync(generated.temporaryRoot, { force: true, recursive: true });
  }
};

void main();
