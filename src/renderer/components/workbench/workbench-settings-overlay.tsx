import { useForm, useStore } from "@tanstack/react-form";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import {
  Monitor,
  Moon,
  RotateCcw,
  Sun,
  Trash2,
} from "lucide-react";
import { CheckmarkIcon } from "@/components/shared/icons";
import { NodexButton } from "@/components/ui/button";
import {
  NodexDropdownButtonTrigger,
  NodexDropdownItem,
  NodexDropdownMenu,
} from "@/components/ui/dropdown";
import { Input } from "../ui/input";
import { invoke } from "./workbench-settings-overlay-deps";
import {
  handleFormSubmit,
  resolveFormErrorMessage,
  resolveZodErrorMessage,
} from "../../lib/forms";
import type { CardPropertyPosition } from "../../lib/card-property-position";
import { FILE_LINK_OPENER_ICON_URLS } from "../../lib/file-link-opener-icons";
import {
  CARD_STAGE_COLLAPSIBLE_PROPERTIES,
  CARD_STAGE_COLLAPSIBLE_PROPERTY_LABELS,
  type CardStageCollapsibleProperty,
} from "../../lib/card-stage-collapsed-properties";
import { useCardPropertyPosition } from "../../lib/use-card-property-position";
import { useFileLinkOpener } from "../../lib/use-file-link-opener";
import { useCardStageCollapsedProperties } from "../../lib/use-card-stage-collapsed-properties";
import { DEFAULT_WORKTREE_AUTO_BRANCH_PREFIX } from "../../lib/worktree-branch-prefix";
import {
  DEFAULT_CODE_FONT_SIZE,
  MAX_CODE_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
} from "../../lib/code-font-size";
import {
  DEFAULT_SANS_FONT_SIZE,
  MAX_SANS_FONT_SIZE,
  MIN_SANS_FONT_SIZE,
} from "../../lib/sans-font-size";
import { useCodeFontSize } from "../../lib/use-code-font-size";
import { useNfmAutolinkSettings } from "../../lib/use-nfm-autolink-settings";
import { AppUpdateSettingsControl } from "./app-update-settings-control";
import { KeyboardShortcutsSettingsPage } from "./keyboard-shortcuts-settings-page";
import { LocalEnvironmentsSettingsPage } from "./local-environments-settings-page";
import {
  DEFAULT_DESCRIPTION_SOFT_LIMIT,
  DEFAULT_TEXT_PROMPT_CHAR_THRESHOLD,
  MAX_DESCRIPTION_SOFT_LIMIT,
  MAX_TEXT_PROMPT_CHAR_THRESHOLD,
  MIN_DESCRIPTION_SOFT_LIMIT,
  MIN_TEXT_PROMPT_CHAR_THRESHOLD,
} from "../../lib/paste-resource-settings";
import { usePasteResourceSettings } from "../../lib/use-paste-resource-settings";
import { useSansFontSize } from "../../lib/use-sans-font-size";
import type { ComposerEnterBehavior } from "../../lib/composer-enter-behavior";
import { useSpellcheck } from "../../lib/use-spellcheck";
import { useTheme } from "../../lib/use-theme";
import { useCodexServiceTierSettings } from "../../lib/use-codex-service-tier-settings";
import { useCodexThreadSettings } from "../../lib/use-codex-thread-settings";
import { useThreadNotificationSettings } from "../../lib/use-thread-notification-settings";
import { useWindowRestoreSettings } from "../../lib/use-window-restore-settings";
import { isDiagnosticsSettings } from "../../../shared/diagnostics/diagnostics-settings";
import { isTelemetrySettings } from "../../../shared/diagnostics/telemetry-settings";
import { formatCodexThreadDetailLevelLabel } from "../../lib/codex-thread-settings";
import type {
  BackupRecord,
  BackupSettings,
  DiagnosticsSettings,
  HistorySettings,
  ManagedWorktreeRecord,
  Project,
  UpdateDiagnosticsSettingsInput,
  TelemetrySettings,
  UpdateTelemetrySettingsInput,
  WorktreeStartMode,
  CodexPermissionState,
  CodexThreadDetailLevel,
  ThreadNotificationTurnMode,
  WindowRestorePolicy,
} from "../../lib/types";
import { cn } from "../../lib/utils";
import {
  FILE_LINK_OPENER_OPTIONS,
  normalizeFileLinkOpenerId,
} from "../../../shared/file-link-openers";
import {
  SIDEBAR_TOP_LEVEL_SECTION_LABELS,
  type SidebarTopLevelSectionId,
  type SidebarTopLevelSectionsPrefs,
} from "../../lib/sidebar-section-prefs";
import {
  BACKUP_SCHEDULE_FORM_DEFAULTS,
  BackupScheduleFormSchema,
  HISTORY_RETENTION_FORM_DEFAULTS,
  HistoryRetentionFormSchema,
  MANUAL_SNAPSHOT_FORM_DEFAULTS,
  ManualSnapshotFormSchema,
} from "./workbench-settings-form-schemas";
import {
  type SettingsSectionDefinition,
  type SettingsSectionId,
} from "./workbench-settings-sections";
import {
  CODEX_SETTINGS_SHELL_STYLE,
  NodexSettingsSection as SectionBlock,
  NodexSettingsRow as SettingRow,
  NodexSettingsPageSurface as SettingsPageSurface,
} from "../ui/settings";
import { PermissionModeDropdown } from "@/features/local-conversation/view/shared/permission-mode-dropdown";
import { SettingsSidebar } from "./workbench-settings-sidebar";
import {
  buildSettingsPath,
  resolveSettingsShellState,
} from "./workbench-settings-routes";

const BACKUP_TRIGGER_LABELS: Record<BackupRecord["trigger"], string> = {
  manual: "Manual",
  auto: "Auto",
  "pre-restore": "Safety",
};

const DEFAULT_DIAGNOSTICS_SETTINGS: DiagnosticsSettings = {
  enabled: false,
  dsn: "",
  environment: "production",
  release: null,
  tracesSampleRate: 0,
  replayEnabled: false,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1,
  envOverrides: {
    enabled: false,
    dsn: false,
    environment: false,
    release: false,
    tracesSampleRate: false,
    replayEnabled: false,
    replaysSessionSampleRate: false,
    replaysOnErrorSampleRate: false,
  },
};

const DEFAULT_TELEMETRY_SETTINGS: TelemetrySettings = {
  enabled: false,
  clientKey: "",
  environment: "production",
  autoCaptureEnabled: false,
  envOverrides: {
    enabled: false,
    clientKey: false,
    environment: false,
    autoCaptureEnabled: false,
  },
};

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ComponentType<{ className?: string }>;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
}

interface ToggleGroupOption<T extends string> {
  value: T;
  label: string;
}

interface ToggleGroupProps<T extends string> {
  selectedValues: readonly T[];
  onToggle: (value: T) => void;
  options: ToggleGroupOption<T>[];
}

function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: SegmentedControlProps<T>) {
  return (
    <div className="inline-flex items-center gap-0.5" role="group">
      {options.map((option) => {
        const Icon = option.icon;
        const isActive = value === option.value;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={isActive}
            className={cn(
              "flex items-center gap-1 rounded-full border border-transparent px-2 py-0.5 text-sm/4.5 transition-colors",
              "outline-none focus-visible:ring-2 focus-visible:ring-(--accent-blue)/30",
              isActive
                ? "bg-foreground-5 text-(--foreground)"
                : "text-(--foreground-secondary) hover:bg-foreground-5",
            )}
          >
            {Icon ? <Icon className="size-4" /> : null}
            <span className="text-sm">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function ToggleGroup<T extends string>({
  selectedValues,
  onToggle,
  options,
}: ToggleGroupProps<T>) {
  const selected = new Set(selectedValues);

  return (
    <div className="flex max-w-72 flex-wrap justify-end gap-1">
      {options.map((option) => {
        const isSelected = selected.has(option.value);

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onToggle(option.value)}
            aria-pressed={isSelected}
            className={cn(
              "rounded-full border px-2 py-0.5 text-sm/4.5 transition-colors",
              "outline-none focus-visible:ring-2 focus-visible:ring-(--accent-blue)/30",
              isSelected
                ? "border-transparent bg-foreground-5 text-(--foreground)"
                : "border-(--border) text-(--foreground-secondary) hover:bg-foreground-5",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function TogglePill({
  value,
  onChange,
  disabled = false,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  onLabel?: string;
  offLabel?: string;
}) {
  const handleToggle = useCallback(() => {
    if (disabled) return;
    onChange(!value);
  }, [disabled, onChange, value]);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={handleToggle}
      disabled={disabled}
      className={cn(
        "flex items-center gap-2 text-sm focus-visible:rounded-full focus-visible:ring-2 focus-visible:ring-(--accent-blue)/50 focus-visible:outline-none",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
      )}
    >
      <span
        className={cn(
          "relative inline-flex h-5 w-8 shrink-0 items-center rounded-full transition-colors duration-200 ease-out",
          value
            ? "bg-(--accent-blue)"
            : "bg-foreground-10",
        )}
      >
        <span
          className={cn(
            "size-4 rounded-full border border-white bg-white shadow-sm transition-transform duration-200 ease-out",
            value ? "translate-x-3.25" : "translate-x-0.75",
          )}
        />
      </span>
    </button>
  );
}

function formatApprovalPolicyLabel(value: CodexPermissionState["approvalPolicy"]): string {
  if (typeof value === "string") {
    return value;
  }
  return "granular";
}

function formatSandboxModeLabel(value: CodexPermissionState["sandboxMode"]): string {
  return value ?? "unset";
}

function ConfigValueDropdown({
  value,
  options,
  onSelect,
  disabled = false,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onSelect: (value: string) => void;
  disabled?: boolean;
}) {
  const selectedLabel = options.find((option) => option.value === value)?.label ?? value;

  return (
    <NodexDropdownMenu
      disabled={disabled}
      triggerButton={<NodexDropdownButtonTrigger>{selectedLabel}</NodexDropdownButtonTrigger>}
      align="end"
    >
      {options.map((option) => (
        <NodexDropdownItem
          key={option.value}
          onSelect={() => onSelect(option.value)}
          rightSlot={option.value === value ? <CheckmarkIcon className="size-4" /> : null}
        >
          {option.label}
        </NodexDropdownItem>
      ))}
    </NodexDropdownMenu>
  );
}

function ThemeSettingControl() {
  const { theme, setTheme } = useTheme();

  return (
    <SegmentedControl
      value={theme}
      onChange={setTheme}
      options={[
        { value: "system", label: "System", icon: Monitor },
        { value: "light", label: "Light", icon: Sun },
        { value: "dark", label: "Dark", icon: Moon },
      ]}
    />
  );
}

function ThreadNotificationSettingControl({ open }: { open: boolean }) {
  const { settings, isLoading, reloadSettings, updateSettings } = useThreadNotificationSettings();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void reloadSettings().catch((err) => {
      setError(err instanceof Error ? err.message : "Could not load thread notification settings.");
    });
  }, [open, reloadSettings]);

  const handleChange = useCallback(
    async (nextSettings: {
      turnMode: ThreadNotificationTurnMode;
      permissionsEnabled: boolean;
      questionsEnabled: boolean;
    }) => {
      setBusy(true);
      setError(null);

      try {
        await updateSettings(nextSettings);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save thread notification settings.");
      } finally {
        setBusy(false);
      }
    },
    [updateSettings],
  );

  return (
    <div className="flex min-w-72 flex-col items-end gap-3">
      <SegmentedControl<ThreadNotificationTurnMode>
        value={settings.turnMode}
        onChange={(turnMode) => {
          void handleChange({
            ...settings,
            turnMode,
          });
        }}
        options={[
          { value: "off", label: "Never" },
          { value: "unfocused", label: "Only when unfocused" },
          { value: "always", label: "Always" },
        ]}
      />
      <div className="flex w-full max-w-80 flex-col gap-2">
        <div className="flex items-center justify-between gap-4">
          <span className="text-right text-sm text-(--foreground-secondary)">
            Approval requests
          </span>
          <TogglePill
            value={settings.permissionsEnabled}
            onChange={(permissionsEnabled) => {
              void handleChange({
                ...settings,
                permissionsEnabled,
              });
            }}
            disabled={busy || isLoading}
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-right text-sm text-(--foreground-secondary)">
            Questions
          </span>
          <TogglePill
            value={settings.questionsEnabled}
            onChange={(questionsEnabled) => {
              void handleChange({
                ...settings,
                questionsEnabled,
              });
            }}
            disabled={busy || isLoading}
          />
        </div>
      </div>
      {error ? (
        <span className="max-w-80 text-right text-xs text-(--red-text)">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function ServiceTierSettingControl() {
  const { serviceTierSettings, setServiceTier } = useCodexServiceTierSettings();
  const selectedValue = serviceTierSettings.serviceTier === "fast" ? "fast" : "standard";

  return (
    <SegmentedControl<"standard" | "fast">
      value={selectedValue}
      onChange={(value) => {
        setServiceTier(value === "fast" ? "fast" : null, "settings");
      }}
      options={[
        { value: "standard", label: "Standard" },
        { value: "fast", label: "Fast" },
      ]}
    />
  );
}

function WindowRestoreSettingControl() {
  const { settings, isLoading, updateSettings } = useWindowRestoreSettings();
  const selectedValue = isLoading ? "all" : settings.policy;

  return (
    <SegmentedControl<WindowRestorePolicy>
      value={selectedValue}
      onChange={(policy) => {
        void updateSettings({ policy });
      }}
      options={[
        { value: "all", label: "All" },
        { value: "last-window", label: "Last" },
        { value: "none", label: "None" },
      ]}
    />
  );
}

function hasDiagnosticsEnvOverride(settings: DiagnosticsSettings): boolean {
  return settings.envOverrides.enabled
    || settings.envOverrides.dsn
    || settings.envOverrides.environment
    || settings.envOverrides.release
    || settings.envOverrides.tracesSampleRate
    || settings.envOverrides.replayEnabled
    || settings.envOverrides.replaysSessionSampleRate
    || settings.envOverrides.replaysOnErrorSampleRate;
}

function toDiagnosticsUpdateInput(
  settings: DiagnosticsSettings,
  overrides: Partial<UpdateDiagnosticsSettingsInput>,
): UpdateDiagnosticsSettingsInput {
  return {
    enabled: settings.enabled,
    dsn: settings.dsn,
    environment: settings.environment,
    release: settings.release,
    tracesSampleRate: settings.tracesSampleRate,
    replayEnabled: settings.replayEnabled,
    replaysSessionSampleRate: settings.replaysSessionSampleRate,
    replaysOnErrorSampleRate: settings.replaysOnErrorSampleRate,
    ...overrides,
  };
}

function DiagnosticsSettingControl({ open }: { open: boolean }) {
  const [settings, setSettings] = useState<DiagnosticsSettings>(DEFAULT_DIAGNOSTICS_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await invoke("settings:diagnostics:get");
      if (!isDiagnosticsSettings(result)) {
        throw new Error("Could not load diagnostics settings.");
      }
      setSettings(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load diagnostics settings.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [load, open]);

  const handleEnabledChange = useCallback(async (enabled: boolean) => {
    const previous = settings;
    const nextSettings = { ...settings, enabled };
    setSettings(nextSettings);
    setBusy(true);
    setError(null);

    try {
      const result = await invoke(
        "settings:diagnostics:update",
        toDiagnosticsUpdateInput(settings, { enabled }),
      );
      if (!isDiagnosticsSettings(result)) {
        throw new Error("Could not save diagnostics settings.");
      }
      setSettings(result);
    } catch (err) {
      setSettings(previous);
      setError(err instanceof Error ? err.message : "Could not save diagnostics settings.");
    } finally {
      setBusy(false);
    }
  }, [settings]);

  const handleReplayEnabledChange = useCallback(async (replayEnabled: boolean) => {
    const previous = settings;
    const nextSettings = { ...settings, replayEnabled };
    setSettings(nextSettings);
    setBusy(true);
    setError(null);

    try {
      const result = await invoke(
        "settings:diagnostics:update",
        toDiagnosticsUpdateInput(settings, { replayEnabled }),
      );
      if (!isDiagnosticsSettings(result)) {
        throw new Error("Could not save diagnostics settings.");
      }
      setSettings(result);
    } catch (err) {
      setSettings(previous);
      setError(err instanceof Error ? err.message : "Could not save diagnostics settings.");
    } finally {
      setBusy(false);
    }
  }, [settings]);

  const hasEnvOverride = hasDiagnosticsEnvOverride(settings);
  const summary = settings.envOverrides.enabled
    ? "Managed by NODEX_SENTRY_ENABLED."
    : settings.enabled
      ? "Crash reports are enabled after restart."
      : "Crash reports are off.";
  const replaySummary = settings.envOverrides.replayEnabled
    ? "Session Replay is managed by NODEX_SENTRY_REPLAY_ENABLED."
    : !settings.enabled
      ? "Session replays require crash reports."
      : settings.replayEnabled
        ? "Session replays are enabled after restart."
        : "Session replays are off.";
  const replayDisabled =
    busy
    || !settings.enabled
    || settings.envOverrides.replayEnabled;

  return (
    <div className="flex max-w-80 flex-col items-end gap-2 text-right">
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-2">
          <span className="text-xs text-(--foreground-secondary)">
            Share crash reports
          </span>
          <TogglePill
            value={settings.enabled}
            disabled={busy || settings.envOverrides.enabled}
            onChange={(enabled) => {
              void handleEnabledChange(enabled);
            }}
          />
        </div>
        <div className="max-w-72 text-xs text-(--foreground-secondary)">
          {hasEnvOverride ? `${summary} Environment overrides are active.` : summary}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-2">
          <span className="text-xs text-(--foreground-secondary)">
            Share session replays
          </span>
          <TogglePill
            value={settings.replayEnabled && settings.enabled}
            disabled={replayDisabled}
            onChange={(replayEnabled) => {
              void handleReplayEnabledChange(replayEnabled);
            }}
          />
        </div>
        <div className="max-w-72 text-xs text-(--foreground-secondary)">
          {replaySummary}
        </div>
      </div>
      {error ? (
        <span className="max-w-72 text-xs text-(--red-text)">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function hasTelemetryEnvOverride(settings: TelemetrySettings): boolean {
  return settings.envOverrides.enabled
    || settings.envOverrides.clientKey
    || settings.envOverrides.environment
    || settings.envOverrides.autoCaptureEnabled;
}

function toTelemetryUpdateInput(
  settings: TelemetrySettings,
  overrides: Partial<UpdateTelemetrySettingsInput>,
): UpdateTelemetrySettingsInput {
  return {
    enabled: settings.enabled,
    clientKey: settings.clientKey,
    environment: settings.environment,
    autoCaptureEnabled: settings.autoCaptureEnabled,
    ...overrides,
  };
}

function TelemetrySettingControl({ open }: { open: boolean }) {
  const [settings, setSettings] = useState<TelemetrySettings>(DEFAULT_TELEMETRY_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await invoke("settings:telemetry:get");
      if (!isTelemetrySettings(result)) {
        throw new Error("Could not load telemetry settings.");
      }
      setSettings(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load telemetry settings.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [load, open]);

  const handleEnabledChange = useCallback(async (enabled: boolean) => {
    const previous = settings;
    const nextSettings = { ...settings, enabled };
    setSettings(nextSettings);
    setBusy(true);
    setError(null);

    try {
      const result = await invoke(
        "settings:telemetry:update",
        toTelemetryUpdateInput(settings, { enabled }),
      );
      if (!isTelemetrySettings(result)) {
        throw new Error("Could not save telemetry settings.");
      }
      setSettings(result);
    } catch (err) {
      setSettings(previous);
      setError(err instanceof Error ? err.message : "Could not save telemetry settings.");
    } finally {
      setBusy(false);
    }
  }, [settings]);

  const handleAutoCaptureEnabledChange = useCallback(async (autoCaptureEnabled: boolean) => {
    const previous = settings;
    const nextSettings = { ...settings, autoCaptureEnabled };
    setSettings(nextSettings);
    setBusy(true);
    setError(null);

    try {
      const result = await invoke(
        "settings:telemetry:update",
        toTelemetryUpdateInput(settings, { autoCaptureEnabled }),
      );
      if (!isTelemetrySettings(result)) {
        throw new Error("Could not save telemetry settings.");
      }
      setSettings(result);
    } catch (err) {
      setSettings(previous);
      setError(err instanceof Error ? err.message : "Could not save telemetry settings.");
    } finally {
      setBusy(false);
    }
  }, [settings]);

  const hasEnvOverride = hasTelemetryEnvOverride(settings);
  const summary = settings.envOverrides.enabled
    ? "Managed by NODEX_TELEMETRY_ENABLED."
    : settings.enabled
      ? "Product telemetry is enabled after restart."
      : "Product telemetry is off.";
  const autoCaptureSummary = settings.envOverrides.autoCaptureEnabled
    ? "Web analytics are managed by NODEX_TELEMETRY_AUTOCAPTURE_ENABLED."
    : !settings.enabled
      ? "Web analytics require product telemetry."
      : settings.autoCaptureEnabled
        ? "Web analytics are enabled after restart."
        : "Web analytics are off.";
  const autoCaptureDisabled =
    busy
    || !settings.enabled
    || settings.envOverrides.autoCaptureEnabled;

  return (
    <div className="flex max-w-80 flex-col items-end gap-2 text-right">
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-2">
          <span className="text-xs text-(--foreground-secondary)">
            Share product telemetry
          </span>
          <TogglePill
            value={settings.enabled}
            disabled={busy || settings.envOverrides.enabled}
            onChange={(enabled) => {
              void handleEnabledChange(enabled);
            }}
          />
        </div>
        <div className="max-w-72 text-xs text-(--foreground-secondary)">
          {hasEnvOverride ? `${summary} Environment overrides are active.` : summary}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-2">
          <span className="text-xs text-(--foreground-secondary)">
            Share web analytics
          </span>
          <TogglePill
            value={settings.autoCaptureEnabled && settings.enabled}
            disabled={autoCaptureDisabled}
            onChange={(autoCaptureEnabled) => {
              void handleAutoCaptureEnabledChange(autoCaptureEnabled);
            }}
          />
        </div>
        <div className="max-w-72 text-xs text-(--foreground-secondary)">
          {autoCaptureSummary}
        </div>
      </div>
      {error ? (
        <span className="max-w-72 text-xs text-(--red-text)">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function SidebarSectionVisibilitySettingControl({
  order,
  sections,
  onVisibleChange,
}: {
  order: readonly SidebarTopLevelSectionId[];
  sections: SidebarTopLevelSectionsPrefs;
  onVisibleChange: (sectionId: SidebarTopLevelSectionId, visible: boolean) => void;
}) {
  return (
    <ToggleGroup
      selectedValues={order.filter((sectionId) => sections[sectionId].visible)}
      onToggle={(sectionId) => onVisibleChange(sectionId, !sections[sectionId].visible)}
      options={order.map((sectionId) => ({
        value: sectionId,
        label: SIDEBAR_TOP_LEVEL_SECTION_LABELS[sectionId],
      }))}
    />
  );
}

function SpellcheckSettingControl() {
  const { spellcheck, toggleSpellcheck } = useSpellcheck();

  return <TogglePill value={spellcheck} onChange={() => toggleSpellcheck()} />;
}

function NfmAutolinkTypingSettingControl() {
  const { settings, updateSettings } = useNfmAutolinkSettings();

  return (
    <TogglePill
      value={settings.autoLinkWhileTyping}
      onChange={(value) => updateSettings({ autoLinkWhileTyping: value })}
    />
  );
}

function NfmAutolinkPasteSettingControl() {
  const { settings, updateSettings } = useNfmAutolinkSettings();

  return (
    <TogglePill
      value={settings.autoLinkOnPaste}
      onChange={(value) => updateSettings({ autoLinkOnPaste: value })}
    />
  );
}

function NfmAutolinkBareDomainsSettingControl() {
  const { settings, updateSettings } = useNfmAutolinkSettings();
  const disabled = !settings.autoLinkWhileTyping && !settings.autoLinkOnPaste;

  return (
    <TogglePill
      value={settings.linkifyBareDomains}
      onChange={(value) => updateSettings({ linkifyBareDomains: value })}
      disabled={disabled}
    />
  );
}

function PasteResourceNumberSettingControl({
  value,
  defaultValue,
  min,
  max,
  onChange,
  ariaLabel,
}: {
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = useCallback(() => {
    const parsed = Number.parseInt(draft, 10);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }

    const normalized = Math.min(max, Math.max(min, parsed));
    onChange(normalized);
  }, [draft, max, min, onChange, value]);

  return (
    <div className="flex items-center gap-3">
      <Input
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          commit();
          event.currentTarget.blur();
        }}
        spellCheck={false}
        inputMode="numeric"
        aria-label={ariaLabel}
        className="h-8 w-28 px-2 text-sm"
      />
      <span className="text-sm text-(--foreground-secondary) tabular-nums">
        Default {defaultValue.toLocaleString()}
      </span>
    </div>
  );
}

function PasteResourceTextThresholdSettingControl() {
  const { settings, updateSettings } = usePasteResourceSettings();

  return (
    <PasteResourceNumberSettingControl
      value={settings.textPromptCharThreshold}
      defaultValue={DEFAULT_TEXT_PROMPT_CHAR_THRESHOLD}
      min={MIN_TEXT_PROMPT_CHAR_THRESHOLD}
      max={MAX_TEXT_PROMPT_CHAR_THRESHOLD}
      onChange={(value) => updateSettings({ textPromptCharThreshold: value })}
      ariaLabel="Paste resource text threshold"
    />
  );
}

function PasteResourceDescriptionSoftLimitSettingControl() {
  const { settings, updateSettings } = usePasteResourceSettings();

  return (
    <PasteResourceNumberSettingControl
      value={settings.descriptionSoftLimit}
      defaultValue={DEFAULT_DESCRIPTION_SOFT_LIMIT}
      min={MIN_DESCRIPTION_SOFT_LIMIT}
      max={MAX_DESCRIPTION_SOFT_LIMIT}
      onChange={(value) => updateSettings({ descriptionSoftLimit: value })}
      ariaLabel="Paste resource description soft limit"
    />
  );
}

const THREAD_DETAIL_LEVEL_OPTIONS: Array<{
  value: CodexThreadDetailLevel;
  label: string;
  description: string;
}> = [
    {
      value: "STEPS_PROSE",
      label: "Steps",
      description: "Hide commands and outputs.",
    },
    {
      value: "STEPS_COMMANDS",
      label: "Steps with code commands",
      description: "Show commands, collapse output.",
    },
    {
      value: "STEPS_EXECUTION",
      label: "Steps with code output",
      description: "Show commands and expand output.",
    },
  ];

function ThreadDetailLevelSettingControl() {
  const { settings, setThreadDetailLevel } = useCodexThreadSettings();
  const selectedValue = settings.detailLevel ?? "STEPS_COMMANDS";
  const selectedOption = THREAD_DETAIL_LEVEL_OPTIONS.find((option) => option.value === selectedValue)
    ?? THREAD_DETAIL_LEVEL_OPTIONS[1];

  return (
    <NodexDropdownMenu
      triggerButton={(
        <NodexDropdownButtonTrigger
          aria-label="Thread detail"
          className="min-w-56 text-base/4.5"
        >
          <span className="truncate">{formatCodexThreadDetailLevelLabel(selectedOption.value)}</span>
        </NodexDropdownButtonTrigger>
      )}
      align="end"
      contentWidth="workspace"
      contentMaxHeight="tall"
    >
      {THREAD_DETAIL_LEVEL_OPTIONS.map((option) => (
        <NodexDropdownItem
          key={option.value}
          onSelect={() => setThreadDetailLevel(option.value)}
          rightSlot={option.value === selectedValue ? <CheckmarkIcon className="shrink-0 text-token-foreground" /> : null}
          subText={option.description}
          allowWrap
        >
          {option.label}
        </NodexDropdownItem>
      ))}
    </NodexDropdownMenu>
  );
}

function SansFontSizeSettingControl() {
  const { sansFontSize, setSansFontSize } = useSansFontSize();
  const isDefault = sansFontSize === DEFAULT_SANS_FONT_SIZE;

  return (
    <div className="flex items-center gap-3">
      <span className="w-10 text-right text-sm text-(--foreground-secondary) tabular-nums">
        {sansFontSize}px
      </span>
      <input
        type="range"
        min={MIN_SANS_FONT_SIZE}
        max={MAX_SANS_FONT_SIZE}
        step={1}
        value={sansFontSize}
        onChange={(event) => {
          const nextValue = Number.parseInt(event.target.value, 10);
          if (!Number.isFinite(nextValue)) return;
          setSansFontSize(nextValue);
        }}
        aria-label="Sans font size"
        className="w-28 accent-(--accent-blue)"
      />
      <button
        type="button"
        onClick={() => setSansFontSize(DEFAULT_SANS_FONT_SIZE)}
        disabled={isDefault}
        className={cn(
          "inline-flex h-7 items-center gap-1 rounded-full border px-2 py-0.5 text-sm transition-colors",
          isDefault
            ? "border-transparent bg-foreground-5 text-(--foreground-secondary) opacity-60"
            : "border-(--border) text-(--foreground-secondary) hover:bg-foreground-5 hover:text-(--foreground)",
          "disabled:cursor-not-allowed",
        )}
      >
        <RotateCcw className="size-3.5" />
        <span>Default</span>
      </button>
    </div>
  );
}

function CodeFontSizeSettingControl() {
  const { codeFontSize, setCodeFontSize } = useCodeFontSize();
  const isDefault = codeFontSize === DEFAULT_CODE_FONT_SIZE;

  return (
    <div className="flex items-center gap-3">
      <span className="w-10 text-right text-sm text-(--foreground-secondary) tabular-nums">
        {codeFontSize}px
      </span>
      <input
        type="range"
        min={MIN_CODE_FONT_SIZE}
        max={MAX_CODE_FONT_SIZE}
        step={1}
        value={codeFontSize}
        onChange={(event) => {
          const nextValue = Number.parseInt(event.target.value, 10);
          if (!Number.isFinite(nextValue)) return;
          setCodeFontSize(nextValue);
        }}
        aria-label="Code font size"
        className="w-28 accent-(--accent-blue)"
      />
      <button
        type="button"
        onClick={() => setCodeFontSize(DEFAULT_CODE_FONT_SIZE)}
        disabled={isDefault}
        className={cn(
          "inline-flex h-7 items-center gap-1 rounded-full border px-2 py-0.5 text-sm transition-colors",
          isDefault
            ? "border-transparent bg-foreground-5 text-(--foreground-secondary) opacity-60"
            : "border-(--border) text-(--foreground-secondary) hover:bg-foreground-5 hover:text-(--foreground)",
          "disabled:cursor-not-allowed",
        )}
      >
        <RotateCcw className="size-3.5" />
        <span>Default</span>
      </button>
    </div>
  );
}

function FileLinkOpenerSettingControl() {
  const { opener, setOpener } = useFileLinkOpener();
  const selectedOption = FILE_LINK_OPENER_OPTIONS.find((option) => option.id === opener)
    ?? FILE_LINK_OPENER_OPTIONS[0];

  return (
    <NodexDropdownMenu
      triggerButton={(
        <NodexDropdownButtonTrigger
          aria-label={`Open markdown file links in ${selectedOption.label}`}
          className="min-w-50 text-base/4.5"
        >
          <span className="flex items-center gap-1.5">
            <img
              src={FILE_LINK_OPENER_ICON_URLS[selectedOption.id]}
              alt=""
              className="size-5 shrink-0 object-contain"
              aria-hidden="true"
            />
            <span className="truncate">{selectedOption.label}</span>
          </span>
        </NodexDropdownButtonTrigger>
      )}
      align="end"
      contentWidth="sm"
      contentMaxHeight="tall"
    >
      {FILE_LINK_OPENER_OPTIONS.map((option) => (
        <NodexDropdownItem
          key={option.id}
          onSelect={() => setOpener(normalizeFileLinkOpenerId(option.id))}
          leftSlot={(
            <img
              src={FILE_LINK_OPENER_ICON_URLS[option.id]}
              alt=""
              className="size-4 shrink-0 object-contain"
              aria-hidden="true"
            />
          )}
          rightSlot={option.id === selectedOption.id ? <CheckmarkIcon className="shrink-0 text-token-foreground" /> : null}
        >
          {option.label}
        </NodexDropdownItem>
      ))}
    </NodexDropdownMenu>
  );
}

function CardPropertyPositionSettingControl() {
  const { position, setPosition } = useCardPropertyPosition();

  return (
    <SegmentedControl<CardPropertyPosition>
      value={position}
      onChange={setPosition}
      options={[
        { value: "top", label: "Top" },
        { value: "inline", label: "Inline" },
        { value: "bottom", label: "Bottom" },
      ]}
    />
  );
}

function CardStageCollapsedPropertiesSettingControl() {
  const { collapsedProperties, toggleCollapsedProperty } = useCardStageCollapsedProperties();

  return (
    <ToggleGroup<CardStageCollapsibleProperty>
      selectedValues={collapsedProperties}
      onToggle={toggleCollapsedProperty}
      options={CARD_STAGE_COLLAPSIBLE_PROPERTIES.map((property) => ({
        value: property,
        label: CARD_STAGE_COLLAPSIBLE_PROPERTY_LABELS[property],
      }))}
    />
  );
}

function WorktreeStartModeSettingControl({
  value,
  onChange,
}: {
  value: WorktreeStartMode;
  onChange: (value: WorktreeStartMode) => void;
}) {
  return (
    <SegmentedControl<WorktreeStartMode>
      value={value}
      onChange={onChange}
      options={[
        { value: "autoBranch", label: "Auto branch" },
        { value: "detachedHead", label: "Detached HEAD" },
      ]}
    />
  );
}

function WorktreeAutoBranchPrefixSettingControl({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = useCallback(() => {
    onChange(draft);
  }, [draft, onChange]);

  return (
    <Input
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        commit();
        event.currentTarget.blur();
      }}
      spellCheck={false}
      autoCapitalize="none"
      autoCorrect="off"
      placeholder={DEFAULT_WORKTREE_AUTO_BRANCH_PREFIX}
      aria-label="Auto branch prefix"
      className="h-8 w-52 px-2 text-sm"
    />
  );
}

function formatWorktreeTime(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) {
    const mins = Math.floor(diff / 60_000);
    return `${mins}m ago`;
  }
  if (diff < 86_400_000) {
    const hours = Math.floor(diff / 3_600_000);
    return `${hours}h ago`;
  }
  const days = Math.floor(diff / 86_400_000);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function ManagedWorktreesSettingControl({ open }: { open: boolean }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<ManagedWorktreeRecord[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke("worktrees:list");
      setRecords(Array.isArray(result) ? (result as ManagedWorktreeRecord[]) : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load managed worktrees.");
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  const handleDelete = useCallback(
    async (threadId: string) => {
      setDeletingId(threadId);
      try {
        await invoke("worktrees:delete", threadId);
        setRecords((prev) => prev.filter((r) => r.threadId !== threadId));
      } catch {
        // Reload to get fresh state on failure
        await load();
      } finally {
        setDeletingId(null);
      }
    },
    [load],
  );

  const count = records.length;

  return (
    <div className="flex w-full flex-col gap-2">
      {/* Header */}
      <div className="flex items-center gap-2">
        {count > 0 ? (
          <span className="rounded-full bg-foreground-5 px-1.5 py-0 text-xs text-(--foreground-secondary) tabular-nums">
            {count}
          </span>
        ) : null}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => void load()}
          className={cn(
            "rounded-full border px-2 py-0.5 text-xs/4 transition-colors",
            "border-(--border) text-(--foreground-secondary) hover:bg-foreground-5",
          )}
          disabled={loading}
        >
          {loading ? "Refreshing\u2026" : "Refresh"}
        </button>
      </div>

      {/* Error */}
      {error ? (
        <div className="rounded-md bg-(--red-text)/8 px-3 py-2 text-xs text-(--red-text)">
          {error}
        </div>
      ) : null}

      {/* Empty state */}
      {!error && count === 0 && !loading ? (
        <div className="py-6 text-center text-xs text-(--foreground-secondary)">
          No managed worktrees yet
        </div>
      ) : null}

      {/* Session list */}
      {count > 0 ? (
        <div className="flex max-h-64 flex-col overflow-auto">
          {records.map((record) => {
            const isDeleting = deletingId === record.threadId;
            const label =
              record.projectName && record.sessionTitle
                ? `${record.projectName} / ${record.sessionTitle}`
                : record.projectName ?? record.sessionTitle ?? record.sessionId;
            return (
              <div
                key={record.threadId}
                className={cn(
                  "group/wt flex items-start gap-3 border-b border-(--border) px-1 py-2.5 last:border-b-0",
                  isDeleting && "pointer-events-none opacity-40",
                )}
              >
                {/* Status dot */}
                <div className="mt-1.5 flex shrink-0">
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      record.exists
                        ? "bg-emerald-500"
                        : "bg-amber-500",
                    )}
                    title={record.exists ? "Directory exists" : "Directory missing"}
                  />
                </div>

                {/* Content */}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-baseline gap-1.5">
                    <span className="truncate text-xs text-(--foreground-secondary)">
                      {label}
                    </span>
                    <span className="text-[10px] text-(--foreground-secondary)/50">/</span>
                    <span className="shrink-0 text-xs font-medium text-(--foreground)">
                      {record.threadName || record.threadId.slice(0, 8)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="min-w-0 truncate font-mono text-[11px] text-(--foreground-secondary)/70"
                      title={record.path}
                    >
                      {record.path}
                    </span>
                    <span className="shrink-0 text-[10px] text-(--foreground-secondary)/50">
                      {formatWorktreeTime(record.linkedAt)}
                    </span>
                  </div>
                </div>

                {/* Delete button */}
                <button
                  type="button"
                  onClick={() => void handleDelete(record.threadId)}
                  disabled={isDeleting}
                  className={cn(
                    "mt-0.5 shrink-0 rounded-sm p-1 text-(--foreground-secondary)/50 transition-colors",
                    "opacity-0 group-hover/wt:opacity-100 hover:bg-foreground-5 hover:text-(--red-text)",
                    "focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-(--accent-blue) focus-visible:outline-none",
                  )}
                  title="Remove worktree directory"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 6h18" />
                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function SmartPrefixParsingSettingControl({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return <TogglePill value={value} onChange={onChange} />;
}

function StripSmartPrefixFromTitleSettingControl({
  value,
  onChange,
  disabled = false,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return <TogglePill value={value} onChange={onChange} disabled={disabled} />;
}

function ComposerEnterBehaviorControl({
  value,
  onChange,
}: {
  value: ComposerEnterBehavior;
  onChange: (value: ComposerEnterBehavior) => void;
}) {
  return (
    <TogglePill
      value={value === "cmdIfMultiline"}
      onChange={(enabled) => onChange(enabled ? "cmdIfMultiline" : "enter")}
    />
  );
}

function ThreadQueueFollowUpsSettingControl({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return <TogglePill value={value} onChange={onChange} />;
}

function formatBackupSize(bytes: number): string {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatBackupTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function BackupSettingsControl({ open }: { open: boolean }) {
  const [settings, setSettings] = useState<BackupSettings | null>(null);
  const [historySettings, setHistorySettings] = useState<HistorySettings | null>(null);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [createSafetyBackup, setCreateSafetyBackup] = useState(true);
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"refresh" | "save" | "create" | "restore" | "delete" | null>(
    null,
  );
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scheduleForm = useForm({
    defaultValues: BACKUP_SCHEDULE_FORM_DEFAULTS,
    validators: {
      onSubmit: BackupScheduleFormSchema,
    },
    onSubmitInvalid: ({ value }) => {
      const parsed = BackupScheduleFormSchema.safeParse(value);
      setError(resolveZodErrorMessage(parsed.error) ?? "Could not save backup schedule.");
      setStatus(null);
    },
    onSubmit: async ({ value }) => {
      if (!settings) return;
      const parsed = BackupScheduleFormSchema.parse(value);

      setBusyAction("save");
      setError(null);
      setStatus(null);

      try {
        const updated = await invoke("settings:backup:update", {
          autoEnabled: settings.envOverrides.autoEnabled ? settings.autoEnabled : parsed.autoEnabled,
          intervalHours: settings.envOverrides.intervalHours ? settings.intervalHours : parsed.intervalHours,
          retentionCount: settings.envOverrides.retentionCount
            ? settings.retentionCount
            : parsed.retentionCount,
        }) as BackupSettings;
        setSettings(updated);
        scheduleForm.reset({
          autoEnabled: updated.autoEnabled,
          intervalHours: String(updated.intervalHours),
          retentionCount: String(updated.retentionCount),
        });
        setStatus("Backup schedule saved.");
      } catch (err) {
        setError(resolveFormErrorMessage(err) ?? "Could not save backup schedule.");
      } finally {
        setBusyAction(null);
      }
    },
  });
  const historyForm = useForm({
    defaultValues: HISTORY_RETENTION_FORM_DEFAULTS,
    validators: {
      onSubmit: HistoryRetentionFormSchema,
    },
    onSubmitInvalid: ({ value }) => {
      const parsed = HistoryRetentionFormSchema.safeParse(value);
      setError(resolveZodErrorMessage(parsed.error) ?? "Could not save history retention.");
      setStatus(null);
    },
    onSubmit: async ({ value }) => {
      if (!historySettings) return;
      const parsed = HistoryRetentionFormSchema.parse(value);

      setBusyAction("save");
      setError(null);
      setStatus(null);

      try {
        const updated = await invoke("settings:history:update", {
          retentionCount: historySettings.envOverrides.retentionCount
            ? historySettings.retentionCount
            : parsed.retentionCount,
        }) as HistorySettings;
        setHistorySettings(updated);
        historyForm.reset({
          retentionCount: String(updated.retentionCount),
        });
        setStatus("History retention saved.");
      } catch (err) {
        setError(resolveFormErrorMessage(err) ?? "Could not save history retention.");
      } finally {
        setBusyAction(null);
      }
    },
  });
  const snapshotForm = useForm({
    defaultValues: MANUAL_SNAPSHOT_FORM_DEFAULTS,
    validators: {
      onSubmit: ManualSnapshotFormSchema,
    },
    onSubmit: async ({ value, formApi }) => {
      const parsed = ManualSnapshotFormSchema.parse(value);
      setBusyAction("create");
      setError(null);
      setStatus(null);

      try {
        await invoke("backup:create", parsed.label ? { label: parsed.label } : {});
        await loadBackups();
        formApi.reset();
        setStatus("Manual backup created.");
      } catch (err) {
        setError(resolveFormErrorMessage(err) ?? "Could not create backup.");
      } finally {
        setBusyAction(null);
      }
    },
  });
  const scheduleValues = useStore(scheduleForm.store, (state) => state.values);
  const historyValues = useStore(historyForm.store, (state) => state.values);
  const snapshotValues = useStore(snapshotForm.store, (state) => state.values);

  const loadBackupSettings = useCallback(async () => {
    const data = await invoke("settings:backup:get") as BackupSettings;
    setSettings(data);
    scheduleForm.reset({
      autoEnabled: data.autoEnabled,
      intervalHours: String(data.intervalHours),
      retentionCount: String(data.retentionCount),
    });
  }, [scheduleForm]);

  const loadBackups = useCallback(async () => {
    const list = await invoke("backup:list") as BackupRecord[];
    if (!Array.isArray(list)) {
      setBackups([]);
      return;
    }
    setBackups(list);
  }, []);

  const loadHistorySettings = useCallback(async () => {
    const data = await invoke("settings:history:get") as HistorySettings;
    setHistorySettings(data);
    historyForm.reset({
      retentionCount: String(data.retentionCount),
    });
  }, [historyForm]);

  const refresh = useCallback(async () => {
    setBusyAction("refresh");
    setError(null);
    setStatus(null);

    try {
      await Promise.all([loadBackupSettings(), loadHistorySettings(), loadBackups()]);
      setConfirmRestoreId(null);
      setConfirmDeleteId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load backups.");
    } finally {
      setBusyAction(null);
    }
  }, [loadBackupSettings, loadBackups, loadHistorySettings]);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (open) return;
    setStatus(null);
    setError(null);
    setConfirmRestoreId(null);
    setConfirmDeleteId(null);
    snapshotForm.reset();
  }, [historyForm, open, snapshotForm]);

  const handleRestoreBackup = useCallback(
    async (backupId: string) => {
      if (confirmRestoreId !== backupId) {
        setConfirmDeleteId(null);
        setConfirmRestoreId(backupId);
        setStatus("Click Restore again to confirm.");
        return;
      }

      setBusyAction("restore");
      setError(null);
      setStatus(null);

      try {
        await invoke("backup:restore", {
          backupId,
          confirm: true,
          createSafetyBackup,
        });
        await loadBackups();
        setConfirmRestoreId(null);
        setStatus("Backup restored.");
      } catch (err) {
        setError(resolveFormErrorMessage(err) ?? "Could not restore backup.");
      } finally {
        setBusyAction(null);
      }
    },
    [confirmRestoreId, createSafetyBackup, loadBackups],
  );

  const handleDeleteBackup = useCallback(
    async (backupId: string) => {
      if (confirmDeleteId !== backupId) {
        setConfirmRestoreId(null);
        setConfirmDeleteId(backupId);
        setStatus(null);
        setError(null);
        return;
      }

      setBusyAction("delete");
      setError(null);
      setStatus(null);

      try {
        await invoke("backup:delete", backupId);
        await loadBackups();
        setConfirmDeleteId(null);
        setStatus("Snapshot deleted.");
      } catch (err) {
        setError(resolveFormErrorMessage(err) ?? "Could not delete backup.");
      } finally {
        setBusyAction(null);
      }
    },
    [confirmDeleteId, loadBackups],
  );

  const hasBackupEnvOverrides =
    settings?.envOverrides.autoEnabled ||
    settings?.envOverrides.intervalHours ||
    settings?.envOverrides.retentionCount;
  const hasHistoryEnvOverride = historySettings?.envOverrides.retentionCount;

  return (
    <div className="flex flex-col gap-[var(--padding-panel)]">
      <SectionBlock title="Automatic snapshots">
        <SettingRow label="Auto backups" description="Schedule background snapshots for the local store.">
          <TogglePill
            value={scheduleValues.autoEnabled}
            onChange={(value) => scheduleForm.setFieldValue("autoEnabled", value)}
            disabled={Boolean(settings?.envOverrides.autoEnabled)}
          />
        </SettingRow>
        <SettingRow label="Frequency" description="Minimum is one hour.">
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              value={scheduleValues.intervalHours}
              disabled={Boolean(settings?.envOverrides.intervalHours)}
              onChange={(event) => scheduleForm.setFieldValue("intervalHours", event.target.value)}
              className="w-16 text-right"
            />
            <span className="text-sm text-token-text-secondary">hours</span>
          </div>
        </SettingRow>
        <SettingRow label="Retention" description="Snapshots kept before pruning.">
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              value={scheduleValues.retentionCount}
              disabled={Boolean(settings?.envOverrides.retentionCount)}
              onChange={(event) => scheduleForm.setFieldValue("retentionCount", event.target.value)}
              className="w-16 text-right"
            />
            <span className="text-sm text-token-text-secondary">max</span>
          </div>
        </SettingRow>
        <div className="flex items-center justify-between gap-3 p-3">
          <div className="text-sm text-token-text-secondary">
            {hasBackupEnvOverrides ? "Some values locked by env vars." : null}
          </div>
          <div className="flex items-center gap-2">
            <NodexButton
              variant="secondary"
              size="sm"
              onClick={() => void refresh()}
              disabled={busyAction !== null}
            >
              Refresh
            </NodexButton>
            <NodexButton
              variant="primary"
              size="sm"
              onClick={() => void scheduleForm.handleSubmit()}
              disabled={busyAction !== null}
            >
              Save schedule
            </NodexButton>
          </div>
        </div>
      </SectionBlock>

      <SectionBlock title="History retention">
        <SettingRow
          label="History retention"
          description="Newest deleted Block records kept per Project before safe collection. Use 0 to collect every unreferenced tombstone."
        >
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              value={historyValues.retentionCount}
              disabled={Boolean(historySettings?.envOverrides.retentionCount)}
              onChange={(event) => historyForm.setFieldValue("retentionCount", event.target.value)}
              className="w-20 text-right"
            />
            <span className="text-sm text-token-text-secondary">records</span>
          </div>
        </SettingRow>
        <div className="flex items-center justify-between gap-3 p-3">
          <div className="text-sm text-token-text-secondary">
            {hasHistoryEnvOverride
              ? "Value locked by env var."
              : "Applied by background maintenance."}
          </div>
          <NodexButton
            variant="primary"
            size="sm"
            onClick={() => void historyForm.handleSubmit()}
            disabled={busyAction !== null}
          >
            Apply
          </NodexButton>
        </div>
      </SectionBlock>

      <SectionBlock title="Snapshots">
        <form
          className="flex items-center gap-2 p-3"
          onSubmit={(event) => handleFormSubmit(event, snapshotForm.handleSubmit)}
        >
          <Input
            value={snapshotValues.label}
            placeholder="Optional snapshot label"
            onChange={(event) => snapshotForm.setFieldValue("label", event.target.value)}
            className="min-w-0 flex-1"
          />
          <NodexButton
            type="submit"
            variant="secondary"
            size="sm"
            disabled={busyAction !== null}
          >
            Create snapshot
          </NodexButton>
        </form>
        <SettingRow
          label="Safety backup"
          description="Create a fresh snapshot before restoring an older one."
        >
          <label className="inline-flex items-center gap-1.5 text-sm text-token-text-secondary">
            <input
              type="checkbox"
              checked={createSafetyBackup}
              onChange={(event) => setCreateSafetyBackup(event.target.checked)}
              className="size-3.5 rounded-sm accent-(--accent-blue)"
            />
            Safety backup
          </label>
        </SettingRow>
        <div className="flex flex-col">
          {backups.length === 0 ? (
            <div className="px-3 py-3 text-sm text-token-text-secondary">
              No snapshots yet.
            </div>
          ) : (
            backups.map((backup) => (
              <div
                key={backup.id}
                className="flex items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-token-text-primary">
                    {backup.label?.trim() || backup.id}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-token-text-secondary">
                    <span>{formatBackupTimestamp(backup.createdAt)}</span>
                    <span>{formatBackupSize(backup.totalBytes)}</span>
                    <span className="inline-flex items-center rounded-full bg-token-foreground/5 px-1.5 py-px text-xs text-token-text-secondary">
                      {BACKUP_TRIGGER_LABELS[backup.trigger]}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {confirmDeleteId === backup.id ? (
                    <>
                      <NodexButton
                        variant="destructive"
                        size="sm"
                        onClick={() => void handleDeleteBackup(backup.id)}
                        disabled={busyAction !== null}
                      >
                        Confirm delete
                      </NodexButton>
                      <NodexButton
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmDeleteId(null)}
                        disabled={busyAction !== null}
                      >
                        Cancel
                      </NodexButton>
                    </>
                  ) : (
                    <>
                      <NodexButton
                        variant={confirmRestoreId === backup.id ? "destructive" : "secondary"}
                        size="sm"
                        onClick={() => void handleRestoreBackup(backup.id)}
                        disabled={busyAction !== null}
                      >
                        {confirmRestoreId === backup.id ? "Confirm restore" : "Restore"}
                      </NodexButton>
                      <NodexButton
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => void handleDeleteBackup(backup.id)}
                        disabled={busyAction !== null}
                        aria-label={`Delete snapshot ${backup.label?.trim() || backup.id}`}
                        title="Delete snapshot"
                      >
                        <Trash2 className="size-3.5" />
                      </NodexButton>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </SectionBlock>

      {status ? (
        <p className="text-sm text-token-text-secondary">{status}</p>
      ) : null}
      {error ? <p className="text-sm text-token-error-foreground">{error}</p> : null}
    </div>
  );
}

export interface SettingsRouteShellProps {
  path: string;
  onPathChange: (path: string) => void;
  onBackToApp: () => void;
  onRequestProjectPickerOpen: () => void;
  projects: Project[];
  activeProjectId: string;
  initialLocalEnvironmentProjectId?: string | null;
  initialLocalEnvironmentConfigPath?: string | null;
  initialSettingsSearchQuery?: string;
  initialSettingsSearchHighlightIndex?: number;
  sidebarTopLevelSectionOrder: SidebarTopLevelSectionId[];
  sidebarTopLevelSections: SidebarTopLevelSectionsPrefs;
  onSidebarTopLevelSectionVisibleChange: (sectionId: SidebarTopLevelSectionId, visible: boolean) => void;
  threadQueueFollowUpsEnabled: boolean;
  onThreadQueueFollowUpsEnabledChange: (value: boolean) => void;
  composerEnterBehavior: ComposerEnterBehavior;
  onComposerEnterBehaviorChange: (value: ComposerEnterBehavior) => void;
  worktreeStartMode: WorktreeStartMode;
  onWorktreeStartModeChange: (value: WorktreeStartMode) => void;
  worktreeAutoBranchPrefix: string;
  onWorktreeAutoBranchPrefixChange: (value: string) => void;
  smartPrefixParsingEnabled: boolean;
  onSmartPrefixParsingEnabledChange: (value: boolean) => void;
  stripSmartPrefixFromTitleEnabled: boolean;
  onStripSmartPrefixFromTitleEnabledChange: (value: boolean) => void;
}

interface SettingsSectionPageProps extends Pick<
  SettingsRouteShellProps,
  | "activeProjectId"
  | "composerEnterBehavior"
  | "initialLocalEnvironmentConfigPath"
  | "initialLocalEnvironmentProjectId"
  | "onRequestProjectPickerOpen"
  | "onComposerEnterBehaviorChange"
  | "onSidebarTopLevelSectionVisibleChange"
  | "onSmartPrefixParsingEnabledChange"
  | "onStripSmartPrefixFromTitleEnabledChange"
  | "onThreadQueueFollowUpsEnabledChange"
  | "onWorktreeAutoBranchPrefixChange"
  | "onWorktreeStartModeChange"
  | "projects"
  | "sidebarTopLevelSectionOrder"
  | "sidebarTopLevelSections"
  | "smartPrefixParsingEnabled"
  | "stripSmartPrefixFromTitleEnabled"
  | "threadQueueFollowUpsEnabled"
  | "worktreeAutoBranchPrefix"
  | "worktreeStartMode"
> {
  isMacPlatform: boolean;
  open: boolean;
}

function GeneralSettingsPage({
  onSidebarTopLevelSectionVisibleChange,
  open,
  sidebarTopLevelSectionOrder,
  sidebarTopLevelSections,
}: SettingsSectionPageProps) {
  return (
    <SettingsPageSurface
      title="General"
      subtitle="App-wide shell behavior and notifications."
    >
      <SectionBlock title="App">
        <SettingRow
          label="Restore windows"
          description="Choose which workbench windows reopen after quitting Nodex."
        >
          <WindowRestoreSettingControl />
        </SettingRow>
        <SettingRow
          label="Desktop notifications"
          description="Configure turn-complete, approval, and request-user-input notifications."
        >
          <ThreadNotificationSettingControl open={open} />
        </SettingRow>
        <SettingRow
          label="Service tier"
          description="Choose the default speed for new thread requests. Standard is the default; Fast opts into the faster tier."
        >
          <ServiceTierSettingControl />
        </SettingRow>
        <SettingRow
          label="App updates"
          description="Packaged macOS builds can check, download, and install stable updates in the background."
        >
          <AppUpdateSettingsControl open={open} />
        </SettingRow>
        <SettingRow
          label="Diagnostics"
          description="Optionally send crash diagnostics and masked session replays to Sentry. Prompts, transcripts, card text, and local payloads are scrubbed before upload."
        >
          <DiagnosticsSettingControl open={open} />
        </SettingRow>
        <SettingRow
          label="Telemetry"
          description="Optionally send anonymous product events and filtered technical web analytics to Statsig. Prompts, transcripts, card text, and file paths are not sent."
        >
          <TelemetrySettingControl open={open} />
        </SettingRow>
        <SettingRow
          label="Sidebar sections"
          description="Choose which top-level sidebar sections stay visible. Hidden sections can be restored here."
        >
          <SidebarSectionVisibilitySettingControl
            order={sidebarTopLevelSectionOrder}
            sections={sidebarTopLevelSections}
            onVisibleChange={onSidebarTopLevelSectionVisibleChange}
          />
        </SettingRow>
      </SectionBlock>
    </SettingsPageSurface>
  );
}

function AppearanceSettingsPage() {
  return (
    <SettingsPageSurface
      title="Appearance"
      subtitle="Theme and typography tokens used across the app."
    >
      <SectionBlock title="Theme">
        <SettingRow label="Theme" description="Match system mode or force a fixed theme.">
          <ThemeSettingControl />
        </SettingRow>
        <SettingRow
          label="Sans font size"
          description="Scales shared sans typography tokens and chat body text across the app."
        >
          <SansFontSizeSettingControl />
        </SettingRow>
        <SettingRow
          label="Code font size"
          description="Sets editor/code typography globally via --vscode-editor-font-size."
        >
          <CodeFontSizeSettingControl />
        </SettingRow>
      </SectionBlock>
    </SettingsPageSurface>
  );
}

function AgentSettingsPage({
  activeProjectId,
  open,
}: SettingsSectionPageProps) {
  const [permissionState, setPermissionState] = useState<CodexPermissionState | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPermissionState = useCallback(async () => {
    if (!activeProjectId) {
      setPermissionState(null);
      return;
    }

    const nextState = (await invoke("codex:permission:state:get", activeProjectId)) as CodexPermissionState;
    setPermissionState(nextState);
  }, [activeProjectId]);

  useEffect(() => {
    if (!open || !activeProjectId) {
      return;
    }

    void loadPermissionState().catch((err) => {
      setError(err instanceof Error ? err.message : "Could not load agent settings.");
    });
  }, [activeProjectId, loadPermissionState, open]);

  const writeConfigValue = useCallback(async (keyPath: string, value: unknown) => {
    if (!activeProjectId) {
      return;
    }

    setBusyKey(keyPath);
    setError(null);
    try {
      const nextState = (await invoke(
        "codex:permission:config-value:set",
        activeProjectId,
        keyPath,
        value,
      )) as CodexPermissionState;
      setPermissionState(nextState);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save config setting.");
    } finally {
      setBusyKey(null);
    }
  }, [activeProjectId]);

  const handlePermissionModeChange = useCallback(async (mode: "auto" | "guardian-approvals" | "full-access" | "custom") => {
    if (!activeProjectId) {
      return;
    }

    setBusyKey("permission-mode");
    setError(null);
    try {
      const nextState = (await invoke("codex:permission:mode:set", activeProjectId, mode)) as CodexPermissionState;
      setPermissionState(nextState);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save permission mode.");
    } finally {
      setBusyKey(null);
    }
  }, [activeProjectId]);

  const openConfigToml = useCallback(async () => {
    const configPath = permissionState?.configTarget.filePath?.trim();
    if (!configPath) {
      return;
    }

    await invoke("shell:open-file-link", { path: configPath }, "fileManager");
  }, [permissionState?.configTarget.filePath]);

  if (!activeProjectId) {
    return (
      <SettingsPageSurface
        title="Agent"
        subtitle="Permissions presets and raw config.toml settings."
      >
        <SectionBlock title="Agent">
          <div className="p-3 text-sm text-token-text-secondary">
            Open a project workspace to edit agent permissions.
          </div>
        </SectionBlock>
      </SettingsPageSurface>
    );
  }

  const approvalPolicyValue = formatApprovalPolicyLabel(permissionState?.approvalPolicy ?? null);
  const sandboxModeValue = formatSandboxModeLabel(permissionState?.sandboxMode ?? null);
  const networkAccessValue = permissionState?.sandbox?.type === "workspaceWrite"
    ? permissionState.sandbox.networkAccess
    : false;

  return (
    <SettingsPageSurface
      title="Agent"
      subtitle="Permissions presets and raw config.toml settings."
    >
      <SectionBlock title="Permissions modes">
        <SettingRow
          label="Default permissions mode"
          description="Choose the preset used for new local Codex threads."
        >
          <PermissionModeDropdown
            selectedMode={permissionState?.mode ?? "custom"}
            customDescription={permissionState?.customDescription ?? null}
            availableModes={permissionState?.availableModes}
            autoReviewAvailable={permissionState?.autoReviewAvailable ?? false}
            onSelect={(mode) => {
              void handlePermissionModeChange(mode);
            }}
          />
        </SettingRow>
      </SectionBlock>

      <SectionBlock title="Custom config.toml settings">
        <SettingRow label="Approval policy" description="Raw `approval_policy` value for this config target.">
          <ConfigValueDropdown
            value={approvalPolicyValue}
            disabled={busyKey !== null}
            onSelect={(value) => {
              void writeConfigValue("approval_policy", value);
            }}
            options={[
              { value: "untrusted", label: "untrusted" },
              { value: "on-request", label: "on-request" },
              { value: "never", label: "never" },
            ]}
          />
        </SettingRow>
        <SettingRow label="Sandbox settings" description="Raw `sandbox_mode` value for this config target.">
          <ConfigValueDropdown
            value={sandboxModeValue}
            disabled={busyKey !== null}
            onSelect={(value) => {
              void writeConfigValue("sandbox_mode", value);
            }}
            options={[
              { value: "read-only", label: "read-only" },
              { value: "workspace-write", label: "workspace-write" },
              { value: "danger-full-access", label: "danger-full-access" },
            ]}
          />
        </SettingRow>
        <SettingRow label="Allow network access" description="Controls `sandbox_workspace_write.network_access`.">
          <TogglePill
            value={networkAccessValue}
            disabled={busyKey !== null || permissionState?.sandboxMode !== "workspace-write"}
            onChange={(value) => {
              void writeConfigValue("sandbox_workspace_write.network_access", value);
            }}
          />
        </SettingRow>
        <SettingRow label="config.toml" description={permissionState?.configTarget.filePath ?? "No writable config target"}>
          <NodexButton
            type="button"
            variant="secondary"
            size="sm"
            disabled={!permissionState?.configTarget.filePath}
            onClick={() => {
              void openConfigToml();
            }}
          >
            Reveal
          </NodexButton>
        </SettingRow>
      </SectionBlock>

      {error ? (
        <div className="text-sm text-[var(--red-text)]">{error}</div>
      ) : null}
    </SettingsPageSurface>
  );
}

function EditorSettingsPage({
  composerEnterBehavior,
  isMacPlatform,
  onComposerEnterBehaviorChange,
  onSmartPrefixParsingEnabledChange,
  onStripSmartPrefixFromTitleEnabledChange,
  onThreadQueueFollowUpsEnabledChange,
  smartPrefixParsingEnabled,
  stripSmartPrefixFromTitleEnabled,
  threadQueueFollowUpsEnabled,
}: SettingsSectionPageProps) {
  return (
    <SettingsPageSurface
      title="Editor"
      subtitle="Thread detail, composer behavior, and editing defaults."
    >
      <SectionBlock title="Thread composer">
        <SettingRow
          label="Thread detail"
          description="Choose how much command output to show in threads."
        >
          <ThreadDetailLevelSettingControl />
        </SettingRow>
        <SettingRow label="Spellcheck" description="Inline text correction for editable writing surfaces.">
          <SpellcheckSettingControl />
        </SettingRow>
        <SettingRow
          label="Auto-link while typing"
          description="Turn typed URLs into links as you finish the token."
        >
          <NfmAutolinkTypingSettingControl />
        </SettingRow>
        <SettingRow
          label="Auto-link on paste"
          description="Recognize links in pasted text, including inline URL spans inside longer content."
        >
          <NfmAutolinkPasteSettingControl />
        </SettingRow>
        <SettingRow
          label="Recognize bare domains"
          description="Link plain domains like example.com. Leave off to avoid filename-like text such as .md paths."
        >
          <NfmAutolinkBareDomainsSettingControl />
        </SettingRow>
        <SettingRow
          label="Large paste text threshold"
          description="Prompt when pasted plain text reaches this many characters, so you can materialize it instead of inflating the note."
        >
          <PasteResourceTextThresholdSettingControl />
        </SettingRow>
        <SettingRow
          label="Large paste description soft limit"
          description="Prompt before pasted plain text pushes the note near its description size ceiling."
        >
          <PasteResourceDescriptionSoftLimitSettingControl />
        </SettingRow>
        <SettingRow
          label="Markdown file links"
          description="Choose which desktop app handles absolute local file links in rendered markdown."
        >
          <FileLinkOpenerSettingControl />
        </SettingRow>
        <SettingRow
          label="Smart parse block prefixes"
          description="Interpret shorthand like 1XL(tag) during block-to-card import."
        >
          <SmartPrefixParsingSettingControl
            value={smartPrefixParsingEnabled}
            onChange={onSmartPrefixParsingEnabledChange}
          />
        </SettingRow>
        <SettingRow
          label="Strip parsed prefix from title"
          description="Remove matched shorthand from imported card titles after parsing."
        >
          <StripSmartPrefixFromTitleSettingControl
            value={stripSmartPrefixFromTitleEnabled}
            onChange={onStripSmartPrefixFromTitleEnabledChange}
            disabled={!smartPrefixParsingEnabled}
          />
        </SettingRow>
        <SettingRow
          label={`${isMacPlatform ? "Cmd" : "Ctrl"}+Enter to send long prompts`}
          description="Single-line prompts still send on Enter. Multiline prompts switch to the modifier chord when this is enabled."
        >
          <ComposerEnterBehaviorControl
            value={composerEnterBehavior}
            onChange={onComposerEnterBehaviorChange}
          />
        </SettingRow>
        <SettingRow
          label="Queue follow-ups"
          description="While a thread is running, use queue as the default submit action instead of immediate steering."
        >
          <ThreadQueueFollowUpsSettingControl
            value={threadQueueFollowUpsEnabled}
            onChange={onThreadQueueFollowUpsEnabledChange}
          />
        </SettingRow>
      </SectionBlock>
    </SettingsPageSurface>
  );
}

function CardSettingsPage() {
  return (
    <SettingsPageSurface
      title="Card"
      subtitle="Kanban card and card-stage presentation."
    >
      <SectionBlock title="Cards">
        <SettingRow
          label="Kanban card properties"
          description="Choose whether priority, estimate, tags, assignee, and run-in metadata render above the title, inline with it, or below the card body."
        >
          <CardPropertyPositionSettingControl />
        </SettingRow>
        <SettingRow
          label="Card stage collapsed properties"
          description="Choose which card-stage property rows start behind the more-properties toggle."
        >
          <CardStageCollapsedPropertiesSettingControl />
        </SettingRow>
      </SectionBlock>
    </SettingsPageSurface>
  );
}

function WorktreesSettingsPage({
  onWorktreeAutoBranchPrefixChange,
  onWorktreeStartModeChange,
  open,
  worktreeAutoBranchPrefix,
  worktreeStartMode,
}: SettingsSectionPageProps) {
  return (
    <SettingsPageSurface
      title="Worktrees"
      subtitle="Managed worktree creation, naming, and cleanup."
    >
      <SectionBlock title="Defaults">
        <SettingRow
          label="Worktree start mode"
          description="Choose whether new worktree threads auto-create a branch or start detached."
        >
          <WorktreeStartModeSettingControl
            value={worktreeStartMode}
            onChange={onWorktreeStartModeChange}
          />
        </SettingRow>
        <SettingRow
          label="Auto branch prefix"
          description="Prefix prepended to auto branch names before the thread slug."
        >
          <WorktreeAutoBranchPrefixSettingControl
            value={worktreeAutoBranchPrefix}
            onChange={onWorktreeAutoBranchPrefixChange}
          />
        </SettingRow>
      </SectionBlock>
      <SectionBlock title="Managed worktrees">
        <div className="flex flex-col gap-1 p-3">
          <div className="text-sm text-token-text-primary">
            Managed worktrees
          </div>
          <div className="text-token-text-secondary text-sm">
            Worktrees created by card threads. Hover a row to remove.
          </div>
          <ManagedWorktreesSettingControl open={open} />
        </div>
      </SectionBlock>
    </SettingsPageSurface>
  );
}

function LocalEnvironmentsSettingsSectionPage({
  activeProjectId,
  initialLocalEnvironmentConfigPath,
  initialLocalEnvironmentProjectId,
  onRequestProjectPickerOpen,
  open,
  projects,
}: SettingsSectionPageProps) {
  return (
    <LocalEnvironmentsSettingsPage
      open={open}
      active
      projects={projects}
      activeProjectId={activeProjectId}
      initialProjectId={initialLocalEnvironmentProjectId}
      initialConfigPath={initialLocalEnvironmentConfigPath}
      onAddProject={onRequestProjectPickerOpen}
      renderShell={({ title, subtitle, backSlot, children }) => (
        <SettingsPageSurface
          title={title}
          subtitle={subtitle}
          backSlot={backSlot}
        >
          {children}
        </SettingsPageSurface>
      )}
    />
  );
}

function BackupsSettingsPage({ open }: SettingsSectionPageProps) {
  return (
    <SettingsPageSurface
      title="Backups"
      subtitle="Snapshot cadence, retention, and restore operations."
    >
      <BackupSettingsControl open={open} />
    </SettingsPageSurface>
  );
}

function SettingsPlaceholderPage({
  label,
  message,
}: {
  label: string;
  message: string;
}) {
  return (
    <SettingsPageSurface title={label} subtitle={message}>
      <SectionBlock title={label}>
        <div className="text-token-text-secondary p-3 text-sm">{message}</div>
      </SectionBlock>
    </SettingsPageSurface>
  );
}

const SETTINGS_SECTION_COMPONENTS: Record<SettingsSectionId, ComponentType<SettingsSectionPageProps>> = {
  "general-settings": GeneralSettingsPage,
  appearance: AppearanceSettingsPage,
  "keyboard-shortcuts": KeyboardShortcutsSettingsPage,
  agent: AgentSettingsPage,
  editor: EditorSettingsPage,
  card: CardSettingsPage,
  worktrees: WorktreesSettingsPage,
  "local-environments": LocalEnvironmentsSettingsSectionPage,
  backups: BackupsSettingsPage,
};

function isEditableEscapeElement(element: Element | null): boolean {
  return Boolean(
    element?.closest(
      [
        "input",
        "textarea",
        "select",
        "[contenteditable='true']",
        "[contenteditable='']",
        "[role='dialog']",
        "[data-slot='dialog-content']",
        "[data-slot='dropdown-content']",
        "[data-slot='popover-content']",
        "[data-radix-popper-content-wrapper]",
      ].join(","),
    ),
  );
}

function isEditableEscapeTarget(target: EventTarget | null): boolean {
  const targetElement = target instanceof Element ? target : null;
  const activeElement = targetElement?.ownerDocument.activeElement
    ?? (typeof document === "undefined" ? null : document.activeElement);

  return isEditableEscapeElement(targetElement)
    || isEditableEscapeElement(activeElement);
}

function SettingsMobileHeader({
  activeSectionId,
  sections,
  onBack,
  onSelectSection,
}: {
  activeSectionId: SettingsSectionId;
  sections: SettingsSectionDefinition[];
  onBack: () => void;
  onSelectSection: (sectionId: SettingsSectionId) => void;
}) {
  const activeSection = sections.find((section) => section.id === activeSectionId) ?? sections[0] ?? null;

  return (
    <div className="absolute inset-x-0 top-0 z-20 flex h-toolbar items-center justify-between gap-2 border-b border-token-border bg-token-main-surface-primary px-panel md:hidden">
      <button
        type="button"
        onClick={onBack}
        className="cursor-interaction rounded-lg px-2 py-1 text-sm text-token-text-secondary hover:bg-token-list-hover-background hover:text-token-text-primary focus-visible:ring-token-focus focus-visible:ring-1 focus-visible:outline-none"
      >
        Back
      </button>
      <NodexDropdownMenu
        align="end"
        triggerButton={(
          <NodexDropdownButtonTrigger
            size="sm"
            chrome="transparent"
            style={{ maxWidth: "min(14rem, calc(100vw - 7rem))" }}
          >
            <span className="truncate">{activeSection?.label ?? "Settings"}</span>
          </NodexDropdownButtonTrigger>
        )}
      >
        {sections.map((section) => (
          <NodexDropdownItem
            key={section.id}
            disabled={section.disabled}
            onSelect={() => onSelectSection(section.id)}
            rightSlot={section.id === activeSectionId ? <CheckmarkIcon className="size-4" /> : null}
          >
            {section.label}
          </NodexDropdownItem>
        ))}
      </NodexDropdownMenu>
    </div>
  );
}

export function SettingsRouteShell({
  path,
  onPathChange,
  onBackToApp,
  onRequestProjectPickerOpen,
  projects,
  activeProjectId,
  initialLocalEnvironmentProjectId,
  initialLocalEnvironmentConfigPath,
  initialSettingsSearchQuery,
  initialSettingsSearchHighlightIndex,
  sidebarTopLevelSectionOrder,
  sidebarTopLevelSections,
  onSidebarTopLevelSectionVisibleChange,
  threadQueueFollowUpsEnabled,
  onThreadQueueFollowUpsEnabledChange,
  composerEnterBehavior,
  onComposerEnterBehaviorChange,
  worktreeStartMode,
  onWorktreeStartModeChange,
  worktreeAutoBranchPrefix,
  onWorktreeAutoBranchPrefixChange,
  smartPrefixParsingEnabled,
  onSmartPrefixParsingEnabledChange,
  stripSmartPrefixFromTitleEnabled,
  onStripSmartPrefixFromTitleEnabledChange,
}: SettingsRouteShellProps) {
  const isMacPlatform = typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");
  const shellRef = useRef<HTMLDivElement>(null);
  const { activeSectionId, redirectPath, visibleSections } = resolveSettingsShellState(path);
  const activeSection = visibleSections.find((section) => section.id === activeSectionId) ?? null;
  const settingsSearchContext = useMemo(() => {
    const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;

    return {
      activeProjectName: activeProject?.name ?? null,
      projectNames: projects.map((project) => project.name),
    };
  }, [activeProjectId, projects]);

  useEffect(() => {
    if (!redirectPath) {
      return;
    }

    startTransition(() => {
      onPathChange(redirectPath);
    });
  }, [onPathChange, redirectPath]);

  useEffect(() => {
    shellRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (event.defaultPrevented || isEditableEscapeTarget(event.target)) return;
      onBackToApp();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onBackToApp]);

  const ActiveSectionComponent = SETTINGS_SECTION_COMPONENTS[activeSectionId];
  const shouldRenderPlaceholder = !ActiveSectionComponent
    || activeSection?.placeholderKind === "unavailable"
    || activeSection?.placeholderKind === "external";

  return (
    <div
      data-testid="settings-route-shell"
      className="flex h-full min-h-0 w-full flex-1 text-(--foreground)"
      style={CODEX_SETTINGS_SHELL_STYLE}
    >
      <div
        ref={shellRef}
        aria-label="Settings"
        tabIndex={-1}
        className="flex h-full min-h-0 w-full flex-1 outline-none"
      >
        <SettingsSidebar
          activeSectionId={activeSectionId}
          sections={visibleSections}
          searchContext={settingsSearchContext}
          initialSearchQuery={initialSettingsSearchQuery}
          initialHighlightedSearchIndex={initialSettingsSearchHighlightIndex}
          onBack={onBackToApp}
          onSelectSection={(sectionId) => {
            startTransition(() => {
              onPathChange(buildSettingsPath(sectionId));
            });
          }}
        />

        <div className="relative flex min-w-0 flex-1 overflow-hidden">
          <SettingsMobileHeader
            activeSectionId={activeSectionId}
            sections={visibleSections}
            onBack={onBackToApp}
            onSelectSection={(sectionId) => {
              startTransition(() => {
                onPathChange(buildSettingsPath(sectionId));
              });
            }}
          />
          {shouldRenderPlaceholder ? (
            <SettingsPlaceholderPage
              label={activeSection?.label ?? "Settings"}
              message={
                activeSection?.placeholderKind === "external"
                  ? "This settings page opens outside the app."
                  : "This settings page is not available yet."
              }
            />
          ) : (
            <ActiveSectionComponent
              open={true}
              isMacPlatform={isMacPlatform}
              projects={projects}
              activeProjectId={activeProjectId}
              initialLocalEnvironmentProjectId={initialLocalEnvironmentProjectId}
              initialLocalEnvironmentConfigPath={initialLocalEnvironmentConfigPath}
              onRequestProjectPickerOpen={onRequestProjectPickerOpen}
              sidebarTopLevelSectionOrder={sidebarTopLevelSectionOrder}
              sidebarTopLevelSections={sidebarTopLevelSections}
              onSidebarTopLevelSectionVisibleChange={onSidebarTopLevelSectionVisibleChange}
              threadQueueFollowUpsEnabled={threadQueueFollowUpsEnabled}
              onThreadQueueFollowUpsEnabledChange={onThreadQueueFollowUpsEnabledChange}
              composerEnterBehavior={composerEnterBehavior}
              onComposerEnterBehaviorChange={onComposerEnterBehaviorChange}
              worktreeStartMode={worktreeStartMode}
              onWorktreeStartModeChange={onWorktreeStartModeChange}
              worktreeAutoBranchPrefix={worktreeAutoBranchPrefix}
              onWorktreeAutoBranchPrefixChange={onWorktreeAutoBranchPrefixChange}
              smartPrefixParsingEnabled={smartPrefixParsingEnabled}
              onSmartPrefixParsingEnabledChange={onSmartPrefixParsingEnabledChange}
              stripSmartPrefixFromTitleEnabled={stripSmartPrefixFromTitleEnabled}
              onStripSmartPrefixFromTitleEnabledChange={onStripSmartPrefixFromTitleEnabledChange}
            />
          )}
        </div>
      </div>
    </div>
  );
}
