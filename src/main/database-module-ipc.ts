import type {
  DatabaseApply,
  DatabaseApplyResult,
  DatabaseModuleReadRequest,
  DatabaseModuleReadResult,
} from "../shared/database-module";
import {
  bindDatabaseApply,
  bindDatabaseModuleRead,
  databaseModuleFailure,
  type TrustedDatabaseModuleIdentity,
} from "../shared/database-module-transport";

export const DATABASE_MODULE_READ_IPC_CHANNEL =
  "database-module:read" as const;
export const DATABASE_MODULE_APPLY_IPC_CHANNEL =
  "database-module:apply" as const;

export interface DatabaseModuleIpcDependencies {
  readonly registerHandle: (
    channel:
      | typeof DATABASE_MODULE_READ_IPC_CHANNEL
      | typeof DATABASE_MODULE_APPLY_IPC_CHANNEL,
    listener: (
      event: unknown,
      projectId: string,
      request: unknown,
    ) => Promise<unknown>,
  ) => void;
  readonly resolveTrustedIdentity: (
    event: unknown,
  ) => TrustedDatabaseModuleIdentity | null;
  readonly apply: (request: DatabaseApply) => Promise<DatabaseApplyResult>;
  readonly read: (
    request: DatabaseModuleReadRequest,
  ) => Promise<DatabaseModuleReadResult>;
}

const failure = (
  code: "invalid_request" | "unknown",
  message: string,
  operationId?: string,
): DatabaseApplyResult | DatabaseModuleReadResult => ({
  ok: false,
  error: databaseModuleFailure(code, message, operationId),
});

export const registerDatabaseModuleIpcHandlers = (
  dependencies: DatabaseModuleIpcDependencies,
): void => {
  dependencies.registerHandle(
    DATABASE_MODULE_READ_IPC_CHANNEL,
    async (event, projectId, rawRequest) => {
      if (!dependencies.resolveTrustedIdentity(event)) {
        return failure(
          "invalid_request",
          "Database Module reads are restricted to a trusted application window",
        );
      }
      let request: DatabaseModuleReadRequest;
      try {
        request = bindDatabaseModuleRead(rawRequest, projectId);
      } catch (error) {
        return failure(
          "invalid_request",
          error instanceof Error ? error.message : "Database Module read is invalid",
        );
      }
      try {
        return await dependencies.read(request);
      } catch (error) {
        return failure(
          "unknown",
          error instanceof Error
            ? error.message
            : "The durable Database Module reader is unavailable",
        );
      }
    },
  );

  dependencies.registerHandle(
    DATABASE_MODULE_APPLY_IPC_CHANNEL,
    async (event, projectId, rawRequest) => {
      const identity = dependencies.resolveTrustedIdentity(event);
      if (!identity) {
        return failure(
          "invalid_request",
          "Database Module writes are restricted to a trusted application window",
        );
      }
      let request: DatabaseApply;
      try {
        request = bindDatabaseApply(rawRequest, projectId, identity);
      } catch (error) {
        return failure(
          "invalid_request",
          error instanceof Error ? error.message : "Database Module apply is invalid",
        );
      }
      try {
        return await dependencies.apply(request);
      } catch (error) {
        return failure(
          "unknown",
          error instanceof Error
            ? error.message
            : "The durable Database Module writer is unavailable",
          request.operationId,
        );
      }
    },
  );
};
