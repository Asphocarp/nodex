import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getLocalStoreDir } from "./config";
import type { PersistedAtomState, PersistedAtomUpdate } from "../../shared/ipc-api";

const PERSISTED_ATOMS_FILE_NAME = "persisted-atoms-v1.json";

let stateCache: PersistedAtomState | null = null;
let persistedAtomsPathOverrideForTests: string | null = null;

function getPersistedAtomsPath(): string {
  if (persistedAtomsPathOverrideForTests) {
    return persistedAtomsPathOverrideForTests;
  }

  return join(getLocalStoreDir(), PERSISTED_ATOMS_FILE_NAME);
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
  mkdirSync(dirname(atomsPath), { recursive: true });
  writeFileSync(atomsPath, JSON.stringify(state, null, 2), "utf8");
}

export function readPersistedAtomState(): PersistedAtomState {
  if (stateCache === null) {
    stateCache = readPersistedAtomsFile();
  }

  return { ...stateCache };
}

export function updatePersistedAtom(update: PersistedAtomUpdate): PersistedAtomState {
  const key = update.key.trim();
  if (!key) return readPersistedAtomState();

  const next = {
    ...readPersistedAtomState(),
    [key]: update.value,
  };
  stateCache = next;
  writePersistedAtomsFile(next);
  return { ...next };
}

export function resetPersistedAtomStateForTests(): void {
  stateCache = null;
}

export function setPersistedAtomsPathOverrideForTests(pathOverride: string | null): void {
  persistedAtomsPathOverrideForTests = pathOverride;
  stateCache = null;
}
