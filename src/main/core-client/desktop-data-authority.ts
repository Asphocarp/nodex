import type { CoreLaunchResult } from "./core-launcher";
import type { CoreAuthorityIdentity, DesktopCoreClient } from "./core-generation-client";

export interface RustDataAuthorityRuntime {
  readonly backend: "rust";
  readonly identity: CoreAuthorityIdentity;
  readonly launch: CoreLaunchResult;
  readonly rootClient: DesktopCoreClient;
  clientForProject(projectId: string): DesktopCoreClient;
}
