import type { SettingsSearchContext } from "@/lib/settings-search";
import {
  CARD_STAGE_COLLAPSIBLE_PROPERTIES,
  CARD_STAGE_COLLAPSIBLE_PROPERTY_LABELS,
} from "../../lib/card-stage-collapsed-properties";
import { SIDEBAR_TOP_LEVEL_SECTION_LABELS } from "../../lib/sidebar-section-prefs";
import { DEFAULT_WORKTREE_AUTO_BRANCH_PREFIX } from "../../lib/worktree-branch-prefix";
import { FILE_LINK_OPENER_OPTIONS } from "../../../shared/file-link-openers";

export interface SettingsSearchCatalogSection {
  messages: readonly string[];
  searchTerms?: (context: SettingsSearchContext) => readonly string[];
}

interface SettingsSearchCatalogPanel {
  title: string;
  subtitle?: string;
  groups: readonly SettingsSearchCatalogGroup[];
  messages?: readonly string[];
}

interface SettingsSearchCatalogGroup {
  title: string;
  description?: string;
  entries?: readonly SettingsSearchCatalogEntry[];
  messages?: readonly string[];
}

interface SettingsSearchCatalogEntry {
  label: string;
  description?: string;
  terms?: readonly string[];
}

function entry(
  label: string,
  description?: string,
  terms: readonly string[] = [],
): SettingsSearchCatalogEntry {
  return { description, label, terms };
}

function uniqueText(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const texts: string[] = [];

  const collect = (value: unknown) => {
    if (typeof value === "string") {
      const text = value.trim();
      if (!text || seen.has(text)) return;
      seen.add(text);
      texts.push(text);
      return;
    }

    if (!Array.isArray(value)) return;

    for (const entry of value) {
      collect(entry);
    }
  };

  for (const value of values) {
    collect(value);
  }

  return texts;
}

function materializePanelSearchMessages(panel: SettingsSearchCatalogPanel): readonly string[] {
  const groups = panel.groups.flatMap((group) => [
    group.title,
    group.description,
    group.messages,
    group.entries?.flatMap((setting) => [
      setting.label,
      setting.description,
      setting.terms,
    ]),
  ]);

  return uniqueText([
    panel.title,
    panel.subtitle,
    panel.messages,
    groups,
  ]);
}

function projectNameTerms({ activeProjectName, projectNames }: SettingsSearchContext): readonly string[] {
  return uniqueText([
    projectNames,
    activeProjectName,
  ]);
}

const SETTINGS_SEARCH_PANELS = {
  "general-settings": {
    title: "General",
    subtitle: "App-wide shell behavior and notifications.",
    groups: [
      {
        title: "App",
        entries: [
          entry(
            "Restore windows",
            "Choose which workbench windows reopen after quitting Nodex.",
            ["All", "Last", "None", "quit", "reopen"],
          ),
          entry(
            "Desktop notifications",
            "Configure turn-complete, approval, and request-user-input notifications.",
            [
              "Turn complete",
              "Approval requests",
              "Questions",
              "Never",
              "Only when unfocused",
              "Always",
            ],
          ),
          entry(
            "Service tier",
            "Choose the default speed for new thread requests. Standard is the default; Fast opts into the faster tier.",
            ["Standard", "Fast"],
          ),
          entry(
            "App updates",
            "Packaged macOS builds can check, download, and install stable updates in the background.",
            ["check updates", "download updates", "install updates"],
          ),
          entry(
            "Diagnostics",
            "Optionally send crash diagnostics and masked session replays to Sentry. Prompts, transcripts, card text, and local payloads are scrubbed before upload.",
            ["crash diagnostics", "masked session replays", "Sentry", "scrubbed"],
          ),
          entry(
            "Telemetry",
            "Optionally send anonymous product events and filtered technical web analytics to Statsig. Prompts, transcripts, card text, and file paths are not sent.",
            ["anonymous product events", "technical web analytics", "Statsig"],
          ),
          entry(
            "Sidebar sections",
            "Choose which top-level sidebar sections stay visible. Hidden sections can be restored here.",
            Object.values(SIDEBAR_TOP_LEVEL_SECTION_LABELS),
          ),
        ],
      },
    ],
  },
  appearance: {
    title: "Appearance",
    subtitle: "Theme and typography tokens used across the app.",
    groups: [
      {
        title: "Theme",
        entries: [
          entry(
            "Theme",
            "Match system mode or force a fixed theme.",
            ["System", "Light", "Dark"],
          ),
          entry(
            "Sans font size",
            "Scales shared sans typography tokens and chat body text across the app.",
            ["Default", "font size", "sans typography"],
          ),
          entry(
            "Code font size",
            "Sets editor/code typography globally via --vscode-editor-font-size.",
            ["Default", "editor font size", "--vscode-editor-font-size"],
          ),
        ],
      },
    ],
  },
  agent: {
    title: "Agent",
    subtitle: "Permissions presets and raw config.toml settings.",
    groups: [
      {
        title: "Agent",
        messages: [
          "Open a project workspace to edit agent permissions.",
          "Could not load agent settings.",
          "Could not save permission mode.",
          "Could not save config setting.",
        ],
      },
      {
        title: "Permissions modes",
        entries: [
          entry(
            "Default permissions mode",
            "Choose the preset used for new local Codex threads.",
            [
              "Default permissions",
              "Auto-review",
              "Full access",
              "Custom (config.toml)",
              "guardian-approvals",
              "full-access",
              "custom",
              "sandbox",
              "elevated requests",
            ],
          ),
        ],
      },
      {
        title: "Custom config.toml settings",
        entries: [
          entry(
            "Approval policy",
            "Raw `approval_policy` value for this config target.",
            ["granular", "untrusted", "on-failure", "on-request", "never"],
          ),
          entry(
            "Sandbox settings",
            "Raw `sandbox_mode` value for this config target.",
            ["unset", "read-only", "workspace-write", "danger-full-access"],
          ),
          entry(
            "Allow network access",
            "Controls `sandbox_workspace_write.network_access`.",
            ["network_access", "sandbox workspace write"],
          ),
          entry(
            "config.toml",
            "No writable config target",
            ["Reveal", "writable config target", "configuration"],
          ),
        ],
      },
    ],
  },
  "keyboard-shortcuts": {
    title: "Keyboard shortcuts",
    groups: [
      {
        title: "Keyboard shortcuts",
        messages: [
          "Search keyboard shortcuts",
          "Search shortcuts",
          "Search by keystrokes",
          "Press shortcut",
          "Loading shortcuts...",
          "Could not load shortcuts.",
          "No matching shortcuts",
          "Command",
          "Keybinding",
          "Actions",
          "Change shortcut",
          "Set shortcut",
          "Clear shortcut",
          "Reset shortcut",
          "Reset all to defaults",
          "Reset all keyboard shortcuts?",
          "This will discard all custom shortcuts and restore the default keyboard shortcuts.",
          "Unassigned",
          "Conflict",
          "Command keybindings",
        ],
      },
    ],
  },
  editor: {
    title: "Editor",
    subtitle: "Thread detail, composer behavior, and editing defaults.",
    groups: [
      {
        title: "Thread composer",
        entries: [
          entry(
            "Thread detail",
            "Choose how much command output to show in threads.",
            [
              "Steps",
              "Steps with code commands",
              "Steps with code output",
              "Hide commands and outputs.",
              "Show commands, collapse output.",
              "Show commands and expand output.",
            ],
          ),
          entry("Spellcheck", "Inline text correction for editable writing surfaces."),
          entry(
            "Auto-link while typing",
            "Turn typed URLs into links as you finish the token.",
          ),
          entry(
            "Auto-link on paste",
            "Recognize links in pasted text, including inline URL spans inside longer content.",
          ),
          entry(
            "Recognize bare domains",
            "Link plain domains like example.com. Leave off to avoid filename-like text such as .md paths.",
          ),
          entry(
            "Large paste text threshold",
            "Prompt when pasted plain text reaches this many characters, so you can materialize it instead of inflating the note.",
            ["Paste resource text threshold"],
          ),
          entry(
            "Large paste description soft limit",
            "Prompt before pasted plain text pushes the note near its description size ceiling.",
            ["Paste resource description soft limit"],
          ),
          entry(
            "Markdown file links",
            "Choose which desktop app handles absolute local file links in rendered markdown.",
            [
              "Open markdown file links in",
              ...FILE_LINK_OPENER_OPTIONS.map((option) => option.label),
            ],
          ),
          entry(
            "Smart parse block prefixes",
            "Interpret shorthand like 1XL(tag) during block-to-card import.",
          ),
          entry(
            "Strip parsed prefix from title",
            "Remove matched shorthand from imported card titles after parsing.",
          ),
          entry(
            "Cmd+Enter to send long prompts",
            "Single-line prompts still send on Enter. Multiline prompts switch to the modifier chord when this is enabled.",
            ["Ctrl+Enter to send long prompts", "modifier chord"],
          ),
          entry(
            "Queue follow-ups",
            "While a thread is running, use queue as the default submit action instead of immediate steering.",
          ),
        ],
      },
    ],
  },
  card: {
    title: "Card",
    subtitle: "Kanban card and card-stage presentation.",
    groups: [
      {
        title: "Cards",
        entries: [
          entry(
            "Kanban card properties",
            "Choose whether priority, estimate, tags, assignee, and run-in metadata render above the title, inline with it, or below the card body.",
            ["Top", "Inline", "Bottom"],
          ),
          entry(
            "Card stage collapsed properties",
            "Choose which card-stage property rows start behind the more-properties toggle.",
            CARD_STAGE_COLLAPSIBLE_PROPERTIES.map(
              (property) => CARD_STAGE_COLLAPSIBLE_PROPERTY_LABELS[property],
            ),
          ),
        ],
      },
    ],
  },
  worktrees: {
    title: "Worktrees",
    subtitle: "Managed worktree creation, naming, and cleanup.",
    groups: [
      {
        title: "Defaults",
        entries: [
          entry(
            "Worktree start mode",
            "Choose whether new worktree threads auto-create a branch or start detached.",
            ["Auto branch", "Detached HEAD"],
          ),
          entry(
            "Auto branch prefix",
            "Prefix prepended to auto branch names before the thread slug.",
            [DEFAULT_WORKTREE_AUTO_BRANCH_PREFIX],
          ),
        ],
      },
      {
        title: "Managed worktrees",
        description: "Worktrees created by card threads. Hover a row to remove.",
        messages: [
          "Git",
          "Branch",
          "Managed directory",
          "Cleanup",
          "Remove worktree record",
        ],
      },
    ],
  },
  "local-environments": {
    title: "Local environments",
    subtitle: "Local environments tell Codex how to set up worktrees for a project. Learn more.",
    groups: [
      {
        title: "Select a project",
        messages: [
          "Add project",
          "No projects yet. Add one to configure local environments.",
          "Available projects",
          "Loading local environments",
          "Fetching your project configuration.",
        ],
      },
      {
        title: "Project",
        messages: [
          "No source folder",
          "No local environment is configured for this project yet.",
        ],
      },
      {
        title: "Environment details",
        entries: [
          entry("Name"),
          entry(
            "Setup script",
            "This script will run on worktree creation.",
            [
              "Runs in the project root.",
              "No setup script configured.",
              "Setup script environment variables",
              "Source workspace path",
              "New worktree path",
              "CODEX_SOURCE_TREE_PATH",
              "CODEX_WORKTREE_PATH",
              "Add macOS setup script",
              "Add Linux setup script",
              "Add Windows setup script",
            ],
          ),
          entry(
            "Cleanup script",
            "This script will run before a worktree is deleted.",
            [
              "Runs in the project root just before cleanup.",
              "No cleanup script configured.",
              "Add macOS cleanup script",
              "Add Linux cleanup script",
              "Add Windows cleanup script",
            ],
          ),
          entry(
            "Platform overrides",
            "Overrides the default script for specific OSes.",
            ["Overrides the default cleanup script for specific OSes.", "macOS", "Linux", "Windows"],
          ),
        ],
      },
      {
        title: "Local environment file",
        messages: [
          "File:",
          "Save to create this file for the first time.",
          "Unable to parse the existing file. Saving will overwrite it.",
          "Failed to load local environment data.",
          ".codex/environments",
          "environment.toml",
        ],
      },
      {
        title: "Actions",
        description: "These actions can run any command and will be displayed in the header.",
        messages: [
          "Add action",
          "Add an action to run commands from the local toolbar.",
          "Delete action",
          "Edit local environment",
          "Create local environment",
          "Save local environment",
        ],
      },
    ],
  },
  backups: {
    title: "Backups",
    subtitle: "Snapshot cadence, retention, and restore operations.",
    groups: [
      {
        title: "Automatic snapshots",
        entries: [
          entry("Auto backups", "Schedule background snapshots for the local store."),
          entry("Frequency", "Minimum is one hour.", ["hours"]),
          entry("Retention", "Snapshots kept before pruning.", ["max"]),
        ],
        messages: [
          "Some values locked by env vars.",
          "Refresh",
          "Save schedule",
        ],
      },
      {
        title: "History retention",
        entries: [
          entry(
            "History retention",
            "Per-project history rows kept before pruning. Use 0 for unlimited.",
            ["rows"],
          ),
        ],
        messages: [
          "Value locked by env var.",
          "Applied on future writes.",
          "Apply",
        ],
      },
      {
        title: "Snapshots",
        entries: [
          entry(
            "Safety backup",
            "Create a fresh snapshot before restoring an older one.",
          ),
        ],
        messages: [
          "Optional snapshot label",
          "Create snapshot",
          "No snapshots yet.",
          "Manual",
          "Auto",
          "Safety",
          "Confirm restore",
          "Restore",
          "Confirm delete",
          "Cancel",
          "Delete snapshot",
          "Snapshot deleted.",
          "Backup restored.",
        ],
      },
    ],
  },
} satisfies Record<string, SettingsSearchCatalogPanel>;

export const SETTINGS_SEARCH_CATALOG = {
  "general-settings": {
    messages: materializePanelSearchMessages(SETTINGS_SEARCH_PANELS["general-settings"]),
  },
  appearance: {
    messages: materializePanelSearchMessages(SETTINGS_SEARCH_PANELS.appearance),
  },
  agent: {
    messages: materializePanelSearchMessages(SETTINGS_SEARCH_PANELS.agent),
    searchTerms: ({ activeProjectName }: SettingsSearchContext) =>
      activeProjectName ? [activeProjectName] : [],
  },
  "keyboard-shortcuts": {
    messages: materializePanelSearchMessages(SETTINGS_SEARCH_PANELS["keyboard-shortcuts"]),
  },
  editor: {
    messages: materializePanelSearchMessages(SETTINGS_SEARCH_PANELS.editor),
  },
  card: {
    messages: materializePanelSearchMessages(SETTINGS_SEARCH_PANELS.card),
  },
  worktrees: {
    messages: materializePanelSearchMessages(SETTINGS_SEARCH_PANELS.worktrees),
  },
  "local-environments": {
    messages: materializePanelSearchMessages(SETTINGS_SEARCH_PANELS["local-environments"]),
    searchTerms: projectNameTerms,
  },
  backups: {
    messages: materializePanelSearchMessages(SETTINGS_SEARCH_PANELS.backups),
  },
} satisfies Record<string, SettingsSearchCatalogSection>;
