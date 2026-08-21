import type {
  DatabaseApplyResultV2,
  DatabaseApplyV2,
  DatabaseModuleReadRequestV2,
  DatabaseModuleReadResultV2,
} from "../shared/database-module-v2";
import {
  bindDatabaseApplyV2,
  bindDatabaseModuleReadV2,
  databaseModuleFailureV2,
  type TrustedDatabaseModuleIdentityV2,
} from "../shared/database-module-v2-transport";

export const DATABASE_MODULE_READ_IPC_CHANNEL = "database-module:read" as const;
export const DATABASE_MODULE_APPLY_IPC_CHANNEL = "database-module:apply" as const;

export interface DatabaseModuleIpcDependencies {
  readonly registerHandle: (
    channel: typeof DATABASE_MODULE_READ_IPC_CHANNEL | typeof DATABASE_MODULE_APPLY_IPC_CHANNEL,
    listener: (event: unknown, projectId: string, request: unknown) => Promise<unknown>,
  ) => void;
  readonly resolveTrustedIdentity: (event: unknown) => TrustedDatabaseModuleIdentityV2 | null;
  readonly apply: (request: DatabaseApplyV2) => Promise<DatabaseApplyResultV2>;
  readonly read: (request: DatabaseModuleReadRequestV2) => Promise<DatabaseModuleReadResultV2>;
}

const failure = (
  code: "invalid_request" | "unknown",
  message: string,
  operationId?: string,
): DatabaseApplyResultV2 | DatabaseModuleReadResultV2 => ({
  ok: false,
  error: databaseModuleFailureV2(code, message, operationId),
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
      let request: DatabaseModuleReadRequestV2;
      try {
        request = bindDatabaseModuleReadV2(rawRequest, projectId);
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
      let request: DatabaseApplyV2;
      try {
        request = bindDatabaseApplyV2(rawRequest, projectId, identity);
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
