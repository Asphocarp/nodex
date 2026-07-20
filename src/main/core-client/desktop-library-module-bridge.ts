import { parseDatabaseId } from "../../shared/database-identities";
import type { LibraryNavigationChangedEvent } from "../../shared/library-events";
import type {
  LibraryModuleApplyRequest,
  LibraryModuleApplyResult,
  LibraryModuleReadRequest,
  LibraryModuleReadResult,
} from "../../shared/library-module";
import type {
  LibraryPageDetailResult,
  PageDetailResult,
} from "../../shared/page-detail";
import type { ListPageHistoryRequest } from "../../shared/page-history";
import type { PageHistoryCommandResult } from "../../shared/page-history-transport";
import type { PageSearchInput, PageSearchResult } from "../../shared/types";
import type { PageLifecyclePreflightResultV2 } from "../../shared/page-lifecycle-v2-runtime";
import type {
  PageTargetReadModel,
  ResolvePageTargetInput,
} from "../../shared/page-targets";
import type {
  PageOwnershipPathReadModel,
  ResolvePageOwnershipPathInput,
} from "../../shared/page-ownership-paths";
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
    readProjectPageDetail(
      projectId: string,
      pageId: string,
    ): Promise<PageDetailResult>;
    readLibraryPageDetail(pageId: string): Promise<LibraryPageDetailResult>;
    listPageHistory(
      request: ListPageHistoryRequest,
    ): Promise<PageHistoryCommandResult>;
    searchPages(input: PageSearchInput): Promise<PageSearchResult[]>;
    resolvePageTarget(
      input: ResolvePageTargetInput,
    ): Promise<PageTargetReadModel | null>;
    resolvePageOwnershipPath(
      input: ResolvePageOwnershipPathInput,
    ): Promise<PageOwnershipPathReadModel | null>;
    findPageLocation(
      pageId: string,
    ): Promise<{ readonly pageId: string; readonly projectId: string } | null>;
    readPageLifecyclePreflight(
      projectId: string,
      pageId: string,
    ): Promise<PageLifecyclePreflightResultV2>;
  };
}

export interface DesktopLibraryModuleBridge {
  read(request: LibraryModuleReadRequest): Promise<LibraryModuleReadResult>;
  apply(
    request: LibraryModuleApplyRequest,
    event: unknown,
  ): Promise<LibraryModuleApplyResult>;
  readProjectPageDetail(
    projectId: string,
    pageId: string,
  ): Promise<PageDetailResult>;
  readLibraryPageDetail(pageId: string): Promise<LibraryPageDetailResult>;
  listPageHistory(
    request: ListPageHistoryRequest,
  ): Promise<PageHistoryCommandResult>;
  searchPages(input: PageSearchInput): Promise<PageSearchResult[]>;
  resolvePageTarget(
    input: ResolvePageTargetInput,
  ): Promise<PageTargetReadModel | null>;
  resolvePageOwnershipPath(
    input: ResolvePageOwnershipPathInput,
  ): Promise<PageOwnershipPathReadModel | null>;
  findPageLocation(
    pageId: string,
  ): Promise<{ readonly pageId: string; readonly projectId: string } | null>;
  readPageLifecyclePreflight(
    projectId: string,
    pageId: string,
  ): Promise<PageLifecyclePreflightResultV2>;
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
  const projectCoreAdapter = (
    runtime: Extract<DesktopDataAuthorityRuntime, { backend: "rust" }>,
    projectId: string,
  ): CoreLibraryModuleAdapter => {
    let adapter = projectCoreAdapters.get(projectId);
    if (adapter) return adapter;
    adapter = coreAdapter(runtime, projectId);
    projectCoreAdapters.set(projectId, adapter);
    return adapter;
  };

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
      return await projectCoreAdapter(runtime, projectId).apply(request);
    },
    readProjectPageDetail: async (projectId, pageId) => {
      const runtime = await input.authority;
      if (runtime.backend === "typescript") {
        return await input.typescript.readProjectPageDetail(projectId, pageId);
      }
      return await projectCoreAdapter(runtime, projectId)
        .readProjectPageDetail(projectId, pageId);
    },
    readLibraryPageDetail: async (pageId) => {
      const runtime = await input.authority;
      if (runtime.backend === "typescript") {
        return await input.typescript.readLibraryPageDetail(pageId);
      }
      rootCoreAdapter ??= coreAdapter(runtime);
      return await rootCoreAdapter.readLibraryPageDetail(pageId);
    },
    listPageHistory: async (request) => {
      const runtime = await input.authority;
      if (runtime.backend === "typescript") {
        return await input.typescript.listPageHistory(request);
      }
      return await projectCoreAdapter(runtime, request.requestingProjectId)
        .listPageHistory(request);
    },
    searchPages: async (searchInput) => {
      const runtime = await input.authority;
      if (runtime.backend === "typescript") {
        return await input.typescript.searchPages(searchInput);
      }
      rootCoreAdapter ??= coreAdapter(runtime);
      return await rootCoreAdapter.searchPages(searchInput);
    },
    resolvePageTarget: async (request) => {
      const runtime = await input.authority;
      if (runtime.backend === "typescript") {
        return await input.typescript.resolvePageTarget(request);
      }
      return await projectCoreAdapter(runtime, request.requestingProjectId)
        .resolvePageTarget(request);
    },
    resolvePageOwnershipPath: async (request) => {
      const runtime = await input.authority;
      if (runtime.backend === "typescript") {
        return await input.typescript.resolvePageOwnershipPath(request);
      }
      return await projectCoreAdapter(runtime, request.requestingProjectId)
        .resolvePageOwnershipPath(request);
    },
    findPageLocation: async (pageId) => {
      const runtime = await input.authority;
      if (runtime.backend === "typescript") {
        return await input.typescript.findPageLocation(pageId);
      }
      rootCoreAdapter ??= coreAdapter(runtime);
      return await rootCoreAdapter.findPageLocation(pageId);
    },
    readPageLifecyclePreflight: async (projectId, pageId) => {
      const runtime = await input.authority;
      if (runtime.backend === "typescript") {
        return await input.typescript.readPageLifecyclePreflight(
          projectId,
          pageId,
        );
      }
      return await projectCoreAdapter(runtime, projectId)
        .readPageLifecyclePreflight(projectId, pageId);
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
