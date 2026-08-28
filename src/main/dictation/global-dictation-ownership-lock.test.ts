import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireGlobalDictationOwnership } from "./global-dictation-ownership-lock";

const roots: string[] = [];

const createLockPath = (): string => {
  const root = join(tmpdir(), `nodex-global-dictation-lock-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  roots.push(root);
  return join(root, "owner.lock");
};

afterEach(() => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("global dictation ownership", () => {
  it("allows only one machine owner until the lease is released", () => {
    const lockPath = createLockPath();
    const first = acquireGlobalDictationOwnership({ lockPath, onLost: vi.fn() });
    expect(first).not.toBeNull();
    expect(acquireGlobalDictationOwnership({ lockPath, onLost: vi.fn() })).toBeNull();

    first?.dispose();
    const next = acquireGlobalDictationOwnership({ lockPath, onLost: vi.fn() });
    expect(next?.isOwner()).toBe(true);
    next?.dispose();
  });

  it("reports ownership that is removed by another instance", () => {
    vi.useFakeTimers();
    const lockPath = createLockPath();
    const onLost = vi.fn();
    const lease = acquireGlobalDictationOwnership({ lockPath, onLost });
    expect(lease).not.toBeNull();

    rmSync(lockPath, { force: true, recursive: true });
    vi.advanceTimersByTime(1_000);

    expect(onLost).toHaveBeenCalledOnce();
    lease?.dispose();
  });
});
