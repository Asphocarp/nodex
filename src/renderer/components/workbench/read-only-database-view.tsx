import { useDeferredValue, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  LayoutGrid,
  List,
} from "lucide-react";
import {
  stableStringifyDatabaseJson,
  type DatabaseJsonValue,
} from "../../../shared/database-kernel";
import type {
  DataSourcePageRowV2,
  DataSourcePropertyRecordV2,
} from "../../../shared/database-module-v2";
import type { OpenPageStageOptions } from "@/components/kanban/open-page-stage";
import { NodexIconButton } from "@/components/ui/button";
import { matchesSearchTokens, tokenizeSearchQuery } from "@/lib/page-search";
import {
  databaseViewSupportsManualReorder,
  buildDatabaseViewMoveOperations,
  buildDatabaseViewPropertyValueOperations,
  canMoveDatabaseViewPage,
  commitDatabaseViewOperations,
} from "@/lib/database-view-row-mutations";
import type {
  DatabaseViewRenderColumn,
  DatabaseViewRenderModel,
  DatabaseViewRenderRow,
} from "@/lib/database-view-render-model";
import { readDatabasePropertyOptions } from "@/lib/database-view-authoring";
import { useMutationAuditSessionId } from "@/lib/mutation-audit-session";
import { normalizeSearchText } from "@/lib/search-text";
import { cn } from "@/lib/utils";

interface DurableDatabaseViewProps {
  readonly model: DatabaseViewRenderModel;
  readonly searchQuery: string;
  readonly openPageStage: (
    projectId: string,
    pageId: string,
    titleSnapshot?: string,
    options?: OpenPageStageOptions,
  ) => void;
  readonly onCommitted?: () => void | Promise<void>;
  readonly commitOperations?: typeof commitDatabaseViewOperations;
}

const valueInputClass = cn(
  "h-6 min-w-0 rounded-md border border-transparent bg-token-foreground/5 px-1.5 text-[11px]",
  "text-token-text-secondary outline-none hover:bg-token-foreground/8 focus:border-token-focus-border",
);

const rowByPageId = (
  model: DatabaseViewRenderModel,
  pageId: string,
): DataSourcePageRowV2 | null =>
  model.query.rows.find((row) => row.page.pageId === pageId) ?? null;

const searchablePropertyValues = (
  model: DatabaseViewRenderModel,
  pageId: string,
): string => {
  const row = rowByPageId(model, pageId);
  if (!row) return "";
  return Object.values(row.values)
    .map((value) => stableStringifyDatabaseJson(value.value))
    .join(" ");
};

const scalarString = (value: DatabaseJsonValue | undefined): string =>
  typeof value === "string" ? value : "";

const datetimeLocalValue = (value: DatabaseJsonValue | undefined): string => {
  if (typeof value !== "string") return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const offset = parsed.getTimezoneOffset() * 60_000;
  return new Date(parsed.getTime() - offset).toISOString().slice(0, 16);
};

function DatabasePropertyValueEditor({
  property,
  value,
  revision,
  disabled,
  onChange,
}: {
  readonly property: DataSourcePropertyRecordV2;
  readonly value: DatabaseJsonValue | undefined;
  readonly revision: number;
  readonly disabled: boolean;
  readonly onChange: (value: DatabaseJsonValue) => void;
}) {
  const label = `${property.name} value`;
  if (property.valueType === "checkbox") {
    return (
      <label className="inline-flex h-6 items-center gap-1.5 text-[11px] text-token-description-foreground">
        <input
          type="checkbox"
          aria-label={label}
          checked={value === true}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="size-3.5 accent-(--accent-blue)"
        />
        {property.name}
      </label>
    );
  }
  if (property.valueType === "select") {
    return (
      <label className="inline-flex min-w-0 items-center gap-1 text-[11px] text-token-description-foreground">
        <span className="shrink-0">{property.name}</span>
        <select
          aria-label={label}
          value={scalarString(value)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value || null)}
          className={cn(valueInputClass, "max-w-32")}
        >
          <option value="">None</option>
          {readDatabasePropertyOptions(property).map((option) => (
            <option key={option.id} value={option.id}>{option.name}</option>
          ))}
        </select>
      </label>
    );
  }
  if (property.valueType === "multi_select") {
    const selected = new Set(
      Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === "string")
        : [],
    );
    return (
      <fieldset className="flex min-w-0 flex-wrap items-center gap-1" aria-label={label}>
        <legend className="sr-only">{property.name}</legend>
        <span className="text-[11px] text-token-description-foreground">{property.name}</span>
        {readDatabasePropertyOptions(property).map((option) => {
          const active = selected.has(option.id);
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              onClick={() => {
                const next = new Set(selected);
                if (active) next.delete(option.id);
                else next.add(option.id);
                onChange([...next].sort());
              }}
              className={cn(
                "h-6 rounded-md px-1.5 text-[11px]",
                active
                  ? "bg-(--accent-blue)/12 text-(--accent-blue)"
                  : "bg-token-foreground/5 text-token-description-foreground hover:bg-token-foreground/8",
              )}
            >
              {option.name}
            </button>
          );
        })}
      </fieldset>
    );
  }

  const inputType = property.valueType === "number"
    ? "number"
    : property.valueType === "date"
      ? "date"
      : property.valueType === "datetime"
        ? "datetime-local"
        : "text";
  const initialValue = property.valueType === "datetime"
    ? datetimeLocalValue(value)
    : property.valueType === "number"
      ? typeof value === "number" ? String(value) : ""
      : scalarString(value);
  return (
    <label className="inline-flex min-w-0 items-center gap-1 text-[11px] text-token-description-foreground">
      <span className="shrink-0">{property.name}</span>
      <input
        key={`${property.propertyId}:${revision}:${initialValue}`}
        type={inputType}
        aria-label={label}
        defaultValue={initialValue}
        disabled={disabled}
        onBlur={(event) => {
          if (event.currentTarget.value === initialValue) return;
          if (property.valueType === "number") {
            onChange(event.currentTarget.value === "" ? null : Number(event.currentTarget.value));
            return;
          }
          if (property.valueType === "datetime") {
            const parsed = new Date(event.currentTarget.value);
            onChange(Number.isNaN(parsed.getTime()) ? null : parsed.toISOString());
            return;
          }
          onChange(event.currentTarget.value || null);
        }}
        className={cn(valueInputClass, property.valueType === "text" || property.valueType === "person" ? "w-32" : "w-28")}
      />
    </label>
  );
}

const displayedProperties = (
  model: DatabaseViewRenderModel,
): readonly DataSourcePropertyRecordV2[] => {
  const visible = new Set(model.query.view.config.display.propertyIds);
  return model.query.properties.filter(
    (property) =>
      property.lifecycle === "active"
      && visible.has(property.propertyId),
  );
};

function DurablePageSurface({
  model,
  row,
  compact,
  busy,
  canMoveUp,
  canMoveDown,
  openPageStage,
  onSetValue,
  onMove,
}: {
  readonly model: DatabaseViewRenderModel;
  readonly row: DatabaseViewRenderRow;
  readonly compact: boolean;
  readonly busy: boolean;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly openPageStage: DurableDatabaseViewProps["openPageStage"];
  readonly onSetValue: (
    pageId: string,
    propertyId: string,
    value: DatabaseJsonValue,
  ) => void;
  readonly onMove: (pageId: string, direction: "up" | "down") => void;
}) {
  const authority = rowByPageId(model, row.pageId);
  if (!authority) return null;
  const properties = displayedProperties(model);
  const showTitle = model.query.view.config.display.showTitle;
  return (
    <article className={cn(
      "group/card min-w-0 rounded-lg bg-token-foreground/5",
      compact ? "px-2.5 py-2" : "px-2 py-1.5",
    )}>
      <div className="flex min-h-6 items-center gap-1">
        <button
          type="button"
          aria-label={`Open Page ${row.title}`}
          className={cn(
            "min-w-0 flex-1 text-left text-sm text-token-text-primary outline-none",
            showTitle ? "truncate" : "text-token-description-foreground",
          )}
          onClick={() => openPageStage(
            model.projectId,
            row.pageId,
            row.title,
            { openMode: "preview" },
          )}
        >
          {showTitle ? row.title || "Untitled" : "Open Page"}
        </button>
        {databaseViewSupportsManualReorder(model) ? (
          <div className="flex shrink-0 opacity-0 group-hover/card:opacity-100 focus-within:opacity-100">
            <NodexIconButton
              icon={ArrowUp}
              size="xs"
              ariaLabel={`Move ${row.title} up`}
              disabled={busy || !canMoveUp}
              onClick={() => onMove(row.pageId, "up")}
            />
            <NodexIconButton
              icon={ArrowDown}
              size="xs"
              ariaLabel={`Move ${row.title} down`}
              disabled={busy || !canMoveDown}
              onClick={() => onMove(row.pageId, "down")}
            />
          </div>
        ) : null}
      </div>
      {properties.length > 0 ? (
        <div className={cn("mt-1.5 flex min-w-0 flex-wrap gap-x-2 gap-y-1", compact && "flex-col items-start")}>
          {properties.map((property) => {
            const current = authority.values[property.propertyId];
            return (
              <DatabasePropertyValueEditor
                key={property.propertyId}
                property={property}
                value={current?.value}
                revision={current?.revision ?? 0}
                disabled={busy}
                onChange={(value) =>
                  onSetValue(row.pageId, property.propertyId, value)}
              />
            );
          })}
        </div>
      ) : null}
    </article>
  );
}

const calendarProperty = (
  model: DatabaseViewRenderModel,
): DataSourcePropertyRecordV2 | null => {
  const visible = displayedProperties(model).find(
    (property) => property.valueType === "date" || property.valueType === "datetime",
  );
  if (visible) return visible;
  return model.query.properties.find(
    (property) =>
      property.lifecycle === "active" &&
      (property.valueType === "date" || property.valueType === "datetime"),
  ) ?? null;
};

const calendarDateKey = (
  model: DatabaseViewRenderModel,
  row: DatabaseViewRenderRow,
  property: DataSourcePropertyRecordV2 | null,
): string | null => {
  if (!property) return null;
  const value = rowByPageId(model, row.pageId)
    ?.values[property.propertyId]?.value;
  if (typeof value !== "string" || value.length < 10) return null;
  return value.slice(0, 10);
};

const calendarSections = (
  model: DatabaseViewRenderModel,
  rows: readonly DatabaseViewRenderRow[],
): readonly { readonly id: string; readonly label: string; readonly rows: readonly DatabaseViewRenderRow[] }[] => {
  const property = calendarProperty(model);
  const grouped = new Map<string | null, DatabaseViewRenderRow[]>();
  for (const row of rows) {
    const key = calendarDateKey(model, row, property);
    const current = grouped.get(key) ?? [];
    current.push(row);
    grouped.set(key, current);
  }
  return [...grouped]
    .sort(([left], [right]) => {
      if (left === null) return 1;
      if (right === null) return -1;
      return left.localeCompare(right);
    })
    .map(([key, sectionRows]) => ({
      id: key ?? "undated",
      label: key ?? (property ? `No ${property.name}` : "No date property"),
      rows: sectionRows,
    }));
};

export function DatabaseViewSurface({
  model,
  searchQuery,
  openPageStage,
  onCommitted,
  commitOperations = commitDatabaseViewOperations,
}: DurableDatabaseViewProps) {
  const clientSessionId = useMutationAuditSessionId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const searchTokens = useMemo(
    () => tokenizeSearchQuery(deferredSearchQuery),
    [deferredSearchQuery],
  );
  const columns = useMemo(
    () => model.columns.map((column): DatabaseViewRenderColumn => ({
      ...column,
      rows: searchTokens.length === 0
        ? column.rows
        : column.rows.filter((row) =>
            matchesSearchTokens(
              normalizeSearchText(
                `${row.title} ${row.preview} ${row.plainText} ${row.tags.join(" ")} ${searchablePropertyValues(model, row.pageId)}`,
              ),
              searchTokens,
            )),
    })),
    [model, searchTokens],
  );
  const allRows = columns.flatMap((column) => column.rows);

  const commit = async (
    operations: Parameters<typeof commitDatabaseViewOperations>[0]["operations"],
  ) => {
    if (operations.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await commitOperations({
        model,
        operations,
        clientSessionId,
      });
      await onCommitted?.();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Database View mutation failed");
      await onCommitted?.();
    } finally {
      setBusy(false);
    }
  };

  const setValue = (
    pageId: string,
    propertyId: string,
    value: DatabaseJsonValue,
  ) => void commit(buildDatabaseViewPropertyValueOperations({
    model,
    pageId,
    propertyId,
    value,
  }));
  const move = (pageId: string, direction: "up" | "down") =>
    void commit(buildDatabaseViewMoveOperations({ model, pageId, direction }));
  const pageProps = (row: DatabaseViewRenderRow) => ({
      model,
      row,
      busy,
      canMoveUp: canMoveDatabaseViewPage({ model, pageId: row.pageId, direction: "up" }),
      canMoveDown: canMoveDatabaseViewPage({ model, pageId: row.pageId, direction: "down" }),
      openPageStage,
      onSetValue: setValue,
      onMove: move,
    } as const);

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-token-main-surface-primary"
      data-database-view-id={model.databaseViewId}
    >
      {error ? (
        <div role="alert" className="mx-3 mt-2 rounded-lg bg-token-error-background/30 px-2.5 py-1.5 text-xs text-token-error-foreground">
          {error} — refreshed from current authority.
        </div>
      ) : null}
      {model.query.view.kind === "kanban" ? (
        <div className="flex min-h-0 flex-1 gap-2 overflow-auto p-3">
          {columns.map((column) => (
            <section key={column.id} className="w-64 shrink-0">
              <div className="mb-1.5 flex h-7 items-center gap-2 px-1 text-xs text-token-text-secondary">
                <span className="min-w-0 flex-1 truncate font-medium text-token-text-primary">{column.name}</span>
                <span>{column.rows.length}</span>
              </div>
              <div className="flex flex-col gap-1">
                {column.rows.map((row) => (
                  <DurablePageSurface key={row.pageId} compact {...pageProps(row)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : model.query.view.kind === "calendar" ? (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <div className="mx-auto max-w-4xl space-y-3">
            {calendarSections(model, allRows).map((section) => (
              <section key={section.id}>
                <div className="mb-1 flex h-7 items-center gap-2 px-2 text-xs text-token-description-foreground">
                  <CalendarDays className="size-3.5" />
                  <span className="min-w-0 flex-1 font-medium text-token-text-primary">{section.label}</span>
                  <span>{section.rows.length}</span>
                </div>
                <div className="space-y-1">
                  {section.rows.map((row) => (
                    <DurablePageSurface key={row.pageId} compact={false} {...pageProps(row)} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      ) : model.query.view.kind === "canvas" ? (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <div className="mb-2 flex h-7 items-center gap-2 px-1 text-xs text-token-description-foreground">
            <LayoutGrid className="size-3.5" />
            <span className="min-w-0 flex-1 truncate">{model.databaseName} / {model.viewName}</span>
            <span>{allRows.length}</span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
            {allRows.map((row) => (
              <DurablePageSurface key={row.pageId} compact {...pageProps(row)} />
            ))}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <div className="mx-auto max-w-4xl">
            <div className="mb-1 flex h-7 items-center gap-2 px-2 text-xs text-token-description-foreground">
              <List className="size-3.5" />
              <span className="min-w-0 flex-1 truncate">{model.databaseName} / {model.viewName}</span>
              <span>{allRows.length}</span>
            </div>
            <div className="space-y-1">
              {allRows.map((row) => (
                <DurablePageSurface key={row.pageId} compact={false} {...pageProps(row)} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
