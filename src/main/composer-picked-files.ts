import { readFile, stat } from "node:fs/promises";
import * as path from "node:path";

import type { ComposerPickedFile } from "../shared/ipc-api";
import {
  isSupportedComposerImageMimeType,
  resolveComposerImageMimeType,
} from "../shared/composer-image-input";

export {
  COMPOSER_IMAGE_FILE_EXTENSIONS,
  isSupportedComposerImageMimeType,
} from "../shared/composer-image-input";

export const COMPOSER_PICKED_IMAGE_MAX_BYTES = 25 * 1024 * 1024;

export function resolveComposerFileMimeType(filePath: string): string {
  return resolveComposerImageMimeType({ filename: filePath }) ?? "application/octet-stream";
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
  if (!stats.isFile() || stats.size === 0 || stats.size > COMPOSER_PICKED_IMAGE_MAX_BYTES) {
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

export async function prepareComposerPickedFiles(
  filePaths: readonly string[],
): Promise<ComposerPickedFile[]> {
  const preparedFiles: ComposerPickedFile[] = [];

  for (const filePath of filePaths) {
    preparedFiles.push(await prepareComposerPickedFile(filePath));
  }

  return preparedFiles;
}
