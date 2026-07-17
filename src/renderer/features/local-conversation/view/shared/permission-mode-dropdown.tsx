import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import type { CodexPermissionMode } from "../../../../lib/types";
import {
  ChevronDownIcon,
  CodexSettingsAgentIcon,
  CodexSettingsGeneralIcon,
  PermissionAskForApprovalIcon,
  PermissionFullAccessIcon,
} from "@/components/shared/icons";
import { NodexDropdownMenu } from "@/components/ui/dropdown";
import { cn } from "@/lib/utils";
import { COMPOSER_FOOTER_COMPACT_GHOST_BUTTON_CLASS_NAME } from "./composer-footer-controls";

type PermissionModeDropdownItem = {
  value: CodexPermissionMode;
  triggerLabel: string;
  optionLabel: string;
  description: string;
  disabledDescription?: string;
};

export const FULL_ACCESS_PERMISSION_DESCRIPTION =
  "Allow unrestricted file and network access, and read or modify the entire Nodex Library without approval prompts.";

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
    disabledDescription: "Requires default sandboxed permissions in this workspace",
  },
  {
    value: "full-access",
    triggerLabel: "Full access",
    optionLabel: "Full access",
    description: FULL_ACCESS_PERMISSION_DESCRIPTION,
    disabledDescription: "Disabled by requirements.toml",
  },
  {
    value: "custom",
    triggerLabel: "Custom",
    optionLabel: "Custom (config.toml)",
    description: "Uses permissions defined in config.toml",
  },
];

const PERMISSIONS_LEARN_MORE_URL =
  "https://developers.openai.com/codex/concepts/sandboxing#how-you-control-it";

const PERMISSION_MENU_TITLE_CLASS_NAME =
  "text-token-description-foreground flex min-h-6 items-center truncate px-[var(--padding-row-x)] py-[var(--padding-row-y)] text-sm leading-4";
const PERMISSION_MENU_ITEM_CLASS_NAME =
  "no-drag text-token-foreground outline-hidden rounded-lg px-[var(--padding-row-x)] py-[var(--padding-row-y)] text-sm group hover:bg-token-list-hover-background focus:bg-token-list-hover-background cursor-interaction flex flex-col";
const PERMISSION_MENU_DISABLED_ITEM_CLASS_NAME =
  "cursor-default opacity-50 hover:bg-transparent focus:bg-transparent";
const PERMISSION_MENU_ICON_CLASS_NAME =
  "icon-sm shrink-0 opacity-75 group-focus:opacity-100 group-hover:opacity-100";
const PERMISSION_MENU_CHECK_CLASS_NAME =
  "icon-xs shrink-0 opacity-75 group-focus:opacity-100 group-hover:opacity-100";
const FULL_ACCESS_ACCENT_CLASS_NAME = "text-token-editor-warning-foreground";
const APPROVE_FOR_ME_ACCENT_CLASS_NAME = "text-token-text-link-foreground";

function formatPermissionModeLabel(mode: CodexPermissionMode): string {
  const match = PERMISSION_MODE_ITEMS.find((item) => item.value === mode);
  return match?.triggerLabel ?? "Ask for approval";
}

function resolvePermissionModeAccentClass(mode: CodexPermissionMode): string | undefined {
  if (mode === "full-access") return FULL_ACCESS_ACCENT_CLASS_NAME;
  if (mode === "guardian-approvals") return APPROVE_FOR_ME_ACCENT_CLASS_NAME;
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
  if (mode === "guardian-approvals") return <CodexSettingsAgentIcon className={className} />;
  if (mode === "full-access") return <PermissionFullAccessIcon className={className} />;
  return <CodexSettingsGeneralIcon className={className} />;
}

function PermissionModeCheckIcon({ className }: { className?: string }) {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M12.8961 3.64101C13.1297 3.41418 13.4984 3.37523 13.7779 3.56581C14.0571 3.75635 14.1554 4.11331 14.0299 4.41347L13.9615 4.53847L7.71151 13.7045C7.59411 13.8767 7.4063 13.9877 7.19881 14.0072C6.99136 14.0267 6.78564 13.9533 6.63826 13.806L2.88826 10.056L2.79842 9.9457C2.6192 9.67407 2.64927 9.30496 2.88826 9.06581C3.12738 8.82669 3.49647 8.79676 3.76815 8.97597L3.8785 9.06581L7.03084 12.2182L12.8053 3.74941L12.8961 3.64101Z"
        fill="currentColor"
      />
    </svg>
  );
}

function PermissionModeOption({
  item,
  selected,
  disabled,
  onSelect,
}: {
  item: PermissionModeDropdownItem;
  selected: boolean;
  disabled: boolean;
  onSelect: () => boolean;
}) {
  return (
    <DropdownMenuPrimitive.Item
      disabled={disabled}
      onSelect={(event) => {
        if (disabled) {
          return;
        }

        const didSelect = onSelect();
        if (!didSelect) {
          event.preventDefault();
        }
      }}
      className={cn(
        PERMISSION_MENU_ITEM_CLASS_NAME,
        disabled && PERMISSION_MENU_DISABLED_ITEM_CLASS_NAME,
      )}
    >
      <div className="flex w-full items-center gap-3">
        <PermissionModeMenuIcon
          mode={item.value}
          className={PERMISSION_MENU_ICON_CLASS_NAME}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="min-w-0 whitespace-normal">{item.optionLabel}</span>
          <span className="min-w-0 truncate">
            <span className="text-token-description-foreground">
              {disabled && item.disabledDescription ? item.disabledDescription : item.description}
            </span>
          </span>
        </span>
        {selected ? <PermissionModeCheckIcon className={PERMISSION_MENU_CHECK_CLASS_NAME} /> : null}
      </div>
    </DropdownMenuPrimitive.Item>
  );
}

export function PermissionModeDropdown({
  selectedMode,
  availableModes,
  autoReviewAvailable = false,
  onSelect,
}: {
  selectedMode: CodexPermissionMode;
  customDescription: string | null;
  availableModes?: CodexPermissionMode[];
  autoReviewAvailable?: boolean;
  onSelect: (mode: CodexPermissionMode) => void;
}) {
  const allowedModes = new Set(availableModes ?? ["auto", "full-access", "custom"]);
  const currentModeAccentClass = resolvePermissionModeAccentClass(selectedMode);

  return (
    <NodexDropdownMenu
      triggerButton={(
        <button
          type="button"
          aria-label="Permission mode"
          className={COMPOSER_FOOTER_COMPACT_GHOST_BUTTON_CLASS_NAME}
        >
          <PermissionModeMenuIcon
            mode={selectedMode}
            className={cn("icon-xs shrink-0", currentModeAccentClass)}
          />
          <span className={cn("max-w-40 truncate whitespace-nowrap text-left", currentModeAccentClass)}>
            {formatPermissionModeLabel(selectedMode)}
          </span>
          <ChevronDownIcon className={cn("icon-2xs shrink-0", currentModeAccentClass ?? "text-token-input-placeholder-foreground")} />
        </button>
      )}
      side="top"
      align="start"
    >
      <div className={PERMISSION_MENU_TITLE_CLASS_NAME}>
        <div className="flex items-center justify-between gap-8">
          <span>How should Codex actions be approved?</span>
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
      </div>
      {PERMISSION_MODE_ITEMS
        .filter((item) =>
          item.value === "custom"
          || item.value === "guardian-approvals"
          || allowedModes.has(item.value)
          || item.value === selectedMode,
        )
        .map((item) => {
          const autoReviewDisabled = item.value === "guardian-approvals"
            && (!autoReviewAvailable || !allowedModes.has("guardian-approvals"));
          const customDisabled = item.value === "custom"
            && selectedMode !== "custom"
            && !allowedModes.has("custom");
          const presetDisabled = (item.value === "auto" || item.value === "full-access")
            && !allowedModes.has(item.value);
          const disabled = autoReviewDisabled || customDisabled || presetDisabled;

          return (
            <PermissionModeOption
              key={item.value}
              item={item}
              disabled={disabled}
              selected={item.value === selectedMode}
              onSelect={() => {
                if (disabled) {
                  return false;
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
