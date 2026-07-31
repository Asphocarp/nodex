import { parseDatabaseId } from "../../shared/database-identities";
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
import type { PageSearchInput, PageSearchResult } from "../../shared/types";
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
import type { CoreEventEnvelope } from "./types";
import type {
  BlockPropertyMutationCommandResultV2,
  BlockPropertyMutationRequestV2,
  LibraryBlockPropertyMutationCommandResultV2,
  LibraryBlockPropertyMutationRequestV2,
} from "../../shared/block-property-mutations-v2";
import type { RelocationDocumentCommit } from "../../shared/block-documents/contracts";
import type { DesktopDataAuthorityRuntime } from "./desktop-data-authority";
import {
  createCoreLibraryModuleAdapter,
  type CoreLibraryModuleAdapter,
} from "./library-module-adapter";

export interface DesktopLibraryModuleBridgeInput {
  readonly authority: Promise<DesktopDataAuthorityRuntime>;
  readonly resolveProjectId: (event: unknown) => string | null;
  readonly publishDocumentCommits?: (input: {
    readonly scope:
      | { readonly kind: "project"; readonly projectId: string }
      | { readonly kind: "library" };
    readonly storeEpoch: string;
    readonly commits: readonly RelocationDocumentCommit[];
    readonly clientSessionId: string;
  }) => void;
}

export interface DesktopLibraryModuleBridge {
  read(request: LibraryModuleReadRequest): Promise<LibraryModuleReadResult>;
  apply(
    request: LibraryModuleApplyRequest,
    event: unknown,
  ): Promise<LibraryModuleApplyResult>;
  applyTrustedLibrary(
    request: LibraryModuleApplyRequest,
  ): Promise<LibraryModuleApplyResult>;
  readProjectPageDetail(
    projectId: string,
    pageId: string,
  ): Promise<PageDetailResult>;
  readLibraryPageDetail(
    pageId: string,
    accessActor?: "app_window" | "http_loopback",
  ): Promise<LibraryPageDetailResult>;
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
    libraryId: runtime.rootClient.handshake.library_id,
    profileId: runtime.rootClient.handshake.generation.profile_id,
    storeEpoch: runtime.rootClient.handshake.store_epoch,
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
  const publishCanvasDocumentCommits = (
    result: LibraryModuleApplyResult,
    scopes: readonly (
      | { readonly kind: "project"; readonly projectId: string }
      | { readonly kind: "library" }
    )[],
  ): void => {
    if (!result.ok) return;
    const commits = result.value.canvasMutation?.documentCommits ?? [];
    if (commits.length === 0) return;
    for (const scope of scopes) {
      input.publishDocumentCommits?.({
        scope,
        storeEpoch: result.value.storeEpoch,
        commits,
        clientSessionId: "rust:library",
      });
    }
  };

  return {
    read: async (request) => {
      const runtime = await input.authority;
      rootCoreAdapter ??= coreAdapter(runtime);
      return await rootCoreAdapter.read(request);
    },
    apply: async (request, event) => {
      const runtime = await input.authority;
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
      const result = await projectCoreAdapter(runtime, projectId).apply(request);
      publishCanvasDocumentCommits(result, [
        { kind: "project", projectId },
        { kind: "library" },
      ]);
      return result;
    },
    applyTrustedLibrary: async (request) => {
      const runtime = await input.authority;
      rootCoreAdapter ??= coreAdapter(runtime);
      const result = await rootCoreAdapter.apply(request);
      publishCanvasDocumentCommits(result, [{ kind: "library" }]);
      return result;
    },
    readProjectPageDetail: async (projectId, pageId) => {
      const runtime = await input.authority;
      return await projectCoreAdapter(runtime, projectId)
        .readProjectPageDetail(projectId, pageId);
    },
    readLibraryPageDetail: async (pageId) => {
      const runtime = await input.authority;
      rootCoreAdapter ??= coreAdapter(runtime);
      return await rootCoreAdapter.readLibraryPageDetail(pageId);
    },
    listPageHistory: async (request) => {
      const runtime = await input.authority;
      return await projectCoreAdapter(runtime, request.requestingProjectId)
        .listPageHistory(request);
    },
    searchPages: async (searchInput) => {
      const runtime = await input.authority;
      rootCoreAdapter ??= coreAdapter(runtime);
      return await rootCoreAdapter.searchPages(searchInput);
    },
    resolvePageTarget: async (request) => {
      const runtime = await input.authority;
      return await projectCoreAdapter(runtime, request.requestingProjectId)
        .resolvePageTarget(request);
    },
    resolvePageOwnershipPath: async (request) => {
      const runtime = await input.authority;
      return await projectCoreAdapter(runtime, request.requestingProjectId)
        .resolvePageOwnershipPath(request);
    },
    findPageLocation: async (pageId) => {
      const runtime = await input.authority;
      rootCoreAdapter ??= coreAdapter(runtime);
      return await rootCoreAdapter.findPageLocation(pageId);
    },
    findViewLocation: async (viewId) => {
      const runtime = await input.authority;
      rootCoreAdapter ??= coreAdapter(runtime);
      return await rootCoreAdapter.findViewLocation(viewId);
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
  libraryId: string,
): LibraryNavigationChangedEvent | null {
  const payload = envelope.event.payload;
  if (payload.module !== "library") return null;
  return {
    version: LIBRARY_NAVIGATION_EVENT_VERSION,
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
