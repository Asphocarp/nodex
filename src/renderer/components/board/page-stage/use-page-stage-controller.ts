import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  EMPTY_BRANCH_SELECTOR_STATE,
  parseBranchSelectorState,
  type BranchSelectorState,
} from "@/features/local-conversation/view/shared/branch-selector-state";
import { getGitWorkerClient, invoke } from "@/lib/api";
import { formatPageStageCollapsedPropertyCountLabel } from "@/lib/page-stage-collapsed-properties";
import {
  readPageStageContentWidthPreference,
  readPageStageShowRawContentPreference,
  writePageStageContentWidthPreference,
  writePageStageShowRawContentPreference,
} from "@/lib/page-stage-layout";
import {
  loadScrollPosition,
  rememberScrollPosition,
  saveScrollPosition,
} from "@/lib/page-stage-scroll";
import { SCROLL_SAVE_DEBOUNCE_MS } from "@/lib/timing";
import type { PageInput, PageRunInTarget, WorktreeEnvironmentOption } from "@/lib/types";
import type { PageStagePageModel, PageStageCorePage } from "@/lib/page-stage-page";
import {
  hasPageStageScheduleCapability,
  pageStageSemanticValues,
} from "@/lib/page-stage-properties";
import { useScheduleState, type PageScheduleSource } from "@/lib/use-schedule-state";
import { usePageStageCollapsedProperties } from "@/lib/use-page-stage-collapsed-properties";
import {
  contentAccessContextKey,
  projectIdFromContentAccessContext,
} from "../../../../shared/content-access-context";
import { normalizeRunInTarget, resolveDefaultRunInBaseBranch } from "./options";
import type {
  PageStageMetadataMutationResult,
  PageStageProps,
  PageStageSessionSnapshot,
} from "./types";
import {
  usePageStageProperties,
  type PageStagePropertyControls,
} from "./use-page-stage-properties";

interface UsePageStageControllerResult {
  page: PageStageCorePage | null;
  hasDatabaseProperties: boolean;
  propertyControls: PageStagePropertyControls;
  projectWorkspacePath?: string | null;
  title: string;
  runInTarget: PageRunInTarget;
  runInLocalPathDisplay: string;
  runInBaseBranch: string;
  runInWorktreePathDisplay: string;
  runInEnvironmentPath: string;
  runInBranchState: BranchSelectorState;
  runInBranchBusy: boolean;
  runInEnvironmentOptions: WorktreeEnvironmentOption[];
  runInEnvironmentBusy: boolean;
  saving: boolean;
  propertiesExpanded: boolean;
  limitMainContentWidth: boolean;
  showRawContent: boolean;
  historyPanelActive: boolean;
  linkedCodexThreads: NonNullable<PageStageProps["linkedCodexThreads"]>;
  hasThreadsRow: boolean;
  selectedRunInBaseBranch: string;
  collapseTagsByDefault: boolean;
  collapseAssigneeByDefault: boolean;
  collapseThreadsByDefault: boolean;
  collapseScheduleByDefault: boolean;
  collapsedPropertyCount: number;
  showCollapsedProperties: boolean;
  contentBodyClassName: string;
  contentShellClassName: string;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  setScrollContainerRef: (node: HTMLDivElement | null) => void;
  schedule: ReturnType<typeof useScheduleState>;
  schedulePage: PageScheduleSource | null;
  onOpenNewCodexThread?: () => void;
  onOpenCodexThread?: (threadId: string) => Promise<void>;
  setPropertiesExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  handleClose: () => Promise<void>;
  handleDelete: () => Promise<void>;
  handleToggleContentWidth: () => void;
  handleToggleShowRawContent: () => void;
  handleScroll: () => void;
  handleDocumentTitleChange: (value: string) => void;
  handleRunInTargetChange: (nextTarget: PageRunInTarget) => Promise<void>;
  handlePickRunInLocalPath: () => Promise<void>;
  handleClearRunInLocalPath: () => void;
  handleResetRunInWorktreePath: () => void;
  handleSelectRunInBaseBranch: (branch: string) => Promise<boolean>;
  refreshRunInBranchState: () => Promise<BranchSelectorState>;
  refreshRunInEnvironmentOptions: () => Promise<WorktreeEnvironmentOption[]>;
  handleSelectRunInEnvironmentPath: (environmentPath: string | null) => Promise<boolean>;
  handleOpenEnvironmentSettings: () => Promise<void>;
  handleOpenCodexThread: (threadId: string) => Promise<void>;
  collapsedPropertyLabel: string;
}

export interface PageStageControllerDependencies {
  /** Flushes the primary owned Document through its durable provider. */
  readonly persistDocument?: () => Promise<void>;
}

interface PageStageMetadataSourceVersion {
  readonly pageId: string;
  readonly metadataRevision: number;
  readonly databaseMembershipId: string | null;
  readonly propertyVersion: string;
}

function readPageStageMetadataSourceVersion(
  pageModel: PageStagePageModel | null,
): PageStageMetadataSourceVersion | null {
  if (!pageModel) return null;

  const databaseContext = pageModel.databaseContext;
  return {
    pageId: pageModel.page.id,
    metadataRevision: pageModel.page.revision,
    databaseMembershipId: databaseContext.kind === "member" ? databaseContext.membership.id : null,
    propertyVersion:
      databaseContext.kind === "member"
        ? databaseContext.properties
            .map((item) =>
              [item.property.propertyId, item.property.revision, item.valueRevision].join(":"),
            )
            .join("|")
        : "standalone",
  };
}

function arePageStageMetadataSourceVersionsEqual(
  left: PageStageMetadataSourceVersion | null,
  right: PageStageMetadataSourceVersion | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;

  return (
    left.pageId === right.pageId &&
    left.metadataRevision === right.metadataRevision &&
    left.databaseMembershipId === right.databaseMembershipId &&
    left.propertyVersion === right.propertyVersion
  );
}

function parseRunInEnvironmentOptions(value: unknown): WorktreeEnvironmentOption[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.path !== "string" || typeof candidate.name !== "string") return [];
    return [
      {
        path: candidate.path,
        name: candidate.name,
        hasSetupScript: Boolean(candidate.hasSetupScript),
        hasCleanupScript: Boolean(candidate.hasCleanupScript),
        actionCount: typeof candidate.actionCount === "number" ? candidate.actionCount : 0,
      },
    ];
  });
}

function buildPageStageSessionSnapshot(
  projectId: string | null,
  page: PageStageCorePage | null,
  title: string,
): PageStageSessionSnapshot | null {
  if (!page || projectId === null) return null;

  const titleSnapshot = title.trim() || page.title.trim() || page.id;
  return {
    projectId,
    pageId: page.id,
    titleSnapshot,
  };
}

function elementHasLayoutBox(element: HTMLElement): boolean {
  return element.isConnected && element.getClientRects().length > 0;
}

export function usePageStageController(
  props: PageStageProps,
  dependencies: PageStageControllerDependencies = {},
): UsePageStageControllerResult {
  const {
    onClose,
    editorSessionKey,
    onLeavePage,
    closeRef,
    persistRef,
    sessionSnapshotRef,
    page: pageModel,
    contentAccessContext,
    projectWorkspacePath,
    onUpdate,
    onDelete,
    onMove,
    onCompleteOccurrence,
    onSkipOccurrence,
    onColumnIdChange,
    linkedCodexThreads = [],
    onOpenCodexThread,
    onOpenNewCodexThread,
    onOpenLocalEnvironmentSettings,
    historyPanelActive = false,
    isActivePanelTab = true,
  } = props;
  const executionProjectId = projectIdFromContentAccessContext(contentAccessContext);
  const documentScopeKey = contentAccessContextKey(contentAccessContext);
  const page = pageModel?.page ?? null;
  const databaseSemantic =
    pageModel?.databaseContext.kind === "member"
      ? pageModel.databaseContext.semanticProperties
      : null;
  const databaseProperties = databaseSemantic ? pageStageSemanticValues(databaseSemantic) : null;
  const scheduleCapability = databaseSemantic
    ? hasPageStageScheduleCapability(databaseSemantic)
    : false;
  const persistDocument = dependencies.persistDocument;

  const [title, setTitle] = useState(page?.title ?? "");
  const [runInTarget, setRunInTarget] = useState<PageRunInTarget>("localProject");
  const [runInLocalPath, setRunInLocalPath] = useState("");
  const [runInBaseBranch, setRunInBaseBranch] = useState("");
  const [runInWorktreePath, setRunInWorktreePath] = useState("");
  const [runInEnvironmentPath, setRunInEnvironmentPath] = useState("");
  const [runInBranchState, setRunInBranchState] = useState<BranchSelectorState>(
    EMPTY_BRANCH_SELECTOR_STATE,
  );
  const [runInBranchBusy, setRunInBranchBusy] = useState(false);
  const [runInEnvironmentOptions, setRunInEnvironmentOptions] = useState<
    WorktreeEnvironmentOption[]
  >([]);
  const [runInEnvironmentBusy, setRunInEnvironmentBusy] = useState(false);
  const [savingCount, setSavingCount] = useState(0);
  const saving = savingCount > 0;
  const [propertiesExpanded, setPropertiesExpanded] = useState(false);
  const [limitMainContentWidth, setLimitMainContentWidth] = useState(() =>
    readPageStageContentWidthPreference(),
  );
  const [showRawContent, setShowRawContent] = useState(() =>
    readPageStageShowRawContentPreference(),
  );
  const { collapsedProperties } = usePageStageCollapsedProperties();

  const currentPageIdRef = useRef<string | null>(null);
  const appliedMetadataSourceVersionRef = useRef<PageStageMetadataSourceVersion | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const lastScrollRestorePageRef = useRef<string | null>(null);
  const scrollSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const previousActivePanelTabRef = useRef(isActivePanelTab);
  const lastKnownScrollTopRef = useRef<{ pageId: string; scrollTop: number } | null>(null);
  const scrollRestoreVersionRef = useRef(0);
  const beginSaving = useCallback(() => {
    let finished = false;
    setSavingCount((current) => current + 1);

    return () => {
      if (finished) return;
      finished = true;
      setSavingCount((current) => Math.max(0, current - 1));
    };
  }, []);

  const propertyControls = usePageStageProperties({
    pageModel,
    contentAccessContext,
    onUpdateProperty: props.onUpdateProperty,
    onMove,
    onColumnIdChange,
    onOpenPage: props.onOpenPage,
    onRefreshProperties: props.onRefreshProperties,
    beginSaving,
  });

  const runUpdate = useCallback(
    async (
      nextPageId: string,
      updates: Partial<PageInput>,
    ): Promise<PageStageMetadataMutationResult> => {
      const result = await onUpdate(nextPageId, updates);
      if (!result) {
        return {
          status: "error",
          error: "Missing update result",
        };
      }
      return result;
    },
    [onUpdate],
  );
  const saveProperty = useCallback(
    (updates: Partial<PageInput>) => {
      if (!page) return;
      const endSaving = beginSaving();
      void runUpdate(page.id, updates).finally(endSaving);
    },
    [beginSaving, page, runUpdate],
  );

  const schedulePage =
    page && databaseProperties && scheduleCapability ? { ...page, ...databaseProperties } : null;
  const schedule = useScheduleState({
    page: schedulePage,
    saveProperty,
    onCompleteOccurrence: scheduleCapability ? onCompleteOccurrence : undefined,
    onSkipOccurrence: scheduleCapability ? onSkipOccurrence : undefined,
  });
  const applyRecurrenceState = schedule.applyRecurrenceState;
  const applyScheduleState = schedule.applyScheduleState;

  const rememberScrollTopForPage = useCallback(
    (pageId: string | null, scrollTop: number) => {
      if (!pageId) return;
      lastKnownScrollTopRef.current = { pageId, scrollTop };
      rememberScrollPosition(documentScopeKey, pageId, scrollTop, editorSessionKey);
    },
    [documentScopeKey, editorSessionKey],
  );

  const saveScrollTopForPage = useCallback(
    (pageId: string | null, scrollTop: number) => {
      if (!pageId) return;
      lastKnownScrollTopRef.current = { pageId, scrollTop };
      saveScrollPosition(documentScopeKey, pageId, scrollTop, editorSessionKey);
    },
    [documentScopeKey, editorSessionKey],
  );

  const readCurrentScrollTopForPage = useCallback(
    (pageId: string, element: HTMLDivElement | null) => {
      if (element && elementHasLayoutBox(element)) {
        return element.scrollTop;
      }

      const lastKnown = lastKnownScrollTopRef.current;
      if (lastKnown?.pageId === pageId) return lastKnown.scrollTop;
      if (element && element.scrollTop > 0) return element.scrollTop;
      return null;
    },
    [],
  );

  const saveCurrentScrollPosition = useCallback(() => {
    const pageId = currentPageIdRef.current;
    const element = scrollContainerRef.current;
    if (!pageId) return;
    const scrollTop = readCurrentScrollTopForPage(pageId, element);
    if (scrollTop === null) return;
    saveScrollTopForPage(pageId, scrollTop);
  }, [readCurrentScrollTopForPage, saveScrollTopForPage]);

  const restoreScrollPositionForPage = useCallback(
    (pageId: string, options: { resetWhenMissing: boolean }) => {
      const element = scrollContainerRef.current;
      if (!element) return;

      scrollRestoreVersionRef.current += 1;
      const restoreVersion = scrollRestoreVersionRef.current;
      const saved = loadScrollPosition(documentScopeKey, pageId, editorSessionKey);
      if (saved === null) {
        if (options.resetWhenMissing) element.scrollTop = 0;
        return;
      }

      element.scrollTop = saved;
      lastKnownScrollTopRef.current = { pageId, scrollTop: saved };

      if (typeof requestAnimationFrame !== "function") return;
      let remainingFrames = 2;
      const retryRestore = () => {
        if (scrollRestoreVersionRef.current !== restoreVersion) return;
        const currentPageId = currentPageIdRef.current;
        if (currentPageId !== null && currentPageId !== pageId) return;
        const currentElement = scrollContainerRef.current;
        if (!currentElement) return;
        currentElement.scrollTop = saved;
        lastKnownScrollTopRef.current = { pageId, scrollTop: saved };
        remainingFrames -= 1;
        if (remainingFrames > 0) requestAnimationFrame(retryRestore);
      };
      requestAnimationFrame(retryRestore);
    },
    [documentScopeKey, editorSessionKey],
  );

  const setScrollContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      const previousNode = scrollContainerRef.current;
      if (previousNode && previousNode !== node) {
        saveCurrentScrollPosition();
      }

      scrollContainerRef.current = node;
      const pageId = currentPageIdRef.current;
      if (!node || !pageId) return;
      restoreScrollPositionForPage(pageId, { resetWhenMissing: false });
    },
    [restoreScrollPositionForPage, saveCurrentScrollPosition],
  );

  useEffect(() => {
    const pageId = page?.id ?? null;
    const metadataSourceVersion = readPageStageMetadataSourceVersion(pageModel);
    const prevPageId = currentPageIdRef.current;
    if (
      pageId === prevPageId &&
      arePageStageMetadataSourceVersionsEqual(
        appliedMetadataSourceVersionRef.current,
        metadataSourceVersion,
      )
    )
      return;

    if (prevPageId && prevPageId !== pageId) {
      const scrollTop = readCurrentScrollTopForPage(prevPageId, scrollContainerRef.current);
      if (scrollTop !== null) saveScrollTopForPage(prevPageId, scrollTop);
    }

    currentPageIdRef.current = pageId;
    appliedMetadataSourceVersionRef.current = metadataSourceVersion;

    if (page) {
      setTitle(page.title);
      if (databaseProperties && scheduleCapability) {
        const schedulePage = { ...page, ...databaseProperties };
        applyScheduleState(schedulePage);
        applyRecurrenceState(schedulePage);
      }
      setRunInTarget(normalizeRunInTarget(page.runInTarget));
      setRunInLocalPath(page.runInLocalPath || "");
      setRunInBaseBranch(page.runInBaseBranch || "");
      setRunInWorktreePath(page.runInWorktreePath || "");
      setRunInEnvironmentPath(page.runInEnvironmentPath || "");
      return;
    }

    setRunInTarget("localProject");
    setRunInLocalPath("");
    setRunInBaseBranch("");
    setRunInWorktreePath("");
    setRunInEnvironmentPath("");
    setRunInBranchState(EMPTY_BRANCH_SELECTOR_STATE);
    setRunInEnvironmentOptions([]);
  }, [
    page,
    pageModel,
    databaseProperties,
    scheduleCapability,
    readCurrentScrollTopForPage,
    saveScrollTopForPage,
    applyRecurrenceState,
    applyScheduleState,
  ]);

  useLayoutEffect(() => {
    const pageId = page?.id ?? null;
    if (!pageId) return;

    const resetWhenMissing = lastScrollRestorePageRef.current !== pageId;
    lastScrollRestorePageRef.current = pageId;
    restoreScrollPositionForPage(pageId, { resetWhenMissing });
  }, [page?.id, restoreScrollPositionForPage]);

  const handleScroll = useCallback(() => {
    const pageId = currentPageIdRef.current;
    const element = scrollContainerRef.current;
    if (!pageId || !element) return;

    const scrollTop = element.scrollTop;
    rememberScrollTopForPage(pageId, scrollTop);
    if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current);
    scrollSaveTimerRef.current = setTimeout(() => {
      saveScrollTopForPage(pageId, scrollTop);
      scrollSaveTimerRef.current = null;
    }, SCROLL_SAVE_DEBOUNCE_MS);
  }, [rememberScrollTopForPage, saveScrollTopForPage]);

  useLayoutEffect(() => {
    return () => {
      if (scrollSaveTimerRef.current) {
        clearTimeout(scrollSaveTimerRef.current);
        scrollSaveTimerRef.current = null;
      }
      saveCurrentScrollPosition();
    };
  }, [saveCurrentScrollPosition]);

  const handleDocumentTitleChange = useCallback((value: string) => {
    setTitle(value);
  }, []);

  const handlePersist = useCallback(async () => {
    saveCurrentScrollPosition();
    await (persistDocument?.() ?? Promise.resolve());
  }, [persistDocument, saveCurrentScrollPosition]);

  const handleClose = useCallback(async () => {
    await handlePersist();
    const sessionSnapshot = buildPageStageSessionSnapshot(executionProjectId, page, title);
    if (sessionSnapshot) {
      onLeavePage?.(sessionSnapshot);
    }
    onClose();
  }, [executionProjectId, handlePersist, onClose, onLeavePage, page, title]);

  useEffect(() => {
    if (!closeRef || !isActivePanelTab) return;
    closeRef.current = handleClose;
    return () => {
      if (closeRef.current === handleClose) {
        closeRef.current = null;
      }
    };
  }, [closeRef, handleClose, isActivePanelTab]);

  useEffect(() => {
    if (!persistRef || !isActivePanelTab) return;
    persistRef.current = handlePersist;
    return () => {
      if (persistRef.current === handlePersist) {
        persistRef.current = null;
      }
    };
  }, [persistRef, handlePersist, isActivePanelTab]);

  useEffect(() => {
    if (!sessionSnapshotRef || !isActivePanelTab) return;
    const snapshot = buildPageStageSessionSnapshot(executionProjectId, page, title);
    sessionSnapshotRef.current = snapshot;
    return () => {
      if (sessionSnapshotRef.current === snapshot) {
        sessionSnapshotRef.current = null;
      }
    };
  }, [executionProjectId, isActivePanelTab, page, sessionSnapshotRef, title]);

  useEffect(() => {
    const wasActive = previousActivePanelTabRef.current;
    previousActivePanelTabRef.current = isActivePanelTab;
    if (!wasActive || isActivePanelTab) return;
    void handlePersist();
  }, [handlePersist, isActivePanelTab]);

  const handleDelete = useCallback(async () => {
    if (!page || !onDelete) return;
    const endSaving = beginSaving();
    try {
      await onDelete(page.id);
      onClose();
    } finally {
      endSaving();
    }
  }, [beginSaving, page, onDelete, onClose]);

  const handleOpenCodexThread = useCallback(
    async (threadId: string) => {
      if (!onOpenCodexThread) return;
      const endSaving = beginSaving();
      try {
        await onOpenCodexThread(threadId);
      } finally {
        endSaving();
      }
    },
    [beginSaving, onOpenCodexThread],
  );

  const handleToggleContentWidth = useCallback(() => {
    setLimitMainContentWidth((current) => {
      const next = !current;
      writePageStageContentWidthPreference(next);
      return next;
    });
  }, []);

  const handleToggleShowRawContent = useCallback(() => {
    setShowRawContent((current) => {
      const next = !current;
      writePageStageShowRawContentPreference(next);
      return next;
    });
  }, []);

  const refreshRunInBranchState = useCallback(async () => {
    const requestedCwd = projectWorkspacePath?.trim();
    if (!requestedCwd) {
      setRunInBranchState(EMPTY_BRANCH_SELECTOR_STATE);
      return EMPTY_BRANCH_SELECTOR_STATE;
    }

    setRunInBranchBusy(true);
    try {
      const result = await getGitWorkerClient().request({
        method: "branch-metadata",
        params: { cwd: requestedCwd },
      });
      const parsed = parseBranchSelectorState(result);
      setRunInBranchState(parsed);
      return parsed;
    } catch {
      setRunInBranchState(EMPTY_BRANCH_SELECTOR_STATE);
      return EMPTY_BRANCH_SELECTOR_STATE;
    } finally {
      setRunInBranchBusy(false);
    }
  }, [projectWorkspacePath]);

  const refreshRunInEnvironmentOptions = useCallback(async () => {
    if (executionProjectId === null) {
      setRunInEnvironmentOptions([]);
      return [];
    }

    setRunInEnvironmentBusy(true);
    try {
      const result = await invoke("worktrees:environments:list", executionProjectId);
      const parsed = parseRunInEnvironmentOptions(result);
      setRunInEnvironmentOptions(parsed);
      return parsed;
    } catch {
      setRunInEnvironmentOptions([]);
      return [];
    } finally {
      setRunInEnvironmentBusy(false);
    }
  }, [executionProjectId]);

  useEffect(() => {
    if (runInTarget !== "newWorktree") return;
    void refreshRunInBranchState();
  }, [runInTarget, refreshRunInBranchState]);

  useEffect(() => {
    if (runInTarget !== "newWorktree" || runInWorktreePath.trim().length > 0) return;
    void refreshRunInEnvironmentOptions();
  }, [runInTarget, runInWorktreePath, refreshRunInEnvironmentOptions]);

  const handleRunInTargetChange = useCallback(
    async (nextTarget: PageRunInTarget) => {
      setRunInTarget(nextTarget);
      saveProperty({ runInTarget: nextTarget });

      if (nextTarget !== "newWorktree" || runInBaseBranch.trim().length > 0) return;
      const branchState = await refreshRunInBranchState();
      const defaultBranch = resolveDefaultRunInBaseBranch(branchState);
      if (!defaultBranch) return;
      setRunInBaseBranch(defaultBranch);
      saveProperty({ runInBaseBranch: defaultBranch });
    },
    [runInBaseBranch, refreshRunInBranchState, saveProperty],
  );

  const handlePickRunInLocalPath = useCallback(async () => {
    const selected = (await invoke("workspace:pick-directory", {
      title: "Choose local run folder",
    })) as string | null;
    if (!selected) return;
    setRunInLocalPath(selected);
    saveProperty({ runInLocalPath: selected });
  }, [saveProperty]);

  const handleClearRunInLocalPath = useCallback(() => {
    setRunInLocalPath("");
    saveProperty({ runInLocalPath: null });
  }, [saveProperty]);

  const handleResetRunInWorktreePath = useCallback(() => {
    setRunInWorktreePath("");
    saveProperty({ runInWorktreePath: null });
  }, [saveProperty]);

  const handleSelectRunInBaseBranch = useCallback(
    async (branch: string) => {
      const normalized = branch.trim();
      if (!normalized) return false;
      setRunInBaseBranch(normalized);
      saveProperty({ runInBaseBranch: normalized });
      return true;
    },
    [saveProperty],
  );

  const handleSelectRunInEnvironmentPath = useCallback(
    async (environmentPath: string | null) => {
      const normalized = environmentPath?.trim() || "";
      setRunInEnvironmentPath(normalized);
      saveProperty({ runInEnvironmentPath: normalized || null });
      return true;
    },
    [saveProperty],
  );

  const handleOpenEnvironmentSettings = useCallback(async () => {
    if (executionProjectId === null || !projectWorkspacePath?.trim()) return;
    onOpenLocalEnvironmentSettings?.({
      projectId: executionProjectId,
      configPath: runInEnvironmentPath.trim() || null,
    });
  }, [
    executionProjectId,
    onOpenLocalEnvironmentSettings,
    projectWorkspacePath,
    runInEnvironmentPath,
  ]);

  const hasThreadsRow = linkedCodexThreads.length > 0 || Boolean(onOpenNewCodexThread);
  const selectedRunInBaseBranch =
    runInBaseBranch.trim() || resolveDefaultRunInBaseBranch(runInBranchState);
  const runInLocalPathDisplay = runInLocalPath.trim();
  const runInWorktreePathDisplay = runInWorktreePath.trim();
  const runInEnvironmentPathDisplay = runInEnvironmentPath.trim();

  const collapseTagsByDefault =
    databaseSemantic?.tags !== null &&
    databaseSemantic?.tags !== undefined &&
    collapsedProperties.includes("tags");
  const collapseAssigneeByDefault =
    databaseSemantic?.assignee !== null &&
    databaseSemantic?.assignee !== undefined &&
    collapsedProperties.includes("assignee");
  const collapseThreadsByDefault = hasThreadsRow && collapsedProperties.includes("threads");
  const collapseScheduleByDefault = scheduleCapability && collapsedProperties.includes("schedule");

  const collapsedPropertyCount = [
    collapseTagsByDefault,
    collapseAssigneeByDefault,
    collapseThreadsByDefault,
    collapseScheduleByDefault,
  ].filter(Boolean).length;

  const showCollapsedProperties = propertiesExpanded || collapsedPropertyCount === 0;

  const contentBodyClassName = [
    "mx-auto w-full px-(--page-stage-body-gutter-inline)",
    limitMainContentWidth ? "max-w-(--page-stage-body-max-width)" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const contentShellClassName = "w-full";

  const collapsedPropertyLabel = formatPageStageCollapsedPropertyCountLabel(
    collapsedPropertyCount,
    propertiesExpanded,
  );

  return {
    page,
    hasDatabaseProperties: propertyControls.properties.length > 0,
    propertyControls,
    projectWorkspacePath,
    title,
    runInTarget,
    runInLocalPathDisplay,
    runInBaseBranch,
    runInWorktreePathDisplay,
    runInEnvironmentPath: runInEnvironmentPathDisplay,
    runInBranchState,
    runInBranchBusy,
    runInEnvironmentOptions,
    runInEnvironmentBusy,
    saving,
    propertiesExpanded,
    limitMainContentWidth,
    showRawContent,
    historyPanelActive,
    linkedCodexThreads,
    hasThreadsRow,
    selectedRunInBaseBranch,
    collapseTagsByDefault,
    collapseAssigneeByDefault,
    collapseThreadsByDefault,
    collapseScheduleByDefault,
    collapsedPropertyCount,
    showCollapsedProperties,
    contentBodyClassName,
    contentShellClassName,
    scrollContainerRef,
    setScrollContainerRef,
    schedule,
    schedulePage,
    onOpenNewCodexThread,
    onOpenCodexThread,
    setPropertiesExpanded,
    handleClose,
    handleDelete,
    handleToggleContentWidth,
    handleToggleShowRawContent,
    handleScroll,
    handleDocumentTitleChange,
    handleRunInTargetChange,
    handlePickRunInLocalPath,
    handleClearRunInLocalPath,
    handleResetRunInWorktreePath,
    handleSelectRunInBaseBranch,
    refreshRunInBranchState,
    refreshRunInEnvironmentOptions,
    handleSelectRunInEnvironmentPath,
    handleOpenEnvironmentSettings,
    handleOpenCodexThread,
    collapsedPropertyLabel,
  };
}

export type PageStageController = UsePageStageControllerResult;
