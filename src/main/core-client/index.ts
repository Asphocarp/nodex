export { CoreClient, CoreModuleResponseError } from "./core-client";
export { createCoreDocumentSyncAdapter } from "./document-sync-adapter";
export { readCoreRuntimeConnection } from "./runtime-descriptor";
export { connectOrStartCore, resolveCoreExecutable } from "./core-launcher";
export { initializeDesktopDataAuthority } from "./desktop-data-authority";
export type {
  ConnectCoreClientInput,
} from "./core-client";
export type {
  ConnectOrStartCoreInput,
  CoreLaunchResult,
  ResolveCoreExecutableInput,
} from "./core-launcher";
export type {
  DesktopDataAuthorityRuntime,
  InitializeDesktopDataAuthorityInput,
  RustDataAuthorityRuntime,
  TypeScriptDataAuthorityRuntime,
} from "./desktop-data-authority";
export type * from "./types";
