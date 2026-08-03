import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  type ComponentPropsWithoutRef,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from "react";
import { OwnedBlockDocumentBoundary } from "@/components/block-documents/owned-block-document-boundary";
import { PageStageContentSkeleton } from "@/components/kanban/page-stage/content-skeleton";
import { PageStageToolbar } from "@/components/kanban/page-stage/toolbar";
import type { PageStageSessionSnapshot } from "@/components/kanban/page-stage/types";
import { NodexButton } from "@/components/ui/button";
import { useCodexAppServerControl } from "@/features/local-conversation";
import { usePageOwnershipPathReadModel } from "@/lib/block-reference-queries";
import { commitPageDetailMetadataPatch } from "@/lib/page-detail-metadata-runtime";
import { makePageEditorSessionKey } from "@/lib/page-editor-session-registry";
import {
  projectPageDetailToStageModel,
  type PageStageDatabaseProperties,
} from "@/lib/page-stage-page";
import { readPageStageContentWidthPreference } from "@/lib/page-stage-layout";
import {
  makePageStageTabTitleKey,
  type PageStageTabTitleStore,
} from "@/lib/page-stage-tab-title-store";
import { fetchPageDetail, usePageDetail } from "@/lib/page-detail-store";
import { RIGHT_PANEL_COMPOSER_OVERLAY_SCROLL_RESERVE_STYLE } from "@/lib/right-panel-composer-overlay-reserve";
import { projectContentAccess } from "../../../shared/content-access-context";
import type {
  CodexPromptInput,
  CodexThreadSummary,
  DatabasePage,
  PageInput,
  Project,
  WorkbenchTabProjection,
} from "@/lib/types";
import { useKanban } from "@/lib/use-kanban";
import { cn } from "@/lib/utils";
import type { WorkbenchSessionRenderProjection } from "@/lib/workbench-session-presentation";
import { projectWorkspaceRootOrNull } from "@/lib/workbench-workspace-context";
import type { OpenCanvasStageHandler } from "@/lib/use-workbench-panel-openers";
import type { WorkbenchProjectionPageStageTabConfig } from "../../../shared/types";
import { PageStage } from "./workbench-page-stage";

export interface OpenPageTabOptions {
  sourceTabId?: string;
  openMode?: "preview" | "durable";
}

export type OpenPageTabHandler = (
  projectId: string,
  pageId: string,
  titleSnapshot?: string,
  options?: OpenPageTabOptions,
) => Promise<void>;

export interface PageStageHistoryModalContext {
  sessionId: string;
  tabId: string;
  projectId: string;
  pageId: string;
  pageTitle?: string;
  pageNfm?: string;
}

interface PageStageDatabaseCapability {
  readonly availableTags: string[];
  readonly onDelete: (pageId: string) => Promise<void>;
  readonly onMove: (
    pageId: string,
    toStatus: DatabasePage["status"],
  ) => Promise<void>;
  readonly onCompleteOccurrence: (
    pageId: string,
    occurrenceStart: Date,
  ) => Promise<void>;
  readonly onSkipOccurrence: (
    pageId: string,
    occurrenceStart: Date,
  ) => Promise<void>;
}

function PageStageDatabaseCapabilityBoundary({
  projectId,
  sessionId,
  properties,
  children,
}: {
  projectId: string;
  sessionId: string;
  properties: PageStageDatabaseProperties | null;
  children: (capability: PageStageDatabaseCapability | null) => ReactNode;
}) {
  const kanban = useKanban({
    projectId,
    sessionId,
    enabled: properties !== null,
  });
  const availableTags = useMemo(() => {
    const tags = new Set<string>();
    for (const column of kanban.board?.columns ?? []) {
      for (const card of column.cards) {
        card.tags.forEach((tag) => tags.add(tag));
      }
    }
    return [...tags].sort((left, right) => left.localeCompare(right));
  }, [kanban.board?.columns]);

  if (!properties) return children(null);
  return children({
    availableTags,
    onDelete: async (pageId) => {
      const deleted = await kanban.deletePage(properties.status, pageId);
      if (!deleted) throw new Error(`Page ${pageId} delete did not commit`);
    },
    onMove: async (pageId, toStatus) => {
      await kanban.movePage({
        fromStatus: properties.status,
        pageId,
        toStatus,
      });
      await fetchPageDetail(projectId, pageId);
    },
    onCompleteOccurrence: async (pageId, occurrenceStart) => {
      await kanban.completeOccurrence({
        pageId,
        occurrenceStart,
        source: "page-detail",
      });
      await fetchPageDetail(projectId, pageId);
    },
    onSkipOccurrence: async (pageId, occurrenceStart) => {
      await kanban.skipOccurrence({
        pageId,
        occurrenceStart,
        source: "page-detail",
      });
      await fetchPageDetail(projectId, pageId);
    },
  });
}

export function PageStageSessionTab({
  tab,
  project,
  closeRef,
  persistRef,
  sessionSnapshotRef,
  sessionId,
  sessionThread,
  canStartThreadInSession,
  titleStore,
  onLeavePage,
  onClose,
  onOpenTerminal,
  onEnsureBlankSessionForProject,
  onRefreshSessions,
  onOpenPageTab,
  onOpenCanvasStage,
  onOpenThread,
  historyPanelActive,
  onToggleHistoryPanel,
  isActivePanelTab,
}: {
  tab: WorkbenchTabProjection & {
    config: WorkbenchProjectionPageStageTabConfig;
    preview?: true;
  };
  project: Project | null;
  closeRef: RefObject<(() => Promise<void>) | null>;
  persistRef?: MutableRefObject<(() => Promise<void>) | null>;
  sessionSnapshotRef?: MutableRefObject<PageStageSessionSnapshot | null>;
  sessionId: string;
  sessionThread: CodexThreadSummary | null;
  canStartThreadInSession: boolean;
  titleStore: PageStageTabTitleStore;
  onLeavePage: (snapshot: PageStageSessionSnapshot) => void;
  onClose: () => void;
  onOpenTerminal: () => Promise<void>;
  onEnsureBlankSessionForProject: (
    projectId: string,
    options?: { select?: boolean },
  ) => Promise<WorkbenchSessionRenderProjection>;
  onRefreshSessions: (
    projectId: string,
  ) => Promise<WorkbenchSessionRenderProjection[]>;
  onOpenPageTab: OpenPageTabHandler;
  onOpenCanvasStage: OpenCanvasStageHandler;
  onOpenThread: (threadId: string) => Promise<void>;
  historyPanelActive: boolean;
  onToggleHistoryPanel: (context: PageStageHistoryModalContext) => void;
  isActivePanelTab: boolean;
}) {
  const codexControl = useCodexAppServerControl(tab.config.projectId);
  const titleStoreKey = makePageStageTabTitleKey(sessionId, tab.id);

  const detailSnapshot = usePageDetail(
    project?.libraryId ?? null,
    tab.config.projectId,
    tab.config.pageId,
  );
  const stageProjection = useMemo(() => {
    if (!detailSnapshot.detail) return { page: null, error: null };
    try {
      return {
        page: projectPageDetailToStageModel(detailSnapshot.detail),
        error: null,
      };
    } catch (error) {
      return {
        page: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [detailSnapshot.detail]);
  const page = stageProjection.page;
  const pageLoadError = !page
    ? stageProjection.error ?? (
        detailSnapshot.error === "Page not found"
          ? null
          : detailSnapshot.error
      )
    : null;
  const pageHydrating = !page && (
    detailSnapshot.loading
    || (!detailSnapshot.error && !stageProjection.error)
  );

  useLayoutEffect(() => {
    if (!page) return;
    titleStore.publishCommitted(titleStoreKey, page.page.title);
  }, [page, titleStore, titleStoreKey]);

  useEffect(() => () => {
    titleStore.release(titleStoreKey);
  }, [titleStore, titleStoreKey]);

  const ownershipPath = usePageOwnershipPathReadModel(
    projectContentAccess(project?.id ?? tab.config.projectId),
    tab.config.pageId,
  );
  const ownershipAncestors = ownershipPath.data?.status === "available"
    ? ownershipPath.data.ancestors
    : [];
  const breadcrumb = ownershipAncestors.length > 0
    ? {
        ancestors: ownershipAncestors.map((ancestor) => ({
          projectId: tab.config.projectId,
          pageId: ancestor.pageId,
          title: ancestor.title.trim() || "Untitled",
          disabled: false,
        })),
        onOpenAncestor: (
          ancestor: { projectId: string; pageId: string; title: string },
        ) => {
          void onOpenPageTab(
            ancestor.projectId,
            ancestor.pageId,
            ancestor.title,
            { openMode: "durable" },
          );
        },
      }
    : undefined;
  const handleStartNewSessionThreadFromEditor = useCallback(async (input: {
    projectId: string;
    targetSessionId?: string;
    prompt: string;
    promptInput?: CodexPromptInput;
    threadName?: string;
  }) => {
    const targetSessionId = input.targetSessionId?.trim()
      || (await onEnsureBlankSessionForProject(
        input.projectId,
        { select: false },
      )).id;
    const result = await codexControl.startThreadForSession({
      projectId: input.projectId,
      sessionId: targetSessionId,
      prompt: input.prompt,
      promptInput: input.promptInput,
      threadName: input.threadName,
      skipAutoTitleGeneration: Boolean(input.threadName?.trim()),
      runInTarget: "localProject",
    });
    if (result.kind !== "started") {
      throw new Error("Page thread unexpectedly started in a worktree");
    }
    const { detail } = result;
    await onRefreshSessions(input.projectId);
    await codexControl.loadThreads(input.projectId);
    return {
      threadId: detail.threadId,
      sessionId: targetSessionId,
    };
  }, [
    codexControl,
    onEnsureBlankSessionForProject,
    onRefreshSessions,
  ]);

  if (!project) {
    return (
      <PageStageSessionNotice
        title="Project not found"
        description="This page tab points to a project that is no longer available."
        actionLabel="Close tab"
        onAction={onClose}
      />
    );
  }

  if (pageHydrating) {
    return (
      <PageStageSessionSkeleton
        titleSnapshot={tab.config.titleSnapshot}
        breadcrumb={breadcrumb
          ? {
              ...breadcrumb,
              currentTitle: tab.config.titleSnapshot ?? tab.config.pageId,
            }
          : undefined}
      />
    );
  }

  if (pageLoadError) {
    return (
      <PageStageSessionNotice
        title="Could not load Page"
        description={tab.config.titleSnapshot
          ? `Nodex could not load ${tab.config.titleSnapshot} in ${project.name}. ${pageLoadError}`
          : `Nodex could not load this page in ${project.name}. ${pageLoadError}`}
      />
    );
  }

  if (!page) {
    return (
      <PageStageSessionNotice
        title="Page not found"
        description={tab.config.titleSnapshot
          ? `${tab.config.titleSnapshot} is no longer available in ${project.name}.`
          : `This page is no longer available in ${project.name}.`}
        actionLabel="Close tab"
        onAction={onClose}
      />
    );
  }

  const compatibilityDatabase = page.databaseContext.kind === "member"
    ? page.databaseContext.compatibilityProperties
    : null;
  const renderDocumentSurface = (
    databaseCapability: PageStageDatabaseCapability | null,
  ): ReactNode => (
    <OwnedBlockDocumentBoundary
      projectId={tab.config.projectId}
      ownerBlockId={page.page.id}
    >
      {(documentModel, documentControls) => {
        if (documentModel.status === "loading") {
          return (
            <PageStageSessionSkeleton
              titleSnapshot={page.page.title}
              breadcrumb={breadcrumb
                ? {
                    ...breadcrumb,
                    currentTitle: page.page.title,
                  }
                : undefined}
            />
          );
        }
        if (documentModel.status === "error") {
          return (
            <PageStageSessionNotice
              title="Could not open page"
              description={documentModel.error.message}
              actionLabel="Retry"
              onAction={() => {
                void documentControls.reload();
              }}
            />
          );
        }
        if (documentModel.status !== "ready") {
          return (
            <PageStageSessionNotice
              title="Page content is not ready"
              description="This Page content is not ready to edit."
              actionLabel="Retry"
              onAction={() => {
                void documentControls.reload();
              }}
            />
          );
        }

        const documentAuthority = {
          kind: "yjs" as const,
          descriptor: documentModel.descriptor,
          reload: documentControls.reload,
        };

        return (
          <PageStage
            contentAccessContext={projectContentAccess(tab.config.projectId)}
            editorSessionKey={makePageEditorSessionKey(sessionId, tab.id)}
            retainEditorSession={tab.preview !== true}
            documentAuthority={documentAuthority}
            page={page}
            documentScopeId={tab.config.projectId}
            projectName={project.name}
            projectWorkspacePath={projectWorkspaceRootOrNull(project)}
            availableTags={databaseCapability?.availableTags ?? []}
            closeRef={closeRef as MutableRefObject<
              (() => Promise<void>) | null
            >}
            persistRef={persistRef}
            sessionSnapshotRef={sessionSnapshotRef}
            onTitleChange={(title) => {
              titleStore.publishLive(titleStoreKey, title);
            }}
            onTitleSourceDispose={() => {
              titleStore.clearLive(titleStoreKey);
            }}
            onClose={onClose}
            onLeavePage={onLeavePage}
            onUpdate={async (pageId: string, updates: Partial<PageInput>) =>
              await commitPageDetailMetadataPatch({
                projectId: tab.config.projectId,
                pageId,
                operationId: crypto.randomUUID(),
                clientSessionId: tab.id,
                patch: updates,
              })}
            {...(databaseCapability
              ? {
                  onDelete: databaseCapability.onDelete,
                  onMove: databaseCapability.onMove,
                  onCompleteOccurrence:
                    databaseCapability.onCompleteOccurrence,
                  onSkipOccurrence: databaseCapability.onSkipOccurrence,
                }
              : {})}
            onOpenTerminalPanel={() => {
              void onOpenTerminal();
            }}
            onToggleHistoryPanel={(snapshot) => onToggleHistoryPanel({
              sessionId,
              tabId: tab.id,
              projectId: tab.config.projectId,
              pageId: tab.config.pageId,
              pageTitle: snapshot.title || tab.config.titleSnapshot,
              pageNfm: snapshot.nfm,
            })}
            historyPanelActive={historyPanelActive}
            isActivePanelTab={isActivePanelTab}
            breadcrumb={breadcrumb}
            sessionId={sessionId}
            sessionThread={sessionThread}
            canStartThreadInSession={canStartThreadInSession}
            linkedCodexThreads={[]}
            onOpenCodexThread={onOpenThread}
            onOpenPage={({ projectId, pageId, titleSnapshot }) => {
              void onOpenPageTab(projectId, pageId, titleSnapshot, {
                openMode: "durable",
              });
            }}
            onOpenCanvas={({
              projectId,
              canvasBlockId,
              titleSnapshot,
            }) => {
              void onOpenCanvasStage(
                projectId,
                canvasBlockId,
                titleSnapshot,
              );
            }}
            onStartNewSessionThreadFromEditor={
              handleStartNewSessionThreadFromEditor
            }
            onSendThreadSectionPrompt={async ({
              projectId,
              threadId,
              prompt,
              promptInput,
            }) => {
              await codexControl.startTurn(threadId, prompt, {
                projectId,
                promptInput,
              });
            }}
          />
        );
      }}
    </OwnedBlockDocumentBoundary>
  );

  return (
    <PageStageDatabaseCapabilityBoundary
      projectId={tab.config.projectId}
      sessionId={tab.id}
      properties={compatibilityDatabase}
    >
      {renderDocumentSurface}
    </PageStageDatabaseCapabilityBoundary>
  );
}

function PageStageSessionSkeleton({
  titleSnapshot,
  breadcrumb,
}: {
  titleSnapshot?: string;
  breadcrumb?: ComponentPropsWithoutRef<
    typeof PageStageToolbar
  >["breadcrumb"];
}) {
  const title = titleSnapshot?.trim();
  const label = title ? `Loading ${titleSnapshot}` : "Loading card";
  const limitMainContentWidth = readPageStageContentWidthPreference();
  const contentBodyClassName = cn(
    "mx-auto w-full px-(--page-stage-body-gutter-inline)",
    limitMainContentWidth && "max-w-(--page-stage-body-max-width)",
  );

  return (
    <div
      className="flex h-full w-full flex-col bg-(--background) select-none"
      role="status"
      aria-busy="true"
      aria-label={label}
    >
      <PageStageToolbar
        saving={false}
        disabled={true}
        historyPanelActive={false}
        limitMainContentWidth={limitMainContentWidth}
        showRawContent={false}
        onCopyDeeplink={() => undefined}
        onDelete={() => undefined}
        onToggleContentWidth={() => undefined}
        onToggleShowRawContent={() => undefined}
        onToggleHistoryPanel={() => undefined}
        breadcrumb={breadcrumb}
      />

      <div
        className="scrollbar-token min-h-0 flex-1 overflow-y-auto"
        style={RIGHT_PANEL_COMPOSER_OVERLAY_SCROLL_RESERVE_STYLE}
      >
        <div
          className={contentBodyClassName}
          data-page-stage-body="true"
          data-page-stage-body-width={
            limitMainContentWidth ? "constrained" : "full"
          }
        >
          <div className="w-full">
            <PageStageContentSkeleton
              titleSnapshot={title}
              announce={false}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function PageStageSessionNotice({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-token-main-surface-primary p-3 select-none">
      <div className="mx-auto flex h-full w-full max-w-md flex-col items-center justify-center text-center">
        <div className="text-base font-medium text-token-text-primary">
          {title}
        </div>
        <div className="mt-1 text-sm text-token-text-secondary">
          {description}
        </div>
        {actionLabel && onAction ? (
          <NodexButton
            type="button"
            size="sm"
            className="mt-3"
            onClick={onAction}
          >
            {actionLabel}
          </NodexButton>
        ) : null}
      </div>
    </div>
  );
}
