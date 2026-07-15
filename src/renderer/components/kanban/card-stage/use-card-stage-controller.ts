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
import { formatCardStageCollapsedPropertyCountLabel } from "@/lib/card-stage-collapsed-properties";
import {
  readCardStageContentWidthPreference,
  readCardStageShowRawContentPreference,
  writeCardStageContentWidthPreference,
  writeCardStageShowRawContentPreference,
} from "@/lib/card-stage-layout";
import { loadScrollPosition, rememberScrollPosition, saveScrollPosition } from "@/lib/card-stage-scroll";
import {
  FIELD_SAVE_DEBOUNCE_MS,
  SCROLL_SAVE_DEBOUNCE_MS,
  TAG_BLUR_DELAY_MS,
} from "@/lib/timing";
import type {
  CardInput,
  CardRunInTarget,
  Estimate,
  Priority,
  WorktreeEnvironmentOption,
} from "@/lib/types";
import type {
  CardStageCardModel,
  CardStageCoreCard,
  CardStageDatabaseProperties,
} from "@/lib/card-stage-card";
import { useScheduleState } from "@/lib/use-schedule-state";
import { useCardStageCollapsedProperties } from "@/lib/use-card-stage-collapsed-properties";
import { KANBAN_STATUS_OPTIONS } from "@/lib/kanban-options";
import {
  clearCardDraftOverlay,
  setCardDraftOverlay,
} from "../../../lib/card-draft-store";
import {
  buildCardStageDraftOverlay,
} from "./card-stage-draft-sync";
import { normalizeRunInTarget, resolveDefaultRunInBaseBranch } from "./options";
import type {
  CardStageMetadataMutationResult,
  CardStageProps,
  CardStageSessionSnapshot,
} from "./types";

interface UseCardStageControllerResult {
  card: CardStageCoreCard | null;
  hasDatabaseProperties: boolean;
  projectWorkspacePath?: string | null;
  title: string;
  priority?: Priority;
  estimate: string;
  dueDate: string;
  tagInput: string;
  tags: string[];
  assignee: string;
  agentStatus: string;
  agentBlocked: boolean;
  runInTarget: CardRunInTarget;
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
  linkedCodexThreads: NonNullable<CardStageProps["linkedCodexThreads"]>;
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
  collapseAgentBlockedByDefault: boolean;
  collapseAgentStatusByDefault: boolean;
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
  onToggleHistoryPanel?: () => void;
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
  handleAgentStatusChange: (value: string) => void;
  handleAgentStatusBlur: () => void;
  handleToggleAgentBlocked: () => void;
  handleAddTag: (value?: string) => void;
  handleRemoveTag: (tag: string) => void;
  handleTagInputBlur: () => void;
  handleRunInTargetChange: (nextTarget: CardRunInTarget) => Promise<void>;
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

export interface CardStageControllerDependencies {
  /** Flushes the primary owned Document through its durable provider. */
  readonly persistDocument?: () => Promise<void>;
}

type DraftFieldKey = "assignee" | "agentStatus";
type DraftDirtyState = Record<DraftFieldKey, boolean>;

interface CardStageFormState {
  priority: Priority | undefined;
  estimate: string;
  dueDate: string;
  tags: string[];
  assignee: string;
  agentStatus: string;
  agentBlocked: boolean;
}

interface CardStageMetadataSourceVersion {
  readonly cardId: string;
  readonly metadataRevision: number;
  readonly databaseMembershipId: string | null;
  readonly hasCompatibilityProperties: boolean;
}

function readCardStageMetadataSourceVersion(
  cardModel: CardStageCardModel | null,
): CardStageMetadataSourceVersion | null {
  if (!cardModel) return null;

  const databaseContext = cardModel.databaseContext;
  return {
    cardId: cardModel.card.id,
    metadataRevision: cardModel.card.revision,
    databaseMembershipId:
      databaseContext.kind === "member"
        ? databaseContext.membership.id
        : null,
    hasCompatibilityProperties:
      databaseContext.kind === "member"
      && databaseContext.compatibilityProperties !== null,
  };
}

function areCardStageMetadataSourceVersionsEqual(
  left: CardStageMetadataSourceVersion | null,
  right: CardStageMetadataSourceVersion | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;

  return left.cardId === right.cardId
    && left.metadataRevision === right.metadataRevision
    && left.databaseMembershipId === right.databaseMembershipId
    && left.hasCompatibilityProperties === right.hasCompatibilityProperties;
}

function toPriorityUpdate(
  nextPriority: Priority | undefined,
  currentPriority: Priority | undefined,
): Partial<CardInput> {
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

function readFormDraftField(state: CardStageFormState, field: DraftFieldKey): string {
  if (field === "assignee") return state.assignee;
  return state.agentStatus;
}

function buildCardStageSessionSnapshot(
  projectId: string,
  card: CardStageCoreCard | null,
  title: string,
): CardStageSessionSnapshot | null {
  if (!card) return null;

  const titleSnapshot = title.trim() || card.title.trim() || card.id;
  return {
    projectId,
    cardId: card.id,
    titleSnapshot,
  };
}

function elementHasLayoutBox(element: HTMLElement): boolean {
  return element.isConnected && element.getClientRects().length > 0;
}

export function useCardStageController(
  props: CardStageProps,
  dependencies: CardStageControllerDependencies = {},
): UseCardStageControllerResult {
  const {
    onClose,
    onLeaveCard,
    onTitleChange,
    closeRef,
    persistRef,
    sessionSnapshotRef,
    card: cardModel,
    projectId,
    projectWorkspacePath,
    availableTags,
    onUpdate,
    onDelete,
    onMove,
    onCompleteOccurrence,
    onSkipOccurrence,
    onColumnIdChange,
    onToggleHistoryPanel,
    linkedCodexThreads = [],
    onOpenCodexThread,
    onOpenNewCodexThread,
    onOpenLocalEnvironmentSettings,
    historyPanelActive = false,
    isActivePanelTab = true,
  } = props;
  const card = cardModel?.card ?? null;
  const databaseProperties =
    cardModel?.databaseContext.kind === "member"
      ? cardModel.databaseContext.compatibilityProperties
      : null;
  const columnId = databaseProperties?.status ?? "";
  const columnName = KANBAN_STATUS_OPTIONS.find(
    (status) => status.id === columnId,
  )?.name ?? "";
  const persistDocument = dependencies.persistDocument;

  const [title, setTitle] = useState(card?.title ?? "");
  const [priority, setPriority] = useState<Priority | undefined>(undefined);
  const [estimate, setEstimate] = useState<string>("none");
  const [dueDate, setDueDate] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [assignee, setAssignee] = useState("");
  const [agentStatus, setAgentStatus] = useState("");
  const [agentBlocked, setAgentBlocked] = useState(false);
  const [runInTarget, setRunInTarget] = useState<CardRunInTarget>("localProject");
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
    readCardStageContentWidthPreference(),
  );
  const [showRawContent, setShowRawContent] = useState(() =>
    readCardStageShowRawContentPreference(),
  );
  const { collapsedProperties } = useCardStageCollapsedProperties();

  const tagInputRef = useRef<HTMLInputElement>(null);
  const tagDropdownRef = useRef<HTMLDivElement>(null);
  const [tagHighlight, setTagHighlight] = useState(-1);
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);

  const prevCardRef = useRef<{
    card: CardStageCoreCard;
    databaseProperties: CardStageDatabaseProperties | null;
    columnId: string;
  } | null>(null);
  const currentCardIdRef = useRef<string | null>(null);
  const appliedMetadataSourceVersionRef =
    useRef<CardStageMetadataSourceVersion | null>(null);
  const assigneeSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const agentStatusSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const lastScrollRestoreCardRef = useRef<string | null>(null);
  const scrollSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const previousActivePanelTabRef = useRef(isActivePanelTab);
  const lastKnownScrollTopRef = useRef<{ cardId: string; scrollTop: number } | null>(null);
  const scrollRestoreVersionRef = useRef(0);
  const draftDirtyRef = useRef<DraftDirtyState>({
    assignee: false,
    agentStatus: false,
  });

  const formStateRef = useRef<CardStageFormState>({
    priority: undefined as Priority | undefined,
    estimate: "none",
    dueDate: "",
    tags: [] as string[],
    assignee: "",
    agentStatus: "",
    agentBlocked: false,
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

  const markDraftDirty = useCallback((field: DraftFieldKey) => {
    draftDirtyRef.current[field] = true;
  }, []);

  const clearDraftDirty = useCallback((field: DraftFieldKey) => {
    draftDirtyRef.current[field] = false;
  }, []);

  const clearAllDraftDirty = useCallback(() => {
    draftDirtyRef.current.assignee = false;
    draftDirtyRef.current.agentStatus = false;
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
      nextCardId: string,
      updates: Partial<CardInput>,
    ): Promise<CardStageMetadataMutationResult> => {
      const result = await onUpdate(nextCardId, updates);
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
  const runPreviousCardUpdate = useEffectEvent(
    (nextCardId: string, updates: Partial<CardInput>) =>
      runUpdate(nextCardId, updates),
  );

  const clearDraftDirtyFromAck = useCallback(
    (
      result: CardStageMetadataMutationResult,
      expectedValues: Partial<Record<DraftFieldKey, string>>,
    ) => {
      if (result.status !== "updated") return;

      for (const field of Object.keys(expectedValues) as DraftFieldKey[]) {
        const expectedValue = expectedValues[field];
        if (expectedValue === undefined) continue;
        if (readFormDraftField(formStateRef.current, field) !== expectedValue) continue;
        draftDirtyRef.current[field] = false;
      }
    },
    [],
  );

  const runDraftFieldUpdate = useCallback(
    async (
      nextCardId: string,
      field: DraftFieldKey,
      updates: Partial<CardInput>,
      expectedValue: string,
    ): Promise<CardStageMetadataMutationResult> => {
      const result = await runUpdate(nextCardId, updates);
      clearDraftDirtyFromAck(result, { [field]: expectedValue });
      return result;
    },
    [clearDraftDirtyFromAck, runUpdate],
  );

  const saveProperty = useCallback(
    (updates: Partial<CardInput>) => {
      if (!card) return;
      const endSaving = beginSaving();
      runUpdate(card.id, updates).finally(endSaving);
    },
    [beginSaving, card, runUpdate],
  );

  const scheduleCard = card && databaseProperties
    ? { ...card, ...databaseProperties }
    : null;
  const schedule = useScheduleState({
    card: scheduleCard,
    saveProperty,
    onCompleteOccurrence: databaseProperties ? onCompleteOccurrence : undefined,
    onSkipOccurrence: databaseProperties ? onSkipOccurrence : undefined,
  });
  const applyRecurrenceState = schedule.applyRecurrenceState;
  const applyScheduleState = schedule.applyScheduleState;
  const draftOverlayCardId = card?.id ?? null;

  useEffect(() => {
    formStateRef.current = {
      priority,
      estimate,
      dueDate,
      tags,
      assignee,
      agentStatus,
      agentBlocked,
    };
  }, [priority, estimate, dueDate, tags, assignee, agentStatus, agentBlocked]);

  useEffect(() => {
    if (!draftOverlayCardId) return;

    return () => {
      clearCardDraftOverlay(projectId, draftOverlayCardId);
    };
  }, [draftOverlayCardId, projectId]);

  useEffect(() => {
    if (!card) return;

    const overlay = buildCardStageDraftOverlay({
      assignee: databaseProperties?.assignee,
      agentStatus: card.agentStatus,
    }, {
      assignee,
      agentStatus,
    });

    setCardDraftOverlay(projectId, card.id, overlay);
  }, [agentStatus, assignee, card, databaseProperties?.assignee, projectId]);

  const rememberScrollTopForCard = useCallback((cardId: string | null, scrollTop: number) => {
    if (!cardId) return;
    lastKnownScrollTopRef.current = { cardId, scrollTop };
    rememberScrollPosition(projectId, cardId, scrollTop);
  }, [projectId]);

  const saveScrollTopForCard = useCallback((cardId: string | null, scrollTop: number) => {
    if (!cardId) return;
    lastKnownScrollTopRef.current = { cardId, scrollTop };
    saveScrollPosition(projectId, cardId, scrollTop);
  }, [projectId]);

  const readCurrentScrollTopForCard = useCallback((cardId: string, element: HTMLDivElement | null) => {
    if (element && elementHasLayoutBox(element)) {
      return element.scrollTop;
    }

    const lastKnown = lastKnownScrollTopRef.current;
    if (lastKnown?.cardId === cardId) return lastKnown.scrollTop;
    if (element && element.scrollTop > 0) return element.scrollTop;
    return null;
  }, []);

  const saveCurrentScrollPosition = useCallback(() => {
    const cardId = currentCardIdRef.current;
    const element = scrollContainerRef.current;
    if (!cardId) return;
    const scrollTop = readCurrentScrollTopForCard(cardId, element);
    if (scrollTop === null) return;
    saveScrollTopForCard(cardId, scrollTop);
  }, [readCurrentScrollTopForCard, saveScrollTopForCard]);

  const restoreScrollPositionForCard = useCallback((
    cardId: string,
    options: { resetWhenMissing: boolean },
  ) => {
    const element = scrollContainerRef.current;
    if (!element) return;

    scrollRestoreVersionRef.current += 1;
    const restoreVersion = scrollRestoreVersionRef.current;
    const saved = loadScrollPosition(projectId, cardId);
    if (saved === null) {
      if (options.resetWhenMissing) element.scrollTop = 0;
      return;
    }

    element.scrollTop = saved;
    lastKnownScrollTopRef.current = { cardId, scrollTop: saved };

    if (typeof requestAnimationFrame !== "function") return;
    let remainingFrames = 2;
    const retryRestore = () => {
      if (scrollRestoreVersionRef.current !== restoreVersion) return;
      const currentCardId = currentCardIdRef.current;
      if (currentCardId !== null && currentCardId !== cardId) return;
      const currentElement = scrollContainerRef.current;
      if (!currentElement) return;
      currentElement.scrollTop = saved;
      lastKnownScrollTopRef.current = { cardId, scrollTop: saved };
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
    const cardId = currentCardIdRef.current;
    if (!node || !cardId) return;
    restoreScrollPositionForCard(cardId, { resetWhenMissing: false });
  }, [restoreScrollPositionForCard, saveCurrentScrollPosition]);

  useEffect(() => {
    const cardId = card?.id ?? null;
    const metadataSourceVersion = readCardStageMetadataSourceVersion(cardModel);
    const prevCardId = currentCardIdRef.current;
    if (cardId === prevCardId) {
      if (!card) return;

      // Command callbacks and projection objects may be recreated by a parent
      // render. Metadata revision and Database membership are the authority for
      // whether this external form snapshot changed. Record the latest objects
      // for card-switch flushing, but never dispatch React state for an already
      // applied source version.
      prevCardRef.current = { card, databaseProperties, columnId };
      if (areCardStageMetadataSourceVersionsEqual(
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
      const nextRunInTarget = normalizeRunInTarget(card.runInTarget);
      const nextRunInLocalPath = card.runInLocalPath || "";
      const nextRunInBaseBranch = card.runInBaseBranch || "";
      const nextRunInWorktreePath = card.runInWorktreePath || "";
      const nextRunInEnvironmentPath = card.runInEnvironmentPath || "";

      const assigneeDirty = draftDirtyRef.current.assignee;
      const agentStatusDirty = draftDirtyRef.current.agentStatus;

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
        draftDirtyRef.current.assignee = false;
        setAssignee((current) => (
          current === (databaseProperties?.assignee || "")
            ? current
            : (databaseProperties?.assignee || "")
        ));
      }
      if (!agentStatusDirty || state.agentStatus === (card.agentStatus || "")) {
        draftDirtyRef.current.agentStatus = false;
        setAgentStatus((current) => (current === (card.agentStatus || "") ? current : (card.agentStatus || "")));
      }
      setAgentBlocked((current) => (current === card.agentBlocked ? current : card.agentBlocked));
      setRunInTarget((current) => (current === nextRunInTarget ? current : nextRunInTarget));
      setRunInLocalPath((current) => (current === nextRunInLocalPath ? current : nextRunInLocalPath));
      setRunInBaseBranch((current) => (current === nextRunInBaseBranch ? current : nextRunInBaseBranch));
      setRunInWorktreePath((current) => (current === nextRunInWorktreePath ? current : nextRunInWorktreePath));
      setRunInEnvironmentPath((current) => (
        current === nextRunInEnvironmentPath ? current : nextRunInEnvironmentPath
      ));
      setCurrentColumnId((current) => (current === columnId ? current : columnId));
      if (databaseProperties) {
        const scheduleCard = { ...card, ...databaseProperties };
        applyScheduleState(scheduleCard);
        applyRecurrenceState(scheduleCard);
      }
      return;
    }

    for (const ref of [assigneeSaveTimerRef, agentStatusSaveTimerRef]) {
      if (!ref.current) continue;
      clearTimeout(ref.current);
      ref.current = null;
    }
    clearAllDraftDirty();

    if (prevCardId) {
      const scrollTop = readCurrentScrollTopForCard(prevCardId, scrollContainerRef.current);
      if (scrollTop !== null) saveScrollTopForCard(prevCardId, scrollTop);
    }

    const prevCard = prevCardRef.current;
    if (prevCard && card && prevCard.card.id !== card.id) {
      const state = formStateRef.current;
      const targetCard = prevCard.card;
      const targetDatabase = prevCard.databaseProperties;
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
      ) || state.agentStatus !== (targetCard.agentStatus || "")
        || state.agentBlocked !== targetCard.agentBlocked
      ;

      if (hasAnyChanges) {
        void runPreviousCardUpdate(targetCard.id, {
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
          agentStatus: state.agentStatus,
          agentBlocked: state.agentBlocked,
        });
      }
    }

    currentCardIdRef.current = cardId;
    appliedMetadataSourceVersionRef.current = metadataSourceVersion;

    if (card) {
      setTitle(card.title);
      setPriority(databaseProperties?.priority);
      setEstimate(databaseProperties?.estimate || "none");
      setDueDate(
        databaseProperties?.dueDate
          ? databaseProperties.dueDate.toISOString().split("T")[0]
          : "",
      );
      if (databaseProperties) {
        const scheduleCard = { ...card, ...databaseProperties };
        applyScheduleState(scheduleCard);
        applyRecurrenceState(scheduleCard);
      }
      setTags([...(databaseProperties?.tags ?? [])]);
      setAssignee(databaseProperties?.assignee || "");
      setAgentStatus(card.agentStatus || "");
      setAgentBlocked(card.agentBlocked);
      setRunInTarget(normalizeRunInTarget(card.runInTarget));
      setRunInLocalPath(card.runInLocalPath || "");
      setRunInBaseBranch(card.runInBaseBranch || "");
      setRunInWorktreePath(card.runInWorktreePath || "");
      setRunInEnvironmentPath(card.runInEnvironmentPath || "");
      setCurrentColumnId(columnId);
      prevCardRef.current = { card, databaseProperties, columnId };
      return;
    }

    setRunInTarget("localProject");
    setRunInLocalPath("");
    setRunInBaseBranch("");
    setRunInWorktreePath("");
    setRunInEnvironmentPath("");
    setRunInBranchState(EMPTY_BRANCH_SELECTOR_STATE);
    setRunInEnvironmentOptions([]);
    prevCardRef.current = null;
  }, [
    card,
    cardModel,
    clearAllDraftDirty,
    columnId,
    databaseProperties,
    readCurrentScrollTopForCard,
    saveScrollTopForCard,
    applyRecurrenceState,
    applyScheduleState,
  ]);

  useLayoutEffect(() => {
    const cardId = card?.id ?? null;
    if (!cardId) return;

    const resetWhenMissing = lastScrollRestoreCardRef.current !== cardId;
    lastScrollRestoreCardRef.current = cardId;
    restoreScrollPositionForCard(cardId, { resetWhenMissing });
  }, [card?.id, restoreScrollPositionForCard]);

  const handleScroll = useCallback(() => {
    const cardId = currentCardIdRef.current;
    const element = scrollContainerRef.current;
    if (!cardId || !element) return;

    const scrollTop = element.scrollTop;
    rememberScrollTopForCard(cardId, scrollTop);
    if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current);
    scrollSaveTimerRef.current = setTimeout(() => {
      saveScrollTopForCard(cardId, scrollTop);
      scrollSaveTimerRef.current = null;
    }, SCROLL_SAVE_DEBOUNCE_MS);
  }, [rememberScrollTopForCard, saveScrollTopForCard]);

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
    if (!card) return false;
    const cardDueDate = databaseProperties?.dueDate
      ? databaseProperties.dueDate.toISOString().split("T")[0]
      : "";
    const databaseChanged = databaseProperties !== null && (
      priority !== databaseProperties.priority
      || estimate !== (databaseProperties.estimate || "none")
      || dueDate !== cardDueDate
      || assignee !== (databaseProperties.assignee || "")
      || JSON.stringify(tags) !== JSON.stringify(databaseProperties.tags)
    );
    return databaseChanged
      || agentStatus !== (card.agentStatus || "")
      || agentBlocked !== card.agentBlocked
    ;
  }, [
    agentBlocked,
    agentStatus,
    assignee,
    card,
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
      markDraftDirty("assignee");
      formStateRef.current.assignee = value;
      setAssignee(value);

      if (assigneeSaveTimerRef.current) {
        clearTimeout(assigneeSaveTimerRef.current);
      }

      assigneeSaveTimerRef.current = setTimeout(() => {
        assigneeSaveTimerRef.current = null;
        if (!card || !databaseProperties || value === (databaseProperties.assignee || "")) return;
        const endSaving = beginSaving();
        runDraftFieldUpdate(card.id, "assignee", { assignee: value }, value).finally(endSaving);
      }, FIELD_SAVE_DEBOUNCE_MS);
    },
    [beginSaving, card, databaseProperties, markDraftDirty, runDraftFieldUpdate],
  );

  const handleAssigneeBlur = useCallback(() => {
    if (assigneeSaveTimerRef.current) {
      clearTimeout(assigneeSaveTimerRef.current);
      assigneeSaveTimerRef.current = null;
    }

    if (!card || !databaseProperties) return;
    if (assignee === (databaseProperties.assignee || "")) {
      clearDraftDirty("assignee");
      return;
    }
    const endSaving = beginSaving();
    runDraftFieldUpdate(card.id, "assignee", { assignee }, assignee).finally(endSaving);
  }, [assignee, beginSaving, card, clearDraftDirty, databaseProperties, runDraftFieldUpdate]);

  const handleAgentStatusChange = useCallback(
    (value: string) => {
      markDraftDirty("agentStatus");
      formStateRef.current.agentStatus = value;
      setAgentStatus(value);

      if (agentStatusSaveTimerRef.current) {
        clearTimeout(agentStatusSaveTimerRef.current);
      }

      agentStatusSaveTimerRef.current = setTimeout(() => {
        agentStatusSaveTimerRef.current = null;
        if (!card || value === (card.agentStatus || "")) return;
        const endSaving = beginSaving();
        runDraftFieldUpdate(card.id, "agentStatus", { agentStatus: value }, value).finally(endSaving);
      }, FIELD_SAVE_DEBOUNCE_MS);
    },
    [beginSaving, card, markDraftDirty, runDraftFieldUpdate],
  );

  const handleAgentStatusBlur = useCallback(() => {
    if (agentStatusSaveTimerRef.current) {
      clearTimeout(agentStatusSaveTimerRef.current);
      agentStatusSaveTimerRef.current = null;
    }

    if (!card) return;
    if (agentStatus === (card.agentStatus || "")) {
      clearDraftDirty("agentStatus");
      return;
    }
    const endSaving = beginSaving();
    runDraftFieldUpdate(card.id, "agentStatus", { agentStatus }, agentStatus).finally(endSaving);
  }, [agentStatus, beginSaving, card, clearDraftDirty, runDraftFieldUpdate]);

  const handleSave = useCallback(async () => {
    if (!card || !hasChanges()) return;
    const endSaving = beginSaving();
    try {
      const result = await runUpdate(card.id, {
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
        agentStatus,
        agentBlocked,
      });
      clearDraftDirtyFromAck(result, {
        assignee,
        agentStatus,
      });
    } finally {
      endSaving();
    }
  }, [
    beginSaving,
    card,
    hasChanges,
    runUpdate,
    clearDraftDirtyFromAck,
    databaseProperties,
    priority,
    estimate,
    dueDate,
    tags,
    assignee,
    agentStatus,
    agentBlocked,
  ]);

  const cancelPendingFieldSaves = useCallback(() => {
    for (const ref of [assigneeSaveTimerRef, agentStatusSaveTimerRef]) {
      if (!ref.current) continue;
      clearTimeout(ref.current);
      ref.current = null;
    }
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
    const sessionSnapshot = buildCardStageSessionSnapshot(projectId, card, title);
    if (sessionSnapshot) {
      onLeaveCard?.(sessionSnapshot);
    }
    onClose();
  }, [card, handlePersist, onClose, onLeaveCard, projectId, title]);

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
    const snapshot = buildCardStageSessionSnapshot(projectId, card, title);
    sessionSnapshotRef.current = snapshot;
    return () => {
      if (sessionSnapshotRef.current === snapshot) {
        sessionSnapshotRef.current = null;
      }
    };
  }, [card, isActivePanelTab, projectId, sessionSnapshotRef, title]);

  useEffect(() => {
    const wasActive = previousActivePanelTabRef.current;
    previousActivePanelTabRef.current = isActivePanelTab;
    if (!wasActive || isActivePanelTab) return;
    void handlePersist();
  }, [handlePersist, isActivePanelTab]);

  const handleDelete = useCallback(async () => {
    if (!card || !onDelete) return;
    const endSaving = beginSaving();
    try {
      await onDelete(card.id);
      onClose();
    } finally {
      endSaving();
    }
  }, [beginSaving, card, onDelete, onClose]);

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
      writeCardStageContentWidthPreference(next);
      return next;
    });
  }, []);

  const handleToggleShowRawContent = useCallback(() => {
    setShowRawContent((current) => {
      const next = !current;
      writeCardStageShowRawContentPreference(next);
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

  const handleRunInTargetChange = useCallback(async (nextTarget: CardRunInTarget) => {
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
    if (!card || !databaseProperties || !onMove || nextColumnId === currentColumnId) return;
    setCurrentColumnId(nextColumnId);
    await onMove(card.id, nextColumnId as typeof databaseProperties.status);
    onColumnIdChange?.(nextColumnId);
  }, [card, currentColumnId, databaseProperties, onMove, onColumnIdChange]);

  const handleToggleAgentBlocked = useCallback(() => {
    const next = !agentBlocked;
    setAgentBlocked(next);
    saveProperty({ agentBlocked: next });
  }, [agentBlocked, saveProperty]);

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
  const collapseAgentBlockedByDefault = collapsedProperties.includes("agentBlocked");
  const collapseAgentStatusByDefault = collapsedProperties.includes("agentStatus");

  const collapsedPropertyCount = [
    collapseTagsByDefault,
    collapseAssigneeByDefault,
    collapseThreadsByDefault,
    collapseScheduleByDefault,
    collapseAgentBlockedByDefault,
    collapseAgentStatusByDefault,
  ].filter(Boolean).length;

  const showCollapsedProperties = propertiesExpanded || collapsedPropertyCount === 0;

  const currentColumnName = KANBAN_STATUS_OPTIONS.find((status) => status.id === currentColumnId)?.name ?? columnName;
  const contentBodyClassName = [
    "mx-auto w-full px-(--card-stage-body-gutter-inline)",
    limitMainContentWidth ? "max-w-(--card-stage-body-max-width)" : "",
  ].filter(Boolean).join(" ");
  const contentShellClassName = "w-full";

  const collapsedPropertyLabel = formatCardStageCollapsedPropertyCountLabel(
    collapsedPropertyCount,
    propertiesExpanded,
  );

  return {
    card,
    hasDatabaseProperties: databaseProperties !== null,
    projectWorkspacePath,
    title,
    priority,
    estimate,
    dueDate,
    tagInput,
    tags,
    assignee,
    agentStatus,
    agentBlocked,
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
    collapseAgentBlockedByDefault,
    collapseAgentStatusByDefault,
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
    onToggleHistoryPanel,
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
    handleAgentStatusChange,
    handleAgentStatusBlur,
    handleToggleAgentBlocked,
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

export type CardStageController = UseCardStageControllerResult;
