import { readFile, stat } from "node:fs/promises";
import * as path from "node:path";

import type { ComposerPickedFile } from "../shared/ipc-api";

export const COMPOSER_PICKED_IMAGE_MAX_BYTES = 25 * 1024 * 1024;

export function resolveComposerFileMimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".gif") return "image/gif";
  if (extension === ".webp") return "image/webp";
  if (extension === ".bmp") return "image/bmp";
  if (extension === ".tif" || extension === ".tiff") return "image/tiff";
  if (extension === ".heic") return "image/heic";
  if (extension === ".heif") return "image/heif";
  return "application/octet-stream";
}

function isSupportedComposerImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

export async function prepareComposerPickedFile(filePath: string): Promise<ComposerPickedFile> {
  const label = path.basename(filePath);
  const pickedFile: ComposerPickedFile = {
    label,
    path: filePath,
  };

  const mimeType = resolveComposerFileMimeType(filePath);
  if (!isSupportedComposerImageMimeType(mimeType)) {
    return pickedFile;
  }

  const stats = await stat(filePath).catch(() => null);
  if (!stats) {
    return pickedFile;
  }
  if (!stats.isFile() || stats.size > COMPOSER_PICKED_IMAGE_MAX_BYTES) {
    return pickedFile;
  }

  const buffer = await readFile(filePath).catch(() => null);
  if (!buffer) {
    return pickedFile;
  }

  return {
    ...pickedFile,
    bytes: stats.size,
    mimeType,
    imageDataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
  };
}

export async function prepareComposerPickedFiles(filePaths: readonly string[]): Promise<ComposerPickedFile[]> {
  const preparedFiles: ComposerPickedFile[] = [];

  for (const filePath of filePaths) {
    preparedFiles.push(await prepareComposerPickedFile(filePath));
  }

  return preparedFiles;
}
