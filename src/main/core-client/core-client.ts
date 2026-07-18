import type { components } from "@nodex/core-protocol";

import { readCoreRuntimeConnection } from "./runtime-descriptor";
import type {
  CoreClientPort,
  CoreEventEnvelope,
  CoreEventSubscription,
  CoreHandshakeResponse,
  CoreModuleError,
  LibraryApplyInput,
  LibraryApplyResponse,
  LibraryCommittedValue,
  LibraryRead,
  LibraryReadResponse,
  LibraryReadSnapshot,
} from "./types";
import { UdsHttpTransport } from "./uds-http";

const PROTOCOL_MIN = 1;
const PROTOCOL_MAX = 1;

type ClientKind = components["schemas"]["ClientKind"];
type HealthResponse = components["schemas"]["HealthResponse"];
type ShutdownResponse = components["schemas"]["ShutdownResponse"];

export interface ConnectCoreClientInput {
  readonly nodexHome: string;
  readonly clientKind: ClientKind;
  readonly buildId: string;
}

export class CoreModuleResponseError extends Error {
  constructor(readonly coreError: CoreModuleError) {
    super(coreError.message);
    this.name = "CoreModuleResponseError";
  }
}

export class CoreClient implements CoreClientPort {
  readonly #transport: UdsHttpTransport;
  readonly handshake: CoreHandshakeResponse;

  private constructor(
    transport: UdsHttpTransport,
    handshake: CoreHandshakeResponse,
  ) {
    this.#transport = transport;
    this.handshake = handshake;
  }

  static async connect(input: ConnectCoreClientInput): Promise<CoreClient> {
    const runtime = readCoreRuntimeConnection(input.nodexHome);
    const transport = new UdsHttpTransport(
      runtime.descriptor.socket_path,
      runtime.authCapability,
    );
    const handshake = await transport.requestJson<CoreHandshakeResponse>(
      "POST",
      "/core/v1/handshake",
      {
        protocol_min: PROTOCOL_MIN,
        protocol_max: PROTOCOL_MAX,
        client: {
          kind: input.clientKind,
          build_id: input.buildId,
        },
        expected_profile_id: runtime.descriptor.profile_id,
        expected_start_nonce: runtime.descriptor.start_nonce,
      },
    );
    assertHandshake(runtime.descriptor, handshake);
    return new CoreClient(transport, handshake);
  }

  health(): Promise<HealthResponse> {
    return this.#transport.requestJson("GET", "/core/v1/health");
  }

  async libraryRead(read: LibraryRead): Promise<LibraryReadSnapshot> {
    const response = await this.#transport.requestJson<LibraryReadResponse>(
      "POST",
      "/core/v1/modules/library/read",
      { version: PROTOCOL_MAX, read },
    );
    if (response.status === "ok") return response.payload;
    throw new CoreModuleResponseError(response.payload);
  }

  async libraryApply(input: LibraryApplyInput): Promise<LibraryCommittedValue> {
    const response = await this.#transport.requestJson<LibraryApplyResponse>(
      "POST",
      "/core/v1/modules/library/apply",
      {
        version: PROTOCOL_MAX,
        operation_id: input.operationId,
        store_epoch: this.handshake.store_epoch,
        intent: input.intent,
      },
    );
    if (response.status === "ok") return response.payload;
    throw new CoreModuleResponseError(response.payload);
  }

  openEventStream(
    after: number,
    onEvent: (event: CoreEventEnvelope) => void,
  ): Promise<CoreEventSubscription> {
    return this.#transport.openEventStream(after, onEvent);
  }

  shutdown(): Promise<ShutdownResponse> {
    return this.#transport.requestJson("POST", "/core/v1/admin/shutdown", {});
  }
}

const assertHandshake = (
  descriptor: components["schemas"]["RuntimeDescriptor"],
  handshake: CoreHandshakeResponse,
): void => {
  if (
    handshake.protocol_version < PROTOCOL_MIN ||
    handshake.protocol_version > PROTOCOL_MAX
  ) {
    throw new Error("Core selected an unsupported protocol version");
  }
  if (
    handshake.pid !== descriptor.pid ||
    handshake.start_nonce !== descriptor.start_nonce ||
    handshake.profile_id !== descriptor.profile_id ||
    handshake.store_epoch !== descriptor.store_epoch
  ) {
    throw new Error("Core handshake does not match the validated runtime descriptor");
  }
};
