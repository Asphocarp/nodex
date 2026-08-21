import { randomUUID } from "node:crypto";
import { lstat, mkdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  createCodexProjectlessWorkspace,
  resolveCodexProjectlessWorkspaceRoot,
} from "./codex-projectless-workspace";
import type { CodexProjectlessWorkspace } from "../../shared/types";

const GENERATED_DATE_DIRECTORY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const GENERATED_THREAD_DIRECTORY_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const MIGRATION_NUMERIC_ATTEMPTS = 100;
const MIGRATION_UNIQUE_ATTEMPTS = 5;

interface GeneratedProjectlessThreadPath {
  brand: "Codex" | "Nodex";
  dateDirectoryName: string;
  threadDirectoryName: string;
  workspaceRoot: string;
}

interface ProjectlessWorkspaceRepairInput {
  browserRoot: string | null;
  cwd: string | null;
  outputDirectory: string | null;
  prompt: string;
  writableRoots: readonly string[];
  homeDirectory?: string;
}

interface LegacyProjectlessWorkspaceMigrationInput {
  browserRoot: string | null;
  cwd: string;
  outputDirectory: string | null;
  homeDirectory?: string;
  uniqueDirectoryNameSuffix?: () => string;
}

function selectPathImplementation(value: string): typeof path.posix | typeof path.win32 {
  return /^[A-Za-z]:[\\/]/.test(value) || value.includes("\\") ? path.win32 : path.posix;
}

function resolveBrandedWorkspaceRoot(homeDirectory: string, brand: "Codex" | "Nodex"): string {
  const pathImplementation = selectPathImplementation(homeDirectory);
  return pathImplementation.join(homeDirectory, "Documents", brand);
}

function isPathInside(
  parent: string,
  candidate: string,
  pathImplementation: typeof path.posix | typeof path.win32,
): boolean {
  const relative = pathImplementation.relative(parent, candidate);
  return (
    relative.length > 0 &&
    !relative.startsWith(`..${pathImplementation.sep}`) &&
    relative !== ".." &&
    !pathImplementation.isAbsolute(relative)
  );
}

export function resolveGeneratedProjectlessThreadPath(
  candidatePath: string,
  homeDirectory: string = homedir(),
): GeneratedProjectlessThreadPath | null {
  const pathImplementation = selectPathImplementation(candidatePath);
  const resolvedCandidate = pathImplementation.resolve(candidatePath);

  for (const brand of ["Nodex", "Codex"] as const) {
    const workspaceRoot = pathImplementation.resolve(
      resolveBrandedWorkspaceRoot(homeDirectory, brand),
    );
    if (!isPathInside(workspaceRoot, resolvedCandidate, pathImplementation)) continue;

    const relative = pathImplementation.relative(workspaceRoot, resolvedCandidate);
    const segments = relative.split(pathImplementation.sep).filter(Boolean);
    if (segments.length !== 2) continue;
    const [dateDirectoryName, threadDirectoryName] = segments;
    if (!GENERATED_DATE_DIRECTORY_PATTERN.test(dateDirectoryName)) continue;
    if (!GENERATED_THREAD_DIRECTORY_PATTERN.test(threadDirectoryName)) continue;

    return {
      brand,
      dateDirectoryName,
      threadDirectoryName,
      workspaceRoot,
    };
  }

  return null;
}

async function isRealDirectory(candidatePath: string): Promise<boolean> {
  try {
    const metadata = await lstat(candidatePath);
    return metadata.isDirectory() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await lstat(candidatePath);
    return true;
  } catch {
    return false;
  }
}

function resolveOutputDirectoryAfterMove(input: {
  destinationCwd: string;
  outputDirectory: string | null;
  sourceCwd: string;
}): string {
  if (!input.outputDirectory || input.outputDirectory === input.sourceCwd) {
    return input.destinationCwd;
  }

  const pathImplementation = selectPathImplementation(input.sourceCwd);
  if (!isPathInside(input.sourceCwd, input.outputDirectory, pathImplementation)) {
    return input.destinationCwd;
  }
  return pathImplementation.join(
    input.destinationCwd,
    pathImplementation.relative(input.sourceCwd, input.outputDirectory),
  );
}

async function ensureRealDirectory(directoryPath: string): Promise<void> {
  await mkdir(directoryPath, { recursive: true });
  if (await isRealDirectory(directoryPath)) return;
  throw new Error("Projectless thread directory must be a real directory");
}

async function tryMoveDirectory(source: string, destination: string): Promise<boolean> {
  try {
    await rename(source, destination);
    return true;
  } catch (error) {
    if (await pathExists(destination)) return false;
    throw error;
  }
}

export async function migrateLegacyCodexProjectlessWorkspace(
  input: LegacyProjectlessWorkspaceMigrationInput,
): Promise<CodexProjectlessWorkspace | null> {
  const homeDirectory = input.homeDirectory ?? homedir();
  const generated = resolveGeneratedProjectlessThreadPath(input.cwd, homeDirectory);
  if (!generated || generated.brand !== "Codex") return null;
  if (!(await isRealDirectory(input.cwd))) return null;

  const pathImplementation = selectPathImplementation(input.cwd);
  const workspaceRoot = resolveCodexProjectlessWorkspaceRoot(homeDirectory);
  const dateDirectory = pathImplementation.join(workspaceRoot, generated.dateDirectoryName);
  await ensureRealDirectory(workspaceRoot);
  await ensureRealDirectory(dateDirectory);

  const names = Array.from({ length: MIGRATION_NUMERIC_ATTEMPTS }, (_, index) =>
    index === 0 ? generated.threadDirectoryName : `${generated.threadDirectoryName}-${index + 1}`,
  );
  const uniqueDirectoryNameSuffix = input.uniqueDirectoryNameSuffix ?? randomUUID;
  for (let index = 0; index < MIGRATION_UNIQUE_ATTEMPTS; index += 1) {
    names.push(`${generated.threadDirectoryName}-${uniqueDirectoryNameSuffix()}`);
  }

  for (const name of names) {
    const destinationCwd = pathImplementation.join(dateDirectory, name);
    if (!(await tryMoveDirectory(input.cwd, destinationCwd))) continue;
    return {
      cwd: destinationCwd,
      outputDirectory: resolveOutputDirectoryAfterMove({
        destinationCwd,
        outputDirectory: input.outputDirectory,
        sourceCwd: input.cwd,
      }),
      workspaceRoot,
    };
  }

  throw new Error("Unable to migrate a unique projectless thread directory");
}

export async function repairCodexProjectlessWorkspace(
  input: ProjectlessWorkspaceRepairInput,
): Promise<CodexProjectlessWorkspace | null> {
  const homeDirectory = input.homeDirectory ?? homedir();
  const generatedCwd = input.cwd
    ? resolveGeneratedProjectlessThreadPath(input.cwd, homeDirectory)
    : null;
  if (input.cwd && (await isRealDirectory(input.cwd))) {
    if (!generatedCwd) return null;
    const inferredOutputDirectory = path.join(input.cwd, "outputs");
    return {
      cwd: input.cwd,
      outputDirectory:
        input.outputDirectory ??
        ((await isRealDirectory(inferredOutputDirectory)) ? inferredOutputDirectory : input.cwd),
      workspaceRoot: generatedCwd.workspaceRoot,
    };
  }

  for (const candidate of [...input.writableRoots].reverse()) {
    const generatedCandidate = resolveGeneratedProjectlessThreadPath(candidate, homeDirectory);
    if (!generatedCandidate) continue;
    if (!(await isRealDirectory(candidate))) continue;
    return {
      cwd: candidate,
      outputDirectory: input.outputDirectory ?? candidate,
      workspaceRoot: generatedCandidate.workspaceRoot,
    };
  }

  if (
    input.browserRoot &&
    input.browserRoot !== "~" &&
    (await isRealDirectory(input.browserRoot))
  ) {
    return {
      cwd: input.browserRoot,
      outputDirectory: input.outputDirectory ?? input.browserRoot,
      workspaceRoot: input.browserRoot,
    };
  }

  return await createCodexProjectlessWorkspace({
    createSplitDirectories: false,
    homeDirectory,
    prompt: input.prompt,
  });
}
