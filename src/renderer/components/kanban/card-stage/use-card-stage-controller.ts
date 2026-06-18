import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { loadScrollPosition, saveScrollPosition } from "@/lib/card-stage-scroll";
import {
  DESCRIPTION_SAVE_DEBOUNCE_MS,
  FIELD_SAVE_DEBOUNCE_MS,
  SCROLL_SAVE_DEBOUNCE_MS,
  TAG_BLUR_DELAY_MS,
} from "@/lib/timing";
import type {
  Card,
  CardInput,
  CardRunInTarget,
  CardUpdateMutationResult,
  Estimate,
  Priority,
  WorktreeEnvironmentOption,
} from "@/lib/types";
import { useScheduleState } from "@/lib/use-schedule-state";
import { useCardStageCollapsedProperties } from "@/lib/use-card-stage-collapsed-properties";
import { KANBAN_STATUS_OPTIONS } from "@/lib/kanban-options";
import {
  clearCardDraftOverlay,
  setCardDraftOverlay,
} from "../../../lib/card-draft-store";
import {
  buildCardStageDraftOverlay,
  shouldPublishCardStagePatch,
} from "./card-stage-draft-sync";
import { normalizeRunInTarget, resolveDefaultRunInBaseBranch } from "./options";
import type { CardStageDescriptionFlushHandle, CardStageProps, CardStageSessionSnapshot } from "./types";

interface UseCardStageControllerResult {
  card: Card | null;
  projectWorkspacePath?: string | null;
  title: string;
  description: string;
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
  contentGutterClassName: string;
  contentShellClassName: string;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  descriptionFlushHandleRef: React.MutableRefObject<CardStageDescriptionFlushHandle | null>;
  tagInputRef: React.RefObject<HTMLInputElement | null>;
  tagDropdownRef: React.RefObject<HTMLDivElement | null>;
  schedule: ReturnType<typeof useScheduleState>;
  updateConflict: {
    columnId: string;
    latestCard: Card;
  } | null;
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
  handleTitleChange: (value: string) => void;
  handleTitleBlur: () => void;
  handleDescriptionChange: (value: string) => void;
  handleDescriptionBlur: () => void;
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
  handleReloadLatest: () => void;
  handleOverwriteMine: () => Promise<void>;
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

type DraftFieldKey = "title" | "description" | "assignee" | "agentStatus";
type DraftDirtyState = Record<DraftFieldKey, boolean>;

interface CardStageUpdateConflictState {
  cardId: string;
  columnId: string;
  latestCard: Card;
  attemptedUpdates: Partial<CardInput>;
}

interface CardStageFormState {
  title: string;
  description: string;
  priority: Priority | undefined;
  estimate: string;
  dueDate: string;
  tags: string[];
  assignee: string;
  agentStatus: string;
  agentBlocked: boolean;
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

function readCardDraftField(card: Card, field: DraftFieldKey): string {
  if (field === "title") return card.title;
  if (field === "description") return card.description ?? "";
  if (field === "assignee") return card.assignee ?? "";
  return card.agentStatus ?? "";
}

function readFormDraftField(state: CardStageFormState, field: DraftFieldKey): string {
  if (field === "title") return state.title;
  if (field === "description") return state.description;
  if (field === "assignee") return state.assignee;
  return state.agentStatus;
}

function buildCardStageSessionSnapshot(
  projectId: string,
  card: Card | null,
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

export function useCardStageController(props: CardStageProps): UseCardStageControllerResult {
  const {
    onClose,
    onLeaveCard,
    closeRef,
    persistRef,
    sessionSnapshotRef,
    card,
    columnId,
    columnName,
    projectId,
    projectWorkspacePath,
    availableTags,
    onUpdate,
    onPatch,
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
  } = props;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState(card?.description ?? "");
  const latestDescriptionRef = useRef(card?.description ?? "");
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
  const [saving, setSaving] = useState(false);
  const [updateConflict, setUpdateConflict] = useState<CardStageUpdateConflictState | null>(null);
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

  const prevCardRef = useRef<{ card: Card; columnId: string } | null>(null);
  const currentCardIdRef = useRef<string | null>(null);
  const descriptionSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const titleSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const assigneeSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const agentStatusSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const descriptionFlushHandleRef = useRef<CardStageDescriptionFlushHandle | null>(null);
  const prevRestoreCardRef = useRef<string | null>(null);
  const scrollSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const draftDirtyRef = useRef<DraftDirtyState>({
    title: false,
    description: false,
    assignee: false,
    agentStatus: false,
  });

  const formStateRef = useRef<CardStageFormState>({
    title: "",
    description: "",
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
    draftDirtyRef.current.title = false;
    draftDirtyRef.current.description = false;
    draftDirtyRef.current.assignee = false;
    draftDirtyRef.current.agentStatus = false;
  }, []);

  const flushDescriptionEditorChange = useCallback(() => {
    const flushed = descriptionFlushHandleRef.current?.flushPendingChange();
    if (typeof flushed === "string") {
      latestDescriptionRef.current = flushed;
      formStateRef.current.description = flushed;
      setDescription(flushed);
    }
    return latestDescriptionRef.current;
  }, []);

  const runUpdate = useCallback(
    async (
      nextColumnId: string,
      nextCardId: string,
      updates: Partial<CardInput>,
    ): Promise<CardUpdateMutationResult> => {
      const result = await onUpdate(nextColumnId, nextCardId, updates);
      if (!result) {
        return {
          status: "error",
          error: "Missing update result",
        };
      }
      if (result.status === "updated") {
        setUpdateConflict(null);
        return result;
      }
      if (result.status === "conflict") {
        setUpdateConflict({
          cardId: nextCardId,
          columnId: result.card.status,
          latestCard: result.card,
          attemptedUpdates: updates,
        });
        setCurrentColumnId(result.card.status);
        return result;
      }
      return result;
    },
    [onUpdate],
  );

  const clearDraftDirtyFromAck = useCallback(
    (
      result: CardUpdateMutationResult,
      expectedValues: Partial<Record<DraftFieldKey, string>>,
    ) => {
      if (result.status !== "updated") return;

      for (const field of Object.keys(expectedValues) as DraftFieldKey[]) {
        const expectedValue = expectedValues[field];
        if (expectedValue === undefined) continue;
        if (readCardDraftField(result.card, field) !== expectedValue) continue;
        if (readFormDraftField(formStateRef.current, field) !== expectedValue) continue;
        draftDirtyRef.current[field] = false;
      }
    },
    [],
  );

  const runDraftFieldUpdate = useCallback(
    async (
      nextColumnId: string,
      nextCardId: string,
      field: DraftFieldKey,
      updates: Partial<CardInput>,
      expectedValue: string,
    ): Promise<CardUpdateMutationResult> => {
      const result = await runUpdate(nextColumnId, nextCardId, updates);
      clearDraftDirtyFromAck(result, { [field]: expectedValue });
      return result;
    },
    [clearDraftDirtyFromAck, runUpdate],
  );

  const saveProperty = useCallback(
    (updates: Partial<CardInput>) => {
      if (!card) return;
      setSaving(true);
      runUpdate(columnId, card.id, updates).finally(() => setSaving(false));
    },
    [card, columnId, runUpdate],
  );

  const schedule = useScheduleState({
    card,
    saveProperty,
    onCompleteOccurrence,
    onSkipOccurrence,
  });

  const applyCardToDraftState = useCallback((nextCard: Card, nextColumnId: string) => {
    clearAllDraftDirty();
    latestDescriptionRef.current = nextCard.description ?? "";
    setTitle(nextCard.title);
    setDescription(nextCard.description ?? "");
    setPriority(nextCard.priority);
    setEstimate(nextCard.estimate || "none");
    setDueDate(nextCard.dueDate ? nextCard.dueDate.toISOString().split("T")[0] : "");
    setTags(nextCard.tags);
    setAssignee(nextCard.assignee || "");
    setAgentStatus(nextCard.agentStatus || "");
    setAgentBlocked(nextCard.agentBlocked);
    setRunInTarget(normalizeRunInTarget(nextCard.runInTarget));
    setRunInLocalPath(nextCard.runInLocalPath || "");
    setRunInBaseBranch(nextCard.runInBaseBranch || "");
    setRunInWorktreePath(nextCard.runInWorktreePath || "");
    setRunInEnvironmentPath(nextCard.runInEnvironmentPath || "");
    setCurrentColumnId(nextColumnId);
    schedule.applyScheduleState(nextCard);
    schedule.applyRecurrenceState(nextCard);
  }, [clearAllDraftDirty, schedule]);

  useEffect(() => {
    formStateRef.current = {
      title,
      description: latestDescriptionRef.current,
      priority,
      estimate,
      dueDate,
      tags,
      assignee,
      agentStatus,
      agentBlocked,
    };
  }, [title, description, priority, estimate, dueDate, tags, assignee, agentStatus, agentBlocked]);

  useEffect(() => {
    if (!card) return;

    return () => {
      clearCardDraftOverlay(projectId, card.id);
    };
  }, [projectId, card?.id]);

  useEffect(() => {
    if (!card) return;

    const overlay = buildCardStageDraftOverlay(card, {
      title,
      description,
      assignee,
      agentStatus,
    });

    setCardDraftOverlay(projectId, card.id, overlay);
  }, [agentStatus, assignee, card, description, projectId, title]);

  useEffect(() => {
    const cardId = card?.id ?? null;
    if (updateConflict && updateConflict.cardId !== cardId) {
      setUpdateConflict(null);
    }
    const prevCardId = currentCardIdRef.current;
    if (cardId === prevCardId) {
      if (!card) return;

      const state = formStateRef.current;
      const nextDueDate = card.dueDate ? card.dueDate.toISOString().split("T")[0] : "";
      const nextRunInTarget = normalizeRunInTarget(card.runInTarget);
      const nextRunInLocalPath = card.runInLocalPath || "";
      const nextRunInBaseBranch = card.runInBaseBranch || "";
      const nextRunInWorktreePath = card.runInWorktreePath || "";
      const nextRunInEnvironmentPath = card.runInEnvironmentPath || "";

      const titleDirty = draftDirtyRef.current.title;
      const descriptionDirty = draftDirtyRef.current.description;
      const assigneeDirty = draftDirtyRef.current.assignee;
      const agentStatusDirty = draftDirtyRef.current.agentStatus;

      if (!titleDirty || state.title === card.title) {
        draftDirtyRef.current.title = false;
        setTitle((current) => (current === card.title ? current : card.title));
      }
      if (!descriptionDirty || state.description === card.description) {
        draftDirtyRef.current.description = false;
        latestDescriptionRef.current = card.description ?? "";
        setDescription((current) => (current === card.description ? current : card.description));
      }
      setPriority((current) => (current === card.priority ? current : card.priority));
      setEstimate((current) => (current === (card.estimate || "none") ? current : (card.estimate || "none")));
      setDueDate((current) => (current === nextDueDate ? current : nextDueDate));
      if (!areStringArraysEqual(state.tags, card.tags)) {
        setTags(card.tags);
      }
      if (!assigneeDirty || state.assignee === (card.assignee || "")) {
        draftDirtyRef.current.assignee = false;
        setAssignee((current) => (current === (card.assignee || "") ? current : (card.assignee || "")));
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
      schedule.applyScheduleState(card);
      schedule.applyRecurrenceState(card);
      prevCardRef.current = { card, columnId };
      return;
    }

    for (const ref of [descriptionSaveTimerRef, titleSaveTimerRef, assigneeSaveTimerRef, agentStatusSaveTimerRef]) {
      if (!ref.current) continue;
      clearTimeout(ref.current);
      ref.current = null;
    }
    clearAllDraftDirty();

    if (prevCardId && scrollContainerRef.current) {
      saveScrollPosition(projectId, prevCardId, scrollContainerRef.current.scrollTop);
    }

    const prevCard = prevCardRef.current;
    if (prevCard && card && prevCard.card.id !== card.id) {
      const state = formStateRef.current;
      const targetCard = prevCard.card;
      const targetDueDate = targetCard.dueDate ? targetCard.dueDate.toISOString().split("T")[0] : "";

      const hasAnyChanges = state.title !== targetCard.title
        || state.description !== targetCard.description
        || state.priority !== targetCard.priority
        || state.estimate !== (targetCard.estimate || "none")
        || state.dueDate !== targetDueDate
        || state.assignee !== (targetCard.assignee || "")
        || state.agentStatus !== (targetCard.agentStatus || "")
        || state.agentBlocked !== targetCard.agentBlocked
        || JSON.stringify(state.tags) !== JSON.stringify(targetCard.tags);

      if (hasAnyChanges && state.title.trim()) {
        void runUpdate(prevCard.columnId, targetCard.id, {
          title: state.title,
          description: state.description,
          ...toPriorityUpdate(state.priority, targetCard.priority),
          estimate: state.estimate === "none" ? null : (state.estimate as Estimate),
          dueDate: state.dueDate ? new Date(state.dueDate) : undefined,
          tags: state.tags,
          assignee: state.assignee,
          agentStatus: state.agentStatus,
          agentBlocked: state.agentBlocked,
        });
      }
    }

    currentCardIdRef.current = cardId;

    if (card) {
      latestDescriptionRef.current = card.description ?? "";
      setTitle(card.title);
      setDescription(card.description ?? "");
      setPriority(card.priority);
      setEstimate(card.estimate || "none");
      setDueDate(card.dueDate ? card.dueDate.toISOString().split("T")[0] : "");
      schedule.applyScheduleState(card);
      setTags(card.tags);
      setAssignee(card.assignee || "");
      setAgentStatus(card.agentStatus || "");
      setAgentBlocked(card.agentBlocked);
      setRunInTarget(normalizeRunInTarget(card.runInTarget));
      setRunInLocalPath(card.runInLocalPath || "");
      setRunInBaseBranch(card.runInBaseBranch || "");
      setRunInWorktreePath(card.runInWorktreePath || "");
      setRunInEnvironmentPath(card.runInEnvironmentPath || "");
      schedule.applyRecurrenceState(card);
      setCurrentColumnId(columnId);
      prevCardRef.current = { card, columnId };
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
    clearAllDraftDirty,
    columnId,
    runUpdate,
    projectId,
    schedule.applyRecurrenceState,
    schedule.applyScheduleState,
    updateConflict,
  ]);

  useEffect(() => {
    const cardId = card?.id ?? null;
    if (!cardId || cardId === prevRestoreCardRef.current) return;
    prevRestoreCardRef.current = cardId;

    const el = scrollContainerRef.current;
    if (!el) return;

    const saved = loadScrollPosition(projectId, cardId);
    if (!saved) {
      el.scrollTop = 0;
      return;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!scrollContainerRef.current) return;
        scrollContainerRef.current.scrollTop = saved;
      });
    });
  }, [card?.id, projectId]);

  const handleScroll = useCallback(() => {
    if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current);
    scrollSaveTimerRef.current = setTimeout(() => {
      const cardId = currentCardIdRef.current;
      const el = scrollContainerRef.current;
      if (cardId && el) saveScrollPosition(projectId, cardId, el.scrollTop);
    }, SCROLL_SAVE_DEBOUNCE_MS);
  }, [projectId]);

  useEffect(() => {
    return () => {
      if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current);
    };
  }, []);

  const hasChanges = useCallback(() => {
    if (!card) return false;
    const latestDescription = latestDescriptionRef.current;
    const cardDueDate = card.dueDate ? card.dueDate.toISOString().split("T")[0] : "";
    return title !== card.title
      || latestDescription !== (card.description ?? "")
      || priority !== card.priority
      || estimate !== (card.estimate || "none")
      || dueDate !== cardDueDate
      || assignee !== (card.assignee || "")
      || agentStatus !== (card.agentStatus || "")
      || agentBlocked !== card.agentBlocked
      || JSON.stringify(tags) !== JSON.stringify(card.tags);
  }, [card, title, priority, estimate, dueDate, assignee, agentStatus, agentBlocked, tags]);

  const handleTitleChange = useCallback(
    (value: string) => {
      markDraftDirty("title");
      formStateRef.current.title = value;
      setTitle(value);

      if (card && shouldPublishCardStagePatch({ title: value })) {
        onPatch(columnId, card.id, { title: value });
      }

      if (titleSaveTimerRef.current) {
        clearTimeout(titleSaveTimerRef.current);
      }

      titleSaveTimerRef.current = setTimeout(() => {
        titleSaveTimerRef.current = null;
        if (!card || value === card.title || !value.trim()) return;
        setSaving(true);
        runDraftFieldUpdate(columnId, card.id, "title", { title: value }, value).finally(() => {
          setSaving(false);
        });
      }, FIELD_SAVE_DEBOUNCE_MS);
    },
    [card, columnId, markDraftDirty, onPatch, runDraftFieldUpdate],
  );

  const handleTitleBlur = useCallback(() => {
    if (titleSaveTimerRef.current) {
      clearTimeout(titleSaveTimerRef.current);
      titleSaveTimerRef.current = null;
    }

    if (!card || !title.trim()) return;
    if (title === card.title) {
      clearDraftDirty("title");
      return;
    }
    setSaving(true);
    runDraftFieldUpdate(columnId, card.id, "title", { title }, title).finally(() => {
      setSaving(false);
    });
  }, [card, clearDraftDirty, columnId, runDraftFieldUpdate, title]);

  const handleAssigneeChange = useCallback(
    (value: string) => {
      markDraftDirty("assignee");
      formStateRef.current.assignee = value;
      setAssignee(value);

      if (card && shouldPublishCardStagePatch({ assignee: value })) {
        onPatch(columnId, card.id, { assignee: value });
      }

      if (assigneeSaveTimerRef.current) {
        clearTimeout(assigneeSaveTimerRef.current);
      }

      assigneeSaveTimerRef.current = setTimeout(() => {
        assigneeSaveTimerRef.current = null;
        if (!card || value === (card.assignee || "")) return;
        setSaving(true);
        runDraftFieldUpdate(columnId, card.id, "assignee", { assignee: value }, value).finally(() => {
          setSaving(false);
        });
      }, FIELD_SAVE_DEBOUNCE_MS);
    },
    [card, columnId, markDraftDirty, onPatch, runDraftFieldUpdate],
  );

  const handleAssigneeBlur = useCallback(() => {
    if (assigneeSaveTimerRef.current) {
      clearTimeout(assigneeSaveTimerRef.current);
      assigneeSaveTimerRef.current = null;
    }

    if (!card) return;
    if (assignee === (card.assignee || "")) {
      clearDraftDirty("assignee");
      return;
    }
    setSaving(true);
    runDraftFieldUpdate(columnId, card.id, "assignee", { assignee }, assignee).finally(() => {
      setSaving(false);
    });
  }, [assignee, card, clearDraftDirty, columnId, runDraftFieldUpdate]);

  const handleAgentStatusChange = useCallback(
    (value: string) => {
      markDraftDirty("agentStatus");
      formStateRef.current.agentStatus = value;
      setAgentStatus(value);

      if (card && shouldPublishCardStagePatch({ agentStatus: value })) {
        onPatch(columnId, card.id, { agentStatus: value });
      }

      if (agentStatusSaveTimerRef.current) {
        clearTimeout(agentStatusSaveTimerRef.current);
      }

      agentStatusSaveTimerRef.current = setTimeout(() => {
        agentStatusSaveTimerRef.current = null;
        if (!card || value === (card.agentStatus || "")) return;
        setSaving(true);
        runDraftFieldUpdate(columnId, card.id, "agentStatus", { agentStatus: value }, value).finally(() => {
          setSaving(false);
        });
      }, FIELD_SAVE_DEBOUNCE_MS);
    },
    [card, columnId, markDraftDirty, onPatch, runDraftFieldUpdate],
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
    setSaving(true);
    runDraftFieldUpdate(columnId, card.id, "agentStatus", { agentStatus }, agentStatus).finally(() => {
      setSaving(false);
    });
  }, [agentStatus, card, clearDraftDirty, columnId, runDraftFieldUpdate]);

  const handleDescriptionChange = useCallback(
    (value: string) => {
      markDraftDirty("description");
      latestDescriptionRef.current = value;
      formStateRef.current.description = value;
      startTransition(() => {
        setDescription(value);
      });

      if (card && shouldPublishCardStagePatch({ description: value })) {
        onPatch(columnId, card.id, { description: value });
      }

      if (descriptionSaveTimerRef.current) {
        clearTimeout(descriptionSaveTimerRef.current);
      }

      descriptionSaveTimerRef.current = setTimeout(() => {
        descriptionSaveTimerRef.current = null;
        if (!card) return;
        if (value === (card.description ?? "")) {
          clearDraftDirty("description");
          return;
        }
        setSaving(true);
        runDraftFieldUpdate(columnId, card.id, "description", { description: value }, value).finally(() => {
          setSaving(false);
        });
      }, DESCRIPTION_SAVE_DEBOUNCE_MS);
    },
    [card, clearDraftDirty, columnId, markDraftDirty, onPatch, runDraftFieldUpdate],
  );

  const flushDescriptionSave = useCallback((value: string) => {
    if (descriptionSaveTimerRef.current) {
      clearTimeout(descriptionSaveTimerRef.current);
      descriptionSaveTimerRef.current = null;
    }

    if (!card) return;
    if (value === (card.description ?? "")) {
      clearDraftDirty("description");
      return;
    }
    setSaving(true);
    runDraftFieldUpdate(columnId, card.id, "description", { description: value }, value).finally(() => {
      setSaving(false);
    });
  }, [card, clearDraftDirty, columnId, runDraftFieldUpdate]);

  const handleDescriptionBlur = useCallback(() => {
    flushDescriptionSave(flushDescriptionEditorChange());
  }, [flushDescriptionEditorChange, flushDescriptionSave]);

  const handleSave = useCallback(async () => {
    const latestDescription = flushDescriptionEditorChange();
    if (!card || !title.trim() || !hasChanges()) return;
    setSaving(true);
    try {
      const result = await runUpdate(columnId, card.id, {
        title,
        description: latestDescription,
        ...toPriorityUpdate(priority, card.priority),
        estimate: estimate === "none" ? null : (estimate as Estimate),
        dueDate: dueDate ? new Date(dueDate) : undefined,
        tags,
        assignee,
        agentStatus,
        agentBlocked,
      });
      clearDraftDirtyFromAck(result, {
        title,
        description: latestDescription,
        assignee,
        agentStatus,
      });
    } finally {
      setSaving(false);
    }
  }, [
    card,
    title,
    hasChanges,
    flushDescriptionEditorChange,
    runUpdate,
    clearDraftDirtyFromAck,
    columnId,
    priority,
    estimate,
    dueDate,
    tags,
    assignee,
    agentStatus,
    agentBlocked,
  ]);

  const cancelPendingFieldSaves = useCallback(() => {
    for (const ref of [descriptionSaveTimerRef, titleSaveTimerRef, assigneeSaveTimerRef, agentStatusSaveTimerRef]) {
      if (!ref.current) continue;
      clearTimeout(ref.current);
      ref.current = null;
    }
  }, []);

  const handlePersist = useCallback(async () => {
    flushDescriptionEditorChange();
    cancelPendingFieldSaves();

    if (card && scrollContainerRef.current) {
      saveScrollPosition(projectId, card.id, scrollContainerRef.current.scrollTop);
    }

    if (!hasChanges()) return;
    await handleSave();
  }, [cancelPendingFieldSaves, card, flushDescriptionEditorChange, projectId, hasChanges, handleSave]);

  const handleClose = useCallback(async () => {
    await handlePersist();
    const sessionSnapshot = buildCardStageSessionSnapshot(projectId, card, title);
    if (sessionSnapshot) {
      onLeaveCard?.(sessionSnapshot);
    }
    onClose();
  }, [card, handlePersist, onClose, onLeaveCard, projectId, title]);

  useEffect(() => {
    if (!closeRef) return;
    closeRef.current = handleClose;
    return () => {
      closeRef.current = null;
    };
  }, [closeRef, handleClose]);

  useEffect(() => {
    if (!persistRef) return;
    persistRef.current = handlePersist;
    return () => {
      persistRef.current = null;
    };
  }, [persistRef, handlePersist]);

  useEffect(() => {
    if (!sessionSnapshotRef) return;
    sessionSnapshotRef.current = buildCardStageSessionSnapshot(projectId, card, title);
    return () => {
      sessionSnapshotRef.current = null;
    };
  }, [card, projectId, sessionSnapshotRef, title]);

  const handleDelete = useCallback(async () => {
    if (!card) return;
    setSaving(true);
    try {
      await onDelete(columnId, card.id);
      onClose();
    } finally {
      setSaving(false);
    }
  }, [card, onDelete, columnId, onClose]);

  const handleOpenCodexThread = useCallback(async (threadId: string) => {
    if (!onOpenCodexThread) return;
    setSaving(true);
    try {
      await onOpenCodexThread(threadId);
    } finally {
      setSaving(false);
    }
  }, [onOpenCodexThread]);

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
    flushDescriptionEditorChange();
    setShowRawContent((current) => {
      const next = !current;
      writeCardStageShowRawContentPreference(next);
      return next;
    });
  }, [flushDescriptionEditorChange]);

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
    const selected = (await invoke("pty:pick-cwd")) as string | null;
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
    if (!card || nextColumnId === currentColumnId) return;
    const previousColumnId = currentColumnId;
    setCurrentColumnId(nextColumnId);
    await onMove(previousColumnId as Card["status"], card.id, nextColumnId as Card["status"]);
    onColumnIdChange?.(nextColumnId);
  }, [card, currentColumnId, onMove, onColumnIdChange]);

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

  const buildConflictOverwriteUpdates = useCallback(
    (base: Partial<CardInput>): Partial<CardInput> => {
      const next: Partial<CardInput> = { ...base };
      if (Object.hasOwn(base, "title")) next.title = title;
      if (Object.hasOwn(base, "description")) next.description = flushDescriptionEditorChange();
      if (Object.hasOwn(base, "priority")) next.priority = priority ?? null;
      if (Object.hasOwn(base, "estimate")) {
        next.estimate = estimate === "none" ? null : (estimate as Estimate);
      }
      if (Object.hasOwn(base, "dueDate")) {
        next.dueDate = dueDate ? new Date(dueDate) : null;
      }
      if (Object.hasOwn(base, "tags")) next.tags = tags;
      if (Object.hasOwn(base, "assignee")) next.assignee = assignee;
      if (Object.hasOwn(base, "agentStatus")) next.agentStatus = agentStatus;
      if (Object.hasOwn(base, "agentBlocked")) next.agentBlocked = agentBlocked;
      if (Object.hasOwn(base, "runInTarget")) next.runInTarget = runInTarget;
      if (Object.hasOwn(base, "runInLocalPath")) next.runInLocalPath = runInLocalPath || null;
      if (Object.hasOwn(base, "runInBaseBranch")) next.runInBaseBranch = runInBaseBranch || null;
      if (Object.hasOwn(base, "runInWorktreePath")) next.runInWorktreePath = runInWorktreePath || null;
      if (Object.hasOwn(base, "runInEnvironmentPath")) next.runInEnvironmentPath = runInEnvironmentPath || null;
      return next;
    },
    [
      agentBlocked,
      agentStatus,
      assignee,
      dueDate,
      estimate,
      flushDescriptionEditorChange,
      priority,
      runInBaseBranch,
      runInEnvironmentPath,
      runInLocalPath,
      runInTarget,
      runInWorktreePath,
      tags,
      title,
    ],
  );

  const handleReloadLatest = useCallback(() => {
    if (!updateConflict) return;
    const latestCard = card?.id === updateConflict.cardId ? card : updateConflict.latestCard;
    applyCardToDraftState(latestCard, updateConflict.columnId);
    setUpdateConflict(null);
  }, [applyCardToDraftState, card, updateConflict]);

  const handleOverwriteMine = useCallback(async () => {
    if (!updateConflict) return;
    setSaving(true);
    try {
      const overwriteUpdates = buildConflictOverwriteUpdates(updateConflict.attemptedUpdates);
      await runUpdate(updateConflict.columnId, updateConflict.cardId, overwriteUpdates);
    } finally {
      setSaving(false);
    }
  }, [buildConflictOverwriteUpdates, runUpdate, updateConflict]);

  const hasThreadsRow = linkedCodexThreads.length > 0 || Boolean(onOpenNewCodexThread);
  const selectedRunInBaseBranch = runInBaseBranch.trim() || resolveDefaultRunInBaseBranch(runInBranchState);
  const runInLocalPathDisplay = runInLocalPath.trim();
  const runInWorktreePathDisplay = runInWorktreePath.trim();
  const runInEnvironmentPathDisplay = runInEnvironmentPath.trim();

  const collapseTagsByDefault = collapsedProperties.includes("tags");
  const collapseAssigneeByDefault = collapsedProperties.includes("assignee");
  const collapseThreadsByDefault = hasThreadsRow && collapsedProperties.includes("threads");
  const collapseScheduleByDefault = collapsedProperties.includes("schedule");
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
  const contentGutterClassName = "px-[calc(var(--spacing)*18)]";
  const contentShellClassName = [
    "mx-auto w-full",
    limitMainContentWidth ? "max-w-[var(--pane-content-max-width)]" : "",
  ].filter(Boolean).join(" ");

  const collapsedPropertyLabel = formatCardStageCollapsedPropertyCountLabel(
    collapsedPropertyCount,
    propertiesExpanded,
  );

  return {
    card,
    projectWorkspacePath,
    title,
    description,
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
    contentGutterClassName,
    contentShellClassName,
    scrollContainerRef,
    descriptionFlushHandleRef,
    tagInputRef,
    tagDropdownRef,
    schedule,
    updateConflict: updateConflict
      ? { columnId: updateConflict.columnId, latestCard: updateConflict.latestCard }
      : null,
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
    handleTitleChange,
    handleTitleBlur,
    handleDescriptionChange,
    handleDescriptionBlur,
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
    handleReloadLatest,
    handleOverwriteMine,
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
