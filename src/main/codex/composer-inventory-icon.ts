import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute } from "node:path";

const COMPOSER_INVENTORY_ICON_MAX_BYTES = 1024 * 1024;

const COMPOSER_INVENTORY_ICON_MIME_TYPES: Readonly<Record<string, string>> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

export type ComposerInventoryIconLoader = (filePath: string) => Promise<Uint8Array | null>;

async function readComposerInventoryIcon(filePath: string): Promise<Uint8Array | null> {
  const metadata = await stat(filePath).catch(() => null);
  if (
    !metadata?.isFile() ||
    metadata.size <= 0 ||
    metadata.size > COMPOSER_INVENTORY_ICON_MAX_BYTES
  ) {
    return null;
  }
  return readFile(filePath).catch(() => null);
}

export async function loadComposerInventoryIconDataUrl(
  filePath: string | null | undefined,
  loadIcon: ComposerInventoryIconLoader = readComposerInventoryIcon,
): Promise<string | null> {
  const normalizedPath = filePath?.trim() ?? "";
  if (!normalizedPath || !isAbsolute(normalizedPath)) return null;
  const mimeType = COMPOSER_INVENTORY_ICON_MIME_TYPES[extname(normalizedPath).toLocaleLowerCase()];
  if (!mimeType) return null;

  const bytes = await loadIcon(normalizedPath).catch(() => null);
  if (!bytes || bytes.byteLength === 0 || bytes.byteLength > COMPOSER_INVENTORY_ICON_MAX_BYTES) {
    return null;
  }
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}
