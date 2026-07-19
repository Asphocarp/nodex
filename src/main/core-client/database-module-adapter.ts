import type {
  DatabaseModuleErrorV2,
  DatabaseModuleReadRequestV2,
  DatabaseModuleReadResultV2,
  DatabaseReadV2,
} from "../../shared/database-module-v2";
import {
  parseDatabaseModuleReadResultV2,
} from "../../shared/database-module-v2-transport";
import { CoreModuleResponseError } from "./core-client";
import type {
  CoreClientPort,
  CoreModuleError,
  DatabaseRead,
} from "./types";

export interface CoreDatabaseModuleAdapterInput {
  readonly client: CoreClientPort;
  readonly projectId: string;
  readonly libraryId: string;
  readonly storeEpoch: string;
}

export interface CoreDatabaseModuleAdapter {
  read(
    request: DatabaseModuleReadRequestV2,
  ): Promise<DatabaseModuleReadResultV2>;
}

const toCoreTarget = (target: DatabaseReadV2["target"]): DatabaseRead["target"] => {
  if (target.kind === "project_default") return target;
  if (target.kind === "database") {
    return { kind: target.kind, database_id: target.databaseId };
  }
  if (target.kind === "data_source") {
    return { kind: target.kind, data_source_id: target.dataSourceId };
  }
  return { kind: target.kind, view_id: target.viewId };
};

const toCoreRead = (read: DatabaseReadV2): DatabaseRead => ({
  target: toCoreTarget(read.target),
  mode: read.mode,
  filter: "filter" in read ? read.filter : undefined,
  sort: "sort" in read ? read.sort ?? null : null,
});

const mapCoreError = (error: CoreModuleError): DatabaseModuleErrorV2 => {
  const code = (() => {
    switch (error.code) {
      case "invalid_input":
        return "invalid_request";
      case "not_found":
        return "resource_not_found";
      case "unauthorized":
        return "authorization_denied";
      case "revision_conflict":
      case "generation_conflict":
      case "head_conflict":
        return "revision_conflict";
      case "idempotency_key_reused":
        return "operation_id_collision";
      case "ambiguous":
        return "identity_conflict";
      case "stale_store_epoch":
        return "store_not_initialized";
      case "store_corrupt":
      case "invalid_document_schema":
        return "state_corrupt";
      case "schema_unsupported":
        return "unsupported_operation";
      default:
        return "unknown";
    }
  })() satisfies DatabaseModuleErrorV2["code"];
  return {
    code,
    message: error.message,
    retryable: error.retryable,
  };
};

const failure = (error: unknown): DatabaseModuleReadResultV2 => {
  if (error instanceof CoreModuleResponseError) {
    return { ok: false, error: mapCoreError(error.coreError) };
  }
  return {
    ok: false,
    error: {
      code: "unknown",
      message: error instanceof Error ? error.message : String(error),
      retryable: true,
    },
  };
};

export const createCoreDatabaseModuleAdapter = (
  input: CoreDatabaseModuleAdapterInput,
): CoreDatabaseModuleAdapter => ({
  read: async (request) => {
    if (request.projectId !== input.projectId) {
      return {
        ok: false,
        error: {
          code: "authorization_denied",
          message: "Database read escaped its bound Project",
          retryable: false,
        },
      };
    }
    try {
      const snapshot = await input.client.databaseRead(toCoreRead(request.read));
      if (snapshot.store_epoch !== input.storeEpoch) {
        throw new Error("Core Database read crossed its Store epoch boundary");
      }
      return parseDatabaseModuleReadResultV2({
        ok: true,
        value: {
          version: request.version,
          projectId: input.projectId,
          libraryId: input.libraryId,
          storeEpoch: snapshot.store_epoch,
          changeLogSeq: snapshot.event_head,
          value: snapshot.value,
        },
      });
    } catch (error) {
      return failure(error);
    }
  },
});
