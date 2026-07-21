import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { build } from "esbuild";

import { sha256File } from "./native-runtime-manifest";

const SOURCE_COMMIT = "db1e660c907cc41db38d9cc126d385f0826aee78";
const OUTPUT_PATH = "resources/legacy-profile-migrator.mjs";
const MANIFEST_PATH = "resources/legacy-profile-migrator.json";

const repositoryRoot = path.resolve(".");
const sourceRoot = path.join(repositoryRoot, "scripts/legacy-profile-migrator");

const main = async (): Promise<void> => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "nodex-legacy-migrator-build-"));
  const archivePath = path.join(temporaryRoot, "source.tar");
  const checkoutRoot = path.join(temporaryRoot, "checkout");
  const verify = process.argv.includes("--verify");

  try {
    mkdirSync(checkoutRoot, { recursive: true });
    execFileSync(
      "git",
      ["archive", "--format=tar", `--output=${archivePath}`, SOURCE_COMMIT],
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

    const outputPath = verify
      ? path.join(temporaryRoot, path.basename(OUTPUT_PATH))
      : path.join(repositoryRoot, OUTPUT_PATH);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    const legalPath = `${outputPath}.LEGAL.txt`;
    await build({
      absWorkingDir: checkoutRoot,
      alias: { "better-sqlite3": "./sqlite-adapter.ts" },
      bundle: true,
      entryPoints: ["entry.ts"],
      format: "esm",
      legalComments: "linked",
      nodePaths: [path.join(repositoryRoot, "node_modules")],
      outfile: outputPath,
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
    const bundle = readFileSync(outputPath, "utf8");
    writeFileSync(outputPath, bundle.replace(/[ \t]+$/gmu, ""));
    const sourceCommit = execFileSync("git", ["rev-parse", `${SOURCE_COMMIT}^{commit}`], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }).trim();
    const manifest = {
      schemaVersion: 1,
      sourceCommit,
      supportedSourceVersions: [26, 57, 68, 82, 83],
      targetSchemaVersion: 84,
      bundle: {
        path: OUTPUT_PATH,
        sha256: sha256File(outputPath),
        size: lstatSync(outputPath).size,
      },
      legalNotices: existsSync(legalPath)
        ? {
            path: `${OUTPUT_PATH}.LEGAL.txt`,
            sha256: sha256File(legalPath),
            size: lstatSync(legalPath).size,
          }
        : null,
    };
    const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
    if (verify) {
      const checkedInBundle = path.join(repositoryRoot, OUTPUT_PATH);
      const checkedInLegal = `${checkedInBundle}.LEGAL.txt`;
      if (!existsSync(checkedInBundle) || !existsSync(checkedInLegal)) {
        throw new Error("Legacy migrator artifacts are missing");
      }
      const expected = readFileSync(path.join(repositoryRoot, MANIFEST_PATH), "utf8");
      if (expected !== manifestJson) throw new Error("Legacy migrator manifest is stale");
      if (sha256File(checkedInBundle) !== sha256File(outputPath)) {
        throw new Error("Legacy migrator bundle is stale");
      }
      if (sha256File(checkedInLegal) !== sha256File(legalPath)) {
        throw new Error("Legacy migrator legal notices are stale");
      }
    } else {
      writeFileSync(path.join(repositoryRoot, MANIFEST_PATH), manifestJson);
    }
    process.stdout.write(`${JSON.stringify(manifest)}\n`);
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
};

void main();
