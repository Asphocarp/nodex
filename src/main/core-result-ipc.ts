import type { CoreResult } from "../shared/core-result";
import { CoreModuleResponseError } from "./core-client/core-client";
import { CoreTransportError } from "./core-client/uds-http";

export type CancellableCoreResult<T> =
  | { readonly status: "completed"; readonly value: T }
  | { readonly status: "cancelled" };

/**
 * Converts a Core call into the IPC-safe result envelope. Non-Core failures
 * remain exceptional so programming and host errors still reach diagnostics.
 */
export async function coreResultFrom<T>(
  operation: () => Promise<T>,
): Promise<CoreResult<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    if (!(error instanceof CoreModuleResponseError)) throw error;
    return {
      ok: false,
      error: {
        code: error.coreError.code,
        message: error.coreError.message,
        retryable: error.coreError.retryable,
        recovery: error.coreError.recovery,
      },
    };
  }
}

/**
 * Turns caller-requested Core cancellation into an IPC value. Electron treats
 * rejected invoke handlers as errors, while query supersession is routine
 * control flow and should remain quiet in Main diagnostics.
 */
export async function cancellableCoreResultFrom<T>(
  signal: AbortSignal,
  operation: () => Promise<T>,
): Promise<CancellableCoreResult<T>> {
  try {
    const value = await operation();
    if (signal.aborted) return { status: "cancelled" };
    return { status: "completed", value };
  } catch (error) {
    if (signal.aborted && isCoreCancellation(error)) {
      return { status: "cancelled" };
    }
    throw error;
  }
}

function isCoreCancellation(error: unknown): boolean {
  if (error instanceof CoreTransportError) return error.kind === "aborted";
  if (error instanceof CoreModuleResponseError) {
    return error.coreError.code === "cancelled";
  }
  if (error instanceof Error && error.name === "AbortError") return true;
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "ABORT_ERR";
}
