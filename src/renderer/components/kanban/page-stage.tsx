import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { NfmEditor } from "./editor/nfm-editor";
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
import { RIGHT_PANEL_COMPOSER_OVERLAY_SCROLL_RESERVE_STYLE } from "@/lib/right-panel-composer-overlay-reserve";
import { blockNoteToNfm } from "../../../shared/block-documents/nfm-blocknote-adapter";
import { serializeNfm } from "../../../shared/nfm/serializer";
import {
  createBlockRecordWindowStore,
} from "@/lib/block-record-window-store";
import type { BlockRecordWindow } from "../../../shared/block-records/contracts";
import {
  createRecordBackedPageEditorSession,
  type RecordBackedPageEditorSession,
} from "@/lib/block-record-page-editor";
import type { BlockNoteBlockValue } from "../../../shared/block-documents/nfm-blocknote-adapter";
import type { NfmEditorInitialContent } from "./editor/nfm-editor-source";

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
        <PageStageInlinePropertyStrip controls={controller.propertyControls} />
      ) : null}

      <PageStagePropertiesSection controller={controller} />

      <div className="pt-2 pb-8">{description}</div>
    </div>
  );
}

function RecordBackedPageTitle({
  value,
  onValueChange,
  autoFocus,
}: {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly autoFocus?: boolean;
}) {
  return (
    <input
      value={value}
      autoFocus={autoFocus}
      placeholder="Untitled"
      aria-label="Page title"
      className="w-full min-w-0 border-none bg-transparent px-0.5 pt-0.75 text-xl/snug-plus font-bold text-(--foreground) outline-none placeholder:text-(--foreground-disabled) focus-visible:ring-0"
      onChange={(event) => onValueChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
        }
      }}
    />
  );
}

interface RecordBackedPageSurfaceProps {
  readonly controller: PageStageController;
  readonly props: PageStageProps;
  readonly pageId: string;
  readonly headingRailPortalElement: HTMLElement | null;
  readonly recordNfmRef: MutableRefObject<string>;
  readonly persistRef: MutableRefObject<(() => Promise<void>) | null>;
}

const emptyRecordEditorBlock: BlockNoteBlockValue = {
  type: "paragraph",
  content: [],
  children: [],
};

const recordEditorBlocks = (
  session: RecordBackedPageEditorSession,
  window: BlockRecordWindow,
): readonly BlockNoteBlockValue[] => {
  const blocks = session.bodyBlocks(window);
  return blocks.length > 0 ? blocks : [emptyRecordEditorBlock];
};

const RecordBackedPageSurface = memo(function RecordBackedPageSurface({
  controller,
  props,
  pageId,
  headingRailPortalElement,
  recordNfmRef,
  persistRef,
}: RecordBackedPageSurfaceProps) {
  const clientSessionId = useState(() => `record-page:${crypto.randomUUID()}`)[0];
  const windowStore = useMemo(
    () => props.recordWindowStore ?? createBlockRecordWindowStore(),
    [props.recordWindowStore],
  );
  const session = useMemo(
    () => createRecordBackedPageEditorSession({
      pageId,
      windowStore,
      actorId: "local-user",
      sessionId: props.sessionId ?? clientSessionId,
    }),
    [clientSessionId, pageId, props.sessionId, windowStore],
  );
  const [window, setWindow] = useState<BlockRecordWindow | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const pendingBlocksRef = useRef<readonly BlockNoteBlockValue[] | null>(null);
  const bodyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writeQueueRef = useRef(Promise.resolve());
  const pendingTitleRef = useRef<string | null>(null);
  const canonicalTitleCursorRef = useRef<string | null>(null);

  const flushBody = useCallback(async () => {
    if (bodyTimerRef.current) {
      clearTimeout(bodyTimerRef.current);
      bodyTimerRef.current = null;
    }
    const blocks = pendingBlocksRef.current;
    pendingBlocksRef.current = null;
    if (!blocks) return;
    writeQueueRef.current = writeQueueRef.current
      .then(() => session.saveBody(blocks))
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error : new Error(String(error)));
      });
    await writeQueueRef.current;
  }, [session]);

  const scheduleBodySave = useCallback((blocks?: readonly unknown[]) => {
    if (!blocks) return;
    pendingBlocksRef.current = blocks as readonly BlockNoteBlockValue[];
    if (bodyTimerRef.current) clearTimeout(bodyTimerRef.current);
    bodyTimerRef.current = setTimeout(() => {
      void flushBody();
    }, 120);
  }, [flushBody]);

  const scheduleTitleSave = useCallback((value: string) => {
    pendingTitleRef.current = value;
    if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
    titleTimerRef.current = setTimeout(() => {
      const next = pendingTitleRef.current;
      pendingTitleRef.current = null;
      if (next === null) return;
      writeQueueRef.current = writeQueueRef.current
        .then(() => session.saveTitle(next))
        .catch((error: unknown) => {
          setLoadError(error instanceof Error ? error : new Error(String(error)));
        });
    }, 120);
  }, [session]);

  useEffect(() => {
    setWindow(null);
    setLoadError(null);
    const unsubscribe = windowStore.subscribe(setWindow);
    const stopCommitSubscription = windowStore.startCommitSubscription();
    void session.load().catch((error: unknown) => {
      setLoadError(error instanceof Error ? error : new Error(String(error)));
    });
    return () => {
      unsubscribe();
      stopCommitSubscription();
      if (bodyTimerRef.current) clearTimeout(bodyTimerRef.current);
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
    };
  }, [pageId, session, windowStore]);

  useEffect(() => {
    persistRef.current = async () => {
      await flushBody();
      const title = pendingTitleRef.current;
      pendingTitleRef.current = null;
      if (title !== null) await session.saveTitle(title);
      await writeQueueRef.current;
    };
    return () => {
      persistRef.current = null;
    };
  }, [flushBody, persistRef, session]);

  const materialized = useMemo(() => {
    if (!window) {
      return {
        blocks: [] as readonly BlockNoteBlockValue[],
        rawContent: "",
        error: null as Error | null,
      };
    }

    try {
      const blocks = recordEditorBlocks(session, window);
      return {
        blocks,
        rawContent: serializeNfm(blockNoteToNfm(blocks)),
        error: null,
      };
    } catch (error) {
      return {
        blocks: [] as readonly BlockNoteBlockValue[],
        rawContent: "",
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }, [session, window]);
  const { blocks, rawContent, error: materializationError } = materialized;

  useEffect(() => {
    if (rawContent.length > 0) recordNfmRef.current = rawContent;
  }, [rawContent, recordNfmRef]);

  useEffect(() => {
    if (!window) return;
    const cursor = `${window.observedLocalCommit.storeEpoch}:${window.observedLocalCommit.commitSeq}`;
    if (canonicalTitleCursorRef.current === cursor) return;
    canonicalTitleCursorRef.current = cursor;
    const canonicalTitle = session.title(window);
    if (canonicalTitle !== controller.title) {
      controller.handleDocumentTitleChange(canonicalTitle);
    }
  }, [controller, session, window]);

  const onTitleSourceDispose = props.onTitleSourceDispose;
  useEffect(() => () => {
    onTitleSourceDispose?.();
  }, [onTitleSourceDispose]);

  const editorSource = useMemo(() => {
    if (!window) return null;
    return {
      kind: "record-window" as const,
      documentId: pageId,
      storeEpoch: window.observedLocalCommit.storeEpoch,
      generation: 1,
      clientSessionId,
      initialContent: blocks as NfmEditorInitialContent,
      contentVersion: window.observedLocalCommit.commitSeq,
      user: { name: "You", color: "#3b82f6" },
      onPrepareForMutation: async () => {
        await persistRef.current?.();
      },
      onDocumentChange: scheduleBodySave,
      onMoveBlocksToPage: (blockIds: readonly string[], targetPageId: string) =>
        session.moveBlocksToPage(blockIds, targetPageId),
      onTransfer: async (intent: Parameters<RecordBackedPageEditorSession["transfer"]>[0]) => {
        const result = await session.transfer(intent);
        if (!result.ok) throw new Error(result.error.message);
      },
    };
  }, [
    blocks,
    clientSessionId,
    pageId,
    persistRef,
    scheduleBodySave,
    session,
    window,
  ]);

  const title = (
    <RecordBackedPageTitle
      value={controller.title}
      autoFocus={props.autoFocusTitle}
      onValueChange={(value) => {
        controller.handleDocumentTitleChange(value);
        scheduleTitleSave(value);
      }}
    />
  );
  const error = loadError ?? materializationError;
  const description = error
    ? <div role="alert" className="py-8 text-sm text-token-error-foreground">{error.message}</div>
    : !window || !editorSource
      ? <PageStageContentSkeleton titleSnapshot={controller.title} />
      : controller.showRawContent
        ? <PageStageRawContent content={rawContent} />
        : (
          <NfmEditor
            contentAccessContext={props.contentAccessContext}
            documentScopeId={props.documentScopeId}
            projectName={props.projectName}
            projectWorkspacePath={props.projectWorkspacePath}
            source={editorSource}
            sourcePageContext={{ pageId }}
            sessionId={props.sessionId}
            sessionThread={props.sessionThread}
            canStartThreadInSession={props.canStartThreadInSession}
            linkedCodexThreads={props.linkedCodexThreads}
            onOpenCodexThread={props.onOpenCodexThread}
            onOpenPage={props.onOpenPage}
            onOpenDatabase={props.onOpenDatabase}
            onOpenCanvas={props.onOpenCanvas}
            onStartNewSessionThreadFromEditor={props.onStartNewSessionThreadFromEditor}
            onSendThreadSectionPrompt={props.onSendThreadSectionPrompt}
            isActivePanelTab={props.isActivePanelTab ?? true}
            headingRail={{
              portalElement: headingRailPortalElement,
              scrollContainerRef: controller.scrollContainerRef,
            }}
            placeholder="Add a description..."
          />
        );

  return (
    <PageStageContent
      controller={controller}
      title={title}
      syncStatus={<span className="text-xs text-token-description-foreground">Saved locally</span>}
      description={description}
    />
  );
});

export function PageStage(props: PageStageProps) {
  const { onToggleHistoryPanel } = props;
  const recordPersistRef = useRef<(() => Promise<void>) | null>(null);
  const recordNfmRef = useRef("");
  const persistDocument = useCallback(async () => {
    await recordPersistRef.current?.();
  }, []);
  const controller = usePageStageController(props, {
    persistDocument,
  });
  const handleToggleHistoryPanel = useCallback(() => {
    void (async () => {
      await persistDocument();
      onToggleHistoryPanel?.({
        title: controller.title,
        nfm: recordNfmRef.current,
      });
    })().catch(() => {
      toast.danger("Couldn’t prepare Page history");
    });
  }, [controller.title, onToggleHistoryPanel, persistDocument]);
  const [headingRailPortalElement, setHeadingRailPortalElement] =
    useState<HTMLDivElement | null>(null);

  if (!controller.page) return null;
  const page = controller.page;
  const documentSurface = (
    <RecordBackedPageSurface
      controller={controller}
      props={props}
      pageId={page.id}
      headingRailPortalElement={headingRailPortalElement}
      recordNfmRef={recordNfmRef}
      persistRef={recordPersistRef}
    />
  );
  const toolbar = (
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
  );

  return (
    <div
      className="flex h-full w-full flex-col bg-(--background)"
      data-page-stage-surface="true"
    >
      {props.toolbarPlacement?.kind === "external"
        ? props.toolbarPlacement.render(toolbar)
        : toolbar}

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
