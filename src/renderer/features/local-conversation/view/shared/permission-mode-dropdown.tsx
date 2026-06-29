import type { CodexPermissionMode } from "../../../../lib/types";
import {
  CheckmarkIcon,
  ChevronDownIcon,
  ConfigStatusIcon,
  PermissionDefaultIcon,
  PermissionFullAccessIcon,
} from "@/components/shared/icons";
import {
  NodexDropdownItem,
  NodexDropdownMenu,
} from "@/components/ui/dropdown";
import { cn } from "@/lib/utils";

const PERMISSION_MODE_ITEMS: Array<{ value: CodexPermissionMode; label: string }> = [
  { value: "auto", label: "Default permissions" },
  { value: "guardian-approvals", label: "Auto-review" },
  { value: "full-access", label: "Full access" },
  { value: "custom", label: "Custom (config.toml)" },
];

const DEFAULT_PERMISSIONS_TOOLTIP =
  "Codex automatically runs commands in a sandbox and asks before elevated requests.";
const AUTO_REVIEW_TOOLTIP =
  "Codex automatically runs commands in a sandbox and uses Auto-review for elevated requests";
const AUTO_REVIEW_DISABLED_TOOLTIP =
  "Auto-review requires default sandboxed permissions to be available in this workspace.";
const FULL_ACCESS_TOOLTIP =
  "Codex has full access over your computer and bypasses approval prompts (elevated risk).";
const CUSTOM_TOOLTIP_FALLBACK =
  "Codex uses the permission defined in config.toml.";
const FULL_ACCESS_CONFIRM_TITLE = "Enable full access?";

function formatPermissionModeLabel(mode: CodexPermissionMode): string {
  const match = PERMISSION_MODE_ITEMS.find((item) => item.value === mode);
  return match?.label ?? "Default permissions";
}

function resolvePermissionModeTooltip(input: {
  mode: CodexPermissionMode;
  customDescription: string | null;
  autoReviewDisabled: boolean;
}): string {
  if (input.mode === "auto") return DEFAULT_PERMISSIONS_TOOLTIP;
  if (input.mode === "guardian-approvals") {
    return input.autoReviewDisabled ? AUTO_REVIEW_DISABLED_TOOLTIP : AUTO_REVIEW_TOOLTIP;
  }
  if (input.mode === "full-access") return FULL_ACCESS_TOOLTIP;
  return input.customDescription?.trim() || CUSTOM_TOOLTIP_FALLBACK;
}

function PermissionModeMenuIcon({
  mode,
  className,
}: {
  mode: CodexPermissionMode;
  className?: string;
}) {
  if (mode === "auto" || mode === "guardian-approvals") return <PermissionDefaultIcon className={cn("icon-xs shrink-0", className)} />;
  if (mode === "full-access") return <PermissionFullAccessIcon className={cn("icon-xs shrink-0", className)} />;
  return <ConfigStatusIcon className={cn("icon-xs shrink-0", className)} />;
}

export function PermissionModeDropdown({
  selectedMode,
  customDescription,
  availableModes,
  guardianApprovalEnabled = false,
  accentCurrentMode = false,
  onSelect,
}: {
  selectedMode: CodexPermissionMode;
  customDescription: string | null;
  availableModes?: CodexPermissionMode[];
  guardianApprovalEnabled?: boolean;
  accentCurrentMode?: boolean;
  onSelect: (mode: CodexPermissionMode) => void;
}) {
  const allowedModes = new Set(availableModes ?? ["auto", "full-access", "custom"]);
  const accentFullAccess = accentCurrentMode && selectedMode === "full-access";

  return (
    <NodexDropdownMenu
      triggerButton={(
        <button
          type="button"
          aria-label="Permission mode"
          className="border-token-border no-drag cursor-interaction flex items-center gap-1 border whitespace-nowrap select-none focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-full text-token-text-tertiary enabled:hover:bg-token-list-hover-background data-[state=open]:bg-token-list-hover-background border-transparent h-token-button-composer-sm px-1.5 py-0 text-sm leading-[18px] min-w-0"
        >
          <PermissionModeMenuIcon
            mode={selectedMode}
            className={accentFullAccess ? "text-token-editor-warning-foreground" : undefined}
          />
          <span className={cn("_labelXs_z984f_2 max-w-40 truncate whitespace-nowrap text-left text-token-editor-warning-foreground", !accentFullAccess && "text-token-text-tertiary")}>
            {formatPermissionModeLabel(selectedMode)}
          </span>
          <ChevronDownIcon className={accentFullAccess ? "icon-2xs shrink-0 text-token-editor-warning-foreground" : "icon-2xs text-token-input-placeholder-foreground"} />
        </button>
      )}
      side="top"
      align="start"
    >
      {PERMISSION_MODE_ITEMS
        .filter((item) =>
          item.value === "custom"
          || item.value === "guardian-approvals"
          || allowedModes.has(item.value)
          || item.value === selectedMode,
        )
        .map((item) => {
          const autoReviewDisabled = item.value === "guardian-approvals"
            && (!guardianApprovalEnabled || !allowedModes.has("guardian-approvals"));
          const disabled = autoReviewDisabled;

          return (
            <NodexDropdownItem
              key={item.value}
              disabled={disabled}
              onSelect={() => {
                if (disabled) {
                  return;
                }
                if (item.value === "full-access" && typeof globalThis.confirm === "function") {
                  const accepted = globalThis.confirm(FULL_ACCESS_CONFIRM_TITLE);
                  if (!accepted) {
                    return;
                  }
                }
                onSelect(item.value);
              }}
              leftSlot={<PermissionModeMenuIcon mode={item.value} />}
              rightSlot={item.value === selectedMode ? <CheckmarkIcon className="shrink-0 text-token-foreground" /> : null}
              tooltipText={resolvePermissionModeTooltip({
                mode: item.value,
                customDescription,
                autoReviewDisabled,
              })}
            >
              {item.label}
            </NodexDropdownItem>
          );
        })}
    </NodexDropdownMenu>
  );
}
