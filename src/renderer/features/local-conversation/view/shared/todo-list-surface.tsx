import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { NodexTooltip } from "@/components/ui/tooltip";
import type { CodexTranscriptEntry } from "../../../../lib/types";
import { cn } from "../../../../lib/utils";
import { CODEX_THREAD_ACCORDION_TRANSITION } from "./thread-motion";
import { useMeasuredElementHeight } from "./use-measured-element-height";

export interface TodoListSurfaceProps {
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

function countCompletedSteps(steps: TodoStep[]): number {
  return steps.reduce((count, step) => count + (step.status === "completed" ? 1 : 0), 0);
}

function resolveActiveStepIndex(steps: TodoStep[], completedCount: number): number {
  const explicitIndex = steps.findIndex((step) => step.status === "in_progress");
  if (explicitIndex >= 0) return explicitIndex;
  if (steps.length === 0) return -1;
  if (completedCount === steps.length) return steps.length - 1;

  const firstIncompleteIndex = steps.findIndex((step) => step.status !== "completed");
  return firstIncompleteIndex >= 0 ? firstIncompleteIndex : steps.length - 1;
}

function TodoListCompactTooltip({ steps }: { steps: TodoStep[] }) {
  return (
    <div className="flex max-h-[min(var(--radix-tooltip-content-available-height),calc(100vh-16px))] min-h-0 max-w-80 flex-1 flex-col overflow-hidden rounded-xl">
      <div className="vertical-scroll-fade-mask flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 py-2 [--edge-fade-distance:1rem]">
        {steps.map((step, index) => (
          <div key={`${index}:${step.step}`} className="flex max-w-80 min-w-0 items-start gap-2">
            <TodoStatusIcon status={step.status} />
            <span
              className={cn(
                "text-size-chat max-w-72 min-w-0 break-words leading-4",
                step.status === "completed" ? "text-token-text-tertiary" : "text-token-text-secondary",
              )}
            >
              {step.step}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TodoListCompactPillContent({
  item,
}: TodoListSurfaceProps) {
  const steps = useMemo(() => parseTodoSteps(item), [item]);
  const completedCount = useMemo(() => countCompletedSteps(steps), [steps]);
  const activeStepIndex = useMemo(() => resolveActiveStepIndex(steps, completedCount), [completedCount, steps]);
  if (steps.length === 0 || activeStepIndex < 0) return null;

  const activeStep = steps[activeStepIndex];
  const stepNumber = activeStepIndex + 1;

  return (
    <NodexTooltip
      delayDuration={0}
      interactive
      surface="rich"
      side="top"
      sideOffset={8}
      tooltipContent={<TodoListCompactTooltip steps={steps} />}
      style={{
        maxWidth: "min(24rem, var(--radix-tooltip-content-available-width), calc(100vw - 16px))",
      }}
    >
      <span
        tabIndex={0}
        aria-label={`Todo progress: Step ${stepNumber} of ${steps.length}`}
        className="inline-flex max-w-full min-w-0 cursor-interaction rounded-sm hover:text-token-foreground focus-visible:ring-1 focus-visible:ring-token-focus-border focus-visible:outline-none"
      >
        <span className="text-size-chat flex max-w-full min-w-0 items-center gap-1.5 text-token-text-secondary">
          <TodoStatusIcon status={activeStep?.status ?? "pending"} />
          <span className="whitespace-nowrap tabular-nums">
            Step {stepNumber} / {steps.length}
          </span>
        </span>
      </span>
    </NodexTooltip>
  );
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 20 20" className="icon-2xs" fill="none" aria-hidden="true">
      <path
        d="M16.0299 3.0293C16.2896 2.76996 16.7107 2.76988 16.9703 3.0293C17.23 3.28899 17.23 3.711 16.9703 3.9707L13.2731 7.66797H16.9996L17.1344 7.68164C17.4372 7.74375 17.6645 8.01192 17.6647 8.33301C17.6647 8.65421 17.4372 8.92219 17.1344 8.98438L16.9996 8.99805H11.6666C11.2994 8.99801 11.0016 8.70026 11.0016 8.33301V3C11.0016 2.63275 11.2994 2.33499 11.6666 2.33496C12.0339 2.33496 12.3317 2.63273 12.3317 3V6.72754L16.0299 3.0293ZM8.99475 17C8.99475 17.3673 8.69698 17.665 8.32971 17.665C7.96258 17.6649 7.66467 17.3672 7.66467 17V13.2725L3.96741 16.9707C3.70771 17.2304 3.2857 17.2304 3.026 16.9707C2.7663 16.711 2.7663 16.289 3.026 16.0293L6.72424 12.332H2.9967C2.62955 12.332 2.33185 12.0341 2.33167 11.667C2.33167 11.2997 2.62943 11.002 2.9967 11.002H8.32971C8.69698 11.002 8.99475 11.2997 8.99475 11.667V17Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function TodoListSurface({
  item,
}: TodoListSurfaceProps) {
  const steps = useMemo(() => parseTodoSteps(item), [item]);
  const completedCount = useMemo(() => countCompletedSteps(steps), [steps]);
  const totalCount = steps.length;
  const activeStepIndex = useMemo(() => resolveActiveStepIndex(steps, completedCount), [completedCount, steps]);
  const [expanded, setExpanded] = useState(true);
  const activeStepRef = useRef<HTMLDivElement | null>(null);
  const { elementHeightPx, elementRef } = useMeasuredElementHeight();

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
    <div className="bg-token-input-background/70 text-token-foreground border-token-border/80 relative overflow-clip border-x border-t backdrop-blur-sm transition-colors first:rounded-t-2xl cursor-interaction">
      <div className="flex flex-col">
        <div className="flex w-full items-center justify-between gap-1.5 py-1.5 pr-2 pl-3 text-sm font-normal">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
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
          </div>
          <div className="flex min-w-fit shrink-0 items-center gap-1.5 select-none sm:ml-auto">
            <button
              type="button"
              aria-label={expanded ? "Collapse todo list" : "Expand todo list"}
              className="text-token-input-placeholder-foreground hover:bg-transparent hover:text-token-foreground focus-visible:outline-none"
              onClick={() => {
                setExpanded((current) => !current);
              }}
            >
              <ExpandIcon />
            </button>
          </div>
        </div>

        <motion.div
          initial={false}
          animate={{
            height: expanded ? elementHeightPx : 0,
            opacity: expanded ? 1 : 0,
          }}
          transition={CODEX_THREAD_ACCORDION_TRANSITION}
          className={cn(expanded ? "overflow-visible" : "overflow-hidden")}
          data-thread-find-skip={expanded ? undefined : true}
          style={{
            pointerEvents: expanded ? "auto" : "none",
          }}
        >
          <div ref={elementRef}>
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
          </div>
        </motion.div>
      </div>
    </div>
  );
}
