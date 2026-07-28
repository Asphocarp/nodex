import {
  useCallback,
  useMemo,
  useReducer,
} from "react";
import {
  createWorkbenchEphemeralPanelState,
  reduceWorkbenchEphemeralPanelState,
  type WorkbenchEphemeralPanelState,
  type WorkbenchEphemeralPanelStateField,
  type WorkbenchEphemeralPanelStateUpdate,
} from "./workbench-ephemeral-panel-state";
import type { PanelId, ProjectSession } from "../../shared/types";
import type { WorkbenchSessionViewSnapshot } from "../../shared/workbench-session-view";
import {
  activateWorkbenchSessionViewTab,
  createWorkbenchSessionViewTab,
  ensureWorkbenchSessionViewLeafToRight,
  mergeWorkbenchSessionViewLeaf,
  moveWorkbenchSessionViewTab,
  patchWorkbenchSessionViewPanel,
  removeWorkbenchSessionViewTab,
  reorderWorkbenchSessionViewTabs,
  resizeWorkbenchSessionViewBranch,
  splitWorkbenchSessionViewLeaf,
  updateWorkbenchSessionViewTab,
} from "../../shared/workbench-session-view";
import { makeWorkbenchPanelSlotKey } from "./workbench-panel-slot-key";
import type {
  AgentPanelTab,
  AutomationPanelTab,
  McpAppPanelTab,
  PlanPanelTab,
  ProcessOutputPanelTab,
  SideChatPanelTab,
} from "./workbench-panel-tab-model";

type UpdateCommands = {
  [Field in WorkbenchEphemeralPanelStateField as `update${Capitalize<Field>}`]:
    (
      update: WorkbenchEphemeralPanelStateUpdate<
        WorkbenchEphemeralPanelState[Field]
      >,
    ) => void;
};

export type WorkbenchPanelController =
  WorkbenchEphemeralPanelState
  & UpdateCommands
  & {
    readonly pruneSession: (sessionId: string) => void;
    readonly durable: WorkbenchDurablePanelCommands;
    readonly selectRenderableTab: (
      input: WorkbenchRenderableTabSelectionInput,
    ) => boolean;
    readonly removeEphemeralTab: (
      input: WorkbenchEphemeralTabRemovalInput,
    ) => WorkbenchEphemeralTab | null;
    readonly upsertEphemeralTab: (tab: WorkbenchEphemeralTab) => void;
  };

export interface WorkbenchRenderableTabSelectionInput {
  readonly sessionId: string;
  readonly panelId: PanelId;
  readonly leafId: string;
  readonly tabId: string;
  readonly durableTabIds: ReadonlySet<string>;
}

export type WorkbenchEphemeralTab =
  | SideChatPanelTab
  | McpAppPanelTab
  | PlanPanelTab
  | AutomationPanelTab
  | AgentPanelTab
  | ProcessOutputPanelTab;

export interface WorkbenchEphemeralTabRemovalInput {
  readonly sessionId: string;
  readonly panelId: PanelId;
  readonly leafId: string;
  readonly tabId: string;
}

export interface WorkbenchPanelControllerInput {
  readonly mutateView: (
    session: ProjectSession,
    mutation: (
      view: WorkbenchSessionViewSnapshot,
    ) => WorkbenchSessionViewSnapshot,
  ) => WorkbenchSessionViewSnapshot;
}

export interface WorkbenchDurablePanelCommands {
  readonly apply: WorkbenchPanelControllerInput["mutateView"];
  readonly createTab: (
    session: ProjectSession,
    input: Parameters<typeof createWorkbenchSessionViewTab>[1],
  ) => WorkbenchSessionViewSnapshot;
  readonly updateTab: (
    session: ProjectSession,
    tabId: string,
    tab: Parameters<typeof updateWorkbenchSessionViewTab>[2],
  ) => WorkbenchSessionViewSnapshot;
  readonly patchPanel: (
    session: ProjectSession,
    panelId: Parameters<typeof patchWorkbenchSessionViewPanel>[1],
    patch: Parameters<typeof patchWorkbenchSessionViewPanel>[2],
  ) => WorkbenchSessionViewSnapshot;
  readonly activateTab: (
    session: ProjectSession,
    panelId: Parameters<typeof activateWorkbenchSessionViewTab>[1],
    leafId: string,
    tabId?: string | null,
  ) => WorkbenchSessionViewSnapshot;
  readonly reorderTabs: (
    session: ProjectSession,
    input: Parameters<typeof reorderWorkbenchSessionViewTabs>[1],
  ) => WorkbenchSessionViewSnapshot;
  readonly mergeLeaf: (
    session: ProjectSession,
    input: Parameters<typeof mergeWorkbenchSessionViewLeaf>[1],
  ) => WorkbenchSessionViewSnapshot;
  readonly removeTab: (
    session: ProjectSession,
    tabId: string,
    options?: Parameters<typeof removeWorkbenchSessionViewTab>[2],
  ) => WorkbenchSessionViewSnapshot;
  readonly moveTab: (
    session: ProjectSession,
    input: Parameters<typeof moveWorkbenchSessionViewTab>[1],
  ) => WorkbenchSessionViewSnapshot;
  readonly splitLeaf: (
    session: ProjectSession,
    input: Parameters<typeof splitWorkbenchSessionViewLeaf>[1],
  ) => WorkbenchSessionViewSnapshot;
  readonly resizeBranch: (
    session: ProjectSession,
    input: Parameters<typeof resizeWorkbenchSessionViewBranch>[1],
  ) => WorkbenchSessionViewSnapshot;
  readonly ensureLeafToRight: (
    session: ProjectSession,
    input: Parameters<typeof ensureWorkbenchSessionViewLeafToRight>[1],
  ) => string;
}

function capitalize<Value extends string>(value: Value): Capitalize<Value> {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}` as Capitalize<Value>;
}

const EPHEMERAL_PANEL_FIELDS = [
  "previewTabsByPanel",
  "sideChatTabsBySession",
  "sideChatActiveTabByPanel",
  "mcpAppTabsBySession",
  "mcpAppActiveTabByPanel",
  "planTabsBySession",
  "planActiveTabByPanel",
  "automationTabsBySession",
  "automationActiveTabByPanel",
  "backgroundAgentTabsBySession",
  "backgroundAgentActiveTabByPanel",
  "processOutputTabsBySession",
  "processOutputActiveTabByPanel",
  "pendingProcessOutputOpen",
  "activePlanKeyBySession",
  "panelCollapsedOverrides",
] as const satisfies readonly WorkbenchEphemeralPanelStateField[];

export function useWorkbenchPanelController({
  mutateView,
}: WorkbenchPanelControllerInput): WorkbenchPanelController {
  const [state, dispatch] = useReducer(
    reduceWorkbenchEphemeralPanelState,
    undefined,
    createWorkbenchEphemeralPanelState,
  );
  const update = useCallback(<Field extends WorkbenchEphemeralPanelStateField>(
    field: Field,
    value: WorkbenchEphemeralPanelStateUpdate<
      WorkbenchEphemeralPanelState[Field]
    >,
  ) => {
    dispatch({
      type: "update",
      field,
      update: value,
    } as Parameters<typeof dispatch>[0]);
  }, []);
  const pruneSession = useCallback((sessionId: string) => {
    dispatch({ type: "prune-session", sessionId });
  }, []);
  const commands = useMemo(() => Object.fromEntries(
    EPHEMERAL_PANEL_FIELDS.map((field) => [
      `update${capitalize(field)}`,
      (
        value: WorkbenchEphemeralPanelStateUpdate<
          WorkbenchEphemeralPanelState[typeof field]
        >,
      ) => update(field, value),
    ]),
  ) as UpdateCommands, [update]);
  const durable = useMemo<WorkbenchDurablePanelCommands>(() => ({
    apply: mutateView,
    createTab: (session, input) =>
      mutateView(
        session,
        (view) => createWorkbenchSessionViewTab(view, input),
      ),
    updateTab: (session, tabId, tab) =>
      mutateView(
        session,
        (view) => updateWorkbenchSessionViewTab(view, tabId, tab),
      ),
    patchPanel: (session, panelId, patch) =>
      mutateView(
        session,
        (view) => patchWorkbenchSessionViewPanel(view, panelId, patch),
      ),
    activateTab: (session, panelId, leafId, tabId) =>
      mutateView(
        session,
        (view) => activateWorkbenchSessionViewTab(
          view,
          panelId,
          leafId,
          tabId,
        ),
      ),
    reorderTabs: (session, input) =>
      mutateView(
        session,
        (view) => reorderWorkbenchSessionViewTabs(view, input),
      ),
    mergeLeaf: (session, input) =>
      mutateView(
        session,
        (view) => mergeWorkbenchSessionViewLeaf(view, input),
      ),
    removeTab: (session, tabId, options) =>
      mutateView(
        session,
        (view) => removeWorkbenchSessionViewTab(view, tabId, options),
      ),
    moveTab: (session, input) =>
      mutateView(
        session,
        (view) => moveWorkbenchSessionViewTab(view, input),
      ),
    splitLeaf: (session, input) =>
      mutateView(
        session,
        (view) => splitWorkbenchSessionViewLeaf(view, input),
      ),
    resizeBranch: (session, input) =>
      mutateView(
        session,
        (view) => resizeWorkbenchSessionViewBranch(view, input),
      ),
    ensureLeafToRight: (session, input) => {
      let leafId = input.leafId;
      mutateView(session, (view) => {
        const result = ensureWorkbenchSessionViewLeafToRight(view, input);
        leafId = result.leafId;
        return result.view;
      });
      return leafId;
    },
  }), [mutateView]);
  const selectRenderableTab = useCallback(({
    sessionId,
    panelId,
    leafId,
    tabId,
    durableTabIds,
  }: WorkbenchRenderableTabSelectionInput): boolean => {
    const slotKeys = [
      makeWorkbenchPanelSlotKey(sessionId, panelId, leafId),
      makeWorkbenchPanelSlotKey(sessionId, panelId),
    ];
    const candidates = [
      {
        field: "sideChatActiveTabByPanel" as const,
        tabs: state.sideChatTabsBySession[sessionId] ?? [],
      },
      {
        field: "mcpAppActiveTabByPanel" as const,
        tabs: state.mcpAppTabsBySession[sessionId] ?? [],
      },
      {
        field: "planActiveTabByPanel" as const,
        tabs: state.planTabsBySession[sessionId] ?? [],
      },
      {
        field: "automationActiveTabByPanel" as const,
        tabs: state.automationTabsBySession[sessionId] ?? [],
      },
      {
        field: "backgroundAgentActiveTabByPanel" as const,
        tabs: state.backgroundAgentTabsBySession[sessionId] ?? [],
      },
      {
        field: "processOutputActiveTabByPanel" as const,
        tabs: state.processOutputTabsBySession[sessionId] ?? [],
      },
    ];
    for (const candidate of candidates) {
      const tab = candidate.tabs.find((item) => item.id === tabId);
      if (!tab) continue;
      dispatch({
        type: "select-slot",
        slotKeys,
        activeField: candidate.field,
        tabId,
        sessionId,
        ...("planKey" in tab ? { planKey: tab.planKey } : {}),
      });
      return true;
    }
    if (!durableTabIds.has(tabId)) return false;
    dispatch({
      type: "select-slot",
      slotKeys,
      activeField: null,
      tabId: null,
      sessionId,
    });
    return true;
  }, [state]);
  const removeEphemeralTab = useCallback(({
    sessionId,
    panelId,
    leafId,
    tabId,
  }: WorkbenchEphemeralTabRemovalInput): WorkbenchEphemeralTab | null => {
    const candidates = [
      {
        tabsField: "sideChatTabsBySession" as const,
        activeField: "sideChatActiveTabByPanel" as const,
        tabs: state.sideChatTabsBySession[sessionId] ?? [],
      },
      {
        tabsField: "mcpAppTabsBySession" as const,
        activeField: "mcpAppActiveTabByPanel" as const,
        tabs: state.mcpAppTabsBySession[sessionId] ?? [],
      },
      {
        tabsField: "planTabsBySession" as const,
        activeField: "planActiveTabByPanel" as const,
        tabs: state.planTabsBySession[sessionId] ?? [],
      },
      {
        tabsField: "automationTabsBySession" as const,
        activeField: "automationActiveTabByPanel" as const,
        tabs: state.automationTabsBySession[sessionId] ?? [],
      },
      {
        tabsField: "backgroundAgentTabsBySession" as const,
        activeField: "backgroundAgentActiveTabByPanel" as const,
        tabs: state.backgroundAgentTabsBySession[sessionId] ?? [],
      },
      {
        tabsField: "processOutputTabsBySession" as const,
        activeField: "processOutputActiveTabByPanel" as const,
        tabs: state.processOutputTabsBySession[sessionId] ?? [],
      },
    ];
    for (const candidate of candidates) {
      const tab = candidate.tabs.find((item) => item.id === tabId);
      if (!tab) continue;
      const targetLeafId = tab.leafId ?? leafId;
      const slotKeys = [
        makeWorkbenchPanelSlotKey(sessionId, panelId, targetLeafId),
        makeWorkbenchPanelSlotKey(sessionId, panelId),
      ];
      dispatch({
        type: "remove-ephemeral-tab",
        tabsField: candidate.tabsField,
        activeField: candidate.activeField,
        sessionId,
        tabId,
        slotKeys,
        ...("planKey" in tab ? { planKey: tab.planKey } : {}),
      });
      return tab;
    }
    return null;
  }, [state]);
  const upsertEphemeralTab = useCallback((
    tab: WorkbenchEphemeralTab,
  ) => {
    const upsert = <Tab extends WorkbenchEphemeralTab>(
      current: readonly Tab[],
    ): Tab[] => {
      const existing = current.find(
        (candidate) => candidate.id === tab.id,
      );
      if (!existing) return [...current, tab as Tab];
      return current.map((candidate) =>
        candidate.id === tab.id
          ? {
              ...candidate,
              ...tab,
              stateKey: candidate.stateKey + 1,
            } as Tab
          : candidate
      );
    };
    let activeField:
      | "sideChatActiveTabByPanel"
      | "mcpAppActiveTabByPanel"
      | "planActiveTabByPanel"
      | "automationActiveTabByPanel"
      | "backgroundAgentActiveTabByPanel"
      | "processOutputActiveTabByPanel";
    if ("sideChat" in tab) {
      activeField = "sideChatActiveTabByPanel";
      dispatch({
        type: "update",
        field: "sideChatTabsBySession",
        update: (current) => ({
          ...current,
          [tab.sessionId]: upsert(current[tab.sessionId] ?? []),
        }),
      });
    } else if ("mcpApp" in tab) {
      activeField = "mcpAppActiveTabByPanel";
      dispatch({
        type: "update",
        field: "mcpAppTabsBySession",
        update: (current) => ({
          ...current,
          [tab.sessionId]: upsert(current[tab.sessionId] ?? []),
        }),
      });
    } else if ("planPanel" in tab) {
      activeField = "planActiveTabByPanel";
      dispatch({
        type: "update",
        field: "planTabsBySession",
        update: (current) => ({
          ...current,
          [tab.sessionId]: upsert(current[tab.sessionId] ?? []),
        }),
      });
    } else if ("automationPanel" in tab) {
      activeField = "automationActiveTabByPanel";
      dispatch({
        type: "update",
        field: "automationTabsBySession",
        update: (current) => ({
          ...current,
          [tab.sessionId]: upsert(current[tab.sessionId] ?? []),
        }),
      });
    } else if ("processOutputPanel" in tab) {
      activeField = "processOutputActiveTabByPanel";
      dispatch({
        type: "update",
        field: "processOutputTabsBySession",
        update: (current) => ({
          ...current,
          [tab.sessionId]: upsert(current[tab.sessionId] ?? []),
        }),
      });
    } else {
      activeField = "backgroundAgentActiveTabByPanel";
      dispatch({
        type: "update",
        field: "backgroundAgentTabsBySession",
        update: (current) => ({
          ...current,
          [tab.sessionId]: upsert(current[tab.sessionId] ?? []),
        }),
      });
    }
    dispatch({
      type: "select-slot",
      slotKeys: [
        makeWorkbenchPanelSlotKey(
          tab.sessionId,
          tab.panelId,
          tab.leafId,
        ),
        makeWorkbenchPanelSlotKey(tab.sessionId, tab.panelId),
      ],
      activeField,
      tabId: tab.id,
      sessionId: tab.sessionId,
      ...("planKey" in tab ? { planKey: tab.planKey } : {}),
    });
  }, []);

  return useMemo(() => ({
    ...state,
    ...commands,
    pruneSession,
    durable,
    selectRenderableTab,
    removeEphemeralTab,
    upsertEphemeralTab,
  }), [
    commands,
    durable,
    pruneSession,
    removeEphemeralTab,
    selectRenderableTab,
    state,
    upsertEphemeralTab,
  ]);
}
