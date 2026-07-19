import type {
  DatabaseModuleReadRequestV2,
  DatabaseModuleReadResultV2,
} from "../../shared/database-module-v2";
import type { DesktopDataAuthorityRuntime } from "./desktop-data-authority";
import {
  createCoreDatabaseModuleAdapter,
  type CoreDatabaseModuleAdapter,
} from "./database-module-adapter";

export interface DesktopDatabaseModuleBridgeInput {
  readonly authority: Promise<DesktopDataAuthorityRuntime>;
  readonly typescript: {
    read(
      request: DatabaseModuleReadRequestV2,
    ): Promise<DatabaseModuleReadResultV2>;
  };
}

export interface DesktopDatabaseModuleBridge {
  read(
    request: DatabaseModuleReadRequestV2,
  ): Promise<DatabaseModuleReadResultV2>;
}

export const createDesktopDatabaseModuleBridge = (
  input: DesktopDatabaseModuleBridgeInput,
): DesktopDatabaseModuleBridge => {
  const coreAdapters = new Map<string, CoreDatabaseModuleAdapter>();
  return {
    read: async (request) => {
      const runtime = await input.authority;
      if (runtime.backend === "typescript") {
        return await input.typescript.read(request);
      }
      let adapter = coreAdapters.get(request.projectId);
      if (!adapter) {
        adapter = createCoreDatabaseModuleAdapter({
          client: runtime.clientForProject(request.projectId),
          projectId: request.projectId,
          libraryId: runtime.rootClient.handshake.library_id,
          storeEpoch: runtime.rootClient.handshake.store_epoch,
        });
        coreAdapters.set(request.projectId, adapter);
      }
      return await adapter.read(request);
    },
  };
};
