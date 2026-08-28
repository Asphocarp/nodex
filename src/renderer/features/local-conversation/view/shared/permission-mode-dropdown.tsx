import { useRef } from "react";
import type { CodexPermissionMode } from "../../../../lib/types";
import {
  PermissionDefaultIcon,
  SettingsGeneralIcon,
  PermissionAskForApprovalIcon,
  PermissionFullAccessIcon,
} from "@/components/shared/icons";
import {
  NodexDropdownItem,
  NodexDropdownMenu,
  NodexDropdownSelectedIcon,
  NodexDropdownTitle,
  NodexSettingsDropdownTrigger,
} from "@/components/ui/dropdown";
import { cn } from "@/lib/utils";
import { appScope, useScopeHandle } from "@/lib/maitai";
import { openModal } from "@/lib/modal-registry";
import {
  COMPOSER_FOOTER_COMPACT_GHOST_BUTTON_CLASS_NAME,
  COMPOSER_FOOTER_GHOST_ICON_BUTTON_CLASS_NAME,
} from "./composer-footer-controls";
import {
  FullAccessPermissionConfirmationDialog,
  PERMISSIONS_LEARN_MORE_URL,
} from "./full-access-permission-confirmation-dialog";

type PermissionModeDropdownItem = {
  value: CodexPermissionMode;
  triggerLabel: string;
  optionLabel: string;
  description: string;
  disabledTooltip?: string;
};

export const FULL_ACCESS_PERMISSION_DESCRIPTION =
  "Unrestricted access to the internet and any file on your computer";

const PERMISSION_MODE_ITEMS: PermissionModeDropdownItem[] = [
  {
    value: "auto",
    triggerLabel: "Ask for approval",
    optionLabel: "Ask for approval",
    description: "Always ask to edit external files and use the internet",
  },
  {
    value: "guardian-approvals",
    triggerLabel: "Approve for me",
    optionLabel: "Approve for me",
    description: "Only ask for actions detected as potentially unsafe",
    disabledTooltip: "Requires default sandboxed permissions in this workspace",
  },
  {
    value: "full-access",
    triggerLabel: "Full access",
    optionLabel: "Full access",
    description: FULL_ACCESS_PERMISSION_DESCRIPTION,
    disabledTooltip: "Disabled by requirements.toml",
  },
  {
    value: "custom",
    triggerLabel: "Custom",
    optionLabel: "Custom (config.toml)",
    description: "Uses permissions defined in config.toml",
  },
];

const FULL_ACCESS_ACCENT_CLASS_NAME = "text-token-editor-warning-foreground";

function formatPermissionModeLabel(mode: CodexPermissionMode): string {
  const match = PERMISSION_MODE_ITEMS.find((item) => item.value === mode);
  return match?.triggerLabel ?? "Ask for approval";
}

function resolvePermissionModeAccentClass(mode: CodexPermissionMode): string | undefined {
  if (mode === "full-access") return FULL_ACCESS_ACCENT_CLASS_NAME;
  return undefined;
}

function PermissionModeMenuIcon({
  mode,
  className,
}: {
  mode: CodexPermissionMode;
  className?: string;
}) {
  if (mode === "auto") return <PermissionAskForApprovalIcon className={className} />;
  if (mode === "guardian-approvals") return <PermissionDefaultIcon className={className} />;
  if (mode === "full-access") return <PermissionFullAccessIcon className={className} />;
  return <SettingsGeneralIcon className={className} />;
}

function PermissionModeOption({
  item,
  description,
  selected,
  disabled,
  onSelect,
}: {
  item: PermissionModeDropdownItem;
  description: string;
  selected: boolean;
  disabled: boolean;
  onSelect: () => boolean;
}) {
  const accentClass = resolvePermissionModeAccentClass(item.value);

  return (
    <NodexDropdownItem
      disabled={disabled}
      focusableWhenDisabled
      onSelect={(event) => {
        if (disabled) {
          return;
        }

        const didSelect = onSelect();
        if (!didSelect) {
          event.preventDefault();
        }
      }}
      leftSlot={<PermissionModeMenuIcon mode={item.value} className={cn("size-5!", accentClass)} />}
      rightSlot={selected ? <NodexDropdownSelectedIcon className={accentClass} /> : null}
      subText={<span className={accentClass}>{description}</span>}
      tooltipText={disabled ? item.disabledTooltip : undefined}
      allowWrap
      subTextAllowWrap
      className="[&>div]:gap-3 [&>div>span:nth-child(2)>span]:gap-0"
    >
      <span className={accentClass}>{item.optionLabel}</span>
    </NodexDropdownItem>
  );
}

export function PermissionModeDropdown({
  selectedMode,
  availableModes,
  autoReviewAvailable = false,
  triggerVariant = "label",
  triggerStyle = "composer",
  onSelect,
}: {
  selectedMode: CodexPermissionMode;
  availableModes?: CodexPermissionMode[];
  autoReviewAvailable?: boolean;
  triggerVariant?: "label" | "icon";
  triggerStyle?: "composer" | "settings";
  onSelect: (mode: CodexPermissionMode) => void;
}) {
  const appHandle = useScopeHandle(appScope);
  const pendingFullAccessConfirmationRef = useRef(false);
  const allowedModes = new Set(availableModes ?? ["auto", "full-access", "custom"]);
  const currentModeAccentClass = resolvePermissionModeAccentClass(selectedMode);
  const triggerLabel = formatPermissionModeLabel(selectedMode);

  return (
    <NodexDropdownMenu
      triggerButton={
        triggerStyle === "settings" ? (
          <NodexSettingsDropdownTrigger
            aria-label="Permission mode"
            className={triggerVariant === "icon" ? "size-8 justify-center px-0" : "min-w-56"}
            showChevron={triggerVariant === "label"}
          >
            <PermissionModeMenuIcon
              mode={selectedMode}
              className={cn("icon-xs", currentModeAccentClass)}
            />
            {triggerVariant === "label" ? (
              <span
                className={cn(
                  "max-w-40 truncate whitespace-nowrap text-left",
                  currentModeAccentClass,
                )}
              >
                {triggerLabel}
              </span>
            ) : null}
          </NodexSettingsDropdownTrigger>
        ) : (
          <button
            type="button"
            aria-label="Change permissions"
            className={
              triggerVariant === "icon"
                ? COMPOSER_FOOTER_GHOST_ICON_BUTTON_CLASS_NAME
                : COMPOSER_FOOTER_COMPACT_GHOST_BUTTON_CLASS_NAME
            }
          >
            <PermissionModeMenuIcon
              mode={selectedMode}
              className={cn("icon-xs shrink-0", currentModeAccentClass)}
            />
            {triggerVariant === "label" ? (
              <span
                className={cn(
                  "max-w-40 truncate whitespace-nowrap text-left",
                  currentModeAccentClass,
                )}
              >
                {triggerLabel}
              </span>
            ) : null}
          </button>
        )
      }
      triggerTooltipContent={triggerStyle === "composer" ? "Change permissions" : undefined}
      side={triggerStyle === "settings" ? "bottom" : "top"}
      align={triggerStyle === "settings" ? "end" : "start"}
      contentClassName="w-max"
      finalFocus={() => {
        if (!pendingFullAccessConfirmationRef.current) return true;
        pendingFullAccessConfirmationRef.current = false;
        openModal(appHandle, FullAccessPermissionConfirmationDialog, {
          onConfirm: () => onSelect("full-access"),
        });
        return false;
      }}
    >
      <NodexDropdownTitle>
        <div className="flex w-full min-w-0 items-start gap-4">
          <span className="min-w-0 flex-1 whitespace-normal">
            How should Nodex actions be approved?
          </span>
          <button
            type="button"
            className="cursor-interaction underline underline-offset-2 hover:text-token-description-foreground"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              window.open(PERMISSIONS_LEARN_MORE_URL, "_blank", "noopener,noreferrer");
            }}
          >
            Learn more
          </button>
        </div>
      </NodexDropdownTitle>
      {PERMISSION_MODE_ITEMS.filter(
        (item) =>
          item.value !== "custom" || allowedModes.has("custom") || selectedMode === "custom",
      ).map((item) => {
        const autoReviewDisabled =
          item.value === "guardian-approvals" &&
          (!autoReviewAvailable || !allowedModes.has("guardian-approvals"));
        const customDisabled =
          item.value === "custom" && selectedMode !== "custom" && !allowedModes.has("custom");
        const presetDisabled =
          (item.value === "auto" || item.value === "full-access") && !allowedModes.has(item.value);
        const disabled = autoReviewDisabled || customDisabled || presetDisabled;

        return (
          <PermissionModeOption
            key={item.value}
            item={item}
            description={item.description}
            disabled={disabled}
            selected={item.value === selectedMode}
            onSelect={() => {
              if (disabled) {
                return false;
              }
              if (item.value === "full-access") {
                pendingFullAccessConfirmationRef.current = true;
                return true;
              }
              onSelect(item.value);
              return true;
            }}
          />
        );
      })}
    </NodexDropdownMenu>
  );
}
