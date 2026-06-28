import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { getLocalStoreDir } from "./local-store/config";
import type { CardDescriptionUpdateStartInput } from "../shared/types";

interface CardDescriptionStagingEntry extends CardDescriptionUpdateStartInput {
  stagingId: string;
  filePath: string;
  bytes: number;
}

const stagedDescriptions = new Map<string, CardDescriptionStagingEntry>();

function getStagingRoot(): string {
  return path.join(getLocalStoreDir(), "tmp", "card-description-updates");
}

function requireEntry(stagingId: string): CardDescriptionStagingEntry {
  const entry = stagedDescriptions.get(stagingId);
  if (!entry) {
    throw new Error("Unknown card description staging id");
  }
  return entry;
}

export async function startCardDescriptionStaging(
  input: CardDescriptionUpdateStartInput,
): Promise<{ stagingId: string }> {
  const stagingId = randomUUID();
  const root = getStagingRoot();
  await fs.mkdir(root, { recursive: true });
  const filePath = path.join(root, `${stagingId}.nfm`);
  await fs.writeFile(filePath, "");
  stagedDescriptions.set(stagingId, {
    ...input,
    stagingId,
    filePath,
    bytes: 0,
  });
  return { stagingId };
}

export async function appendCardDescriptionChunk(
  stagingId: string,
  chunk: string,
): Promise<{ ok: true; bytes: number }> {
  const entry = requireEntry(stagingId);
  await fs.appendFile(entry.filePath, chunk, "utf8");
  entry.bytes += Buffer.byteLength(chunk, "utf8");
  return { ok: true, bytes: entry.bytes };
}

export function consumeCardDescriptionStaging(
  stagingId: string,
): CardDescriptionStagingEntry {
  const entry = requireEntry(stagingId);
  stagedDescriptions.delete(stagingId);
  return entry;
}

export async function abortCardDescriptionStaging(stagingId: string): Promise<boolean> {
  const entry = stagedDescriptions.get(stagingId);
  if (!entry) return false;
  stagedDescriptions.delete(stagingId);
  await cleanupCardDescriptionStagingFile(entry.filePath);
  return true;
}

export async function cleanupCardDescriptionStagingFile(filePath: string): Promise<void> {
  try {
    await fs.rm(filePath, { force: true });
  } catch {
    // Staging cleanup is best-effort; it must not turn a successful durable write into a failed ack.
  }
}
