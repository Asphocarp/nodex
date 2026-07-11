import type Database from "better-sqlite3";

/** Read the epoch that fences every command against whole-store replacement. */
export const readBlockStoreEpoch = (
  database: Database.Database,
): string | null =>
  (
    database
      .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
      .get() as { readonly store_epoch: string } | undefined
  )?.store_epoch ?? null;

export const requireBlockStoreEpoch = (
  database: Database.Database,
): string => {
  const storeEpoch = readBlockStoreEpoch(database);
  if (storeEpoch) return storeEpoch;
  throw new Error("Block store metadata is missing");
};
