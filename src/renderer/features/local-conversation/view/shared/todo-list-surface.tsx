import { useEffect, useMemo, useRef, useState } from "react";
import type { CodexTranscriptEntry } from "../../../../lib/types";
import { cn } from "../../../../lib/utils";
import { MeasuredExpand } from "./measured-expand";

interface TodoListSurfaceProps {
  item: Pick<CodexTranscriptEntry, "markdownText" | "rawItem"> & { status?: CodexTranscriptEntry["status"] };
}

type TodoStepStatus = "pending" | "in_progress" | "completed";

interface TodoStep {
  step: string;
  status: TodoStepStatus;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

function normalizeRawTodoSteps(rawItem: unknown): TodoStep[] {
  const rawRecord = asRecord(rawItem);
  const rawPlan = rawRecord?.plan;
  if (!Array.isArray(rawPlan)) return [];

  return rawPlan.reduce<TodoStep[]>((acc, entry) => {
    const candidate = asRecord(entry);
    const step = typeof candidate?.step === "string" ? candidate.step.trim() : "";
    const status = candidate?.status;
    if (step.length === 0) return acc;
    if (status !== "pending" && status !== "in_progress" && status !== "completed") return acc;
    acc.push({ step, status });
    return acc;
  }, []);
}

function parseMarkdownTodoSteps(markdownText: string): TodoStep[] {
  const lines = markdownText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines.reduce<TodoStep[]>((acc, line) => {
      const checkboxMatch = line.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/);
      if (checkboxMatch) {
        acc.push({
          step: checkboxMatch[2]?.trim() ?? "",
          status: checkboxMatch[1]?.toLowerCase() === "x" ? "completed" : "pending",
        });
        return acc;
      }

      const orderedMatch = line.match(/^\d+\.\s+(.+)$/);
      if (orderedMatch) {
        acc.push({
          step: orderedMatch[1]?.trim() ?? "",
          status: "pending",
        });
      }
      return acc;
    }, []).filter((entry) => entry.step.length > 0);
}

export function parseTodoSteps(
  item: Pick<CodexTranscriptEntry, "markdownText" | "rawItem"> & { status?: CodexTranscriptEntry["status"] },
): TodoStep[] {
  const rawSteps = normalizeRawTodoSteps(item.rawItem);
  const parsedSteps = rawSteps.length > 0 ? rawSteps : parseMarkdownTodoSteps(item.markdownText ?? "");
  if (parsedSteps.length === 0) return [];
  if (parsedSteps.some((step) => step.status === "in_progress")) return parsedSteps;
  if (item.status !== "inProgress") return parsedSteps;

  const nextSteps = [...parsedSteps];
  const firstPendingIndex = nextSteps.findIndex((step) => step.status === "pending");
  if (firstPendingIndex >= 0) {
    nextSteps[firstPendingIndex] = {
      ...nextSteps[firstPendingIndex]!,
      status: "in_progress",
    };
  }
  return nextSteps;
}

function TodoStatusIcon({
  status,
}: {
  status: TodoStepStatus;
}) {
  if (status === "completed") {
    return (
      <div className="flex h-3.5 w-4.5 items-center justify-center overflow-hidden">
        <svg viewBox="0 0 16 16" className="icon-3xs shrink-0 text-token-foreground" fill="none" aria-hidden="true">
          <path d="M12.14 4.14L6.39 11.5L3.86 8.97" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }

  if (status === "in_progress") {
    return (
      <div className="flex h-3.5 w-4.5 items-center justify-center overflow-hidden">
        <div className="h-[9px] w-[9px] animate-spin rounded-full border border-token-foreground/35 border-t-token-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-3.5 w-4.5 items-center justify-center overflow-hidden">
      <div className="h-[8px] w-[8px] rounded-full border border-token-foreground/35" />
    </div>
  );
}

function ExpandIcon({ expanded }: { expanded: boolean }) {
  return expanded ? (
    <svg viewBox="0 0 20 20" className="icon-2xs" fill="none" aria-hidden="true">
      <path d="M5.25 11.25L10 6.5L14.75 11.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg viewBox="0 0 20 20" className="icon-2xs" fill="none" aria-hidden="true">
      <path d="M5.25 8.75L10 13.5L14.75 8.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TodoListSurface({
  item,
}: TodoListSurfaceProps) {
  const steps = useMemo(() => parseTodoSteps(item), [item]);
  const completedCount = useMemo(
    () => steps.reduce((count, step) => count + (step.status === "completed" ? 1 : 0), 0),
    [steps],
  );
  const totalCount = steps.length;
  const activeStepIndex = useMemo(() => {
    const explicitIndex = steps.findIndex((step) => step.status === "in_progress");
    if (explicitIndex >= 0) return explicitIndex;
    return completedCount === totalCount ? totalCount - 1 : -1;
  }, [completedCount, steps, totalCount]);
  const [expanded, setExpanded] = useState(true);
  const activeStepRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const activeElement = activeStepRef.current;
    if (!activeElement || activeStepIndex < 0) return;
    activeElement.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  }, [activeStepIndex]);

  const summaryLabel = `${completedCount} out of ${totalCount === 1 ? "1 task completed" : `${totalCount} tasks completed`}`;

  return (
    <div className="min-w-0 text-size-chat relative overflow-visible py-0">
      <div className="overflow-hidden rounded-lg bg-token-foreground/5">
        <div className="flex items-center justify-between gap-2 px-2.5 py-2">
          <div className="flex min-w-0 items-center">
            <div className="text-size-chat flex min-w-0 items-center gap-1">
              {item.status !== "completed" ? (
                <div className="flex items-center justify-center text-token-input-placeholder-foreground opacity-60">
                  <svg viewBox="0 0 16 16" className="icon-xs text-token-foreground" fill="none" aria-hidden="true">
                    <path d="M8 2.5v3m0 5v3m5.5-5.5h-3m-5 0h-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </div>
              ) : null}
              <span className="min-w-0 truncate text-token-input-placeholder-foreground">{summaryLabel}</span>
            </div>
          </div>
          <button
            type="button"
            aria-label={expanded ? "Collapse todo list" : "Expand todo list"}
            className="text-token-input-placeholder-foreground hover:bg-transparent hover:text-token-foreground focus-visible:outline-none"
            onClick={() => {
              setExpanded((current) => !current);
            }}
          >
            <ExpandIcon expanded={expanded} />
          </button>
        </div>

        <MeasuredExpand open={expanded} className="overflow-hidden">
          <div className="flex flex-col gap-2 bg-token-input-background/70 p-2 backdrop-blur-sm">
            <div className="vertical-scroll-fade-mask max-h-40 space-y-2 overflow-y-auto [--edge-fade-distance:2rem]">
              {steps.map((step, index) => (
                <div
                  key={`${index}:${step.step}`}
                  ref={index === activeStepIndex ? activeStepRef : null}
                  className="flex items-start gap-2"
                >
                  <div className="flex flex-shrink-0 items-start gap-0.5">
                    <TodoStatusIcon status={step.status} />
                    <span className="text-size-chat leading-4">{index + 1}.</span>
                  </div>
                  <span className={cn("text-size-chat flex-1 leading-4", step.status === "completed" && "line-through")}>
                    {step.step}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </MeasuredExpand>
      </div>
    </div>
  );
}
