import { parseDatabaseId } from "../../shared/database-identities";
import type { ContentAccessContext } from "../../shared/content-access-context";
import {
  LIBRARY_NAVIGATION_EVENT_VERSION,
  type LibraryNavigationChangedEvent,
} from "../../shared/library-events";
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
import type {
  PageSearchFacets,
  PageSearchInput,
  PageSearchMetadataSnapshot,
  PageSearchSnapshot,
} from "../../shared/types";
import type { PageLifecyclePreflightResultV2 } from "../../shared/page-lifecycle-v2-runtime";
import type {
  PageLifecycleMutationCommandResultV2,
  PageLifecycleMutationRequestV2,
} from "../../shared/page-lifecycle-v2";
import type {
  PageTargetReadModel,
  ResolvePageTargetInput,
} from "../../shared/page-targets";
import type {
  PageOwnershipPathReadModel,
  ResolvePageOwnershipPathInput,
} from "../../shared/page-ownership-paths";
import type {
  CoreAuthorizedDeliveryAtom,
  CoreEventEnvelope,
} from "./types";
import type {
  BlockPropertyMutationCommandResultV2,
  BlockPropertyMutationRequestV2,
  LibraryBlockPropertyMutationCommandResultV2,
  LibraryBlockPropertyMutationRequestV2,
} from "../../shared/block-property-mutations-v2";
import type { DesktopDataAuthorityRuntime } from "./desktop-data-authority";
import {
  createCoreLibraryModuleAdapter,
  type CoreLibraryModuleAdapter,
} from "./library-module-adapter";

export interface DesktopLibraryModuleBridgeInput {
  readonly authority: Promise<DesktopDataAuthorityRuntime>;
}

export interface DesktopLibraryModuleBridge {
  read(
    accessContext: ContentAccessContext,
    request: LibraryModuleReadRequest,
  ): Promise<LibraryModuleReadResult>;
  apply(
    accessContext: ContentAccessContext,
    request: LibraryModuleApplyRequest,
  ): Promise<LibraryModuleApplyResult>;
  readProjectPageDetail(
    projectId: string,
    pageId: string,
    minimumCommitSeq?: number,
  ): Promise<PageDetailResult>;
  readLibraryPageDetail(
    pageId: string,
    accessActor?: "app_window" | "http_loopback",
    minimumCommitSeq?: number,
  ): Promise<LibraryPageDetailResult>;
  listPageHistory(
    request: ListPageHistoryRequest,
  ): Promise<PageHistoryCommandResult>;
  searchPages(input: PageSearchInput, signal?: AbortSignal): Promise<PageSearchSnapshot>;
  pageSearchMetadata(projectIds: string[], pageIds?: string[]): Promise<PageSearchMetadataSnapshot>;
  pageSearchFacets(projectIds: string[]): Promise<PageSearchFacets>;
  resolvePageTarget(
    input: ResolvePageTargetInput,
  ): Promise<PageTargetReadModel | null>;
  resolvePageOwnershipPath(
    input: ResolvePageOwnershipPathInput,
  ): Promise<PageOwnershipPathReadModel | null>;
  findPageLocation(
    pageId: string,
  ): Promise<{ readonly pageId: string; readonly projectId: string } | null>;
  findViewLocation(
    viewId: string,
  ): Promise<{
    readonly viewId: string;
    readonly dataSourceId: string;
    readonly databaseId: string;
    readonly projectId: string;
  } | null>;
  readPageLifecyclePreflight(
    projectId: string,
    pageId: string,
  ): Promise<PageLifecyclePreflightResultV2>;
  applyPageLifecycleMutation(
    request: PageLifecycleMutationRequestV2,
  ): Promise<PageLifecycleMutationCommandResultV2>;
  applyBlockPropertyMutation(
    request: BlockPropertyMutationRequestV2,
  ): Promise<BlockPropertyMutationCommandResultV2>;
  applyLibraryBlockPropertyMutation(input: {
    readonly request: LibraryBlockPropertyMutationRequestV2;
    readonly actor: BlockPropertyMutationRequestV2["actor"];
    readonly accessActor?: "app_window" | "http_loopback";
  }): Promise<LibraryBlockPropertyMutationCommandResultV2>;
}

export function createDesktopLibraryModuleBridge(
  input: DesktopLibraryModuleBridgeInput,
): DesktopLibraryModuleBridge {
  let rootCoreAdapter: CoreLibraryModuleAdapter | null = null;
  const projectCoreAdapters = new Map<string, CoreLibraryModuleAdapter>();
  const coreAdapter = (
    runtime: DesktopDataAuthorityRuntime,
    projectId?: string,
  ): CoreLibraryModuleAdapter => createCoreLibraryModuleAdapter({
    client: projectId
      ? runtime.clientForProject(projectId)
      : runtime.rootClient,
    libraryId: runtime.identity.libraryId,
    profileId: runtime.identity.profileId,
    storeEpoch: runtime.identity.storeEpoch,
  });
  const projectCoreAdapter = (
    runtime: DesktopDataAuthorityRuntime,
    projectId: string,
  ): CoreLibraryModuleAdapter => {
    let adapter = projectCoreAdapters.get(projectId);
    if (adapter) return adapter;
    adapter = coreAdapter(runtime, projectId);
    projectCoreAdapters.set(projectId, adapter);
    return adapter;
  };
  const rootAdapter = (
    runtime: DesktopDataAuthorityRuntime,
  ): CoreLibraryModuleAdapter => {
    rootCoreAdapter ??= coreAdapter(runtime);
    return rootCoreAdapter;
  };
  const adapterForAccess = (
    runtime: DesktopDataAuthorityRuntime,
    accessContext: ContentAccessContext,
  ): CoreLibraryModuleAdapter => {
    if (accessContext.kind === "library") return rootAdapter(runtime);
    return projectCoreAdapter(runtime, accessContext.projectId);
  };
  return {
    read: async (accessContext, request) => {
      const runtime = await input.authority;
      return await adapterForAccess(runtime, accessContext).read(request);
    },
    apply: async (accessContext, request) => {
      const runtime = await input.authority;
      const result = await adapterForAccess(runtime, accessContext)
        .apply(request);
      return result;
    },
    readProjectPageDetail: async (projectId, pageId, minimumCommitSeq) => {
      const runtime = await input.authority;
      return await projectCoreAdapter(runtime, projectId)
        .readProjectPageDetail(projectId, pageId, minimumCommitSeq);
    },
    readLibraryPageDetail: async (pageId, accessActor, minimumCommitSeq) => {
      const runtime = await input.authority;
      void accessActor;
      return await rootAdapter(runtime).readLibraryPageDetail(
        pageId,
        minimumCommitSeq,
      );
    },
    listPageHistory: async (request) => {
      const runtime = await input.authority;
      return await projectCoreAdapter(runtime, request.requestingProjectId)
        .listPageHistory(request);
    },
    searchPages: async (searchInput, signal) => {
      const runtime = await input.authority;
      return await rootAdapter(runtime).searchPages(searchInput, signal);
    },
    pageSearchMetadata: async (projectIds, pageIds) => {
      const runtime = await input.authority;
      return await rootAdapter(runtime).pageSearchMetadata(projectIds, pageIds);
    },
    pageSearchFacets: async (projectIds) => {
      const runtime = await input.authority;
      return await rootAdapter(runtime).pageSearchFacets(projectIds);
    },
    resolvePageTarget: async (request) => {
      const runtime = await input.authority;
      return await adapterForAccess(runtime, request.accessContext)
        .resolvePageTarget(request);
    },
    resolvePageOwnershipPath: async (request) => {
      const runtime = await input.authority;
      return await adapterForAccess(runtime, request.accessContext)
        .resolvePageOwnershipPath(request);
    },
    findPageLocation: async (pageId) => {
      const runtime = await input.authority;
      return await rootAdapter(runtime).findPageLocation(pageId);
    },
    findViewLocation: async (viewId) => {
      const runtime = await input.authority;
      return await rootAdapter(runtime).findViewLocation(viewId);
    },
    readPageLifecyclePreflight: async (projectId, pageId) => {
      const runtime = await input.authority;
      return await projectCoreAdapter(runtime, projectId)
        .readPageLifecyclePreflight(projectId, pageId);
    },
    applyPageLifecycleMutation: async (request) => {
      const runtime = await input.authority;
      return await projectCoreAdapter(runtime, request.projectId)
        .applyPageLifecycleMutation(request);
    },
    applyBlockPropertyMutation: async (request) => {
      const runtime = await input.authority;
      return await projectCoreAdapter(runtime, request.projectId)
        .applyBlockPropertyMutation(request);
    },
    applyLibraryBlockPropertyMutation: async (request) => {
      const runtime = await input.authority;
      rootCoreAdapter ??= coreAdapter(runtime);
      return await rootCoreAdapter.applyLibraryBlockPropertyMutation(request);
    },
  };
}

export function mapCoreLibraryEvent(
  envelope: CoreEventEnvelope,
  effect: CoreAuthorizedDeliveryAtom,
  libraryId: string,
): LibraryNavigationChangedEvent | null {
  const payload = effect.payload;
  if (payload.module !== "library") return null;
  return {
    version: LIBRARY_NAVIGATION_EVENT_VERSION,
    libraryId,
    storeEpoch: envelope.packet.manifest.identity.store_epoch,
    commitSeq: envelope.packet.manifest.identity.commit_seq,
    changeKind: "content",
    affectedParentKeys: payload.event.parent_keys,
    affectedPageIds: payload.event.page_ids,
    affectedDatabaseIds: payload.event.database_ids.map(parseDatabaseId),
    affectedViewIds: [],
  };
}
