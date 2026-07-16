import {
  ArrowDown,
  ArrowUp,
  ListFilter,
  Plus,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import type {
  DatabaseJsonValue,
  DatabaseViewFilterClause,
  DatabaseViewFilterNode,
  DatabaseViewFilterOperator,
  DatabaseViewSort,
  DatabaseViewConfig,
} from "../../../shared/database-kernel";
import type { DataSourcePropertyRecord } from "../../../shared/database-module";
import { NodexButton, NodexIconButton } from "@/components/ui/button";
import {
  appendDatabaseViewFilterChild,
  createDatabaseViewFilterClause,
  createDatabaseViewSort,
  databaseFilterClauseWithOperator,
  databaseFilterClauseWithProperty,
  filterOperatorsForProperty,
  moveDatabaseViewSort,
  readDatabasePropertyOptions,
  removeDatabaseViewFilterNode,
  updateDatabaseViewFilterNode,
  type DatabaseViewFilterPath,
} from "@/lib/database-view-authoring";
import { cn } from "@/lib/utils";

interface DatabaseViewConfigEditorProps {
  readonly config: DatabaseViewConfig;
  readonly properties: readonly DataSourcePropertyRecord[];
  readonly disabled?: boolean;
  readonly onChange: (config: DatabaseViewConfig) => void;
}

const selectClass = cn(
  "h-7 min-w-0 rounded-md border border-transparent bg-token-foreground/5 px-2 text-xs",
  "text-token-text-secondary outline-none hover:bg-token-foreground/8 focus:border-token-focus-border",
);

const inputClass = cn(
  "h-7 min-w-0 rounded-md border border-transparent bg-token-foreground/5 px-2 text-xs",
  "text-token-text-primary outline-none placeholder:text-token-description-foreground focus:border-token-focus-border",
);

const FILTER_OPERATOR_LABELS: Readonly<Record<DatabaseViewFilterOperator, string>> = {
  equals: "is",
  not_equals: "is not",
  contains: "contains",
  not_contains: "does not contain",
  is_empty: "is empty",
  is_not_empty: "is not empty",
};

const activeProperties = (
  properties: readonly DataSourcePropertyRecord[],
): readonly DataSourcePropertyRecord[] =>
  properties.filter((property) => property.lifecycle === "active");

const propertyForClause = (
  properties: readonly DataSourcePropertyRecord[],
  clause: DatabaseViewFilterClause,
): DataSourcePropertyRecord | null =>
  properties.find(
    (property) => property.propertyId === clause.propertyId,
  ) ?? null;

const stringValue = (value: DatabaseJsonValue | undefined): string =>
  typeof value === "string" ? value : "";

const datetimeLocalValue = (value: DatabaseJsonValue | undefined): string => {
  if (typeof value !== "string") return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const offset = parsed.getTimezoneOffset() * 60_000;
  return new Date(parsed.getTime() - offset).toISOString().slice(0, 16);
};

function FilterValueField({
  clause,
  property,
  disabled,
  onChange,
}: {
  readonly clause: DatabaseViewFilterClause;
  readonly property: DataSourcePropertyRecord;
  readonly disabled: boolean;
  readonly onChange: (value: DatabaseJsonValue) => void;
}) {
  if (clause.operator === "is_empty" || clause.operator === "is_not_empty") {
    return null;
  }
  if (property.valueType === "checkbox") {
    return (
      <select
        aria-label={`Filter value for ${property.name}`}
        value={clause.value === true ? "true" : "false"}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value === "true")}
        className={selectClass}
      >
        <option value="true">Checked</option>
        <option value="false">Unchecked</option>
      </select>
    );
  }
  if (property.valueType === "select" || property.valueType === "multi_select") {
    const options = readDatabasePropertyOptions(property);
    const isMembershipOperator =
      clause.operator === "contains" || clause.operator === "not_contains";
    const rawValue = property.valueType === "multi_select" && !isMembershipOperator
      ? Array.isArray(clause.value) && typeof clause.value[0] === "string"
        ? clause.value[0]
        : ""
      : stringValue(clause.value);
    return (
      <select
        aria-label={`Filter value for ${property.name}`}
        value={rawValue}
        disabled={disabled}
        onChange={(event) => {
          const value = event.target.value;
          onChange(
            property.valueType === "multi_select" && !isMembershipOperator
              ? value ? [value] : []
              : value || null,
          );
        }}
        className={selectClass}
      >
        <option value="">None</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>{option.name}</option>
        ))}
      </select>
    );
  }
  if (property.valueType === "number") {
    return (
      <input
        type="number"
        aria-label={`Filter value for ${property.name}`}
        value={typeof clause.value === "number" ? String(clause.value) : ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
        className={cn(inputClass, "w-28")}
      />
    );
  }
  return (
    <input
      type={property.valueType === "date" ? "date" : property.valueType === "datetime" ? "datetime-local" : "text"}
      aria-label={`Filter value for ${property.name}`}
      value={property.valueType === "datetime" ? datetimeLocalValue(clause.value) : stringValue(clause.value)}
      disabled={disabled}
      onChange={(event) => {
        if (property.valueType !== "datetime") {
          onChange(event.target.value);
          return;
        }
        const parsed = new Date(event.target.value);
        onChange(Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString());
      }}
      className={cn(inputClass, "w-36")}
    />
  );
}

function FilterNodeEditor({
  node,
  path,
  depth,
  properties,
  disabled,
  onUpdate,
  onRemove,
  onAppend,
}: {
  readonly node: DatabaseViewFilterNode;
  readonly path: DatabaseViewFilterPath;
  readonly depth: number;
  readonly properties: readonly DataSourcePropertyRecord[];
  readonly disabled: boolean;
  readonly onUpdate: (path: DatabaseViewFilterPath, node: DatabaseViewFilterNode) => void;
  readonly onRemove: (path: DatabaseViewFilterPath) => void;
  readonly onAppend: (path: DatabaseViewFilterPath, node: DatabaseViewFilterNode) => void;
}) {
  if (node.kind === "clause") {
    const property = propertyForClause(properties, node);
    if (!property) {
      return (
        <div className="flex min-h-8 items-center gap-2 rounded-md bg-token-error-background/30 px-2 text-xs text-token-error-foreground">
          <span className="min-w-0 flex-1 truncate">Missing property {node.propertyId}</span>
          <NodexIconButton
            icon={Trash2}
            size="xs"
            tone="danger"
            ariaLabel="Remove invalid filter"
            disabled={disabled}
            onClick={() => onRemove(path)}
          />
        </div>
      );
    }
    return (
      <div className="flex min-h-8 flex-wrap items-center gap-1.5">
        <select
          aria-label={`Filter property ${property.name}`}
          value={property.propertyId}
          disabled={disabled}
          onChange={(event) => {
            const nextProperty = properties.find(
              (candidate) => candidate.propertyId === event.target.value,
            );
            if (!nextProperty) return;
            onUpdate(path, databaseFilterClauseWithProperty(node, nextProperty));
          }}
          className={cn(selectClass, "max-w-40")}
        >
          {properties.map((candidate) => (
            <option key={candidate.propertyId} value={candidate.propertyId}>{candidate.name}</option>
          ))}
        </select>
        <select
          aria-label={`Filter operator for ${property.name}`}
          value={node.operator}
          disabled={disabled}
          onChange={(event) => onUpdate(
            path,
            databaseFilterClauseWithOperator(
              property,
              event.target.value as DatabaseViewFilterOperator,
            ),
          )}
          className={selectClass}
        >
          {filterOperatorsForProperty(property).map((operator) => (
            <option key={operator} value={operator}>{FILTER_OPERATOR_LABELS[operator]}</option>
          ))}
        </select>
        <FilterValueField
          clause={node}
          property={property}
          disabled={disabled}
          onChange={(value) => onUpdate(path, { ...node, value })}
        />
        <NodexIconButton
          icon={Trash2}
          size="xs"
          tone="danger"
          ariaLabel={`Remove filter ${property.name}`}
          disabled={disabled}
          onClick={() => onRemove(path)}
        />
      </div>
    );
  }

  return (
    <div className={cn(
      "min-w-0",
      depth > 0 && "rounded-lg bg-token-foreground/3 px-2 py-1.5",
    )}>
      <div className="flex min-h-8 items-center gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-token-description-foreground">
          {depth === 0 ? "Match" : "Group"}
        </span>
        <select
          aria-label={depth === 0 ? "Filter group operator" : `Nested filter group ${path.join(".")}`}
          value={node.operator}
          disabled={disabled}
          onChange={(event) => onUpdate(path, {
            ...node,
            operator: event.target.value as "and" | "or",
          })}
          className={selectClass}
        >
          <option value="and">All</option>
          <option value="or">Any</option>
        </select>
        <span className="text-xs text-token-description-foreground">of these rules</span>
        <div className="ml-auto flex items-center gap-1">
          {properties[0] ? (
            <NodexButton
              type="button"
              size="xs"
              variant="ghost"
              disabled={disabled}
              onClick={() => onAppend(path, createDatabaseViewFilterClause(properties[0]!))}
            >
              <Plus /> Rule
            </NodexButton>
          ) : null}
          {depth < 7 ? (
            <NodexButton
              type="button"
              size="xs"
              variant="ghost"
              disabled={disabled}
              onClick={() => onAppend(path, { kind: "group", operator: "and", children: [] })}
            >
              <Plus /> Group
            </NodexButton>
          ) : null}
          {depth > 0 ? (
            <NodexIconButton
              icon={Trash2}
              size="xs"
              tone="danger"
              ariaLabel={`Remove filter group ${path.join(".")}`}
              disabled={disabled}
              onClick={() => onRemove(path)}
            />
          ) : null}
        </div>
      </div>
      <div className={cn("space-y-1", depth > 0 && "pl-2")}>
        {node.children.map((child, index) => (
          <FilterNodeEditor
            key={`${path.join(".")}:${index}:${child.kind}`}
            node={child}
            path={[...path, index]}
            depth={depth + 1}
            properties={properties}
            disabled={disabled}
            onUpdate={onUpdate}
            onRemove={onRemove}
            onAppend={onAppend}
          />
        ))}
        {node.children.length === 0 ? (
          <p className="px-1 pb-1 text-xs text-token-description-foreground">
            No rules. This {node.operator === "and" ? "matches every" : "matches no"} Page.
          </p>
        ) : null}
      </div>
    </div>
  );
}

const sortFieldValue = (sort: DatabaseViewSort): string =>
  sort.field.kind === "property" ? `property:${sort.field.propertyId}` : sort.field.kind;

const sortWithField = (
  sort: DatabaseViewSort,
  encoded: string,
): DatabaseViewSort => ({
  ...sort,
  field: encoded.startsWith("property:")
    ? { kind: "property", propertyId: encoded.slice("property:".length) }
    : encoded === "manual"
      ? { kind: "manual" }
      : { kind: "title" },
});

function SortEditor({
  sorts,
  properties,
  disabled,
  onChange,
}: {
  readonly sorts: readonly DatabaseViewSort[];
  readonly properties: readonly DataSourcePropertyRecord[];
  readonly disabled: boolean;
  readonly onChange: (sorts: readonly DatabaseViewSort[]) => void;
}) {
  return (
    <div className="space-y-1">
      {sorts.map((sort, index) => (
        <div key={`${sortFieldValue(sort)}:${index}`} className="flex min-h-8 items-center gap-1.5">
          <span className="w-4 text-center text-[11px] text-token-description-foreground">{index + 1}</span>
          <select
            aria-label={`Sort field ${index + 1}`}
            value={sortFieldValue(sort)}
            disabled={disabled}
            onChange={(event) => onChange(sorts.map((candidate, candidateIndex) =>
              candidateIndex === index ? sortWithField(candidate, event.target.value) : candidate))}
            className={cn(selectClass, "w-36")}
          >
            <option value="manual">Manual order</option>
            <option value="title">Title</option>
            {properties.map((property) => (
              <option key={property.propertyId} value={`property:${property.propertyId}`}>{property.name}</option>
            ))}
          </select>
          <select
            aria-label={`Sort direction ${index + 1}`}
            value={sort.direction}
            disabled={disabled}
            onChange={(event) => onChange(sorts.map((candidate, candidateIndex) =>
              candidateIndex === index
                ? { ...candidate, direction: event.target.value as "asc" | "desc" }
                : candidate))}
            className={selectClass}
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
          <select
            aria-label={`Sort empty values ${index + 1}`}
            value={sort.nulls}
            disabled={disabled}
            onChange={(event) => onChange(sorts.map((candidate, candidateIndex) =>
              candidateIndex === index
                ? { ...candidate, nulls: event.target.value as "first" | "last" }
                : candidate))}
            className={selectClass}
          >
            <option value="last">Empty last</option>
            <option value="first">Empty first</option>
          </select>
          <NodexIconButton
            icon={ArrowUp}
            size="xs"
            ariaLabel={`Move sort ${index + 1} up`}
            disabled={disabled || index === 0}
            onClick={() => onChange(moveDatabaseViewSort(sorts, index, "up"))}
          />
          <NodexIconButton
            icon={ArrowDown}
            size="xs"
            ariaLabel={`Move sort ${index + 1} down`}
            disabled={disabled || index === sorts.length - 1}
            onClick={() => onChange(moveDatabaseViewSort(sorts, index, "down"))}
          />
          <NodexIconButton
            icon={Trash2}
            size="xs"
            tone="danger"
            ariaLabel={`Remove sort ${index + 1}`}
            disabled={disabled}
            onClick={() => onChange(sorts.filter((_, candidateIndex) => candidateIndex !== index))}
          />
        </div>
      ))}
      <NodexButton
        type="button"
        size="xs"
        variant="ghost"
        disabled={disabled}
        onClick={() => onChange([...sorts, createDatabaseViewSort()])}
      >
        <Plus /> Sort
      </NodexButton>
    </div>
  );
}

function ConfigSection({
  title,
  detail,
  children,
}: {
  readonly title: string;
  readonly detail: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="grid grid-cols-[112px_minmax(0,1fr)] gap-3 py-2.5 max-sm:grid-cols-1 max-sm:gap-1">
      <div>
        <h4 className="text-xs font-medium text-token-text-primary">{title}</h4>
        <p className="mt-0.5 text-[11px] leading-4 text-token-description-foreground">{detail}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function DatabaseViewConfigEditor({
  config,
  properties: allProperties,
  disabled = false,
  onChange,
}: DatabaseViewConfigEditorProps) {
  const properties = activeProperties(allProperties);
  const updateFilter = (
    path: DatabaseViewFilterPath,
    node: DatabaseViewFilterNode,
  ) => onChange({
    ...config,
    filter: updateDatabaseViewFilterNode(config.filter, path, node),
  });
  const removeFilter = (path: DatabaseViewFilterPath) => onChange({
    ...config,
    filter: removeDatabaseViewFilterNode(config.filter, path),
  });
  const appendFilter = (
    path: DatabaseViewFilterPath,
    node: DatabaseViewFilterNode,
  ) => onChange({
    ...config,
    filter: appendDatabaseViewFilterChild(config.filter, path, node),
  });

  return (
    <div className="divide-y divide-token-border/60 px-1 pb-1">
      <ConfigSection title="Filter" detail="Shared by every window">
        <div className="flex items-start gap-2">
          <ListFilter className="mt-1.5 size-3.5 shrink-0 text-token-description-foreground" />
          <div className="min-w-0 flex-1">
            {config.filter.kind === "group" ? (
              <FilterNodeEditor
                node={config.filter}
                path={[]}
                depth={0}
                properties={properties}
                disabled={disabled}
                onUpdate={updateFilter}
                onRemove={removeFilter}
                onAppend={appendFilter}
              />
            ) : (
              <div className="space-y-1">
                <FilterNodeEditor
                  node={config.filter}
                  path={[]}
                  depth={0}
                  properties={properties}
                  disabled={disabled}
                  onUpdate={updateFilter}
                  onRemove={removeFilter}
                  onAppend={appendFilter}
                />
                {properties[0] ? (
                  <NodexButton
                    type="button"
                    size="xs"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => onChange({
                      ...config,
                      filter: {
                        kind: "group",
                        operator: "and",
                        children: [config.filter, createDatabaseViewFilterClause(properties[0]!)],
                      },
                    })}
                  >
                    <Plus /> Rule
                  </NodexButton>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </ConfigSection>

      <ConfigSection title="Sort" detail="First rule wins">
        <SortEditor
          sorts={config.sort}
          properties={properties}
          disabled={disabled}
          onChange={(sort) => onChange({ ...config, sort })}
        />
      </ConfigSection>

      <ConfigSection title="Group" detail="One property per View">
        <select
          aria-label="Group View by property"
          value={config.group?.propertyId ?? ""}
          disabled={disabled}
          onChange={(event) => onChange({
            ...config,
            group: event.target.value ? { propertyId: event.target.value } : null,
          })}
          className={cn(selectClass, "w-52")}
        >
          <option value="">No grouping</option>
          {properties.map((property) => (
            <option key={property.propertyId} value={property.propertyId}>{property.name}</option>
          ))}
        </select>
      </ConfigSection>

      <ConfigSection title="Display" detail="Visible Page properties">
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          <label className="inline-flex h-7 items-center gap-2 text-xs text-token-text-secondary">
            <input
              type="checkbox"
              checked={config.display.showTitle}
              disabled={disabled}
              onChange={(event) => onChange({
                ...config,
                display: { ...config.display, showTitle: event.target.checked },
              })}
              className="size-3.5 accent-(--accent-blue)"
            />
            Title
          </label>
          {properties.map((property) => {
            const visible = config.display.propertyIds.includes(property.propertyId);
            return (
              <label key={property.propertyId} className="inline-flex h-7 items-center gap-2 text-xs text-token-text-secondary">
                <input
                  type="checkbox"
                  checked={visible}
                  disabled={disabled}
                  onChange={(event) => onChange({
                    ...config,
                    display: {
                      ...config.display,
                      propertyIds: event.target.checked
                        ? [...config.display.propertyIds, property.propertyId]
                        : config.display.propertyIds.filter(
                            (id) => id !== property.propertyId,
                          ),
                    },
                  })}
                  className="size-3.5 accent-(--accent-blue)"
                />
                {property.name}
              </label>
            );
          })}
        </div>
      </ConfigSection>
    </div>
  );
}
