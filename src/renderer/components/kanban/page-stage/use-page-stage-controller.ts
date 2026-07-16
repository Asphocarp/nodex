import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  EMPTY_BRANCH_SELECTOR_STATE,
  parseBranchSelectorState,
  type BranchSelectorState,
} from "@/features/local-conversation/view/shared/branch-selector-state";
import { invoke } from "@/lib/api";
import { formatPageStageCollapsedPropertyCountLabel } from "@/lib/page-stage-collapsed-properties";
import {
  readPageStageContentWidthPreference,
  readPageStageShowRawContentPreference,
  writePageStageContentWidthPreference,
  writePageStageShowRawContentPreference,
} from "@/lib/page-stage-layout";
import { loadScrollPosition, rememberScrollPosition, saveScrollPosition } from "@/lib/page-stage-scroll";
import {
  FIELD_SAVE_DEBOUNCE_MS,
  SCROLL_SAVE_DEBOUNCE_MS,
  TAG_BLUR_DELAY_MS,
} from "@/lib/timing";
import type {
  PageInput,
  PageRunInTarget,
  Estimate,
  Priority,
  WorktreeEnvironmentOption,
} from "@/lib/types";
import type {
  PageStagePageModel,
  PageStageCorePage,
  PageStageDatabaseProperties,
} from "@/lib/page-stage-page";
import { useScheduleState } from "@/lib/use-schedule-state";
import { usePageStageCollapsedProperties } from "@/lib/use-page-stage-collapsed-properties";
import { KANBAN_STATUS_OPTIONS } from "@/lib/kanban-options";
import {
  clearPageDraftOverlay,
  setPageDraftOverlay,
} from "../../../lib/page-draft-store";
import {
  buildPageStageDraftOverlay,
} from "./page-stage-draft-sync";
import { normalizeRunInTarget, resolveDefaultRunInBaseBranch } from "./options";
import type {
  PageStageMetadataMutationResult,
  PageStageProps,
  PageStageSessionSnapshot,
} from "./types";

interface UsePageStageControllerResult {
  page: PageStageCorePage | null;
  hasDatabaseProperties: boolean;
  projectWorkspacePath?: string | null;
  title: string;
  priority?: Priority;
  estimate: string;
  dueDate: string;
  tagInput: string;
  tags: string[];
  assignee: string;
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
  currentColumnId: string;
  limitMainContentWidth: boolean;
  showRawContent: boolean;
  historyPanelActive: boolean;
  linkedCodexThreads: NonNullable<PageStageProps["linkedCodexThreads"]>;
  tagHighlight: number;
  tagDropdownOpen: boolean;
  tagInputActive: boolean;
  tagOptions: string[];
  tagCreateValue: string;
  showTagCreate: boolean;
  tagItemCount: number;
  hasTagDropdownItems: boolean;
  hasThreadsRow: boolean;
  selectedRunInBaseBranch: string;
  collapseTagsByDefault: boolean;
  collapseAssigneeByDefault: boolean;
  collapseThreadsByDefault: boolean;
  collapseScheduleByDefault: boolean;
  collapsedPropertyCount: number;
  showCollapsedProperties: boolean;
  currentColumnName: string;
  contentBodyClassName: string;
  contentShellClassName: string;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  setScrollContainerRef: (node: HTMLDivElement | null) => void;
  tagInputRef: React.RefObject<HTMLInputElement | null>;
  tagDropdownRef: React.RefObject<HTMLDivElement | null>;
  schedule: ReturnType<typeof useScheduleState>;
  onOpenNewCodexThread?: () => void;
  onOpenCodexThread?: (threadId: string) => Promise<void>;
  setPropertiesExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  setTagInput: React.Dispatch<React.SetStateAction<string>>;
  setTagHighlight: React.Dispatch<React.SetStateAction<number>>;
  setTagDropdownOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setTagInputActive: React.Dispatch<React.SetStateAction<boolean>>;
  handleClose: () => Promise<void>;
  handleDelete: () => Promise<void>;
  handleToggleContentWidth: () => void;
  handleToggleShowRawContent: () => void;
  handleScroll: () => void;
  handleDocumentTitleChange: (value: string) => void;
  handlePriorityChange: (next: Priority | null) => void;
  handleEstimateChange: (next: string) => void;
  handleDueDateChange: (next: string) => void;
  handleClearDueDate: () => void;
  handleSetDueDateToday: () => void;
  handleColumnChange: (nextColumnId: string) => Promise<void>;
  handleAssigneeChange: (value: string) => void;
  handleAssigneeBlur: () => void;
  handleAddTag: (value?: string) => void;
  handleRemoveTag: (tag: string) => void;
  handleTagInputBlur: () => void;
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

interface PageStageFormState {
  priority: Priority | undefined;
  estimate: string;
  dueDate: string;
  tags: string[];
  assignee: string;
}

interface PageStageMetadataSourceVersion {
  readonly pageId: string;
  readonly metadataRevision: number;
  readonly databaseMembershipId: string | null;
  readonly hasCompatibilityProperties: boolean;
}

function readPageStageMetadataSourceVersion(
  pageModel: PageStagePageModel | null,
): PageStageMetadataSourceVersion | null {
  if (!pageModel) return null;

  const databaseContext = pageModel.databaseContext;
  return {
    pageId: pageModel.page.id,
    metadataRevision: pageModel.page.revision,
    databaseMembershipId:
      databaseContext.kind === "member"
        ? databaseContext.membership.id
        : null,
    hasCompatibilityProperties:
      databaseContext.kind === "member"
      && databaseContext.compatibilityProperties !== null,
  };
}

function arePageStageMetadataSourceVersionsEqual(
  left: PageStageMetadataSourceVersion | null,
  right: PageStageMetadataSourceVersion | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;

  return left.pageId === right.pageId
    && left.metadataRevision === right.metadataRevision
    && left.databaseMembershipId === right.databaseMembershipId
    && left.hasCompatibilityProperties === right.hasCompatibilityProperties;
}

function toPriorityUpdate(
  nextPriority: Priority | undefined,
  currentPriority: Priority | undefined,
): Partial<PageInput> {
  if (nextPriority === currentPriority) {
    return {};
  }

  return {
    priority: nextPriority ?? null,
  };
}

function parseRunInEnvironmentOptions(value: unknown): WorktreeEnvironmentOption[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.path !== "string" || typeof candidate.name !== "string") return [];
    return [{
      path: candidate.path,
      name: candidate.name,
      hasSetupScript: Boolean(candidate.hasSetupScript),
      hasCleanupScript: Boolean(candidate.hasCleanupScript),
      actionCount: typeof candidate.actionCount === "number" ? candidate.actionCount : 0,
    }];
  });
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function buildPageStageSessionSnapshot(
  projectId: string,
  page: PageStageCorePage | null,
  title: string,
): PageStageSessionSnapshot | null {
  if (!page) return null;

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
    onLeavePage,
    onTitleChange,
    closeRef,
    persistRef,
    sessionSnapshotRef,
    page: pageModel,
    projectId,
    projectWorkspacePath,
    availableTags,
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
  const page = pageModel?.page ?? null;
  const databaseProperties =
    pageModel?.databaseContext.kind === "member"
      ? pageModel.databaseContext.compatibilityProperties
      : null;
  const columnId = databaseProperties?.status ?? "";
  const columnName = KANBAN_STATUS_OPTIONS.find(
    (status) => status.id === columnId,
  )?.name ?? "";
  const persistDocument = dependencies.persistDocument;

  const [title, setTitle] = useState(page?.title ?? "");
  const [priority, setPriority] = useState<Priority | undefined>(undefined);
  const [estimate, setEstimate] = useState<string>("none");
  const [dueDate, setDueDate] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [assignee, setAssignee] = useState("");
  const [runInTarget, setRunInTarget] = useState<PageRunInTarget>("localProject");
  const [runInLocalPath, setRunInLocalPath] = useState("");
  const [runInBaseBranch, setRunInBaseBranch] = useState("");
  const [runInWorktreePath, setRunInWorktreePath] = useState("");
  const [runInEnvironmentPath, setRunInEnvironmentPath] = useState("");
  const [runInBranchState, setRunInBranchState] = useState<BranchSelectorState>(EMPTY_BRANCH_SELECTOR_STATE);
  const [runInBranchBusy, setRunInBranchBusy] = useState(false);
  const [runInEnvironmentOptions, setRunInEnvironmentOptions] = useState<WorktreeEnvironmentOption[]>([]);
  const [runInEnvironmentBusy, setRunInEnvironmentBusy] = useState(false);
  const [savingCount, setSavingCount] = useState(0);
  const saving = savingCount > 0;
  const [propertiesExpanded, setPropertiesExpanded] = useState(false);
  const [tagInputActive, setTagInputActive] = useState(false);
  const [currentColumnId, setCurrentColumnId] = useState(columnId);
  const [limitMainContentWidth, setLimitMainContentWidth] = useState(() =>
    readPageStageContentWidthPreference(),
  );
  const [showRawContent, setShowRawContent] = useState(() =>
    readPageStageShowRawContentPreference(),
  );
  const { collapsedProperties } = usePageStageCollapsedProperties();

  const tagInputRef = useRef<HTMLInputElement>(null);
  const tagDropdownRef = useRef<HTMLDivElement>(null);
  const [tagHighlight, setTagHighlight] = useState(-1);
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);

  const prevPageRef = useRef<{
    page: PageStageCorePage;
    databaseProperties: PageStageDatabaseProperties | null;
    columnId: string;
  } | null>(null);
  const currentPageIdRef = useRef<string | null>(null);
  const appliedMetadataSourceVersionRef =
    useRef<PageStageMetadataSourceVersion | null>(null);
  const assigneeSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const lastScrollRestorePageRef = useRef<string | null>(null);
  const scrollSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const previousActivePanelTabRef = useRef(isActivePanelTab);
  const lastKnownScrollTopRef = useRef<{ pageId: string; scrollTop: number } | null>(null);
  const scrollRestoreVersionRef = useRef(0);
  const assigneeDraftDirtyRef = useRef(false);

  const formStateRef = useRef<PageStageFormState>({
    priority: undefined as Priority | undefined,
    estimate: "none",
    dueDate: "",
    tags: [] as string[],
    assignee: "",
  });

  const tagOptions = useMemo(() => {
    const normalizedInput = tagInput.trim().toLowerCase();
    const selectedTags = new Set(tags.map((tag) => tag.toLowerCase()));

    return availableTags
      .filter((tag) => !selectedTags.has(tag))
      .filter((tag) => {
        if (!normalizedInput) return true;
        return tag.includes(normalizedInput);
      })
      .slice(0, 10);
  }, [availableTags, tagInput, tags]);

  const tagCreateValue = tagInput.trim().toLowerCase();
  const showTagCreate = tagCreateValue.length > 0
    && !tagOptions.some((tag) => tag === tagCreateValue)
    && !tags.some((tag) => tag.toLowerCase() === tagCreateValue);
  const tagItemCount = tagOptions.length + (showTagCreate ? 1 : 0);
  const hasTagDropdownItems = tagItemCount > 0;

  const markAssigneeDraftDirty = useCallback(() => {
    assigneeDraftDirtyRef.current = true;
  }, []);

  const clearAssigneeDraftDirty = useCallback(() => {
    assigneeDraftDirtyRef.current = false;
  }, []);

  const beginSaving = useCallback(() => {
    let finished = false;
    setSavingCount((current) => current + 1);

    return () => {
      if (finished) return;
      finished = true;
      setSavingCount((current) => Math.max(0, current - 1));
    };
  }, []);

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
  const runPreviousPageUpdate = useEffectEvent(
    (nextPageId: string, updates: Partial<PageInput>) =>
      runUpdate(nextPageId, updates),
  );

  const clearAssigneeDraftDirtyFromAck = useCallback(
    (
      result: PageStageMetadataMutationResult,
      expectedAssignee: string,
    ) => {
      if (result.status !== "updated") return;
      if (formStateRef.current.assignee !== expectedAssignee) return;
      assigneeDraftDirtyRef.current = false;
    },
    [],
  );

  const runAssigneeUpdate = useCallback(
    async (
      nextPageId: string,
      expectedAssignee: string,
    ): Promise<PageStageMetadataMutationResult> => {
      const result = await runUpdate(nextPageId, { assignee: expectedAssignee });
      clearAssigneeDraftDirtyFromAck(result, expectedAssignee);
      return result;
    },
    [clearAssigneeDraftDirtyFromAck, runUpdate],
  );

  const saveProperty = useCallback(
    (updates: Partial<PageInput>) => {
      if (!page) return;
      const endSaving = beginSaving();
      runUpdate(page.id, updates).finally(endSaving);
    },
    [beginSaving, page, runUpdate],
  );

  const schedulePage = page && databaseProperties
    ? { ...page, ...databaseProperties }
    : null;
  const schedule = useScheduleState({
    page: schedulePage,
    saveProperty,
    onCompleteOccurrence: databaseProperties ? onCompleteOccurrence : undefined,
    onSkipOccurrence: databaseProperties ? onSkipOccurrence : undefined,
  });
  const applyRecurrenceState = schedule.applyRecurrenceState;
  const applyScheduleState = schedule.applyScheduleState;
  const draftOverlayPageId = page?.id ?? null;

  useEffect(() => {
    formStateRef.current = {
      priority,
      estimate,
      dueDate,
      tags,
      assignee,
    };
  }, [priority, estimate, dueDate, tags, assignee]);

  useEffect(() => {
    if (!draftOverlayPageId) return;

    return () => {
      clearPageDraftOverlay(projectId, draftOverlayPageId);
    };
  }, [draftOverlayPageId, projectId]);

  useEffect(() => {
    if (!page) return;

    const overlay = buildPageStageDraftOverlay({
      assignee: databaseProperties?.assignee,
    }, {
      assignee,
    });

    setPageDraftOverlay(projectId, page.id, overlay);
  }, [assignee, page, databaseProperties?.assignee, projectId]);

  const rememberScrollTopForPage = useCallback((pageId: string | null, scrollTop: number) => {
    if (!pageId) return;
    lastKnownScrollTopRef.current = { pageId, scrollTop };
    rememberScrollPosition(projectId, pageId, scrollTop);
  }, [projectId]);

  const saveScrollTopForPage = useCallback((pageId: string | null, scrollTop: number) => {
    if (!pageId) return;
    lastKnownScrollTopRef.current = { pageId, scrollTop };
    saveScrollPosition(projectId, pageId, scrollTop);
  }, [projectId]);

  const readCurrentScrollTopForPage = useCallback((pageId: string, element: HTMLDivElement | null) => {
    if (element && elementHasLayoutBox(element)) {
      return element.scrollTop;
    }

    const lastKnown = lastKnownScrollTopRef.current;
    if (lastKnown?.pageId === pageId) return lastKnown.scrollTop;
    if (element && element.scrollTop > 0) return element.scrollTop;
    return null;
  }, []);

  const saveCurrentScrollPosition = useCallback(() => {
    const pageId = currentPageIdRef.current;
    const element = scrollContainerRef.current;
    if (!pageId) return;
    const scrollTop = readCurrentScrollTopForPage(pageId, element);
    if (scrollTop === null) return;
    saveScrollTopForPage(pageId, scrollTop);
  }, [readCurrentScrollTopForPage, saveScrollTopForPage]);

  const restoreScrollPositionForPage = useCallback((
    pageId: string,
    options: { resetWhenMissing: boolean },
  ) => {
    const element = scrollContainerRef.current;
    if (!element) return;

    scrollRestoreVersionRef.current += 1;
    const restoreVersion = scrollRestoreVersionRef.current;
    const saved = loadScrollPosition(projectId, pageId);
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
  }, [projectId]);

  const setScrollContainerRef = useCallback((node: HTMLDivElement | null) => {
    const previousNode = scrollContainerRef.current;
    if (previousNode && previousNode !== node) {
      saveCurrentScrollPosition();
    }

    scrollContainerRef.current = node;
    const pageId = currentPageIdRef.current;
    if (!node || !pageId) return;
    restoreScrollPositionForPage(pageId, { resetWhenMissing: false });
  }, [restoreScrollPositionForPage, saveCurrentScrollPosition]);

  useEffect(() => {
    const pageId = page?.id ?? null;
    const metadataSourceVersion = readPageStageMetadataSourceVersion(pageModel);
    const prevPageId = currentPageIdRef.current;
    if (pageId === prevPageId) {
      if (!page) return;

      // Command callbacks and projection objects may be recreated by a parent
      // render. Metadata revision and Database membership are the authority for
      // whether this external form snapshot changed. Record the latest objects
      // for page-switch flushing, but never dispatch React state for an already
      // applied source version.
      prevPageRef.current = { page, databaseProperties, columnId };
      if (arePageStageMetadataSourceVersionsEqual(
        appliedMetadataSourceVersionRef.current,
        metadataSourceVersion,
      )) {
        return;
      }
      appliedMetadataSourceVersionRef.current = metadataSourceVersion;

      const state = formStateRef.current;
      const nextDueDate = databaseProperties?.dueDate
        ? databaseProperties.dueDate.toISOString().split("T")[0]
        : "";
      const nextRunInTarget = normalizeRunInTarget(page.runInTarget);
      const nextRunInLocalPath = page.runInLocalPath || "";
      const nextRunInBaseBranch = page.runInBaseBranch || "";
      const nextRunInWorktreePath = page.runInWorktreePath || "";
      const nextRunInEnvironmentPath = page.runInEnvironmentPath || "";

      const assigneeDirty = assigneeDraftDirtyRef.current;

      setPriority((current) => (
        current === databaseProperties?.priority
          ? current
          : databaseProperties?.priority
      ));
      setEstimate((current) => (
        current === (databaseProperties?.estimate || "none")
          ? current
          : (databaseProperties?.estimate || "none")
      ));
      setDueDate((current) => (current === nextDueDate ? current : nextDueDate));
      const nextTags = [...(databaseProperties?.tags ?? [])];
      if (!areStringArraysEqual(state.tags, nextTags)) {
        setTags(nextTags);
      }
      if (!assigneeDirty || state.assignee === (databaseProperties?.assignee || "")) {
        assigneeDraftDirtyRef.current = false;
        setAssignee((current) => (
          current === (databaseProperties?.assignee || "")
            ? current
            : (databaseProperties?.assignee || "")
        ));
      }
      setRunInTarget((current) => (current === nextRunInTarget ? current : nextRunInTarget));
      setRunInLocalPath((current) => (current === nextRunInLocalPath ? current : nextRunInLocalPath));
      setRunInBaseBranch((current) => (current === nextRunInBaseBranch ? current : nextRunInBaseBranch));
      setRunInWorktreePath((current) => (current === nextRunInWorktreePath ? current : nextRunInWorktreePath));
      setRunInEnvironmentPath((current) => (
        current === nextRunInEnvironmentPath ? current : nextRunInEnvironmentPath
      ));
      setCurrentColumnId((current) => (current === columnId ? current : columnId));
      if (databaseProperties) {
        const schedulePage = { ...page, ...databaseProperties };
        applyScheduleState(schedulePage);
        applyRecurrenceState(schedulePage);
      }
      return;
    }

    if (assigneeSaveTimerRef.current) {
      clearTimeout(assigneeSaveTimerRef.current);
      assigneeSaveTimerRef.current = null;
    }
    clearAssigneeDraftDirty();

    if (prevPageId) {
      const scrollTop = readCurrentScrollTopForPage(prevPageId, scrollContainerRef.current);
      if (scrollTop !== null) saveScrollTopForPage(prevPageId, scrollTop);
    }

    const prevPage = prevPageRef.current;
    if (prevPage && page && prevPage.page.id !== page.id) {
      const state = formStateRef.current;
      const targetPage = prevPage.page;
      const targetDatabase = prevPage.databaseProperties;
      const targetDueDate = targetDatabase?.dueDate
        ? targetDatabase.dueDate.toISOString().split("T")[0]
        : "";

      const hasAnyChanges = (
        targetDatabase !== null && (
          state.priority !== targetDatabase.priority
          || state.estimate !== (targetDatabase.estimate || "none")
          || state.dueDate !== targetDueDate
          || state.assignee !== (targetDatabase.assignee || "")
          || JSON.stringify(state.tags) !== JSON.stringify(targetDatabase.tags)
        )
      );

      if (hasAnyChanges) {
        void runPreviousPageUpdate(targetPage.id, {
          ...(targetDatabase
            ? {
                ...toPriorityUpdate(state.priority, targetDatabase.priority),
                estimate:
                  state.estimate === "none"
                    ? null
                    : (state.estimate as Estimate),
                dueDate: state.dueDate ? new Date(state.dueDate) : null,
                tags: state.tags,
                assignee: state.assignee,
              }
            : {}),
        });
      }
    }

    currentPageIdRef.current = pageId;
    appliedMetadataSourceVersionRef.current = metadataSourceVersion;

    if (page) {
      setTitle(page.title);
      setPriority(databaseProperties?.priority);
      setEstimate(databaseProperties?.estimate || "none");
      setDueDate(
        databaseProperties?.dueDate
          ? databaseProperties.dueDate.toISOString().split("T")[0]
          : "",
      );
      if (databaseProperties) {
        const schedulePage = { ...page, ...databaseProperties };
        applyScheduleState(schedulePage);
        applyRecurrenceState(schedulePage);
      }
      setTags([...(databaseProperties?.tags ?? [])]);
      setAssignee(databaseProperties?.assignee || "");
      setRunInTarget(normalizeRunInTarget(page.runInTarget));
      setRunInLocalPath(page.runInLocalPath || "");
      setRunInBaseBranch(page.runInBaseBranch || "");
      setRunInWorktreePath(page.runInWorktreePath || "");
      setRunInEnvironmentPath(page.runInEnvironmentPath || "");
      setCurrentColumnId(columnId);
      prevPageRef.current = { page, databaseProperties, columnId };
      return;
    }

    setRunInTarget("localProject");
    setRunInLocalPath("");
    setRunInBaseBranch("");
    setRunInWorktreePath("");
    setRunInEnvironmentPath("");
    setRunInBranchState(EMPTY_BRANCH_SELECTOR_STATE);
    setRunInEnvironmentOptions([]);
    prevPageRef.current = null;
  }, [
    page,
    pageModel,
    clearAssigneeDraftDirty,
    columnId,
    databaseProperties,
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

  const hasChanges = useCallback(() => {
    if (!page) return false;
    const pageDueDate = databaseProperties?.dueDate
      ? databaseProperties.dueDate.toISOString().split("T")[0]
      : "";
    const databaseChanged = databaseProperties !== null && (
      priority !== databaseProperties.priority
      || estimate !== (databaseProperties.estimate || "none")
      || dueDate !== pageDueDate
      || assignee !== (databaseProperties.assignee || "")
      || JSON.stringify(tags) !== JSON.stringify(databaseProperties.tags)
    );
    return databaseChanged;
  }, [
    assignee,
    page,
    databaseProperties,
    dueDate,
    estimate,
    priority,
    tags,
  ]);

  const handleDocumentTitleChange = useCallback((value: string) => {
    setTitle(value);
    onTitleChange?.(value);
  }, [onTitleChange]);

  const handleAssigneeChange = useCallback(
    (value: string) => {
      markAssigneeDraftDirty();
      formStateRef.current.assignee = value;
      setAssignee(value);

      if (assigneeSaveTimerRef.current) {
        clearTimeout(assigneeSaveTimerRef.current);
      }

      assigneeSaveTimerRef.current = setTimeout(() => {
        assigneeSaveTimerRef.current = null;
        if (!page || !databaseProperties || value === (databaseProperties.assignee || "")) return;
        const endSaving = beginSaving();
        runAssigneeUpdate(page.id, value).finally(endSaving);
      }, FIELD_SAVE_DEBOUNCE_MS);
    },
    [beginSaving, page, databaseProperties, markAssigneeDraftDirty, runAssigneeUpdate],
  );

  const handleAssigneeBlur = useCallback(() => {
    if (assigneeSaveTimerRef.current) {
      clearTimeout(assigneeSaveTimerRef.current);
      assigneeSaveTimerRef.current = null;
    }

    if (!page || !databaseProperties) return;
    if (assignee === (databaseProperties.assignee || "")) {
      clearAssigneeDraftDirty();
      return;
    }
    const endSaving = beginSaving();
    runAssigneeUpdate(page.id, assignee).finally(endSaving);
  }, [assignee, beginSaving, page, clearAssigneeDraftDirty, databaseProperties, runAssigneeUpdate]);

  const handleSave = useCallback(async () => {
    if (!page || !hasChanges()) return;
    const endSaving = beginSaving();
    try {
      const result = await runUpdate(page.id, {
        ...(databaseProperties
          ? {
              ...toPriorityUpdate(priority, databaseProperties.priority),
              estimate:
                estimate === "none" ? null : (estimate as Estimate),
              dueDate: dueDate ? new Date(dueDate) : null,
              tags,
              assignee,
            }
          : {}),
      });
      clearAssigneeDraftDirtyFromAck(result, assignee);
    } finally {
      endSaving();
    }
  }, [
    beginSaving,
    page,
    hasChanges,
    runUpdate,
    clearAssigneeDraftDirtyFromAck,
    databaseProperties,
    priority,
    estimate,
    dueDate,
    tags,
    assignee,
  ]);

  const cancelPendingFieldSaves = useCallback(() => {
    if (!assigneeSaveTimerRef.current) return;
    clearTimeout(assigneeSaveTimerRef.current);
    assigneeSaveTimerRef.current = null;
  }, []);

  const handlePersist = useCallback(async () => {
    cancelPendingFieldSaves();

    saveCurrentScrollPosition();

    const metadataSave = hasChanges() ? handleSave() : Promise.resolve();
    const documentSave = persistDocument?.() ?? Promise.resolve();
    await Promise.all([metadataSave, documentSave]);
  }, [
    cancelPendingFieldSaves,
    hasChanges,
    handleSave,
    persistDocument,
    saveCurrentScrollPosition,
  ]);

  const handleClose = useCallback(async () => {
    await handlePersist();
    const sessionSnapshot = buildPageStageSessionSnapshot(projectId, page, title);
    if (sessionSnapshot) {
      onLeavePage?.(sessionSnapshot);
    }
    onClose();
  }, [page, handlePersist, onClose, onLeavePage, projectId, title]);

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
    const snapshot = buildPageStageSessionSnapshot(projectId, page, title);
    sessionSnapshotRef.current = snapshot;
    return () => {
      if (sessionSnapshotRef.current === snapshot) {
        sessionSnapshotRef.current = null;
      }
    };
  }, [page, isActivePanelTab, projectId, sessionSnapshotRef, title]);

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

  const handleOpenCodexThread = useCallback(async (threadId: string) => {
    if (!onOpenCodexThread) return;
    const endSaving = beginSaving();
    try {
      await onOpenCodexThread(threadId);
    } finally {
      endSaving();
    }
  }, [beginSaving, onOpenCodexThread]);

  const handleAddTag = useCallback((value?: string) => {
    const tag = (value ?? tagInput).trim().toLowerCase();
    if (!tag || tags.includes(tag)) return;
    const nextTags = [...tags, tag];
    setTags(nextTags);
    setTagInput("");
    setTagHighlight(-1);
    setTagDropdownOpen(false);
    saveProperty({ tags: nextTags });
  }, [saveProperty, tagInput, tags]);

  const handleRemoveTag = useCallback((tag: string) => {
    const nextTags = tags.filter((value) => value !== tag);
    setTags(nextTags);
    saveProperty({ tags: nextTags });
  }, [saveProperty, tags]);

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
      const result = await invoke("git:branch:state", requestedCwd);
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
    const normalizedProjectId = projectId.trim();
    if (!normalizedProjectId) {
      setRunInEnvironmentOptions([]);
      return [];
    }

    setRunInEnvironmentBusy(true);
    try {
      const result = await invoke("worktrees:environments:list", normalizedProjectId);
      const parsed = parseRunInEnvironmentOptions(result);
      setRunInEnvironmentOptions(parsed);
      return parsed;
    } catch {
      setRunInEnvironmentOptions([]);
      return [];
    } finally {
      setRunInEnvironmentBusy(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (runInTarget !== "newWorktree") return;
    void refreshRunInBranchState();
  }, [runInTarget, refreshRunInBranchState]);

  useEffect(() => {
    if (runInTarget !== "newWorktree" || runInWorktreePath.trim().length > 0) return;
    void refreshRunInEnvironmentOptions();
  }, [runInTarget, runInWorktreePath, refreshRunInEnvironmentOptions]);

  const handleRunInTargetChange = useCallback(async (nextTarget: PageRunInTarget) => {
    setRunInTarget(nextTarget);
    saveProperty({ runInTarget: nextTarget });

    if (nextTarget !== "newWorktree" || runInBaseBranch.trim().length > 0) return;
    const branchState = await refreshRunInBranchState();
    const defaultBranch = resolveDefaultRunInBaseBranch(branchState);
    if (!defaultBranch) return;
    setRunInBaseBranch(defaultBranch);
    saveProperty({ runInBaseBranch: defaultBranch });
  }, [runInBaseBranch, refreshRunInBranchState, saveProperty]);

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

  const handleSelectRunInBaseBranch = useCallback(async (branch: string) => {
    const normalized = branch.trim();
    if (!normalized) return false;
    setRunInBaseBranch(normalized);
    saveProperty({ runInBaseBranch: normalized });
    return true;
  }, [saveProperty]);

  const handleSelectRunInEnvironmentPath = useCallback(async (environmentPath: string | null) => {
    const normalized = environmentPath?.trim() || "";
    setRunInEnvironmentPath(normalized);
    saveProperty({ runInEnvironmentPath: normalized || null });
    return true;
  }, [saveProperty]);

  const handleOpenEnvironmentSettings = useCallback(async () => {
    if (!projectWorkspacePath?.trim()) return;
    onOpenLocalEnvironmentSettings?.({
      projectId,
      configPath: runInEnvironmentPath.trim() || null,
    });
  }, [onOpenLocalEnvironmentSettings, projectId, projectWorkspacePath, runInEnvironmentPath]);

  const handlePriorityChange = useCallback((next: Priority | null) => {
    const nextPriority = next ?? undefined;
    setPriority(nextPriority);
    saveProperty({ priority: nextPriority ?? null });
  }, [saveProperty]);

  const handleEstimateChange = useCallback((next: string) => {
    setEstimate(next);
    saveProperty({ estimate: next === "none" ? null : (next as Estimate) });
  }, [saveProperty]);

  const handleDueDateChange = useCallback((next: string) => {
    setDueDate(next);
    saveProperty({ dueDate: next ? new Date(next) : undefined });
  }, [saveProperty]);

  const handleClearDueDate = useCallback(() => {
    setDueDate("");
    saveProperty({ dueDate: null });
  }, [saveProperty]);

  const handleSetDueDateToday = useCallback(() => {
    const value = new Date().toISOString().split("T")[0];
    setDueDate(value);
    saveProperty({ dueDate: new Date(value) });
  }, [saveProperty]);

  const handleColumnChange = useCallback(async (nextColumnId: string) => {
    if (!page || !databaseProperties || !onMove || nextColumnId === currentColumnId) return;
    setCurrentColumnId(nextColumnId);
    await onMove(page.id, nextColumnId as typeof databaseProperties.status);
    onColumnIdChange?.(nextColumnId);
  }, [page, currentColumnId, databaseProperties, onMove, onColumnIdChange]);

  const handleTagInputBlur = useCallback(() => {
    setTimeout(() => {
      setTagDropdownOpen(false);
      setTagHighlight(-1);
      if (tags.length === 0 && !tagInput.trim()) {
        setTagInputActive(false);
      }
    }, TAG_BLUR_DELAY_MS);
  }, [tagInput, tags]);

  const hasThreadsRow = linkedCodexThreads.length > 0 || Boolean(onOpenNewCodexThread);
  const selectedRunInBaseBranch = runInBaseBranch.trim() || resolveDefaultRunInBaseBranch(runInBranchState);
  const runInLocalPathDisplay = runInLocalPath.trim();
  const runInWorktreePathDisplay = runInWorktreePath.trim();
  const runInEnvironmentPathDisplay = runInEnvironmentPath.trim();

  const collapseTagsByDefault = Boolean(databaseProperties)
    && collapsedProperties.includes("tags");
  const collapseAssigneeByDefault = Boolean(databaseProperties)
    && collapsedProperties.includes("assignee");
  const collapseThreadsByDefault = hasThreadsRow && collapsedProperties.includes("threads");
  const collapseScheduleByDefault = Boolean(databaseProperties)
    && collapsedProperties.includes("schedule");

  const collapsedPropertyCount = [
    collapseTagsByDefault,
    collapseAssigneeByDefault,
    collapseThreadsByDefault,
    collapseScheduleByDefault,
  ].filter(Boolean).length;

  const showCollapsedProperties = propertiesExpanded || collapsedPropertyCount === 0;

  const currentColumnName = KANBAN_STATUS_OPTIONS.find((status) => status.id === currentColumnId)?.name ?? columnName;
  const contentBodyClassName = [
    "mx-auto w-full px-(--page-stage-body-gutter-inline)",
    limitMainContentWidth ? "max-w-(--page-stage-body-max-width)" : "",
  ].filter(Boolean).join(" ");
  const contentShellClassName = "w-full";

  const collapsedPropertyLabel = formatPageStageCollapsedPropertyCountLabel(
    collapsedPropertyCount,
    propertiesExpanded,
  );

  return {
    page,
    hasDatabaseProperties: databaseProperties !== null,
    projectWorkspacePath,
    title,
    priority,
    estimate,
    dueDate,
    tagInput,
    tags,
    assignee,
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
    currentColumnId,
    limitMainContentWidth,
    showRawContent,
    historyPanelActive,
    linkedCodexThreads,
    tagHighlight,
    tagDropdownOpen,
    tagInputActive,
    tagOptions,
    tagCreateValue,
    showTagCreate,
    tagItemCount,
    hasTagDropdownItems,
    hasThreadsRow,
    selectedRunInBaseBranch,
    collapseTagsByDefault,
    collapseAssigneeByDefault,
    collapseThreadsByDefault,
    collapseScheduleByDefault,
    collapsedPropertyCount,
    showCollapsedProperties,
    currentColumnName,
    contentBodyClassName,
    contentShellClassName,
    scrollContainerRef,
    setScrollContainerRef,
    tagInputRef,
    tagDropdownRef,
    schedule,
    onOpenNewCodexThread,
    onOpenCodexThread,
    setPropertiesExpanded,
    setTagInput,
    setTagHighlight,
    setTagDropdownOpen,
    setTagInputActive,
    handleClose,
    handleDelete,
    handleToggleContentWidth,
    handleToggleShowRawContent,
    handleScroll,
    handleDocumentTitleChange,
    handlePriorityChange,
    handleEstimateChange,
    handleDueDateChange,
    handleClearDueDate,
    handleSetDueDateToday,
    handleColumnChange,
    handleAssigneeChange,
    handleAssigneeBlur,
    handleAddTag,
    handleRemoveTag,
    handleTagInputBlur,
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
