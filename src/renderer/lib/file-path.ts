export function normalizeSlashes(value: string): string {
  return value.replaceAll("\\", "/");
}

export function stripPatchPrefix(value: string): string {
  return normalizeSlashes(value).replace(/^([ab])\//, "");
}

export function basename(filePath: string): string {
  const cleaned = stripPatchPrefix(filePath);
  const parts = cleaned.split("/").filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? cleaned;
}

export function normalizePathSegments(value: string): string {
  const normalizedSlashes = normalizeSlashes(value);
  const isAbsolute = normalizedSlashes.startsWith("/");
  const segments = normalizedSlashes.split("/");
  const normalized: string[] = [];

  for (const segment of segments) {
    if (segment.length === 0 || segment === ".") continue;
    if (segment === "..") {
      if (normalized.length > 0 && normalized[normalized.length - 1] !== "..") {
        normalized.pop();
        continue;
      }
      if (!isAbsolute) normalized.push(segment);
      continue;
    }

    normalized.push(segment);
  }

  if (isAbsolute) return `/${normalized.join("/")}`;
  return normalized.join("/");
}

export function resolveOpenPath(
  path: string | null,
  basePath: string | null,
): string | null {
  if (!path) return null;

  const normalizedPath = normalizePathSegments(stripPatchPrefix(path));
  if (normalizedPath.length === 0) return null;
  if (normalizedPath.startsWith("/") || /^[a-zA-Z]:\//.test(normalizedPath)) {
    return normalizedPath;
  }

  if (!basePath) return null;
  const normalizedBase = normalizePathSegments(basePath);
  if (normalizedBase.length === 0) return null;
  return normalizePathSegments(`${normalizedBase}/${normalizedPath}`);
}
