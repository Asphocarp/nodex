import type Database from "better-sqlite3";

const NODEX_AGENT_SIGNING_KEY_BYTES = 32;

export function readNodexAgentSigningKey(
  database: Database.Database,
): Buffer | null {
  const row = database.prepare(
    "SELECT key_material FROM nodex_agent_token_keys WHERE id = 1",
  ).get() as { readonly key_material: Buffer } | undefined;
  if (row?.key_material.byteLength === NODEX_AGENT_SIGNING_KEY_BYTES) {
    return row.key_material;
  }
  return null;
}
