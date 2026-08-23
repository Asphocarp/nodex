import type { ClientRequestResponsesByMethod } from "@nodex/effect-codex-app-server/rpc";
import type { Thread } from "@nodex/codex-app-server-protocol/v2/Thread";

export type CodexGatewayThreadReadThread = ClientRequestResponsesByMethod["thread/read"]["thread"];

/**
 * The Effect client and the transport-neutral protocol package are generated from the same
 * app-server schema. The Effect codec exposes decoded values as readonly and keeps legacy fields
 * optional; the existing canonical reducer still consumes the ts-rs mutable/required-null view.
 * This is the sole type projection between those generated views and performs no data conversion.
 */
export const projectCodexGatewayThreadReadThread = (thread: CodexGatewayThreadReadThread): Thread =>
  thread as unknown as Thread;
