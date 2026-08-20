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
import {
  activateWorkbenchSceneSurface,
  createWorkbenchSceneSurface,
  ensureWorkbenchSceneLeafToRight,
  mergeWorkbenchSceneLeaf,
  moveWorkbenchSceneSurface,
  patchWorkbenchScenePanel,
  removeWorkbenchSceneSurface,
  reorderWorkbenchSceneSurfaces,
  resizeWorkbenchSceneBranch,
  splitWorkbenchSceneLeaf,
  updateWorkbenchSceneSurface,
  type WorkbenchSceneOwner,
  type WorkbenchSceneSnapshot,
  type WorkbenchSurfaceDescriptor,
} from "../../shared/workbench-scene";
import { makeWorkbenchSessionPanelSlotKey } from "./workbench-panel-slot-key";
import type {
  AgentPanelTab,
  AutomationPanelTab,
  ImageEditorPanelTab,
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
    readonly pruneOwner: (ownerKey: string) => void;
    readonly pruneSession: (sessionId: string) => void;
    readonly durable: WorkbenchDurablePanelCommands;
    readonly sceneDurable: WorkbenchSceneDurablePanelCommands | null;
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
  | ProcessOutputPanelTab
  | ImageEditorPanelTab;

export interface WorkbenchEphemeralTabRemovalInput {
  readonly sessionId: string;
  readonly panelId: PanelId;
  readonly leafId: string;
  readonly tabId: string;
}

export interface WorkbenchPanelControllerInput {
  readonly mutateScene: (
    owner: WorkbenchSceneOwner,
    mutation: (scene: WorkbenchSceneSnapshot) => WorkbenchSceneSnapshot,
  ) => WorkbenchSceneSnapshot;
}

export interface WorkbenchSceneDurablePanelCommands {
  readonly apply: NonNullable<WorkbenchPanelControllerInput["mutateScene"]>;
  readonly createSurface: (
    owner: WorkbenchSceneOwner,
    input: Parameters<typeof createWorkbenchSceneSurface>[1],
  ) => WorkbenchSceneSnapshot;
  readonly updateSurface: (
    owner: WorkbenchSceneOwner,
    surfaceId: string,
    patch: Parameters<typeof updateWorkbenchSceneSurface>[2],
  ) => WorkbenchSceneSnapshot;
  readonly patchPanel: (
    owner: WorkbenchSceneOwner,
    panelId: Parameters<typeof patchWorkbenchScenePanel>[1],
    patch: Parameters<typeof patchWorkbenchScenePanel>[2],
  ) => WorkbenchSceneSnapshot;
  readonly activateSurface: (
    owner: WorkbenchSceneOwner,
    panelId: Parameters<typeof activateWorkbenchSceneSurface>[1],
    leafId: string,
    surfaceId?: string | null,
  ) => WorkbenchSceneSnapshot;
  readonly removeSurface: (
    owner: WorkbenchSceneOwner,
    surfaceId: string,
    options?: Parameters<typeof removeWorkbenchSceneSurface>[2],
  ) => WorkbenchSceneSnapshot;
  readonly moveSurface: (
    owner: WorkbenchSceneOwner,
    input: Parameters<typeof moveWorkbenchSceneSurface>[1],
  ) => WorkbenchSceneSnapshot;
  readonly reorderSurfaces: (
    owner: WorkbenchSceneOwner,
    input: Parameters<typeof reorderWorkbenchSceneSurfaces>[1],
  ) => WorkbenchSceneSnapshot;
  readonly splitLeaf: (
    owner: WorkbenchSceneOwner,
    input: Parameters<typeof splitWorkbenchSceneLeaf>[1],
  ) => WorkbenchSceneSnapshot;
  readonly mergeLeaf: (
    owner: WorkbenchSceneOwner,
    input: Parameters<typeof mergeWorkbenchSceneLeaf>[1],
  ) => WorkbenchSceneSnapshot;
  readonly resizeBranch: (
    owner: WorkbenchSceneOwner,
    input: Parameters<typeof resizeWorkbenchSceneBranch>[1],
  ) => WorkbenchSceneSnapshot;
  readonly ensureLeafToRight: (
    owner: WorkbenchSceneOwner,
    input: Parameters<typeof ensureWorkbenchSceneLeafToRight>[1],
  ) => string;
}

export interface WorkbenchDurablePanelCommands {
  readonly apply: (
    session: ProjectSession,
    mutation: (scene: WorkbenchSceneSnapshot) => WorkbenchSceneSnapshot,
  ) => WorkbenchSceneSnapshot;
  readonly createTab: (
    session: ProjectSession,
    input: {
      readonly panelId: PanelId;
      readonly presentation?: Parameters<typeof createWorkbenchSceneSurface>[1]["presentation"];
      readonly targetLeafId?: string;
      readonly tab: WorkbenchSurfaceDescriptor;
    },
  ) => WorkbenchSceneSnapshot;
  readonly updateTab: (
    session: ProjectSession,
    tabId: string,
    surface: WorkbenchSurfaceDescriptor,
  ) => WorkbenchSceneSnapshot;
  readonly patchPanel: (
    session: ProjectSession,
    panelId: PanelId,
    patch: Parameters<typeof patchWorkbenchScenePanel>[2],
  ) => WorkbenchSceneSnapshot;
  readonly activateTab: (
    session: ProjectSession,
    panelId: PanelId,
    leafId: string,
    tabId?: string | null,
  ) => WorkbenchSceneSnapshot;
  readonly reorderTabs: (
    session: ProjectSession,
    input: {
      readonly panelId: PanelId;
      readonly leafId: string;
      readonly orderedTabIds: string[];
    },
  ) => WorkbenchSceneSnapshot;
  readonly mergeLeaf: (
    session: ProjectSession,
    input: Parameters<typeof mergeWorkbenchSceneLeaf>[1],
  ) => WorkbenchSceneSnapshot;
  readonly removeTab: (
    session: ProjectSession,
    tabId: string,
    options?: {
      readonly preserveEmptyLeafIds?: string[];
      readonly preferredActiveLeafId?: string | null;
      readonly preferredActiveTabId?: string | null;
    },
  ) => WorkbenchSceneSnapshot;
  readonly moveTab: (
    session: ProjectSession,
    input: {
      readonly tabId: string;
      readonly targetPanelId: PanelId;
      readonly targetLeafId?: string;
      readonly targetIndex?: number;
      readonly preserveEmptyLeafIds?: string[];
      readonly splitTarget?: Parameters<typeof moveWorkbenchSceneSurface>[1]["splitTarget"];
    },
  ) => WorkbenchSceneSnapshot;
  readonly splitLeaf: (
    session: ProjectSession,
    input: {
      readonly panelId: PanelId;
      readonly leafId: string;
      readonly side: Parameters<typeof splitWorkbenchSceneLeaf>[1]["side"];
      readonly tabId?: string;
    },
  ) => WorkbenchSceneSnapshot;
  readonly resizeBranch: (
    session: ProjectSession,
    input: Parameters<typeof resizeWorkbenchSceneBranch>[1],
  ) => WorkbenchSceneSnapshot;
  readonly ensureLeafToRight: (
    session: ProjectSession,
    input: Parameters<typeof ensureWorkbenchSceneLeafToRight>[1],
  ) => string;
}

function sessionSceneOwner(session: ProjectSession): WorkbenchSceneOwner {
  return { kind: "session", sessionId: session.id };
}

function capitalize<Value extends string>(value: Value): Capitalize<Value> {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}` as Capitalize<Value>;
}

const EPHEMERAL_PANEL_FIELDS = [
  "previewTabsByPanel",
  "previewSurfacesByPanel",
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
  "imageEditorTabsBySession",
  "imageEditorActiveTabByPanel",
  "pendingProcessOutputOpen",
  "activePlanKeyBySession",
  "panelCollapsedOverrides",
] as const satisfies readonly WorkbenchEphemeralPanelStateField[];

export function useWorkbenchPanelController({
  mutateScene,
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
  const pruneOwner = useCallback((ownerKey: string) => {
    dispatch({ type: "prune-owner", ownerKey });
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
  ) as unknown as UpdateCommands, [update]);
  const durable = useMemo<WorkbenchDurablePanelCommands>(() => ({
    apply: (session, mutation) => mutateScene(sessionSceneOwner(session), mutation),
    createTab: (session, input) =>
      mutateScene(
        sessionSceneOwner(session),
        (scene) => createWorkbenchSceneSurface(scene, {
          panelId: input.panelId,
          presentation: input.presentation,
          targetLeafId: input.targetLeafId,
          surface: input.tab,
        }),
      ),
    updateTab: (session, tabId, surface) =>
      mutateScene(
        sessionSceneOwner(session),
        (scene) => updateWorkbenchSceneSurface(
          scene,
          tabId,
          surface,
        ),
      ),
    patchPanel: (session, panelId, patch) =>
      mutateScene(
        sessionSceneOwner(session),
        (scene) => patchWorkbenchScenePanel(scene, panelId, patch),
      ),
    activateTab: (session, panelId, leafId, tabId) =>
      mutateScene(
        sessionSceneOwner(session),
        (scene) => activateWorkbenchSceneSurface(
          scene,
          panelId,
          leafId,
          tabId,
        ),
      ),
    reorderTabs: (session, input) =>
      mutateScene(
        sessionSceneOwner(session),
        (scene) => reorderWorkbenchSceneSurfaces(scene, {
          panelId: input.panelId,
          leafId: input.leafId,
          orderedSurfaceIds: input.orderedTabIds,
        }),
      ),
    mergeLeaf: (session, input) =>
      mutateScene(
        sessionSceneOwner(session),
        (scene) => mergeWorkbenchSceneLeaf(scene, input),
      ),
    removeTab: (session, tabId, options) =>
      mutateScene(
        sessionSceneOwner(session),
        (scene) => removeWorkbenchSceneSurface(scene, tabId, {
          preserveEmptyLeafIds: options?.preserveEmptyLeafIds,
          preferredActiveLeafId: options?.preferredActiveLeafId,
          preferredActiveSurfaceId: options?.preferredActiveTabId,
        }),
      ),
    moveTab: (session, input) =>
      mutateScene(
        sessionSceneOwner(session),
        (scene) => moveWorkbenchSceneSurface(scene, {
          surfaceId: input.tabId,
          targetPanelId: input.targetPanelId,
          targetLeafId: input.targetLeafId,
          targetIndex: input.targetIndex,
          preserveEmptyLeafIds: input.preserveEmptyLeafIds,
          splitTarget: input.splitTarget,
        }),
      ),
    splitLeaf: (session, input) =>
      mutateScene(
        sessionSceneOwner(session),
        (scene) => splitWorkbenchSceneLeaf(scene, {
          panelId: input.panelId,
          leafId: input.leafId,
          side: input.side,
          surfaceId: input.tabId,
        }),
      ),
    resizeBranch: (session, input) =>
      mutateScene(
        sessionSceneOwner(session),
        (scene) => resizeWorkbenchSceneBranch(scene, input),
      ),
    ensureLeafToRight: (session, input) => {
      let leafId = input.leafId;
      mutateScene(sessionSceneOwner(session), (scene) => {
        const result = ensureWorkbenchSceneLeafToRight(scene, input);
        leafId = result.leafId;
        return result.scene;
      });
      return leafId;
    },
  }), [mutateScene]);
  const sceneDurable = useMemo<WorkbenchSceneDurablePanelCommands>(() => ({
      apply: mutateScene,
      createSurface: (owner, input) =>
        mutateScene(owner, (scene) => createWorkbenchSceneSurface(scene, input)),
      updateSurface: (owner, surfaceId, patch) =>
        mutateScene(
          owner,
          (scene) => updateWorkbenchSceneSurface(scene, surfaceId, patch),
        ),
      patchPanel: (owner, panelId, patch) =>
        mutateScene(
          owner,
          (scene) => patchWorkbenchScenePanel(scene, panelId, patch),
        ),
      activateSurface: (owner, panelId, leafId, surfaceId) =>
        mutateScene(
          owner,
          (scene) => activateWorkbenchSceneSurface(
            scene,
            panelId,
            leafId,
            surfaceId,
          ),
        ),
      removeSurface: (owner, surfaceId, options) =>
        mutateScene(
          owner,
          (scene) => removeWorkbenchSceneSurface(scene, surfaceId, options),
        ),
      moveSurface: (owner, input) =>
        mutateScene(owner, (scene) => moveWorkbenchSceneSurface(scene, input)),
      reorderSurfaces: (owner, input) =>
        mutateScene(
          owner,
          (scene) => reorderWorkbenchSceneSurfaces(scene, input),
        ),
      splitLeaf: (owner, input) =>
        mutateScene(owner, (scene) => splitWorkbenchSceneLeaf(scene, input)),
      mergeLeaf: (owner, input) =>
        mutateScene(owner, (scene) => mergeWorkbenchSceneLeaf(scene, input)),
      resizeBranch: (owner, input) =>
        mutateScene(
          owner,
          (scene) => resizeWorkbenchSceneBranch(scene, input),
        ),
      ensureLeafToRight: (owner, input) => {
        let leafId = input.leafId;
        mutateScene(owner, (scene) => {
          const result = ensureWorkbenchSceneLeafToRight(scene, input);
          leafId = result.leafId;
          return result.scene;
        });
        return leafId;
      },
  }), [mutateScene]);
  const selectRenderableTab = useCallback(({
    sessionId,
    panelId,
    leafId,
    tabId,
    durableTabIds,
  }: WorkbenchRenderableTabSelectionInput): boolean => {
    const slotKeys = [
      makeWorkbenchSessionPanelSlotKey(sessionId, panelId, leafId),
      makeWorkbenchSessionPanelSlotKey(sessionId, panelId),
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
      {
        field: "imageEditorActiveTabByPanel" as const,
        tabs: state.imageEditorTabsBySession[sessionId] ?? [],
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
      {
        tabsField: "imageEditorTabsBySession" as const,
        activeField: "imageEditorActiveTabByPanel" as const,
        tabs: state.imageEditorTabsBySession[sessionId] ?? [],
      },
    ];
    for (const candidate of candidates) {
      const tab = candidate.tabs.find((item) => item.id === tabId);
      if (!tab) continue;
      const targetLeafId = tab.leafId ?? leafId;
      const slotKeys = [
        makeWorkbenchSessionPanelSlotKey(sessionId, panelId, targetLeafId),
        makeWorkbenchSessionPanelSlotKey(sessionId, panelId),
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
      | "processOutputActiveTabByPanel"
      | "imageEditorActiveTabByPanel";
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
    } else if ("imageEditor" in tab) {
      activeField = "imageEditorActiveTabByPanel";
      dispatch({
        type: "update",
        field: "imageEditorTabsBySession",
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
        makeWorkbenchSessionPanelSlotKey(
          tab.sessionId,
          tab.panelId,
          tab.leafId,
        ),
        makeWorkbenchSessionPanelSlotKey(tab.sessionId, tab.panelId),
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
    pruneOwner,
    pruneSession,
    durable,
    sceneDurable,
    selectRenderableTab,
    removeEphemeralTab,
    upsertEphemeralTab,
  }), [
    commands,
    durable,
    sceneDurable,
    pruneOwner,
    pruneSession,
    removeEphemeralTab,
    selectRenderableTab,
    state,
    upsertEphemeralTab,
  ]);
}
