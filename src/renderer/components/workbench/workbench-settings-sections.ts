import type { ComponentType } from "react";
import {
  FolderCode,
  FolderGit2,
  LayoutTemplate,
  Palette,
  Settings2,
  Shield,
  Type,
} from "lucide-react";

export type SettingsSectionId =
  | "general-settings"
  | "appearance"
  | "agent"
  | "editor"
  | "card"
  | "worktrees"
  | "local-environments"
  | "backups";

export interface SettingsSectionDefinition {
  id: SettingsSectionId;
  label: string;
  icon: ComponentType<{ className?: string }>;
  disabled?: boolean;
  externalUrl?: string;
  placeholderKind?: "unavailable" | "external";
  visibleWhen?: () => boolean;
}

export const SETTINGS_SECTIONS: SettingsSectionDefinition[] = [
  { id: "general-settings", label: "General", icon: Settings2 },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "agent", label: "Agent", icon: Shield },
  { id: "editor", label: "Editor", icon: Type },
  { id: "card", label: "Card", icon: LayoutTemplate },
  { id: "worktrees", label: "Worktrees", icon: FolderGit2 },
  { id: "local-environments", label: "Local environments", icon: FolderCode },
  { id: "backups", label: "Backups", icon: Shield },
];

export function resolveVisibleSettingsSections(): SettingsSectionDefinition[] {
  return SETTINGS_SECTIONS.filter((section) => section.visibleWhen?.() ?? true);
}

export function resolveDefaultSettingsSectionId(
  sections: readonly SettingsSectionDefinition[] = resolveVisibleSettingsSections(),
): SettingsSectionId {
  return sections[0]?.id ?? "general-settings";
}
