import { lstat, mkdir, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

function readProfileArgument(argv: readonly string[]): string {
  const index = argv.indexOf("--profile");
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value) {
    throw new Error(
      "Usage: pnpm run core:read-budget-gate -- --profile .generated/<name>",
    );
  }
  return value;
}

async function prepareTarget(rawTarget: string): Promise<string> {
  const repositoryRoot = await realpath(process.cwd());
  const generatedRoot = await realpath(
    path.join(repositoryRoot, ".generated"),
  );
  const target = path.resolve(repositoryRoot, rawTarget);
  const relative = path.relative(generatedRoot, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Gate Profile must be a child of the repository .generated directory");
  }

  try {
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error("Gate Profile target must be a real directory");
    }
    if ((await readdir(target)).length > 0) {
      throw new Error("Gate Profile target must be empty");
    }
  } catch (error) {
    if (
      error instanceof Error
      && "code" in error
      && error.code === "ENOENT"
    ) {
      await mkdir(target);
    } else {
      throw error;
    }
  }
  return await realpath(target);
}

async function main(): Promise<void> {
  const target = await prepareTarget(readProfileArgument(process.argv.slice(2)));
  const child = spawn(
    "cargo",
    [
      "test",
      "-p",
      "nodex-core",
      "read_budget_gate_large_fixture",
      "--",
      "--ignored",
      "--nocapture",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODEX_READ_BUDGET_GATE_PROFILE: target,
      },
      stdio: "inherit",
    },
  );
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Read-budget gate terminated by ${signal}`));
        return;
      }
      resolve(code ?? 1);
    });
  });
  if (exitCode !== 0) process.exitCode = exitCode;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
