import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import {
  ChevronRightIcon,
  Loader2,
  SlidersHorizontal,
} from "@/components/shared/icons/generic-icons";
import { NodexContextMenuSubContent } from "@/components/ui/context-menu";
import { NodexDropdown } from "@/components/ui/dropdown";
import { preserveInteractiveSubmenuRootFocus } from "@/lib/context-menu-submenu";
import { buildPagePropertyContextMenuModel } from "@/lib/page-property-context-menu-model";
import { cn } from "@/lib/utils";
import type { DataSourcePropertyEditorBinding } from "./data-source-property-editor-binding";
import { dataSourcePropertyIcon } from "./data-source-property-presentation";
import { DataSourcePropertyValueEditor } from "./data-source-property-value-editor";
import { PropertyEditorFeedback } from "./property-editor-feedback";

const ITEM_CLASS_NAME = cn(
  "cursor-interaction rounded-lg px-[var(--padding-row-x)] py-[var(--padding-row-y)] text-sm outline-hidden",
  "text-token-foreground hover:bg-token-list-hover-background focus:bg-token-list-hover-background",
  "data-[highlighted]:bg-token-list-hover-background data-[disabled]:pointer-events-none data-[disabled]:opacity-45",
);

const INPUT_CLASS_NAME = cn(
  "h-8 w-full rounded-lg border border-token-border bg-token-input-background px-2 text-sm",
  "text-token-text-primary outline-none placeholder:text-token-description-foreground focus-visible:ring-1 focus-visible:ring-token-focus",
);

const PropertyMenuTrigger = forwardRef<HTMLDivElement, {
  readonly binding: DataSourcePropertyEditorBinding;
  readonly itemDataAttribute?: string;
} & ComponentPropsWithoutRef<"div">>(function PropertyMenuTrigger({
  binding,
  itemDataAttribute,
  className,
  ...props
}, ref) {
  const Icon = dataSourcePropertyIcon(binding.property);
  return (
    <div
      ref={ref}
      {...props}
      data-page-property-menu-item="true"
      data-card-menu-item={itemDataAttribute}
      className={cn(ITEM_CLASS_NAME, "flex w-full items-center gap-2", className)}
    >
      <span className="flex size-5 shrink-0 items-center justify-center text-token-description-foreground">
        {binding.pending ? (
          <Loader2 className="size-4 animate-spin" strokeWidth={1.8} />
        ) : (
          <Icon className="size-4" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate">{binding.property.name}</span>
      <ChevronRightIcon className="size-3.5 shrink-0 text-token-description-foreground" />
    </div>
  );
});

function PropertySubmenuFrame({
  binding,
  itemDataAttribute,
  contentClassName,
  children,
}: {
  readonly binding: DataSourcePropertyEditorBinding;
  readonly itemDataAttribute?: string;
  readonly contentClassName?: string;
  readonly children: ReactNode;
}) {
  return (
    <ContextMenuPrimitive.Sub>
      <ContextMenuPrimitive.SubTrigger asChild disabled={binding.disabled || binding.pending}>
        <PropertyMenuTrigger binding={binding} itemDataAttribute={itemDataAttribute} />
      </ContextMenuPrimitive.SubTrigger>
      <ContextMenuPrimitive.Portal>
        <NodexContextMenuSubContent
          onFocusOutside={preserveInteractiveSubmenuRootFocus}
          className={cn(
            "pointer-events-auto m-0",
            contentClassName ?? "w-[265px]",
          )}
        >
          {children}
        </NodexContextMenuSubContent>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Sub>
  );
}

function ScalarPropertySubmenu({
  binding,
  itemDataAttribute,
}: {
  readonly binding: DataSourcePropertyEditorBinding;
  readonly itemDataAttribute?: string;
}) {
  const number = binding.property.valueType === "number";
  const committed = number
    ? typeof binding.value === "number" ? String(binding.value) : ""
    : typeof binding.value === "string" ? binding.value : "";
  const [draft, setDraft] = useState(committed);
  const [error, setError] = useState<string | null>(null);
  const saveRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft(committed);
    setError(null);
  }, [binding.revision, committed]);

  const commit = (): boolean => {
    if (!number) {
      binding.onChange(draft.trim() ? draft : null);
      return true;
    }
    if (!draft.trim()) {
      binding.onChange(null);
      return true;
    }
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setError("Enter a finite number");
      return false;
    }
    binding.onChange(parsed);
    return true;
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Escape") return;
    event.stopPropagation();
    if (event.key !== "Enter") return;
    event.preventDefault();
    saveRef.current?.click();
  };

  return (
    <PropertySubmenuFrame binding={binding} itemDataAttribute={itemDataAttribute}>
      <div className="p-2">
        <input
          autoFocus
          aria-label={`${binding.property.name} value`}
          inputMode={number ? "decimal" : "text"}
          value={draft}
          disabled={binding.disabled || binding.pending}
          placeholder="Empty"
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={handleKeyDown}
          className={INPUT_CLASS_NAME}
        />
        {error ? (
          <p role="alert" className="px-1 pt-1 text-xs text-token-error-foreground">
            {error}
          </p>
        ) : null}
        {binding.error ? <PropertyEditorFeedback message={binding.error} /> : null}
        <div className="mt-2 flex gap-1">
          <ContextMenuPrimitive.Item
            ref={saveRef}
            disabled={binding.disabled || binding.pending}
            className={cn(ITEM_CLASS_NAME, "flex-1 text-center")}
            onSelect={(event) => {
              if (!commit()) event.preventDefault();
            }}
          >
            Save
          </ContextMenuPrimitive.Item>
          {committed ? (
            <ContextMenuPrimitive.Item
              disabled={binding.disabled || binding.pending}
              className={cn(ITEM_CLASS_NAME, "flex-1 text-center text-token-description-foreground")}
              onSelect={() => binding.onChange(null)}
            >
              Clear
            </ContextMenuPrimitive.Item>
          ) : null}
        </div>
      </div>
    </PropertySubmenuFrame>
  );
}

function SharedPropertyEditorSubmenu({
  binding,
  itemDataAttribute,
  onContextMenuCommit,
}: {
  readonly binding: DataSourcePropertyEditorBinding;
  readonly itemDataAttribute?: string;
  readonly onContextMenuCommit: () => void;
}) {
  const embeddedOverlay = binding.property.valueType === "date"
    || binding.property.valueType === "datetime"
    || binding.property.valueType === "relation";
  const widthClassName = binding.property.valueType === "relation"
    ? "w-[min(360px,calc(100vw-16px))]"
    : embeddedOverlay
      ? "w-[280px]"
      : "w-[265px]";
  return (
    <PropertySubmenuFrame
      binding={binding}
      itemDataAttribute={itemDataAttribute}
      contentClassName={cn(widthClassName, embeddedOverlay && "p-0")}
    >
      {embeddedOverlay ? (
        <DataSourcePropertyValueEditor
          {...binding}
          showLabel={false}
          presentation="page"
          overlayHost="embedded"
          onOverlayRequestClose={onContextMenuCommit}
        />
      ) : (
        <>
          <NodexDropdown.SectionLabel>{binding.property.name}</NodexDropdown.SectionLabel>
          <div className="px-2 pb-2">
            <DataSourcePropertyValueEditor
              {...binding}
              showLabel={false}
              presentation="page"
            />
          </div>
        </>
      )}
      {binding.error ? (
        <div className="px-2 pb-2">
          <PropertyEditorFeedback message={binding.error} />
        </div>
      ) : null}
    </PropertySubmenuFrame>
  );
}

function PropertySubmenu({
  binding,
  itemDataAttribute,
  onContextMenuCommit,
}: {
  readonly binding: DataSourcePropertyEditorBinding;
  readonly itemDataAttribute?: string;
  readonly onContextMenuCommit: () => void;
}) {
  if (
    binding.property.valueType === "select"
    || binding.property.valueType === "multi_select"
  ) {
    return (
      <DataSourcePropertyValueEditor
        {...binding}
        showLabel={false}
        presentation="page"
        optionPickerHost="context-menu"
        optionPickerTrigger={(
          <PropertyMenuTrigger binding={binding} itemDataAttribute={itemDataAttribute} />
        )}
        onOptionPickerCommit={onContextMenuCommit}
      />
    );
  }
  if (binding.property.valueType === "text" || binding.property.valueType === "number") {
    return <ScalarPropertySubmenu binding={binding} itemDataAttribute={itemDataAttribute} />;
  }
  return (
    <SharedPropertyEditorSubmenu
      binding={binding}
      itemDataAttribute={itemDataAttribute}
      onContextMenuCommit={onContextMenuCommit}
    />
  );
}

export function DataSourcePagePropertyContextMenuItems({
  bindings,
  groupingPropertyId = null,
  query = "",
  itemDataAttribute,
  onContextMenuCommit,
}: {
  readonly bindings: readonly DataSourcePropertyEditorBinding[];
  readonly groupingPropertyId?: string | null;
  readonly query?: string;
  readonly itemDataAttribute?: string;
  readonly onContextMenuCommit: () => void;
}) {
  const model = buildPagePropertyContextMenuModel(bindings, {
    groupingPropertyId,
    query,
  });
  if (!model.hasMatches) return null;
  return (
    <>
      {model.visible.map((binding) => (
        <PropertySubmenu
          key={binding.property.propertyId}
          binding={binding}
          itemDataAttribute={itemDataAttribute}
          onContextMenuCommit={onContextMenuCommit}
        />
      ))}
      {!model.searching && model.overflow.length > 0 ? (
        <ContextMenuPrimitive.Sub>
          <ContextMenuPrimitive.SubTrigger
            data-page-property-menu-item="true"
            data-card-menu-item={itemDataAttribute}
            className={cn(ITEM_CLASS_NAME, "flex w-full items-center gap-2")}
          >
            <span className="flex size-5 shrink-0 items-center justify-center text-token-description-foreground">
              <SlidersHorizontal className="size-4" strokeWidth={1.8} />
            </span>
            <span className="min-w-0 flex-1 truncate">More properties…</span>
            <ChevronRightIcon className="size-3.5 shrink-0 text-token-description-foreground" />
          </ContextMenuPrimitive.SubTrigger>
          <ContextMenuPrimitive.Portal>
            <NodexContextMenuSubContent
              onFocusOutside={preserveInteractiveSubmenuRootFocus}
              className="m-0 w-[265px]"
            >
              <NodexDropdown.SectionLabel>Properties</NodexDropdown.SectionLabel>
              {model.overflow.map((binding) => (
                <PropertySubmenu
                  key={binding.property.propertyId}
                  binding={binding}
                  onContextMenuCommit={onContextMenuCommit}
                />
              ))}
            </NodexContextMenuSubContent>
          </ContextMenuPrimitive.Portal>
        </ContextMenuPrimitive.Sub>
      ) : null}
    </>
  );
}

export const pagePropertyContextMenuHasMatches = (
  bindings: readonly DataSourcePropertyEditorBinding[],
  query: string,
): boolean => buildPagePropertyContextMenuModel(bindings, { query }).hasMatches;

export type { DataSourcePropertyEditorBinding };
