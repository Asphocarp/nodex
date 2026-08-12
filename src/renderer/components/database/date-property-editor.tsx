import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CalendarIcon, ClockIcon } from "@/components/shared/icons";
import {
  NodexPopover,
  NodexPopoverContent,
  NodexPopoverTrigger,
} from "@/components/ui/popover";
import {
  datetimeDraftFromIso,
  formatLocalDateAsIso,
  localDateTimeToIso,
  parseIsoDateToLocalDate,
  todayAsIsoDate,
} from "@/lib/data-source-property-date";
import { cn } from "@/lib/utils";
import { PropertyEmptyValue } from "./property-empty-value";
import { DATABASE_PROPERTY_LIST_CHIP_CLASS_NAME } from "./property-list-chip";

let dateCalendarPromise:
  | Promise<typeof import("@/components/ui/date-calendar")>
  | undefined;

const loadDateCalendar = () => {
  dateCalendarPromise ??= import("@/components/ui/date-calendar");
  return dateCalendarPromise;
};

const LazyNodexDateCalendar = lazy(async () => ({
  default: (await loadDateCalendar()).NodexDateCalendar,
}));

const formatListDate = (date: Date): string => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const candidate = new Date(date);
  candidate.setHours(0, 0, 0, 0);
  const dayOffset = Math.round((candidate.getTime() - today.getTime()) / 86_400_000);
  if (dayOffset === 0) return "Today";
  if (dayOffset === 1) return "Tomorrow";
  if (dayOffset === -1) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
};

export function DatePropertyEditor({
  label,
  mode,
  value,
  revision,
  disabled,
  presentation,
  triggerIcon,
  onChange,
}: {
  readonly label: string;
  readonly mode: "date" | "datetime";
  readonly value: string | null;
  readonly revision: number;
  readonly disabled: boolean;
  readonly presentation: "compact" | "page" | "list";
  readonly triggerIcon?: ReactNode;
  readonly onChange: (value: string | null) => void;
}) {
  const committed = mode === "date"
    ? { date: value ?? "", time: "" }
    : value ? datetimeDraftFromIso(value) ?? { date: "", time: "" } : { date: "", time: "" };
  const [open, setOpen] = useState(false);
  const [dateInput, setDateInput] = useState(committed.date);
  const [timeInput, setTimeInput] = useState(committed.time);
  const [month, setMonth] = useState(
    parseIsoDateToLocalDate(committed.date) ?? new Date(),
  );
  const [error, setError] = useState<string | null>(null);
  const skipBlurCommitRef = useRef(false);
  const lastCommittedDraftRef = useRef<string | null>(null);

  useEffect(() => {
    setDateInput(committed.date);
    setTimeInput(committed.time);
    setMonth(parseIsoDateToLocalDate(committed.date) ?? new Date());
    setError(null);
    lastCommittedDraftRef.current = null;
  }, [committed.date, committed.time, revision]);

  useEffect(() => {
    if (!disabled) return;
    setOpen(false);
  }, [disabled]);

  const commitDraft = (date: string, time = timeInput) => {
    if (disabled) return false;
    const signature = `${date}\u0000${mode === "datetime" ? time : ""}`;
    if (lastCommittedDraftRef.current === signature) return true;
    if (!date) {
      setError(null);
      lastCommittedDraftRef.current = signature;
      onChange(null);
      return true;
    }
    const parsedDate = parseIsoDateToLocalDate(date);
    if (!parsedDate) {
      setError("Enter a valid date as YYYY-MM-DD");
      return false;
    }
    if (mode === "date") {
      setError(null);
      setMonth(parsedDate);
      lastCommittedDraftRef.current = signature;
      onChange(date);
      return true;
    }
    const next = localDateTimeToIso(date, time || "09:00");
    if (!next) {
      setError("Enter a valid local date and time");
      return false;
    }
    setError(null);
    setTimeInput(time || "09:00");
    setMonth(parsedDate);
    lastCommittedDraftRef.current = `${date}\u0000${time || "09:00"}`;
    onChange(next);
    return true;
  };

  const selected = parseIsoDateToLocalDate(dateInput);
  const display = selected
    ? presentation === "list"
      ? formatListDate(mode === "datetime" && value ? new Date(value) : selected)
      : new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        ...(mode === "datetime" ? { hour: "numeric", minute: "2-digit" } : {}),
      }).format(mode === "datetime" && value ? new Date(value) : selected)
    : null;
  const cancelDraft = () => {
    skipBlurCommitRef.current = true;
    setDateInput(committed.date);
    setTimeInput(committed.time);
    setError(null);
    setOpen(false);
  };

  return (
    <NodexPopover open={open} onOpenChange={(next) => {
      if (next && disabled) return;
      setOpen(next);
      if (next) {
        skipBlurCommitRef.current = false;
        lastCommittedDraftRef.current = null;
        return;
      }
      setDateInput(committed.date);
      setTimeInput(committed.time);
      setError(null);
    }}>
      <NodexPopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={`Edit ${label}`}
          onPointerEnter={() => {
            void loadDateCalendar();
          }}
          onFocus={() => {
            void loadDateCalendar();
          }}
          className={cn(
            "inline-flex min-h-6 min-w-0 items-center gap-1.5 rounded-md px-1 text-left outline-hidden",
            "text-token-text-secondary hover:bg-token-foreground/5 focus-visible:ring-2 focus-visible:ring-token-focus disabled:opacity-50",
            presentation === "page"
              ? "text-sm"
              : presentation === "list"
                ? DATABASE_PROPERTY_LIST_CHIP_CLASS_NAME
                : "text-[11px]",
          )}
        >
          {selected ? (
            triggerIcon ?? <CalendarIcon className="icon-2xs shrink-0 text-token-description-foreground" />
          ) : null}
          {display ? <span className="truncate">{display}</span> : <PropertyEmptyValue />}
        </button>
      </NodexPopoverTrigger>
      <NodexPopoverContent
        align="start"
        className="w-[280px] overflow-hidden p-0"
        onPointerDownCapture={(event) => {
          const active = document.activeElement;
          if (
            active instanceof HTMLElement
            && active.dataset.propertyDateDraft === "true"
            && event.target instanceof Node
            && !active.contains(event.target)
          ) {
            skipBlurCommitRef.current = true;
          }
        }}
      >
        <div className="px-2 pt-2">
          <div className="flex h-8 items-center gap-1 rounded-lg bg-token-foreground/5 px-2">
            <CalendarIcon className="icon-2xs shrink-0 text-token-description-foreground" />
            <input
              autoFocus
              data-property-date-draft="true"
              aria-label={`${label} date`}
              aria-invalid={error !== null}
              value={dateInput}
              disabled={disabled}
              placeholder="YYYY-MM-DD"
              onChange={(event) => {
                lastCommittedDraftRef.current = null;
                setDateInput(event.target.value);
              }}
              onBlur={() => {
                if (skipBlurCommitRef.current) {
                  skipBlurCommitRef.current = false;
                  return;
                }
                if (dateInput !== committed.date) commitDraft(dateInput);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitDraft(dateInput);
                if (event.key !== "Escape") return;
                event.preventDefault();
                cancelDraft();
              }}
              className="h-full min-w-0 flex-1 bg-transparent text-sm text-token-foreground outline-hidden placeholder:text-token-description-foreground"
            />
          </div>
          {mode === "datetime" ? (
            <div className="mt-1 flex h-8 items-center gap-1 rounded-lg bg-token-foreground/5 px-2">
              <ClockIcon className="icon-2xs shrink-0 text-token-description-foreground" />
              <input
                type="time"
                data-property-date-draft="true"
                aria-label={`${label} time`}
                value={timeInput}
                disabled={disabled}
                onChange={(event) => {
                  lastCommittedDraftRef.current = null;
                  setTimeInput(event.target.value);
                }}
                onBlur={() => {
                  if (skipBlurCommitRef.current) {
                    skipBlurCommitRef.current = false;
                    return;
                  }
                  if (dateInput) commitDraft(dateInput, timeInput);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  event.preventDefault();
                  cancelDraft();
                }}
                className="h-full min-w-0 flex-1 bg-transparent text-sm text-token-foreground outline-hidden"
              />
            </div>
          ) : null}
          {error ? <p role="alert" className="px-1 pt-1 text-xs text-token-error-foreground">{error}</p> : null}
        </div>
        <Suspense fallback={<div aria-hidden="true" className="h-56 w-full" />}>
          <LazyNodexDateCalendar
            selected={selected ?? undefined}
            disabled={disabled}
            month={month}
            onMonthChange={setMonth}
            onToday={() => {
              if (disabled) return;
              const today = todayAsIsoDate();
              setDateInput(today);
              setMonth(parseIsoDateToLocalDate(today)!);
              commitDraft(today);
            }}
            onSelect={(date) => {
              if (disabled || !date) return;
              const next = formatLocalDateAsIso(date);
              if (!next) return;
              setDateInput(next);
              commitDraft(next);
            }}
          />
        </Suspense>
        <div className="h-px bg-token-foreground/8" />
        <div className="p-1">
          <button
            type="button"
            disabled={disabled || !value}
            onClick={() => {
              if (disabled) return;
              setDateInput("");
              setTimeInput("");
              setError(null);
              onChange(null);
              setOpen(false);
            }}
            className="flex min-h-7 w-full items-center rounded-lg px-2 text-left text-sm text-token-description-foreground hover:bg-token-list-hover-background disabled:opacity-40"
          >
            Clear
          </button>
        </div>
      </NodexPopoverContent>
    </NodexPopover>
  );
}
