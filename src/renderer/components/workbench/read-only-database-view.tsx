import { useDeferredValue, useMemo } from "react";
import type { OpenCardStageOptions } from "@/components/kanban/open-card-stage";
import { matchesSearchTokens, tokenizeSearchQuery } from "@/lib/card-search";
import { normalizeSearchText } from "@/lib/search-text";
import type { DatabaseViewRenderModel } from "@/lib/database-view-render-model";
import { cn } from "@/lib/utils";

interface ReadOnlyDatabaseViewProps {
  readonly model: DatabaseViewRenderModel;
  readonly searchQuery: string;
  readonly openCardStage: (
    projectId: string,
    cardId: string,
    titleSnapshot?: string,
    options?: OpenCardStageOptions,
  ) => void;
}

export function ReadOnlyDatabaseView({
  model,
  searchQuery,
  openCardStage,
}: ReadOnlyDatabaseViewProps) {
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const searchTokens = useMemo(
    () => tokenizeSearchQuery(deferredSearchQuery),
    [deferredSearchQuery],
  );
  const columns = useMemo(
    () => model.columns.map((column) => ({
      ...column,
      rows: searchTokens.length === 0
        ? column.rows
        : column.rows.filter((row) =>
            matchesSearchTokens(
              normalizeSearchText(
                `${row.title} ${row.preview} ${row.plainText} ${row.tags.join(" ")}`,
              ),
              searchTokens,
            )),
    })),
    [model.columns, searchTokens],
  );
  const grouped = model.query.view.kind === "kanban" && columns.length > 1;

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-token-main-surface-primary"
      data-database-view-id={model.databaseViewId}
    >
      <div
        role="status"
        className="mx-3 mt-2 flex min-h-7 items-center gap-2 rounded-lg bg-token-foreground/5 px-2.5 text-xs text-token-text-secondary"
      >
        <span className="font-medium text-token-text-primary">View only</span>
        <span className="min-w-0 truncate">{model.readOnlyReason}</span>
      </div>
      <div
        className={cn(
          "min-h-0 flex-1 overflow-auto p-3",
          grouped ? "flex gap-2" : "block",
        )}
      >
        {grouped ? columns.map((column) => (
          <section key={column.id} className="w-64 shrink-0">
            <div className="mb-1.5 flex h-7 items-center gap-2 px-1 text-xs text-token-text-secondary">
              <span className="min-w-0 flex-1 truncate font-medium text-token-text-primary">
                {column.name}
              </span>
              <span>{column.rows.length}</span>
            </div>
            <div className="flex flex-col gap-1">
              {column.rows.map((row) => (
                <button
                  key={row.blockId}
                  type="button"
                  className="w-full rounded-lg bg-token-foreground/5 px-2.5 py-2 text-left hover:bg-token-foreground/10"
                  onClick={() => openCardStage(
                    model.projectId,
                    row.blockId,
                    row.title,
                    { openMode: "preview" },
                  )}
                >
                  <span className="block truncate text-sm text-token-text-primary">
                    {row.title || "Untitled"}
                  </span>
                  {row.tags.length > 0 ? (
                    <span className="mt-1 block truncate text-xs text-token-description-foreground">
                      {row.tags.join(" · ")}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </section>
        )) : (
          <div className="mx-auto max-w-4xl">
            <div className="mb-1 flex h-7 items-center px-2 text-xs text-token-description-foreground">
              <span className="min-w-0 flex-1 truncate">
                {model.databaseName} / {model.viewName}
              </span>
              <span>{columns.reduce((count, column) => count + column.rows.length, 0)}</span>
            </div>
            <div className="divide-y divide-token-foreground/5">
              {columns.flatMap((column) => column.rows).map((row) => (
                <button
                  key={row.blockId}
                  type="button"
                  className="flex min-h-9 w-full items-center gap-3 px-2 text-left hover:bg-token-foreground/5"
                  onClick={() => openCardStage(
                    model.projectId,
                    row.blockId,
                    row.title,
                    { openMode: "preview" },
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-token-text-primary">
                    {row.title || "Untitled"}
                  </span>
                  {row.tags.length > 0 ? (
                    <span className="max-w-56 truncate text-xs text-token-description-foreground">
                      {row.tags.join(" · ")}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
