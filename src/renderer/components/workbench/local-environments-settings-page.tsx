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
import { ConfigStatusIcon, LocalStatusIcon, SpinnerIcon } from "@/components/shared/icons";
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
  service?: LocalEnvironmentsSettingsService;
}

type LocalEnvironmentsPageMode = "workspace" | "summary" | "edit";

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

function scriptSectionSummary(environment: WorktreeEnvironmentDefinition, key: "setup" | "cleanup"): string {
  const section = environment[key];
  const parts: string[] = [];

  if (section.script?.trim()) {
    parts.push("default script");
  }
  if (Object.keys(section.platformScripts).length > 0) {
    parts.push(`${Object.keys(section.platformScripts).length} platform override${Object.keys(section.platformScripts).length === 1 ? "" : "s"}`);
  }

  return parts.join(" + ");
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

function describeConfigState(config: WorktreeEnvironmentConfigRecord): string {
  if (config.state === "parseError") return "Parse error";
  if (config.state === "readError") return "Read error";

  const details: string[] = [];
  if (config.hasSetupScript) details.push("setup");
  if (config.hasCleanupScript) details.push("cleanup");
  if (config.actionCount > 0) details.push(`${config.actionCount} action${config.actionCount === 1 ? "" : "s"}`);
  return details.join(" · ") || "empty";
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

export function LocalEnvironmentsSettingsPage({
  open,
  active,
  projects,
  activeProjectId,
  initialProjectId,
  initialConfigPath,
  service = DEFAULT_LOCAL_ENVIRONMENTS_SETTINGS_SERVICE,
}: LocalEnvironmentsSettingsPageProps) {
  const workspaceProjects = projects.filter((project) => project.workspacePath?.trim());
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
  const emptyEnvironment =
    selectedProject
      ? buildEmptyEnvironmentDefinition(selectedProject)
      : null;

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

    const targetProjectId = (() => {
      if (initialProjectId && workspaceProjects.some((project) => project.id === initialProjectId)) {
        return initialProjectId;
      }
      if (workspaceProjects.some((project) => project.id === activeProjectId)) {
        return activeProjectId;
      }
      return workspaceProjects[0]?.id ?? null;
    })();

    const nextKey = `${targetProjectId ?? "__none__"}::${initialConfigPath ?? ""}`;
    if (!targetProjectId) {
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
    loadSnapshot,
    open,
    workspaceProjects,
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

  const activeConfigRecord = snapshot?.configs.find((config) => config.configPath === snapshot.configPath) ?? null;
  const summaryEnvironment = snapshot?.environment ?? draft ?? emptyEnvironment;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          {mode !== "workspace" ? (
            <button
              type="button"
              onClick={handleOpenWorkspaceList}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-token-text-secondary transition-colors hover:bg-foreground-5 hover:text-token-foreground"
              aria-label="Choose a different workspace"
            >
              <ChevronLeft className="size-4" />
            </button>
          ) : null}
          <div className="flex min-w-0 flex-col gap-1">
            <div className="text-base font-medium text-token-foreground">
              {mode === "workspace"
                ? "Local environments"
                : (selectedProject?.name ?? "Local environments")}
            </div>
            <div className="text-sm text-token-text-secondary">
              {mode === "workspace"
                ? "Choose a project workspace to inspect or edit .codex/environments/*.toml."
                : (selectedProject?.workspacePath?.trim() || "No workspace path")}
            </div>
          </div>
        </div>

        {mode === "summary" && snapshot ? (
          <div className="flex shrink-0 items-center gap-2">
            {snapshot.configs.length > 0 ? (
              <SectionActionButton
                onClick={() => {
                  if (!selectedProjectId) return;
                  void loadSnapshot(selectedProjectId, snapshot.nextConfigPath);
                }}
              >
                <Plus className="size-4" />
                New config
              </SectionActionButton>
            ) : null}
            <SectionActionButton
              variant="primary"
              onClick={handleEditCurrentEnvironment}
            >
              {snapshot.configExists ? "Edit local environment" : "Create local environment"}
            </SectionActionButton>
          </div>
        ) : null}

        {mode === "edit" ? (
          <div className="flex shrink-0 items-center gap-2">
            <SectionActionButton onClick={handleCancelEdit}>
              Cancel
            </SectionActionButton>
            <SectionActionButton variant="primary" onClick={handleSave} disabled={!canSave}>
              {saving ? (
                <>
                  <SpinnerIcon className="size-4" />
                  Saving…
                </>
              ) : "Save local environment"}
            </SectionActionButton>
          </div>
        ) : null}
      </div>

      {errorMessage ? (
        <div className="rounded-lg border border-(--red-text)/20 bg-(--red-text)/8 px-3 py-2 text-sm text-(--red-text)">
          {errorMessage}
        </div>
      ) : null}

      {mode === "workspace" ? (
        <div className="flex flex-col gap-3">
          {workspaceProjects.length === 0 ? (
            <div className="rounded-xl border border-dashed border-token-border p-5 text-sm text-token-text-secondary">
              No projects with a workspace path yet.
            </div>
          ) : (
            workspaceProjects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => {
                  void loadSnapshot(project.id, null);
                }}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-xl border border-token-border bg-token-input-background/50 px-4 py-3 text-left transition-colors",
                  "hover:bg-token-input-background",
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground-5 text-token-foreground">
                    <FolderCode className="size-4" />
                  </div>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="truncate text-sm font-medium text-token-foreground">{project.name}</div>
                    <div className="truncate text-sm text-token-text-secondary">
                      {project.workspacePath?.trim() || "No workspace path"}
                    </div>
                  </div>
                </div>
                <ChevronLeft className="size-4 rotate-180 text-token-text-secondary" />
              </button>
            ))
          )}
        </div>
      ) : null}

      {mode !== "workspace" && loading ? (
        <div className="flex items-center gap-2 rounded-xl border border-token-border bg-token-input-background/50 px-4 py-3 text-sm text-token-text-secondary">
          <SpinnerIcon className="size-4" />
          Loading local environment…
        </div>
      ) : null}

      {mode === "summary" && snapshot && !loading ? (
        <div className="flex flex-col gap-4">
          <SummarySection
            title="Local environment file"
            description="Choose a config file in this workspace or create a new one."
          >
            <div className="flex flex-wrap gap-2">
              {snapshot.configs.map((config) => {
                const isSelected = config.configPath === snapshot.configPath;
                return (
                  <button
                    key={config.configPath}
                    type="button"
                    onClick={() => {
                      if (!selectedProjectId) return;
                      void loadSnapshot(selectedProjectId, config.configPath);
                    }}
                    className={cn(
                      "flex min-w-0 max-w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
                      isSelected
                        ? "border-(--accent-blue) bg-(--accent-blue)/10 text-token-foreground"
                        : "border-token-border bg-token-input-background hover:bg-foreground-5",
                    )}
                  >
                    <ConfigStatusIcon className="size-4 shrink-0" />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm">{config.name}</span>
                      <span className="truncate text-xs text-token-text-secondary">
                        {config.fileName} · {describeConfigState(config)}
                      </span>
                    </div>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  if (!selectedProjectId) return;
                  void loadSnapshot(selectedProjectId, snapshot.nextConfigPath);
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-dashed border-token-border px-3 py-2 text-sm text-token-text-secondary transition-colors hover:bg-foreground-5 hover:text-token-foreground"
              >
                <Plus className="size-4" />
                New config
              </button>
            </div>

            <div className="text-sm text-token-text-secondary">
              File: <span className="font-mono text-token-foreground">{snapshot.configPath}</span>
            </div>

            {!snapshot.configExists ? (
              <div className="text-sm text-token-text-secondary">
                Save to create this file for the first time.
              </div>
            ) : null}
            {snapshot.parseErrorMessage ? (
              <div className="text-sm text-(--red-text)">
                Unable to parse the existing file. Saving will overwrite it. ({snapshot.parseErrorMessage})
              </div>
            ) : null}
            {snapshot.readErrorMessage ? (
              <div className="text-sm text-(--red-text)">
                Failed to load local environment data. ({snapshot.readErrorMessage})
              </div>
            ) : null}
          </SummarySection>

          <SummarySection
            title="Environment details"
            description="Structured view of the selected local environment."
          >
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
              <div className="flex flex-col gap-1">
                <div className="text-sm font-medium text-token-foreground">
                  {summaryEnvironment?.name ?? "local"}
                </div>
                <div className="text-sm text-token-text-secondary">
                  Version {summaryEnvironment?.version ?? 1}
                </div>
              </div>
              {activeConfigRecord ? (
                <div className="inline-flex items-center gap-1 rounded-full bg-foreground-5 px-2 py-1 text-xs text-token-text-secondary">
                  <LocalStatusIcon className="size-3.5" />
                  {describeConfigState(activeConfigRecord)}
                </div>
              ) : null}
            </div>
          </SummarySection>

          <SummarySection
            title="Setup script"
            description={
              summaryEnvironment
                ? scriptSectionSummary(summaryEnvironment, "setup")
              || "No setup script configured."
                : "No setup script configured."
            }
          >
            <MultiLineCodePreview
              script={summaryEnvironment?.setup.script ?? null}
              emptyLabel="No default setup script."
            />
            {summaryEnvironment && hasPlatformOverrides(summaryEnvironment, "setup") ? (
              <div className="flex flex-col gap-2">
                {PLATFORM_OPTIONS.map((platform) => {
                  const script = summaryEnvironment.setup.platformScripts[platform.value] ?? null;
                  if (!script) return null;
                  return (
                    <div key={platform.value} className="rounded-lg border border-token-border p-3">
                      <div className="mb-2 text-sm font-medium text-token-foreground">{platform.label}</div>
                      <MultiLineCodePreview script={script} emptyLabel="" />
                    </div>
                  );
                })}
              </div>
            ) : null}
          </SummarySection>

          <SummarySection
            title="Cleanup script"
            description={
              summaryEnvironment
                ? scriptSectionSummary(summaryEnvironment, "cleanup")
              || "No cleanup script configured."
                : "No cleanup script configured."
            }
          >
            <MultiLineCodePreview
              script={summaryEnvironment?.cleanup.script ?? null}
              emptyLabel="No default cleanup script."
            />
            {summaryEnvironment && hasPlatformOverrides(summaryEnvironment, "cleanup") ? (
              <div className="flex flex-col gap-2">
                {PLATFORM_OPTIONS.map((platform) => {
                  const script = summaryEnvironment.cleanup.platformScripts[platform.value] ?? null;
                  if (!script) return null;
                  return (
                    <div key={platform.value} className="rounded-lg border border-token-border p-3">
                      <div className="mb-2 text-sm font-medium text-token-foreground">{platform.label}</div>
                      <MultiLineCodePreview script={script} emptyLabel="" />
                    </div>
                  );
                })}
              </div>
            ) : null}
          </SummarySection>

          <SummarySection
            title="Actions"
            description="Reusable commands surfaced from this local environment."
          >
            {(summaryEnvironment?.actions.length ?? 0) === 0 ? (
              <div className="text-sm text-token-text-secondary">No actions configured.</div>
            ) : (
              <div className="flex flex-col gap-2">
                {(summaryEnvironment?.actions ?? []).map((action) => (
                  <div key={action.id} className="flex items-center gap-3 rounded-lg border border-token-border p-3">
                    <div className="inline-flex size-8 items-center justify-center rounded-lg bg-foreground-5 text-token-foreground">
                      <ActionIconPreview icon={action.icon} />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="truncate text-sm font-medium text-token-foreground">{action.name || "Untitled action"}</div>
                      <div className="truncate font-mono text-xs text-token-text-secondary">{action.command || "No command"}</div>
                    </div>
                    {action.platform ? (
                      <span className="rounded-full bg-foreground-5 px-2 py-1 text-xs text-token-text-secondary">
                        {PLATFORM_OPTIONS.find((option) => option.value === action.platform)?.label ?? action.platform}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </SummarySection>
        </div>
      ) : null}

      {mode === "edit" && draft && snapshot && !loading ? (
        <div className="flex flex-col gap-4">
          <SummarySection
            title="Local environment file"
            description="Save writes this structured environment config to disk."
          >
            <div className="text-sm text-token-text-secondary">
              File: <span className="font-mono text-token-foreground">{snapshot.configPath}</span>
            </div>
            {!snapshot.configExists ? (
              <div className="text-sm text-token-text-secondary">
                Saving will create this file.
              </div>
            ) : null}
          </SummarySection>

          <SummarySection
            title="Environment details"
            description="Name and top-level metadata for this local environment."
          >
            <FieldLabel
              title="Name"
              description="Shown in environment pickers and action menus."
            />
            <Input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              className="h-9 w-full rounded-lg border border-token-border bg-token-input-background px-3 text-sm text-token-foreground"
            />
          </SummarySection>

          <ScriptEditorSection
            title="Setup script"
            description="Runs on worktree creation."
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

          <ScriptEditorSection
            title="Cleanup script"
            description="Runs when the environment is cleaned up."
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
        </div>
      ) : null}
    </div>
  );
}
