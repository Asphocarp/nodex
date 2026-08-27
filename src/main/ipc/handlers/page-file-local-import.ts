import * as fs from "node:fs/promises";
import path from "node:path";

import {
  PAGE_FILE_IMPORT_MAX_BYTES,
  PAGE_FILE_IMPORT_MAX_COUNT,
  PAGE_FILE_MAX_BYTES,
} from "../../../shared/page-files";

export interface LocalPageFileCandidate {
  readonly filePath: string;
  readonly logicalPath: string;
  readonly byteLength: number;
}

/**
 * Expands one native selection into a deterministic, bounded File batch.
 * Folder identity remains a logical-path prefix; only regular files become candidates.
 */
export async function collectLocalPageFileCandidates(
  selectedPaths: readonly string[],
): Promise<readonly LocalPageFileCandidate[]> {
  if (selectedPaths.length > PAGE_FILE_IMPORT_MAX_COUNT) {
    throw new Error("File import exceeds the 100 File batch limit");
  }

  const candidates: LocalPageFileCandidate[] = [];
  const uniqueRoots = new Set<string>();
  let totalBytes = 0;

  const addFile = async (filePath: string, logicalPath: string): Promise<void> => {
    const metadata = await fs.lstat(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`${logicalPath} is not a regular file`);
    }
    if (metadata.size > PAGE_FILE_MAX_BYTES) {
      throw new Error(`${logicalPath} exceeds the 64 MiB File limit`);
    }

    totalBytes += metadata.size;
    if (totalBytes > PAGE_FILE_IMPORT_MAX_BYTES) {
      throw new Error("File import exceeds the 256 MiB batch limit");
    }
    candidates.push({ filePath, logicalPath, byteLength: metadata.size });
    if (candidates.length > PAGE_FILE_IMPORT_MAX_COUNT) {
      throw new Error("File import exceeds the 100 File batch limit");
    }
  };

  const visitDirectory = async (directoryPath: string, logicalPath: string): Promise<void> => {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const entryPath = path.join(directoryPath, entry.name);
      const entryLogicalPath = `${logicalPath}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        throw new Error(`${entryLogicalPath} is a symbolic link`);
      }
      if (entry.isDirectory()) {
        await visitDirectory(entryPath, entryLogicalPath);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`${entryLogicalPath} is not a regular file or folder`);
      }
      await addFile(entryPath, entryLogicalPath);
    }
  };

  for (const selectedPath of selectedPaths) {
    if (!selectedPath || selectedPath !== selectedPath.trim() || !path.isAbsolute(selectedPath)) {
      throw new Error("Page File import requires absolute local paths");
    }
    const rootPath = path.resolve(selectedPath);
    if (uniqueRoots.has(rootPath)) continue;
    uniqueRoots.add(rootPath);

    const rootName = path.basename(rootPath);
    if (!rootName) throw new Error("Page File import root has no portable name");
    const metadata = await fs.lstat(rootPath);
    if (metadata.isSymbolicLink()) throw new Error(`${rootName} is a symbolic link`);
    if (metadata.isDirectory()) {
      await visitDirectory(rootPath, rootName);
      continue;
    }
    if (metadata.isFile()) {
      await addFile(rootPath, rootName);
      continue;
    }
    throw new Error(`${rootName} is not a regular file or folder`);
  }

  return candidates;
}
