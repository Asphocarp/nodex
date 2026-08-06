export { CoreClient, CoreModuleResponseError } from "./core-client";
export {
  createCoreBlockTransferAdapter,
  type CoreBlockTransferAdapter,
  type CoreBlockTransferAdapterInput,
} from "./block-transfer-adapter";
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
export {
  LocalCommitDispatcher,
  LocalCommitProtocolError,
  type LocalCommitAdmission,
  type LocalCommitListener,
  type LocalCommitSource,
} from "./local-commit-dispatcher";
export { blockRecordCommitToLocalCommit } from "./block-record-local-commit";
export { connectOrStartCore, resolveCoreExecutable } from "./core-launcher";
export { initializeDesktopDataAuthority } from "./desktop-data-authority";
export {
  createDesktopBlockRecordModuleBridge,
  type DesktopBlockRecordModuleBridge,
  type DesktopBlockRecordModuleBridgeInput,
} from "./desktop-block-record-module-bridge";
export {
  CoreAuthorityUnavailableError,
  DesktopCoreAuthoritySupervisor,
} from "./desktop-core-authority-supervisor";
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
} from "./desktop-data-authority";
export type {
  CoreAuthorityIdentity,
  CoreAuthorityState,
  CoreGenerationClient,
  CoreGenerationLaunch,
  CreateDesktopCoreAuthoritySupervisorInput,
  DesktopCoreAuthoritySupervisorDependencies,
  DesktopCoreClient,
} from "./desktop-core-authority-supervisor";
export type {
  CoreLibraryModuleAdapter,
  CoreLibraryModuleAdapterInput,
} from "./library-module-adapter";
export type {
  DesktopLibraryModuleBridge,
  DesktopLibraryModuleBridgeInput,
} from "./desktop-library-module-bridge";
export type * from "./types";
