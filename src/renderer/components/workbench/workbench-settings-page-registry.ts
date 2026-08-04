import type { ComponentType } from "react";
import type { ComposerEnterBehavior } from "../../lib/composer-enter-behavior";
import type {
  Project,
  WorktreeStartMode,
} from "../../lib/types";
import type {
  BrowserSettingsAnchor,
  BrowserSettingsDestination,
  BrowserSettingsDetail,
} from "./workbench-settings-routes";

export type SettingsPageKey =
  | "general"
  | "appearance"
  | "agent"
  | "import"
  | "keyboard-shortcuts"
  | "browser"
  | "computer-use"
  | "page"
  | "git"
  | "worktrees"
  | "local-environments"
  | "hooks"
  | "backups";

export interface SettingsSectionPageProps {
  activeProjectId: string | null;
  browserAnchor: BrowserSettingsAnchor | null;
  browserDetail: BrowserSettingsDetail | null;
  composerEnterBehavior: ComposerEnterBehavior;
  initialLocalEnvironmentConfigPath?: string | null;
  initialLocalEnvironmentProjectId?: string | null;
  isMacPlatform: boolean;
  onComposerEnterBehaviorChange: (value: ComposerEnterBehavior) => void;
  onOpenBrowserDetail: (
    destination: BrowserSettingsDestination,
    anchor?: BrowserSettingsAnchor,
  ) => void;
  onPathChange: (path: string) => void;
  onRequestProjectPickerOpen: () => void;
  onSmartPrefixParsingEnabledChange: (value: boolean) => void;
  onStripSmartPrefixFromTitleEnabledChange: (value: boolean) => void;
  onThreadQueueFollowUpsEnabledChange: (value: boolean) => void;
  onWorktreeAutoBranchPrefixChange: (value: string) => void;
  onWorktreeStartModeChange: (value: WorktreeStartMode) => void;
  open: boolean;
  path: string;
  projects: Project[];
  smartPrefixParsingEnabled: boolean;
  stripSmartPrefixFromTitleEnabled: boolean;
  threadQueueFollowUpsEnabled: boolean;
  worktreeAutoBranchPrefix: string;
  worktreeStartMode: WorktreeStartMode;
}

export type SettingsPageComponent = ComponentType<SettingsSectionPageProps>;

export type SettingsPageComponentRegistry = Readonly<
  Record<SettingsPageKey, SettingsPageComponent>
>;
