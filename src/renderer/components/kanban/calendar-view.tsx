import { useState, useMemo, useCallback, useDeferredValue, useEffect, useRef } from "react";
import { useKanban } from "@/lib/use-kanban";
import { resolveCalendarVisibleDayCount } from "@/lib/calendar-range";
import type { CalendarViewState } from "@/lib/calendar-view-state";
import {
  CALENDAR_SHIFT_WHEEL_SCOPE_ATTR,
  CALENDAR_SHIFT_WHEEL_SCOPE_VALUE,
} from "@/lib/stage-wheel-navigation";
import { CalendarGrid } from "./calendar/calendar-grid";
import {
  type CalendarOccurrence,
  type Card as CardType,
} from "@/lib/types";
import { resolveOccurrenceMutationStatus } from "@/lib/calendar-occurrence-status";
import {
  ARCHIVED_CARD_OPTION_ID,
  ARCHIVED_CARD_OPTION_NAME,
} from "@/lib/kanban-options";
import { createUuidV7 } from "../../../shared/card-id";

interface CalendarViewProps {
  projectId: string;
  searchQuery: string;
  openCardStage: (
    projectId: string,
    cardId: string,
    titleSnapshot?: string,
  ) => void;
  cardStageCardId: string | undefined;
  cardStageCloseRef?: React.MutableRefObject<(() => Promise<void>) | null>;
  pendingReminderOpen?: {
    projectId: string;
    cardId: string;
    occurrenceStart: string;
  } | null;
  onReminderHandled?: (
    payload: { projectId: string; cardId: string; occurrenceStart: string },
  ) => void;
  calendarState: CalendarViewState;
  visibleDays: Date[];
  createRequestId: number;
  onCalendarAnchorDateChange: (update: (anchorDate: Date) => Date) => void;
}

const ALL_DAY_HEIGHT_STORAGE_KEY = "nodex-calendar-all-day-heights";
const DEFAULT_ALL_DAY_LANE_HEIGHT = 72;

function loadAllDayLaneHeight(projectId: string, dayCount: number): number {
  try {
    const raw = localStorage.getItem(ALL_DAY_HEIGHT_STORAGE_KEY);
    if (!raw) return DEFAULT_ALL_DAY_LANE_HEIGHT;
    const parsed = JSON.parse(raw) as Record<string, number>;
    const key = `${projectId}:${dayCount}`;
    const height = parsed[key];
    if (!Number.isFinite(height)) return DEFAULT_ALL_DAY_LANE_HEIGHT;
    return Math.round(height);
  } catch {
    return DEFAULT_ALL_DAY_LANE_HEIGHT;
  }
}

function saveAllDayLaneHeight(projectId: string, dayCount: number, height: number): void {
  try {
    const raw = localStorage.getItem(ALL_DAY_HEIGHT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, number> : {};
    parsed[`${projectId}:${dayCount}`] = Math.round(height);
    localStorage.setItem(ALL_DAY_HEIGHT_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // ignore
  }
}

function shiftAnchorDateByDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() + days);
  return next;
}

function normalizeRenderWindowDate(value: Date): Date {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

function resolveCalendarRenderWindow(
  visibleDays: Date[],
): { start: Date; endExclusive: Date } | null {
  if (visibleDays.length === 0) return null;

  const start = normalizeRenderWindowDate(new Date(visibleDays[0]));
  start.setDate(start.getDate() - 1);

  const endExclusive = normalizeRenderWindowDate(new Date(visibleDays[visibleDays.length - 1]));
  endExclusive.setDate(endExclusive.getDate() + 2);

  return { start, endExclusive };
}

type ScheduledOccurrence = CalendarOccurrence & {
  columnId: string;
  columnName: string;
  scheduledStart: Date;
  scheduledEnd: Date;
};

function toScheduledOccurrence(occurrence: CalendarOccurrence): ScheduledOccurrence | null {
  if (!occurrence.scheduledStart || !occurrence.scheduledEnd) return null;
  return {
    ...occurrence,
    columnId: occurrence.archived ? ARCHIVED_CARD_OPTION_ID : occurrence.status,
    columnName: occurrence.archived ? ARCHIVED_CARD_OPTION_NAME : occurrence.statusName,
    scheduledStart: occurrence.scheduledStart,
    scheduledEnd: occurrence.scheduledEnd,
  };
}

export function CalendarView({
  projectId,
  searchQuery,
  openCardStage,
  cardStageCardId,
  pendingReminderOpen,
  onReminderHandled,
  calendarState,
  visibleDays,
  createRequestId,
  onCalendarAnchorDateChange,
}: CalendarViewProps) {
  const {
    board,
    createCard,
    updateCard,
    getCard,
    listCalendarOccurrences,
    completeOccurrence,
    skipOccurrence,
    updateOccurrence,
  } = useKanban({
    projectId,
  });

  const { range } = calendarState;
  const dayCount = resolveCalendarVisibleDayCount(range);
  const [allDayLaneHeight, setAllDayLaneHeight] = useState(() =>
    loadAllDayLaneHeight(projectId, dayCount),
  );
  const renderWindow = useMemo(() => resolveCalendarRenderWindow(visibleDays), [visibleDays]);
  const [scheduledCards, setScheduledCards] = useState<ScheduledOccurrence[]>([]);
  type OccurrenceOverlay =
    | { kind: "hide" }
    | { kind: "upsert"; event: ScheduledOccurrence };
  const [occurrenceOverlayById, setOccurrenceOverlayById] = useState<Map<string, OccurrenceOverlay>>(
    () => new Map(),
  );
  const scheduledCardsRef = useRef<ScheduledOccurrence[]>([]);

  const deferredSearch = useDeferredValue(searchQuery);

  useEffect(() => {
    if (!renderWindow) {
      setScheduledCards([]);
      return;
    }

    let cancelled = false;
    void listCalendarOccurrences(
      renderWindow.start,
      renderWindow.endExclusive,
      deferredSearch,
    ).then((occurrences) => {
      if (cancelled) return;
      setScheduledCards(occurrences.map(toScheduledOccurrence).filter((occurrence): occurrence is ScheduledOccurrence => Boolean(occurrence)));
    });

    return () => {
      cancelled = true;
    };
  }, [board, deferredSearch, listCalendarOccurrences, renderWindow]);

  useEffect(() => {
    scheduledCardsRef.current = scheduledCards;
  }, [scheduledCards]);

  const handleShiftWheelPrev = useCallback(
    () => onCalendarAnchorDateChange((anchorDate) => shiftAnchorDateByDays(anchorDate, -1)),
    [onCalendarAnchorDateChange],
  );
  const handleShiftWheelNext = useCallback(
    () => onCalendarAnchorDateChange((anchorDate) => shiftAnchorDateByDays(anchorDate, 1)),
    [onCalendarAnchorDateChange],
  );
  useEffect(() => {
    setAllDayLaneHeight(loadAllDayLaneHeight(projectId, dayCount));
  }, [dayCount, projectId]);

  useEffect(() => {
    saveAllDayLaneHeight(projectId, dayCount, allDayLaneHeight);
  }, [allDayLaneHeight, dayCount, projectId]);

  const handleAllDayLaneHeightChange = useCallback((height: number) => {
    setAllDayLaneHeight(height);
  }, []);

  const masterCardsById = useMemo(() => {
    const cards = new Map<string, { card: CardType; columnId: string }>();
    if (!board) return cards;
    for (const column of board.columns) {
      for (const card of column.cards) {
        cards.set(card.id, { card, columnId: column.id });
      }
    }
    return cards;
  }, [board]);

  const handleClickCard = useCallback(
    async (card: CardType & { columnId: string; cardId?: string }) => {
      const masterCardId = card.cardId ?? card.id;
      const cached = masterCardsById.get(masterCardId);

      if (cached) {
        openCardStage(projectId, cached.card.id, cached.card.title);
        return;
      }

      const loaded = await getCard(masterCardId, card.status);
      if (loaded) {
        openCardStage(projectId, loaded.id, loaded.title);
        return;
      }

      openCardStage(projectId, masterCardId, card.title);
    },
    [getCard, masterCardsById, openCardStage, projectId],
  );

  const handleCreateCard = useCallback(
    async (title: string, start: Date, end: Date) => {
      const cardId = createUuidV7();
      const optimisticEventId = `${cardId}:${start.toISOString()}`;
      setOccurrenceOverlayById((current) => {
        const next = new Map(current);
        next.set(optimisticEventId, {
          kind: "upsert",
          event: {
            id: optimisticEventId,
            cardId,
            status: "draft",
            archived: false,
            statusName: "Draft",
            columnId: "draft",
            columnName: "Draft",
            title,
            description: "",
            tags: [],
            agentBlocked: false,
            created: new Date(),
            order: 0,
            scheduledStart: start,
            scheduledEnd: end,
            occurrenceStart: start,
            occurrenceEnd: end,
            isRecurring: false,
          },
        });
        return next;
      });
      const created = await createCard("draft", {
        id: cardId,
        title,
        scheduledStart: start,
        scheduledEnd: end,
      });
      if (created) return;
      setOccurrenceOverlayById((current) => {
        const next = new Map(current);
        next.delete(optimisticEventId);
        return next;
      });
    },
    [createCard],
  );

  const handleUpdateCardSchedule = useCallback(
    async (
      columnId: string,
      cardId: string,
      occurrenceStart: Date,
      scheduledStart: Date,
      scheduledEnd: Date,
      isAllDay?: boolean,
      scope?: "this" | "this-and-future" | "all",
    ) => {
      const scheduleUpdates = {
        scheduledStart,
        scheduledEnd,
        ...(isAllDay === undefined ? {} : { isAllDay }),
      };
      if (scope) {
        const sourceOccurrenceId = `${cardId}:${occurrenceStart.toISOString()}`;
        const source = scheduledCardsRef.current.find((event) => event.id === sourceOccurrenceId);
        const overlayId = `${cardId}:${scheduledStart.toISOString()}`;
        setOccurrenceOverlayById((current) => {
          const next = new Map(current);
          next.set(sourceOccurrenceId, { kind: "hide" });
          if (source) {
            next.set(overlayId, {
              kind: "upsert",
              event: {
                ...source,
                id: overlayId,
                scheduledStart,
                scheduledEnd,
                occurrenceStart: scheduledStart,
                occurrenceEnd: scheduledEnd,
                isAllDay: isAllDay ?? source.isAllDay,
              },
            });
          }
          return next;
        });

        const updated = await updateOccurrence({
          cardId,
          occurrenceStart,
          source: "calendar",
          scope,
          updates: scheduleUpdates,
        });
        if (updated) return;
        setOccurrenceOverlayById((current) => {
          const next = new Map(current);
          next.delete(sourceOccurrenceId);
          next.delete(overlayId);
          return next;
        });
        return;
      }

      const sourceOccurrenceId = `${cardId}:${occurrenceStart.toISOString()}`;
      const source = scheduledCardsRef.current.find((event) => event.id === sourceOccurrenceId);
      const mutationStatus = resolveOccurrenceMutationStatus(columnId, source);
      const overlayId = `${cardId}:${scheduledStart.toISOString()}`;
      setOccurrenceOverlayById((current) => {
        const next = new Map(current);
        next.set(sourceOccurrenceId, { kind: "hide" });
        if (source) {
          next.set(overlayId, {
            kind: "upsert",
            event: {
              ...source,
              id: overlayId,
              scheduledStart,
              scheduledEnd,
              occurrenceStart: scheduledStart,
              occurrenceEnd: scheduledEnd,
              isAllDay: isAllDay ?? source.isAllDay,
            },
          });
        }
        return next;
      });

      const updated = await updateCard(mutationStatus, cardId, scheduleUpdates);
      if (updated.status === "updated") return;
      setOccurrenceOverlayById((current) => {
        const next = new Map(current);
        next.delete(sourceOccurrenceId);
        next.delete(overlayId);
        return next;
      });
    },
    [updateCard, updateOccurrence],
  );

  const handleCompleteOccurrence = useCallback(
    async (cardId: string, occurrenceStart: Date) => {
      const key = `${cardId}:${occurrenceStart.toISOString()}`;
      setOccurrenceOverlayById((current) => {
        const next = new Map(current);
        next.set(key, { kind: "hide" });
        return next;
      });
      const completed = await completeOccurrence({
        cardId,
        occurrenceStart,
        source: "calendar",
      });
      if (completed) return;
      setOccurrenceOverlayById((current) => {
        const next = new Map(current);
        next.delete(key);
        return next;
      });
    },
    [completeOccurrence],
  );

  const handleSkipOccurrence = useCallback(
    async (cardId: string, occurrenceStart: Date) => {
      const key = `${cardId}:${occurrenceStart.toISOString()}`;
      setOccurrenceOverlayById((current) => {
        const next = new Map(current);
        next.set(key, { kind: "hide" });
        return next;
      });
      const skipped = await skipOccurrence({
        cardId,
        occurrenceStart,
        source: "calendar",
      });
      if (skipped) return;
      setOccurrenceOverlayById((current) => {
        const next = new Map(current);
        next.delete(key);
        return next;
      });
    },
    [skipOccurrence],
  );

  useEffect(() => {
    if (occurrenceOverlayById.size === 0) return;
    setOccurrenceOverlayById((current) => {
      let changed = false;
      const next = new Map(current);
      for (const [id, overlay] of current) {
        const scheduled = scheduledCards.find((event) => event.id === id);
        if (overlay.kind === "hide") {
          if (!scheduled) {
            next.delete(id);
            changed = true;
          }
          continue;
        }

        if (!scheduled) continue;
        if (
          scheduled.scheduledStart.getTime() === overlay.event.scheduledStart.getTime()
          && scheduled.scheduledEnd.getTime() === overlay.event.scheduledEnd.getTime()
        ) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [occurrenceOverlayById, scheduledCards]);

  const displayScheduledCards = useMemo(() => {
    if (occurrenceOverlayById.size === 0) return scheduledCards;

    const byId = new Map(scheduledCards.map((event) => [event.id, event]));
    for (const [id, overlay] of occurrenceOverlayById) {
      if (overlay.kind === "hide") {
        byId.delete(id);
        continue;
      }
      byId.set(id, overlay.event);
    }

    return [...byId.values()].sort((left, right) => (
      left.scheduledStart.getTime() - right.scheduledStart.getTime()
    ));
  }, [occurrenceOverlayById, scheduledCards]);

  useEffect(() => {
    if (!pendingReminderOpen) return;
    if (pendingReminderOpen.projectId !== projectId) return;

    let cancelled = false;
    void getCard(pendingReminderOpen.cardId).then((result) => {
      if (cancelled) return;
      if (result) openCardStage(projectId, result.id, result.title);
      onReminderHandled?.(pendingReminderOpen);
    });

    return () => {
      cancelled = true;
    };
  }, [
    getCard,
    onReminderHandled,
    openCardStage,
    pendingReminderOpen,
    projectId,
  ]);

  return (
    <div
      className="flex h-full min-h-0 flex-col px-4 pb-4"
      {...{ [CALENDAR_SHIFT_WHEEL_SCOPE_ATTR]: CALENDAR_SHIFT_WHEEL_SCOPE_VALUE }}
    >
      <CalendarGrid
        visibleDays={visibleDays}
        createRequestId={createRequestId}
        scheduledCards={displayScheduledCards}
        cardStageCardId={cardStageCardId}
        onClickCard={handleClickCard}
        onCreateCard={handleCreateCard}
        onCompleteOccurrence={handleCompleteOccurrence}
        onSkipOccurrence={handleSkipOccurrence}
        onUpdateCardSchedule={handleUpdateCardSchedule}
        onNavigatePrev={handleShiftWheelPrev}
        onNavigateNext={handleShiftWheelNext}
        allDayLaneHeight={allDayLaneHeight}
        onAllDayLaneHeightChange={handleAllDayLaneHeightChange}
      />
    </div>
  );
}
