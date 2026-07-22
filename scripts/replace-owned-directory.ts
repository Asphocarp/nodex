import {
  existsSync,
  lstatSync,
  mkdtempSync,
  renameSync,
  rmSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

const assertRealDirectory = (directory: string, label: string): void => {
  const stats = lstatSync(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory: ${directory}`);
  }
};

const assertReplaceableDestination = (directory: string): void => {
  const stats = lstatSync(directory);
  if (!stats.isDirectory() && !stats.isSymbolicLink()) {
    throw new Error(`Replacement destination must be a directory entry: ${directory}`);
  }
};

export function replaceOwnedDirectory(sourceDir: string, destinationDir: string): void {
  assertRealDirectory(sourceDir, "Replacement source");
  if (!existsSync(destinationDir)) {
    renameSync(sourceDir, destinationDir);
    return;
  }

  assertReplaceableDestination(destinationDir);
  const backupDir = mkdtempSync(
    join(dirname(destinationDir), `${basename(destinationDir)}-backup-`),
  );
  rmSync(backupDir, { recursive: true, force: true });
  renameSync(destinationDir, backupDir);
  try {
    renameSync(sourceDir, destinationDir);
    rmSync(backupDir, { recursive: true, force: true });
  } catch (error) {
    if (!existsSync(destinationDir) && existsSync(backupDir)) {
      renameSync(backupDir, destinationDir);
    }
    throw error;
  }
}
