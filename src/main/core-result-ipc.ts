import type { CoreResult } from "../shared/core-result";
import { CoreModuleResponseError } from "./core-client/core-client";

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
