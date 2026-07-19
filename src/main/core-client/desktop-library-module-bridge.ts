import { parseDatabaseId } from "../../shared/database-identities";
import type { LibraryNavigationChangedEvent } from "../../shared/library-events";
import type {
  LibraryModuleApplyRequest,
  LibraryModuleApplyResult,
  LibraryModuleReadRequest,
  LibraryModuleReadResult,
} from "../../shared/library-module";
import type { CoreEventEnvelope } from "./types";
import type { DesktopDataAuthorityRuntime } from "./desktop-data-authority";
import {
  createCoreLibraryModuleAdapter,
  type CoreLibraryModuleAdapter,
} from "./library-module-adapter";

export interface DesktopLibraryModuleBridgeInput {
  readonly authority: Promise<DesktopDataAuthorityRuntime>;
  readonly resolveProjectId: (event: unknown) => string | null;
  readonly typescript: {
    read(request: LibraryModuleReadRequest): Promise<LibraryModuleReadResult>;
    apply(request: LibraryModuleApplyRequest): Promise<LibraryModuleApplyResult>;
  };
}

export interface DesktopLibraryModuleBridge {
  read(request: LibraryModuleReadRequest): Promise<LibraryModuleReadResult>;
  apply(
    request: LibraryModuleApplyRequest,
    event: unknown,
  ): Promise<LibraryModuleApplyResult>;
}

export function createDesktopLibraryModuleBridge(
  input: DesktopLibraryModuleBridgeInput,
): DesktopLibraryModuleBridge {
  let rootCoreAdapter: CoreLibraryModuleAdapter | null = null;
  const projectCoreAdapters = new Map<string, CoreLibraryModuleAdapter>();
  const coreAdapter = (
    runtime: Extract<DesktopDataAuthorityRuntime, { backend: "rust" }>,
    projectId?: string,
  ): CoreLibraryModuleAdapter => createCoreLibraryModuleAdapter({
    client: projectId
      ? runtime.clientForProject(projectId)
      : runtime.rootClient,
    libraryId: runtime.rootClient.handshake.library_id,
    profileId: runtime.rootClient.handshake.profile_id,
    storeEpoch: runtime.rootClient.handshake.store_epoch,
  });

  return {
    read: async (request) => {
      const runtime = await input.authority;
      if (runtime.backend === "typescript") {
        return await input.typescript.read(request);
      }
      rootCoreAdapter ??= coreAdapter(runtime);
      return await rootCoreAdapter.read(request);
    },
    apply: async (request, event) => {
      const runtime = await input.authority;
      if (runtime.backend === "typescript") {
        return await input.typescript.apply(request);
      }
      const projectId = input.resolveProjectId(event);
      if (!projectId) {
        return {
          ok: false,
          error: {
            code: "invalid_request",
            message: "Library writes require an active Project window",
            retryable: false,
          },
        };
      }
      let adapter = projectCoreAdapters.get(projectId);
      if (!adapter) {
        adapter = coreAdapter(runtime, projectId);
        projectCoreAdapters.set(projectId, adapter);
      }
      return await adapter.apply(request);
    },
  };
}

export function mapCoreLibraryEvent(
  envelope: CoreEventEnvelope,
  libraryId: string,
): LibraryNavigationChangedEvent | null {
  const payload = envelope.event.payload;
  if (payload.module !== "library") return null;
  return {
    version: 1,
    libraryId,
    storeEpoch: envelope.event.store_epoch,
    changeLogSeq: envelope.event.sequence,
    changeKind: "content",
    affectedParentKeys: payload.event.parent_keys,
    affectedPageIds: payload.event.page_ids,
    affectedDatabaseIds: payload.event.database_ids.map(parseDatabaseId),
    affectedViewIds: [],
  };
}
