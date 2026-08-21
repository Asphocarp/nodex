import { describe, expect, test } from "vitest";

import { CoreModuleResponseError } from "./core-client/core-client";
import { cancellableCoreResultFrom, coreResultFrom } from "./core-result-ipc";
import { CoreHttpError, CoreTransportError } from "./core-client/uds-http";

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

  test("returns caller cancellation as control flow instead of a rejected IPC handler", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      cancellableCoreResultFrom(controller.signal, async () => {
        throw new CoreTransportError("aborted", "connect", "ABORT_ERR", null);
      }),
    ).resolves.toEqual({ status: "cancelled" });
  });

  test("treats Core HTTP 499 as the cancellation response", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      cancellableCoreResultFrom(controller.signal, async () => {
        throw new CoreHttpError(499, "Core request was cancelled");
      }),
    ).resolves.toEqual({ status: "cancelled" });
  });

  test("does not hide unrelated failures after a caller abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const failure = new Error("search adapter invariant failed");

    await expect(
      cancellableCoreResultFrom(controller.signal, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });
});
