import type Database from "better-sqlite3";

import type { LocalProfileLibrary } from "../../shared/library";

export const readLocalProfileLibraryInDatabase = (
  database: Database.Database,
): LocalProfileLibrary | null => {
  const rows = database.prepare(`
    SELECT profile.id AS profileId, library.id AS libraryId
    FROM profiles profile
    INNER JOIN libraries library ON library.profile_id = profile.id
    ORDER BY profile.created_at ASC, profile.id ASC
  `).all() as LocalProfileLibrary[];
  if (rows.length <= 1) return rows[0] ?? null;
  throw new Error("A local store may contain only one Profile Library");
};

export const requireLocalProfileLibraryInDatabase = (
  database: Database.Database,
): LocalProfileLibrary => {
  const identity = readLocalProfileLibraryInDatabase(database);
  if (identity) return identity;
  throw new Error("The local Profile Library is missing");
};
