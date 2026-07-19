import type {
  LibraryModuleApplyRequest,
  LibraryModuleApplyResult,
  LibraryModuleReadRequest,
  LibraryModuleReadResult,
} from "../shared/library-module";
import {
  bindLibraryModuleApply,
  bindLibraryModuleRead,
  libraryModuleFailure,
} from "../shared/library-module-transport";

export const LIBRARY_MODULE_READ_IPC_CHANNEL = "library-module:read" as const;
export const LIBRARY_MODULE_APPLY_IPC_CHANNEL = "library-module:apply" as const;

type LibraryModuleIpcChannel =
  | typeof LIBRARY_MODULE_READ_IPC_CHANNEL
  | typeof LIBRARY_MODULE_APPLY_IPC_CHANNEL;

export interface LibraryModuleIpcDependencies {
  readonly registerHandle: (
    channel: LibraryModuleIpcChannel,
    listener: (event: unknown, request: unknown) => Promise<unknown>,
  ) => void;
  readonly isTrustedEvent: (event: unknown) => boolean;
  readonly read: (
    request: LibraryModuleReadRequest,
  ) => Promise<LibraryModuleReadResult>;
  readonly apply: (
    request: LibraryModuleApplyRequest,
    event: unknown,
  ) => Promise<LibraryModuleApplyResult>;
}

const failure = (message: string): LibraryModuleReadResult => ({
  ok: false,
  error: libraryModuleFailure("invalid_request", message),
});

const applyFailure = (message: string): LibraryModuleApplyResult => ({
  ok: false,
  error: libraryModuleFailure("invalid_request", message),
});

export const registerLibraryModuleIpcHandler = (
  dependencies: LibraryModuleIpcDependencies,
): void => {
  dependencies.registerHandle(
    LIBRARY_MODULE_READ_IPC_CHANNEL,
    async (event, rawRequest) => {
      if (!dependencies.isTrustedEvent(event)) {
        return failure(
          "Library reads are restricted to a trusted application window",
        );
      }
      let request: LibraryModuleReadRequest;
      try {
        request = bindLibraryModuleRead(rawRequest);
      } catch (error) {
        return failure(
          error instanceof Error ? error.message : "Library read is invalid",
        );
      }
      try {
        return await dependencies.read(request);
      } catch (error) {
        return {
          ok: false,
          error: libraryModuleFailure(
            "unknown",
            error instanceof Error
              ? error.message
              : "The durable Library reader is unavailable",
            true,
          ),
        };
      }
    },
  );
  dependencies.registerHandle(
    LIBRARY_MODULE_APPLY_IPC_CHANNEL,
    async (event, rawRequest) => {
      if (!dependencies.isTrustedEvent(event)) {
        return applyFailure(
          "Library writes are restricted to a trusted application window",
        );
      }
      let request: LibraryModuleApplyRequest;
      try {
        request = bindLibraryModuleApply(rawRequest);
      } catch (error) {
        return applyFailure(
          error instanceof Error ? error.message : "Library write is invalid",
        );
      }
      try {
        return await dependencies.apply(request, event);
      } catch (error) {
        return {
          ok: false,
          error: libraryModuleFailure(
            "unknown",
            error instanceof Error
              ? error.message
              : "The durable Library writer is unavailable",
            true,
          ),
        };
      }
    },
  );
};
