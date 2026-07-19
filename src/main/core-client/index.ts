export { CoreClient, CoreModuleResponseError } from "./core-client";
export {
  createCoreDocumentSyncAdapter,
  type CoreDocumentSyncAdapter,
} from "./document-sync-adapter";
export {
  createCoreCanvasSceneAdapter,
  type CoreCanvasSceneAdapter,
} from "./core-canvas-scene-adapter";
export {
  createDesktopDocumentSyncBridge,
  type DesktopDocumentSyncPort,
} from "./desktop-document-sync-bridge";
export { readCoreRuntimeConnection } from "./runtime-descriptor";
export { connectOrStartCore, resolveCoreExecutable } from "./core-launcher";
export { initializeDesktopDataAuthority } from "./desktop-data-authority";
export { createCoreLibraryModuleAdapter } from "./library-module-adapter";
export {
  createDesktopLibraryModuleBridge,
  mapCoreLibraryEvent,
} from "./desktop-library-module-bridge";
export {
  createDesktopAutomationModuleBridge,
  mapCoreAutomationEvent,
  type AutomationArchiveMessages,
  type CoreAutomationInvalidation,
  type DesktopAutomationClaim,
  type DesktopAutomationDefinitionDeleteResult,
  type DesktopAutomationModuleBridgeInput,
  type DesktopAutomationModulePort,
} from "./desktop-automation-module-bridge";
export {
  createDesktopStoreAdministrationBridge,
  mapCoreStoreAdministrationEvent,
  type CoreStoreAdministrationInvalidation,
  type DesktopStoreAdministrationBridgeInput,
  type DesktopStoreAdministrationPort,
  type DesktopStoreMaintenanceTask,
} from "./desktop-store-administration-bridge";
export {
  createDesktopDatabaseModuleBridge,
  mapCoreDatabaseEvent,
  mapCoreLibraryDatabaseEvent,
  type DesktopDatabaseModuleBridge,
} from "./desktop-database-module-bridge";
export {
  createCoreDatabaseModuleAdapter,
  createCoreLibraryDatabaseModuleAdapter,
  type CoreDatabaseModuleAdapter,
  type CoreLibraryDatabaseModuleAdapter,
} from "./database-module-adapter";
export {
  createDesktopProjectWorkspaceBridge,
  mapCoreProjectWorkspaceEvent,
} from "./desktop-project-workspace-bridge";
export {
  createCoreProjectWorkspaceAdapter,
  type DesktopProjectWorkspacePort,
} from "./project-workspace-adapter";
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
export type {
  CoreLibraryModuleAdapter,
  CoreLibraryModuleAdapterInput,
} from "./library-module-adapter";
export type {
  DesktopLibraryModuleBridge,
  DesktopLibraryModuleBridgeInput,
} from "./desktop-library-module-bridge";
export type * from "./types";
