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

export interface RustDataAuthorityRuntime {
  readonly backend: "rust";
  readonly identity: CoreAuthorityIdentity;
  readonly launch: CoreLaunchResult;
  readonly rootClient: DesktopCoreClient;
  clientForProject(projectId: string): DesktopCoreClient;
  close(): Promise<void>;
  retryCoreNow(): Promise<void>;
  subscribeToCoreAuthority(listener: (state: CoreAuthorityState) => void): () => void;
}

export type DesktopDataAuthorityRuntime = RustDataAuthorityRuntime;

export interface InitializeDesktopDataAuthorityInput extends Omit<
  ConnectOrStartCoreInput,
  "nodexHome"
> {
  readonly nodexHome: string;
  readonly supervisorDependencies?: DesktopCoreAuthoritySupervisorDependencies;
}

export async function initializeDesktopDataAuthority(
  input: InitializeDesktopDataAuthorityInput,
): Promise<RustDataAuthorityRuntime> {
  const { supervisorDependencies, ...launcherInput } = input;
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
