import { lstat, mkdir, readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { resolveNodexProjectsDirectory } from "../nodex-projects-directory";
import { isMissingPathError, syncDirectory, writeDurableJson } from "../durable-json-file";
import type { InitialProjectJournal } from "./initial-project-journal-store";

const MARKER_FILE_NAME = ".nodex-initial-project-v2.json";
const MARKER_MAX_BYTES = 4 * 1024;

const InitialProjectMarkerSchema = z
  .object({
    schemaVersion: z.literal(2),
    attemptId: z.string().uuid(),
    projectId: z.string().uuid(),
  })
  .strict();

export type InitialProjectDirectoryState = "missing" | "real" | "unsafe";

export const createInitialProjectId = (): string => randomUUID();

export function resolveInitialProjectProjectsDirectory(input: {
  readonly configuredDirectory?: string;
  readonly documentsDirectory: string;
}): string {
  const configured = input.configuredDirectory?.trim();
  if (configured !== undefined && configured.length > 0) {
    if (!isAbsolute(configured)) {
      throw new Error("NODEX_INITIAL_PROJECTS_DIR must be an absolute path");
    }
    return configured;
  }
  return resolveNodexProjectsDirectory(input.documentsDirectory);
}

export async function ensureRealDirectory(directoryPath: string): Promise<void> {
  if (!isAbsolute(directoryPath)) {
    throw new Error("Initial Project directory must be absolute");
  }
  await mkdir(directoryPath, { recursive: true, mode: 0o700 });
  const metadata = await lstat(directoryPath);
  if (metadata.isDirectory() && !metadata.isSymbolicLink()) return;
  throw new Error("Initial Project source parent must be a real directory");
}

export async function inspectInitialProjectDirectory(
  directoryPath: string,
): Promise<InitialProjectDirectoryState> {
  try {
    const metadata = await lstat(directoryPath);
    return metadata.isDirectory() && !metadata.isSymbolicLink() ? "real" : "unsafe";
  } catch (error) {
    if (isMissingPathError(error)) return "missing";
    throw error;
  }
}

export async function claimInitialProjectDirectory(directoryPath: string): Promise<boolean> {
  try {
    await mkdir(directoryPath, { mode: 0o700 });
    return true;
  } catch (error) {
    if (isAlreadyExistsError(error)) return false;
    throw error;
  }
}

export async function writeInitialProjectMarker(
  root: string,
  attempt: InitialProjectJournal,
): Promise<void> {
  await writeDurableJson(
    join(root, MARKER_FILE_NAME),
    {
      schemaVersion: 2,
      attemptId: attempt.attemptId,
      projectId: attempt.payload.projectId,
    },
    MARKER_MAX_BYTES,
  );
}

export async function initialProjectMarkerMatches(
  root: string,
  attempt: InitialProjectJournal,
): Promise<boolean> {
  try {
    const markerPath = join(root, MARKER_FILE_NAME);
    const metadata = await lstat(markerPath);
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MARKER_MAX_BYTES) {
      return false;
    }
    const raw = await readFile(markerPath, "utf8");
    if (Buffer.byteLength(raw, "utf8") > MARKER_MAX_BYTES) return false;
    const parsed = InitialProjectMarkerSchema.safeParse(JSON.parse(raw) as unknown);
    return (
      parsed.success &&
      parsed.data.attemptId === attempt.attemptId &&
      parsed.data.projectId === attempt.payload.projectId
    );
  } catch {
    return false;
  }
}

export async function removeOwnedInitialProjectMarker(
  root: string,
  attempt: InitialProjectJournal,
): Promise<void> {
  if (!(await initialProjectMarkerMatches(root, attempt))) return;
  await rm(join(root, MARKER_FILE_NAME), { force: true });
  await syncDirectory(root);
}

export function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
