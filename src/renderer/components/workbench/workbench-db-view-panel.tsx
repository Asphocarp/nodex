import { CanvasIcon, BoardIcon, DatabaseIcon } from "@/components/shared/icons";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type RefObject,
} from "react";
import { NodexIconButton } from "@/components/ui/button";
import type { WorkbenchTabProjection } from "@/lib/types";
import { useBoard, type DatabaseViewBoardPageDropIntent } from "@/lib/use-board";
import type { DatabaseViewRenderModel } from "@/lib/database-view-render-model";
import type {
  DatabaseViewField,
  DatabaseViewLayout,
  EffectiveDatabaseViewPresentation,
} from "../../../shared/database-kernel";
import {
  compactDatabaseViewPresentationOverride,
  resolveEffectiveDatabaseView,
} from "../../../shared/database-view-presentation";
import type { ColumnPaginationState } from "@/lib/board-store";
import type { DatabaseViewDisclosureTargetV2 } from "../../../shared/database-module-v2";
import { DatabaseManagementDialogController } from "./database-management-dialog-controller";
import { DbViewToolbar, type DbViewToolbarItem } from "./db-view-toolbar";
import { DatabaseViewSurface } from "./database-view-surface";
import { DatabaseList } from "./database-list/database-list";
import { DatabaseViewDisplayOptions } from "./database-view-display-options";
import { DatabaseViewFilter } from "./database-view-filter";
import { DatabaseViewSort } from "./database-view-sort";
import { DatabaseViewRulesSummaryRow } from "./database-view-rules-summary-row";
import { usePropertyOptionRegistries } from "@/components/database/use-property-option-registries";
import { collectRequiredPropertyOptionIds } from "@/lib/database-option-registry-requirements";
import { useDatabaseViewPresentationPreference } from "@/lib/database-view-presentation-preferences";
import { commitDatabaseViewOperations } from "@/lib/database-view-row-mutations";
import type { OpenPageTabHandler } from "./workbench-page-stage-panel";
import { primaryCanvasBlockId } from "../../../shared/block-documents";
import type { OpenCanvasStageHandler } from "@/lib/use-workbench-panel-openers";
import { supportedDatabaseIntrinsicFields } from "@/lib/database-intrinsic-field-registry";
import type { Project } from "@/lib/types";
import type { OpenPageInNewChatInput, SendPageToChatInput } from "@/lib/page-chat-actions";
import { appScope, useScopeHandle } from "@/lib/maitai";
import { materializePageCreateTarget } from "@/lib/page-create-target";
import {
  markPageCreateTargetActive,
  registerPageCreateTarget,
  unregisterPageCreateTarget,
} from "@/lib/page-create-target-registry";
import { requestPageCreate } from "@/lib/page-create-workflow";
import { toast } from "@/components/ui/toast";
import { isWorkflowStatus } from "../../../shared/workflow-status";
import {
  useDatabaseViewMutationHistory,
  type DatabaseViewMutationHistory,
} from "./database-view-mutation-history";
import type { DatabaseViewPageActionPort } from "./database-view-page-actions";
import type { DatabaseViewPageOpenHandler } from "./database-view-page-open";
import {
  DatabasePageChatActivityBoundary,
  useDatabasePageChatActivityRuntime,
} from "./database-page-chat-activity-runtime";

const DB_VIEW_TABS: Array<{
  id: "board" | "list";
  label: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  { id: "board", label: "Board", icon: BoardIcon },
  { id: "list", label: "List", icon: DatabaseIcon },
];

const EMPTY_DATABASE_PROPERTIES = [] as const;

const durableDatabaseToolbarItem = (
  model: DatabaseViewRenderModel,
  presentationLayout: DatabaseViewLayout = model.query.view.defaultLayout,
): DbViewToolbarItem => {
  const presentationId = presentationLayout;
  const item = DB_VIEW_TABS.find((candidate) => candidate.id === presentationId);
  return {
    id: presentationId,
    label: item?.label ?? model.viewName,
    icon: item?.icon ?? DatabaseIcon,
    active: true,
    onSelect: () => undefined,
  };
};

export function DatabaseViewTabSurface({
  ...props
}: Parameters<typeof DatabaseViewTabSurfaceContent>[0]) {
  return (
    <DatabasePageChatActivityBoundary model={props.model}>
      <DatabaseViewTabSurfaceContent {...props} />
    </DatabasePageChatActivityBoundary>
  );
}

function DatabaseViewTabSurfaceContent({
  model,
  presentationLayout = model.query.view.defaultLayout,
  effectivePresentation,
  toolbarItems,
  destinationItems,
  groupPagination,
  onLoadMoreGroup,
  activeSearchQuery,
  taskSearchOpen,
  searchShortcutLabel,
  taskSearchInputRef,
  managementControl,
  databaseViewControls,
  rulesSummaryRow,
  overlay,
  onSearchQueryChange,
  onOpenTaskSearch,
  onCloseTaskSearch,
  onOpenPage,
  pageActionPort,
  onCommitted,
  onMoveBoardPages,
  keyboardSurface,
  presentedPageIds,
  initialSelectedPageIds,
  onSelectedPageIdsChange,
  collapsedOccurrenceKeys,
  onOccurrenceDisclosureChange,
  forcedDisplayField,
  pageCreateSurfaceId,
  onRequestCreatePage,
  mutationHistory: providedMutationHistory,
}: {
  readonly model: DatabaseViewRenderModel;
  readonly presentationLayout?: DatabaseViewLayout;
  readonly effectivePresentation?: EffectiveDatabaseViewPresentation;
  readonly toolbarItems?: DbViewToolbarItem[];
  readonly destinationItems?: DbViewToolbarItem[];
  readonly groupPagination?: ReadonlyMap<string, ColumnPaginationState>;
  readonly onLoadMoreGroup?: (scopeKey: string) => Promise<void> | void;
  readonly activeSearchQuery: string;
  readonly taskSearchOpen: boolean;
  readonly searchShortcutLabel: string;
  readonly taskSearchInputRef: RefObject<HTMLInputElement | null>;
  readonly managementControl?: ReactNode;
  readonly databaseViewControls?: ReactNode;
  readonly rulesSummaryRow?: ReactNode;
  readonly overlay?: ReactNode;
  readonly onSearchQueryChange: (value: string) => void;
  readonly onOpenTaskSearch: (selectQuery?: boolean) => void;
  readonly onCloseTaskSearch: () => void;
  readonly onOpenPage: DatabaseViewPageOpenHandler;
  readonly pageActionPort?: DatabaseViewPageActionPort;
  readonly onCommitted?: () => void | Promise<void>;
  readonly onMoveBoardPages?: (input: DatabaseViewBoardPageDropIntent) => Promise<boolean>;
  readonly keyboardSurface?: {
    readonly surfaceId: string;
    readonly presentationId: string;
  };
  readonly presentedPageIds?: ReadonlySet<string>;
  readonly initialSelectedPageIds?: ReadonlySet<string>;
  readonly onSelectedPageIdsChange?: (pageIds: ReadonlySet<string>) => void;
  readonly collapsedOccurrenceKeys?: readonly string[];
  readonly onOccurrenceDisclosureChange?: (
    target: DatabaseViewDisclosureTargetV2,
    collapsed: boolean,
  ) => void;
  readonly forcedDisplayField?: DatabaseViewField | null;
  readonly pageCreateSurfaceId?: string;
  readonly onRequestCreatePage?: (groupKey: string) => void;
  readonly mutationHistory?: DatabaseViewMutationHistory;
}) {
  const pageChatRuntime = useDatabasePageChatActivityRuntime();
  const localMutationHistory = useDatabaseViewMutationHistory(
    `${model.storeEpoch}:${model.databaseViewId}`,
  );
  const mutationHistory = providedMutationHistory ?? localMutationHistory;
  const presentation = effectivePresentation ?? {
    layout: presentationLayout,
    presentation: model.query.view.config.presentation,
  };
  const activeToolbarItems = toolbarItems ?? [
    durableDatabaseToolbarItem(model, presentation.layout),
  ];
  return (
    <div className="flex h-full min-h-0 flex-col bg-token-main-surface-primary">
      <DbViewToolbar
        items={activeToolbarItems}
        destinationItems={destinationItems}
        activeSearchQuery={activeSearchQuery}
        taskSearchOpen={taskSearchOpen}
        showSearchControls
        searchShortcutLabel={searchShortcutLabel}
        taskSearchInputRef={taskSearchInputRef}
        managementControl={managementControl}
        databaseViewControls={databaseViewControls}
        rulesSummaryRow={rulesSummaryRow}
        onSearchQueryChange={onSearchQueryChange}
        onOpenTaskSearch={onOpenTaskSearch}
        onCloseTaskSearch={onCloseTaskSearch}
      />
      {overlay}
      <div className="min-h-0 flex-1 overflow-hidden">
        {presentation.layout === "list" ? (
          <DatabaseList
            model={model}
            effectivePresentation={presentation}
            groupPagination={groupPagination}
            onLoadMoreGroup={onLoadMoreGroup}
            searchQuery={activeSearchQuery}
            onOpenPage={onOpenPage}
            pageActionPort={pageActionPort}
            onCommitted={onCommitted}
            presentedPageIds={presentedPageIds}
            initialSelectedPageIds={initialSelectedPageIds}
            onSelectedPageIdsChange={onSelectedPageIdsChange}
            collapsedOccurrenceKeys={collapsedOccurrenceKeys}
            onOccurrenceDisclosureChange={onOccurrenceDisclosureChange}
            forcedDisplayField={forcedDisplayField}
            pageCreateSurfaceId={pageCreateSurfaceId}
            onRequestCreatePage={onRequestCreatePage}
            scrollStateKey={`database-view:${model.databaseViewId}:list`}
            mutationHistory={mutationHistory}
            pageChatActivityByPageId={pageChatRuntime.activityByPageId}
            onRemovePageChatRelation={pageChatRuntime.removeRelation}
          />
        ) : (
          <DatabaseViewSurface
            model={model}
            effectivePresentation={presentation}
            groupPagination={groupPagination}
            onLoadMoreGroup={onLoadMoreGroup}
            searchQuery={activeSearchQuery}
            onOpenPage={onOpenPage}
            pageActionPort={pageActionPort}
            onCommitted={onCommitted}
            onMoveBoardPages={onMoveBoardPages}
            keyboardSurface={keyboardSurface}
            presentedPageIds={presentedPageIds}
            initialSelectedPageIds={initialSelectedPageIds}
            onSelectedPageIdsChange={onSelectedPageIdsChange}
            pageCreateSurfaceId={pageCreateSurfaceId}
            onRequestCreatePage={onRequestCreatePage}
            mutationHistory={mutationHistory}
          />
        )}
      </div>
    </div>
  );
}

export function DbViewSessionTab({
  sessionId,
  tab,
  projects,
  activeSearchQuery,
  searchByProject,
  presentedPageIds,
  taskSearchOpenTick,
  setSearchQuery,
  onOpenPageTab,
  onOpenPageInNewChat,
  onOpenRelatedChat,
  onSendPageToChat,
  onOpenCanvasStage,
  targetLeafId,
}: {
  readonly sessionId: string;
  readonly tab: WorkbenchTabProjection;
  readonly projects: Project[];
  readonly activeSearchQuery: string;
  readonly searchByProject: Readonly<Record<string, string>>;
  readonly presentedPageIds: ReadonlySet<string>;
  readonly pageStageCloseRef: RefObject<(() => Promise<void>) | null>;
  readonly taskSearchOpenTick: number;
  readonly setSearchQuery: (projectId: string, value: string) => void;
  readonly onOpenPageTab: OpenPageTabHandler;
  readonly onOpenPageInNewChat?: (input: OpenPageInNewChatInput) => Promise<void> | void;
  readonly onOpenRelatedChat?: (sessionId: string) => Promise<void> | void;
  readonly onSendPageToChat?: (input: SendPageToChatInput) => Promise<void> | void;
  readonly onOpenCanvasStage: OpenCanvasStageHandler;
  readonly targetLeafId: string;
}) {
  if (tab.kind !== "db_view") {
    throw new Error("Database view tabs require a db_view descriptor");
  }
  const { projectId, databaseViewId } = tab.config;
  const appHandle = useScopeHandle(appScope);
  const surfaceId = `database-view:${sessionId}:${tab.id}:${databaseViewId}`;
  const listClientSessionId = `${tab.id}:database-view`;
  const [listPageCreateRegistrationToken] = useState(() => crypto.randomUUID());
  const personalPreference = useDatabaseViewPresentationPreference(
    projectId,
    String(databaseViewId),
  );
  const presentationOverride = personalPreference.presentationOverride;
  const synchronizePreferenceStoreEpoch = personalPreference.synchronizeStoreEpoch;
  const runtime = useBoard({
    projectId,
    databaseViewId,
    sessionId: listClientSessionId,
    presentationOverride,
    presentationOverrideReady: !personalPreference.loading,
    enabled: !personalPreference.loading,
  });
  const databaseView = runtime.databaseView;
  const mutationHistory = useDatabaseViewMutationHistory(
    `${databaseView?.storeEpoch ?? "pending"}:${databaseViewId}`,
  );
  const [publishingPresentation, setPublishingPresentation] = useState(false);
  const [taskSearchOpen, setTaskSearchOpen] = useState(false);
  const [databaseManagerOpen, setDatabaseManagerOpen] = useState(false);
  const [openViewPanel, setOpenViewPanel] = useState<"filter" | "sort" | "display" | null>(null);
  const ruleOptionRequirements = useMemo(
    () =>
      databaseView
        ? collectRequiredPropertyOptionIds({
            properties: databaseView.query.properties,
            rows: databaseView.query.rows,
            filter: databaseView.query.view.config.filter,
          })
        : {},
    [databaseView],
  );
  const ruleOptionRegistries = usePropertyOptionRegistries({
    accessContext: databaseView?.accessContext ?? { kind: "project", projectId },
    properties: databaseView?.query.properties ?? EMPTY_DATABASE_PROPERTIES,
    requiredOptionIds: ruleOptionRequirements,
  });
  const [selectedPageIds, setSelectedPageIds] = useState<ReadonlySet<string>>(() => new Set());
  const [forcedDisplayField, setForcedDisplayField] = useState<DatabaseViewField | null>(null);
  useEffect(() => {
    if (openViewPanel !== "display") setForcedDisplayField(null);
  }, [openViewPanel]);
  const taskSearchInputRef = useRef<HTMLInputElement | null>(null);
  const lastHandledTaskSearchOpenTickRef = useRef(taskSearchOpenTick);
  const searchQuery =
    searchByProject[projectId] ?? (projectId === tab.projectId ? activeSearchQuery : "");
  const presentationCapabilities = useMemo(
    () => ({
      properties:
        databaseView?.query.properties.map((property) => ({
          propertyId: property.propertyId,
          sortable: property.capabilities.sortable,
          groupable: property.capabilities.groupable,
          finite: property.valueType === "select" || property.valueType === "checkbox",
        })) ?? [],
      intrinsicFields: supportedDatabaseIntrinsicFields(),
      ...(databaseView?.query.properties.some((property) => property.propertyId === "status")
        ? { taskStatusPropertyId: "status" }
        : {}),
    }),
    [databaseView],
  );
  const durableEffectivePresentation = useMemo(
    () =>
      databaseView
        ? resolveEffectiveDatabaseView(
            databaseView.query.view.defaultLayout,
            databaseView.query.view.config.presentation,
            undefined,
            presentationCapabilities,
          )
        : null,
    [databaseView, presentationCapabilities],
  );
  const effectivePresentation = useMemo(
    () =>
      databaseView
        ? resolveEffectiveDatabaseView(
            databaseView.query.view.defaultLayout,
            databaseView.query.view.config.presentation,
            presentationOverride,
            presentationCapabilities,
          )
        : null,
    [databaseView, presentationCapabilities, presentationOverride],
  );
  const currentProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projectId, projects],
  );
  const listPageCreateTarget = useMemo(
    () =>
      currentProject
        ? materializePageCreateTarget({
            surfaceId,
            panelTabId: tab.id,
            project: currentProject,
            databaseView,
            board: runtime.board,
            clientSessionId: listClientSessionId,
          })
        : null,
    [currentProject, databaseView, listClientSessionId, runtime.board, surfaceId, tab.id],
  );
  useEffect(() => {
    if (!listPageCreateTarget) {
      unregisterPageCreateTarget(appHandle, surfaceId, listPageCreateRegistrationToken);
      return;
    }
    registerPageCreateTarget(appHandle, listPageCreateRegistrationToken, listPageCreateTarget);
    return () => unregisterPageCreateTarget(appHandle, surfaceId, listPageCreateRegistrationToken);
  }, [
    appHandle,
    effectivePresentation?.layout,
    listPageCreateRegistrationToken,
    listPageCreateTarget,
    surfaceId,
  ]);
  const requestListPageCreate = useCallback(
    (groupKey: string) => {
      if (!isWorkflowStatus(groupKey)) return;
      if (!listPageCreateTarget) {
        toast.danger("Page creation is unavailable until the Project is loaded.");
        return;
      }
      if (listPageCreateTarget.readOnlyReason) {
        toast.danger(listPageCreateTarget.readOnlyReason);
        return;
      }
      markPageCreateTargetActive(appHandle, surfaceId, groupKey);
      requestPageCreate(appHandle, {
        target: listPageCreateTarget,
        origin: {
          surfaceId,
          panelTabId: tab.id,
          projectId,
          databaseViewId,
          kind: "header",
          columnId: groupKey,
        },
      });
    },
    [appHandle, databaseViewId, listPageCreateTarget, projectId, surfaceId, tab.id],
  );
  useEffect(() => {
    if (!databaseView) return;
    synchronizePreferenceStoreEpoch(databaseView.storeEpoch);
  }, [databaseView, synchronizePreferenceStoreEpoch]);
  const updateEffectivePresentation = useCallback(
    (next: EffectiveDatabaseViewPresentation) => {
      if (!durableEffectivePresentation) return;
      const nextOverride = compactDatabaseViewPresentationOverride(
        durableEffectivePresentation,
        next,
      );
      runtime.setPresentationOverride(nextOverride);
      void personalPreference.setPresentationOverride(nextOverride);
    },
    [durableEffectivePresentation, personalPreference, runtime],
  );
  const publishEffectivePresentation = useCallback(async () => {
    if (
      !databaseView ||
      !effectivePresentation ||
      !durableEffectivePresentation ||
      publishingPresentation
    )
      return;
    setPublishingPresentation(true);
    try {
      const currentPresentation = await personalPreference.flushPresentation();
      const receipt = await commitDatabaseViewOperations({
        model: databaseView,
        operations: [
          {
            kind: "put_view",
            databaseId: databaseView.databaseId,
            dataSourceId: databaseView.dataSourceId,
            viewId: databaseView.databaseViewId,
            expectedRevision: databaseView.query.view.revision,
            name: databaseView.query.view.name,
            defaultLayout: effectivePresentation.layout,
            config: {
              ...databaseView.query.view.config,
              presentation: effectivePresentation.presentation,
            },
            isDefault: databaseView.query.view.isDefault,
          },
          {
            kind: "put_view_personal_presentation",
            viewId: databaseView.databaseViewId,
            expectedRevision: currentPresentation.revision,
            presentationOverride: {},
          },
        ],
      });
      const preferenceRevision = receipt
        ? (Object.entries(receipt.committedRevisions).find(
            ([key]) =>
              key.startsWith("view_presentation:") &&
              key.endsWith(`:${databaseView.databaseViewId}`),
          )?.[1] ?? currentPresentation.revision)
        : currentPresentation.revision;
      personalPreference.acceptPresentationCommitted({
        presentationOverride: null,
        revision: preferenceRevision,
        commitSeq: receipt?.commitSeq ?? databaseView.commitSeq,
      });
      await runtime.refresh();
    } finally {
      setPublishingPresentation(false);
    }
  }, [
    databaseView,
    durableEffectivePresentation,
    effectivePresentation,
    publishingPresentation,
    personalPreference,
    runtime,
  ]);
  const openTaskSearch = useCallback((selectQuery = false) => {
    setTaskSearchOpen(true);
    window.requestAnimationFrame(() => {
      const input = taskSearchInputRef.current;
      input?.focus();
      if (selectQuery) input?.select();
    });
  }, []);

  useEffect(() => {
    if (taskSearchOpenTick <= 0 || taskSearchOpenTick === lastHandledTaskSearchOpenTickRef.current)
      return;
    lastHandledTaskSearchOpenTickRef.current = taskSearchOpenTick;
    openTaskSearch(true);
  }, [openTaskSearch, taskSearchOpenTick]);

  if (!databaseView || !effectivePresentation || !durableEffectivePresentation) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-token-description-foreground">
        {runtime.error ?? "Opening Database…"}
      </div>
    );
  }

  const toolbarItems = DB_VIEW_TABS.map((item) => {
    const layout = item.id;
    return {
      id: item.id,
      label: item.label,
      icon: item.icon,
      active: effectivePresentation.layout === layout,
      onSelect: () =>
        updateEffectivePresentation({
          ...effectivePresentation,
          layout,
        }),
    };
  });
  const searchShortcutLabel =
    typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC")
      ? "⌘F"
      : "Ctrl+F";
  const pageActionPort: DatabaseViewPageActionPort = {
    ...(onOpenPageInNewChat ? { openInNewChat: onOpenPageInNewChat } : {}),
    ...(onOpenRelatedChat ? { openRelatedChat: onOpenRelatedChat } : {}),
    ...(onSendPageToChat ? { sendToChat: onSendPageToChat } : {}),
    deletePage: async ({ pageId }) => {
      const deleted = await runtime.deletePage(undefined, pageId);
      if (!deleted) throw new Error(`Page ${pageId} delete did not commit`);
    },
  };

  return (
    <DatabaseViewTabSurface
      model={databaseView}
      presentationLayout={effectivePresentation.layout}
      effectivePresentation={effectivePresentation}
      forcedDisplayField={forcedDisplayField}
      toolbarItems={toolbarItems}
      destinationItems={[
        {
          id: "primary-canvas",
          label: "Canvas",
          icon: CanvasIcon,
          onSelect: () => {
            void onOpenCanvasStage(projectId, primaryCanvasBlockId(projectId), "Canvas", {
              targetPanelId: tab.panelId,
              targetLeafId,
            });
          },
        },
      ]}
      groupPagination={runtime.groupPagination}
      onLoadMoreGroup={runtime.loadMoreGroup}
      activeSearchQuery={searchQuery}
      taskSearchOpen={taskSearchOpen}
      searchShortcutLabel={searchShortcutLabel}
      taskSearchInputRef={taskSearchInputRef}
      managementControl={
        <NodexIconButton
          icon={DatabaseIcon}
          size="sm"
          active={databaseManagerOpen}
          ariaLabel="Manage Databases"
          title="Manage Databases"
          onClick={() => setDatabaseManagerOpen(true)}
        />
      }
      databaseViewControls={
        <>
          <DatabaseViewFilter
            model={databaseView}
            optionRegistries={ruleOptionRegistries.options}
            onRequestPropertyOptions={ruleOptionRegistries.requestOptions}
            onCommitted={runtime.refresh}
            open={openViewPanel === "filter"}
            onOpenChange={(open) => setOpenViewPanel(open ? "filter" : null)}
          />
          <DatabaseViewSort
            effective={effectivePresentation}
            properties={databaseView.query.properties}
            busy={publishingPresentation || personalPreference.saving}
            open={openViewPanel === "sort"}
            onOpenChange={(open) => setOpenViewPanel(open ? "sort" : null)}
            onChange={updateEffectivePresentation}
          />
          <DatabaseViewDisplayOptions
            effective={effectivePresentation}
            durable={durableEffectivePresentation}
            properties={databaseView.query.properties}
            busy={publishingPresentation || personalPreference.loading || personalPreference.saving}
            error={personalPreference.error}
            open={openViewPanel === "display"}
            onOpenChange={(open) => setOpenViewPanel(open ? "display" : null)}
            onChange={updateEffectivePresentation}
            onReset={() => void personalPreference.setPresentationOverride(null)}
            onPublish={publishEffectivePresentation}
            onForcedFieldChange={setForcedDisplayField}
          />
        </>
      }
      rulesSummaryRow={
        <DatabaseViewRulesSummaryRow
          filter={databaseView.query.view.config.filter}
          effective={effectivePresentation}
          properties={databaseView.query.properties}
          optionRegistries={ruleOptionRegistries.options}
          onOpenFilter={() => setOpenViewPanel("filter")}
          onOpenSort={() => setOpenViewPanel("sort")}
        />
      }
      overlay={
        <DatabaseManagementDialogController
          projectId={projectId}
          initialDatabaseId={databaseView.databaseId}
          open={databaseManagerOpen}
          onOpenChange={setDatabaseManagerOpen}
        />
      }
      onSearchQueryChange={(value) => setSearchQuery(projectId, value)}
      onOpenTaskSearch={openTaskSearch}
      onCloseTaskSearch={() => setTaskSearchOpen(false)}
      onOpenPage={(pageId, titleSnapshot, openMode) => {
        void onOpenPageTab(projectId, pageId, titleSnapshot, {
          sourceTabId: tab.id,
          openMode,
        });
      }}
      pageActionPort={pageActionPort}
      onCommitted={runtime.refresh}
      onMoveBoardPages={runtime.moveDatabaseViewPages}
      keyboardSurface={{ surfaceId, presentationId: tab.id }}
      presentedPageIds={presentedPageIds}
      initialSelectedPageIds={selectedPageIds}
      onSelectedPageIdsChange={setSelectedPageIds}
      collapsedOccurrenceKeys={personalPreference.collapsedOccurrenceKeys}
      onOccurrenceDisclosureChange={(target, collapsed) => {
        void personalPreference.setOccurrenceDisclosure(target, collapsed);
      }}
      pageCreateSurfaceId={surfaceId}
      onRequestCreatePage={requestListPageCreate}
      mutationHistory={mutationHistory}
    />
  );
}
