import { randomUUID } from "node:crypto";
import type { ConnectOrStartCoreInput } from "./core-launcher";
import { connectOrStartCore } from "./core-launcher";
import type { CoreGenerationClient } from "./core-generation-client";
import type { RustDataAuthorityRuntime } from "./desktop-data-authority";

/** One-generation authority for isolated scenario and integration process roots. */
export async function initializeStandaloneDataAuthority(
  input: ConnectOrStartCoreInput,
): Promise<RustDataAuthorityRuntime> {
  const launch = await connectOrStartCore({
    ...input,
    connectionId: input.connectionId ?? randomUUID(),
  });
  const client: CoreGenerationClient = launch.client;
  const health = await client.health();
  if (health.status !== "ready") {
    throw new Error(`Native Rust Core reported unexpected status ${health.status}`);
  }
  return {
    backend: "rust",
    identity: {
      libraryId: client.handshake.library_id,
      profileId: client.handshake.generation.profile_id,
      storeEpoch: client.handshake.store_epoch,
    },
    launch,
    rootClient: client,
    clientForProject: (projectId) => client.forProject(projectId),
  };
}
