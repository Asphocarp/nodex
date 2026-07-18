import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

type TargetArchitecture = "arm64" | "x64";

interface Arguments {
  readonly targetArch: TargetArchitecture;
  readonly outputRoot: string;
  readonly signIdentity: string | null;
}

const TARGETS: Readonly<Record<TargetArchitecture, string>> = {
  arm64: "aarch64-apple-darwin",
  x64: "x86_64-apple-darwin",
};

const expectedFileArchitecture = (architecture: TargetArchitecture): string =>
  architecture === "arm64" ? "arm64" : "x86_64";

const parseArguments = (argv: readonly string[]): Arguments => {
  let targetArch: TargetArchitecture | null = null;
  let outputRoot: string | null = null;
  let signIdentity: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = argv[index + 1];
    if (value === "--target-arch" && (next === "arm64" || next === "x64")) {
      targetArch = next;
      index += 1;
      continue;
    }
    if (value === "--out" && next) {
      outputRoot = next;
      index += 1;
      continue;
    }
    if (value === "--sign-identity" && next) {
      signIdentity = next;
      index += 1;
      continue;
    }
    throw new Error(`Unknown or incomplete argument: ${value ?? "<missing>"}`);
  }

  if (!targetArch || !outputRoot) {
    throw new Error(
      "usage: stage-rust-core --target-arch arm64|x64 --out <.generated/path> [--sign-identity <identity>]",
    );
  }
  return { targetArch, outputRoot, signIdentity };
};

const assertGeneratedOutput = (repositoryRoot: string, outputRoot: string): string => {
  const generatedRoot = path.join(repositoryRoot, ".generated");
  const resolved = path.resolve(repositoryRoot, outputRoot);
  if (!resolved.startsWith(`${generatedRoot}${path.sep}`)) {
    throw new Error(`Rust runtime staging must stay beneath ${generatedRoot}`);
  }
  return resolved;
};

const assertNotSymlink = (entry: string): void => {
  try {
    if (lstatSync(entry).isSymbolicLink()) {
      throw new Error(`Refusing symlinked staging entry: ${entry}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
};

const sha256 = (file: string): string =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

const stage = ({ targetArch, outputRoot, signIdentity }: Arguments): void => {
  const repositoryRoot = path.resolve(".");
  const target = TARGETS[targetArch];
  const resolvedOutput = assertGeneratedOutput(repositoryRoot, outputRoot);
  const binDirectory = path.join(resolvedOutput, "bin");
  assertNotSymlink(resolvedOutput);
  assertNotSymlink(binDirectory);
  mkdirSync(binDirectory, { recursive: true, mode: 0o755 });

  const binaries = ["nodex-core", "nodex"] as const;
  const entries = binaries.map((name) => {
    const source = path.join(repositoryRoot, "target", target, "release", name);
    const sourceStats = statSync(source);
    if (!sourceStats.isFile()) throw new Error(`Missing Rust binary: ${source}`);

    const fileDescription = execFileSync("file", ["-b", source], {
      encoding: "utf8",
    }).trim();
    const architecture = expectedFileArchitecture(targetArch);
    if (!fileDescription.includes("Mach-O") || !fileDescription.includes(architecture)) {
      throw new Error(`${name} has wrong architecture: ${fileDescription}`);
    }

    const loadCommands = execFileSync("otool", ["-l", source], {
      encoding: "utf8",
    });
    if (!/LC_BUILD_VERSION[\s\S]*?minos 12\.0\b/.test(loadCommands)) {
      throw new Error(`${name} does not declare macOS 12.0 compatibility`);
    }

    const destination = path.join(binDirectory, name);
    assertNotSymlink(destination);
    copyFileSync(source, destination);
    chmodSync(destination, 0o755);
    if (signIdentity) {
      execFileSync("codesign", [
        "--force",
        "--sign",
        signIdentity,
        "--timestamp=none",
        destination,
      ]);
      execFileSync("codesign", ["--verify", "--strict", destination]);
    }

    const stats = statSync(destination);
    if ((stats.mode & 0o777) !== 0o755) {
      throw new Error(`${name} was not staged executable`);
    }
    return {
      name,
      sha256: sha256(destination),
      size: stats.size,
      file: fileDescription,
      signed: signIdentity !== null,
    };
  });

  const manifest = {
    schemaVersion: 1,
    targetArch,
    rustTarget: target,
    minimumMacOS: "12.0",
    binaries: entries,
  };
  writeFileSync(
    path.join(binDirectory, "rust-core-runtime.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(manifest)}\n`);
};

stage(parseArguments(process.argv.slice(2)));
