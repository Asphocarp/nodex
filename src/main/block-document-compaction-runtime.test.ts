import { describe, expect, test } from "vitest";
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

    expect(runtime.start()).toBe(true);
    expect(runtime.start()).toBe(false);
    expect(runtime.isRunning()).toBe(true);
    expect(starts).toBe(1);

    runtime.dispose();
    runtime.dispose();
    expect(runtime.isRunning()).toBe(false);
    expect(runtime.start()).toBe(false);
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
    expect(failed).toBe(true);
    expect(runtime.isRunning()).toBe(false);
    expect(runtime.start()).toBe(true);
    expect(starts).toBe(2);
    runtime.dispose();
  });
});
