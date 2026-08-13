import { execFile } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Project, ProjectCreateInput } from "../shared/types";
import { getLogger } from "./logging/logger";

const DEFAULT_PROJECT_NAME = "New project";
const WINDOWS_RESERVED_FILE_NAME =
  /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;
const logger = getLogger({ subsystem: "default-project-source" });

type CreateProject = (input: ProjectCreateInput) => Promise<Project>;

interface CreateProjectWithDefaultSourceOptions {
  projectsDirectory: string;
  createProject: CreateProject;
  createDirectory?: (path: string) => Promise<void>;
  pathExists?: (path: string) => Promise<boolean>;
  initializeRepository?: (path: string) => Promise<void>;
}

function runGit(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        encoding: "utf8",
        timeout: 5_000,
        windowsHide: true,
      },
      (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      },
    );
  });
}

async function defaultPathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function defaultCreateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function defaultInitializeRepository(path: string): Promise<void> {
  await runGit(["--version"], path);
  await runGit(["init"], path);
}

export function sanitizeDefaultProjectDirectoryName(name: string): string {
  const sanitized = Array.from(basename(name).trim(), (character) => {
    const isControlCharacter = character.charCodeAt(0) < 32;
    return isControlCharacter || '<>:"/\\|?*'.includes(character)
      ? "_"
      : character;
  }).join("").replace(/[ .]+$/g, "");

  if (!sanitized) return DEFAULT_PROJECT_NAME;
  if (WINDOWS_RESERVED_FILE_NAME.test(sanitized)) return `_${sanitized}`;
  return sanitized;
}

export async function findAvailableDefaultProjectSource(
  projectsDirectory: string,
  directoryName: string,
  pathExists: (path: string) => Promise<boolean> = defaultPathExists,
): Promise<string> {
  let suffix: number | null = null;
  while (true) {
    const candidateName =
      suffix === null ? directoryName : `${directoryName} ${suffix}`;
    const candidate = join(projectsDirectory, candidateName);
    if (!await pathExists(candidate)) return candidate;
    suffix = suffix === null ? 2 : suffix + 1;
  }
}

export async function createProjectWithDefaultSource(
  input: ProjectCreateInput,
  options: CreateProjectWithDefaultSourceOptions,
): Promise<Project> {
  if ((input.sources?.length ?? 0) > 0) {
    return await options.createProject(input);
  }

  const directoryName = sanitizeDefaultProjectDirectoryName(input.name ?? "");
  const source = await findAvailableDefaultProjectSource(
    options.projectsDirectory,
    directoryName,
    options.pathExists,
  );
  await (options.createDirectory ?? defaultCreateDirectory)(source);

  try {
    await (options.initializeRepository ?? defaultInitializeRepository)(source);
  } catch (error) {
    logger.warn("Failed to initialize default Project source as a Git repository", {
      error,
      source,
    });
  }

  return await options.createProject({
    ...input,
    sources: [source],
  });
}
