import type { ComponentType } from "react";
import {
  ContactRound,
  Download,
  GitBranch,
  Globe2,
  History,
  KeyRound,
  LayoutTemplate,
  Puzzle,
  Shield,
  Type,
} from "lucide-react";
import type { SettingsSearchContext } from "@/lib/settings-search";
import {
  CodexKeyboardShortcutsIcon,
  CodexHooksIcon,
  CodexSettingsAgentIcon,
  CodexSettingsAppearanceIcon,
  CodexSettingsGeneralIcon,
  CodexSettingsLocalEnvironmentsIcon,
  CodexSettingsWorktreeIcon,
} from "../shared/icons";
import { SETTINGS_SEARCH_CATALOG } from "./workbench-settings-search-catalog";

export type SettingsSectionId =
  | "general-settings"
  | "appearance"
  | "keyboard-shortcuts"
  | "browser-settings"
  | "browser-passwords"
  | "browser-contact-info"
  | "browser-history"
  | "browser-extensions"
  | "agent"
  | "agent-import"
  | "editor"
  | "page"
  | "git"
  | "worktrees"
  | "local-environments"
  | "hooks-settings"
  | "backups";

export type SettingsSectionGroupKey =
  | "personal"
  | "integrations"
  | "coding"
  | "archived";

export interface SettingsSectionDefinition {
  id: SettingsSectionId;
  label: string;
  icon: ComponentType<{ className?: string }>;
  groupKey: SettingsSectionGroupKey;
  searchMessages: readonly string[];
  searchTerms?: (context: SettingsSearchContext) => readonly string[];
  disabled?: boolean;
  externalUrl?: string;
  placeholderKind?: "unavailable" | "external";
  visibleWhen?: () => boolean;
}

export const SETTINGS_SECTION_GROUP_LABELS: Record<SettingsSectionGroupKey, string> = {
  archived: "Archived",
  coding: "Coding",
  integrations: "Integrations",
  personal: "Personal",
};

export const SETTINGS_SECTION_GROUP_ORDER: readonly SettingsSectionGroupKey[] = [
  "personal",
  "integrations",
  "coding",
  "archived",
];

export const SETTINGS_SECTIONS: SettingsSectionDefinition[] = [
  {
    id: "general-settings",
    label: "General",
    icon: CodexSettingsGeneralIcon,
    groupKey: "personal",
    searchMessages: SETTINGS_SEARCH_CATALOG["general-settings"].messages,
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: CodexSettingsAppearanceIcon,
    groupKey: "personal",
    searchMessages: SETTINGS_SEARCH_CATALOG.appearance.messages,
  },
  {
    id: "browser-settings",
    label: "Browser",
    icon: Globe2,
    groupKey: "personal",
    searchMessages: SETTINGS_SEARCH_CATALOG["browser-settings"].messages,
  },
  {
    id: "browser-passwords",
    label: "Passwords",
    icon: KeyRound,
    groupKey: "personal",
    searchMessages: SETTINGS_SEARCH_CATALOG["browser-passwords"].messages,
  },
  {
    id: "browser-contact-info",
    label: "Contact info",
    icon: ContactRound,
    groupKey: "personal",
    searchMessages: SETTINGS_SEARCH_CATALOG["browser-contact-info"].messages,
  },
  {
    id: "browser-history",
    label: "History",
    icon: History,
    groupKey: "personal",
    searchMessages: SETTINGS_SEARCH_CATALOG["browser-history"].messages,
  },
  {
    id: "browser-extensions",
    label: "Extensions",
    icon: Puzzle,
    groupKey: "integrations",
    searchMessages: SETTINGS_SEARCH_CATALOG["browser-extensions"].messages,
  },
  {
    id: "agent",
    label: "Agent",
    icon: CodexSettingsAgentIcon,
    groupKey: "personal",
    searchMessages: SETTINGS_SEARCH_CATALOG.agent.messages,
    searchTerms: SETTINGS_SEARCH_CATALOG.agent.searchTerms,
  },
  {
    id: "agent-import",
    label: "Import",
    icon: Download,
    groupKey: "integrations",
    searchMessages: SETTINGS_SEARCH_CATALOG["agent-import"].messages,
  },
  {
    id: "keyboard-shortcuts",
    label: "Keyboard shortcuts",
    icon: CodexKeyboardShortcutsIcon,
    groupKey: "personal",
    searchMessages: SETTINGS_SEARCH_CATALOG["keyboard-shortcuts"].messages,
  },
  {
    id: "editor",
    label: "Editor",
    icon: Type,
    groupKey: "coding",
    searchMessages: SETTINGS_SEARCH_CATALOG.editor.messages,
  },
  {
    id: "page",
    label: "Page",
    icon: LayoutTemplate,
    groupKey: "coding",
    searchMessages: SETTINGS_SEARCH_CATALOG.page.messages,
  },
  {
    id: "git",
    label: "Git",
    icon: GitBranch,
    groupKey: "coding",
    searchMessages: SETTINGS_SEARCH_CATALOG.git.messages,
  },
  {
    id: "worktrees",
    label: "Worktrees",
    icon: CodexSettingsWorktreeIcon,
    groupKey: "coding",
    searchMessages: SETTINGS_SEARCH_CATALOG.worktrees.messages,
  },
  {
    id: "local-environments",
    label: "Local environments",
    icon: CodexSettingsLocalEnvironmentsIcon,
    groupKey: "coding",
    searchMessages: SETTINGS_SEARCH_CATALOG["local-environments"].messages,
    searchTerms: SETTINGS_SEARCH_CATALOG["local-environments"].searchTerms,
  },
  {
    id: "hooks-settings",
    label: "Hooks",
    icon: CodexHooksIcon,
    groupKey: "coding",
    searchMessages: SETTINGS_SEARCH_CATALOG["hooks-settings"].messages,
  },
  {
    id: "backups",
    label: "Backups",
    icon: Shield,
    groupKey: "archived",
    searchMessages: SETTINGS_SEARCH_CATALOG.backups.messages,
  },
];

export function resolveVisibleSettingsSections(): SettingsSectionDefinition[] {
  return SETTINGS_SECTIONS.filter((section) => section.visibleWhen?.() ?? true);
}

export function resolveDefaultSettingsSectionId(
  sections: readonly SettingsSectionDefinition[] = resolveVisibleSettingsSections(),
): SettingsSectionId {
  return sections[0]?.id ?? "general-settings";
}
