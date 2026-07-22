import { randomUUID } from "node:crypto";

import type { components } from "@nodex/core-protocol";
import type { ProjectionImpact } from "../../shared/projection-stream";
import {
  decodeDocumentApplyHttpAck,
  decodeDocumentSyncHttpResponse,
  encodeDocumentApplyHttpRequest,
  encodeDocumentAwarenessHttpRequest,
  encodeDocumentSyncHttpRequest,
} from "../../shared/block-documents/http-contract";
import {
  MAX_PAGE_DOCUMENT_STATE_BYTES,
} from "../../shared/block-documents/contracts";
import {
  MAX_DOCUMENT_AWARENESS_UPDATE_BYTES,
  type DocumentAwarenessPublishAck,
  type DocumentAwarenessPublishRequest,
  type DocumentSyncApplyAck,
  type DocumentSyncApplyRequest,
  type DocumentSyncRealtimeEvent,
  type DocumentSyncRequest,
  type DocumentSyncResponse,
} from "../../shared/block-documents/document-sync";
import { MAX_DOCUMENT_HTTP_METADATA_BYTES } from "../../shared/block-documents/http-wire";

import { readCoreRuntimeConnection } from "./runtime-descriptor";
import type {
  CoreClientPort,
  CoreEventEnvelope,
  CoreEventReplayRequired,
  CoreEventSubscription,
  CoreHandshakeResponse,
  CoreModuleError,
  AutomationApplyInput,
  AutomationApplyResponse,
  AutomationCommittedValue,
  AutomationRead,
  AutomationReadResponse,
  AutomationReadSnapshot,
  DatabaseApplyInput,
  DatabaseApplyResponse,
  DatabaseCommittedValue,
  DatabaseRead,
  DatabaseReadResponse,
  DatabaseReadSnapshot,
  LibraryApplyInput,
  LibraryApplyResponse,
  LibraryCommittedValue,
  LibraryRead,
  LibraryReadResponse,
  LibraryReadSnapshot,
  DocumentResyncRequired,
  OwnedDocumentApplyInput,
  OwnedDocumentApplyResponse,
  OwnedDocumentCommittedValue,
  OwnedDocumentRead,
  OwnedDocumentReadResponse,
  OwnedDocumentReadSnapshot,
  ProjectWorkspaceRead,
  ProjectWorkspaceApplyInput,
  ProjectWorkspaceApplyResponse,
  ProjectWorkspaceCommittedValue,
  ProjectWorkspaceReadResponse,
  ProjectWorkspaceReadSnapshot,
  StoreAdministrationApplyInput,
  StoreAdministrationApplyResponse,
  StoreAdministrationCommittedValue,
  StoreAdministrationRead,
  StoreAdministrationReadResponse,
  StoreAdministrationReadSnapshot,
} from "./types";
import { UdsHttpTransport } from "./uds-http";

const CORE_PROTOCOL_MIN = 2;
const CORE_PROTOCOL_MAX = 2;
const MODULE_CONTRACT_VERSION = 1;
const DOCUMENT_FRAME_OVERHEAD_BYTES = MAX_DOCUMENT_HTTP_METADATA_BYTES + 8;

type ClientKind = components["schemas"]["ClientKind"];
type HealthResponse = components["schemas"]["HealthResponse"];
type ShutdownResponse = components["schemas"]["ShutdownResponse"];

export interface ConnectCoreClientInput {
  readonly nodexHome: string;
  readonly clientKind: ClientKind;
  readonly buildId: string;
  readonly projectId?: string;
  readonly maximumJsonResponseBytes?: number;
  readonly requestTimeoutMs?: number;
}

export class CoreModuleResponseError extends Error {
  constructor(readonly coreError: CoreModuleError) {
    super(coreError.message);
    this.name = "CoreModuleResponseError";
  }
}

export class CoreClient implements CoreClientPort {
  readonly #transport: UdsHttpTransport;
  readonly #projectId: string | undefined;
  readonly #connectionId: string;
  readonly handshake: CoreHandshakeResponse;

  private constructor(
    transport: UdsHttpTransport,
    handshake: CoreHandshakeResponse,
    projectId: string | undefined,
    connectionId: string,
  ) {
    this.#transport = transport;
    this.handshake = handshake;
    this.#projectId = projectId;
    this.#connectionId = connectionId;
  }

  static async connect(input: ConnectCoreClientInput): Promise<CoreClient> {
    const connectionId = randomUUID();
    const runtime = readCoreRuntimeConnection(input.nodexHome);
    const transport = new UdsHttpTransport(
      runtime.descriptor.socket_path,
      runtime.authCapability,
      {
        maximumJsonResponseBytes: input.maximumJsonResponseBytes,
        requestTimeoutMs: input.requestTimeoutMs,
      },
    );
    const handshake = await transport.requestJson<CoreHandshakeResponse>(
      "POST",
      "/core/v1/handshake",
      {
        protocol_min: CORE_PROTOCOL_MIN,
        protocol_max: CORE_PROTOCOL_MAX,
        client: {
          kind: input.clientKind,
          build_id: input.buildId,
        },
        connection_id: connectionId,
        expected_profile_id: runtime.descriptor.profile_id,
        expected_start_nonce: runtime.descriptor.start_nonce,
      },
    );
    assertHandshake(runtime.descriptor, handshake);
    return new CoreClient(transport, handshake, input.projectId, connectionId);
  }

  forProject(projectId: string): CoreClient {
    const normalized = projectId.trim();
    if (!normalized || normalized !== projectId || normalized.length > 512) {
      throw new Error("Core Project binding is invalid");
    }
    if (normalized === this.#projectId) return this;
    return new CoreClient(
      this.#transport,
      this.handshake,
      normalized,
      this.#connectionId,
    );
  }

  health(): Promise<HealthResponse> {
    return this.#transport.requestJson("GET", "/core/v1/health");
  }

  async libraryRead(read: LibraryRead): Promise<LibraryReadSnapshot> {
    const response = await this.#transport.requestJson<LibraryReadResponse>(
      "POST",
      "/core/v1/modules/library/read",
      { version: MODULE_CONTRACT_VERSION, read },
      this.#moduleHeaders(),
    );
    if (response.status === "ok") return response.payload;
    throw new CoreModuleResponseError(response.payload);
  }

  async libraryApply(input: LibraryApplyInput): Promise<LibraryCommittedValue> {
    const response = await this.#transport.requestJson<LibraryApplyResponse>(
      "POST",
      "/core/v1/modules/library/apply",
      {
        version: MODULE_CONTRACT_VERSION,
        operation_id: input.operationId,
        store_epoch: this.handshake.store_epoch,
        intent: input.intent,
      },
      this.#moduleHeaders(),
    );
    if (response.status === "ok") return response.payload;
    throw new CoreModuleResponseError(response.payload);
  }

  async filterProjectionImpactForProject(
    projectId: string,
    impact: ProjectionImpact,
  ): Promise<ProjectionImpact> {
    const snapshot = await this.forProject(projectId).libraryRead({
      kind: "filter_projection_impact_for_project",
      project_id: projectId,
      impact,
    });
    if (snapshot.value.kind === "projection_impact") {
      return snapshot.value.impact;
    }
    throw new Error("Core returned an invalid Projection impact authorization result");
  }

  async databaseRead(read: DatabaseRead): Promise<DatabaseReadSnapshot> {
    const response = await this.#transport.requestJson<DatabaseReadResponse>(
      "POST",
      "/core/v1/modules/database/read",
      { version: MODULE_CONTRACT_VERSION, read },
      this.#databaseHeaders(),
    );
    if (response.status === "ok") return response.payload;
    throw new CoreModuleResponseError(response.payload);
  }

  async databaseApply(input: DatabaseApplyInput): Promise<DatabaseCommittedValue> {
    const response = await this.#transport.requestJson<DatabaseApplyResponse>(
      "POST",
      "/core/v1/modules/database/apply",
      {
        version: MODULE_CONTRACT_VERSION,
        operation_id: input.operationId,
        store_epoch: this.handshake.store_epoch,
        intent: input.intent,
      },
      this.#databaseHeaders(),
    );
    if (response.status === "ok") return response.payload;
    throw new CoreModuleResponseError(response.payload);
  }

  async workspaceRead(
    read: ProjectWorkspaceRead,
  ): Promise<ProjectWorkspaceReadSnapshot> {
    const response = await this.#transport.requestJson<ProjectWorkspaceReadResponse>(
      "POST",
      "/core/v1/modules/workspace/read",
      { version: MODULE_CONTRACT_VERSION, read },
      this.#moduleHeaders(),
    );
    if (response.status === "ok") return response.payload;
    throw new CoreModuleResponseError(response.payload);
  }

  async workspaceApply(
    input: ProjectWorkspaceApplyInput,
  ): Promise<ProjectWorkspaceCommittedValue> {
    const response = await this.#transport.requestJson<ProjectWorkspaceApplyResponse>(
      "POST",
      "/core/v1/modules/workspace/apply",
      {
        version: MODULE_CONTRACT_VERSION,
        operation_id: input.operationId,
        store_epoch: this.handshake.store_epoch,
        intent: input.intent,
      },
      this.#moduleHeaders(),
    );
    if (response.status === "ok") return response.payload;
    throw new CoreModuleResponseError(response.payload);
  }

  async automationRead(read: AutomationRead): Promise<AutomationReadSnapshot> {
    const response = await this.#transport.requestJson<AutomationReadResponse>(
      "POST",
      "/core/v1/modules/automation/read",
      { version: MODULE_CONTRACT_VERSION, read },
      this.#moduleHeaders(),
    );
    if (response.status === "ok") return response.payload;
    throw new CoreModuleResponseError(response.payload);
  }

  async automationApply(
    input: AutomationApplyInput,
  ): Promise<AutomationCommittedValue> {
    const response = await this.#transport.requestJson<AutomationApplyResponse>(
      "POST",
      "/core/v1/modules/automation/apply",
      {
        version: MODULE_CONTRACT_VERSION,
        operation_id: input.operationId,
        store_epoch: this.handshake.store_epoch,
        intent: input.intent,
      },
      this.#moduleHeaders(),
    );
    if (response.status === "ok") return response.payload;
    throw new CoreModuleResponseError(response.payload);
  }

  async administrationRead(
    read: StoreAdministrationRead,
  ): Promise<StoreAdministrationReadSnapshot> {
    const response =
      await this.#transport.requestJson<StoreAdministrationReadResponse>(
        "POST",
        "/core/v1/modules/administration/read",
        { version: MODULE_CONTRACT_VERSION, read },
        this.#moduleHeaders(),
      );
    if (response.status === "ok") return response.payload;
    throw new CoreModuleResponseError(response.payload);
  }

  async administrationApply(
    input: StoreAdministrationApplyInput,
  ): Promise<StoreAdministrationCommittedValue> {
    const response =
      await this.#transport.requestJson<StoreAdministrationApplyResponse>(
        "POST",
        "/core/v1/modules/administration/apply",
        {
          version: MODULE_CONTRACT_VERSION,
          operation_id: input.operationId,
          store_epoch: this.handshake.store_epoch,
          intent: input.intent,
        },
        this.#moduleHeaders(),
      );
    if (response.status === "ok") return response.payload;
    throw new CoreModuleResponseError(response.payload);
  }

  async documentRead(
    clientSessionId: string,
    read: OwnedDocumentRead,
  ): Promise<OwnedDocumentReadSnapshot> {
    const response = await this.#transport.requestJson<OwnedDocumentReadResponse>(
      "POST",
      "/core/v1/modules/document/read",
      { version: MODULE_CONTRACT_VERSION, read },
      this.#documentHeaders(clientSessionId),
    );
    if (response.status === "ok") return response.payload;
    throw new CoreModuleResponseError(response.payload);
  }

  async documentApply(
    input: OwnedDocumentApplyInput,
  ): Promise<OwnedDocumentCommittedValue> {
    const response = await this.#transport.requestJson<OwnedDocumentApplyResponse>(
      "POST",
      "/core/v1/modules/document/apply",
      {
        version: MODULE_CONTRACT_VERSION,
        operation_id: input.operationId,
        store_epoch: this.handshake.store_epoch,
        intent: input.intent,
      },
      this.#documentHeaders(input.clientSessionId),
    );
    if (response.status === "ok") return response.payload;
    throw new CoreModuleResponseError(response.payload);
  }

  async documentSync(input: DocumentSyncRequest): Promise<DocumentSyncResponse> {
    const response = await this.#transport.requestDocumentFrame<OwnedDocumentReadResponse>(
      "/core/v1/modules/document/read",
      encodeDocumentSyncHttpRequest(input),
      this.#documentHeaders(input.clientSessionId, input.documentId),
      DOCUMENT_FRAME_OVERHEAD_BYTES + MAX_PAGE_DOCUMENT_STATE_BYTES,
    );
    if (response.kind === "binary") {
      return decodeDocumentSyncHttpResponse(response.bytes);
    }
    if (response.value.status === "error") {
      throw new CoreModuleResponseError(response.value.payload);
    }
    throw new Error("Core returned JSON for a successful binary Document sync");
  }

  async documentApplyUpdate(
    input: DocumentSyncApplyRequest,
  ): Promise<DocumentSyncApplyAck> {
    const response = await this.#transport.requestDocumentFrame<OwnedDocumentApplyResponse>(
      "/core/v1/modules/document/apply",
      encodeDocumentApplyHttpRequest(input),
      this.#documentHeaders(input.clientSessionId, input.documentId),
      DOCUMENT_FRAME_OVERHEAD_BYTES + MAX_PAGE_DOCUMENT_STATE_BYTES,
    );
    if (response.kind === "binary") {
      return decodeDocumentApplyHttpAck(response.bytes);
    }
    if (response.value.status === "error") {
      throw new CoreModuleResponseError(response.value.payload);
    }
    throw new Error("Core returned JSON for a successful binary Document update");
  }

  async documentPublishAwareness(
    input: DocumentAwarenessPublishRequest,
  ): Promise<DocumentAwarenessPublishAck> {
    const response = await this.#transport.requestDocumentFrame<
      DocumentAwarenessPublishAck | OwnedDocumentApplyResponse
    >(
      "/core/v1/modules/document/apply",
      encodeDocumentAwarenessHttpRequest(input),
      this.#documentHeaders(input.clientSessionId, input.documentId),
      DOCUMENT_FRAME_OVERHEAD_BYTES + MAX_DOCUMENT_AWARENESS_UPDATE_BYTES,
    );
    if (response.kind === "binary") {
      throw new Error("Core returned a binary Awareness acknowledgement");
    }
    if ("status" in response.value) {
      if (response.value.status === "error") {
        throw new CoreModuleResponseError(response.value.payload);
      }
      throw new Error("Core returned an invalid Awareness response");
    }
    if (response.value.accepted) return response.value;
    throw new Error("Core rejected an invalid Awareness acknowledgement");
  }

  openDocumentEventStream(
    input: {
      readonly documentId: string;
      readonly clientSessionId: string;
      readonly after: number;
    },
    onEvent: (event: CoreEventEnvelope) => void,
    onResyncRequired: (event: DocumentResyncRequired) => void,
    onRealtimeEvent: (event: DocumentSyncRealtimeEvent) => void,
  ): Promise<CoreEventSubscription> {
    return this.#transport.openEventStream(
      input.after,
      onEvent,
      {
        ...this.#documentHeaders(input.clientSessionId),
        "x-nodex-document-id": input.documentId,
      },
      onResyncRequired,
      onRealtimeEvent,
    );
  }

  openEventStream(
    after: number,
    onEvent: (event: CoreEventEnvelope) => void,
    onResyncRequired?: (event: CoreEventReplayRequired) => void,
  ): Promise<CoreEventSubscription> {
    return this.#transport.openEventStream(
      after,
      onEvent,
      this.#moduleHeaders(),
      undefined,
      undefined,
      onResyncRequired,
    );
  }

  shutdown(): Promise<ShutdownResponse> {
    return this.#transport.requestJson(
      "POST",
      "/core/v1/admin/shutdown",
      {},
      this.#moduleHeaders(),
    );
  }

  #documentHeaders(
    clientSessionId: string,
    documentId?: string,
  ): Readonly<Record<string, string>> {
    if (!clientSessionId || clientSessionId.length > 512) {
      throw new Error("Owned Document client session identity is invalid");
    }
    return {
      ...this.#moduleHeaders(),
      ...(!this.#projectId ? { "x-nodex-document-scope": "library" } : {}),
      "x-nodex-client-session-id": clientSessionId,
      ...(documentId ? { "x-nodex-document-id": documentId } : {}),
    };
  }

  #databaseHeaders(): Readonly<Record<string, string>> {
    return {
      ...this.#moduleHeaders(),
      ...(!this.#projectId ? { "x-nodex-database-scope": "library" } : {}),
    };
  }

  #moduleHeaders(requireProject = false): Readonly<Record<string, string>> {
    if (requireProject && !this.#projectId) {
      throw new Error("CoreClient requires a Project binding for this Module access");
    }
    return {
      "x-nodex-connection-id": this.#connectionId,
      "x-nodex-connection-binding": this.handshake.connection_binding,
      ...(this.#projectId ? { "x-nodex-project-id": this.#projectId } : {}),
    };
  }
}

const assertHandshake = (
  descriptor: components["schemas"]["RuntimeDescriptor"],
  handshake: CoreHandshakeResponse,
): void => {
  if (
    handshake.protocol_version < CORE_PROTOCOL_MIN ||
    handshake.protocol_version > CORE_PROTOCOL_MAX
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
