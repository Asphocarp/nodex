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

const PERMISSION_MODE_ITEMS: Array<{ value: CodexPermissionMode; label: string }> = [
  { value: "auto", label: "Default permissions" },
  { value: "guardian-approvals", label: "Guardian approvals" },
  { value: "full-access", label: "Full access" },
  { value: "custom", label: "Custom (config.toml)" },
];

const DEFAULT_PERMISSIONS_TOOLTIP =
  "Codex automatically runs commands in a sandbox and asks before elevated requests.";
const GUARDIAN_APPROVALS_TOOLTIP =
  "Codex automatically runs commands in a sandbox and uses Guardian approvals for elevated requests";
const GUARDIAN_APPROVALS_DISABLED_TOOLTIP =
  "Guardian approvals requires default sandboxed permissions to be available in this workspace.";
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
  guardianDisabled: boolean;
}): string {
  if (input.mode === "auto") return DEFAULT_PERMISSIONS_TOOLTIP;
  if (input.mode === "guardian-approvals") {
    return input.guardianDisabled ? GUARDIAN_APPROVALS_DISABLED_TOOLTIP : GUARDIAN_APPROVALS_TOOLTIP;
  }
  if (input.mode === "full-access") return FULL_ACCESS_TOOLTIP;
  return input.customDescription?.trim() || CUSTOM_TOOLTIP_FALLBACK;
}

function PermissionModeMenuIcon({ mode }: { mode: CodexPermissionMode }) {
  if (mode === "auto" || mode === "guardian-approvals") return <PermissionDefaultIcon className="shrink-0" />;
  if (mode === "full-access") return <PermissionFullAccessIcon className="shrink-0" />;
  return <ConfigStatusIcon className="shrink-0" />;
}

export function PermissionModeDropdown({
  selectedMode,
  customDescription,
  availableModes,
  guardianApprovalEnabled = false,
  onSelect,
}: {
  selectedMode: CodexPermissionMode;
  customDescription: string | null;
  availableModes?: CodexPermissionMode[];
  guardianApprovalEnabled?: boolean;
  onSelect: (mode: CodexPermissionMode) => void;
}) {
  const allowedModes = new Set(availableModes ?? ["auto", "full-access", "custom"]);

  return (
    <NodexDropdownMenu
      triggerButton={(
        <button
          type="button"
          aria-label="Permission mode"
          className="inline-flex h-7 min-w-0 items-center gap-1 rounded-full border border-transparent px-1.5 text-sm/4.5 text-token-description-foreground hover:bg-token-foreground/5 hover:text-token-foreground"
        >
          <PermissionModeMenuIcon mode={selectedMode} />
          <span className="max-w-40 truncate text-left text-sm">
            {formatPermissionModeLabel(selectedMode)}
          </span>
          <ChevronDownIcon />
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
          const guardianDisabled = item.value === "guardian-approvals"
            && (!guardianApprovalEnabled || !allowedModes.has("guardian-approvals"));
          const disabled = guardianDisabled;

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
                guardianDisabled,
              })}
            >
              {item.label}
            </NodexDropdownItem>
          );
        })}
    </NodexDropdownMenu>
  );
}
