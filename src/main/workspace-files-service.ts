import { existsSync } from "node:fs";
import { mkdir, open, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve, sep } from "node:path";
import type {
  WorkspaceDirectoryEntriesInput,
  WorkspaceDirectoryEntriesResult,
  WorkspaceFileBinaryReadResult,
  WorkspaceFileDirectoryEntry,
  WorkspaceFileEntryKind,
  WorkspaceFileMetadata,
  WorkspaceFileReadInput,
  WorkspaceFileReadResult,
  WorkspaceFileRequest,
  WorkspaceFileWriteInput,
  WorkspaceFileWriteResult,
  WorkspacePathsExistInput,
  WorkspacePathsExistResult,
} from "../shared/types";

const DEFAULT_MAX_TEXT_BYTES = 1_500_000;
const BINARY_SAMPLE_BYTES = 8_192;
const GENERATED_DIRECTORY_NAMES = new Set([
  ".cache",
  ".git",
  ".hg",
  ".next",
  ".turbo",
  ".vite",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
]);

const MIME_BY_EXTENSION = new Map<string, string>([
  [".bmp", "image/bmp"],
  [".css", "text/css"],
  [".csv", "text/csv"],
  [".gif", "image/gif"],
  [".htm", "text/html"],
  [".html", "text/html"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript"],
  [".json", "application/json"],
  [".md", "text/markdown"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".ts", "text/typescript"],
  [".tsx", "text/typescript"],
  [".txt", "text/plain"],
  [".webp", "image/webp"],
  [".xml", "application/xml"],
  [".yaml", "application/yaml"],
  [".yml", "application/yaml"],
]);

function normalizeHostId(value: WorkspaceDirectoryEntriesInput["hostId"]): "local" {
  if (value && value !== "local") {
    throw new Error(`Unsupported workspace file host: ${value}`);
  }
  return "local";
}

function normalizeAbsolutePath(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required`);
  return resolve(trimmed);
}

function assertPathInsideRoot(workspaceRoot: string, targetPath: string): void {
  const root = normalizeAbsolutePath(workspaceRoot, "Workspace root");
  const target = normalizeAbsolutePath(targetPath, "Workspace path");
  const normalizedRoot = process.platform === "win32" ? root.toLowerCase() : root;
  const normalizedTarget = process.platform === "win32" ? target.toLowerCase() : target;
  if (normalizedTarget === normalizedRoot) return;
  if (normalizedTarget.startsWith(`${normalizedRoot}${sep}`)) return;
  throw new Error("Workspace path must stay inside the project root");
}

function resolveWorkspacePath(input: WorkspaceDirectoryEntriesInput): { hostId: "local"; workspaceRoot: string; path: string } {
  const hostId = normalizeHostId(input.hostId);
  const workspaceRoot = normalizeAbsolutePath(input.workspaceRoot, "Workspace root");
  const path = normalizeAbsolutePath(input.path ?? workspaceRoot, "Workspace path");
  assertPathInsideRoot(workspaceRoot, path);
  return { hostId, workspaceRoot, path };
}

function resolveRequestPath(input: WorkspaceFileRequest): { hostId: "local"; path: string } {
  const hostId = normalizeHostId(input.hostId);
  const path = normalizeAbsolutePath(input.path, "File path");
  if (input.workspaceRoot?.trim()) {
    assertPathInsideRoot(input.workspaceRoot, path);
  }
  return { hostId, path };
}

function inferKind(stats: Awaited<ReturnType<typeof stat>>): WorkspaceFileEntryKind {
  if (stats.isDirectory()) return "directory";
  if (stats.isFile()) return "file";
  if (stats.isSymbolicLink()) return "symlink";
  return "other";
}

function inferMimeType(filePath: string): string | null {
  return MIME_BY_EXTENSION.get(extname(filePath).toLowerCase()) ?? null;
}

function isProbablyBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;
  const sample = buffer.subarray(0, BINARY_SAMPLE_BYTES);
  if (sample.includes(0)) return true;

  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13) continue;
    if (byte >= 32) continue;
    suspicious += 1;
  }
  return suspicious / sample.length > 0.08;
}

async function readBinaryFlag(filePath: string): Promise<boolean> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(BINARY_SAMPLE_BYTES);
    const result = await handle.read(buffer, 0, buffer.length, 0);
    return isProbablyBinary(buffer.subarray(0, result.bytesRead));
  } finally {
    await handle.close();
  }
}

function shouldSkipEntry(entry: { name: string; isDirectory: boolean }, input: WorkspaceDirectoryEntriesInput): boolean {
  if (entry.name.startsWith(".") && input.includeHidden !== true) return true;
  if (entry.isDirectory && input.includeGenerated !== true && GENERATED_DIRECTORY_NAMES.has(entry.name)) return true;
  return false;
}

function sortEntries(a: WorkspaceFileDirectoryEntry, b: WorkspaceFileDirectoryEntry): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
}

export async function listWorkspaceDirectoryEntries(
  input: WorkspaceDirectoryEntriesInput,
): Promise<WorkspaceDirectoryEntriesResult> {
  const resolved = resolveWorkspacePath(input);
  const entries = await readdir(resolved.path, { withFileTypes: true });
  const results: WorkspaceFileDirectoryEntry[] = [];

  for (const entry of entries) {
    const entryPath = resolve(resolved.path, entry.name);
    const entryStats = await stat(entryPath).catch(() => null);
    if (!entryStats) continue;

    const isDirectory = entryStats.isDirectory();
    if (shouldSkipEntry({ name: entry.name, isDirectory }, input)) continue;

    results.push({
      name: entry.name,
      path: entryPath,
      kind: inferKind(entryStats),
      isDirectory,
      isFile: entryStats.isFile(),
      isSymlink: entry.isSymbolicLink(),
      size: entryStats.size,
      modifiedAtMs: entryStats.mtimeMs,
      hidden: entry.name.startsWith("."),
    });
  }

  return {
    hostId: resolved.hostId,
    workspaceRoot: resolved.workspaceRoot,
    path: resolved.path,
    entries: results.sort(sortEntries),
  };
}

export async function readWorkspaceFile(input: WorkspaceFileReadInput): Promise<WorkspaceFileReadResult> {
  const { path } = resolveRequestPath(input);
  const metadata = await readWorkspaceFileMetadata(input);
  if (!metadata.isFile) throw new Error("Path is not a file");
  if (metadata.binary) {
    return {
      path,
      content: "",
      encoding: "utf8",
      size: metadata.size,
      truncated: false,
      binary: true,
    };
  }

  const maxBytes = Math.max(1, input.maxBytes ?? DEFAULT_MAX_TEXT_BYTES);
  const buffer = await readFile(path);
  const truncated = buffer.length > maxBytes;
  return {
    path,
    content: buffer.subarray(0, maxBytes).toString("utf8"),
    encoding: "utf8",
    size: buffer.length,
    truncated,
    binary: false,
  };
}

export async function readWorkspaceFileMetadata(input: WorkspaceFileRequest): Promise<WorkspaceFileMetadata> {
  const { path } = resolveRequestPath(input);
  const stats = await stat(path);
  const isFile = stats.isFile();
  return {
    path,
    kind: inferKind(stats),
    isDirectory: stats.isDirectory(),
    isFile,
    isSymlink: stats.isSymbolicLink(),
    size: stats.size,
    createdAtMs: stats.birthtimeMs,
    modifiedAtMs: stats.mtimeMs,
    binary: isFile ? await readBinaryFlag(path) : false,
    mimeType: inferMimeType(path),
  };
}

export async function readWorkspaceFileBinary(input: WorkspaceFileRequest): Promise<WorkspaceFileBinaryReadResult> {
  const { path } = resolveRequestPath(input);
  const bytes = await readFile(path);
  return {
    path,
    dataBase64: bytes.toString("base64"),
    size: bytes.length,
    mimeType: inferMimeType(path),
  };
}

export async function writeWorkspaceFile(input: WorkspaceFileWriteInput): Promise<WorkspaceFileWriteResult> {
  const { path } = resolveRequestPath(input);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, input.content, "utf8");
  const stats = await stat(path);
  return {
    path,
    size: stats.size,
    modifiedAtMs: stats.mtimeMs,
  };
}

export async function readWorkspacePathsExist(input: WorkspacePathsExistInput): Promise<WorkspacePathsExistResult> {
  normalizeHostId(input.hostId);
  return {
    paths: Object.fromEntries(input.paths.map((filePath) => [filePath, existsSync(filePath)])),
  };
}

export function getWorkspaceFileDisplayName(filePath: string): string {
  return basename(filePath) || filePath;
}
