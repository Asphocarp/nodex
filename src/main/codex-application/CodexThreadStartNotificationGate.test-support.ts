import * as Stream from "effect/Stream";
import { CodexThreadStartNotificationGate } from "./CodexThreadStartNotificationGate";

/** Test adapter for modules whose focused behavior is unrelated to protocol start ordering. */
export const transparentThreadStartNotificationGate = CodexThreadStartNotificationGate.of({
  materialize: (_hostId, operation) => operation,
  defer: () => false,
  releases: Stream.empty,
  clear: () => undefined,
});
