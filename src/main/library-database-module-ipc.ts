import type {
  LibraryDatabaseModuleReadResultV2,
  LibraryDatabaseModuleReadRequestV2,
  LibraryDatabaseApplyV2,
  LibraryDatabaseApplyResultV2,
} from "../shared/database-module-v2";
import {
  bindLibraryDatabaseApplyV2,
  bindLibraryDatabaseModuleReadV2,
} from "../shared/database-module-v2-transport";

export const LIBRARY_DATABASE_MODULE_READ_IPC_CHANNEL =
  "library-database-module:read" as const;
export const LIBRARY_DATABASE_MODULE_APPLY_IPC_CHANNEL =
  "library-database-module:apply" as const;
type LibraryDatabaseModuleIpcChannel =
  | typeof LIBRARY_DATABASE_MODULE_READ_IPC_CHANNEL
  | typeof LIBRARY_DATABASE_MODULE_APPLY_IPC_CHANNEL;

export interface LibraryDatabaseModuleIpcDependencies {
  readonly registerHandle: (
    channel: LibraryDatabaseModuleIpcChannel,
    listener: (event: unknown, request: unknown) => Promise<unknown>,
  ) => void;
  readonly isTrustedEvent: (event: unknown) => boolean;
  readonly read: (
    request: LibraryDatabaseModuleReadRequestV2,
  ) => Promise<LibraryDatabaseModuleReadResultV2>;
  readonly apply: (
    request: LibraryDatabaseApplyV2,
  ) => Promise<LibraryDatabaseApplyResultV2>;
}

const invalid = (message: string): LibraryDatabaseModuleReadResultV2 => ({
  ok: false,
  error: { code: "invalid_request", message, retryable: false },
});

export const registerLibraryDatabaseModuleIpcHandler = (
  dependencies: LibraryDatabaseModuleIpcDependencies,
): void => {
  dependencies.registerHandle(
    LIBRARY_DATABASE_MODULE_READ_IPC_CHANNEL,
    async (event, rawRequest) => {
      if (!dependencies.isTrustedEvent(event)) {
        return invalid(
          "Library Database reads are restricted to a trusted application window",
        );
      }
      try {
        return await dependencies.read(bindLibraryDatabaseModuleReadV2(rawRequest));
      } catch (error) {
        return invalid(error instanceof Error ? error.message : "Library Database read is invalid");
      }
    },
  );
  dependencies.registerHandle(
    LIBRARY_DATABASE_MODULE_APPLY_IPC_CHANNEL,
    async (event, rawRequest) => {
      if (!dependencies.isTrustedEvent(event)) {
        return invalid(
          "Library Database writes are restricted to a trusted application window",
        );
      }
      try {
        return await dependencies.apply(bindLibraryDatabaseApplyV2(rawRequest));
      } catch (error) {
        return invalid(error instanceof Error ? error.message : "Library Database write is invalid");
      }
    },
  );
};
