import type { CommandKeymapState } from "../../shared/command-keybindings";
import {
  createCommandKeymapState,
  formatCommandShortcutLabel,
} from "../../shared/command-keybindings";
import {
  NAVIGATE_BACK_COMMAND_ID,
  NAVIGATE_FORWARD_COMMAND_ID,
  RENAME_THREAD_COMMAND_ID,
  TOGGLE_SIDEBAR_COMMAND_ID,
} from "../../shared/window-navigation";
import type { CommandPaletteCommand, CommandPaletteCommandGroup } from "./command-palette";

export const OPEN_DB_VIEW_TAB_COMMAND_ID = "openDbViewTab";

export type CommandPaletteShellCommandId =
  | typeof NAVIGATE_BACK_COMMAND_ID
  | typeof NAVIGATE_FORWARD_COMMAND_ID
  | "newThread"
  | "newThreadInProject"
  | typeof RENAME_THREAD_COMMAND_ID
  | "archiveThread"
  | "toggleThreadPin"
  | "openThreadInNewWindow"
  | typeof TOGGLE_SIDEBAR_COMMAND_ID
  | "toggleSidePanel"
  | "toggleBottomPanel"
  | "toggleFileTreePanel"
  | "openBrowserTab"
  | "openReviewTab"
  | "toggleTerminal"
  | typeof OPEN_DB_VIEW_TAB_COMMAND_ID
  | "openSideChat"
  | "settings"
  | "showKeyboardShortcuts";

export type CommandPaletteShellCommandHandlers = Record<CommandPaletteShellCommandId, () => void>;

export interface CommandPaletteShellCommandContext {
  canGoBack: boolean;
  canGoForward: boolean;
  canStartNewChat: boolean;
  hasActiveSession: boolean;
  activeSessionIsOverview: boolean;
  activeSessionPinned: boolean;
  hasAttachedThread: boolean;
  canOpenSessionInNewWindow: boolean;
  isMac: boolean;
  commandKeymapState?: CommandKeymapState | null;
}

function fallbackCommandKeymapState(isMac: boolean): CommandKeymapState {
  return createCommandKeymapState({}, isMac ? "macOS" : "windows");
}

export function isCommandPaletteShellCommandId(id: string): id is CommandPaletteShellCommandId {
  return id === NAVIGATE_BACK_COMMAND_ID
    || id === NAVIGATE_FORWARD_COMMAND_ID
    || id === "newThread"
    || id === "newThreadInProject"
    || id === RENAME_THREAD_COMMAND_ID
    || id === "archiveThread"
    || id === "toggleThreadPin"
    || id === "openThreadInNewWindow"
    || id === TOGGLE_SIDEBAR_COMMAND_ID
    || id === "toggleSidePanel"
    || id === "toggleBottomPanel"
    || id === "toggleFileTreePanel"
    || id === "openBrowserTab"
    || id === "openReviewTab"
    || id === "toggleTerminal"
    || id === OPEN_DB_VIEW_TAB_COMMAND_ID
    || id === "openSideChat"
    || id === "settings"
    || id === "showKeyboardShortcuts";
}

export function executeCommandPaletteShellCommand(
  commandId: CommandPaletteShellCommandId,
  handlers: CommandPaletteShellCommandHandlers,
): void {
  handlers[commandId]();
}

export function buildCommandPaletteCommands(
  context: CommandPaletteShellCommandContext,
): CommandPaletteCommand[] {
  const shortcutState = context.commandKeymapState ?? fallbackCommandKeymapState(context.isMac);
  const shortcutLabel = (commandId: string, fallback?: string): string | undefined =>
    formatCommandShortcutLabel(shortcutState, commandId, fallback);
  const sessionCommandDisabled = !context.hasActiveSession || context.activeSessionIsOverview;
  const panelCommandDisabled = !context.hasActiveSession;
  const sideChatDisabled = !context.hasActiveSession || !context.hasAttachedThread;
  const command = (
    id: string,
    group: CommandPaletteCommandGroup,
    title: string,
    subtitle: string,
    keywords: string[],
    priority: number,
    options: {
      shortcut?: string;
      active?: boolean;
      disabled?: boolean;
      mockReason?: string;
    } = {},
  ): CommandPaletteCommand => ({
    kind: "command",
    id,
    group,
    title,
    subtitle,
    keywords,
    priority,
    shortcut: options.shortcut,
    active: options.active,
    disabled: options.disabled,
    mockReason: options.mockReason,
  });
  const mockCommand = (
    id: string,
    group: CommandPaletteCommandGroup,
    title: string,
    subtitle: string,
    keywords: string[],
    priority: number,
    shortcut?: string,
  ): CommandPaletteCommand => command(id, group, title, subtitle, keywords, priority, {
    shortcut,
    disabled: true,
    mockReason: "Not available in Nodex yet.",
  });

  return [
    command("searchChats", "Suggested", "Search chats", "Search chats by title, project, path, and content", ["search", "chat", "thread"], 1200, {
      shortcut: shortcutLabel("searchChats", "CmdOrCtrl+G"),
    }),
    command("searchCards", "Suggested", "Search cards", "Search cards with Nodex card filters", ["search", "card", "kanban", "task"], 1190, {
      shortcut: shortcutLabel("searchCards", "CmdOrCtrl+P"),
    }),
    mockCommand("searchFiles", "Suggested", "Search files", "Search workspace files", ["search", "file", "workspace"], 1180, shortcutLabel("searchFiles")),
    command("newThread", "Chat", "New chat", "Start a new chat in the active project", ["new", "chat", "thread", "session"], 1120, {
      shortcut: shortcutLabel("newThread", "CmdOrCtrl+N"),
      disabled: !context.canStartNewChat,
    }),
    mockCommand("quickChat", "Chat", "New quick chat", "Start a quick chat", ["new", "quick", "chat"], 1110, shortcutLabel("quickChat", "CmdOrCtrl+Alt+N")),
    command("openThreadInNewWindow", "Chat", "Open chat in new window", "Open the active chat in another Nodex window", ["open", "chat", "thread", "session", "window"], 1100, {
      shortcut: shortcutLabel("openThreadInNewWindow"),
      disabled: sessionCommandDisabled || !context.canOpenSessionInNewWindow,
    }),
    command(RENAME_THREAD_COMMAND_ID, "Chat", "Rename chat", "Rename the active chat", ["rename", "chat", "thread", "session", "title"], 1090, {
      shortcut: shortcutLabel("renameThread", "CmdOrCtrl+Alt+R"),
      disabled: sessionCommandDisabled,
    }),
    command("archiveThread", "Chat", "Archive chat", "Archive the active chat", ["archive", "chat", "thread", "session"], 1080, {
      shortcut: shortcutLabel("archiveThread", "CmdOrCtrl+Shift+A"),
      disabled: sessionCommandDisabled,
    }),
    command("toggleThreadPin", "Chat", context.activeSessionPinned ? "Unpin chat" : "Pin chat", context.activeSessionPinned ? "Remove the active chat from pinned" : "Pin the active chat", ["pin", "unpin", "chat", "thread", "session"], 1070, {
      shortcut: shortcutLabel("toggleThreadPin", "CmdOrCtrl+Alt+P"),
      active: context.activeSessionPinned,
      disabled: sessionCommandDisabled,
    }),
    command("openSideChat", "Chat", "Open side chat", "Start a side chat for the active chat", ["side", "chat", "thread", "panel", "tab"], 1060, {
      shortcut: shortcutLabel("openSideChat", "CmdOrCtrl+Alt+S"),
      disabled: sideChatDisabled,
    }),
    mockCommand("previousThread", "Navigation", "Previous chat", "Move to the previous chat", ["previous", "chat", "navigation"], 1040),
    mockCommand("nextThread", "Navigation", "Next chat", "Move to the next chat", ["next", "chat", "navigation"], 1030),
    command(NAVIGATE_BACK_COMMAND_ID, "Navigation", "Back", "Return to the previous workbench context", ["back", "previous", "history", "navigation"], 1020, {
      shortcut: shortcutLabel("navigateBack", "CmdOrCtrl+["),
      disabled: !context.canGoBack,
    }),
    command(NAVIGATE_FORWARD_COMMAND_ID, "Navigation", "Forward", "Move to the next workbench context", ["forward", "next", "history", "navigation"], 1010, {
      shortcut: shortcutLabel("navigateForward", "CmdOrCtrl+]"),
      disabled: !context.canGoForward,
    }),
    mockCommand("findInThread", "Navigation", "Find in chat", "Find in the current chat", ["find", "search", "chat"], 1000, shortcutLabel("findInThread", "CmdOrCtrl+F")),
    mockCommand("focusBrowserAddressBar", "Navigation", "Focus browser address bar", "Focus the active Browser tab address bar", ["browser", "address", "url"], 990, shortcutLabel("focusBrowserAddressBar", "CmdOrCtrl+L")),
    mockCommand("switchMode1", "Navigation", "Switch mode 1", "Switch to the first reference app mode", ["switch", "mode"], 980),
    mockCommand("switchMode2", "Navigation", "Switch mode 2", "Switch to the second reference app mode", ["switch", "mode"], 970),
    command(TOGGLE_SIDEBAR_COMMAND_ID, "Panels", "Toggle sidebar", "Show or hide the project sidebar", ["sidebar", "project", "shell"], 940, {
      shortcut: shortcutLabel("toggleSidebar", "CmdOrCtrl+B"),
    }),
    command("toggleSidePanel", "Panels", "Toggle side panel", "Show or hide the right panel", ["side", "right", "panel", "shell"], 930, {
      shortcut: shortcutLabel("toggleSidePanel", "CmdOrCtrl+Alt+B"),
      disabled: panelCommandDisabled,
    }),
    command("toggleBottomPanel", "Panels", "Toggle bottom panel", "Show or hide the bottom panel", ["bottom", "panel", "shell"], 920, {
      shortcut: shortcutLabel("toggleBottomPanel", "CmdOrCtrl+J"),
      disabled: panelCommandDisabled,
    }),
    command("toggleFileTreePanel", "Panels", "Toggle file tree", "Open project files in the active panel", ["files", "file", "tree", "panel", "tab"], 910, {
      shortcut: shortcutLabel("toggleFileTreePanel", "CmdOrCtrl+Shift+E"),
      disabled: panelCommandDisabled,
    }),
    command("openBrowserTab", "Panels", "Open browser tab", "Open a Browser tab in the active panel", ["browser", "web", "panel", "tab"], 900, {
      shortcut: shortcutLabel("openBrowserTab", "CmdOrCtrl+T"),
      disabled: panelCommandDisabled,
    }),
    mockCommand("toggleBrowserPanel", "Panels", "Toggle browser panel", "Show or hide the Browser panel", ["browser", "panel"], 890, shortcutLabel("toggleBrowserPanel", "CmdOrCtrl+Shift+B")),
    command("openReviewTab", "Panels", "Open review tab", "Open or focus code review in the active panel", ["review", "diff", "changes", "git", "panel", "tab"], 880, {
      shortcut: shortcutLabel("openReviewTab", "Ctrl+Shift+G"),
      disabled: panelCommandDisabled,
    }),
    command("toggleTerminal", "Panels", "Open terminal", "Focus or create a terminal tab", ["terminal", "shell", "panel", "tab"], 870, {
      shortcut: shortcutLabel("toggleTerminal", "Ctrl+`"),
      disabled: panelCommandDisabled,
    }),
    command(OPEN_DB_VIEW_TAB_COMMAND_ID, "Panels", "Open DB View tab", "Open the active project database in the right panel", ["db", "database", "view", "board", "kanban", "panel", "tab"], 860, {
      disabled: panelCommandDisabled,
    }),
    mockCommand("openCardStage", "Panels", "Open Card Stage", "Open a Nodex card stage from the command menu", ["card", "stage", "db", "picker"], 850),
    command("newThreadInProject", "Project", "New chat in project", "Start a new chat in the active project", ["new", "chat", "project"], 830, {
      disabled: !context.canStartNewChat,
    }),
    mockCommand("switchProject", "Project", "Switch project", "Switch to another project", ["switch", "project", "workspace"], 820),
    mockCommand("openFolder", "Project", "Open folder", "Open a local folder", ["open", "folder", "project"], 810, shortcutLabel("openFolder", "CmdOrCtrl+O")),
    ...Array.from({ length: 9 }, (_, index) =>
      mockCommand(
        `environmentAction${index + 1}`,
        "Project",
        `Environment action ${index + 1}`,
        "Run a configured project environment action",
        ["environment", "action", "project"],
        800 - index,
      )
    ),
    mockCommand("git.commit", "Project", "Git commit", "Commit project changes", ["git", "commit", "changes"], 780),
    mockCommand("git.push", "Project", "Git push", "Push project changes", ["git", "push", "changes"], 770),
    mockCommand("git.createPullRequest", "Project", "Create pull request", "Create a pull request for project changes", ["git", "pull", "request", "pr"], 760),
    command("settings", "Configure", "Settings", "Adjust app, editor, and worktree preferences", ["settings", "preferences", "config"], 740, {
      shortcut: shortcutLabel("settings", "CmdOrCtrl+,"),
    }),
    mockCommand("mcpSettings", "Configure", "MCP settings", "Open MCP server settings", ["mcp", "settings", "tools"], 730),
    mockCommand("personalitySettings", "Configure", "Personality settings", "Open assistant personality settings", ["personality", "settings"], 720),
    command("showKeyboardShortcuts", "Configure", "Keyboard shortcuts", "Open keyboard shortcut settings", ["keyboard", "shortcuts", "hotkeys", "settings"], 710, {
      shortcut: shortcutLabel("showKeyboardShortcuts", "CmdOrCtrl+Shift+/"),
    }),
    mockCommand("installPrimaryRuntime", "Configure", "Install Codex Workspace", "Install the primary Codex workspace runtime", ["install", "workspace", "runtime"], 700),
    mockCommand("switchTheme", "Configure", "Switch theme", "Switch between light and dark theme", ["theme", "appearance", "light", "dark"], 690),
    mockCommand("themePreset", "Configure", "Theme presets", "Choose a theme preset", ["theme", "preset", "appearance"], 680),
    mockCommand("openSkills", "Skills", "Go to skills", "Open the skills surface", ["skills", "plugins"], 660),
    mockCommand("forceReloadSkills", "Skills", "Force reload skills", "Reload installed skills", ["skills", "reload"], 650),
    mockCommand("manageTasks", "App", "Manage automations", "Open automation management", ["automation", "tasks", "manage"], 630),
    mockCommand("openProcessManager", "App", "Process Manager", "Open the process manager", ["process", "manager"], 620, shortcutLabel("openProcessManager", "Ctrl+Alt+M")),
    mockCommand("openControlWindow", "App", "Open control window", "Open the control window", ["control", "window"], 610),
    mockCommand("logOut", "App", "Log out", "Log out of Codex account", ["logout", "account"], 600),
    mockCommand("feedback", "App", "Feedback", "Send feedback", ["feedback", "support"], 590),
    mockCommand("openAvatarOverlay", "App", "Wake Pet", "Wake the Codex pet", ["pet", "avatar"], 580),
    mockCommand("tuckAwayPetOverlay", "App", "Tuck Away Pet", "Hide the Codex pet", ["pet", "avatar"], 570),
  ];
}
