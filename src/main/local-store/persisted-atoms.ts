import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { getNodexHome } from "./config";
import type {
  PersistedAtomEvent,
  PersistedAtomMutation,
  PersistedAtomSnapshot,
  PersistedAtomState,
  PersistedAtomUpdate,
} from "../../shared/ipc-api";

const PERSISTED_ATOMS_FILE_NAME = "persisted-atoms-v1.json";

let stateCache: PersistedAtomState | null = null;
let revision = 0;
let persistedAtomsPathOverrideForTests: string | null = null;

function getPersistedAtomsPath(): string {
  if (persistedAtomsPathOverrideForTests) {
    return persistedAtomsPathOverrideForTests;
  }

  return join(getNodexHome(), PERSISTED_ATOMS_FILE_NAME);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPersistedAtomsFile(): PersistedAtomState {
  const atomsPath = getPersistedAtomsPath();
  if (!existsSync(atomsPath)) return {};

  try {
    const parsed = JSON.parse(readFileSync(atomsPath, "utf8")) as unknown;
    return isRecord(parsed) ? { ...parsed } : {};
  } catch {
    return {};
  }
}

function writePersistedAtomsFile(state: PersistedAtomState): void {
  const atomsPath = getPersistedAtomsPath();
  const parent = dirname(atomsPath);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const temporaryPath = join(
    parent,
    `.${basename(atomsPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const handle = openSync(temporaryPath, "wx", 0o600);
  try {
    writeFileSync(handle, JSON.stringify(state, null, 2), "utf8");
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  try {
    renameSync(temporaryPath, atomsPath);
    const directory = openSync(parent, "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

export function readPersistedAtomState(): PersistedAtomState {
  if (stateCache === null) {
    stateCache = readPersistedAtomsFile();
  }

  return { ...stateCache };
}

export function readPersistedAtomSnapshot(): PersistedAtomSnapshot {
  return {
    revision,
    values: readPersistedAtomState(),
  };
}

export function commitPersistedAtomMutation(
  mutation: PersistedAtomMutation,
  originRendererId: string | null,
): PersistedAtomEvent {
  const key = mutation.key.trim();
  const mutationId = mutation.mutationId.trim();
  if (!key) throw new Error("Persisted atom mutation key must not be empty");
  if (!mutationId) throw new Error("Persisted atom mutation id must not be empty");

  const next = {
    ...readPersistedAtomState(),
    [key]: mutation.value,
  };
  writePersistedAtomsFile(next);
  stateCache = next;
  revision += 1;
  return {
    key,
    value: mutation.value,
    mutationId,
    revision,
    originRendererId,
  };
}

export function updatePersistedAtom(update: PersistedAtomUpdate): PersistedAtomState {
  const key = update.key.trim();
  if (!key) return readPersistedAtomState();
  commitPersistedAtomMutation({
    key,
    value: update.value,
    mutationId: `main:${crypto.randomUUID()}`,
  }, null);
  return readPersistedAtomState();
}

export function resetPersistedAtomStateForTests(): void {
  stateCache = null;
  revision = 0;
}

export function setPersistedAtomsPathOverrideForTests(pathOverride: string | null): void {
  persistedAtomsPathOverrideForTests = pathOverride;
  stateCache = null;
  revision = 0;
}
