import {
  useEffect,
  useImperativeHandle,
  useRef,
  useMemo,
  useCallback,
  useState,
  type RefObject,
  type Ref,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  SideMenuController,
  type LinkToolbarProps,
  useCreateBlockNote,
} from "@blocknote/react";
import { BlockNoteEditor } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/shadcn";
import {
  ChevronDown,
  ChevronUp,
  CornerDownLeft,
  Repeat2,
  X,
} from "@/components/shared/icons/generic-icons";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";

import { nfmSchema } from "./nfm-schema";
import {
  createNfmEditorExtensions,
  createNfmPasteHandler,
  NFM_DISABLED_EXTENSIONS,
} from "./nfm-editor-extensions";
import { createNfmLinkExtension } from "./nfm-link-extension";
import { readNfmLinkHrefAtElement } from "./nfm-link-element";
import { NOTION_BLOCKS_MIME, NOTION_MULTI_TEXT_MIME } from "./notion-paste";
import { NfmFormattingToolbar } from "./nfm-formatting-toolbar";
import { NfmFormattingToolbarController } from "./nfm-formatting-toolbar-controller";
import { NfmTextActionMenuRuntimeProvider } from "./nfm-text-action-menu-runtime";
import { NfmLinkToolbar } from "./nfm-link-toolbar";
import { NfmLinkToolbarController } from "./nfm-link-toolbar-controller";
import { toast } from "@/components/ui/toast";
import { createUuidV7 } from "../../../../shared/uuid-v7";
import { LIBRARY_MODULE_CONTRACT_VERSION } from "../../../../shared/library-module";
import { applyLibraryModule } from "@/lib/api";
import { resolveNfmLinkAction } from "@/lib/nfm-link-actions";
import {
  projectIdFromContentAccessContext,
  type ContentCanvasNavigationTarget,
  type ContentAccessContext,
  type ContentPageNavigationTarget,
} from "../../../../shared/content-access-context";
import {
  NodexPopover,
  NodexPopoverAnchor,
  NodexPopoverContent,
} from "@/components/ui/popover";
import { useEditorDragBehaviors } from "./use-editor-drag-behaviors";
import {
  beginLocalBlockDragSession,
  endLocalBlockDragSession,
} from "../cross-surface-drag";
import { resolveTopLevelDraggedBlocks } from "./dragged-block-roots";
import { previewTaskShorthand } from "@/lib/task-shorthand-preview";
import type { CodexPromptInput } from "@/lib/types";
import { NfmSlashMenu } from "./nfm-slash-menu";
import { NfmTableHandlesController } from "./nfm-table-handles";
import { NfmHeadingNavigationRail } from "./nfm-heading-navigation-rail";
import {
  getNfmSearchState,
  goToNextNfmSearchMatch,
  goToPreviousNfmSearchMatch,
  replaceActiveNfmSearchMatch,
  replaceAllNfmSearchMatches,
  revealActiveNfmSearchMatch,
  setNfmSearchQuery,
} from "./search-extension";
import { resolveFindShortcutSeedQuery } from "./find-shortcut-seed";
import {
  deferCollapsedToggleVerticalArrowToBrowser,
} from "./inline-view-arrow-nav";
import {
  focusEmbeddedEditorBoundary,
  handleArrowIntoEmbeddedSurface,
  isEditorAtVisibleBoundary,
  type EmbeddedSurfaceHostEditor,
  type VerticalArrowDirection,
} from "./embedded-surface-arrow-navigation";
import {
  NfmSideMenu,
  NfmSideMenuOpenProvider,
  NfmSideMenuShortcutController,
} from "./nfm-side-menu";
import type { NfmMoveToDestination } from "./nfm-move-to-menu-model";
import { buildCodexPromptInputFromBlockNoteBlocks } from "./nfm-codex-prompt-input";
import { createSendToThreadToggleBlock } from "./nfm-send-to-thread-block";
import type {
  NfmSendToThreadPreferredTarget,
  NfmSendToThreadRequest,
} from "./nfm-send-to-thread-menu-model";
import { NfmSendToThreadMenuSurface } from "./nfm-send-to-thread-menu";
import { NfmSideMenuRuntimeProvider } from "./nfm-side-menu-runtime";
import { resolveSendBlockSelection } from "./send-block-selection";
import { PasteResourceDialog } from "./paste-resource-dialog";
import {
  canMaterializePasteResourceItems,
  continueInlinePaste,
  capturePasteResourceTarget,
  createPastedTextUploadFile,
  derivePastedTextAttachmentName,
  insertAttachmentsAtPasteTarget,
  normalizeClipboardFileDraftItems,
  shouldPromptForOversizedText,
  type PasteAttachmentInlineContent,
  type PasteResourceDialogState,
} from "./paste-resource";
import {
  getSideMenuSelectionGuardFloatingOptions,
  useSideMenuSelectionGuard,
} from "./side-menu-selection-guard";
import { NfmEditorContextMenu } from "./nfm-editor-context-menu";
import {
  appendInlineCardAncestor,
  appendInlineDocumentOwnerAncestor,
  BlockReferenceRuntimeProvider,
  type BlockReferenceHostRuntime,
  useBlockReferenceHostRuntime,
} from "@/components/block-documents/block-reference-runtime-context";
import { ImagePreviewDialog } from "@/features/user-attachment-image-editor";
import {
  isSpaceShortcut,
  resolveImagePreviewByBlockId,
  resolveFocusedImagePreview,
  type ImageBlockLookupEditor,
  type ImageSelectionEditor,
} from "./image-preview-shortcut";
import {
  type DragSessionBlock,
  type EditorForExternalBlockDrop,
  runInEditorTransaction,
} from "./external-block-drag-session";
import { shouldSuppressPreferIndentBoundaryTab } from "./prefer-indent-tab-boundary";
import {
  buildThreadSectionPromptInput,
  createEmptyThreadSectionBlock,
  deriveThreadSectionPromptBlocks,
  resolveThreadSectionSendPlan,
  type ThreadSectionBlockLike,
} from "./thread-section";
import {
  ThreadSectionRuntimeProvider,
  type ThreadSectionLinkedThreadState,
  type ThreadSectionRuntimeValue,
} from "./thread-section-runtime";
import {
  ThreadMentionRuntimeProvider,
  type ThreadMentionRuntimeValue,
} from "./thread-mention-chip";
import type { PageStageLinkedThread } from "@/components/board/page-stage/types";
import {
  invoke,
  prepareOwnedBlockDocument,
  transferBlocks,
} from "@/lib/api";
import {
  serializeNfm,
  blockNoteToNfm,
  applyToggleStatesFromDom,
} from "@/lib/nfm";
import type { CodexThreadSummary } from "@/lib/types";
import {
  materializeLocalResourceAsset,
  resolveAssetSourceToDisplayUrl,
  uploadImageAsset,
  uploadResourceAsset,
} from "@/lib/assets";
import { useSpellcheck } from "@/lib/use-spellcheck";
import { useTheme } from "@/lib/use-theme";
import { usePasteResourceSettings } from "@/lib/use-paste-resource-settings";
import { resolvePageDeepLinkPasteIntent } from "@/lib/page-reference-paste";
import { cn } from "@/lib/utils";
import { useCommandPaletteThreadItems } from "@/lib/command-palette-chat-search";
import type { BlockDocumentMutationBarrier } from "@/lib/block-document-surface-runtime";
import {
  registerBlockDocumentMutationBarrier,
  resolveBlockDocumentMutationBarrier,
} from "@/lib/block-document-mutation-registry";
import {
  createCanvasInHostPage,
  deleteCanvasOwner,
  duplicateCanvasInHostPage,
  isCanvasHostDocumentRuntime,
  moveCanvasOwnerBetweenHostPages,
  moveCanvasOwnerToPage,
  registerCanvasHostDocumentRuntime,
  renameCanvasOwner,
  resolveCanvasHostDocumentRuntime,
  resolveCanvasInsertionAfterBlock,
} from "@/lib/canvas-host-operations";
import type { EditorSurfaceLease } from "@/lib/document-session-registry";
import {
  useCodexPermissionState,
  useDefaultCodexAppServerManager,
  useProjectThreadSummaries,
} from "@/features/local-conversation/local-conversation-store";
import type { ModifyShortcutEditor } from "./modify-block-shortcut";
import { handleNfmEditorModEnterShortcut } from "./nfm-editor-mod-enter-shortcut";
import { PAGE_DESCRIPTION_PLACEHOLDER } from "@/lib/page-description-placeholder";
import {
  createNfmEditorModeOptions,
  getNfmEditorInstanceKey,
  resolveNfmEditorBlockActionCapabilities,
  type NfmEditorSource,
} from "./nfm-editor-source";
import {
  prepareNfmEditorForMutation,
  type NfmEditorMutationRuntime,
} from "./nfm-editor-relocation";
import { moveNfmBlocks } from "@/lib/nfm-block-move-runtime";
import { commitPageLifecycleIntent } from "@/lib/page-lifecycle-runtime";
import {
  hasNestedTypedOwnerBlock,
  hasTypedOwnerBlock,
  hasTypedOwnerType,
  resolveOwnerSelectionOperation,
  type TypedOwnerBlockLike,
} from "@/lib/typed-owner-blocks";

interface NfmEditorCommonProps {
  contentAccessContext: ContentAccessContext;
  projectName?: string | null;
  projectWorkspacePath?: string | null;
  sourcePageContext?: {
    pageId: string;
  };
  /** The independently synchronized owner whose body this editor renders. */
  documentOwnerBlockId?: string;
  sessionId?: string | null;
  sessionThread?: CodexThreadSummary | null;
  canStartThreadInSession?: boolean;
  linkedCodexThreads?: PageStageLinkedThread[];
  onOpenCodexThread?: (threadId: string) => Promise<void>;
  onOpenPage?: (input: ContentPageNavigationTarget) => void | Promise<void>;
  onOpenDatabase?: BlockReferenceHostRuntime["openDatabase"];
  onOpenCanvas?: (input: ContentCanvasNavigationTarget) => void | Promise<void>;
  onStartNewSessionThreadFromEditor?: (input: {
    projectId: string;
    targetSessionId?: string;
    prompt: string;
    promptInput?: CodexPromptInput;
    threadName?: string;
  }) => Promise<{ threadId: string; sessionId?: string }>;
  onSendThreadSectionPrompt?: (input: {
    projectId: string;
    threadId: string;
    prompt: string;
    promptInput?: CodexPromptInput;
  }) => Promise<void>;
  isActivePanelTab?: boolean;
  headingRail?: {
    portalElement: HTMLElement | null;
    scrollContainerRef: RefObject<HTMLElement | null>;
  };
  placeholder?: string;
  className?: string;
  surfaceMutationBarrier?: BlockDocumentMutationBarrier;
  embeddedBoundary?: {
    navigationRef: Ref<NfmEditorBoundaryHandle>;
    onBoundaryArrow: (direction: VerticalArrowDirection) => boolean;
  };
  navigationRef?: Ref<NfmEditorBoundaryHandle>;
  /** Optional PageTab-owned model whose lifetime exceeds this React view. */
  editorSession?: EditorSurfaceLease;
}

interface TypedOwnerSelectionEditor {
  getSelection: () => {
    blocks?: readonly TypedOwnerSelectionBlock[];
  } | undefined;
}

interface TypedOwnerSelectionBlock {
  readonly id: string;
  readonly type: string;
  readonly children?: readonly TypedOwnerSelectionBlock[];
}

export interface NfmEditorBoundaryHandle {
  focus(): boolean;
  focusBlock(blockId: string): boolean;
  focusBoundary(direction: VerticalArrowDirection): boolean;
}

export interface NfmEditorProps extends NfmEditorCommonProps {
  source: NfmEditorSource;
}

interface NfmEditorInstanceProps extends NfmEditorCommonProps {
  source: NfmEditorSource;
  editorInstanceKey: string;
}

interface InlineViewHostContextRuntimeEditor {
  nodexSourcePageContext?: {
    projectId: string;
    pageId: string;
  } | null;
}

interface SendBlocksSelection {
  blockIds: string[];
  blocks: DragSessionBlock[];
}

interface PreparedThreadSectionSendRequest {
  sectionTitle: string;
  plainTextPreview: string;
  threadLabel: string;
  sendActionLabel: string;
  autoCreateSection: boolean;
  prompt: string;
  promptInput: CodexPromptInput;
  markerBlockId: string | null;
  threadId: string;
  canReuseThread: boolean;
  createMarkerBeforeBlockId: string | null;
}

interface ThreadSectionPickerState {
  request: PreparedThreadSectionSendRequest;
  anchorRect: DOMRect;
  preferredTarget: NfmSendToThreadPreferredTarget | null;
}

function isAvailableNfmSendToThreadPreferredTargetThread(
  thread: CodexThreadSummary | null | undefined,
): thread is CodexThreadSummary {
  return Boolean(
    thread &&
    !thread.archived &&
    thread.ephemeral !== true &&
    thread.source?.sideConversation !== true,
  );
}

function createNfmSendToThreadPreferredTargetFromThread(
  thread: CodexThreadSummary | null | undefined,
  meta: string,
): NfmSendToThreadPreferredTarget | null {
  if (!isAvailableNfmSendToThreadPreferredTargetThread(thread)) return null;
  return { kind: "thread", thread, meta };
}

function createNfmSendToThreadPreferredSessionTarget(
  sessionId: string | null | undefined,
  canStartThreadInSession: boolean,
): NfmSendToThreadPreferredTarget | null {
  if (!canStartThreadInSession) return null;
  const normalizedSessionId = sessionId?.trim();
  if (!normalizedSessionId) return null;
  return {
    kind: "new-thread",
    sessionId: normalizedSessionId,
    meta: "This session",
  };
}

function toThreadSectionLinkedThreadState(
  thread: PageStageLinkedThread,
): ThreadSectionLinkedThreadState {
  return {
    threadId: thread.threadId,
    threadName: thread.title,
    threadPreview: thread.preview ?? "",
    statusType: thread.statusType,
    statusActiveFlags: thread.statusActiveFlags,
    archived: thread.archived,
    updatedAt: thread.updatedAt,
  };
}

function toThreadSectionLinkedThreadStateFromSummary(
  thread: CodexThreadSummary,
): ThreadSectionLinkedThreadState {
  return {
    threadId: thread.threadId,
    threadName: thread.threadName ?? "",
    threadPreview: thread.threadPreview,
    statusType: thread.statusType,
    statusActiveFlags: thread.statusActiveFlags,
    archived: thread.archived,
    updatedAt: thread.updatedAt,
  };
}

function buildThreadSectionThreadMap(
  threads: ThreadSectionLinkedThreadState[],
): Record<string, ThreadSectionLinkedThreadState> {
  return threads.reduce<Record<string, ThreadSectionLinkedThreadState>>(
    (acc, thread) => {
      acc[thread.threadId] = thread;
      return acc;
    },
    {},
  );
}

export function NfmEditor(props: NfmEditorProps) {
  const source = props.source;
  const editorInstanceKey = getNfmEditorInstanceKey({
    accessContext: props.contentAccessContext,
    source,
  });

  return (
    <NfmEditorInstance
      key={editorInstanceKey}
      {...props}
      source={source}
      editorInstanceKey={editorInstanceKey}
    />
  );
}

function NfmEditorInstance({
  contentAccessContext,
  projectName = null,
  projectWorkspacePath,
  source,
  editorInstanceKey,
  sourcePageContext,
  documentOwnerBlockId,
  sessionId = null,
  sessionThread = null,
  canStartThreadInSession = false,
  linkedCodexThreads = [],
  onOpenCodexThread,
  onOpenPage,
  onOpenDatabase,
  onOpenCanvas,
  onStartNewSessionThreadFromEditor,
  onSendThreadSectionPrompt,
  isActivePanelTab = true,
  headingRail,
  placeholder = PAGE_DESCRIPTION_PLACEHOLDER,
  className,
  surfaceMutationBarrier,
  embeddedBoundary,
  navigationRef,
  editorSession,
}: NfmEditorInstanceProps) {
  const executionProjectId = projectIdFromContentAccessContext(
    contentAccessContext,
  );
  const parentBlockReferenceRuntime = useBlockReferenceHostRuntime();
  const { resolved: themeMode } = useTheme();
  const { spellcheck } = useSpellcheck();
  const { settings: pasteResourceSettings } = usePasteResourceSettings();
  const codexManager = useDefaultCodexAppServerManager();
  const codexPermissionState = useCodexPermissionState(executionProjectId);
  const projectThreadSummaries = useProjectThreadSummaries(executionProjectId);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceQuery, setReplaceQuery] = useState("");
  const [searchMatchCount, setSearchMatchCount] = useState(0);
  const [searchActiveIndex, setSearchActiveIndex] = useState(-1);
  const [pasteResourceDialog, setPasteResourceDialog] =
    useState<PasteResourceDialogState | null>(null);
  const [threadSectionPicker, setThreadSectionPicker] =
    useState<ThreadSectionPickerState | null>(null);
  const { threads: sendToThreadItems, loading: sendToThreadItemsLoading } =
    useCommandPaletteThreadItems({
      enabled: Boolean(threadSectionPicker) && executionProjectId !== null,
      activeProjectId: executionProjectId,
      refreshKey: 0,
    });
  const [pasteResourcePending, setPasteResourcePending] = useState(false);
  const [pasteResourceError, setPasteResourceError] = useState<string | null>(
    null,
  );
  const [imagePreview, setImagePreview] = useState<{
    source: string;
    alt: string;
  } | null>(null);
  const renderLinkToolbar = useCallback(
    (linkToolbarProps: LinkToolbarProps) => (
      <NfmLinkToolbar
        {...linkToolbarProps}
        projectWorkspacePath={projectWorkspacePath}
      />
    ),
    [projectWorkspacePath],
  );
  const [threadSectionPendingBlockIds, setThreadSectionPendingBlockIds] =
    useState<Set<string>>(() => new Set());
  const [threadMentionThreadsById, setThreadMentionThreadsById] = useState<
    Record<string, CodexThreadSummary>
  >({});
  const [threadMentionResolvingIds, setThreadMentionResolvingIds] = useState<
    Set<string>
  >(() => new Set());
  const threadMentionResolvePromisesRef = useRef<
    Map<string, Promise<CodexThreadSummary | null>>
  >(new Map());
  const searchInputRef = useRef<HTMLInputElement>(null);

  const threadSectionThreadMap = useMemo(
    () =>
      buildThreadSectionThreadMap([
        ...linkedCodexThreads.map(toThreadSectionLinkedThreadState),
        ...projectThreadSummaries.map(
          toThreadSectionLinkedThreadStateFromSummary,
        ),
      ]),
    [linkedCodexThreads, projectThreadSummaries],
  );

  const projectThreadSummaryMap = useMemo(
    () =>
      projectThreadSummaries.reduce<Record<string, CodexThreadSummary>>(
        (acc, thread) => {
          acc[thread.threadId] = thread;
          return acc;
        },
        {},
      ),
    [projectThreadSummaries],
  );

  const sessionSendToThreadPreferredTarget = useMemo(
    () =>
      createNfmSendToThreadPreferredTargetFromThread(
        sessionThread,
        "This session",
      ) ??
      createNfmSendToThreadPreferredSessionTarget(
        sessionId,
        canStartThreadInSession,
      ),
    [canStartThreadInSession, sessionId, sessionThread],
  );
  const sendToThreadProjectNameById = useMemo(() => {
    if (executionProjectId === null) return {};
    return {
      [executionProjectId]: projectName?.trim() || executionProjectId,
    };
  }, [executionProjectId, projectName]);

  const threadMentionSummaryMap = useMemo(
    () => ({
      ...projectThreadSummaryMap,
      ...threadMentionThreadsById,
    }),
    [projectThreadSummaryMap, threadMentionThreadsById],
  );
  const threadMentionSummaryMapRef = useRef(threadMentionSummaryMap);
  useEffect(() => {
    threadMentionSummaryMapRef.current = threadMentionSummaryMap;
  }, [threadMentionSummaryMap]);

  const uploadFile = useCallback(
    async (file: File) => uploadImageAsset(file),
    [],
  );

  const resolveFileUrl = useCallback(
    async (source: string) => resolveAssetSourceToDisplayUrl(source),
    [],
  );

  const canvasCommandHandlersRef = useRef({
    duplicate: async (canvasBlockId: string) => {
      void canvasBlockId;
    },
    delete: async (canvasBlockId: string) => {
      void canvasBlockId;
    },
  });
  const pageCommandHandlersRef = useRef({
    delete: async (pageBlockId: string) => {
      void pageBlockId;
    },
  });
  const typedOwnerDeleteRef = useRef<
    (editor: TypedOwnerSelectionEditor) => boolean
  >(() => false);
  const typedOwnerCutRef = useRef<
    (editor: TypedOwnerSelectionEditor) => boolean
  >(() => false);
  const typedReplacementGuardRef = useRef<
    (blocks: readonly TypedOwnerSelectionBlock[]) => boolean
  >(() => false);
  const typedPasteGuardRef = useRef<
    (blocks: readonly TypedOwnerBlockLike[]) => boolean
  >(() => false);

  const pasteHandler = useMemo(
    () =>
      createNfmPasteHandler({
        onBeforeReplaceBlocks: (blocks) =>
          typedReplacementGuardRef.current(blocks),
        onBeforeInsertBlocks: (blocks) => typedPasteGuardRef.current(blocks),
      }),
    [],
  );
  const extensions = useMemo(
    () =>
      createNfmEditorExtensions({
        onCutTypedBlocks: (editor) => typedOwnerCutRef.current(editor),
      }),
    [],
  );
  const tiptapExtensions = useMemo(() => [createNfmLinkExtension()], []);

  const editorModeOptions = createNfmEditorModeOptions(source);

  const editorOptions = {
    schema: nfmSchema,
    ...editorModeOptions,
    generateBlockId: createUuidV7,
    tabBehavior: "prefer-indent" as const,
    placeholders: {
      default: placeholder,
    },
    uploadFile,
    resolveFileUrl,
    pasteHandler,
    tables: {
      headers: true,
      cellBackgroundColor: true,
      cellTextColor: false,
      splitCells: false,
    },
    disableExtensions: [...NFM_DISABLED_EXTENSIONS, "link"],
    extensions,
    _tiptapOptions: {
      extensions: tiptapExtensions,
    },
  };
  const retainedEditor = editorSession?.getOrCreateEditor(
    editorInstanceKey,
    () => BlockNoteEditor.create(editorOptions),
  );
  const editor = useCreateBlockNote(
    editorOptions,
    [editorInstanceKey],
    retainedEditor,
  );

  const resolveThreadMention = useCallback(
    async (threadId: string): Promise<CodexThreadSummary | null> => {
      const normalizedThreadId = threadId.trim();
      if (!normalizedThreadId) return null;

      const cached = threadMentionSummaryMapRef.current[normalizedThreadId];
      if (cached) return cached;

      const existingPromise =
        threadMentionResolvePromisesRef.current.get(normalizedThreadId);
      if (existingPromise) return existingPromise;

      setThreadMentionResolvingIds((current) => {
        if (current.has(normalizedThreadId)) return current;
        const next = new Set(current);
        next.add(normalizedThreadId);
        return next;
      });

      const resolvePromise = invoke(
        "codex:thread:summary:get",
        normalizedThreadId,
      )
        .then((thread) => {
          const summary = thread as CodexThreadSummary | null;
          if (!summary) return null;

          setThreadMentionThreadsById((current) => {
            const existing = current[summary.threadId];
            if (
              existing &&
              existing.threadName === summary.threadName &&
              existing.threadPreview === summary.threadPreview &&
              existing.statusType === summary.statusType &&
              existing.archived === summary.archived &&
              existing.updatedAt === summary.updatedAt
            ) {
              return current;
            }
            return {
              ...current,
              [summary.threadId]: summary,
            };
          });
          return summary;
        })
        .finally(() => {
          threadMentionResolvePromisesRef.current.delete(normalizedThreadId);
          setThreadMentionResolvingIds((current) => {
            if (!current.has(normalizedThreadId)) return current;
            const next = new Set(current);
            next.delete(normalizedThreadId);
            return next;
          });
        });

      threadMentionResolvePromisesRef.current.set(
        normalizedThreadId,
        resolvePromise,
      );
      return resolvePromise;
    },
    [],
  );

  const syncSearchStats = useCallback(() => {
    if (!editor) return;
    const state = getNfmSearchState(editor);
    setSearchMatchCount(state.totalMatches);
    setSearchActiveIndex(state.activeIndex);
  }, [editor]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setReplaceOpen(false);
    setReplaceQuery("");
    if (!editor) return;
    setNfmSearchQuery(editor, "");
    syncSearchStats();
  }, [editor, syncSearchStats]);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, []);

  const navigateSearch = useCallback(
    (direction: "next" | "prev", preserveInputFocus = false) => {
      if (!editor) return;
      if (direction === "next") {
        goToNextNfmSearchMatch(editor);
      } else {
        goToPreviousNfmSearchMatch(editor);
      }
      revealActiveNfmSearchMatch(editor);
      syncSearchStats();
      if (preserveInputFocus) {
        requestAnimationFrame(() => {
          searchInputRef.current?.focus();
        });
      }
    },
    [editor, syncSearchStats],
  );

  const replaceCurrentMatch = useCallback(() => {
    if (!editor) return;

    const state = getNfmSearchState(editor);
    if (state.totalMatches === 0) return;

    if (state.activeIndex < 0) {
      goToNextNfmSearchMatch(editor);
      revealActiveNfmSearchMatch(editor);
      syncSearchStats();
    }

    const replaced = replaceActiveNfmSearchMatch(editor, replaceQuery);
    if (!replaced) return;

    goToNextNfmSearchMatch(editor);
    revealActiveNfmSearchMatch(editor);
    syncSearchStats();

    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
  }, [editor, replaceQuery, syncSearchStats]);

  const replaceAllMatches = useCallback(() => {
    if (!editor) return;
    replaceAllNfmSearchMatches(editor, replaceQuery);
    syncSearchStats();

    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
  }, [editor, replaceQuery, syncSearchStats]);

  const serializeEditorToNfm = useCallback((): string => {
    if (!editor) return "";
    const nfmBlocks = blockNoteToNfm(editor.document);
    if (containerRef.current) {
      applyToggleStatesFromDom(
        editor.document,
        nfmBlocks,
        containerRef.current,
      );
    }
    return serializeNfm(nfmBlocks);
  }, [editor]);

  const restoreEditorFocus = useCallback(() => {
    requestAnimationFrame(() => {
      editor?.focus();
    });
  }, [editor]);
  const previousActivePanelTabRef = useRef(isActivePanelTab);

  useEffect(() => {
    const wasActive = previousActivePanelTabRef.current;
    previousActivePanelTabRef.current = isActivePanelTab;

    if (!isActivePanelTab) return;
    if (wasActive) return;

    restoreEditorFocus();
  }, [editor, isActivePanelTab, restoreEditorFocus]);

  const prepareThreadSectionSend = useCallback(
    async (blockId: string) => {
      if (!editor) return null;

      const sendPlan = resolveThreadSectionSendPlan(
        editor.document as ThreadSectionBlockLike[],
        blockId,
      );
      if (!sendPlan) return null;

      const promptBlocks = deriveThreadSectionPromptBlocks(sendPlan.section);
      const promptInput = buildThreadSectionPromptInput(
        promptBlocks,
        (nfmBlocks) => {
          if (!containerRef.current) return;
          applyToggleStatesFromDom(
            promptBlocks,
            nfmBlocks,
            containerRef.current,
          );
        },
      );
      const plainTextPreview = promptInput.text;
      const existingThread =
        sendPlan.section.threadId.length > 0
          ? threadSectionThreadMap[sendPlan.section.threadId]
          : undefined;
      const canReuseThread = Boolean(
        existingThread && !existingThread.archived,
      );
      const sectionTitle =
        sendPlan.section.label || sendPlan.section.fallbackTitle;
      const sendActionLabel = canReuseThread
        ? "Send to existing thread"
        : sendPlan.section.threadId.length > 0
          ? "Start a new thread and rebind section"
          : "Start a new thread";
      const threadLabel = canReuseThread
        ? existingThread?.threadName?.trim() ||
          existingThread?.threadPreview?.trim() ||
          sendPlan.section.threadId
        : sendPlan.section.threadId.length > 0
          ? "Linked thread is unavailable"
          : "No existing thread";

      return {
        sectionTitle,
        plainTextPreview,
        threadLabel,
        sendActionLabel,
        autoCreateSection: sendPlan.createMarkerBeforeBlockId !== null,
        prompt: promptInput.text,
        promptInput,
        markerBlockId: sendPlan.section.markerBlockId || null,
        threadId: sendPlan.section.threadId,
        canReuseThread,
        createMarkerBeforeBlockId: sendPlan.createMarkerBeforeBlockId,
      };
    },
    [editor, threadSectionThreadMap],
  );

  const closeThreadSectionPicker = useCallback(() => {
    setThreadSectionPicker(null);
  }, []);

  const resolveThreadSectionPreferredThread = useCallback(
    (
      request: PreparedThreadSectionSendRequest,
    ): NfmSendToThreadPreferredTarget | null => {
      const sectionThread =
        request.threadId.length > 0
          ? (projectThreadSummaryMap[request.threadId] ??
            (sessionThread?.threadId === request.threadId
              ? sessionThread
              : undefined))
          : undefined;
      return (
        createNfmSendToThreadPreferredTargetFromThread(
          sectionThread,
          "Current section",
        ) ?? sessionSendToThreadPreferredTarget
      );
    },
    [
      projectThreadSummaryMap,
      sessionThread,
      sessionSendToThreadPreferredTarget,
    ],
  );

  const withPendingThreadSection = useCallback(
    async (blockId: string, action: () => Promise<void>) => {
      setThreadSectionPendingBlockIds((current) => {
        const next = new Set(current);
        next.add(blockId);
        return next;
      });

      try {
        await action();
      } finally {
        setThreadSectionPendingBlockIds((current) => {
          const next = new Set(current);
          next.delete(blockId);
          return next;
        });
      }
    },
    [],
  );

  const handleOpenThreadSectionThread = useCallback(
    (threadId: string) => {
      if (!onOpenCodexThread) return;
      void onOpenCodexThread(threadId);
    },
    [onOpenCodexThread],
  );

  const performThreadSectionSend = useCallback(
    async (
      request: PreparedThreadSectionSendRequest,
      sendRequest: NfmSendToThreadRequest,
    ) => {
      if (!editor) {
        return false;
      }
      if (executionProjectId === null) {
        toast.danger("Thread sending requires a Project.", {
          id: "nfm-thread-section",
        });
        restoreEditorFocus();
        return false;
      }
      if (sendRequest.target.kind === "thread" && !onSendThreadSectionPrompt) {
        toast.danger("Thread sending is not available.", {
          id: "nfm-thread-section",
        });
        restoreEditorFocus();
        return false;
      }
      if (
        sendRequest.target.kind === "new-thread" &&
        !onStartNewSessionThreadFromEditor
      ) {
        toast.danger("New chat creation is not available.", {
          id: "nfm-thread-section",
        });
        restoreEditorFocus();
        return false;
      }

      let markerBlockId = request.markerBlockId;
      if (!markerBlockId && request.createMarkerBeforeBlockId) {
        const [insertedMarker] = editor.insertBlocks(
          [createEmptyThreadSectionBlock()],
          request.createMarkerBeforeBlockId,
          "before",
        );
        markerBlockId = insertedMarker?.id ?? null;
      }

      if (!markerBlockId) {
        toast.danger("Could not resolve a thread section to send.", {
          id: "nfm-thread-section",
        });
        restoreEditorFocus();
        return false;
      }

      const sendExistingThreadPrompt = onSendThreadSectionPrompt;
      const startNewSessionThread = onStartNewSessionThreadFromEditor;

      try {
        await withPendingThreadSection(markerBlockId, async () => {
          const threadId =
            sendRequest.target.kind === "thread"
              ? sendRequest.target.threadId
              : (
                  await startNewSessionThread!({
                    projectId: executionProjectId,
                    targetSessionId: sendRequest.target.sessionId,
                    prompt: request.prompt,
                    promptInput: request.promptInput,
                    threadName: request.sectionTitle,
                  })
                ).threadId;

          if (sendRequest.target.kind === "thread") {
            await sendExistingThreadPrompt!({
              projectId: executionProjectId,
              threadId,
              prompt: request.prompt,
              promptInput: request.promptInput,
            });
          }

          const markerBlock = editor.getBlock(markerBlockId);
          if (!markerBlock) return;
          editor.updateBlock(markerBlock, {
            props: {
              ...(markerBlock.props ?? {}),
              threadId,
            },
          });
        });
        restoreEditorFocus();
        return true;
      } catch (error) {
        toast.danger(
          error instanceof Error
            ? error.message
            : "Could not send thread section.",
          {
            id: "nfm-thread-section",
          },
        );
        restoreEditorFocus();
        return false;
      }
    },
    [
      editor,
      executionProjectId,
      onStartNewSessionThreadFromEditor,
      onSendThreadSectionPrompt,
      restoreEditorFocus,
      withPendingThreadSection,
    ],
  );

  const handleAcceptThreadSectionPicker = useCallback(
    async (sendRequest: NfmSendToThreadRequest) => {
      if (!threadSectionPicker) return;
      const request = threadSectionPicker.request;
      closeThreadSectionPicker();
      await performThreadSectionSend(request, sendRequest);
    },
    [closeThreadSectionPicker, performThreadSectionSend, threadSectionPicker],
  );

  const handleSendThreadSectionByBlockId = useCallback(
    (blockId: string, anchor?: HTMLElement) => {
      if (
        !editor ||
        executionProjectId === null ||
        !onSendThreadSectionPrompt
      ) {
        return false;
      }

      const cssEscape =
        globalThis.CSS?.escape ??
        ((value: string) => value.replace(/["\\]/g, "\\$&"));
      const anchorElement =
        anchor ??
        editor.prosemirrorView?.dom.querySelector<HTMLElement>(
          `.bn-block[data-id="${cssEscape(blockId)}"]`,
        ) ??
        editor.prosemirrorView?.dom;
      if (!anchorElement) return false;

      void (async () => {
        const sendRequest = await prepareThreadSectionSend(blockId);
        if (!sendRequest) {
          toast.danger("Could not resolve content to send.", {
            id: "nfm-thread-section",
          });
          return;
        }

        if (
          sendRequest.prompt.length === 0 &&
          (sendRequest.promptInput.images?.length ?? 0) === 0
        ) {
          toast.info("This thread section is empty.", {
            id: "nfm-thread-section",
          });
          return;
        }

        setThreadSectionPicker({
          request: sendRequest,
          anchorRect: anchorElement.getBoundingClientRect(),
          preferredTarget: resolveThreadSectionPreferredThread(sendRequest),
        });
      })();

      return true;
    },
    [
      editor,
      executionProjectId,
      onSendThreadSectionPrompt,
      prepareThreadSectionSend,
      resolveThreadSectionPreferredThread,
    ],
  );

  const threadSectionRuntimeValue = useMemo<ThreadSectionRuntimeValue>(
    () => ({
      threads: threadSectionThreadMap,
      pendingBlockIds: threadSectionPendingBlockIds,
      openThread: handleOpenThreadSectionThread,
      send: handleSendThreadSectionByBlockId,
      resolveScope: () => ({
        threads: threadSectionThreadMap,
      }),
    }),
    [
      handleOpenThreadSectionThread,
      handleSendThreadSectionByBlockId,
      threadSectionPendingBlockIds,
      threadSectionThreadMap,
    ],
  );

  const closePasteResourceDialog = useCallback(() => {
    setPasteResourcePending(false);
    setPasteResourceError(null);
    setPasteResourceDialog(null);
  }, []);

  useEffect(() => {
    const runtime = editor as unknown as InlineViewHostContextRuntimeEditor;
    runtime.nodexSourcePageContext = sourcePageContext && executionProjectId
      ? {
          projectId: executionProjectId,
          pageId: sourcePageContext.pageId,
        }
      : null;

    return () => {
      runtime.nodexSourcePageContext = null;
    };
  }, [editor, executionProjectId, sourcePageContext]);

  const handlePasteResourceChoice = useCallback(
    async (mode: "materialized" | "link") => {
      if (!editor || !pasteResourceDialog || pasteResourcePending) return;
      const typedTarget = hasTypedOwnerType([
        ...(pasteResourceDialog.target.selectedBlockTypes ?? []),
        pasteResourceDialog.target.currentBlockType ?? null,
      ]);
      if (typedTarget) {
        toast.info(
          "Page, Canvas, and Database blocks cannot be replaced by a resource paste.",
        );
        closePasteResourceDialog();
        return;
      }
      if (
        mode === "materialized" &&
        !canMaterializePasteResourceItems(pasteResourceDialog.items)
      ) {
        setPasteResourceError("Folders can only be kept as links.");
        return;
      }

      try {
        setPasteResourcePending(true);
        setPasteResourceError(null);

        const nextAttachments: PasteAttachmentInlineContent[] = [];

        for (const item of pasteResourceDialog.items) {
          if (item.kind === "text") {
            const text = pasteResourceDialog.textPayload ?? "";
            const uploaded = await uploadResourceAsset(
              createPastedTextUploadFile(text),
            );
            nextAttachments.push({
              type: "attachment",
              props: {
                kind: "text",
                mode,
                source: uploaded.source,
                name: derivePastedTextAttachmentName(text),
                mimeType: uploaded.mimeType,
                bytes: uploaded.bytes,
              },
            });
            continue;
          }

          if (mode === "link" && item.path) {
            nextAttachments.push({
              type: "attachment",
              props: {
                kind: item.kind,
                mode: "link",
                source: item.path,
                name: item.name,
                ...(item.mimeType ? { mimeType: item.mimeType } : {}),
                ...(item.kind === "file" && typeof item.bytes === "number"
                  ? { bytes: item.bytes }
                  : {}),
              },
            });
            continue;
          }

          if (item.path) {
            const uploaded = await materializeLocalResourceAsset(item.path);
            nextAttachments.push({
              type: "attachment",
              props: {
                kind: item.kind,
                mode: "materialized",
                source: uploaded.source,
                name: uploaded.name,
                mimeType: uploaded.mimeType,
                bytes: uploaded.bytes,
                origin: item.path,
              },
            });
            continue;
          }

          if (item.file) {
            const uploaded = await uploadResourceAsset(item.file);
            nextAttachments.push({
              type: "attachment",
              props: {
                kind: item.kind,
                mode: "materialized",
                source: uploaded.source,
                name: uploaded.name,
                mimeType: uploaded.mimeType,
                bytes: uploaded.bytes,
              },
            });
          }
        }

        if (nextAttachments.length === 0) {
          throw new Error("No pasted attachment could be created.");
        }

        const inserted = insertAttachmentsAtPasteTarget(
          editor,
          pasteResourceDialog.target,
          nextAttachments,
        );
        if (!inserted) {
          throw new Error(
            "Could not insert the attachment at the current cursor position.",
          );
        }

        closePasteResourceDialog();
      } catch (error) {
        console.error("Failed to insert pasted attachments", error);
        setPasteResourceError(
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Failed to insert the pasted attachment.",
        );
      } finally {
        setPasteResourcePending(false);
      }
    },
    [
      closePasteResourceDialog,
      editor,
      pasteResourceDialog,
      pasteResourcePending,
    ],
  );

  const handleContinuePasteInline = useCallback(() => {
    if (!editor || !pasteResourceDialog?.textPayload || pasteResourcePending)
      return;
    if (hasTypedOwnerType([
      ...(pasteResourceDialog.target.selectedBlockTypes ?? []),
      pasteResourceDialog.target.currentBlockType ?? null,
    ])) {
      toast.info(
        "Page, Canvas, and Database blocks cannot be replaced by paste.",
      );
      closePasteResourceDialog();
      return;
    }

    editor.focus();
    const continued = continueInlinePaste(editor, pasteResourceDialog);
    if (!continued) {
      editor.insertInlineContent(pasteResourceDialog.textPayload, {
        updateSelection: true,
      });
    }
    closePasteResourceDialog();
  }, [
    closePasteResourceDialog,
    editor,
    pasteResourceDialog,
    pasteResourcePending,
  ]);

  // Handle content changes from the editor
  const handleChange = useCallback(() => {
    if (!editor) return;
    source.onDocumentChange?.();
  }, [editor, source]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !editor) return;

    const handlePasteCapture = (event: ClipboardEvent) => {
      if (!event.clipboardData || pasteResourceDialog) return;

      const clipboardTypes = Array.from(event.clipboardData.types);
      if (
        clipboardTypes.includes(NOTION_BLOCKS_MIME) ||
        clipboardTypes.includes(NOTION_MULTI_TEXT_MIME)
      ) {
        return;
      }

      const currentBlock = editor.getTextCursorPosition().block;
      const pagePasteIntent = resolvePageDeepLinkPasteIntent({
        plainText: event.clipboardData.getData("text/plain"),
        hasStructuredClipboard: clipboardTypes.some((type) =>
          ["text/html", "text/markdown", "blocknote/html"].includes(type),
        ),
        hasFiles: (event.clipboardData.files?.length ?? 0) > 0,
        hasTextSelection: editor.getSelectedText().length > 0,
        currentBlockType: currentBlock.type,
        currentBlockIsEmpty:
          Array.isArray(currentBlock.content) && currentBlock.content.length === 0,
      });
      if (pagePasteIntent) {
        event.preventDefault();
        event.stopPropagation();
        if (pagePasteIntent.kind === "link") {
          editor.createLink(pagePasteIntent.href);
          return;
        }
        if (pagePasteIntent.kind === "mention") {
          editor.insertInlineContent(
            [
              {
                type: "pageMention",
                props: { targetPageId: pagePasteIntent.pageId },
              },
              " ",
            ],
            { updateSelection: true },
          );
          return;
        }
        editor.updateBlock(currentBlock, {
          type: "pageRef",
          props: { targetBlockId: pagePasteIntent.pageId },
        });
        return;
      }

      const plainText = event.clipboardData.getData("text/plain");
      const clipboardFiles = Array.from(event.clipboardData.files ?? []);
      const nonImageFiles = clipboardFiles.filter(
        (file) => !file.type.startsWith("image/"),
      );
      const inspectedItems = window.api?.inspectPasteClipboard?.().items ?? [];
      const shouldPromptFiles =
        inspectedItems.length > 0 || nonImageFiles.length > 0;
      const shouldPromptText =
        !shouldPromptFiles &&
        shouldPromptForOversizedText(
          plainText,
          serializeEditorToNfm().length,
          pasteResourceSettings,
        );

      if (!shouldPromptFiles && !shouldPromptText) return;

      event.preventDefault();
      event.stopPropagation();

      const target = capturePasteResourceTarget(editor);

      if (inspectedItems.length > 0) {
        setPasteResourceDialog({
          target,
          items: inspectedItems.map((item) => ({
            kind: item.kind,
            name: item.name,
            path: item.path,
            mimeType: item.mimeType,
            bytes: item.bytes,
          })),
          allowLink: inspectedItems.every((item) => item.path.length > 0),
        });
        return;
      }

      if (nonImageFiles.length > 0) {
        const fileDraftItems = normalizeClipboardFileDraftItems(nonImageFiles);
        setPasteResourceDialog({
          target,
          items: fileDraftItems,
          allowLink: fileDraftItems.every((item) => Boolean(item.path)),
        });
        return;
      }

      if (shouldPromptText) {
        setPasteResourceDialog({
          target,
          items: [{ kind: "text", name: "Pasted text" }],
          textPayload: plainText,
          htmlPayload: event.clipboardData.getData("text/html") || undefined,
          markdownPayload:
            event.clipboardData.getData("text/markdown") || undefined,
          blocknoteHtmlPayload:
            event.clipboardData.getData("blocknote/html") || undefined,
          allowLink: false,
        });
      }
    };

    container.addEventListener("paste", handlePasteCapture, true);
    return () => {
      container.removeEventListener("paste", handlePasteCapture, true);
    };
  }, [
    editor,
    pasteResourceDialog,
    pasteResourceSettings,
    serializeEditorToNfm,
  ]);

  useEffect(() => {
    if (!editor) return;
    setNfmSearchQuery(editor, searchQuery);
    syncSearchStats();
  }, [editor, searchQuery, syncSearchStats]);

  useEffect(() => {
    if (!editor) return;
    const unsubscribeChange = editor.onChange(() => {
      syncSearchStats();
    });
    const unsubscribeSelection = editor.onSelectionChange(() => {
      syncSearchStats();
    });
    return () => {
      unsubscribeChange();
      unsubscribeSelection();
    };
  }, [editor, syncSearchStats]);

  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!surfaceMutationBarrier) return;
    return registerBlockDocumentMutationBarrier(
      source.clientSessionId,
      surfaceMutationBarrier,
    );
  }, [source.clientSessionId, surfaceMutationBarrier]);

  useEffect(() => {
    if (
      !sourcePageContext
      || !isCanvasHostDocumentRuntime(surfaceMutationBarrier)
    ) {
      return;
    }
    return registerCanvasHostDocumentRuntime(
      source.clientSessionId,
      surfaceMutationBarrier,
    );
  }, [
    source.clientSessionId,
    sourcePageContext,
    surfaceMutationBarrier,
  ]);

  useImperativeHandle(
    navigationRef ?? embeddedBoundary?.navigationRef,
    () => ({
      focus: () => {
        if (!editor.domElement) return false;
        editor.focus();
        return true;
      },
      focusBlock: (blockId) => {
        if (!editor.getBlock(blockId)) return false;
        try {
          editor.setTextCursorPosition(blockId, "start");
          const cssEscape = globalThis.CSS?.escape
            ?? ((value: string) => value.replace(/["\\]/g, "\\$&"));
          editor.prosemirrorView?.dom
            .querySelector<HTMLElement>(`.bn-block[data-id="${cssEscape(blockId)}"]`)
            ?.scrollIntoView({ block: "center" });
          editor.focus();
          return true;
        } catch {
          return false;
        }
      },
      focusBoundary: (direction) =>
        focusEmbeddedEditorBoundary(
          editor as unknown as EmbeddedSurfaceHostEditor,
          direction,
        ),
    }),
    [editor],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof Element) {
        if (event.target.closest("[data-embedded-surface-input]")) return;
        const nearestEditor = event.target.closest(".nfm-editor");
        if (nearestEditor && nearestEditor !== el) {
          return;
        }
      }

      const targetIsTextField =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement;

      if (
        !targetIsTextField
        && !event.altKey
        && !event.ctrlKey
        && !event.metaKey
        && !event.shiftKey
        && !event.isComposing
        && (event.key === "Backspace" || event.key === "Delete")
      ) {
        const selectedBlocks = editor.getSelection()?.blocks ?? [];
        const hasTypedOwner = hasTypedOwnerBlock(selectedBlocks);
        if (hasTypedOwner) {
          event.preventDefault();
          event.stopPropagation();
          typedOwnerDeleteRef.current(editor);
          return;
        }
      }

      if (
        !targetIsTextField &&
        event.key === "Tab" &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        shouldSuppressPreferIndentBoundaryTab(
          editor,
          event.target,
          event.shiftKey,
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (
        !targetIsTextField &&
        !event.altKey &&
        !event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.isComposing
      ) {
        if (isSpaceShortcut(event)) {
          const focusedImage = resolveFocusedImagePreview(
            editor as unknown as ImageSelectionEditor,
          );
          if (focusedImage) {
            event.preventDefault();
            event.stopPropagation();
            if (!event.repeat) {
              setImagePreview({
                source: resolveAssetSourceToDisplayUrl(focusedImage.source),
                alt: focusedImage.alt,
              });
            }
            return;
          }
        }

        if (
          (event.key === "ArrowUp" || event.key === "ArrowDown")
          && handleArrowIntoEmbeddedSurface(
            editor as unknown as EmbeddedSurfaceHostEditor,
            event.key === "ArrowUp" ? "up" : "down",
          )
        ) {
          event.preventDefault();
          return;
        }

        const verticalDirection = event.key === "ArrowUp"
          ? "up"
          : event.key === "ArrowDown"
            ? "down"
            : null;
        if (
          verticalDirection
          && embeddedBoundary
          && isEditorAtVisibleBoundary(
            editor as unknown as EmbeddedSurfaceHostEditor,
            verticalDirection,
          )
          && embeddedBoundary.onBoundaryArrow(verticalDirection)
        ) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        if (
          event.key === "ArrowUp" &&
          deferCollapsedToggleVerticalArrowToBrowser(editor, el, "prev", event)
        ) {
          return;
        }

        if (
          event.key === "ArrowDown" &&
          deferCollapsedToggleVerticalArrowToBrowser(editor, el, "next", event)
        ) {
          return;
        }
      }

      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const modifier = isMac ? event.metaKey : event.ctrlKey;
      const key = event.key.toLowerCase();

      if (!modifier) return;

      if (key === "enter" && !targetIsTextField) {
        const handled =
          !event.altKey &&
          !event.shiftKey &&
          handleNfmEditorModEnterShortcut(
            editor as unknown as ModifyShortcutEditor,
            {
              openImagePreview: (preview) => {
                setImagePreview({
                  source: resolveAssetSourceToDisplayUrl(preview.source),
                  alt: preview.alt,
                });
              },
              openThread: onOpenCodexThread
                ? handleOpenThreadSectionThread
                : undefined,
              sendThreadSectionByBlockId: handleSendThreadSectionByBlockId,
              showMissingThreadSectionHint: () => {
                toast.info(
                  "Insert /thread section to send notebook-style prompts.",
                  {
                    id: "nfm-thread-section",
                  },
                );
              },
            },
          );
        if (handled) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }

      if (key === "f") {
        event.preventDefault();
        if (!targetIsTextField) {
          const seedQuery = resolveFindShortcutSeedQuery(editor);
          if (seedQuery.length > 0) {
            setSearchQuery(seedQuery);
          }
        }
        openSearch();
        return;
      }

      if (!searchOpen) return;

      if (key === "g") {
        event.preventDefault();
        navigateSearch(event.shiftKey ? "prev" : "next");
        return;
      }

      if (
        key === "enter" &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement)
      ) {
        event.preventDefault();
        navigateSearch("next");
      }
    };

    el.addEventListener("keydown", handleKeyDown, true);
    return () => el.removeEventListener("keydown", handleKeyDown, true);
  }, [
    editor,
    embeddedBoundary,
    handleSendThreadSectionByBlockId,
    handleOpenThreadSectionThread,
    navigateSearch,
    onOpenCodexThread,
    openSearch,
    searchOpen,
  ]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleDoubleClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;

      const nearestEditor = event.target.closest(".nfm-editor");
      if (nearestEditor && nearestEditor !== el) {
        return;
      }

      const imageContent = event.target.closest<HTMLElement>(
        "[data-content-type='image']",
      );
      if (!imageContent || !el.contains(imageContent)) return;

      const blockOuter = imageContent.closest<HTMLElement>(
        "[data-node-type='blockOuter'][data-id]",
      );
      const clickedImage = blockOuter?.dataset.id
        ? resolveImagePreviewByBlockId(
            editor as unknown as ImageBlockLookupEditor,
            blockOuter.dataset.id,
          )
        : null;
      const focusedImage = resolveFocusedImagePreview(
        editor as unknown as ImageSelectionEditor,
      );
      const preview = clickedImage ?? focusedImage;
      if (!preview) return;

      event.preventDefault();
      event.stopPropagation();
      setImagePreview({
        source: resolveAssetSourceToDisplayUrl(preview.source),
        alt: preview.alt,
      });
    };

    el.addEventListener("dblclick", handleDoubleClick, true);
    return () => {
      el.removeEventListener("dblclick", handleDoubleClick, true);
    };
  }, [editor]);

  const handleConvertDividerToThreadSection = useCallback(
    (blockId: string) => {
      const block = editor.getBlock(blockId);
      if (!block || block.type !== "divider") return;

      editor.updateBlock(block, createEmptyThreadSectionBlock());
      restoreEditorFocus();
    },
    [editor, restoreEditorFocus],
  );

  const resolveSendBlocksSelection = useCallback(
    (fallbackBlockId: string): SendBlocksSelection | null => {
      if (!sourcePageContext) return null;

      const container = containerRef.current;
      if (!container) return null;

      const dropEditor = editor as unknown as EditorForExternalBlockDrop;
      const selection = resolveSendBlockSelection(
        dropEditor,
        container,
        fallbackBlockId,
      );
      if (selection.blockIds.length === 0) return null;

      return {
        blockIds: selection.blockIds,
        blocks: selection.blocks,
      };
    },
    [editor, sourcePageContext],
  );

  const commitBlockSelectionMove = useCallback(
    async (
      selection: SendBlocksSelection,
      destination: NfmMoveToDestination,
    ) => {
      if (!sourcePageContext) {
        throw new Error("No blocks selected.");
      }
      if (executionProjectId === null) {
        throw new Error("Moving Blocks requires a Project.");
      }
      if (!surfaceMutationBarrier) {
        throw new Error(
          "The collaborative Page surface changed; reopen it before moving Blocks.",
        );
      }
      const container = containerRef.current;
      if (!container) {
        throw new Error("The Page editor is not ready for a Block move.");
      }
      await prepareNfmEditorForMutation(
        editor as unknown as NfmEditorMutationRuntime,
        container,
      );
      const sourceHead = await surfaceMutationBarrier.flushAndFence();

      await moveNfmBlocks({
        projectId: executionProjectId,
        storeEpoch: source.storeEpoch,
        sourcePageId: sourcePageContext.pageId,
        sourceDocumentId: source.documentId,
        sourceDocumentGeneration: source.generation,
        rootBlockIds: selection.blockIds,
        sourceHead,
        destination,
      });
    },
    [
      editor,
      executionProjectId,
      source,
      sourcePageContext,
      surfaceMutationBarrier,
    ],
  );

  const moveBlocksToDestination = useCallback(
    async (destination: NfmMoveToDestination, fallbackBlockId: string) => {
      const selection = resolveSendBlocksSelection(fallbackBlockId);
      if (!selection) {
        throw new Error("No blocks selected.");
      }

      const selectedCanvasBlocks = selection.blocks.filter(
        (block) => block.type === "canvas",
      );
      const selectedPageBlocks = selection.blocks.filter(
        (block) => block.type === "page",
      );
      const selectedDatabaseBlocks = selection.blocks.filter(
        (block) => block.type === "database",
      );
      if (selectedDatabaseBlocks.length > 0) {
        throw new Error(
          "Database blocks must be moved through a typed Database action.",
        );
      }
      if (hasNestedTypedOwnerBlock(selection.blocks)) {
        throw new Error(
          "A Block containing a Page, Canvas, or Database must be moved through a typed action.",
        );
      }
      if (
        selectedPageBlocks.length > 0
        && selectedPageBlocks.length !== selection.blocks.length
      ) {
        throw new Error(
          "Move Page blocks separately from ordinary Blocks.",
        );
      }
      if (selectedCanvasBlocks.length > 0) {
        if (
          selectedCanvasBlocks.length !== 1
          || selection.blocks.length !== 1
        ) {
          throw new Error("Move one Canvas at a time.");
        }
        if (destination.kind !== "page") {
          throw new Error("Canvas can only move to another Page.");
        }
        if (
          !sourcePageContext
          || destination.projectId !== executionProjectId
          || destination.pageId === sourcePageContext.pageId
        ) {
          throw new Error("Choose another Page in this Project.");
        }
        if (!isCanvasHostDocumentRuntime(surfaceMutationBarrier)) {
          throw new Error(
            "The Page Document is not ready to move this Canvas.",
          );
        }
        const target = await prepareOwnedBlockDocument(
          destination.projectId,
          destination.pageId,
        );
        if (!target.ok) throw new Error(target.error.message);
        await moveCanvasOwnerToPage({
          accessContext: contentAccessContext,
          canvasBlockId: selectedCanvasBlocks[0]!.id,
          targetPageId: destination.pageId,
          targetDocumentGeneration: target.value.generation,
          targetDocumentHeadSeq: target.value.headSeq,
          insertion: { kind: "append" },
          sourceRuntime: surfaceMutationBarrier,
        });
        restoreEditorFocus();
        return;
      }

      await commitBlockSelectionMove(selection, destination);

      restoreEditorFocus();
    },
    [
      commitBlockSelectionMove,
      contentAccessContext,
      resolveSendBlocksSelection,
      restoreEditorFocus,
      executionProjectId,
      sourcePageContext,
      surfaceMutationBarrier,
    ],
  );

  const sendBlocksToThread = useCallback(
    async (request: NfmSendToThreadRequest, fallbackBlockId: string) => {
      if (!sourcePageContext) {
        throw new Error("No blocks selected.");
      }
      if (executionProjectId === null) {
        throw new Error("Sending Blocks to a chat requires a Project.");
      }

      const selection = resolveSendBlocksSelection(fallbackBlockId);
      if (!selection) {
        throw new Error("No blocks selected.");
      }
      if (
        request.mode === "wrap-toggle"
        && hasTypedOwnerBlock(selection.blocks)
      ) {
        toast.info(
          "Page, Canvas, and Database blocks cannot be wrapped into a thread toggle.",
        );
        return;
      }

      const promptInput = buildCodexPromptInputFromBlockNoteBlocks(
        selection.blocks,
        (nfmBlocks) => {
          if (!containerRef.current) return;
          applyToggleStatesFromDom(
            selection.blocks,
            nfmBlocks,
            containerRef.current,
          );
        },
      );
      const hasImages = (promptInput.images?.length ?? 0) > 0;
      if (promptInput.text.length === 0 && !hasImages) {
        toast.info("Selected blocks are empty.", {
          id: "nfm-send-to-thread",
        });
        return;
      }

      let threadId: string;
      if (request.target.kind === "thread") {
        threadId = request.target.threadId;
      } else {
        if (!onStartNewSessionThreadFromEditor) {
          throw new Error("New chat creation is not available.");
        }
        threadId = (
          await onStartNewSessionThreadFromEditor({
            projectId: executionProjectId,
            targetSessionId: request.target.sessionId,
            prompt: promptInput.text,
            promptInput,
          })
        ).threadId;
      }

      if (request.target.kind === "thread") {
        await codexManager.startTurn(threadId, promptInput.text, {
          permissionMode: codexPermissionState.mode,
          promptInput,
        });
      }

      if (request.mode === "wrap-toggle") {
        const dropEditor = editor as unknown as EditorForExternalBlockDrop;
        const toggleBlock = createSendToThreadToggleBlock({
          threadId,
          children: selection.blocks,
        });

        const toggleStorageKey = `toggle-${toggleBlock.id}`;
        localStorage.setItem(toggleStorageKey, "false");
        try {
          runInEditorTransaction(dropEditor, () => {
            dropEditor.replaceBlocks(selection.blockIds, [toggleBlock]);
          });
        } catch (error) {
          localStorage.removeItem(toggleStorageKey);
          throw error;
        }
      }

      toast.success(
        request.target.kind === "thread" ? "Sent to chat" : "Sent to new chat",
        {
          id: "nfm-send-to-thread",
        },
      );
      restoreEditorFocus();
    },
    [
      codexManager,
      codexPermissionState.mode,
      editor,
      executionProjectId,
      onStartNewSessionThreadFromEditor,
      resolveSendBlocksSelection,
      restoreEditorFocus,
      sourcePageContext,
    ],
  );

  const crossSurfaceDrag = useMemo(() => {
    if (executionProjectId === null) return undefined;
    return {
      surfaceId: source.clientSessionId,
      projectId: executionProjectId,
      documentId: source.documentId,
      storeEpoch: source.storeEpoch,
      blockTransferDrop: {
        surfaceId: source.clientSessionId,
        projectId: executionProjectId,
        documentId: source.documentId,
        storeEpoch: source.storeEpoch,
        ...(sourcePageContext?.pageId
          ? { hostPageId: sourcePageContext.pageId }
          : {}),
        ancestorPageIds: parentBlockReferenceRuntime?.ancestorPageIds ?? [],
        ...(surfaceMutationBarrier
          ? { flushAndFence: surfaceMutationBarrier.flushAndFence }
          : {}),
        flushSourceAndFence: async (sourceSurfaceId: string) => {
          if (sourceSurfaceId === source.clientSessionId) return;
          return await resolveBlockDocumentMutationBarrier(sourceSurfaceId)
            ?.flushAndFence();
        },
        createOperationId: () => crypto.randomUUID(),
        transfer: (intent: Parameters<typeof transferBlocks>[1]) =>
          transferBlocks(executionProjectId, intent),
        ...(sourcePageContext && isCanvasHostDocumentRuntime(surfaceMutationBarrier)
          ? {
              transferCanvas: async ({
                canvasBlockId,
                sourceSurfaceId,
                targetPageId,
                mode,
                insertion,
              }: {
                readonly canvasBlockId: string;
                readonly sourceSurfaceId: string;
                readonly sourcePageId: string;
                readonly targetPageId: string;
                readonly mode: "move" | "copy";
                readonly insertion: Parameters<
                  typeof duplicateCanvasInHostPage
                >[0]["insertion"];
              }) => {
                if (mode === "copy") {
                  await duplicateCanvasInHostPage({
                    accessContext: contentAccessContext,
                    sourceCanvasBlockId: canvasBlockId,
                    hostPageId: targetPageId,
                    insertion,
                    runtime: surfaceMutationBarrier,
                  });
                  return;
                }
                const sourceRuntime = resolveCanvasHostDocumentRuntime(
                  sourceSurfaceId,
                );
                if (!sourceRuntime) {
                  throw new Error(
                    "The source Page is no longer ready to move this Canvas.",
                  );
                }
                await moveCanvasOwnerBetweenHostPages({
                  accessContext: contentAccessContext,
                  canvasBlockId,
                  targetPageId,
                  insertion,
                  sourceRuntime,
                    targetRuntime: surfaceMutationBarrier,
                });
              },
            }
          : {}),
        reportError: (message: string) => toast.danger(message),
      },
    };
  }, [
    parentBlockReferenceRuntime?.ancestorPageIds,
    contentAccessContext,
    executionProjectId,
    source.documentId,
    source.clientSessionId,
    source.storeEpoch,
    sourcePageContext,
    surfaceMutationBarrier,
  ]);

  useEditorDragBehaviors({
    editor,
    containerRef,
    crossSurface: crossSurfaceDrag,
  });
  const sideMenuSelectionGuardActive = useSideMenuSelectionGuard(containerRef);
  const sideMenuFloatingOptions = useMemo(
    () =>
      getSideMenuSelectionGuardFloatingOptions(sideMenuSelectionGuardActive),
    [sideMenuSelectionGuardActive],
  );

  // The side-menu component identity must stay stable across NfmEditor renders.
  // BlockNote renders the side menu as `<Component/>` where Component is this
  // value; if its identity changes, React remounts the whole side-menu (and its
  // native drag-handle) subtree. Because the editor can re-render at a high
  // frequency, an unstable side-menu identity remounts the grip mid-gesture and
  // aborts native block drag-and-drop. Route volatile values through a ref so
  // the callback identity below never changes.
  const blockActionCapabilities = resolveNfmEditorBlockActionCapabilities(
    sourcePageContext !== undefined,
    executionProjectId,
  );
  const handleBlockDragStart = useCallback(
    ({
      dataTransfer,
      blockIds,
    }: {
      dataTransfer: DataTransfer;
      blockIds: readonly string[];
    }) => {
      if (executionProjectId === null) return;
      const roots = resolveTopLevelDraggedBlocks(editor, [...blockIds]);
      if (roots.length === 0) return;
      beginLocalBlockDragSession(
        {
          sourceSurfaceId: source.clientSessionId,
          projectId: executionProjectId,
          storeEpoch: source.storeEpoch,
          source: sourcePageContext
            ? { kind: "page", pageId: sourcePageContext.pageId }
            : { kind: "document", documentId: source.documentId },
          rootBlockIds: roots.map((block) => block.id),
          displayHints: roots.map((block) => block.type),
          taskShorthandPreviewHints: roots.flatMap((block) => {
            const content = (block as { readonly content?: unknown }).content;
            if (!Array.isArray(content)) return [];
            const text = content.every((item) =>
              typeof item === "object"
              && item !== null
              && (item as { readonly type?: unknown }).type === "text"
              && typeof (item as { readonly text?: unknown }).text === "string"
            )
              ? content.map((item) => (item as { readonly text: string }).text).join("")
              : null;
            if (text === null) return [];
            const preview = previewTaskShorthand(text);
            return preview
              ? [{
                  rootBlockId: block.id,
                  priority: preview.priority,
                  estimate: preview.estimate,
                  tagCount: preview.tags.length,
                }]
              : [];
          }),
        },
        dataTransfer,
      );
    },
    [editor, executionProjectId, source, sourcePageContext],
  );
  const handleBlockDragEnd = useCallback(
    () =>
      endLocalBlockDragSession({ sourceSurfaceId: source.clientSessionId }),
    [source.clientSessionId],
  );
  const sideMenuHandlersRef = useRef({
    canSendBlocks: blockActionCapabilities.canMoveBlocks,
    hasConvertDividerToThreadSection: true,
    sourceProjectId: sourcePageContext ? executionProjectId : null,
    sourcePageId: sourcePageContext?.pageId ?? null,
    onMoveBlocksToDestination: moveBlocksToDestination,
    onConvertDividerToThreadSection: handleConvertDividerToThreadSection,
    onBlockDragStart: handleBlockDragStart,
    onBlockDragEnd: handleBlockDragEnd,
    onDuplicateCanvas: (canvasBlockId: string) =>
      canvasCommandHandlersRef.current.duplicate(canvasBlockId),
    onDeleteCanvas: (canvasBlockId: string) =>
      canvasCommandHandlersRef.current.delete(canvasBlockId),
    onDeletePage: (pageBlockId: string) =>
      pageCommandHandlersRef.current.delete(pageBlockId),
  });
  sideMenuHandlersRef.current = {
    canSendBlocks: blockActionCapabilities.canMoveBlocks,
    hasConvertDividerToThreadSection: true,
    sourceProjectId: sourcePageContext ? executionProjectId : null,
    sourcePageId: sourcePageContext?.pageId ?? null,
    onMoveBlocksToDestination: moveBlocksToDestination,
    onConvertDividerToThreadSection: handleConvertDividerToThreadSection,
    onBlockDragStart: handleBlockDragStart,
    onBlockDragEnd: handleBlockDragEnd,
    onDuplicateCanvas: (canvasBlockId: string) =>
      canvasCommandHandlersRef.current.duplicate(canvasBlockId),
    onDeleteCanvas: (canvasBlockId: string) =>
      canvasCommandHandlersRef.current.delete(canvasBlockId),
    onDeletePage: (pageBlockId: string) =>
      pageCommandHandlersRef.current.delete(pageBlockId),
  };

  const sideMenuRuntimeValue = useMemo(
    () => ({
      getSnapshot: () => sideMenuHandlersRef.current,
    }),
    [],
  );

  const customSideMenu = useCallback(() => <NfmSideMenu />, []);

  const textActionMenuRuntimeValue = useMemo(
    () => ({
      canSendBlocks: blockActionCapabilities.canSendBlocksToThread,
      sourceProjectId: sourcePageContext ? executionProjectId : null,
      sourcePageId: sourcePageContext?.pageId ?? null,
      sendToThreadProjectNameById,
      sendToThreadPreferredTarget: sessionSendToThreadPreferredTarget,
      ...(blockActionCapabilities.canMoveBlocks
        ? { onMoveBlocksToDestination: moveBlocksToDestination }
        : {}),
      onSendBlocksToThread: sendBlocksToThread,
      onSendThreadSection: handleSendThreadSectionByBlockId,
      onConvertDividerToThreadSection: handleConvertDividerToThreadSection,
    }),
    [
      handleConvertDividerToThreadSection,
      handleSendThreadSectionByBlockId,
      blockActionCapabilities.canMoveBlocks,
      blockActionCapabilities.canSendBlocksToThread,
      moveBlocksToDestination,
      executionProjectId,
      sendToThreadProjectNameById,
      sendBlocksToThread,
      sessionSendToThreadPreferredTarget,
      sourcePageContext,
    ],
  );

  const openThreadMention = useCallback(
    (threadId: string) => {
      if (!onOpenCodexThread) return;
      void onOpenCodexThread(threadId);
    },
    [onOpenCodexThread],
  );

  const createCanvasAtEmptyParagraph = useCallback(
    async ({
      blockId,
      displayName,
    }: {
      readonly blockId: string;
      readonly displayName?: string;
    }) => {
      if (!sourcePageContext) {
        throw new Error("Canvas can only be added inside a Page.");
      }
      if (!isCanvasHostDocumentRuntime(surfaceMutationBarrier)) {
        throw new Error(
          "The Page Document is not ready to create a Canvas.",
        );
      }
      return createCanvasInHostPage({
        accessContext: contentAccessContext,
        hostPageId: sourcePageContext.pageId,
        replacementBlockId: blockId,
        displayName,
        runtime: surfaceMutationBarrier,
      });
    },
    [contentAccessContext, sourcePageContext, surfaceMutationBarrier],
  );

  const createSubpageAtEmptyParagraph = useCallback(
    async ({ blockId, title }: { readonly blockId: string; readonly title: string }) => {
      if (!sourcePageContext) {
        throw new Error("A Subpage can only be created inside a Page.");
      }
      if (!surfaceMutationBarrier) {
        throw new Error("The Page Document is not ready to create a Subpage.");
      }
      const container = containerRef.current;
      if (!container) {
        throw new Error("The Page editor is not ready to create a Subpage.");
      }
      await prepareNfmEditorForMutation(
        editor as unknown as NfmEditorMutationRuntime,
        container,
      );
      const hostHead = await surfaceMutationBarrier.flushAndFence();
      if (
        hostHead.storeEpoch !== source.storeEpoch
        || hostHead.documentId !== source.documentId
        || hostHead.generation !== source.generation
      ) {
        throw new Error(
          "The host Page changed; reopen it before creating the Subpage.",
        );
      }
      const pageId = createUuidV7();
      const result = await applyLibraryModule(contentAccessContext, {
        version: LIBRARY_MODULE_CONTRACT_VERSION,
        operationId: createUuidV7(),
        storeEpoch: source.storeEpoch,
        operation: {
          kind: "create_page",
          pageId,
          documentId: createUuidV7(),
          title: title.trim() || "Untitled",
          parent: {
            kind: "page",
            pageId: sourcePageContext.pageId,
            expectedDocumentGeneration: hostHead.generation,
            expectedDocumentHeadSeq: hostHead.expectedHeadSeq,
            insertion: { kind: "replace_empty_paragraph", blockId },
          },
        },
      });
      if (!result.ok) throw new Error(result.error.message);
      if (
        result.value.createdTarget?.kind !== "page"
        || result.value.createdTarget.pageId !== pageId
      ) {
        throw new Error("Core did not return the created Subpage.");
      }
      return { pageId };
    },
    [
      contentAccessContext,
      editor,
      source.documentId,
      source.generation,
      source.storeEpoch,
      sourcePageContext,
      surfaceMutationBarrier,
    ],
  );

  const handleEditorClickCapture = useCallback((event: ReactMouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest("a");
    if (!(anchor instanceof HTMLAnchorElement)) return;
    const href = readNfmLinkHrefAtElement(editor, anchor);
    const action = resolveNfmLinkAction(href);
    if (action?.kind !== "page") return;
    event.preventDefault();
    event.stopPropagation();
    if (!onOpenPage) return;
    void onOpenPage({
      accessContext: contentAccessContext,
      pageId: action.pageId,
    });
  }, [contentAccessContext, editor, onOpenPage]);

  const requireCanvasHostRuntime = useCallback(() => {
    if (!sourcePageContext) {
      throw new Error("Canvas can only be changed inside a Page.");
    }
    if (!isCanvasHostDocumentRuntime(surfaceMutationBarrier)) {
      throw new Error("The Page Document is not ready for a Canvas change.");
    }
    return {
      hostPageId: sourcePageContext.pageId,
      runtime: surfaceMutationBarrier,
    };
  }, [sourcePageContext, surfaceMutationBarrier]);

  const duplicateCanvasAfter = useCallback(
    async (canvasBlockId: string) => {
      const host = requireCanvasHostRuntime();
      const canvasBlock = editor.getBlock(canvasBlockId);
      if (!canvasBlock || canvasBlock.type !== "canvas") {
        throw new Error("Canvas Block is no longer in this Page.");
      }
      const parent = editor.getParentBlock(canvasBlockId);
      const siblingBlockIds = (parent?.children ?? editor.document)
        .map((block) => block.id);
      await duplicateCanvasInHostPage({
        accessContext: contentAccessContext,
        sourceCanvasBlockId: canvasBlockId,
        hostPageId: host.hostPageId,
        insertion: resolveCanvasInsertionAfterBlock({
          blockId: canvasBlockId,
          ...(parent ? { parentBlockId: parent.id } : {}),
          siblingBlockIds,
        }),
        runtime: host.runtime,
      });
    },
    [contentAccessContext, editor, requireCanvasHostRuntime],
  );

  const deletePage = useCallback(
    async (pageBlockId: string) => {
      if (!sourcePageContext || executionProjectId === null) {
        throw new Error("A nested Page can only be deleted inside a Page.");
      }
      if (!surfaceMutationBarrier) {
        throw new Error(
          "The host Page Document is not ready for a Page deletion.",
        );
      }
      const container = containerRef.current;
      if (!container) {
        throw new Error("The host Page editor is not ready for a Page deletion.");
      }
      await prepareNfmEditorForMutation(
        editor as unknown as NfmEditorMutationRuntime,
        container,
      );
      const hostHead = await surfaceMutationBarrier.flushAndFence();
      if (
        hostHead.storeEpoch !== source.storeEpoch
        || hostHead.documentId !== source.documentId
        || hostHead.generation !== source.generation
      ) {
        throw new Error(
          "The host Page Document changed; reopen it before deleting the nested Page.",
        );
      }
      const committed = await commitPageLifecycleIntent({
        kind: "delete",
        projectId: executionProjectId,
        operationId: crypto.randomUUID(),
        clientSessionId: source.clientSessionId,
        pageId: pageBlockId,
        parentDocumentHead: {
          documentId: hostHead.documentId,
          generation: hostHead.generation,
          expectedHeadSeq: hostHead.expectedHeadSeq,
        },
      });
      if (committed.receipt.lifecycle !== "deleted") {
        throw new Error("Core did not commit the nested Page deletion.");
      }
    },
    [
      editor,
      executionProjectId,
      source,
      sourcePageContext,
      surfaceMutationBarrier,
    ],
  );

  const deleteCanvas = useCallback(
    async (canvasBlockId: string) => {
      await deleteCanvasOwner({
        accessContext: contentAccessContext,
        canvasBlockId,
        ...(isCanvasHostDocumentRuntime(surfaceMutationBarrier)
          ? { runtime: surfaceMutationBarrier }
          : {}),
      });
    },
    [contentAccessContext, surfaceMutationBarrier],
  );

  const deleteTypedOwnerSelection = useCallback(
    (
      blocks: readonly TypedOwnerSelectionBlock[],
    ): boolean => {
      const decision = resolveOwnerSelectionOperation(blocks, "delete");
      if (decision.kind === "generic") return false;
      if (decision.kind === "forbidden") {
        if (decision.reason === "nested_owner") {
          toast.info(
            "Remove the nested Page, Canvas, or Database first.",
          );
          return true;
        }
        if (decision.reason === "mixed_selection") {
          toast.info("Delete one Page, Canvas, or Database at a time.");
          return true;
        }
        toast.info(
          "This Database must be archived through its Database action.",
        );
        return true;
      }
      const { block, route } = decision;
      if (route === "page_lifecycle") {
        void pageCommandHandlersRef.current.delete(block.id);
        return true;
      }
      if (route === "canvas_lifecycle") {
        void canvasCommandHandlersRef.current.delete(block.id);
        return true;
      }
      if (route !== "database_lifecycle") {
        toast.info("Delete one Page, Canvas, or Database at a time.");
        return true;
      }
      toast.info("This Database must be archived through its Database action.");
      return true;
    },
    [],
  );

  const rejectTypedReplacement = useCallback(
    (
      blocks: readonly TypedOwnerSelectionBlock[],
    ): boolean => {
      if (!hasTypedOwnerBlock(blocks)) {
        return false;
      }
      toast.info(
        "Page, Canvas, and Database blocks cannot be replaced by paste; remove them with a typed action first.",
      );
      return true;
    },
    [],
  );
  const rejectTypedPaste = useCallback(
    (blocks: readonly TypedOwnerBlockLike[]): boolean => {
      if (!hasTypedOwnerBlock(blocks)) return false;
      toast.info(
        "Page, Canvas, and Database blocks cannot be pasted as generic blocks; use a typed action.",
      );
      return true;
    },
    [],
  );

  typedOwnerDeleteRef.current = (editorToDelete) =>
    deleteTypedOwnerSelection(editorToDelete.getSelection()?.blocks ?? []);
  typedOwnerCutRef.current = (editorToCut) => {
    const blocks = editorToCut.getSelection()?.blocks ?? [];
    if (!hasTypedOwnerBlock(blocks)) return false;
    toast.info(
      "Page, Canvas, and Database blocks cannot be cut; use Move to or a typed action.",
    );
    return true;
  };
  typedReplacementGuardRef.current = rejectTypedReplacement;
  typedPasteGuardRef.current = rejectTypedPaste;

  const renameCanvas = useCallback(
    async ({
      canvasBlockId,
      displayName,
    }: {
      readonly canvasBlockId: string;
      readonly displayName: string;
    }) => {
      await renameCanvasOwner({
        accessContext: contentAccessContext,
        canvasBlockId,
        displayName,
      });
    },
    [contentAccessContext],
  );
  canvasCommandHandlersRef.current = {
    duplicate: async (canvasBlockId) => {
      try {
        await duplicateCanvasAfter(canvasBlockId);
        toast.success("Canvas duplicated");
      } catch (error) {
        toast.danger(
          error instanceof Error ? error.message : "Could not duplicate Canvas",
        );
      }
    },
    delete: async (canvasBlockId) => {
      try {
        await deleteCanvas(canvasBlockId);
      } catch (error) {
        toast.danger(
          error instanceof Error ? error.message : "Could not delete Canvas",
        );
      }
    },
  };
  pageCommandHandlersRef.current = {
    delete: async (pageBlockId) => {
      try {
        await deletePage(pageBlockId);
      } catch (error) {
        toast.danger(
          error instanceof Error ? error.message : "Could not delete Page",
        );
      }
    },
  };

  const threadMentionRuntimeValue = useMemo<ThreadMentionRuntimeValue>(
    () => ({
      threads: threadMentionSummaryMap,
      resolvingIds: threadMentionResolvingIds,
      resolveThread: resolveThreadMention,
      ...(onOpenCodexThread ? { openThread: openThreadMention } : {}),
    }),
    [
      onOpenCodexThread,
      openThreadMention,
      resolveThreadMention,
      threadMentionResolvingIds,
      threadMentionSummaryMap,
    ],
  );

  const blockReferenceRuntimeValue = useMemo<BlockReferenceHostRuntime>(
    () => {
      const currentDocumentOwnerBlockId =
        documentOwnerBlockId ?? sourcePageContext?.pageId;
      return {
        contentAccessContext,
        projectName,
        projectWorkspacePath: projectWorkspacePath ?? null,
        hostPageId: sourcePageContext?.pageId ?? null,
        ancestorPageIds: appendInlineCardAncestor(
          parentBlockReferenceRuntime?.ancestorPageIds ?? [],
          sourcePageContext?.pageId,
        ),
        ancestorDocumentOwnerBlockIds: appendInlineDocumentOwnerAncestor(
          parentBlockReferenceRuntime?.ancestorDocumentOwnerBlockIds ?? [],
          currentDocumentOwnerBlockId,
        ),
        isActiveSurface: isActivePanelTab,
        documentSurfaceId: source.clientSessionId,
        ...(onOpenPage ? { openPage: onOpenPage } : {}),
        ...(onOpenDatabase ? { openDatabase: onOpenDatabase } : {}),
        ...(onOpenCanvas ? { openCanvas: onOpenCanvas } : {}),
        ...(sourcePageContext && isCanvasHostDocumentRuntime(surfaceMutationBarrier)
          ? {
              createCanvasAtEmptyParagraph,
              deleteCanvas,
              duplicateCanvasAfter,
              renameCanvas,
            }
          : {}),
        ...(sourcePageContext && surfaceMutationBarrier
          ? { createSubpageAtEmptyParagraph }
          : {}),
      };
    },
    [
      contentAccessContext,
      documentOwnerBlockId,
      isActivePanelTab,
      onOpenPage,
      onOpenDatabase,
      onOpenCanvas,
      projectName,
      projectWorkspacePath,
      parentBlockReferenceRuntime?.ancestorPageIds,
      parentBlockReferenceRuntime?.ancestorDocumentOwnerBlockIds,
      sourcePageContext,
      source.clientSessionId,
      surfaceMutationBarrier,
      createCanvasAtEmptyParagraph,
      createSubpageAtEmptyParagraph,
      deleteCanvas,
      duplicateCanvasAfter,
      renameCanvas,
    ],
  );

  const activeMatchLabel =
    searchMatchCount === 0
      ? "0 of 0"
      : `${Math.max(searchActiveIndex + 1, 0)} of ${searchMatchCount}`;

  return (
    <div
      ref={containerRef}
      className={cn("nfm-editor relative", className)}
      spellCheck={spellcheck}
      onClickCapture={handleEditorClickCapture}
      onFocusCapture={(event) => {
        if (!editorSession) return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        const ownsFocusedEditor = target.closest(".nfm-editor")
          === event.currentTarget
          && target.closest(".ProseMirror") !== null;
        editorSession.setShouldRestoreEditorFocus(ownsFocusedEditor);
      }}
      onBlurCapture={(event) => {
        if (!editorSession) return;
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Element)) return;
        if (!nextTarget.closest('[data-page-stage-surface="true"]')) return;
        editorSession.setShouldRestoreEditorFocus(false);
      }}
    >
      {searchOpen && (
        <div className="pointer-events-none sticky top-2 z-90 flex h-0 justify-end">
          <div className="pointer-events-auto mr-2 flex w-fit max-w-[calc(100%-16px)] flex-col self-start overflow-hidden rounded-lg border border-(--border) bg-(--card) shadow-[0_2px_8px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.32),0_0_0_1px_rgba(255,255,255,0.06)]">
            <div className="flex items-center gap-0.5 px-1 py-1 pl-2.5">
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    navigateSearch(e.shiftKey ? "prev" : "next", true);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    closeSearch();
                  }
                }}
                placeholder="Find in description"
                className="h-7 min-w-35 flex-1 border-none bg-transparent text-base/7 font-normal text-(--foreground) outline-none placeholder:text-(--foreground-tertiary)"
                aria-label="Find in description"
              />
              <span className="min-w-10.5 pr-0.5 text-right text-xs whitespace-nowrap text-(--foreground-tertiary) tabular-nums">
                {activeMatchLabel}
              </span>
              <button
                type="button"
                className="inline-flex h-6.5 w-6.5 shrink-0 cursor-pointer items-center justify-center rounded-sm border-none bg-transparent text-(--foreground-secondary) transition-background-color duration-swift ease-out hover:bg-(--background-tertiary) hover:text-(--foreground)"
                onClick={() => navigateSearch("prev", true)}
                aria-label="Previous match"
                title="Previous match (Shift+Enter)"
              >
                <ChevronUp className="size-4" />
              </button>
              <button
                type="button"
                className="inline-flex h-6.5 w-6.5 shrink-0 cursor-pointer items-center justify-center rounded-sm border-none bg-transparent text-(--foreground-secondary) transition-background-color duration-swift ease-out hover:bg-(--background-tertiary) hover:text-(--foreground)"
                onClick={() => navigateSearch("next", true)}
                aria-label="Next match"
                title="Next match (Enter)"
              >
                <ChevronDown className="size-4" />
              </button>
              <button
                type="button"
                className={cn(
                  "inline-flex h-6.5 w-6.5 shrink-0 cursor-pointer items-center justify-center rounded-sm border-none bg-transparent text-(--foreground-secondary) transition-background-color duration-swift ease-out hover:bg-(--background-tertiary) hover:text-(--foreground)",
                  replaceOpen && "text-(--accent-blue)",
                )}
                onClick={() => setReplaceOpen((prev) => !prev)}
                aria-label={
                  replaceOpen
                    ? "Hide replace controls"
                    : "Show replace controls"
                }
                title={
                  replaceOpen
                    ? "Hide replace controls"
                    : "Show replace controls"
                }
              >
                <Repeat2 className="size-4" />
              </button>
              <button
                type="button"
                className="inline-flex h-6.5 w-6.5 shrink-0 cursor-pointer items-center justify-center rounded-sm border-none bg-transparent text-(--foreground-secondary) transition-background-color duration-swift ease-out hover:bg-(--background-tertiary) hover:text-(--foreground)"
                onClick={closeSearch}
                aria-label="Close find"
                title="Close (Esc)"
              >
                <X className="size-4" />
              </button>
            </div>

            {replaceOpen && (
              <div className="flex items-center gap-0.5 px-1 py-1 pt-0 pl-2.5">
                <input
                  value={replaceQuery}
                  onChange={(e) => setReplaceQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      replaceCurrentMatch();
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      closeSearch();
                    }
                  }}
                  placeholder="Replace with..."
                  className="h-7 min-w-30 flex-1 border-none bg-transparent text-base/7 font-normal text-(--foreground) outline-none placeholder:text-(--foreground-tertiary)"
                  aria-label="Replace text"
                />
                <div className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    className="h-6.5 cursor-pointer rounded-sm border-none bg-transparent px-2 text-xs font-medium whitespace-nowrap text-(--foreground-secondary) transition-background-color duration-swift ease-out hover:bg-(--background-tertiary) hover:text-(--foreground)"
                    onClick={replaceAllMatches}
                    aria-label="Replace all matches"
                    title="Replace all matches"
                  >
                    Replace all
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-6.5 cursor-pointer items-center gap-1 rounded-sm border-none bg-(--accent-blue) px-2.5 text-xs font-medium whitespace-nowrap text-white transition-filter duration-swift ease-out hover:brightness-110"
                    onClick={replaceCurrentMatch}
                    aria-label="Replace current match"
                    title="Replace current match"
                  >
                    Replace
                    <CornerDownLeft className="size-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {threadSectionPicker ? (
        <NodexPopover
          open
          onOpenChange={(open) => {
            if (!open) closeThreadSectionPicker();
          }}
        >
          <NodexPopoverAnchor asChild>
            <span
              aria-hidden="true"
              className="pointer-events-none fixed"
              style={{
                left: threadSectionPicker.anchorRect.left,
                top: threadSectionPicker.anchorRect.top,
                width: threadSectionPicker.anchorRect.width,
                height: threadSectionPicker.anchorRect.height,
              }}
            />
          </NodexPopoverAnchor>
          <NodexPopoverContent
            side="right"
            align="center"
            sideOffset={6}
            aria-label="Send thread section to chat"
            onCloseAutoFocus={(event) => event.preventDefault()}
            className="w-[330px] max-w-[calc(100vw-24px)] overflow-hidden p-0 text-[14px] leading-[1.2] shadow-xl-spread backdrop-blur-xl"
            style={{ width: 330 }}
          >
            <NfmSendToThreadMenuSurface
              projectId={executionProjectId}
              threadItems={sendToThreadItems}
              threadItemsLoading={sendToThreadItemsLoading}
              projectNameById={sendToThreadProjectNameById}
              preferredTarget={threadSectionPicker.preferredTarget}
              onAccept={handleAcceptThreadSectionPicker}
              onClose={closeThreadSectionPicker}
              showModeSelector={false}
            />
          </NodexPopoverContent>
        </NodexPopover>
      ) : null}
      {headingRail?.portalElement ? (
        <NfmHeadingNavigationRail
          editor={
            editor as unknown as Parameters<
              typeof NfmHeadingNavigationRail
            >[0]["editor"]
          }
          scrollContainerRef={headingRail.scrollContainerRef}
          portalElement={headingRail.portalElement}
          isActivePanelTab={isActivePanelTab}
        />
      ) : null}
      <BlockReferenceRuntimeProvider value={blockReferenceRuntimeValue}>
        <ThreadSectionRuntimeProvider value={threadSectionRuntimeValue}>
          <ThreadMentionRuntimeProvider value={threadMentionRuntimeValue}>
            <NfmEditorContextMenu
              editor={editor}
              onBeforePaste={() =>
                typedReplacementGuardRef.current(editor.getSelection()?.blocks ?? [])}
            >
              <NfmTextActionMenuRuntimeProvider
                value={textActionMenuRuntimeValue}
              >
                <NfmSideMenuRuntimeProvider value={sideMenuRuntimeValue}>
                  <BlockNoteView
                    editor={editor}
                    onEditorViewMount={() => {
                      editorSession?.restoreSelection(editor);
                    }}
                    onEditorViewUnmount={() => {
                      editorSession?.captureSelection(editor);
                    }}
                    editable
                    onChange={handleChange}
                    theme={themeMode}
                    formattingToolbar={false}
                    linkToolbar={false}
                    slashMenu={false}
                    sideMenu={false}
                    tableHandles={false}
                    data-theming-css-variables-demo
                  >
                    <NfmSideMenuOpenProvider>
                      <NfmSideMenuShortcutController />
                      <SideMenuController
                        sideMenu={customSideMenu}
                        floatingUIOptions={sideMenuFloatingOptions}
                      />
                      <NfmFormattingToolbarController
                        formattingToolbar={NfmFormattingToolbar}
                      />
                      <NfmLinkToolbarController
                        linkToolbar={renderLinkToolbar}
                        floatingUIOptions={{
                          useTransitionStylesProps: {
                            duration: 0,
                          },
                          useTransitionStatusProps: {
                            duration: 0,
                          },
                        }}
                      />
                      <NfmSlashMenu
                        executionProjectId={executionProjectId}
                        allowPageReferences
                      />
                      <NfmTableHandlesController />
                    </NfmSideMenuOpenProvider>
                  </BlockNoteView>
                </NfmSideMenuRuntimeProvider>
              </NfmTextActionMenuRuntimeProvider>
            </NfmEditorContextMenu>
          </ThreadMentionRuntimeProvider>
        </ThreadSectionRuntimeProvider>
      </BlockReferenceRuntimeProvider>
      {pasteResourceDialog && (
        <PasteResourceDialog
          open={pasteResourceDialog !== null}
          state={pasteResourceDialog}
          pending={pasteResourcePending}
          error={pasteResourceError}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              closePasteResourceDialog();
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreEditorFocus();
          }}
          onChooseMode={(mode) => {
            void handlePasteResourceChoice(mode);
          }}
          onContinueInline={handleContinuePasteInline}
        />
      )}
      {imagePreview && (
        <ImagePreviewDialog
          open={imagePreview !== null}
          src={imagePreview.source}
          alt={imagePreview.alt}
          allowLocalPath
          closeOnSpace
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreEditorFocus();
          }}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              setImagePreview(null);
            }
          }}
        />
      )}
    </div>
  );
}
