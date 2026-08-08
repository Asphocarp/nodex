export const COMMAND_KEYMAP_VERSION = 1;
export const COMMAND_KEYBINDINGS_CHANGED_CHANNEL = "command-keybindings:changed";
export const PREVIOUS_PANEL_TAB_COMMAND_ID = "previousPanelTab";
export const NEXT_PANEL_TAB_COMMAND_ID = "nextPanelTab";

export type RuntimePlatform = "macOS" | "windows" | "linux";
export type CommandShortcutScope = "app" | "electron" | "os-global" | "webview";

export interface CommandKeybindingRecord {
  key: string | null;
}

export type CommandKeybindingUpdate =
  | { type: "set"; keybinding: CommandKeybindingRecord }
  | {
      type: "replace";
      oldKeybinding: CommandKeybindingRecord;
      newKeybinding: CommandKeybindingRecord;
    }
  | { type: "append"; keybinding: CommandKeybindingRecord }
  | { type: "remove"; keybinding: CommandKeybindingRecord }
  | { type: "reset" };

export interface CommandRegistryEntry {
  id: string;
  title: string;
  description: string;
  order: number;
  shortcutScope: CommandShortcutScope;
  defaultKeybindings: CommandKeybindingRecord[];
  allowsMultiple?: boolean;
  allowsBareModifiers?: boolean;
  allowsSequences?: boolean;
  available: boolean;
  commandMenuGroupKey?: string;
}

export interface CommandKeymapEntry extends CommandRegistryEntry {
  keybindings: CommandKeybindingRecord[];
  customKeybindings: CommandKeybindingRecord[] | null;
  isCustom: boolean;
  hasDefault: boolean;
}

export interface CommandKeymapState {
  version: typeof COMMAND_KEYMAP_VERSION;
  platform: RuntimePlatform;
  entries: CommandKeymapEntry[];
  hasCustomBindings: boolean;
}

export type CommandKeybindingOverrides = Record<string, string[]>;

interface ParsedChord {
  modifiers: string[];
  key: string | null;
}

export interface KeyboardShortcutEventLike {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export interface MouseShortcutEventLike {
  button: number;
}

const MODIFIER_ALIASES = new Map<string, string>([
  ["cmdorctrl", "CmdOrCtrl"],
  ["commandorcontrol", "CmdOrCtrl"],
  ["cmd", "Command"],
  ["command", "Command"],
  ["meta", "Command"],
  ["super", "Command"],
  ["control", "Ctrl"],
  ["ctrl", "Ctrl"],
  ["option", "Alt"],
  ["alt", "Alt"],
  ["shift", "Shift"],
]);

const MODIFIER_ORDER = ["CmdOrCtrl", "Command", "Ctrl", "Alt", "Shift"];
const MODIFIER_SET = new Set(MODIFIER_ORDER);

const KEY_ALIASES = new Map<string, string>([
  ["esc", "Escape"],
  ["escape", "Escape"],
  ["return", "Enter"],
  ["enter", "Enter"],
  ["space", "Space"],
  ["spacebar", "Space"],
  ["backspace", "Backspace"],
  ["delete", "Delete"],
  ["del", "Delete"],
  ["tab", "Tab"],
  ["up", "Up"],
  ["arrowup", "Up"],
  ["down", "Down"],
  ["arrowdown", "Down"],
  ["left", "Left"],
  ["arrowleft", "Left"],
  ["right", "Right"],
  ["arrowright", "Right"],
  ["pageup", "PageUp"],
  ["pagedown", "PageDown"],
  ["home", "Home"],
  ["end", "End"],
  ["backquote", "`"],
  ["grave", "`"],
  ["comma", ","],
  ["period", "."],
  ["slash", "/"],
  ["backslash", "\\"],
  ["bracketleft", "["],
  ["bracketright", "]"],
  ["minus", "-"],
  ["equal", "="],
  ["plus", "+"],
  ["mouseback", "MouseBack"],
  ["mouseforward", "MouseForward"],
]);

export const CODEX_COMMAND_REGISTRY = [
  command("archiveThread", "Archive chat", "Archive the current chat", 10, "app", ["CmdOrCtrl+Shift+A"]),
  command("copyConversationMarkdown", "Copy as Markdown", "Copy the complete current chat as Markdown", 15, "app", []),
  command("newThread", "New chat", "Start a new chat", 20, "app", ["CmdOrCtrl+N", "CmdOrCtrl+Shift+O"], {
    allowsMultiple: true,
  }),
  command("openSideChat", "Open side chat", "Open a side chat for the current chat", 30, "app", ["CmdOrCtrl+Alt+S"]),
  command("openThreadInNewWindow", "Open chat in new window", "Open the current chat in a new window", 40, "app", []),
  command("quickChat", "New quick chat", "Start a quick chat", 50, "app", ["CmdOrCtrl+Alt+N"]),
  command("toggleThreadPin", "Toggle pin", "Pin or unpin the current chat", 60, "app", ["CmdOrCtrl+Alt+P"]),
  command("findInThread", "Find", "Find in the current chat, review, or project view", 70, "app", ["CmdOrCtrl+F"]),
  command(
    "focusBrowserAddressBar",
    "Focus browser address bar",
    "Focus the active Browser tab address bar",
    80,
    "app",
    ["CmdOrCtrl+L"],
  ),
  command("navigateBack", "Back", "Go back in the app window history", 90, "app", ["CmdOrCtrl+[", "MouseBack"], {
    allowsMultiple: true,
  }),
  command("navigateForward", "Forward", "Go forward in the app window history", 100, "app", ["CmdOrCtrl+]", "MouseForward"], {
    allowsMultiple: true,
  }),
  command("toggleBottomPanel", "Toggle bottom panel", "Show or hide the bottom panel", 120, "app", ["CmdOrCtrl+J"]),
  command(PREVIOUS_PANEL_TAB_COMMAND_ID, "Previous panel tab", "Select the previous tab in the focused panel group", 121, "app", ["CmdOrCtrl+Shift+["]),
  command(NEXT_PANEL_TAB_COMMAND_ID, "Next panel tab", "Select the next tab in the focused panel group", 122, "app", ["CmdOrCtrl+Shift+]"]),
  command("toggleBrowserPanel", "Toggle browser panel", "Show or hide the Browser panel", 130, "app", ["CmdOrCtrl+Shift+B"], {
    available: false,
  }),
  command("openBrowserTab", "New browser tab", "Open a Browser tab in the active panel", 140, "app", ["CmdOrCtrl+T"]),
  command("openReviewTab", "Open review tab", "Open a Review tab in the active panel", 150, "app", ["Ctrl+Shift+G"]),
  command("toggleTerminal", "Open terminal tab", "Focus or create a terminal tab", 160, "app", ["Ctrl+`"]),
  command("toggleSidebar", "Toggle sidebar", "Show or hide the sidebar", 170, "app", ["CmdOrCtrl+B"]),
  command("toggleSidePanel", "Toggle side panel", "Show or hide the side panel", 180, "app", ["CmdOrCtrl+Alt+B"]),
  command("toggleFileTreePanel", "Toggle file tree panel", "Open the Files panel", 190, "app", ["CmdOrCtrl+Shift+E"]),
  command("searchChats", "Search chats", "Search chats in the command palette", 200, "app", ["CmdOrCtrl+G"]),
  command("searchPages", "Search Pages", "Search Pages in the command palette", 210, "app", ["CmdOrCtrl+P"]),
  command("createPage", "Create Page", "Create a Page in the active Project Board", 212, "app", ["CmdOrCtrl+Shift+C"]),
  command("searchFiles", "Search files", "Search files in the command palette", 215, "app", [], {
    available: false,
  }),
  command("openCommandMenu", "Open command palette", "Open the command palette", 220, "app", ["CmdOrCtrl+K", "CmdOrCtrl+Shift+P"], {
    allowsMultiple: true,
  }),
  command("settings", "Settings", "Open settings", 230, "app", ["CmdOrCtrl+,"]),
  command("showKeyboardShortcuts", "Keyboard shortcuts", "Open the keyboard shortcuts settings", 240, "app", ["CmdOrCtrl+Shift+/"]),
  command("renameThread", "Rename chat", "Rename the active chat", 250, "app", ["CmdOrCtrl+Alt+R"]),
  command("closeTab", "Close tab", "Close the focused panel tab", 260, "app", ["CmdOrCtrl+W"]),
  command("closeWindow", "Close window", "Close the active app window", 270, "electron", ["CmdOrCtrl+Shift+W"]),
  command("newWindow", "New window", "Open a new app window", 280, "electron", ["CmdOrCtrl+Shift+N"]),
  command("openFolder", "Open folder", "Open a local folder", 290, "electron", ["CmdOrCtrl+O"], { available: false }),
  command("openProcessManager", "Open process manager", "Open the process manager", 300, "electron", ["Ctrl+Alt+M"]),
  command("hotkeyWindow", "Hotkey window", "Show the global hotkey window", 310, "os-global", [], {
    available: false,
  }),
  command("globalDictationHold", "Hold to dictate", "Hold the global dictation hotkey", 320, "os-global", [], {
    available: false,
    allowsBareModifiers: true,
  }),
  command("globalDictationToggle", "Toggle dictation", "Toggle global dictation", 330, "os-global", [], {
    available: false,
    allowsBareModifiers: true,
  }),
] as const satisfies readonly CommandRegistryEntry[];

export type CommandId = (typeof CODEX_COMMAND_REGISTRY)[number]["id"];

function command<const Id extends string>(
  id: Id,
  title: string,
  description: string,
  order: number,
  shortcutScope: CommandShortcutScope,
  defaultKeys: string[],
  options: Partial<Omit<CommandRegistryEntry, "id" | "title" | "description" | "order" | "shortcutScope" | "defaultKeybindings">> = {},
): CommandRegistryEntry & { id: Id } {
  return {
    id,
    title,
    description,
    order,
    shortcutScope,
    defaultKeybindings: defaultKeys.map((key) => ({ key: normalizeAccelerator(key) })),
    allowsMultiple: options.allowsMultiple ?? defaultKeys.length > 1,
    allowsBareModifiers: options.allowsBareModifiers ?? false,
    allowsSequences: options.allowsSequences ?? false,
    available: options.available ?? true,
    commandMenuGroupKey: options.commandMenuGroupKey,
  };
}

export function resolveRuntimePlatform(nodePlatform = process.platform): RuntimePlatform {
  if (nodePlatform === "darwin") return "macOS";
  if (nodePlatform === "win32") return "windows";
  return "linux";
}

export function normalizeCommandKeybindingOverrides(value: unknown): CommandKeybindingOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value as Record<string, unknown>).reduce<CommandKeybindingOverrides>((acc, [commandId, rawKeys]) => {
    if (!Array.isArray(rawKeys)) return acc;
    const normalized = rawKeys
      .filter((rawKey): rawKey is string => typeof rawKey === "string")
      .map((rawKey) => normalizeAccelerator(rawKey))
      .filter((key) => key.length > 0);
    acc[commandId] = normalized;
    return acc;
  }, {});
}

export function createCommandKeymapState(
  overrides: CommandKeybindingOverrides = {},
  platform: RuntimePlatform = resolveRuntimePlatform(),
): CommandKeymapState {
  const entries = CODEX_COMMAND_REGISTRY
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((entry) => {
      const override = Object.prototype.hasOwnProperty.call(overrides, entry.id)
        ? (overrides[entry.id] ?? [])
        : null;
      const customKeybindings = override === null
        ? null
        : override.map((key) => ({ key: normalizeAccelerator(key) }));
      const keybindings = customKeybindings ?? entry.defaultKeybindings;

      return {
        ...entry,
        defaultKeybindings: entry.defaultKeybindings.map(cloneKeybinding),
        keybindings: keybindings.map(cloneKeybinding),
        customKeybindings: customKeybindings?.map(cloneKeybinding) ?? null,
        isCustom: customKeybindings !== null,
        hasDefault: entry.defaultKeybindings.length > 0,
      };
    });

  return {
    version: COMMAND_KEYMAP_VERSION,
    platform,
    entries,
    hasCustomBindings: Object.keys(overrides).length > 0,
  };
}

export function applyCommandKeybindingUpdate(
  overrides: CommandKeybindingOverrides,
  commandId: string,
  update: CommandKeybindingUpdate,
  platform: RuntimePlatform = resolveRuntimePlatform(),
): CommandKeybindingOverrides {
  const entry = CODEX_COMMAND_REGISTRY.find((candidate) => candidate.id === commandId);
  if (!entry) {
    throw new Error(`Unknown command id: ${commandId}`);
  }
  if (update.type === "reset") {
    return omitOverride(overrides, commandId);
  }
  if (entry.shortcutScope === "os-global" && update.type === "append") {
    throw new Error("OS-global command shortcuts cannot be appended");
  }

  const current = Object.prototype.hasOwnProperty.call(overrides, commandId)
    ? (overrides[commandId] ?? [])
    : entry.defaultKeybindings.map((binding) => binding.key).filter(isString);
  const nextKeys = resolveNextOverrideKeys(current, entry, update);
  validateCommandKeybindings(nextKeys, entry, overrides, commandId, platform);

  return {
    ...overrides,
    [commandId]: nextKeys,
  };
}

export function validateCommandKeybindings(
  keys: string[],
  entry: CommandRegistryEntry,
  overrides: CommandKeybindingOverrides,
  commandId: string,
  platform: RuntimePlatform = resolveRuntimePlatform(),
): void {
  const normalizedKeys = keys.map((key) => normalizeAccelerator(key));
  const seen = new Set<string>();

  normalizedKeys.forEach((key) => {
    if (!isValidAccelerator(key, { allowsBareModifiers: entry.allowsBareModifiers === true })) {
      throw new Error(`Invalid keyboard shortcut: ${key}`);
    }
    if (!entry.allowsSequences && key.includes(" ")) {
      throw new Error(`Keyboard shortcut sequences are not supported for ${entry.title}`);
    }
    if (seen.has(key)) {
      throw new Error(`Duplicate keyboard shortcut: ${formatAcceleratorLabel(key, platform)}`);
    }
    seen.add(key);

    const conflict = findCommandKeybindingConflict(
      createCommandKeymapState(overrides, platform),
      commandId,
      key,
    );
    if (conflict) {
      throw new Error(`Keyboard shortcut already used by ${conflict.commandTitle}`);
    }
  });
}

export function findCommandKeybindingConflict(
  state: CommandKeymapState,
  commandId: string,
  accelerator: string,
): { commandId: string; commandTitle: string; key: string } | null {
  const normalized = normalizeAccelerator(accelerator);
  if (!normalized) return null;
  const normalizedParts = normalized.split(/\s+/);

  for (const entry of state.entries) {
    if (entry.id === commandId || !entry.available) continue;
    for (const binding of entry.keybindings) {
      const key = binding.key ? normalizeAccelerator(binding.key) : "";
      if (!key) continue;
      if (key === normalized || isSequencePrefix(key.split(/\s+/), normalizedParts)) {
        return { commandId: entry.id, commandTitle: entry.title, key };
      }
      if (isSequencePrefix(normalizedParts, key.split(/\s+/))) {
        return { commandId: entry.id, commandTitle: entry.title, key };
      }
    }
  }

  return null;
}

export function getCommandEntry(state: CommandKeymapState | null | undefined, commandId: string): CommandKeymapEntry | null {
  return state?.entries.find((entry) => entry.id === commandId) ?? null;
}

export function getCommandKeybindings(
  state: CommandKeymapState | null | undefined,
  commandId: string,
): CommandKeybindingRecord[] {
  return getCommandEntry(state, commandId)?.keybindings ?? [];
}

export function getPrimaryCommandAccelerator(
  state: CommandKeymapState | null | undefined,
  commandId: string,
): string | null {
  const binding = getCommandKeybindings(state, commandId).find((candidate) => {
    if (!candidate.key) return false;
    return !candidate.key.startsWith("Mouse");
  });
  return binding?.key ?? null;
}

export function formatCommandShortcutLabel(
  state: CommandKeymapState | null | undefined,
  commandId: string,
  fallback?: string,
): string | undefined {
  const accelerator = getPrimaryCommandAccelerator(state, commandId);
  if (!accelerator && getCommandEntry(state, commandId)) return undefined;
  if (!accelerator && !fallback) return undefined;
  const platform = state?.platform ?? resolveRuntimePlatform();
  return formatAcceleratorLabel(accelerator ?? fallback ?? "", platform);
}

export function normalizeAccelerator(accelerator: string | null | undefined): string {
  if (!accelerator) return "";
  return accelerator
    .trim()
    .split(/\s+/)
    .map(normalizeChord)
    .filter(Boolean)
    .join(" ");
}

export function isValidAccelerator(
  accelerator: string | null | undefined,
  options: { allowsBareModifiers?: boolean } = {},
): boolean {
  const normalized = normalizeAccelerator(accelerator);
  if (!normalized) return false;

  return normalized.split(/\s+/).every((chord) => {
    const parsed = parseChord(chord);
    if (!parsed) return false;
    if (parsed.key) return true;
    return options.allowsBareModifiers === true && parsed.modifiers.length > 0;
  });
}

export function formatAcceleratorLabel(accelerator: string, platform: RuntimePlatform = resolveRuntimePlatform()): string {
  const normalized = normalizeAccelerator(accelerator);
  if (!normalized) return "";

  return normalized
    .split(/\s+/)
    .map((chord) => formatChordLabel(chord, platform))
    .join(" ");
}

export function commandAcceleratorsInclude(
  state: CommandKeymapState | null | undefined,
  commandId: string,
  accelerator: string,
): boolean {
  const normalized = normalizeAccelerator(accelerator);
  return getCommandKeybindings(state, commandId).some((binding) => binding.key && normalizeAccelerator(binding.key) === normalized);
}

export function keyboardEventToAccelerator(
  event: KeyboardShortcutEventLike,
  platform: RuntimePlatform = resolveRuntimePlatform(),
  options: { allowsBareModifiers?: boolean } = {},
): string | null {
  const modifiers = eventModifiers(event, platform);
  const key = normalizeEventKey(event);
  const isBareModifier = MODIFIER_SET.has(key);

  if (isBareModifier && !options.allowsBareModifiers) return null;
  if (!key && modifiers.length === 0) return null;
  if (!key && !options.allowsBareModifiers) return null;

  const normalizedModifiers = sortModifiers(Array.from(new Set(isBareModifier ? modifiers.filter((modifier) => modifier !== key) : modifiers)));
  const parts = [...normalizedModifiers, isBareModifier ? null : key].filter(isString);
  if (parts.length === 0) return null;
  return normalizeAccelerator(parts.join("+"));
}

export function matchesKeyboardEventToCommand(
  event: KeyboardShortcutEventLike,
  state: CommandKeymapState | null | undefined,
  commandId: string,
): boolean {
  return getCommandKeybindings(state, commandId).some((binding) => {
    if (!binding.key) return false;
    return matchesKeyboardEventToAccelerator(event, binding.key, state?.platform ?? resolveRuntimePlatform());
  });
}

export function matchesKeyboardEventToAccelerator(
  event: KeyboardShortcutEventLike,
  accelerator: string,
  platform: RuntimePlatform = resolveRuntimePlatform(),
): boolean {
  const normalized = normalizeAccelerator(accelerator);
  if (!normalized || normalized.includes(" ") || normalized.startsWith("Mouse")) return false;
  const parsed = parseChord(normalized);
  if (!parsed) return false;
  const eventAccel = keyboardEventToAccelerator(event, platform, { allowsBareModifiers: parsed.key === null });
  return eventAccel === normalized;
}

export function matchesMouseEventToCommand(
  event: MouseShortcutEventLike,
  state: CommandKeymapState | null | undefined,
  commandId: string,
): boolean {
  const mouseKey = event.button === 3 ? "MouseBack" : event.button === 4 ? "MouseForward" : null;
  if (!mouseKey) return false;
  return commandAcceleratorsInclude(state, commandId, mouseKey);
}

export function toElectronAccelerator(accelerator: string | null | undefined): string | undefined {
  const normalized = normalizeAccelerator(accelerator);
  if (!normalized || normalized.startsWith("Mouse") || normalized.includes(" ")) return undefined;
  return normalized.replaceAll("CmdOrCtrl", "CommandOrControl").replaceAll("Ctrl", "Control");
}

function resolveNextOverrideKeys(
  current: string[],
  entry: CommandRegistryEntry,
  update: Exclude<CommandKeybindingUpdate, { type: "reset" }>,
): string[] {
  if (update.type === "set") {
    return [requiredKey(update.keybinding)];
  }
  if (update.type === "append") {
    if (!entry.allowsMultiple) {
      throw new Error(`${entry.title} only supports one keyboard shortcut`);
    }
    return [...current, requiredKey(update.keybinding)].map(normalizeAccelerator);
  }
  if (update.type === "replace") {
    const oldKey = requiredKey(update.oldKeybinding);
    const newKey = requiredKey(update.newKeybinding);
    const replaced = current.map((key) => (normalizeAccelerator(key) === normalizeAccelerator(oldKey) ? newKey : key));
    return replaced.some((key) => normalizeAccelerator(key) === normalizeAccelerator(newKey))
      ? replaced.map(normalizeAccelerator)
      : [newKey];
  }

  const keyToRemove = requiredKey(update.keybinding);
  return current
    .filter((key) => normalizeAccelerator(key) !== normalizeAccelerator(keyToRemove))
    .map(normalizeAccelerator);
}

function omitOverride(overrides: CommandKeybindingOverrides, commandId: string): CommandKeybindingOverrides {
  const nextOverrides = { ...overrides };
  delete nextOverrides[commandId];
  return nextOverrides;
}

function cloneKeybinding(binding: CommandKeybindingRecord): CommandKeybindingRecord {
  return { key: binding.key };
}

function requiredKey(binding: CommandKeybindingRecord): string {
  const key = normalizeAccelerator(binding.key);
  if (!key) {
    throw new Error("Keyboard shortcut is required");
  }
  return key;
}

function normalizeChord(chord: string): string {
  const parts = chord.split("+").map((part) => part.trim()).filter(Boolean);
  const modifiers: string[] = [];
  let key: string | null = null;

  parts.forEach((part) => {
    const modifier = MODIFIER_ALIASES.get(part.toLowerCase());
    if (modifier) {
      modifiers.push(modifier);
      return;
    }
    key = normalizeKeyName(part);
  });

  const sortedModifiers = sortModifiers(Array.from(new Set(modifiers)));
  return [...sortedModifiers, key].filter(isString).join("+");
}

function parseChord(chord: string): ParsedChord | null {
  const normalized = normalizeChord(chord);
  if (!normalized) return null;
  const parts = normalized.split("+");
  const modifiers = parts.filter((part) => MODIFIER_SET.has(part));
  const key = parts.find((part) => !MODIFIER_SET.has(part)) ?? null;
  return { modifiers, key };
}

function normalizeKeyName(rawKey: string): string {
  const alias = KEY_ALIASES.get(rawKey.toLowerCase());
  if (alias) return alias;
  if (/^f\d{1,2}$/i.test(rawKey)) return rawKey.toUpperCase();
  if (rawKey.length === 1) return rawKey.toUpperCase();
  return rawKey;
}

function normalizeEventKey(
  event: Pick<KeyboardShortcutEventLike, "key" | "code">,
): string {
  if (event.key === " ") return "Space";
  if (event.key && event.key !== "Unidentified") {
    return normalizeKeyName(event.key);
  }
  return normalizeKeyName(event.code ?? "");
}

function eventModifiers(
  event: Pick<KeyboardShortcutEventLike, "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  platform: RuntimePlatform,
): string[] {
  const modifiers: string[] = [];
  if (platform === "macOS" && event.metaKey) modifiers.push("CmdOrCtrl");
  if (platform !== "macOS" && event.ctrlKey) modifiers.push("CmdOrCtrl");
  if (platform === "macOS" && event.ctrlKey && !event.metaKey) modifiers.push("Ctrl");
  if (platform !== "macOS" && event.metaKey && !event.ctrlKey) modifiers.push("Command");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  return modifiers;
}

function sortModifiers(modifiers: string[]): string[] {
  return modifiers.slice().sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b));
}

function formatChordLabel(chord: string, platform: RuntimePlatform): string {
  const parsed = parseChord(chord);
  if (!parsed) return "";

  const keyLabel = parsed.key ? formatKeyLabel(parsed.key) : "";
  if (platform === "macOS") {
    return `${parsed.modifiers.map(formatMacModifierLabel).join("")}${keyLabel}`;
  }
  const modifierLabels = parsed.modifiers.map(formatNonMacModifierLabel);
  return [...modifierLabels, keyLabel].filter(Boolean).join("+");
}

function formatMacModifierLabel(modifier: string): string {
  if (modifier === "CmdOrCtrl" || modifier === "Command") return "⌘";
  if (modifier === "Ctrl") return "⌃";
  if (modifier === "Alt") return "⌥";
  if (modifier === "Shift") return "⇧";
  return modifier;
}

function formatNonMacModifierLabel(modifier: string): string {
  if (modifier === "CmdOrCtrl" || modifier === "Ctrl") return "Ctrl";
  if (modifier === "Command") return "Meta";
  if (modifier === "Alt") return "Alt";
  if (modifier === "Shift") return "Shift";
  return modifier;
}

function formatKeyLabel(key: string): string {
  if (key === "MouseBack") return "Mouse Back";
  if (key === "MouseForward") return "Mouse Forward";
  if (key === "Space") return "Space";
  if (key === "Up") return "↑";
  if (key === "Down") return "↓";
  if (key === "Left") return "←";
  if (key === "Right") return "→";
  return key;
}

function isSequencePrefix(left: string[], right: string[]): boolean {
  if (left.length === right.length) return false;
  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  return shorter.every((part, index) => part === longer[index]);
}

function isString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}
