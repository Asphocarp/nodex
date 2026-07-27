import {
  EXTENSION_TO_FILE_FORMAT,
  getFiletypeFromFileName,
  type SupportedLanguages,
} from "@pierre/diffs";

const IMAGE_EXTENSIONS = new Set([".bmp", ".gif", ".ico", ".jpeg", ".jpg", ".png", ".svg", ".webp"]);

export const WORKSPACE_TEXT_EDITABLE_MAX_BYTES = 10 * 1024 * 1024;
export const WORKSPACE_TEXT_LOAD_MAX_BYTES = 20 * 1024 * 1024;

export type WorkspaceFilePresentation =
  | "markdown"
  | "editable-text"
  | "readonly-text"
  | "image"
  | "pdf"
  | "spreadsheet"
  | "too-large"
  | "unsupported";

export interface WorkspaceFilePresentationInput {
  readonly path: string;
  readonly contentKind: "text" | "binary" | undefined;
  readonly mimeType?: string | null;
  readonly sizeBytes: number | null;
}

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

export function resolveWorkspaceSourceLanguage(path: string): SupportedLanguages | null {
  const name = getWorkspaceFileName(path);
  if (EXTENSION_TO_FILE_FORMAT[name] !== undefined) {
    return getFiletypeFromFileName(name);
  }

  const compoundExtension = name.match(/\.([^.]+\.[^.]+)$/)?.[1];
  if (compoundExtension && EXTENSION_TO_FILE_FORMAT[compoundExtension] !== undefined) {
    return getFiletypeFromFileName(name);
  }

  const extension = name.match(/\.([^.]+)$/)?.[1] ?? "";
  return EXTENSION_TO_FILE_FORMAT[extension] === undefined
    ? null
    : getFiletypeFromFileName(name);
}

export function resolveWorkspaceFilePresentation({
  path,
  contentKind,
  mimeType,
  sizeBytes,
}: WorkspaceFilePresentationInput): WorkspaceFilePresentation {
  const extension = getWorkspaceFileExtension(path);
  if (IMAGE_EXTENSIONS.has(extension) || mimeType?.startsWith("image/")) return "image";
  if (extension === ".pdf" || mimeType === "application/pdf") return "pdf";
  if (sizeBytes !== null && sizeBytes > WORKSPACE_TEXT_LOAD_MAX_BYTES) {
    return "too-large";
  }
  if (extension === ".md" || extension === ".markdown" || mimeType === "text/markdown") {
    return contentKind === "binary" ? "unsupported" : "markdown";
  }
  if (extension === ".csv" || extension === ".tsv" || mimeType === "text/csv") {
    return contentKind === "binary" ? "unsupported" : "spreadsheet";
  }
  if (contentKind !== "text" && !mimeType?.startsWith("text/")) return "unsupported";
  if (
    sizeBytes !== null
    && sizeBytes < WORKSPACE_TEXT_EDITABLE_MAX_BYTES
    && resolveWorkspaceSourceLanguage(path) !== null
  ) {
    return "editable-text";
  }
  return "readonly-text";
}
