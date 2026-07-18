import * as fs from "fs";
import * as path from "path";

export const DATABASE_FILE_NAME = "nodex.db";

const LEGACY_DATABASE_FILE_NAME = "kanban.db";
const DATABASE_SIDE_CAR_SUFFIXES = ["", "-wal", "-shm"] as const;

export function migrateLegacyDatabaseFileName(nodexHome: string): void {
  const legacyDatabasePath = path.join(nodexHome, LEGACY_DATABASE_FILE_NAME);
  const databasePath = path.join(nodexHome, DATABASE_FILE_NAME);
  if (!fs.existsSync(legacyDatabasePath) || fs.existsSync(databasePath)) return;

  const plannedMoves = DATABASE_SIDE_CAR_SUFFIXES.map((suffix) => ({
    sourcePath: `${legacyDatabasePath}${suffix}`,
    destinationPath: `${databasePath}${suffix}`,
  }));

  const hasTargetSideCarConflict = plannedMoves
    .slice(1)
    .some((move) => fs.existsSync(move.destinationPath));
  if (hasTargetSideCarConflict) return;

  fs.mkdirSync(nodexHome, { recursive: true });
  for (const move of plannedMoves) {
    if (!fs.existsSync(move.sourcePath)) continue;
    fs.renameSync(move.sourcePath, move.destinationPath);
  }
}
