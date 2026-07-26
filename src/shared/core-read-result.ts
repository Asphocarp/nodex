/**
 * Transport envelope for Core-backed read channels. Electron IPC and the
 * browser HTTP transport both flatten thrown errors into plain strings, so
 * typed Core error codes must ride inside the successful response payload.
 * Main wraps handler results with `registerCoreReadHandle`; the renderer
 * unwraps them through `invokeCoreRead`, which rethrows a typed
 * `CoreApiError`. Consumers never branch on message text.
 */
export interface CoreReadError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export type CoreReadResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: CoreReadError };

/** Core error codes whose cursors/read state should be silently rebuilt. */
const CURSOR_REJECTION_CODES = new Set([
  "revision_conflict",
  "stale_store_epoch",
]);

/**
 * True when a windowed read failed because its continuation cursor is no
 * longer honored (epoch rotation, query-shape change, payload version). The
 * consumer contract is to drop the cursor and converge from the first window
 * without surfacing an error. `invalid_input` counts only in cursor-bearing
 * requests, which is the caller's context to assert.
 */
export const isCursorRejectionCode = (
  code: string,
  options: { readonly requestHadCursor: boolean },
): boolean =>
  CURSOR_REJECTION_CODES.has(code)
  || (options.requestHadCursor && code === "invalid_input");
