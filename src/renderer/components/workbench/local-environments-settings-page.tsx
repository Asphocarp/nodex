import { startTransition, useEffect, useEffectEvent, useId, useState, type ReactNode } from "react";
import {
  Bug,
  ChevronLeft,
  CirclePlay,
  FolderCode,
  Hammer,
  Plus,
  TestTube2,
  Trash2,
} from "lucide-react";
import { SpinnerIcon } from "@/components/shared/icons";
import { Input } from "@/components/ui/input";
import { invoke } from "@/lib/api";
import type {
  Project,
  UpdateWorktreeEnvironmentConfigInput,
  WorktreeEnvironmentActionDefinition,
  WorktreeEnvironmentActionIcon,
  WorktreeEnvironmentConfigRecord,
  WorktreeEnvironmentDefinition,
  WorktreeEnvironmentPlatform,
  WorktreeEnvironmentSettingsSnapshot,
} from "@/lib/types";
import { cn } from "@/lib/utils";

interface LocalEnvironmentsSettingsService {
  listConfigs: (
    projectId: string,
  ) => Promise<WorktreeEnvironmentConfigRecord[]>;
  readConfig: (
    projectId: string,
    configPath?: string | null,
  ) => Promise<WorktreeEnvironmentSettingsSnapshot>;
  saveConfig: (
    input: UpdateWorktreeEnvironmentConfigInput,
  ) => Promise<WorktreeEnvironmentSettingsSnapshot>;
}

interface LocalEnvironmentsSettingsPageProps {
  open: boolean;
  active: boolean;
  projects: Project[];
  activeProjectId: string;
  initialProjectId?: string | null;
  initialConfigPath?: string | null;
  onAddProject?: () => void;
  renderShell?: (shell: LocalEnvironmentsSettingsShellProps) => ReactNode;
  service?: LocalEnvironmentsSettingsService;
}

type LocalEnvironmentsPageMode = "workspace" | "summary" | "edit";

export interface LocalEnvironmentsSettingsShellProps {
  title: string;
  subtitle?: ReactNode;
  backSlot?: ReactNode;
  children: ReactNode;
}

const PLATFORM_OPTIONS: Array<{
  value: WorktreeEnvironmentPlatform;
  label: string;
}> = [
  { value: "darwin", label: "macOS" },
  { value: "linux", label: "Linux" },
  { value: "win32", label: "Windows" },
];

const ACTION_ICON_OPTIONS: Array<{
  value: WorktreeEnvironmentActionIcon;
  label: string;
  icon: typeof Hammer;
}> = [
  { value: "tool", label: "Tool", icon: Hammer },
  { value: "run", label: "Run", icon: CirclePlay },
  { value: "debug", label: "Debug", icon: Bug },
  { value: "test", label: "Test", icon: TestTube2 },
];

const DEFAULT_LOCAL_ENVIRONMENTS_SETTINGS_SERVICE: LocalEnvironmentsSettingsService = {
  async listConfigs(projectId) {
    return invoke("worktrees:environments:configs:list", projectId) as Promise<WorktreeEnvironmentConfigRecord[]>;
  },
  async readConfig(projectId, configPath) {
    return invoke("worktrees:environments:config:read", projectId, configPath) as Promise<WorktreeEnvironmentSettingsSnapshot>;
  },
  async saveConfig(input) {
    return invoke("worktrees:environments:config:save", input) as Promise<WorktreeEnvironmentSettingsSnapshot>;
  },
};

function buildEmptyEnvironmentDefinition(project: Project): WorktreeEnvironmentDefinition {
  const fallbackName = project.workspacePath?.trim()
    ? project.workspacePath.trim().split(/[\\/]/).filter(Boolean).at(-1) ?? project.name
    : project.name;

  return {
    version: 1,
    name: fallbackName.trim() || "local",
    setup: {
      script: null,
      platformScripts: {},
    },
    cleanup: {
      script: null,
      platformScripts: {},
    },
    actions: [],
  };
}

function cloneEnvironmentDefinition(environment: WorktreeEnvironmentDefinition): WorktreeEnvironmentDefinition {
  return {
    version: environment.version,
    name: environment.name,
    setup: {
      script: environment.setup.script,
      platformScripts: { ...environment.setup.platformScripts },
    },
    cleanup: {
      script: environment.cleanup.script,
      platformScripts: { ...environment.cleanup.platformScripts },
    },
    actions: environment.actions.map((action) => ({ ...action })),
  };
}

function createActionDraft(): WorktreeEnvironmentActionDefinition {
  return {
    id: `action-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`}`,
    name: "",
    icon: "tool",
    command: "",
    platform: null,
  };
}

function hasPlatformOverrides(environment: WorktreeEnvironmentDefinition, key: "setup" | "cleanup"): boolean {
  return Object.keys(environment[key].platformScripts).length > 0;
}

function normalizeEnvironmentForSave(environment: WorktreeEnvironmentDefinition): WorktreeEnvironmentDefinition {
  return {
    version: environment.version > 0 ? environment.version : 1,
    name: environment.name.trim(),
    setup: {
      script: environment.setup.script?.trim() || null,
      platformScripts: Object.fromEntries(
        Object.entries(environment.setup.platformScripts)
          .map(([platform, script]) => [platform, script.trim()])
          .filter(([, script]) => script.length > 0),
      ) as Partial<Record<WorktreeEnvironmentPlatform, string>>,
    },
    cleanup: {
      script: environment.cleanup.script?.trim() || null,
      platformScripts: Object.fromEntries(
        Object.entries(environment.cleanup.platformScripts)
          .map(([platform, script]) => [platform, script.trim()])
          .filter(([, script]) => script.length > 0),
      ) as Partial<Record<WorktreeEnvironmentPlatform, string>>,
    },
    actions: environment.actions.map((action) => ({
      ...action,
      name: action.name.trim(),
      command: action.command.trim(),
    })),
  };
}

function MultiLineCodePreview({
  script,
  emptyLabel,
}: {
  script: string | null;
  emptyLabel: string;
}) {
  if (!script?.trim()) {
    return <div className="text-sm text-token-text-secondary">{emptyLabel}</div>;
  }

  return (
    <pre className="scrollbar-token max-h-48 overflow-auto rounded-lg border border-token-border bg-token-input-background px-3 py-2 text-xs text-token-foreground">
      <code>{script}</code>
    </pre>
  );
}

function humanizeConfigFileName(configPath: string): string {
  const normalizedPath = configPath.trim().split("/").filter(Boolean).at(-1) ?? configPath.trim();
  return normalizedPath.length > 0 ? normalizedPath : "environment.toml";
}

function preferredConfigPath(configs: WorktreeEnvironmentConfigRecord[]): string | null {
  const preferredConfig =
    configs.find((config) => config.fileName === "environment.toml" && config.state === "success")
    ?? configs.find((config) => config.state === "success")
    ?? configs[0]
    ?? null;

  return preferredConfig?.configPath ?? null;
}

function configPrimaryLabel(config: WorktreeEnvironmentConfigRecord): string {
  if (config.state !== "success") {
    return "Environment needs attention";
  }

  return config.environment?.name?.trim() || config.name || humanizeConfigFileName(config.configPath);
}

function configSecondaryLabel(config: WorktreeEnvironmentConfigRecord): string | null {
  const fileName = humanizeConfigFileName(config.configPath);
  const primary = configPrimaryLabel(config);

  if (config.state !== "success") {
    return fileName;
  }

  return fileName !== primary ? fileName : null;
}

function SummarySection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-token-border bg-token-input-background/50 p-4">
      <div className="flex flex-col gap-1">
        <div className="text-sm font-medium text-token-foreground">{title}</div>
        <div className="text-sm text-token-text-secondary">{description}</div>
      </div>
      {children}
    </section>
  );
}

function PageSection({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-2", className)}>
      <div className="flex h-toolbar items-center justify-between gap-2 px-0 py-0">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="text-base font-medium text-token-text-primary">{title}</div>
          {description ? (
            <div className="text-sm text-token-text-secondary">{description}</div>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

function Panel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-token-border flex flex-col divide-y-[0.5px] divide-token-border rounded-lg border",
        className,
      )}
      style={{ backgroundColor: "var(--color-background-panel, var(--color-token-bg-fog))" }}
    >
      {children}
    </div>
  );
}

function SectionActionButton({
  children,
  onClick,
  variant = "secondary",
  disabled = false,
}: {
  children: ReactNode;
  onClick: () => void;
  variant?: "secondary" | "primary" | "danger";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-sm transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-(--accent-blue) text-white hover:bg-(--accent-blue-hover)",
        variant === "secondary" && "bg-foreground-5 text-token-foreground hover:bg-foreground-10",
        variant === "danger" && "bg-(--red-text)/10 text-(--red-text) hover:bg-(--red-text)/15",
      )}
    >
      {children}
    </button>
  );
}

function FieldLabel({
  htmlFor,
  title,
  description,
}: {
  htmlFor?: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-token-foreground">
        {title}
      </label>
      {description ? (
        <div className="text-sm text-token-text-secondary">{description}</div>
      ) : null}
    </div>
  );
}

function ScriptEditorSection({
  title,
  description,
  value,
  onChange,
  platformScripts,
  onPlatformScriptChange,
}: {
  title: string;
  description: string;
  value: string | null;
  onChange: (value: string) => void;
  platformScripts: Partial<Record<WorktreeEnvironmentPlatform, string>>;
  onPlatformScriptChange: (platform: WorktreeEnvironmentPlatform, value: string | null) => void;
}) {
  const textareaId = useId();

  return (
    <SummarySection title={title} description={description}>
      <FieldLabel
        htmlFor={textareaId}
        title="Script"
        description="Runs in the project root."
      />
      <textarea
        id={textareaId}
        value={value ?? ""}
        rows={6}
        onChange={(event) => onChange(event.target.value)}
        className="focus-visible:ring-token-focus w-full rounded-lg border border-token-border bg-token-input-background px-3 py-2 font-mono text-sm text-token-foreground outline-none focus-visible:ring-2"
      />

      <div className="flex flex-col gap-2 pt-1">
        <div className="text-sm font-medium text-token-foreground">Platform overrides</div>
        {PLATFORM_OPTIONS.map((platform) => {
          const currentValue = platformScripts[platform.value] ?? null;

          return (
            <div key={platform.value} className="rounded-lg border border-token-border/80 bg-token-input-background/60 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-sm text-token-foreground">{platform.label}</div>
                {currentValue ? (
                  <SectionActionButton
                    variant="danger"
                    onClick={() => onPlatformScriptChange(platform.value, null)}
                  >
                    Remove override
                  </SectionActionButton>
                ) : (
                  <SectionActionButton
                    onClick={() => onPlatformScriptChange(platform.value, "")}
                  >
                    Add override
                  </SectionActionButton>
                )}
              </div>
              {currentValue !== null ? (
                <textarea
                  value={currentValue}
                  rows={4}
                  onChange={(event) => onPlatformScriptChange(platform.value, event.target.value)}
                  className="focus-visible:ring-token-focus w-full rounded-lg border border-token-border bg-token-input-background px-3 py-2 font-mono text-sm text-token-foreground outline-none focus-visible:ring-2"
                />
              ) : (
                <div className="text-sm text-token-text-secondary">
                  Uses the default script.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </SummarySection>
  );
}

function ActionIconPreview({
  icon,
  className,
}: {
  icon: WorktreeEnvironmentActionIcon;
  className?: string;
}) {
  const Icon =
    ACTION_ICON_OPTIONS.find((option) => option.value === icon)?.icon
    ?? Hammer;

  return <Icon className={cn("size-4", className)} />;
}

function ActionsEditorSection({
  actions,
  onAdd,
  onUpdate,
  onRemove,
}: {
  actions: WorktreeEnvironmentActionDefinition[];
  onAdd: () => void;
  onUpdate: (actionId: string, patch: Partial<WorktreeEnvironmentActionDefinition>) => void;
  onRemove: (actionId: string) => void;
}) {
  return (
    <SummarySection
      title="Actions"
      description="Reusable commands surfaced from this local environment."
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-token-text-secondary">
          Add run/debug/test shortcuts tied to this environment.
        </div>
        <SectionActionButton onClick={onAdd}>
          <Plus className="size-4" />
          Add action
        </SectionActionButton>
      </div>

      {actions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-token-border p-4 text-sm text-token-text-secondary">
          No actions yet.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {actions.map((action, index) => (
            <div
              key={action.id}
              className="flex flex-col gap-3 rounded-lg border border-token-border bg-token-input-background/60 p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-token-foreground">Action {index + 1}</div>
                <button
                  type="button"
                  onClick={() => onRemove(action.id)}
                  className="inline-flex size-8 items-center justify-center rounded-lg text-token-text-secondary transition-colors hover:bg-(--red-text)/10 hover:text-(--red-text)"
                  aria-label={`Delete action ${index + 1}`}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>

              <div className="grid gap-3 md:grid-cols-[10rem_minmax(0,1fr)_10rem]">
                <div className="flex flex-col gap-1">
                  <FieldLabel title="Icon" />
                  <select
                    value={action.icon}
                    onChange={(event) => onUpdate(action.id, { icon: event.target.value as WorktreeEnvironmentActionIcon })}
                    className="h-9 rounded-lg border border-token-border bg-token-input-background px-3 text-sm text-token-foreground outline-none"
                  >
                    {ACTION_ICON_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <div className="inline-flex items-center gap-2 text-sm text-token-text-secondary">
                    <ActionIconPreview icon={action.icon} />
                    <span>{ACTION_ICON_OPTIONS.find((option) => option.value === action.icon)?.label ?? "Tool"}</span>
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <FieldLabel title="Name" />
                  <Input
                    value={action.name}
                    onChange={(event) => onUpdate(action.id, { name: event.target.value })}
                    className="h-9 rounded-lg border border-token-border bg-token-input-background px-3 text-sm text-token-foreground"
                    placeholder="Run integration tests"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <FieldLabel title="Platform" />
                  <select
                    value={action.platform ?? ""}
                    onChange={(event) =>
                      onUpdate(action.id, {
                        platform: event.target.value
                          ? (event.target.value as WorktreeEnvironmentPlatform)
                          : null,
                      })}
                    className="h-9 rounded-lg border border-token-border bg-token-input-background px-3 text-sm text-token-foreground outline-none"
                  >
                    <option value="">All platforms</option>
                    {PLATFORM_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <FieldLabel title="Command" />
                <textarea
                  value={action.command}
                  rows={4}
                  onChange={(event) => onUpdate(action.id, { command: event.target.value })}
                  className="focus-visible:ring-token-focus w-full rounded-lg border border-token-border bg-token-input-background px-3 py-2 font-mono text-sm text-token-foreground outline-none focus-visible:ring-2"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </SummarySection>
  );
}

function WorkspaceProjectEnvironmentGroup({
  project,
  service,
  onCreateEnvironment,
  onSelectEnvironment,
}: {
  project: Project;
  service: LocalEnvironmentsSettingsService;
  onCreateEnvironment: (projectId: string) => Promise<void>;
  onSelectEnvironment: (projectId: string, configPath: string) => Promise<void>;
}) {
  const [configs, setConfigs] = useState<WorktreeEnvironmentConfigRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const refreshConfigs = useEffectEvent(async () => {
    setLoading(true);
    setHasError(false);

    try {
      const nextConfigs = await service.listConfigs(project.id);
      setConfigs(nextConfigs);
    } catch {
      setHasError(true);
      setConfigs([]);
    } finally {
      setLoading(false);
    }
  });

  useEffect(() => {
    void refreshConfigs();
  }, [project.id]);

  const preferredPath = preferredConfigPath(configs);

  return (
    <Panel className="p-0">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <button
          className="flex min-w-0 items-center gap-3 text-left"
          type="button"
          onClick={() => {
            if (!preferredPath) return;
            void onSelectEnvironment(project.id, preferredPath);
          }}
        >
          <FolderCode className="icon-sm shrink-0 text-token-text-secondary" />
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-2 text-sm text-token-text-primary">
              <span className="truncate font-medium">{project.name}</span>
            </div>
            <span className="truncate text-xs text-token-text-secondary">
              {project.workspacePath?.trim() || "No workspace path"}
            </span>
          </div>
        </button>
        <button
          type="button"
          className={cn(
            "border-token-border user-select-none no-drag cursor-interaction flex items-center gap-1 border whitespace-nowrap",
            "focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-lg text-token-foreground",
            "bg-token-foreground/5 enabled:hover:bg-token-list-hover-background data-[state=open]:bg-token-list-hover-background",
            "border-transparent h-token-button-composer w-9 justify-center px-2 py-0 text-base leading-[18px]",
          )}
          aria-label="Add environment"
          onClick={() => {
            void onCreateEnvironment(project.id);
          }}
        >
          <Plus className="icon-sm" />
        </button>
      </div>

      {loading ? (
        <div className="border-t border-token-border px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-token-text-secondary">
            <SpinnerIcon className="icon-xs" />
            <span>Loading environment</span>
          </div>
        </div>
      ) : null}

      {!loading && hasError ? (
        <div className="border-t border-token-border px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-token-error-foreground">
            <span>Environment needs attention</span>
          </div>
        </div>
      ) : null}

      {!loading && !hasError && configs.length > 0 ? (
        <div className="border-t border-token-border">
          <div className="flex flex-col divide-y divide-token-border">
            {configs.map((config) => (
              <div
                key={config.configPath}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <button
                  className="flex min-w-0 flex-1 text-left"
                  type="button"
                  onClick={() => {
                    void onSelectEnvironment(project.id, config.configPath);
                  }}
                >
                  <div className="flex min-w-0 flex-col gap-0.5 text-sm">
                    <span className={config.state === "success" ? "text-token-text-primary" : "text-token-error-foreground"}>
                      {configPrimaryLabel(config)}
                    </span>
                    {configSecondaryLabel(config) ? (
                      <span className="text-xs text-token-description-foreground">
                        {configSecondaryLabel(config)}
                      </span>
                    ) : null}
                  </div>
                </button>
                <SectionActionButton
                  onClick={() => {
                    void onSelectEnvironment(project.id, config.configPath);
                  }}
                >
                  View
                </SectionActionButton>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

function LocalEnvironmentsBreadcrumb({
  projectName,
  mode,
  onBack,
}: {
  projectName: string;
  mode: Extract<LocalEnvironmentsPageMode, "summary" | "edit">;
  onBack: () => void;
}) {
  return (
    <nav className="flex items-center gap-2 text-sm text-token-text-secondary">
      <button
        type="button"
        onClick={onBack}
        className={cn(
          "border-token-border user-select-none no-drag cursor-interaction flex items-center gap-1 border whitespace-nowrap",
          "focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-lg text-token-description-foreground",
          "enabled:hover:bg-token-list-hover-background data-[state=open]:bg-token-list-hover-background border-transparent",
          "h-token-button-composer px-2 py-0 text-base leading-[18px]",
        )}
      >
        <ChevronLeft className="icon-2xs" />
        Back
      </button>
      <div className="flex items-center gap-1">
        <span>Environments</span>
        <ChevronLeft className="icon-xs rotate-180 text-token-text-secondary" />
        <span className="text-token-text-primary">{projectName}</span>
        {mode === "edit" ? (
          <>
            <ChevronLeft className="icon-xs rotate-180 text-token-text-secondary" />
            <span>edit</span>
          </>
        ) : null}
      </div>
    </nav>
  );
}

export function LocalEnvironmentsSettingsPage({
  open,
  active,
  projects,
  activeProjectId,
  initialProjectId,
  initialConfigPath,
  onAddProject,
  renderShell,
  service = DEFAULT_LOCAL_ENVIRONMENTS_SETTINGS_SERVICE,
}: LocalEnvironmentsSettingsPageProps) {
  const workspaceProjects = projects.filter((project) => project.workspacePath?.trim());
  const workspaceProjectIdsKey = workspaceProjects.map((project) => project.id).join("|");
  const [mode, setMode] = useState<LocalEnvironmentsPageMode>("workspace");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<WorktreeEnvironmentSettingsSnapshot | null>(null);
  const [initialDraft, setInitialDraft] = useState<WorktreeEnvironmentDefinition | null>(null);
  const [draft, setDraft] = useState<WorktreeEnvironmentDefinition | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [initializedKey, setInitializedKey] = useState<string | null>(null);

  const selectedProject =
    workspaceProjects.find((project) => project.id === selectedProjectId)
    ?? null;
  const applySnapshot = useEffectEvent((nextSnapshot: WorktreeEnvironmentSettingsSnapshot) => {
    const project =
      workspaceProjects.find((candidate) => candidate.id === nextSnapshot.projectId)
      ?? null;
    if (!project) return;

    const nextDraft = nextSnapshot.environment
      ? cloneEnvironmentDefinition(nextSnapshot.environment)
      : buildEmptyEnvironmentDefinition(project);

    startTransition(() => {
      setSelectedProjectId(project.id);
      setSnapshot(nextSnapshot);
      setInitialDraft(nextDraft);
      setDraft(cloneEnvironmentDefinition(nextDraft));
      setMode("summary");
      setErrorMessage(null);
    });
  });

  const loadSnapshot = useEffectEvent(async (projectId: string, configPath?: string | null) => {
    setLoading(true);
    setErrorMessage(null);

    try {
      const nextSnapshot = await service.readConfig(projectId, configPath);
      applySnapshot(nextSnapshot);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not load local environment.");
    } finally {
      setLoading(false);
    }
  });

  useEffect(() => {
    if (!open || !active) return;

    const hasExplicitContext = Boolean(initialProjectId || initialConfigPath);
    const targetProjectId = hasExplicitContext
      ? (() => {
        if (initialProjectId && workspaceProjects.some((project) => project.id === initialProjectId)) {
          return initialProjectId;
        }
        if (workspaceProjects.some((project) => project.id === activeProjectId)) {
          return activeProjectId;
        }
        return workspaceProjects[0]?.id ?? null;
      })()
      : null;

    const nextKey = `${targetProjectId ?? "__none__"}::${initialConfigPath ?? ""}`;
    if (!targetProjectId) {
      if (initializedKey === nextKey) return;
      setInitializedKey(nextKey);
      setMode("workspace");
      setSelectedProjectId(null);
      setSnapshot(null);
      setInitialDraft(null);
      setDraft(null);
      setErrorMessage(null);
      return;
    }
    if (initializedKey === nextKey) return;

    setInitializedKey(nextKey);
    void loadSnapshot(targetProjectId, initialConfigPath);
  }, [
    active,
    activeProjectId,
    initialConfigPath,
    initialProjectId,
    initializedKey,
    open,
    workspaceProjectIdsKey,
  ]);

  const normalizedDraft = draft ? normalizeEnvironmentForSave(draft) : null;
  const isDirty = normalizedDraft && initialDraft
    ? JSON.stringify(normalizedDraft) !== JSON.stringify(normalizeEnvironmentForSave(initialDraft))
    : false;
  const canSave = Boolean(
    selectedProjectId
    && snapshot
    && normalizedDraft
    && normalizedDraft.name.length > 0
    && isDirty
    && !saving,
  );

  async function handleSave() {
    if (!selectedProjectId || !snapshot || !normalizedDraft || normalizedDraft.name.length === 0) return;

    setSaving(true);
    setErrorMessage(null);

    try {
      const nextSnapshot = await service.saveConfig({
        projectId: selectedProjectId,
        configPath: snapshot.configPath,
        environment: normalizedDraft,
      });
      applySnapshot(nextSnapshot);
      setMode("summary");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not save local environment.");
    } finally {
      setSaving(false);
    }
  }

  function handleOpenWorkspaceList() {
    setMode("workspace");
    setErrorMessage(null);
  }

  function handleEditCurrentEnvironment() {
    if (!draft) return;
    setMode("edit");
    setErrorMessage(null);
  }

  function handleCancelEdit() {
    if (!initialDraft) {
      setMode("summary");
      return;
    }

    setDraft(cloneEnvironmentDefinition(initialDraft));
    setMode("summary");
    setErrorMessage(null);
  }

  function updateScriptSection(
    key: "setup" | "cleanup",
    patch: Partial<WorktreeEnvironmentDefinition["setup"]>,
  ) {
    if (!draft) return;
    setDraft({
      ...draft,
      [key]: {
        ...draft[key],
        ...patch,
      },
    });
  }

  function updateAction(actionId: string, patch: Partial<WorktreeEnvironmentActionDefinition>) {
    if (!draft) return;
    setDraft({
      ...draft,
      actions: draft.actions.map((action) => (
        action.id === actionId
          ? { ...action, ...patch }
          : action
      )),
    });
  }

  function removeAction(actionId: string) {
    if (!draft) return;
    setDraft({
      ...draft,
      actions: draft.actions.filter((action) => action.id !== actionId),
    });
  }

  function addAction() {
    if (!draft) return;
    setDraft({
      ...draft,
      actions: [...draft.actions, createActionDraft()],
    });
  }

  async function handleCreateEnvironmentForProject(projectId: string) {
    setLoading(true);
    setErrorMessage(null);

    try {
      const currentSnapshot = await service.readConfig(projectId, null);
      const nextSnapshot = currentSnapshot.configExists || currentSnapshot.configs.length > 0
        ? await service.readConfig(projectId, currentSnapshot.nextConfigPath)
        : currentSnapshot;
      applySnapshot(nextSnapshot);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not prepare a new local environment.");
    } finally {
      setLoading(false);
    }
  }

  const summaryEnvironment = snapshot?.environment ?? null;
  const shellSubtitle = mode === "workspace" ? (
    <>
      Local environments tell Codex how to set up worktrees for a project.{" "}
      <a
        className="inline-flex items-center gap-1 text-base text-token-text-link-foreground"
        href="https://developers.openai.com/codex/app/local-environments"
        target="_blank"
        rel="noreferrer"
      >
        Learn more.
      </a>
    </>
  ) : undefined;
  const shellBackSlot = (
    mode !== "workspace" && selectedProject
      ? (
        <LocalEnvironmentsBreadcrumb
          projectName={selectedProject.name}
          mode={mode}
          onBack={mode === "edit" ? handleCancelEdit : handleOpenWorkspaceList}
        />
      )
      : undefined
  );

  const content = (
    <div className="flex flex-col gap-[var(--padding-panel)]">
      {errorMessage ? (
        <div className="rounded-lg border border-(--red-text)/20 bg-(--red-text)/8 px-3 py-2 text-sm text-(--red-text)">
          {errorMessage}
        </div>
      ) : null}

      {mode === "workspace" ? (
        <PageSection
          title="Select a project"
          actions={(
            <SectionActionButton onClick={onAddProject ?? (() => {})} disabled={!onAddProject}>
              Add project
            </SectionActionButton>
          )}
        >
          {workspaceProjects.length === 0 ? (
            <Panel>
              <div className="p-3 text-sm text-token-text-secondary">
                No projects yet. Add one to configure local environments.
              </div>
            </Panel>
          ) : (
            <div className="flex flex-col gap-3" role="list" aria-label="Available projects">
              {workspaceProjects.map((project) => (
                <WorkspaceProjectEnvironmentGroup
                  key={project.id}
                  project={project}
                  service={service}
                  onCreateEnvironment={handleCreateEnvironmentForProject}
                  onSelectEnvironment={async (projectId, configPath) => {
                    await loadSnapshot(projectId, configPath);
                  }}
                />
              ))}
            </div>
          )}
        </PageSection>
      ) : null}

      {mode !== "workspace" && loading ? (
        <PageSection title="Loading local environments">
          <Panel>
            <div className="flex items-center gap-2 p-3 text-sm text-token-text-secondary">
              <SpinnerIcon className="icon-xs" />
              Fetching your project configuration.
            </div>
          </Panel>
        </PageSection>
      ) : null}

      {mode === "summary" && snapshot && !loading && selectedProject ? (
        <div className="flex flex-col gap-[var(--padding-panel)]">
          <PageSection title="Project">
            <Panel>
              <div className="flex items-center gap-3 p-3">
                <FolderCode className="icon-sm shrink-0 text-token-text-secondary" />
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex min-w-0 items-center gap-1 text-sm text-token-text-primary">
                    <span className="truncate">{selectedProject.name}</span>
                  </div>
                  <span className="truncate text-xs text-token-text-secondary">
                    {selectedProject.workspacePath?.trim() || "No workspace path"}
                  </span>
                </div>
              </div>
            </Panel>
          </PageSection>

          <PageSection title="Environment details">
            <div className="flex flex-col gap-[var(--padding-panel)]">
              <Panel>
                {summaryEnvironment ? (
                  <div className="flex items-center justify-between p-3">
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="min-w-0 text-sm text-token-text-primary">Name</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-sm text-token-text-secondary">{summaryEnvironment.name}</span>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 text-sm text-token-text-secondary">
                    No local environment is configured for this project yet.
                  </div>
                )}
              </Panel>

              {summaryEnvironment ? (
                <>
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-token-text-primary">Setup script</div>
                          <div className="text-sm text-token-text-secondary">This script will run on worktree creation.</div>
                        </div>
                      </div>
                    </div>
                    <MultiLineCodePreview
                      script={summaryEnvironment.setup.script}
                      emptyLabel="No setup script configured."
                    />
                    {hasPlatformOverrides(summaryEnvironment, "setup") ? (
                      <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-1">
                          <div className="text-xs font-medium tracking-wide text-token-text-secondary uppercase">
                            Platform overrides
                          </div>
                          <div className="text-sm text-token-text-secondary">
                            Overrides the default script for specific OSes.
                          </div>
                        </div>
                        {PLATFORM_OPTIONS.map((platform) => {
                          const script = summaryEnvironment.setup.platformScripts[platform.value] ?? null;
                          if (!script) return null;
                          return (
                            <div key={platform.value} className="flex flex-col gap-2">
                              <div className="text-xs font-medium tracking-wide text-token-text-secondary uppercase">
                                {platform.label}
                              </div>
                              <MultiLineCodePreview script={script} emptyLabel="" />
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                      <div className="text-sm font-medium text-token-text-primary">Cleanup script</div>
                      <div className="text-sm text-token-text-secondary">
                        This script will run before a worktree is deleted.
                      </div>
                    </div>
                    <MultiLineCodePreview
                      script={summaryEnvironment.cleanup.script}
                      emptyLabel="No cleanup script configured."
                    />
                    {hasPlatformOverrides(summaryEnvironment, "cleanup") ? (
                      <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-1">
                          <div className="text-xs font-medium tracking-wide text-token-text-secondary uppercase">
                            Platform overrides
                          </div>
                          <div className="text-sm text-token-text-secondary">
                            Overrides the default cleanup script for specific OSes.
                          </div>
                        </div>
                        {PLATFORM_OPTIONS.map((platform) => {
                          const script = summaryEnvironment.cleanup.platformScripts[platform.value] ?? null;
                          if (!script) return null;
                          return (
                            <div key={platform.value} className="flex flex-col gap-2">
                              <div className="text-xs font-medium tracking-wide text-token-text-secondary uppercase">
                                {platform.label}
                              </div>
                              <MultiLineCodePreview script={script} emptyLabel="" />
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}

              {snapshot.parseErrorMessage ? (
                <div className="mt-2 text-sm text-token-error-foreground">
                  Unable to parse the existing file. Saving will overwrite it. ({snapshot.parseErrorMessage})
                </div>
              ) : null}
              {snapshot.readErrorMessage ? (
                <div className="mt-2 text-sm text-token-error-foreground">
                  Failed to load local environment data. ({snapshot.readErrorMessage})
                </div>
              ) : null}
            </div>
          </PageSection>

          <PageSection title="Actions">
            <div className="text-sm text-token-text-secondary">
              These actions can run any command and will be displayed in the header.
            </div>
            <Panel>
              <div className="flex flex-col gap-2 p-3">
                {(summaryEnvironment?.actions.length ?? 0) > 0 ? (
                  <div className="flex flex-col gap-2">
                    {(summaryEnvironment?.actions ?? []).map((action, index) => (
                      <div key={`${action.name}-${index}`} className="flex items-center gap-2 text-sm text-token-text-secondary">
                        <span className="text-token-text-secondary">
                          <ActionIconPreview icon={action.icon ?? "tool"} className="size-4" />
                        </span>
                        <span>{action.name}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-token-text-secondary">
                    Add an action to run commands from the local toolbar.
                  </div>
                )}
              </div>
            </Panel>
          </PageSection>

          <div className="flex justify-end">
            <SectionActionButton variant="primary" onClick={handleEditCurrentEnvironment}>
              {snapshot.configExists ? "Edit local environment" : "Create local environment"}
            </SectionActionButton>
          </div>
        </div>
      ) : null}

      {mode === "edit" && draft && snapshot && !loading && selectedProject ? (
        <form
          className="flex flex-col gap-[var(--padding-panel)]"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSave();
          }}
        >
          <PageSection title="Local environment file">
            <Panel>
              <div className="flex items-center gap-3 p-3">
                <FolderCode className="icon-sm shrink-0 text-token-text-secondary" />
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex min-w-0 items-center gap-1 text-sm text-token-text-primary">
                    <span className="truncate">{selectedProject.name}</span>
                  </div>
                  <span className="truncate text-xs text-token-text-secondary">
                    {selectedProject.workspacePath?.trim() || "No workspace path"}
                  </span>
                </div>
              </div>
            </Panel>
            <div className="mt-2 truncate text-xs text-token-text-secondary">
              File: <span className="font-mono">{snapshot.configPath}</span>
            </div>
            {!snapshot.configExists ? (
              <div className="mt-1 text-sm text-token-text-secondary">
                Save to create this file for the first time.
              </div>
            ) : null}
            {snapshot.parseErrorMessage ? (
              <div className="mt-2 text-sm text-token-error-foreground">
                Unable to parse the existing file. Saving will overwrite it. ({snapshot.parseErrorMessage})
              </div>
            ) : null}
            {snapshot.readErrorMessage ? (
              <div className="mt-2 text-sm text-token-error-foreground">
                Failed to load local environment data. ({snapshot.readErrorMessage})
              </div>
            ) : null}
          </PageSection>

          <PageSection title="Environment details">
            <div className="flex flex-col gap-[var(--padding-panel)]">
              <Panel>
                <div className="flex items-center justify-between p-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="min-w-0 text-token-text-primary text-sm">Name</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <div className="w-72">
                      <Input
                        id="local-environment-name"
                        value={draft.name}
                        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                        className="h-9 w-full rounded-md border border-token-border bg-token-input-background px-2.5 py-1.5 text-sm text-token-text-primary"
                      />
                    </div>
                  </div>
                </div>
              </Panel>

              <ScriptEditorSection
                title="Setup script"
                description="This script will run on worktree creation."
                value={draft.setup.script}
                onChange={(value) => updateScriptSection("setup", { script: value })}
                platformScripts={draft.setup.platformScripts}
                onPlatformScriptChange={(platform, value) => {
                  const nextPlatformScripts = { ...draft.setup.platformScripts };
                  if (value === null) delete nextPlatformScripts[platform];
                  else nextPlatformScripts[platform] = value;
                  updateScriptSection("setup", { platformScripts: nextPlatformScripts });
                }}
              />
            </div>
          </PageSection>

          <ScriptEditorSection
            title="Cleanup script"
            description="This script will run before a worktree is deleted."
            value={draft.cleanup.script}
            onChange={(value) => updateScriptSection("cleanup", { script: value })}
            platformScripts={draft.cleanup.platformScripts}
            onPlatformScriptChange={(platform, value) => {
              const nextPlatformScripts = { ...draft.cleanup.platformScripts };
              if (value === null) delete nextPlatformScripts[platform];
              else nextPlatformScripts[platform] = value;
              updateScriptSection("cleanup", { platformScripts: nextPlatformScripts });
            }}
          />

          <ActionsEditorSection
            actions={draft.actions}
            onAdd={addAction}
            onUpdate={updateAction}
            onRemove={removeAction}
          />

          <div className="flex justify-end gap-2">
            <SectionActionButton onClick={handleCancelEdit}>
              Cancel
            </SectionActionButton>
            <SectionActionButton
              variant="primary"
              onClick={() => {
                void handleSave();
              }}
              disabled={!canSave}
            >
              {saving ? (
                <>
                  <SpinnerIcon className="size-4" />
                  Saving…
                </>
              ) : "Save local environment"}
            </SectionActionButton>
          </div>
        </form>
      ) : null}
    </div>
  );

  if (renderShell) {
    return renderShell({
      title: "Environments",
      subtitle: shellSubtitle,
      backSlot: shellBackSlot,
      children: content,
    });
  }

  return content;
}
