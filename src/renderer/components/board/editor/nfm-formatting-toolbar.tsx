import {
  ComponentsContext,
  FormattingToolbar,
  getFormattingToolbarItems,
  useComponentsContext,
} from "@blocknote/react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { useId, useMemo, useRef, type ChangeEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { ActivitySpinnerIcon, CheckmarkIcon, ChevronDownIcon } from "@/components/shared/icons";
import { NodexButton } from "@/components/ui/button";
import { ShortcutKeycaps } from "@/components/ui/shortcut-keycaps";
import {
  NodexDropdownContent,
  NodexDropdownItem,
  NodexDropdownSectionLabel,
  NodexDropdownSeparator,
} from "@/components/ui/dropdown";
import {
  NodexPopover,
  NodexPopoverContent,
  NodexPopoverTrigger,
} from "@/components/ui/popover";
import { NodexTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { CopyImageButton } from "./copy-image-button";
import { NfmCreateLinkButton } from "./nfm-link-toolbar";
import { NfmTextActionMenu } from "./nfm-text-action-menu";
import type { NfmFormattingToolbarMode } from "./nfm-formatting-toolbar-controller";

const NFM_LEGACY_FORMATTING_TOOLBAR_OMITTED_KEYS = new Set([
  "textAlignLeftButton",
  "textAlignCenterButton",
  "textAlignRightButton",
]);

export function shouldRenderNfmLegacyFormattingToolbarItem(key: string): boolean {
  return !NFM_LEGACY_FORMATTING_TOOLBAR_OMITTED_KEYS.has(key);
}

function keepEditorSelection(event: MouseEvent | React.MouseEvent) {
  if ("button" in event && event.button !== 0) return;
  if ("preventDefault" in event) event.preventDefault();
}

function ToolbarRoot({
  className,
  children,
  onMouseEnter,
  onMouseLeave,
}: {
  className?: string;
  children?: ReactNode;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  return (
    <div
      role="toolbar"
      contentEditable={false}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-[12px] bg-token-dropdown-background/95 p-0.5 text-token-foreground shadow-lg ring-[0.5px] ring-token-border backdrop-blur-sm",
        "pointer-events-auto",
        className,
      )}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </div>
  );
}

function ToolbarButton({
  className,
  mainTooltip,
  secondaryTooltip,
  icon,
  onClick,
  isSelected = false,
  isDisabled = false,
  children,
  label,
}: {
  className?: string;
  mainTooltip?: string;
  secondaryTooltip?: string;
  icon?: ReactNode;
  onClick?: (event: MouseEvent) => void;
  isSelected?: boolean;
  isDisabled?: boolean;
  children?: ReactNode;
  label?: string;
}) {
  const button = (
    <button
      type="button"
      contentEditable={false}
      aria-label={label}
      disabled={isDisabled}
      className={cn(
        "inline-flex h-7 min-w-7 shrink-0 items-center justify-center gap-1 rounded-[9px] px-2 text-[12px] leading-4 text-token-text-secondary outline-hidden transition-colors",
        "focus-visible:ring-1 focus-visible:ring-token-focus-border",
        !isDisabled && "hover:bg-token-foreground/6 hover:text-token-foreground",
        isSelected && "bg-token-foreground/10 text-token-foreground",
        isDisabled && "cursor-default opacity-40",
        className,
      )}
      onMouseDown={keepEditorSelection}
      onClick={(event) => {
        if (isDisabled) return;
        onClick?.(event);
      }}
    >
      {icon ? <span className="shrink-0 [&_svg]:size-4">{icon}</span> : null}
      {children}
    </button>
  );

  if (!mainTooltip) return button;

  return (
    <NodexTooltip
      tooltipContent={mainTooltip}
      shortcut={secondaryTooltip ? <ShortcutKeycaps keys={[secondaryTooltip]} /> : undefined}
      side="top"
      sideOffset={6}
      delayDuration={0}
    >
      {button}
    </NodexTooltip>
  );
}

function ToolbarSelect({
  className,
  items,
  isDisabled = false,
}: {
  className?: string;
  items: {
    text: string;
    icon: ReactNode;
    onClick: () => void;
    isSelected: boolean;
    isDisabled?: boolean;
  }[];
  isDisabled?: boolean;
}) {
  const selectedItem = items.find((item) => item.isSelected);
  if (!selectedItem) return null;

  return (
    <DropdownMenuPrimitive.Root modal={false}>
      <DropdownMenuPrimitive.Trigger asChild disabled={isDisabled}>
        <button
          type="button"
          contentEditable={false}
          aria-label={selectedItem.text}
          className={cn(
            "inline-flex h-7 min-w-[7.5rem] items-center gap-1 rounded-[9px] px-2 text-[12px] leading-4 outline-hidden transition-colors",
            "text-token-foreground hover:bg-token-foreground/6 focus-visible:ring-1 focus-visible:ring-token-focus-border",
            isDisabled && "cursor-default opacity-40",
            className,
          )}
          onMouseDown={keepEditorSelection}
        >
          <span className="shrink-0 text-token-text-secondary [&_svg]:size-4">{selectedItem.icon}</span>
          <span className="min-w-0 flex-1 truncate text-left">{selectedItem.text}</span>
          <ChevronDownIcon className="size-3 shrink-0 text-token-text-secondary" />
        </button>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <NodexDropdownContent
          side="top"
          align="start"
          sideOffset={6}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
          }}
          className="min-w-[13rem]"
        >
          <div dir="ltr">
            {items.map((item) => (
              <NodexDropdownItem
                key={item.text}
                disabled={item.isDisabled}
                leftSlot={<span className="text-token-description-foreground [&_svg]:size-4">{item.icon}</span>}
                rightSlot={item.isSelected ? <CheckmarkIcon className="size-4 text-token-foreground" /> : null}
                onPointerDownCapture={keepEditorSelection}
                onSelect={() => {
                  item.onClick();
                }}
              >
                {item.text}
              </NodexDropdownItem>
            ))}
          </div>
        </NodexDropdownContent>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}

function MenuRoot({
  children,
  open,
  onOpenChange,
}: {
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <DropdownMenuPrimitive.Root
      modal={false}
      open={open}
      onOpenChange={onOpenChange}
    >
      {children}
    </DropdownMenuPrimitive.Root>
  );
}

function MenuTrigger({ children }: { children?: ReactNode }) {
  return <DropdownMenuPrimitive.Trigger asChild>{children}</DropdownMenuPrimitive.Trigger>;
}

function MenuDropdown({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <DropdownMenuPrimitive.Portal>
      <NodexDropdownContent
        side="top"
        align="start"
        sideOffset={6}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
        }}
        className={cn("min-w-[13rem]", className)}
      >
        <div dir="ltr">{children}</div>
      </NodexDropdownContent>
    </DropdownMenuPrimitive.Portal>
  );
}

function MenuItem({
  className,
  children,
  icon,
  checked,
  onClick,
  ...props
}: {
  className?: string;
  children?: ReactNode;
  icon?: ReactNode;
  checked?: boolean;
  onClick?: (event: Event) => void;
}) {
  return (
    <NodexDropdownItem
      className={className}
      leftSlot={icon ? <span className="text-token-description-foreground [&_svg]:size-4">{icon}</span> : null}
      rightSlot={checked ? <CheckmarkIcon className="size-4 text-token-foreground" /> : null}
      onPointerDownCapture={keepEditorSelection}
      onSelect={(event) => {
        onClick?.(event);
      }}
      {...props}
    >
      {children}
    </NodexDropdownItem>
  );
}

function MenuLabel({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return <NodexDropdownSectionLabel className={className}>{children}</NodexDropdownSectionLabel>;
}

function PopoverRoot({
  children,
  open,
  onOpenChange,
}: {
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <NodexPopover
      open={open}
      onOpenChange={onOpenChange}
    >
      {children}
    </NodexPopover>
  );
}

function PopoverTrigger({ children }: { children?: ReactNode }) {
  return <NodexPopoverTrigger asChild>{children}</NodexPopoverTrigger>;
}

function PopoverContent({
  children,
  className,
  variant,
}: {
  children?: ReactNode;
  className?: string;
  variant?: "form-popover" | "panel-popover";
}) {
  return (
    <NodexPopoverContent
      side="top"
      align="start"
      sideOffset={6}
      collisionPadding={8}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
      }}
      className={cn(
        "overflow-hidden gap-0 p-0",
        variant === "panel-popover" ? "w-[18rem]" : "w-[16.5rem]",
        className,
      )}
    >
      {children}
    </NodexPopoverContent>
  );
}

function FormRoot({ children }: { children?: ReactNode }) {
  return <div className="flex flex-col gap-2">{children}</div>;
}

function FormTextInput({
  className,
  name,
  label,
  icon,
  value,
  autoFocus,
  placeholder,
  disabled,
  onKeyDown,
  onChange,
  autoComplete,
  "aria-activedescendant": ariaActivedescendant,
}: {
  className?: string;
  name: string;
  label?: string;
  icon: ReactNode;
  value: string;
  autoFocus?: boolean;
  placeholder?: string;
  disabled?: boolean;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  autoComplete?: string;
  "aria-activedescendant"?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      {label ? (
        <span className="text-[11px] leading-4 font-medium text-token-text-secondary">{label}</span>
      ) : null}
      <div className="flex items-center gap-2 rounded-md border-[0.5px] border-token-border bg-token-input-background px-2 py-1.5 shadow-[inset_0_0_0_0.5px_color-mix(in_srgb,var(--color-token-foreground)_2%,transparent)] focus-within:border-token-focus-border focus-within:ring-1 focus-within:ring-token-focus-border">
        <span className="shrink-0 text-token-description-foreground [&_svg]:size-4">{icon}</span>
        <input
          autoFocus={autoFocus}
          name={name}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete={autoComplete}
          aria-activedescendant={ariaActivedescendant}
          onChange={onChange}
          onKeyDown={onKeyDown}
          className={cn(
            "w-full appearance-none border-none bg-transparent text-[13px] leading-5 text-token-foreground outline-none placeholder:text-token-input-placeholder-foreground",
            className,
          )}
        />
      </div>
    </label>
  );
}

function FilePanelRoot({
  tabs,
  openTab,
  setOpenTab,
  loading,
}: {
  tabs: {
    name: string;
    tabPanel: ReactNode;
  }[];
  openTab: string;
  setOpenTab: (name: string) => void;
  loading: boolean;
}) {
  const activeTab = tabs.find((tab) => tab.name === openTab) ?? tabs[0];

  return (
    <div className="flex w-[18rem] flex-col gap-2 bg-token-dropdown-background/95 p-2 text-token-foreground backdrop-blur-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-0.5 rounded-[10px] bg-token-foreground/5 p-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.name}
              type="button"
              className={cn(
                "inline-flex h-6 items-center rounded-[8px] px-2 text-[12px] leading-4 outline-hidden transition-colors",
                tab.name === openTab
                  ? "bg-token-foreground/10 text-token-foreground"
                  : "text-token-text-secondary hover:bg-token-foreground/6 hover:text-token-foreground",
              )}
              onMouseDown={keepEditorSelection}
              onClick={() => {
                setOpenTab(tab.name);
              }}
            >
              {tab.name}
            </button>
          ))}
        </div>
        {loading ? <ActivitySpinnerIcon className="size-3.5 text-token-description-foreground" /> : null}
      </div>
      <div>{activeTab?.tabPanel}</div>
    </div>
  );
}

function FilePanelButton({
  className,
  onClick,
  children,
  label,
}: {
  className?: string;
  onClick: () => void;
  children?: ReactNode;
  label?: string;
}) {
  return (
    <NodexButton
      variant="secondary"
      size="xs"
      className={cn("w-full justify-center rounded-md", className)}
      onMouseDown={keepEditorSelection}
      onClick={onClick}
      aria-label={label}
    >
      {children ?? label}
    </NodexButton>
  );
}

function FilePanelTabPanel({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return <div className={cn("flex flex-col gap-2 p-1", className)}>{children}</div>;
}

function FilePanelTextInput({
  className,
  value,
  placeholder,
  onChange,
  onKeyDown,
}: {
  className?: string;
  value: string;
  placeholder: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={onChange}
      onKeyDown={onKeyDown}
      className={cn(
        "w-full rounded-md border-[0.5px] border-token-border bg-token-input-background px-2 py-1.5 text-[13px] leading-5 text-token-foreground outline-none placeholder:text-token-input-placeholder-foreground focus:border-token-focus-border focus:ring-1 focus:ring-token-focus-border",
        className,
      )}
    />
  );
}

function FilePanelFileInput({
  accept,
  placeholder,
  onChange,
}: {
  accept: string;
  placeholder: string;
  onChange: (payload: File | null) => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => {
          onChange(event.currentTarget.files?.[0] ?? null);
          event.currentTarget.value = "";
        }}
      />
      <NodexButton
        variant="secondary"
        size="xs"
        className="w-full justify-center rounded-md"
        onMouseDown={keepEditorSelection}
        onClick={() => {
          inputRef.current?.click();
        }}
      >
        {placeholder}
      </NodexButton>
    </div>
  );
}

export function NfmLegacyFormattingToolbar() {
  const baseComponents = useComponentsContext()!;

  const toolbarItems = useMemo(() => {
    const items = getFormattingToolbarItems().map((item) =>
      item.key === "createLinkButton" ? <NfmCreateLinkButton key="createLinkButton" /> : item)
      .filter((item) => shouldRenderNfmLegacyFormattingToolbarItem(item.key ?? ""));
    const copyImageButton = <CopyImageButton key="copyImageButton" />;
    const fileDownloadButtonIndex = items.findIndex((item) => item.key === "fileDownloadButton");

    if (fileDownloadButtonIndex < 0) {
      return [...items, copyImageButton];
    }

    const itemsWithCopy = [...items];
    itemsWithCopy.splice(fileDownloadButtonIndex + 1, 0, copyImageButton);
    return itemsWithCopy;
  }, []);

  const components = useMemo(
    () => ({
      ...baseComponents,
      FormattingToolbar: {
        ...baseComponents.FormattingToolbar,
        Root: ToolbarRoot,
        Button: ToolbarButton,
        Select: ToolbarSelect,
      },
      Generic: {
        ...baseComponents.Generic,
        Menu: {
          ...baseComponents.Generic.Menu,
          Root: MenuRoot,
          Trigger: MenuTrigger,
          Dropdown: MenuDropdown,
          Divider: NodexDropdownSeparator,
          Label: MenuLabel,
          Item: MenuItem,
        },
        Popover: {
          ...baseComponents.Generic.Popover,
          Root: PopoverRoot,
          Trigger: PopoverTrigger,
          Content: PopoverContent,
        },
        Form: {
          ...baseComponents.Generic.Form,
          Root: FormRoot,
          TextInput: FormTextInput,
        },
      },
      FilePanel: {
        ...baseComponents.FilePanel,
        Root: FilePanelRoot,
        Button: FilePanelButton,
        FileInput: FilePanelFileInput,
        TabPanel: FilePanelTabPanel,
        TextInput: FilePanelTextInput,
      },
    }),
    [baseComponents],
  );

  return (
    <ComponentsContext.Provider value={components}>
      <FormattingToolbar>{toolbarItems}</FormattingToolbar>
    </ComponentsContext.Provider>
  );
}

export function NfmFormattingToolbar({
  mode,
}: {
  mode: NfmFormattingToolbarMode;
}) {
  if (mode === "legacy") return <NfmLegacyFormattingToolbar />;
  return <NfmTextActionMenu />;
}
