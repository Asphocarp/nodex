import * as Layer from "effect/Layer";
import * as AppUpdateIpc from "../ipc/handlers/AppUpdateIpc";
import * as ApplicationLifecycleIpc from "../ipc/handlers/ApplicationLifecycleIpc";
import * as ApplicationSyncIpc from "../ipc/handlers/ApplicationSyncIpc";
import * as ApplicationWindowIpc from "../ipc/handlers/ApplicationWindowIpc";
import * as BrowserProfileIpc from "../ipc/handlers/BrowserProfileIpc";
import * as BrowserSidebarIpc from "../ipc/handlers/BrowserSidebarIpc";
import * as ComposerAppshotIpc from "../ipc/handlers/ComposerAppshotIpc";
import * as ComputerUseSettingsIpc from "../ipc/handlers/ComputerUseSettingsIpc";
import * as CoreAuthorityIpc from "../ipc/handlers/CoreAuthorityIpc";
import * as DictationIpc from "../ipc/handlers/DictationIpc";
import * as ExecutionHostIpc from "../ipc/handlers/ExecutionHostIpc";
import * as GitWorkerIpc from "../ipc/handlers/GitWorkerIpc";
import * as RemoteHostedPipIpc from "../ipc/handlers/RemoteHostedPipIpc";
import * as WorkspaceFileIpc from "../ipc/handlers/WorkspaceFileIpc";
import * as AppProtocolRuntime from "../host-runtime/AppProtocolRuntime";
import * as SessionPolicyRuntime from "../host-runtime/SessionPolicyRuntime";

/** Electron callback ingress that translates platform events into typed application capabilities. */
export const live = Layer.mergeAll(
  AppUpdateIpc.live,
  AppProtocolRuntime.live,
  SessionPolicyRuntime.live,
  RemoteHostedPipIpc.live,
  ComputerUseSettingsIpc.live,
  GitWorkerIpc.live,
  DictationIpc.live(),
  ApplicationSyncIpc.live,
  WorkspaceFileIpc.live(),
  ApplicationLifecycleIpc.live,
  ComposerAppshotIpc.live,
  ApplicationWindowIpc.live(),
  BrowserProfileIpc.live,
  BrowserSidebarIpc.live,
  CoreAuthorityIpc.live,
  ExecutionHostIpc.live,
);
