import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

interface BuildStamp {
  readonly architecture: "arm64" | "x64";
  readonly minimumMacOS: "12.0";
  readonly sourceSha256: string;
}

function parseOutputPath(argv: readonly string[]): string {
  const outputFlagIndex = argv.indexOf("--out");
  const outputPath = outputFlagIndex < 0 ? null : argv[outputFlagIndex + 1];
  if (!outputPath || outputFlagIndex + 2 !== argv.length) {
    throw new Error(
      "usage: build-macos-appshot-helper --out <.generated/path>",
    );
  }
  return outputPath;
}

function resolveArchitecture(): BuildStamp["architecture"] {
  if (process.arch === "arm64" || process.arch === "x64") return process.arch;
  throw new Error(`Unsupported macOS architecture: ${process.arch}`);
}

function readStamp(pathname: string): BuildStamp | null {
  try {
    return JSON.parse(readFileSync(pathname, "utf8")) as BuildStamp;
  } catch {
    return null;
  }
}

function sameStamp(left: BuildStamp | null, right: BuildStamp): boolean {
  return left?.architecture === right.architecture
    && left.minimumMacOS === right.minimumMacOS
    && left.sourceSha256 === right.sourceSha256;
}

function main(): void {
  if (process.platform !== "darwin") return;

  const repositoryRoot = path.resolve(".");
  const generatedRoot = path.join(repositoryRoot, ".generated");
  const outputPath = path.resolve(repositoryRoot, parseOutputPath(process.argv.slice(2)));
  if (!outputPath.startsWith(`${generatedRoot}${path.sep}`)) {
    throw new Error("The Appshot helper output must stay beneath .generated");
  }

  const sourcePath = path.join(
    repositoryRoot,
    "resources",
    "macos",
    "nodex-appshot-helper.swift",
  );
  const architecture = resolveArchitecture();
  const sourceSha256 = createHash("sha256")
    .update(readFileSync(sourcePath))
    .digest("hex");
  const stamp: BuildStamp = {
    architecture,
    minimumMacOS: "12.0",
    sourceSha256,
  };
  const stampPath = `${outputPath}.build.json`;
  if (existsSync(outputPath) && sameStamp(readStamp(stampPath), stamp)) {
    return;
  }

  const outputDirectory = path.dirname(outputPath);
  mkdirSync(outputDirectory, { recursive: true, mode: 0o755 });
  const temporaryDirectory = mkdtempSync(
    path.join(outputDirectory, ".nodex-appshot-helper-"),
  );
  const temporaryBinary = path.join(temporaryDirectory, "helper");
  try {
    execFileSync("xcrun", [
      "swiftc",
      "-O",
      "-parse-as-library",
      "-target",
      `${architecture}-apple-macos12.0`,
      sourcePath,
      "-o",
      temporaryBinary,
    ], { stdio: "inherit" });
    chmodSync(temporaryBinary, 0o755);
    rmSync(outputPath, { force: true });
    renameSync(temporaryBinary, outputPath);
    writeFileSync(stampPath, `${JSON.stringify(stamp, null, 2)}\n`, {
      mode: 0o644,
    });
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

main();
