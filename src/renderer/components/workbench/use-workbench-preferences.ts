import { useCallback, useEffect } from "react";
import { isCodexGitSettings } from "../../../shared/codex-git-settings";
import { invoke } from "../../lib/api";
import {
  readComposerEnterBehavior,
  writeComposerEnterBehavior,
  type ComposerEnterBehavior,
} from "../../lib/composer-enter-behavior";
import {
  appScope,
  scopedAtomWithInitializer,
  useScopedAtom,
} from "../../lib/maitai";
import {
  readSmartPrefixParsingEnabled,
  readStripSmartPrefixFromTitleEnabled,
  writeSmartPrefixParsingEnabled,
  writeStripSmartPrefixFromTitleEnabled,
} from "../../lib/smart-prefix-parsing";
import {
  readThreadQueueFollowUpsEnabled,
  writeThreadQueueFollowUpsEnabled,
} from "../../lib/thread-composer-follow-up-mode";
import type { WorktreeStartMode } from "../../lib/types";
import {
  readWorktreeAutoBranchPrefix,
  writeWorktreeAutoBranchPrefix,
} from "../../lib/worktree-branch-prefix";
import {
  readWorktreeStartMode,
  writeWorktreeStartMode,
} from "../../lib/worktree-start-mode";

const THREAD_SUMMARY_PANEL_STORAGE_KEY = "nodex:thread-summary-panel:pinned-open";

function readThreadSummaryPanelPinnedOpen(): boolean {
  try {
    const raw = localStorage.getItem(THREAD_SUMMARY_PANEL_STORAGE_KEY);
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
}

function writeThreadSummaryPanelPinnedOpen(open: boolean): boolean {
  try {
    localStorage.setItem(THREAD_SUMMARY_PANEL_STORAGE_KEY, String(open));
  } catch {
    // Keep the renderer value when browser storage is unavailable.
  }
  return open;
}

const threadSummaryPanelPinnedOpenAtom = scopedAtomWithInitializer(
  appScope,
  readThreadSummaryPanelPinnedOpen,
  { debugLabel: "thread-summary-panel-pinned-open" },
);
const threadQueueFollowUpsEnabledAtom = scopedAtomWithInitializer(
  appScope,
  readThreadQueueFollowUpsEnabled,
  { debugLabel: "thread-queue-follow-ups-enabled" },
);
const composerEnterBehaviorAtom = scopedAtomWithInitializer(
  appScope,
  readComposerEnterBehavior,
  { debugLabel: "composer-enter-behavior" },
);
const worktreeStartModeAtom = scopedAtomWithInitializer(
  appScope,
  readWorktreeStartMode,
  { debugLabel: "worktree-start-mode" },
);
const worktreeAutoBranchPrefixAtom = scopedAtomWithInitializer(
  appScope,
  readWorktreeAutoBranchPrefix,
  { debugLabel: "worktree-auto-branch-prefix" },
);
const smartPrefixParsingEnabledAtom = scopedAtomWithInitializer(
  appScope,
  readSmartPrefixParsingEnabled,
  { debugLabel: "smart-prefix-parsing-enabled" },
);
const stripSmartPrefixFromTitleEnabledAtom = scopedAtomWithInitializer(
  appScope,
  readStripSmartPrefixFromTitleEnabled,
  { debugLabel: "strip-smart-prefix-from-title-enabled" },
);

export function useWorkbenchPreferences() {
  const [threadSummaryPanelPinnedOpen, setThreadSummaryPanelPinnedOpen] = useScopedAtom(
    threadSummaryPanelPinnedOpenAtom,
  );
  const [threadQueueFollowUpsEnabled, setThreadQueueFollowUpsEnabled] = useScopedAtom(
    threadQueueFollowUpsEnabledAtom,
  );
  const [composerEnterBehavior, setComposerEnterBehavior] = useScopedAtom(
    composerEnterBehaviorAtom,
  );
  const [worktreeStartMode, setWorktreeStartMode] = useScopedAtom(worktreeStartModeAtom);
  const [worktreeAutoBranchPrefix, setWorktreeAutoBranchPrefix] = useScopedAtom(
    worktreeAutoBranchPrefixAtom,
  );
  const [smartPrefixParsingEnabled, setSmartPrefixParsingEnabled] = useScopedAtom(
    smartPrefixParsingEnabledAtom,
  );
  const [stripSmartPrefixFromTitleEnabled, setStripSmartPrefixFromTitleEnabled] = useScopedAtom(
    stripSmartPrefixFromTitleEnabledAtom,
  );

  useEffect(() => {
    let disposed = false;
    void invoke("settings:git:get")
      .then((settings) => {
        if (disposed || !isCodexGitSettings(settings)) return;
        setWorktreeAutoBranchPrefix(writeWorktreeAutoBranchPrefix(settings.branchPrefix));
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [setWorktreeAutoBranchPrefix]);

  const toggleThreadSummaryPanelPinnedOpen = useCallback(() => {
    setThreadSummaryPanelPinnedOpen((current) =>
      writeThreadSummaryPanelPinnedOpen(!current));
  }, [setThreadSummaryPanelPinnedOpen]);

  const handleThreadQueueFollowUpsEnabledChange = useCallback((value: boolean) => {
    setThreadQueueFollowUpsEnabled(writeThreadQueueFollowUpsEnabled(value));
  }, [setThreadQueueFollowUpsEnabled]);

  const handleComposerEnterBehaviorChange = useCallback((value: ComposerEnterBehavior) => {
    setComposerEnterBehavior(writeComposerEnterBehavior(value));
  }, [setComposerEnterBehavior]);

  const handleWorktreeStartModeChange = useCallback((value: WorktreeStartMode) => {
    setWorktreeStartMode(writeWorktreeStartMode(value));
  }, [setWorktreeStartMode]);

  const handleWorktreeAutoBranchPrefixChange = useCallback((value: string) => {
    setWorktreeAutoBranchPrefix(writeWorktreeAutoBranchPrefix(value));
  }, [setWorktreeAutoBranchPrefix]);

  const handleSmartPrefixParsingEnabledChange = useCallback((value: boolean) => {
    setSmartPrefixParsingEnabled(writeSmartPrefixParsingEnabled(value));
  }, [setSmartPrefixParsingEnabled]);

  const handleStripSmartPrefixFromTitleEnabledChange = useCallback((value: boolean) => {
    setStripSmartPrefixFromTitleEnabled(writeStripSmartPrefixFromTitleEnabled(value));
  }, [setStripSmartPrefixFromTitleEnabled]);

  return {
    threadSummaryPanelPinnedOpen,
    toggleThreadSummaryPanelPinnedOpen,
    threadQueueFollowUpsEnabled,
    handleThreadQueueFollowUpsEnabledChange,
    composerEnterBehavior,
    handleComposerEnterBehaviorChange,
    worktreeStartMode,
    handleWorktreeStartModeChange,
    worktreeAutoBranchPrefix,
    handleWorktreeAutoBranchPrefixChange,
    smartPrefixParsingEnabled,
    handleSmartPrefixParsingEnabledChange,
    stripSmartPrefixFromTitleEnabled,
    handleStripSmartPrefixFromTitleEnabledChange,
  };
}

export const workbenchPreferenceTestHelpers = {
  readThreadSummaryPanelPinnedOpen,
  writeThreadSummaryPanelPinnedOpen,
};
