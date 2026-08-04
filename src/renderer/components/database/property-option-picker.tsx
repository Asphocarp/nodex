import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CheckmarkIcon,
  CloseIcon,
  PlusIcon,
  SearchIcon,
} from "@/components/shared/icons";
import {
  NodexPopover,
  NodexPopoverContent,
  NodexPopoverTrigger,
} from "@/components/ui/popover";
import {
  canCreateDataSourcePropertyOption,
  filterDataSourcePropertyOptions,
  presentSelectedDataSourcePropertyOptions,
  propertyOptionColorClassName,
  type PresentedDataSourcePropertyOption,
} from "@/lib/data-source-property-options";
import { cn } from "@/lib/utils";
import type { DatabasePropertyOption } from "../../../shared/database-kernel";
import {
  PROPERTY_EMPTY_VALUE_LABEL,
  PropertyEmptyValue,
} from "./property-empty-value";

export type PropertyOptionPickerMode = "single" | "multiple";

export interface PropertyOptionRenderContext {
  readonly selected: boolean;
  readonly location: "trigger" | "list" | "selected";
  readonly missing: boolean;
}

export interface PropertyOptionPickerProps {
  readonly label: string;
  readonly mode: PropertyOptionPickerMode;
  readonly options: readonly DatabasePropertyOption[];
  readonly selectedIds: readonly string[];
  readonly disabled?: boolean;
  readonly pending?: boolean;
  readonly loading?: boolean;
  readonly loadingMore?: boolean;
  readonly registryError?: boolean;
  readonly hasMore?: boolean;
  readonly presentation?: "compact" | "page";
  readonly allowCreate?: boolean;
  readonly allowClear?: boolean;
  readonly onOpen?: () => void;
  readonly onLoadMore?: () => void;
  readonly onSelectedIdsChange: (selectedIds: readonly string[]) => void;
  readonly onCreateOption?: (name: string) => void | Promise<unknown>;
  readonly renderOption?: (
    option: PresentedDataSourcePropertyOption,
    context: PropertyOptionRenderContext,
  ) => ReactNode;
}

export function PropertyOptionToken({
  option,
  className,
}: {
  readonly option: PresentedDataSourcePropertyOption;
  readonly className?: string;
}) {
  return (
    <span className={cn(
      "inline-flex h-5.5 min-w-0 max-w-full items-center rounded-md px-1.5 text-sm/5",
      option.missing
        ? "bg-token-error-background/25 text-token-error-foreground"
        : propertyOptionColorClassName(option.color),
      className,
    )}>
      <span className="truncate">{option.name}</span>
    </span>
  );
}

const dedupe = (values: readonly string[]): readonly string[] => [...new Set(values)];

export function PropertyOptionPicker({
  label,
  mode,
  options,
  selectedIds,
  disabled = false,
  pending = false,
  loading = false,
  loadingMore = false,
  registryError = false,
  hasMore = false,
  presentation = "compact",
  allowCreate = false,
  allowClear = true,
  onOpen,
  onLoadMore,
  onSelectedIdsChange,
  onCreateOption,
  renderOption = (option) => <PropertyOptionToken option={option} />,
}: PropertyOptionPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const onOpenRef = useRef(onOpen);
  const optionLoadRequestedRef = useRef(false);
  onOpenRef.current = onOpen;
  const triggerDisabled = disabled || pending;
  const mutationDisabled = triggerDisabled || loading;
  const selected = dedupe(selectedIds);
  const selectedSet = new Set(selected);
  const presentedSelected = presentSelectedDataSourcePropertyOptions(options, selected)
    .map((option) => option.missing && loading
      ? { ...option, name: "Loading…", missing: false }
      : option);
  const filtered = filterDataSourcePropertyOptions(options, query);
  const canCreate = allowCreate
    && onCreateOption !== undefined
    && canCreateDataSourcePropertyOption(options, query);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
      setCreating(false);
      setError(null);
      return;
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!disabled) return;
    setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) {
      optionLoadRequestedRef.current = false;
      return;
    }
    if (!loading) {
      optionLoadRequestedRef.current = false;
      return;
    }
    if (registryError || optionLoadRequestedRef.current) return;
    optionLoadRequestedRef.current = true;
    onOpenRef.current?.();
  }, [loading, open, registryError]);

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  const selectOption = (optionId: string) => {
    if (mutationDisabled) return;
    if (mode === "single") {
      if (selectedSet.has(optionId)) {
        setOpen(false);
        return;
      }
      onSelectedIdsChange([optionId]);
      setOpen(false);
      return;
    }
    onSelectedIdsChange(
      selectedSet.has(optionId)
        ? selected.filter((id) => id !== optionId)
        : [...selected, optionId],
    );
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const createOption = async () => {
    if (mutationDisabled || !canCreate || !onCreateOption) return;
    setCreating(true);
    setError(null);
    try {
      await onCreateOption(query.trim());
      setQuery("");
      if (mode === "single") setOpen(false);
    } catch (cause) {
      console.error("[property-option:create]", cause);
      setError("Couldn’t create option. Try again.");
    } finally {
      setCreating(false);
    }
  };

  const triggerContent = presentedSelected.length === 0
    ? <PropertyEmptyValue />
    : mode === "single"
      ? renderOption(presentedSelected[0]!, {
          selected: true,
          location: "trigger",
          missing: presentedSelected[0]!.missing,
        })
      : (
          <span className="flex min-w-0 flex-wrap items-center gap-1">
            {presentedSelected.map((option) => (
              <span key={option.id} className="min-w-0">
                {renderOption(option, {
                  selected: true,
                  location: "trigger",
                  missing: option.missing,
                })}
              </span>
            ))}
          </span>
        );

  return (
    <NodexPopover open={open} onOpenChange={(next) => {
      if (next && triggerDisabled) return;
      if (next && !open) {
        optionLoadRequestedRef.current = true;
        onOpen?.();
      }
      setOpen(next);
    }}>
      <NodexPopoverTrigger asChild disabled={triggerDisabled}>
        <button
          type="button"
          aria-label={`Edit ${label}`}
          className={cn(
            "inline-flex min-h-6 min-w-0 max-w-full items-center rounded-md text-left outline-hidden",
            "hover:bg-token-foreground/5 focus-visible:ring-2 focus-visible:ring-token-focus disabled:opacity-50",
            presentation === "page" ? "px-1 text-sm" : "px-1 text-[11px]",
          )}
        >
          {triggerContent}
          {mode === "multiple" && presentedSelected.length > 0 ? (
            <span className="ml-1 inline-flex shrink-0 items-center gap-0.5 text-token-description-foreground">
              <PlusIcon className="icon-2xs" />
            </span>
          ) : null}
        </button>
      </NodexPopoverTrigger>
      <NodexPopoverContent
        align="start"
        className="w-[min(320px,calc(100vw-16px))] overflow-hidden p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {mode === "multiple" && presentedSelected.length > 0 ? (
          <div className="flex flex-wrap gap-1 px-2 pb-1 pt-2" aria-label={`Selected ${label}`}>
            {presentedSelected.map((option) => (
              <span key={option.id} className="inline-flex min-w-0 items-center rounded-md bg-token-foreground/5 pl-0.5">
                {renderOption(option, {
                  selected: true,
                  location: "selected",
                  missing: option.missing,
                })}
                <button
                  type="button"
                  aria-label={`Remove ${option.name}`}
                  disabled={mutationDisabled}
                  onClick={() => {
                    if (mutationDisabled) return;
                    onSelectedIdsChange(selected.filter((id) => id !== option.id));
                  }}
                  className="mx-0.5 grid size-5 shrink-0 place-items-center rounded text-token-description-foreground hover:bg-token-foreground/10 hover:text-token-foreground"
                >
                  <CloseIcon className="icon-xxs" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="flex min-h-9 items-center gap-1.5 px-2">
          <SearchIcon className="icon-2xs shrink-0 text-token-description-foreground" />
          <input
            ref={inputRef}
            role="combobox"
            aria-label={`Search ${label} options`}
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-activedescendant={filtered[activeIndex]
              ? `${listboxId}-${filtered[activeIndex]!.id}`
              : undefined}
            value={query}
            disabled={mutationDisabled}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
                return;
              }
              if (
                event.key === "Backspace"
                && mode === "multiple"
                && query.length === 0
                && selected.length > 0
              ) {
                event.preventDefault();
                onSelectedIdsChange(selected.slice(0, -1));
                return;
              }
              if (event.key === "Home") {
                event.preventDefault();
                if (filtered.length > 0) setActiveIndex(0);
                return;
              }
              if (event.key === "End") {
                event.preventDefault();
                if (filtered.length > 0) setActiveIndex(filtered.length - 1);
                return;
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                if (filtered.length === 0) return;
                setActiveIndex((current) => Math.min(filtered.length - 1, current + 1));
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((current) => Math.max(0, current - 1));
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                const active = filtered[activeIndex];
                if (active) selectOption(active.id);
                else void createOption();
              }
            }}
            placeholder="Search options…"
            className="h-8 min-w-0 flex-1 bg-transparent text-sm text-token-text-primary outline-none placeholder:text-token-description-foreground"
          />
        </div>
        <div className="h-px bg-token-foreground/8" />
        <div
          id={listboxId}
          role="listbox"
          aria-multiselectable={mode === "multiple"}
          className="max-h-64 overflow-y-auto p-1"
          onScroll={(event) => {
            if (!hasMore || loadingMore || registryError || !onLoadMore) return;
            const list = event.currentTarget;
            if (list.scrollHeight - list.scrollTop - list.clientHeight > 48) return;
            onLoadMore();
          }}
        >
          {mode === "single" && allowClear && selected.length > 0 && !query ? (
            <button
              type="button"
              role="option"
              aria-selected={false}
              disabled={mutationDisabled}
              onClick={() => {
                if (mutationDisabled) return;
                onSelectedIdsChange([]);
                setOpen(false);
              }}
              className="flex min-h-7 w-full items-center rounded-lg px-2 text-left text-sm text-token-description-foreground hover:bg-token-list-hover-background"
            >
              {PROPERTY_EMPTY_VALUE_LABEL}
            </button>
          ) : null}
          {filtered.map((option, index) => {
            const isSelected = selectedSet.has(option.id);
            const presented = { ...option, missing: false };
            return (
              <button
                key={option.id}
                id={`${listboxId}-${option.id}`}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={mutationDisabled}
                onMouseEnter={() => setActiveIndex(index)}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => selectOption(option.id)}
                className={cn(
                  "flex min-h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm outline-hidden",
                  "hover:bg-token-list-hover-background focus-visible:bg-token-list-hover-background",
                  activeIndex === index && "bg-token-list-hover-background",
                )}
              >
                <span className="min-w-0 flex-1">
                  {renderOption(presented, {
                    selected: isSelected,
                    location: "list",
                    missing: false,
                  })}
                </span>
                {isSelected ? <CheckmarkIcon className="icon-2xs shrink-0 text-token-text-secondary" /> : null}
              </button>
            );
          })}
        </div>
        {registryError ? (
          <div role="alert" aria-atomic="true">
            <button
              type="button"
              aria-label="Couldn’t load options. Retry"
              onClick={onOpen}
              className="flex min-h-9 w-full items-center justify-between px-3 text-left text-sm text-token-error-foreground hover:bg-token-error-background/20"
            >
              <span>Couldn’t load options</span>
              <span className="text-xs font-medium">Retry</span>
            </button>
          </div>
        ) : filtered.length === 0 && !canCreate ? (
          <p className="px-3 py-2 text-sm text-token-description-foreground">
            {loading ? "Loading options…" : "No options"}
          </p>
        ) : null}
        {canCreate ? (
          <div className="p-1">
            <button
              type="button"
              disabled={mutationDisabled || creating}
              onClick={() => void createOption()}
              className="flex min-h-8 w-full items-center gap-1.5 rounded-lg px-2 text-left text-sm text-token-text-primary hover:bg-token-list-hover-background disabled:opacity-50"
            >
              <PlusIcon className="icon-2xs shrink-0 text-token-text-secondary" />
              <span className="truncate">Create “{query.trim()}”</span>
            </button>
          </div>
        ) : null}
        {hasMore && !registryError ? (
          <div className="border-t border-token-foreground/8 p-1">
            <button
              type="button"
              disabled={loadingMore}
              onClick={onLoadMore}
              className="min-h-8 w-full rounded-lg px-2 text-left text-sm text-token-description-foreground hover:bg-token-list-hover-background disabled:opacity-50"
            >
              {loadingMore ? "Loading more…" : "Load more"}
            </button>
          </div>
        ) : null}
        {error ? (
          <p role="alert" aria-atomic="true" className="px-3 py-1.5 text-xs text-token-error-foreground">
            {error}
          </p>
        ) : null}
      </NodexPopoverContent>
    </NodexPopover>
  );
}
