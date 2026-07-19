import type { WorkspaceFileDirectoryEntry } from "@/lib/types";

const TEXT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".conf",
  ".cpp",
  ".css",
  ".env",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".log",
  ".md",
  ".mjs",
  ".py",
  ".rs",
  ".sh",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);
const IMAGE_EXTENSIONS = new Set([".bmp", ".gif", ".ico", ".jpeg", ".jpg", ".png", ".svg", ".webp"]);
const GENERATED_NAMES = new Set([".git", "node_modules", "dist", "build", "out", "target", ".next", ".turbo"]);

export type WorkspaceFilePreviewKind =
  | "markdown"
  | "text"
  | "image"
  | "pdf"
  | "spreadsheet"
  | "unsupported";

export function normalizeWorkspacePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "") || path;
}

export function isWorkspacePathInsideRoot(workspaceRoot: string, targetPath: string): boolean {
  const normalizedRoot = normalizeWorkspacePath(workspaceRoot);
  const normalizedTarget = normalizeWorkspacePath(targetPath);
  const windowsPath = /^[A-Za-z]:\//.test(normalizedRoot);
  const comparableRoot = windowsPath ? normalizedRoot.toLowerCase() : normalizedRoot;
  const comparableTarget = windowsPath ? normalizedTarget.toLowerCase() : normalizedTarget;
  return comparableTarget === comparableRoot || comparableTarget.startsWith(`${comparableRoot}/`);
}

export function resolveWorkspaceTreeFilePath(workspaceRoot: string, relativePath: string): string {
  const separator = workspaceRoot.includes("\\") && !workspaceRoot.includes("/") ? "\\" : "/";
  const root = workspaceRoot.replace(/[\\/]+$/, "");
  const child = relativePath.replace(/^[\\/]+/, "").replace(/[\\/]/g, separator);
  return child ? `${root}${separator}${child}` : root;
}

export function getWorkspaceRelativePath(workspaceRoot: string, targetPath: string): string | null {
  if (!isWorkspacePathInsideRoot(workspaceRoot, targetPath)) return null;
  const normalizedRoot = normalizeWorkspacePath(workspaceRoot);
  const normalizedTarget = normalizeWorkspacePath(targetPath);
  return normalizedTarget.slice(normalizedRoot.length).replace(/^\/+/, "");
}

export function getWorkspaceFileName(path: string): string {
  const normalized = normalizeWorkspacePath(path);
  const parts = normalized.split("/");
  return parts.at(-1) || normalized;
}

export function getWorkspaceFileExtension(path: string): string {
  const name = getWorkspaceFileName(path);
  const dotIndex = name.lastIndexOf(".");
  return dotIndex > 0 ? name.slice(dotIndex).toLowerCase() : "";
}

export function getWorkspaceFileDomTabId(hostId: string | undefined, path: string | undefined): string | undefined {
  if (!path) return undefined;
  return `file:${hostId || "local"}:${path}`;
}

export function resolveWorkspaceFilePreviewKind(path: string, mimeType: string | null | undefined): WorkspaceFilePreviewKind {
  const extension = getWorkspaceFileExtension(path);
  if (extension === ".md" || extension === ".markdown" || mimeType === "text/markdown") return "markdown";
  if (IMAGE_EXTENSIONS.has(extension) || mimeType?.startsWith("image/")) return "image";
  if (extension === ".pdf" || mimeType === "application/pdf") return "pdf";
  if (extension === ".csv" || extension === ".tsv" || mimeType === "text/csv") return "spreadsheet";
  if (TEXT_EXTENSIONS.has(extension) || mimeType?.startsWith("text/")) return "text";
  return "unsupported";
}

export function shouldIncludeWorkspaceTreeEntry(entry: WorkspaceFileDirectoryEntry, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return entry.name.toLowerCase().includes(normalizedQuery) || entry.path.toLowerCase().includes(normalizedQuery);
}

export function isGeneratedWorkspaceEntry(entry: Pick<WorkspaceFileDirectoryEntry, "name" | "type">): boolean {
  return entry.type === "directory" && GENERATED_NAMES.has(entry.name);
}
