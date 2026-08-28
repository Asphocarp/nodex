import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const OWNER_FILE_NAME = "owner.json";
const CLAIM_SUFFIX = ".claim";
const OWNER_POLL_INTERVAL_MS = 1_000;
const INCOMPLETE_OWNER_GRACE_MS = 5_000;

interface OwnershipRecord {
  readonly pid: number;
  readonly token: string;
}

export interface GlobalDictationOwnershipLease {
  readonly dispose: () => void;
  readonly isOwner: () => boolean;
}

const errorCode = (error: unknown): string | null =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as NodeJS.ErrnoException).code)
    : null;

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) !== "ESRCH";
  }
};

const readOwner = (lockPath: string): OwnershipRecord | null => {
  try {
    const value = JSON.parse(readFileSync(join(lockPath, OWNER_FILE_NAME), "utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const { pid, token } = value as Record<string, unknown>;
    if (!Number.isInteger(pid) || Number(pid) <= 0 || typeof token !== "string" || !token) {
      return null;
    }
    return { pid: Number(pid), token };
  } catch {
    return null;
  }
};

const hasFreshIncompleteOwner = (lockPath: string): boolean => {
  try {
    return Date.now() - statSync(lockPath).mtimeMs < INCOMPLETE_OWNER_GRACE_MS;
  } catch {
    return false;
  }
};

const ownerIsStale = (lockPath: string, owner: OwnershipRecord | null): boolean =>
  owner === null ? !hasFreshIncompleteOwner(lockPath) : !isProcessAlive(owner.pid);

const createOwnership = (lockPath: string, owner: OwnershipRecord): boolean => {
  try {
    mkdirSync(lockPath, { mode: 0o700, recursive: false });
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false;
    throw error;
  }
  try {
    writeFileSync(join(lockPath, OWNER_FILE_NAME), `${JSON.stringify(owner, null, 2)}\n`, {
      mode: 0o600,
    });
    return true;
  } catch (error) {
    rmSync(lockPath, { force: true, recursive: true });
    throw error;
  }
};

const sameOwner = (left: OwnershipRecord | null, right: OwnershipRecord | null): boolean =>
  left?.token === right?.token;

const acquireOwnership = (lockPath: string, owner: OwnershipRecord): boolean => {
  if (createOwnership(lockPath, owner)) return true;
  const observedOwner = readOwner(lockPath);
  if (!ownerIsStale(lockPath, observedOwner)) return false;

  const claimPath = `${lockPath}${CLAIM_SUFFIX}`;
  try {
    mkdirSync(claimPath, { mode: 0o700, recursive: false });
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false;
    throw error;
  }
  try {
    const currentOwner = readOwner(lockPath);
    if (!sameOwner(observedOwner, currentOwner) || !ownerIsStale(lockPath, currentOwner)) {
      return false;
    }
    rmSync(lockPath, { force: true, recursive: true });
    return createOwnership(lockPath, owner);
  } finally {
    rmSync(claimPath, { force: true, recursive: true });
  }
};

export const resolveGlobalDictationOwnershipLockPath = (): string =>
  join(tmpdir(), "nodex-global-dictation-window.lock");

/** Acquires one machine-wide owner across production, development, and disposable Profiles. */
export function acquireGlobalDictationOwnership(options: {
  readonly lockPath?: string;
  readonly onLost: () => void;
}): GlobalDictationOwnershipLease | null {
  const lockPath = options.lockPath ?? resolveGlobalDictationOwnershipLockPath();
  const owner = { pid: process.pid, token: randomUUID() } satisfies OwnershipRecord;
  mkdirSync(dirname(lockPath), { mode: 0o700, recursive: true });
  if (!acquireOwnership(lockPath, owner)) return null;

  const isOwner = (): boolean => readOwner(lockPath)?.token === owner.token;
  const timer = setInterval(() => {
    if (isOwner()) return;
    clearInterval(timer);
    options.onLost();
  }, OWNER_POLL_INTERVAL_MS);
  timer.unref?.();

  return {
    isOwner,
    dispose: () => {
      clearInterval(timer);
      if (isOwner()) rmSync(lockPath, { force: true, recursive: true });
    },
  };
}
