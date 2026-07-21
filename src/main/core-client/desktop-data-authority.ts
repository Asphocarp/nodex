import { selectDataAuthorityBackend } from "../data-authority";
import { CoreClient } from "./core-client";
import {
  connectOrStartCore,
  type ConnectOrStartCoreInput,
  type CoreLaunchResult,
} from "./core-launcher";

export interface TypeScriptDataAuthorityRuntime {
  readonly backend: "typescript";
}

export interface RustDataAuthorityRuntime {
  readonly backend: "rust";
  readonly launch: CoreLaunchResult;
  readonly rootClient: CoreClient;
  clientForProject(projectId: string): CoreClient;
}

export type DesktopDataAuthorityRuntime =
  | TypeScriptDataAuthorityRuntime
  | RustDataAuthorityRuntime;

export interface InitializeDesktopDataAuthorityInput
  extends Omit<ConnectOrStartCoreInput, "nodexHome"> {
  readonly nodexHome: string;
}

export async function initializeDesktopDataAuthority(
  input: InitializeDesktopDataAuthorityInput,
): Promise<RustDataAuthorityRuntime> {
  const backend = selectDataAuthorityBackend();

  const launch = await connectOrStartCore(input);
  const health = await launch.client.health();
  if (health.status !== "ready") {
    throw new Error(`Native Rust Core reported unexpected status ${health.status}`);
  }

  const clients = new Map<string, CoreClient>();
  return {
    backend,
    launch,
    rootClient: launch.client,
    clientForProject: (projectId) => {
      const existing = clients.get(projectId);
      if (existing) return existing;
      const client = launch.client.forProject(projectId);
      clients.set(projectId, client);
      return client;
    },
  };
}
