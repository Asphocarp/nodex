import { describe, expect, test } from "vitest";

import { CoreModuleResponseError } from "./core-client/core-client";
import { coreResultFrom } from "./core-result-ipc";

describe("Core IPC result envelope", () => {
  test("preserves an ordinary conflict without relabeling it as stale state", async () => {
    const result = await coreResultFrom(async () => {
      throw new CoreModuleResponseError({
        code: "conflict",
        message: "Page-key prefix LAB is already reserved in this Library",
        retryable: false,
        recovery: { kind: "none" },
      });
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "conflict",
        message: "Page-key prefix LAB is already reserved in this Library",
        retryable: false,
        recovery: { kind: "none" },
      },
    });
  });
});
