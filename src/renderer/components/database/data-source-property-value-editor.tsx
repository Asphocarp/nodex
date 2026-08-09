import { useEffect, useRef, useState } from "react";
import { CheckmarkIcon } from "@/components/shared/icons";
import { cn } from "@/lib/utils";
import {
  createCustomOptionId,
  isCustomDataSourcePropertyId,
} from "../../../shared/database-identities";
import type {
  DatabaseJsonValue,
} from "../../../shared/database-kernel";
import { resolveDataSourcePropertyPresentationRole } from "@/lib/data-source-property-presentation-role";
import { defaultDataSourcePropertyOptionColor } from "@/lib/data-source-property-options";
import {
  RelationPropertyEditor,
} from "./relation-property-editor";
import { PropertyOptionPicker } from "./property-option-picker";
import { SemanticSelectPropertyEditor } from "./semantic-property-editors";
import { DatePropertyEditor } from "./date-property-editor";
import type { DataSourcePropertyEditorBinding } from "./data-source-property-editor-binding";
import { PROPERTY_EMPTY_VALUE_LABEL } from "./property-empty-value";

const valueInputClass = cn(
  "h-6 min-w-0 rounded-md border border-transparent bg-transparent",
  "text-token-text-secondary outline-none placeholder:text-token-text-secondary hover:bg-token-foreground/5 focus:border-token-focus-border focus:bg-token-foreground/5",
);

const scalarString = (value: DatabaseJsonValue | undefined): string =>
  typeof value === "string" ? value : "";

const unsupportedPropertyValueType = (valueType: never): never => {
  throw new Error(`Unsupported Property value type: ${String(valueType)}`);
};

interface ScalarPropertyEditorProps {
  readonly label: string;
  readonly value: string;
  readonly revision: number;
  readonly disabled: boolean;
  readonly presentation: "compact" | "page";
  readonly kind: "text" | "number";
  readonly onChange: (value: DatabaseJsonValue) => void;
}

function ScalarPropertyEditor({
  label,
  value,
  revision,
  disabled,
  presentation,
  kind,
  onChange,
}: ScalarPropertyEditorProps) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const skipBlurCommitRef = useRef(false);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  useEffect(() => {
    setDraft(value);
    setError(null);
  }, [revision, value]);

  const commit = () => {
    if (disabledRef.current) {
      setDraft(value);
      setError(null);
      return;
    }
    if (draft === value) return;
    if (kind !== "number") {
      onChange(draft || null);
      return;
    }
    if (!draft.trim()) {
      onChange(null);
      return;
    }
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setError("Enter a finite number");
      return;
    }
    setError(null);
    onChange(parsed);
  };

  return (
    <span className="inline-flex min-w-0 flex-col">
      <input
        type="text"
        inputMode={kind === "number" ? "decimal" : "text"}
        aria-label={`${label} value`}
        aria-invalid={error !== null}
        value={draft}
        disabled={disabled}
        placeholder={PROPERTY_EMPTY_VALUE_LABEL}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (skipBlurCommitRef.current) {
            skipBlurCommitRef.current = false;
            return;
          }
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key !== "Escape") return;
          skipBlurCommitRef.current = true;
          setDraft(value);
          setError(null);
          event.currentTarget.blur();
        }}
        className={cn(
          valueInputClass,
          presentation === "page"
            ? "w-full max-w-72 px-1 text-sm"
            : "w-32 px-1.5 text-[11px]",
        )}
      />
      {error ? <span role="alert" className="px-1.5 text-xs text-token-error-foreground">{error}</span> : null}
    </span>
  );
}

export interface DataSourcePropertyValueEditorProps
  extends DataSourcePropertyEditorBinding {
  readonly showLabel?: boolean;
  readonly presentation?: "compact" | "page";
}

export function DataSourcePropertyValueEditor({
  property,
  value,
  revision,
  disabled,
  pending = false,
  showLabel = true,
  presentation = "compact",
  onChange,
  onCreateOption,
  onRequestOptions,
  optionRegistryHasMore = false,
  optionRegistryLoadingMore = false,
  onRequestMoreOptions,
  onPatchOptions,
  relationCandidates = [],
  options = [],
  optionRegistryState = "ready",
  onPatchRelation = () => undefined,
  onLoadRelationTargets,
  onSearchRelationCandidates,
  onLoadRelationTargetDescriptor,
  onOpenRelationPage,
  onRelationValueStale,
}: DataSourcePropertyValueEditorProps) {
  const role = resolveDataSourcePropertyPresentationRole(property);
  const createOption = onCreateOption
    ? (name: string) => {
        const optionId = createCustomOptionId();
        return onCreateOption({
          optionId,
          name,
          color: defaultDataSourcePropertyOptionColor(optionId),
        });
      }
    : undefined;
  const textClass = presentation === "page" ? "text-sm" : "text-[11px]";
  const label = showLabel ? (
    <span className={cn("shrink-0 text-token-description-foreground", textClass)}>
      {property.name}
    </span>
  ) : null;
  if (property.valueType === "relation") {
    return (
      <RelationPropertyEditor
        label={property.name}
        value={value}
        candidates={relationCandidates}
        disabled={disabled}
        pending={pending}
        targetMatchesCurrentSource={
          property.schema.kind === "relation"
          && property.schema.targetDataSourceId === property.dataSourceId
        }
        onPatch={onPatchRelation}
        onClear={() => onChange([])}
        onLoadMore={onLoadRelationTargets}
        onSearchCandidates={onSearchRelationCandidates}
        onLoadTargetDescriptor={onLoadRelationTargetDescriptor}
        onOpenPage={onOpenRelationPage}
        onValueStale={onRelationValueStale}
        showLabel={showLabel}
        presentation={presentation}
      />
    );
  }
  if (property.valueType === "checkbox") {
    return (
      <span className="inline-flex min-w-0 items-center gap-1">
        {label}
        <button
          type="button"
          role="checkbox"
          aria-label={`${property.name} value`}
          aria-checked={value === true}
          disabled={disabled || pending}
          onClick={() => onChange(value !== true)}
          className={cn(
            "grid size-4 shrink-0 place-items-center rounded-[4px] ring-[0.5px] outline-hidden",
            "focus-visible:ring-2 focus-visible:ring-token-focus disabled:opacity-50",
            value === true
              ? "bg-(--accent-blue) text-white ring-transparent"
              : "bg-token-foreground/5 text-transparent ring-token-border hover:bg-token-foreground/10",
          )}
        >
          <CheckmarkIcon className="icon-xxs" />
        </button>
      </span>
    );
  }
  if (property.valueType === "select") {
    const selectedId = scalarString(value) || null;
    const semanticKind = role.kind === "status"
      || role.kind === "priority"
      || role.kind === "estimate"
      ? role.kind
      : null;
    const editor = semanticKind ? (
      <SemanticSelectPropertyEditor
        kind={semanticKind}
        label={property.name}
        options={options}
        registryState={optionRegistryState}
        selectedId={selectedId}
        disabled={disabled}
        pending={pending}
        presentation={presentation}
        onRequestOptions={onRequestOptions}
        hasMore={optionRegistryHasMore}
        loadingMore={optionRegistryLoadingMore}
        onRequestMoreOptions={onRequestMoreOptions}
        onChange={onChange}
      />
    ) : (
      <PropertyOptionPicker
        label={property.name}
        mode="single"
        options={options}
        selectedIds={selectedId ? [selectedId] : []}
        disabled={disabled}
        pending={pending}
        presentation={presentation}
        registryError={optionRegistryState === "error"}
        loading={optionRegistryState === "idle" || optionRegistryState === "loading"}
        onOpen={onRequestOptions}
        hasMore={optionRegistryHasMore}
        loadingMore={optionRegistryLoadingMore}
        onLoadMore={onRequestMoreOptions}
        allowCreate={
          optionRegistryState === "ready"
          && !optionRegistryHasMore
          && isCustomDataSourcePropertyId(property.propertyId)
        }
        onSelectedIdsChange={(ids) => onChange(ids[0] ?? null)}
        onCreateOption={createOption}
      />
    );
    return <span className="inline-flex min-w-0 items-center gap-1">{label}{editor}</span>;
  }
  if (property.valueType === "multi_select") {
    const selectedIds = Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [];
    const changeSelectedIds = (nextIds: readonly string[]) => {
      if (!onPatchOptions) {
        onChange([...nextIds]);
        return;
      }
      const current = new Set(selectedIds);
      const next = new Set(nextIds);
      onPatchOptions({
        addOptionIds: [...next].filter((optionId) => !current.has(optionId)),
        removeOptionIds: [...current].filter((optionId) => !next.has(optionId)),
      });
    };
    return (
      <span className="inline-flex min-w-0 items-center gap-1">
        {label}
        <PropertyOptionPicker
          label={property.name}
          mode="multiple"
          options={options}
          loading={optionRegistryState === "idle" || optionRegistryState === "loading"}
          registryError={optionRegistryState === "error"}
          onOpen={onRequestOptions}
          hasMore={optionRegistryHasMore}
          loadingMore={optionRegistryLoadingMore}
          onLoadMore={onRequestMoreOptions}
          selectedIds={selectedIds}
          disabled={disabled}
          pending={pending}
          presentation={presentation}
          allowCreate={
            optionRegistryState === "ready"
            && !optionRegistryHasMore
            && (
              role.kind === "tags"
              || isCustomDataSourcePropertyId(property.propertyId)
            )
          }
          onSelectedIdsChange={changeSelectedIds}
          onCreateOption={createOption}
        />
      </span>
    );
  }
  if (
    property.valueType === "date"
    || property.valueType === "datetime"
  ) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1">
        {label}
        <DatePropertyEditor
          label={property.name}
          mode={property.valueType}
          value={scalarString(value) || null}
          revision={revision}
          disabled={disabled || pending}
          presentation={presentation}
          onChange={onChange}
        />
      </span>
    );
  }
  if (
    property.valueType === "text"
    || property.valueType === "number"
  ) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1">
        {label}
        <ScalarPropertyEditor
          label={property.name}
          value={property.valueType === "number"
            ? typeof value === "number" ? String(value) : ""
            : scalarString(value)}
          revision={revision}
          disabled={disabled || pending}
          presentation={presentation}
          kind={property.valueType}
          onChange={onChange}
        />
      </span>
    );
  }
  return unsupportedPropertyValueType(property.valueType);
}
