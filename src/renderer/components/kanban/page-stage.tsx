import {
  memo,
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { NfmEditor } from "./editor/nfm-editor";
import {
  BlockDocumentSurface,
  type BlockDocumentSurfaceValue,
} from "@/components/block-documents/block-document-surface";
import { PageEditorSessionSurface } from "@/components/block-documents/page-editor-session-surface";
import { BlockDocumentSyncStatus } from "@/components/block-documents/block-document-sync-status";
import { CollaborativePageTitle } from "@/components/block-documents/collaborative-page-title";
import { PageStageInlinePropertyStrip } from "./page-stage/inline-property-strip";
import { PageStageContentSkeleton } from "./page-stage/content-skeleton";
import { PageStagePropertiesSection } from "./page-stage/properties-section";
import { PageStageRawContent } from "./page-stage/raw-content";
import { PageStageToolbar } from "./page-stage/toolbar";
import { usePageStageController } from "./page-stage/use-page-stage-controller";
import type { PageStageProps } from "./page-stage/types";
import { toast } from "@/components/ui/toast";
import { buildPageDeepLink } from "@/lib/page-deeplink";
import { writeTextToClipboard } from "@/lib/clipboard";
import type { BlockDocumentSurfaceRuntime } from "@/lib/block-document-surface-runtime";
import type { PageEditorSession } from "@/lib/page-editor-session-registry";
import { RIGHT_PANEL_COMPOSER_OVERLAY_SCROLL_RESERVE_STYLE } from "@/lib/right-panel-composer-overlay-reserve";
import { materializePageDocument } from "../../../shared/block-documents/block-document-codec";

export type { PageStageProps } from "./page-stage/types";

export const PAGE_STAGE_SCROLL_CONTAINER_TEST_ID =
  "page-stage-scroll-container";

const PAGE_STAGE_SCROLL_CONTAINER_STYLE = {
  ...RIGHT_PANEL_COMPOSER_OVERLAY_SCROLL_RESERVE_STYLE,
  overflowAnchor: "none",
} satisfies CSSProperties;

async function copyPageDeeplink(pageId: string): Promise<void> {
  const copied = await writeTextToClipboard(buildPageDeepLink({ pageId: pageId }));
  if (copied) {
    toast.success("Copied deeplink");
    return;
  }

  toast.danger("Failed to copy deeplink");
}

interface PageStageDescriptionEditorProps {
  readonly projectId: string;
  readonly projectName?: string | null;
  readonly projectWorkspacePath?: string | null;
  readonly pageId: string;
  readonly showRawContent: boolean;
  readonly documentId: string;
  readonly generation: number;
  readonly document: Y.Doc;
  readonly body: Y.XmlFragment;
  readonly awareness: Awareness;
  readonly surfaceWriteFence: BlockDocumentSurfaceRuntime;
  readonly sessionId?: string | null;
  readonly sessionThread: PageStageProps["sessionThread"];
  readonly canStartThreadInSession: PageStageProps["canStartThreadInSession"];
  readonly linkedCodexThreads: PageStageProps["linkedCodexThreads"];
  readonly onOpenCodexThread: PageStageProps["onOpenCodexThread"];
  readonly onOpenPage: PageStageProps["onOpenPage"];
  readonly onOpenDatabase: PageStageProps["onOpenDatabase"];
  readonly onStartNewSessionThreadFromEditor: PageStageProps["onStartNewSessionThreadFromEditor"];
  readonly onSendThreadSectionPrompt: PageStageProps["onSendThreadSectionPrompt"];
  readonly isActivePanelTab: boolean;
  readonly headingRailPortalElement: HTMLElement | null;
  readonly scrollContainerRef: RefObject<HTMLDivElement | null>;
  readonly editorSession?: PageEditorSession;
}

const useLivePageDocumentNfm = (document: Y.Doc): string => {
  const subscribe = useCallback(
    (listener: () => void) => {
      document.on("update", listener);
      return () => document.off("update", listener);
    },
    [document],
  );
  const getSnapshot = useCallback(
    () => materializePageDocument(document).nfm,
    [document],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

function CollaborativePageStageRawContent({
  document,
}: {
  readonly document: Y.Doc;
}) {
  return <PageStageRawContent content={useLivePageDocumentNfm(document)} />;
}

const PageStageDescriptionEditor = memo(
  function PageStageDescriptionEditor({
    projectId,
    projectName,
    projectWorkspacePath,
    pageId,
    showRawContent,
    documentId,
    generation,
    document,
    body,
    awareness,
    surfaceWriteFence,
    sessionId,
    sessionThread,
    canStartThreadInSession,
    linkedCodexThreads,
    onOpenCodexThread,
    onOpenPage,
    onOpenDatabase,
    onStartNewSessionThreadFromEditor,
    onSendThreadSectionPrompt,
    isActivePanelTab,
    headingRailPortalElement,
    scrollContainerRef,
    editorSession,
  }: PageStageDescriptionEditorProps) {
    if (showRawContent) {
      return <CollaborativePageStageRawContent document={document} />;
    }

    return (
      <NfmEditor
        projectId={projectId}
        projectName={projectName}
        projectWorkspacePath={projectWorkspacePath}
        source={{
          kind: "collaborative-document",
          documentId,
          storeEpoch: surfaceWriteFence.descriptor.storeEpoch,
          generation,
          clientSessionId: surfaceWriteFence.clientSessionId,
          fragment: body,
          user: { name: "You", color: "#3b82f6" },
          provider: { awareness },
        }}
        sourcePageContext={{ pageId }}
        surfaceWriteFence={surfaceWriteFence}
        sessionId={sessionId}
        sessionThread={sessionThread}
        canStartThreadInSession={canStartThreadInSession}
        linkedCodexThreads={linkedCodexThreads}
        onOpenCodexThread={onOpenCodexThread}
        onOpenPage={onOpenPage}
        onOpenDatabase={onOpenDatabase}
        onStartNewSessionThreadFromEditor={onStartNewSessionThreadFromEditor}
        onSendThreadSectionPrompt={onSendThreadSectionPrompt}
        isActivePanelTab={isActivePanelTab}
        headingRail={{
          portalElement: headingRailPortalElement,
          scrollContainerRef,
        }}
        placeholder="Add a description..."
        editorSession={editorSession}
      />
    );
  },
);

type PageStageController = ReturnType<typeof usePageStageController>;

interface PageStageContentProps {
  readonly controller: PageStageController;
  readonly title: ReactNode;
  readonly description: ReactNode;
  readonly syncStatus?: ReactNode;
}

function PageStageContent({
  controller,
  title,
  description,
  syncStatus,
}: PageStageContentProps) {
  return (
    <div className={controller.contentShellClassName}>
      <div className="h-toolbar-sm" />
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">{title}</div>
        {syncStatus ? <div className="shrink-0 pt-1">{syncStatus}</div> : null}
      </div>

      <div className="h-2" />

      {controller.hasDatabaseProperties ? (
        <PageStageInlinePropertyStrip
          priority={controller.priority}
          estimate={controller.estimate}
          dueDate={controller.dueDate}
          currentColumnId={controller.currentColumnId}
          currentColumnName={controller.currentColumnName}
          onPriorityChange={controller.handlePriorityChange}
          onEstimateChange={controller.handleEstimateChange}
          onDueDateChange={controller.handleDueDateChange}
          onClearDueDate={controller.handleClearDueDate}
          onSetDueDateToday={controller.handleSetDueDateToday}
          onColumnChange={controller.handleColumnChange}
        />
      ) : null}

      <PageStagePropertiesSection controller={controller} />

      <div className="pt-2 pb-8">{description}</div>
    </div>
  );
}

function PageStageDocumentTitle({
  title,
  surfaceWriteFence,
  onValueChange,
  onTitleSourceDispose,
  autoFocus,
}: {
  readonly title: Y.Text;
  readonly surfaceWriteFence: BlockDocumentSurfaceRuntime;
  readonly onValueChange: (title: string) => void;
  readonly onTitleSourceDispose?: () => void;
  readonly autoFocus?: boolean;
}) {
  const disposeTitleSource = useEffectEvent(() => {
    onTitleSourceDispose?.();
  });

  useEffect(() => () => {
    disposeTitleSource();
  }, [title]);

  return (
    <CollaborativePageTitle
      title={title}
      autoFocus={autoFocus}
      surfaceWriteFence={surfaceWriteFence}
      onValueChange={onValueChange}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
        }
      }}
    />
  );
}

export function PageStage(props: PageStageProps) {
  const { onToggleHistoryPanel } = props;
  const documentRuntimeRef = useRef<BlockDocumentSurfaceRuntime | null>(null);
  const persistDocument = useCallback(async () => {
    const runtime = documentRuntimeRef.current;
    if (!runtime || runtime.getStatus().reloadRequired) return;
    try {
      await runtime.persist();
    } catch (error) {
      if (runtime.getStatus().reloadRequired) return;
      throw error;
    }
  }, []);
  const controller = usePageStageController(props, {
    persistDocument,
  });
  const handleToggleHistoryPanel = useCallback(() => {
    void (async () => {
      await persistDocument();
      const runtime = documentRuntimeRef.current;
      const nfm = runtime
        ? materializePageDocument(runtime.document).nfm
        : "";
      onToggleHistoryPanel?.({
        title: controller.title,
        nfm,
      });
    })().catch(() => {
      toast.danger("Couldn’t prepare Page history");
    });
  }, [controller.title, onToggleHistoryPanel, persistDocument]);
  const [headingRailPortalElement, setHeadingRailPortalElement] =
    useState<HTMLDivElement | null>(null);

  if (!controller.page) return null;
  const page = controller.page;
  const renderDocumentSurface = (
    surface: BlockDocumentSurfaceValue,
    editorSession?: PageEditorSession,
  ): ReactNode => (
    <PageStageContent
      controller={controller}
      title={
        <PageStageDocumentTitle
          title={surface.title}
          surfaceWriteFence={surface.runtime}
          onValueChange={controller.handleDocumentTitleChange}
          onTitleSourceDispose={props.onTitleSourceDispose}
          autoFocus={props.autoFocusTitle}
        />
      }
      syncStatus={
        <BlockDocumentSyncStatus
          runtime={surface.runtime}
          status={surface.status.provider}
        />
      }
      description={
        <PageStageDescriptionEditor
          projectId={props.projectId}
          projectName={props.projectName}
          projectWorkspacePath={props.projectWorkspacePath}
          pageId={page.id}
          showRawContent={controller.showRawContent}
          documentId={surface.documentId}
          generation={surface.descriptor.generation}
          document={surface.document}
          body={surface.body}
          awareness={surface.awareness}
          surfaceWriteFence={surface.runtime}
          sessionId={props.sessionId}
          sessionThread={props.sessionThread}
          canStartThreadInSession={props.canStartThreadInSession}
          linkedCodexThreads={props.linkedCodexThreads}
          onOpenCodexThread={props.onOpenCodexThread}
          onOpenPage={props.onOpenPage}
          onOpenDatabase={props.onOpenDatabase}
          onStartNewSessionThreadFromEditor={
            props.onStartNewSessionThreadFromEditor
          }
          onSendThreadSectionPrompt={props.onSendThreadSectionPrompt}
          isActivePanelTab={props.isActivePanelTab ?? true}
          headingRailPortalElement={headingRailPortalElement}
          scrollContainerRef={controller.scrollContainerRef}
          editorSession={editorSession}
        />
      }
    />
  );
  const surfaceProps = {
    projectId: props.projectId,
    descriptor: props.documentAuthority.descriptor,
    isActive: props.isActivePanelTab ?? true,
    runtimeRef: documentRuntimeRef,
    onReload: props.documentAuthority.reload,
    dependencies: props.documentAuthority.surfaceDependencies,
    pendingFallback: <PageStageContentSkeleton titleSnapshot={page.title} />,
    localAwarenessState: {
      user: { name: "You", color: "#3b82f6" },
    },
  } as const;
  const documentSurface = props.editorSessionKey ? (
    <PageEditorSessionSurface
      {...surfaceProps}
      sessionKey={props.editorSessionKey}
      retainModelOnUnmount={props.retainEditorSession !== false}
    >
      {renderDocumentSurface}
    </PageEditorSessionSurface>
  ) : (
    <BlockDocumentSurface {...surfaceProps}>
      {(surface) => renderDocumentSurface(surface)}
    </BlockDocumentSurface>
  );

  return (
    <div
      className="flex h-full w-full flex-col bg-(--background)"
      data-page-stage-surface="true"
    >
      <PageStageToolbar
        onNavigateBack={props.onNavigateBack}
        saving={controller.saving}
        historyPanelActive={controller.historyPanelActive}
        limitMainContentWidth={controller.limitMainContentWidth}
        showRawContent={controller.showRawContent}
        onCopyDeeplink={() => {
          void copyPageDeeplink(page.id);
        }}
        onDelete={() => {
          void controller.handleDelete();
        }}
        showDelete={Boolean(props.onDelete)}
        onToggleContentWidth={controller.handleToggleContentWidth}
        onToggleShowRawContent={controller.handleToggleShowRawContent}
        onToggleHistoryPanel={handleToggleHistoryPanel}
        breadcrumb={props.breadcrumb ? {
          ...props.breadcrumb,
          currentTitle: controller.title,
        } : undefined}
      />

      <div
        ref={setHeadingRailPortalElement}
        className="relative min-h-0 flex-1"
        data-page-stage-heading-navigation-portal-target="true"
      >
        <div
          ref={controller.setScrollContainerRef}
          onScroll={controller.handleScroll}
          className="scrollbar-token h-full min-h-0 overflow-y-auto"
          data-testid={PAGE_STAGE_SCROLL_CONTAINER_TEST_ID}
          style={PAGE_STAGE_SCROLL_CONTAINER_STYLE}
        >
          <div
            className={controller.contentBodyClassName}
            data-page-stage-body="true"
            data-page-stage-body-width={
              controller.limitMainContentWidth ? "constrained" : "full"
            }
          >
            {documentSurface}
          </div>
        </div>
      </div>
    </div>
  );
}
