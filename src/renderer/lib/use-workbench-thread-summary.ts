import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  useConversationSubset,
} from "@/features/local-conversation";
import { buildThreadSummaryPanelBrowserRow } from "@/features/local-conversation/projection/thread-summary-panel-browser-row-model";
import { isThreadSummaryBrowserRowAgentWorking } from "@/features/local-conversation/projection/thread-summary-panel-browser-row-model";
import { buildThreadSummaryPanelSideChatRow } from "@/features/local-conversation/projection/thread-summary-panel-side-chat-row-model";
import { buildThreadSummaryPanelScheduledAutomationRow } from "@/features/local-conversation/projection/thread-summary-panel-scheduled-automation-model";
import { useRemoteHostedPipSummaryControl } from "@/features/local-conversation/view/use-remote-hosted-pip-summary-control";
import type { ThreadStageActions } from "@/features/local-conversation";
import type {
  ThreadSummaryPanelAuxiliaryRow,
  ThreadSummaryPanelBrowserRow,
  ThreadSummaryPanelScheduledAutomationOpenInput,
  ThreadSummaryPanelScheduledAutomationRow,
} from "@/features/local-conversation/thread-stage-types";
import {
  readBrowserConfigFavicon,
  readBrowserConfigTitle,
  readBrowserConfigUrl,
} from "@/features/browser-sidebar/browser-sidebar-tab-config";
import type {
  BrowserSidebarBrowserUseStateSnapshot,
} from "../../shared/browser-sidebar";
import {
  requireWorkbenchBrowserTabProjectionId,
} from "../../shared/browser-sidebar";
import type {
  CodexScheduledAutomation,
  PanelId,
} from "./types";
import type {
  SideChatPanelTab,
} from "./workbench-panel-tab-model";
import {
  resolveLeafIdForPanelTab,
} from "./workbench-panel-placement";
import {
  resolveWorkbenchPanelSlotLeafId,
} from "./workbench-panel-slot-key";
import {
  resolveCodexSummaryContentShift,
  type ThreadSummaryPanelLayoutMode,
} from "./codex-panel-motion";
import type { WorkbenchSessionRenderProjection } from "./workbench-session-presentation";
import type { WorkbenchEphemeralPanelState } from "./workbench-ephemeral-panel-state";
import { buildAutomationsPath } from "@/components/workbench/workbench-automations-routes";
import {
  buildProcessOutputTargetFromSummaryRow,
} from "./workbench-process-output-target";

export interface WorkbenchThreadSummaryCommands {
  readonly selectPanelTab: (
    panelId: PanelId,
    tabId: string,
    leafId?: string,
  ) => Promise<void>;
  readonly setPanelCollapsed: (
    panelId: PanelId,
    collapsed: boolean,
  ) => Promise<unknown>;
  readonly openAutomationSidePanel: (
    input: ThreadSummaryPanelScheduledAutomationOpenInput,
  ) => Promise<void>;
  readonly openAutomations: (path: string) => void;
  readonly openSummaryOutputInSidePanel:
    NonNullable<ThreadStageActions["onOpenSummaryOutputInSidePanel"]>;
  readonly openProcessOutput: (
    target: ReturnType<typeof buildProcessOutputTargetFromSummaryRow>,
  ) => Promise<boolean>;
  readonly openProcessManager: () => void;
}

interface WorkbenchThreadSummaryInput {
  readonly activeSession: WorkbenchSessionRenderProjection | null;
  readonly windowSessionId: string;
  readonly layoutMode: ThreadSummaryPanelLayoutMode;
  readonly rightPanelFullWidth: boolean;
  readonly pinnedOpen: boolean;
  readonly sideChatTabs: readonly SideChatPanelTab[];
  readonly previewTabsByPanel:
    WorkbenchEphemeralPanelState["previewTabsByPanel"];
  readonly scheduledAutomations: readonly CodexScheduledAutomation[];
  readonly commands: WorkbenchThreadSummaryCommands;
}

export interface WorkbenchThreadSummaryModel {
  readonly mounted: boolean;
  readonly open: boolean;
  readonly hideImmediately: boolean;
  readonly contentShift: number;
  readonly mode: "hidden" | "popover" | "pinned";
  readonly popoverOpen: boolean;
  readonly setPopoverOpen: (open: boolean) => void;
  readonly sideChatRows: ThreadSummaryPanelAuxiliaryRow[];
  readonly browserRows: ThreadSummaryPanelBrowserRow[];
  readonly scheduledAutomation:
    ThreadSummaryPanelScheduledAutomationRow | null;
  readonly summaryComputerUsePip:
    ReturnType<
      typeof useRemoteHostedPipSummaryControl
    >["summaryComputerUsePip"];
  readonly onToggleSummaryComputerUsePip:
    ReturnType<
      typeof useRemoteHostedPipSummaryControl
    >["onToggleSummaryComputerUsePip"];
  readonly onOpenSideChatRow:
    NonNullable<ThreadStageActions["onOpenSummarySideChatRow"]>;
  readonly onOpenBrowserRow:
    NonNullable<ThreadStageActions["onOpenSummaryBrowserRow"]>;
  readonly onOpenScheduledAutomation:
    NonNullable<ThreadStageActions["onOpenSummaryScheduledAutomation"]>;
  readonly onOpenProcessManager:
    NonNullable<ThreadStageActions["onOpenProcessManager"]>;
  readonly onOpenBackgroundTerminalOutput:
    NonNullable<ThreadStageActions["onOpenBackgroundTerminalOutput"]>;
  readonly headerActions: Pick<
    ThreadStageActions,
    | "onOpenSummaryOutputInSidePanel"
    | "onOpenSummaryScheduledAutomation"
  >;
}

/**
 * Owns the renderer-lifetime Thread Summary projection and its external
 * Browser-use subscription. It does not own Session, panel, automation, or
 * process state; row intents cross those Seams through commands.
 */
export function useWorkbenchThreadSummary({
  activeSession,
  windowSessionId,
  layoutMode,
  rightPanelFullWidth,
  pinnedOpen,
  sideChatTabs,
  previewTabsByPanel,
  scheduledAutomations,
  commands,
}: WorkbenchThreadSummaryInput): WorkbenchThreadSummaryModel {
  const available = Boolean(activeSession?.thread);
  const mounted = available && !rightPanelFullWidth;
  const open = mounted && layoutMode !== "overlay" && pinnedOpen;
  const mode = !mounted
    ? "hidden"
    : layoutMode === "overlay"
      ? "popover"
      : "pinned";
  const [popoverOpen, setPopoverOpen] = useState(false);

  useEffect(() => {
    if (mode === "popover") return;
    setPopoverOpen(false);
  }, [mode]);

  const [browserUseState, setBrowserUseState] =
    useState<BrowserSidebarBrowserUseStateSnapshot | null>(null);
  useEffect(() => {
    const unsubscribe = window.api?.on(
      "browser-sidebar-browser-use-state",
      (payload) => {
        setBrowserUseState(
          payload as BrowserSidebarBrowserUseStateSnapshot,
        );
      },
    );
    return () => {
      unsubscribe?.();
    };
  }, []);

  const sideChatThreadIds = useMemo(
    () => sideChatTabs.flatMap((tab) =>
      tab.threadId ? [tab.threadId] : []),
    [sideChatTabs],
  );
  const sideChatConversationsById =
    useConversationSubset(sideChatThreadIds);
  const sideChatRows = useMemo<ThreadSummaryPanelAuxiliaryRow[]>(
    () => sideChatTabs.map((tab) =>
      buildThreadSummaryPanelSideChatRow(
        tab,
        tab.threadId
          ? sideChatConversationsById[tab.threadId]
          : null,
      )),
    [sideChatConversationsById, sideChatTabs],
  );
  const browserRows = useMemo<ThreadSummaryPanelBrowserRow[]>(() => {
    if (!activeSession) return [];
    const activeBrowserUseTabId =
      browserUseState?.activeBrowserTabIdsByConversationScope[
        `${activeSession.id}\0${windowSessionId}`
      ] ?? null;
    const browserTabs = activeSession.tabs
      .filter((tab) => tab.kind === "browser")
      .map((tab) => buildThreadSummaryPanelBrowserRow({
        id: tab.id,
        tabTitle: tab.title,
        configTitle: readBrowserConfigTitle(tab),
        url: readBrowserConfigUrl(tab),
        faviconUrl: readBrowserConfigFavicon(tab),
        isAgentWorking: isThreadSummaryBrowserRowAgentWorking(
          activeBrowserUseTabId,
          requireWorkbenchBrowserTabProjectionId(tab),
        ),
        panelId: tab.panelId,
        leafId: resolveLeafIdForPanelTab(
          activeSession,
          tab.panelId,
          tab.id,
        ),
      }));
    const browserPreviewTabs = Object.entries(previewTabsByPanel)
      .filter(([, tab]) =>
        tab.sessionId === activeSession.id
        && tab.kind === "browser")
      .map(([key, tab]) => buildThreadSummaryPanelBrowserRow({
        id: tab.id,
        tabTitle: tab.title,
        configTitle: readBrowserConfigTitle(tab),
        url: readBrowserConfigUrl(tab),
        faviconUrl: readBrowserConfigFavicon(tab),
        isAgentWorking: isThreadSummaryBrowserRowAgentWorking(
          activeBrowserUseTabId,
          requireWorkbenchBrowserTabProjectionId(tab),
        ),
        panelId: tab.panelId,
        leafId: resolveWorkbenchPanelSlotLeafId(
          key,
          activeSession.id,
          tab.panelId,
        ),
      }));
    return [...browserTabs, ...browserPreviewTabs];
  }, [
    activeSession,
    browserUseState,
    previewTabsByPanel,
    windowSessionId,
  ]);
  const scheduledAutomation =
    useMemo<ThreadSummaryPanelScheduledAutomationRow | null>(
      () => buildThreadSummaryPanelScheduledAutomationRow({
        automations: scheduledAutomations,
        conversationId: activeSession?.thread?.threadId ?? null,
      }),
      [activeSession?.thread?.threadId, scheduledAutomations],
    );
  const pip = useRemoteHostedPipSummaryControl(
    activeSession?.thread?.threadId ?? null,
  );
  const onOpenSideChatRow = useCallback<
    NonNullable<ThreadStageActions["onOpenSummarySideChatRow"]>
  >(async ({ rowId, panelId, leafId }) => {
    if (!activeSession) return;
    await commands.setPanelCollapsed(panelId, false);
    await commands.selectPanelTab(
      panelId,
      rowId,
      leafId ?? undefined,
    );
  }, [activeSession, commands]);
  const onOpenBrowserRow = useCallback<
    NonNullable<ThreadStageActions["onOpenSummaryBrowserRow"]>
  >(async ({ rowId, panelId, leafId }) => {
    if (!activeSession) return;
    await commands.setPanelCollapsed(panelId, false);
    await commands.selectPanelTab(
      panelId,
      rowId,
      leafId ?? undefined,
    );
  }, [activeSession, commands]);
  const onOpenScheduledAutomation = useCallback<
    NonNullable<ThreadStageActions["onOpenSummaryScheduledAutomation"]>
  >((input) => {
    if (
      input.mode === "suggested-create"
      || input.mode === "suggested-update"
    ) {
      void commands.openAutomationSidePanel(input);
      return;
    }
    if (!input.automationId) return;
    commands.openAutomations(buildAutomationsPath({
      automationId: input.automationId,
    }));
  }, [commands]);
  const onOpenProcessManager = useCallback(() => {
    commands.openProcessManager();
  }, [commands]);
  const onOpenBackgroundTerminalOutput = useCallback<
    NonNullable<ThreadStageActions["onOpenBackgroundTerminalOutput"]>
  >(async (row) => {
    if (!activeSession?.thread) return;
    await commands.openProcessOutput(
      buildProcessOutputTargetFromSummaryRow(
        activeSession.thread.threadId,
        row,
      ),
    );
  }, [activeSession?.thread, commands]);
  const headerActions = useMemo<
    WorkbenchThreadSummaryModel["headerActions"]
  >(() => ({
    onOpenSummaryOutputInSidePanel:
      commands.openSummaryOutputInSidePanel,
    onOpenSummaryScheduledAutomation: onOpenScheduledAutomation,
  }), [
    commands.openSummaryOutputInSidePanel,
    onOpenScheduledAutomation,
  ]);

  return {
    mounted,
    open,
    hideImmediately:
      layoutMode === "overlay" && popoverOpen,
    contentShift: resolveCodexSummaryContentShift({
      layoutMode,
      pinnedOpen: open,
    }),
    mode,
    popoverOpen,
    setPopoverOpen,
    sideChatRows,
    browserRows,
    scheduledAutomation,
    summaryComputerUsePip: pip.summaryComputerUsePip,
    onToggleSummaryComputerUsePip:
      pip.onToggleSummaryComputerUsePip,
    onOpenSideChatRow,
    onOpenBrowserRow,
    onOpenScheduledAutomation,
    onOpenProcessManager,
    onOpenBackgroundTerminalOutput,
    headerActions,
  };
}
