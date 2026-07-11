import { describe, expect, test } from "bun:test";
import { createBlockDocumentCompactionRuntime } from "./block-document-compaction-runtime";

describe("Block Document compaction main runtime", () => {
  test("starts exactly once and disposes the owned scheduler exactly once", () => {
    let starts = 0;
    let disposals = 0;
    const runtime = createBlockDocumentCompactionRuntime(() => {
      starts += 1;
      return {
        dispose: () => {
          disposals += 1;
        },
      };
    });

    expect(runtime.start()).toBeTrue();
    expect(runtime.start()).toBeFalse();
    expect(runtime.isRunning()).toBeTrue();
    expect(starts).toBe(1);

    runtime.dispose();
    runtime.dispose();
    expect(runtime.isRunning()).toBeFalse();
    expect(runtime.start()).toBeFalse();
    expect(disposals).toBe(1);
  });

  test("remains startable when scheduler construction fails", () => {
    let starts = 0;
    const runtime = createBlockDocumentCompactionRuntime(() => {
      starts += 1;
      if (starts === 1) throw new Error("startup fault");
      return { dispose: () => undefined };
    });

    let failed = false;
    try {
      runtime.start();
    } catch {
      failed = true;
    }
    expect(failed).toBeTrue();
    expect(runtime.isRunning()).toBeFalse();
    expect(runtime.start()).toBeTrue();
    expect(starts).toBe(2);
    runtime.dispose();
  });
});
