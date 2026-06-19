import { useForm, useStore } from "@tanstack/react-form";
import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { BoardSummary, Project } from "@/lib/types";
import { invoke } from "@/lib/api";
import { handleFormSubmit, resolveFormErrorMessage } from "@/lib/forms";
import { normalizeProjectIcon } from "@/lib/project-icon";
import { useProjects } from "@/lib/use-projects";
import { cn } from "@/lib/utils";
import {
  NodexDialog as Dialog,
  NodexDialogContent as DialogContent,
  NodexDialogDescription as DialogDescription,
  NodexDialogFooter as DialogFooter,
  NodexDialogHeader as DialogHeader,
  NodexDialogTitle as DialogTitle,
} from "@/components/ui/dialog";
import { NodexButton } from "@/components/ui/button";
import {
  NodexDropdownButtonTrigger,
  NodexDropdownChoiceMenu,
} from "@/components/ui/dropdown";
import type { SendBlocksMode } from "./nfm-drag-handle-menu";

interface AppendTarget {
  projectId: string;
  columnId: string;
  cardId: string;
}

interface ProjectTarget {
  projectId: string;
  columnId: string;
}

export interface SendBlocksDialogProps {
  open: boolean;
  mode: SendBlocksMode;
  blockCount: number;
  sourceProjectId: string;
  sourceCardId: string;
  onOpenChange: (open: boolean) => void;
  onAppendToCard: (target: AppendTarget) => Promise<void>;
  onSendToProject: (target: ProjectTarget) => Promise<void>;
}

export interface SendBlocksDialogSurfaceProps extends SendBlocksDialogProps {
  projects: Project[];
  projectsLoading: boolean;
  boardMap: Map<string, BoardSummary>;
  boardsLoading: boolean;
  loadError?: string | null;
}

interface CardListItem {
  cardId: string;
  title: string;
  columnId: string;
  columnName: string;
}

function resolveDefaultProjectId(
  projects: Project[],
  sourceProjectId: string,
): string {
  if (projects.some((project) => project.id === sourceProjectId)) return sourceProjectId;
  return projects[0]?.id ?? sourceProjectId;
}

function filterCards(
  cards: CardListItem[],
  query: string,
): CardListItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return cards.slice(0, 60);
  return cards
    .filter((card) => {
      const haystack = `${card.title} ${card.columnName}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    })
    .slice(0, 60);
}

export function SendBlocksDialog({
  open,
  ...props
}: SendBlocksDialogProps) {
  const { projects, loading: projectsLoading, error: projectsError } = useProjects();
  const [boardMap, setBoardMap] = useState<Map<string, BoardSummary>>(new Map());
  const [boardsLoading, setBoardsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const run = async () => {
      setBoardsLoading(true);
      setLoadError(null);
      try {
        const results = await Promise.all(
          projects.map(async (project) => {
            const board = (await invoke("board:summary:get", project.id)) as BoardSummary;
            return [project.id, board] as const;
          }),
        );
        if (cancelled) return;
        setBoardMap(new Map(results));
      } catch {
        if (cancelled) return;
        setLoadError("Unable to load projects and cards.");
      } finally {
        if (cancelled) return;
        setBoardsLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [open, projects]);

  return (
    <SendBlocksDialogSurface
      open={open}
      {...props}
      projects={projects}
      projectsLoading={projectsLoading}
      boardMap={boardMap}
      boardsLoading={boardsLoading}
      loadError={loadError ?? projectsError}
    />
  );
}

export function SendBlocksDialogSurface({
  open,
  mode,
  blockCount,
  sourceProjectId,
  sourceCardId,
  onOpenChange,
  onAppendToCard,
  onSendToProject,
  projects,
  projectsLoading,
  boardMap,
  boardsLoading,
  loadError = null,
}: SendBlocksDialogSurfaceProps) {
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: {
      targetProjectId: sourceProjectId,
      targetCardId: "",
      targetStatus: "",
      cardQuery: "",
    },
    onSubmit: async ({ value }) => {
      if (submitting) return;
      setSubmissionError(null);

      setSubmitting(true);
      try {
        if (mode === "card") {
          const nextSelectedCard = availableCards.find((card) => card.cardId === value.targetCardId);
          if (!nextSelectedCard) return;
          await onAppendToCard({
            projectId: value.targetProjectId,
            columnId: nextSelectedCard.columnId,
            cardId: nextSelectedCard.cardId,
          });
        } else {
          if (!value.targetStatus) return;
          await onSendToProject({
            projectId: value.targetProjectId,
            columnId: value.targetStatus,
          });
        }

        onOpenChange(false);
      } catch (submissionError) {
        setSubmissionError(resolveFormErrorMessage(submissionError) ?? "Unable to move blocks.");
      } finally {
        setSubmitting(false);
      }
    },
  });
  const formValues = useStore(form.store, (state) => state.values);

  useEffect(() => {
    if (!open) return;
    form.reset({
      targetProjectId: resolveDefaultProjectId(projects, sourceProjectId),
      targetCardId: "",
      targetStatus: "",
      cardQuery: "",
    });
    setSubmitting(false);
    setSubmissionError(null);
  }, [form, mode, open, projects, sourceProjectId]);

  const selectedBoard = boardMap.get(formValues.targetProjectId);

  const availableCards = useMemo(() => {
    if (!selectedBoard) return [];
    const result: CardListItem[] = [];
    for (const column of selectedBoard.columns) {
      for (const card of column.cards) {
        if (formValues.targetProjectId === sourceProjectId && card.id === sourceCardId) continue;
        result.push({
          cardId: card.id,
          title: card.title || "Untitled",
          columnId: column.id,
          columnName: column.name,
        });
      }
    }
    return result;
  }, [formValues.targetProjectId, selectedBoard, sourceCardId, sourceProjectId]);

  const filteredCards = useMemo(
    () => filterCards(availableCards, formValues.cardQuery),
    [availableCards, formValues.cardQuery],
  );

  useEffect(() => {
    if (mode !== "card") return;
    if (formValues.targetCardId && availableCards.some((card) => card.cardId === formValues.targetCardId)) return;
    form.setFieldValue("targetCardId", availableCards[0]?.cardId ?? "");
  }, [availableCards, form, formValues.targetCardId, mode]);

  useEffect(() => {
    if (mode !== "project") return;
    const columns = selectedBoard?.columns ?? [];
    if (formValues.targetStatus && columns.some((column) => column.id === formValues.targetStatus)) return;
    form.setFieldValue("targetStatus", columns[0]?.id ?? "");
  }, [form, formValues.targetStatus, mode, selectedBoard]);

  const targetProject = projects.find((project) => project.id === formValues.targetProjectId);
  const targetProjectIcon = normalizeProjectIcon(targetProject?.icon);

  const selectedCard = availableCards.find((card) => card.cardId === formValues.targetCardId);
  const canSubmitAppend = Boolean(selectedCard && !boardsLoading && !projectsLoading);
  const canSubmitProject = Boolean(formValues.targetStatus && !boardsLoading && !projectsLoading);

  const submitLabel = mode === "card" ? "Append blocks" : "Create cards";

  const title = mode === "card" ? "Move to card" : "Move to DB";
  const description = mode === "card"
    ? `Move ${blockCount} selected block${blockCount === 1 ? "" : "s"} into another card.`
    : `Create ${blockCount} card${blockCount === 1 ? "" : "s"} from the selected blocks.`;
  const displayError = submissionError ?? loadError;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(34rem,calc(100vh-2rem))] w-[min(35rem,calc(100vw-2rem))] max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="gap-1 px-5 pt-5 pr-12 pb-3">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form
          id="send-blocks-form"
          className="min-h-0 min-w-0 space-y-3 overflow-y-auto overscroll-contain px-5 pb-3"
          onSubmit={(event) => handleFormSubmit(event, form.handleSubmit)}
        >
          <div className="min-w-0 space-y-1.5">
            <p className="text-xs font-medium text-(--foreground-secondary)">
              Destination project
            </p>
            <NodexDropdownChoiceMenu
              value={formValues.targetProjectId}
              onValueChange={(value) => {
                form.setFieldValue("targetProjectId", value);
                form.setFieldValue("targetCardId", "");
                form.setFieldValue("targetStatus", "");
                form.setFieldValue("cardQuery", "");
              }}
              options={projects.map((project) => {
                const icon = normalizeProjectIcon(project.icon);
                return {
                  value: project.id,
                  label: icon ? `${icon} ${project.name}` : project.name,
                };
              })}
              triggerButton={(
                <NodexDropdownButtonTrigger className="w-full max-w-full">
                  <span className="min-w-0 truncate text-sm">
                    {targetProjectIcon
                      ? `${targetProjectIcon} ${targetProject?.name ?? formValues.targetProjectId}`
                      : targetProject?.name ?? formValues.targetProjectId}
                  </span>
                </NodexDropdownButtonTrigger>
              )}
            />
          </div>

          {mode === "card" ? (
            <div className="min-w-0 space-y-1.5">
              <p className="text-xs font-medium text-(--foreground-secondary)">
                Destination card
              </p>
              <div className="min-w-0 overflow-hidden rounded-lg border-[0.5px] border-(--border) bg-token-main-surface-primary">
                <label className="flex min-w-0 items-center gap-2 border-b-[0.5px] border-(--border) px-2.5 py-2">
                  <Search className="size-3.5 shrink-0 text-(--foreground-tertiary)" />
                  <input
                    type="text"
                    value={formValues.cardQuery}
                    onChange={(event) => form.setFieldValue("cardQuery", event.target.value)}
                    placeholder="Find card by title or column..."
                    className="h-5 min-w-0 flex-1 border-none bg-transparent text-sm text-(--foreground) outline-none placeholder:text-(--foreground-tertiary)"
                  />
                </label>
                <div className="max-h-[clamp(8rem,calc(100vh-22rem),18rem)] min-w-0 overflow-y-auto p-1.5">
                  {boardsLoading && (
                    <p className="px-2 py-3 text-center text-xs text-(--foreground-tertiary)">
                      Loading cards...
                    </p>
                  )}
                  {!boardsLoading && filteredCards.length === 0 && (
                    <p className="px-2 py-3 text-center text-xs text-(--foreground-tertiary)">
                      No matching cards.
                    </p>
                  )}
                  {!boardsLoading && filteredCards.map((card) => {
                    const selected = card.cardId === formValues.targetCardId;
                    return (
                      <button
                        key={`${card.columnId}:${card.cardId}`}
                        type="button"
                        className={cn(
                          "w-full min-w-0 rounded-lg border-[0.5px] px-2.5 py-2 text-left outline-hidden",
                          "focus-visible:ring-token-focus focus-visible:ring-2",
                          selected
                            ? "border-[color-mix(in_srgb,var(--accent-blue)_62%,transparent)] bg-[color-mix(in_srgb,var(--accent-blue)_11%,transparent)]"
                            : "border-transparent hover:bg-token-list-hover-background",
                        )}
                        onClick={() => form.setFieldValue("targetCardId", card.cardId)}
                      >
                        <p className="min-w-0 truncate text-sm font-medium text-(--foreground)">
                          {card.title}
                        </p>
                        <p className="min-w-0 truncate text-xs text-(--foreground-tertiary)">
                          {card.columnName}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="min-w-0 space-y-1.5">
              <p className="text-xs font-medium text-(--foreground-secondary)">
                Destination column
              </p>
              <NodexDropdownChoiceMenu value={formValues.targetStatus} onValueChange={(value) => form.setFieldValue("targetStatus", value)}
                options={(selectedBoard?.columns ?? []).map((column) => ({
                  value: column.id,
                  label: column.name,
                }))}
                triggerButton={(
                  <NodexDropdownButtonTrigger className="w-full max-w-full">
                    <span className="min-w-0 truncate text-sm">
                      {selectedBoard?.columns.find((column) => column.id === formValues.targetStatus)?.name ?? "Select column"}
                    </span>
                  </NodexDropdownButtonTrigger>
                )}
              />
              <p className="text-xs text-(--foreground-tertiary)">
                Selected blocks become new cards and are removed from the source card.
              </p>
            </div>
          )}

          {displayError && (
            <p className="rounded-lg border-[0.5px] border-(--destructive)/40 bg-(--destructive)/10 px-2.5 py-2 text-xs text-(--destructive)">
              {displayError}
            </p>
          )}
        </form>

        <DialogFooter className="border-t-[0.5px] border-(--border) px-5 py-3 sm:flex-row">
          <NodexButton
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </NodexButton>
          <NodexButton
            type="submit"
            form="send-blocks-form"
            variant="primary"
            size="sm"
            disabled={submitting || (mode === "card" ? !canSubmitAppend : !canSubmitProject)}
          >
            {submitting ? "Moving..." : submitLabel}
          </NodexButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
