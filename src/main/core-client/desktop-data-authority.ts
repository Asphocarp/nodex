import { randomUUID } from "node:crypto";

import {
  connectOrStartCore,
  type ConnectOrStartCoreInput,
  type CoreLaunchResult,
} from "./core-launcher";
import {
  DesktopCoreAuthoritySupervisor,
  type CoreAuthorityIdentity,
  type CoreAuthorityState,
  type DesktopCoreAuthoritySupervisorDependencies,
  type DesktopCoreClient,
} from "./desktop-core-authority-supervisor";
import type { CoreLocalCommitEnvelope } from "./types";

export interface RustDataAuthorityRuntime {
  readonly backend: "rust";
  readonly identity: CoreAuthorityIdentity;
  readonly launch: CoreLaunchResult;
  readonly rootClient: DesktopCoreClient;
  clientForProject(projectId: string): DesktopCoreClient;
  close(): void;
  retryCoreNow(): Promise<void>;
  subscribeToCoreAuthority(
    listener: (state: CoreAuthorityState) => void,
  ): () => void;
}

export type DesktopDataAuthorityRuntime = RustDataAuthorityRuntime;

export interface InitializeDesktopDataAuthorityInput
  extends Omit<ConnectOrStartCoreInput, "nodexHome"> {
  readonly nodexHome: string;
  readonly supervisorDependencies?: DesktopCoreAuthoritySupervisorDependencies;
  readonly onLocalCommit?: (commit: CoreLocalCommitEnvelope) => void;
}

export async function initializeDesktopDataAuthority(
  input: InitializeDesktopDataAuthorityInput,
): Promise<RustDataAuthorityRuntime> {
  const { supervisorDependencies, onLocalCommit, ...launcherInput } = input;
  const launchInput = {
    ...launcherInput,
    connectionId: launcherInput.connectionId ?? randomUUID(),
  };
  const launch = await connectOrStartCore(launchInput);
  const health = await launch.client.health();
  if (health.status !== "ready") {
    throw new Error(`Native Rust Core reported unexpected status ${health.status}`);
  }

  const supervisor = new DesktopCoreAuthoritySupervisor({
    initialLaunch: launch,
    launchInput,
    dependencies: {
      ...supervisorDependencies,
      ...(onLocalCommit ? { onLocalCommit } : {}),
    },
  });
  return {
    backend: "rust",
    identity: supervisor.identity,
    launch,
    rootClient: supervisor.rootClient,
    clientForProject: (projectId) => supervisor.clientForProject(projectId),
    close: () => supervisor.close(),
    retryCoreNow: () => supervisor.retryNow(),
    subscribeToCoreAuthority: (listener) => supervisor.subscribe(listener),
  };
}
