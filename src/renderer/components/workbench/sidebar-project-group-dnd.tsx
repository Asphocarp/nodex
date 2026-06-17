import {
  closestCenter,
  DndContext,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragCancelEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export const SIDEBAR_GROUP_DND_PREFIX = "sidebar-group:";
export const PINNED_PROJECT_CONTAINER_ID = "pinned";
export const PINNED_PROJECT_DROPPABLE_ID = `sidebar-thread-container:${PINNED_PROJECT_CONTAINER_ID}`;

export interface SidebarGroupDndController {
  handleDragStart?: (event: DragStartEvent) => void;
  handleDragOver?: (event: DragOverEvent) => void;
  handleDragCancel?: (event: DragCancelEvent | DragEndEvent) => void;
  handleDragEnd: (event: DragEndEvent) => void;
}

export interface SidebarGroupDndPayload {
  kind: "sidebar-group";
  controller: SidebarGroupDndController;
  projectId: string;
}

export interface SidebarThreadContainerDndPayload {
  kind: "sidebar-thread-container";
  containerId: string;
}

type SidebarDndPayload =
  | SidebarGroupDndPayload
  | SidebarThreadContainerDndPayload;

interface SidebarProjectDndContextValue {
  projectDragActive: boolean;
}

const SidebarProjectDndContext = createContext<SidebarProjectDndContextValue>({
  projectDragActive: false,
});

export function getSidebarGroupDndId(projectId: string): string {
  return `${SIDEBAR_GROUP_DND_PREFIX}${projectId}`;
}

export function parseSidebarGroupDndId(id: string): string | null {
  if (!id.startsWith(SIDEBAR_GROUP_DND_PREFIX)) return null;
  const projectId = id.slice(SIDEBAR_GROUP_DND_PREFIX.length);
  return projectId.length > 0 ? projectId : null;
}

function readSidebarDndPayload(value: unknown): SidebarDndPayload | null {
  if (!value || typeof value !== "object") return null;
  const kind = Reflect.get(value, "kind");
  if (kind === "sidebar-group") return value as SidebarGroupDndPayload;
  if (kind === "sidebar-thread-container") return value as SidebarThreadContainerDndPayload;
  return null;
}

const sidebarProjectCollisionDetection: CollisionDetection = (args) => {
  const activePayload = readSidebarDndPayload(args.active.data.current);
  if (activePayload?.kind !== "sidebar-group") return closestCenter(args);

  return closestCenter({
    ...args,
    droppableContainers: args.droppableContainers.filter((container) => {
      const payload = readSidebarDndPayload(container.data.current);
      return (
        payload?.kind === "sidebar-group"
        || (
          payload?.kind === "sidebar-thread-container"
          && payload.containerId === PINNED_PROJECT_CONTAINER_ID
        )
      );
    }),
  });
};

export function SidebarProjectDndProvider({
  children,
  onProjectDrop,
}: {
  children: ReactNode;
  onProjectDrop?: (drop: { projectId: string; targetContainerId: string }) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, {
    activationConstraint: { distance: 6 },
  }));
  const [projectDragActive, setProjectDragActive] = useState(false);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const payload = readSidebarDndPayload(event.active.data.current);
    if (payload?.kind !== "sidebar-group") return;
    setProjectDragActive(true);
    payload.controller.handleDragStart?.(event);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const payload = readSidebarDndPayload(event.active.data.current);
    if (payload?.kind !== "sidebar-group") return;
    payload.controller.handleDragOver?.(event);
  }, []);

  const handleDragCancel = useCallback((event: DragCancelEvent) => {
    const payload = readSidebarDndPayload(event.active.data.current);
    if (payload?.kind === "sidebar-group") {
      payload.controller.handleDragCancel?.(event);
    }
    setProjectDragActive(false);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const payload = readSidebarDndPayload(event.active.data.current);
    if (payload?.kind !== "sidebar-group") {
      setProjectDragActive(false);
      return;
    }

    setProjectDragActive(false);
    const overPayload = readSidebarDndPayload(event.over?.data.current);
    if (
      overPayload?.kind === "sidebar-thread-container"
      && overPayload.containerId === PINNED_PROJECT_CONTAINER_ID
    ) {
      payload.controller.handleDragCancel?.(event);
      onProjectDrop?.({
        projectId: payload.projectId,
        targetContainerId: overPayload.containerId,
      });
      return;
    }

    payload.controller.handleDragEnd(event);
  }, [onProjectDrop]);

  const contextValue = useMemo(
    () => ({ projectDragActive }),
    [projectDragActive],
  );

  return (
    <SidebarProjectDndContext.Provider value={contextValue}>
      <DndContext
        sensors={sensors}
        collisionDetection={sidebarProjectCollisionDetection}
        modifiers={[restrictToVerticalAxis]}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragCancel={handleDragCancel}
        onDragEnd={handleDragEnd}
      >
        {children}
      </DndContext>
    </SidebarProjectDndContext.Provider>
  );
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  if (leftSet.size !== left.length) return false;
  const rightSet = new Set(right);
  if (rightSet.size !== right.length) return false;
  for (const item of leftSet) {
    if (!rightSet.has(item)) return false;
  }
  return true;
}

export function useSidebarGroupReorderController({
  groupIds,
  reorderGroups,
}: {
  groupIds: string[];
  reorderGroups: (nextGroupIds: string[]) => void | Promise<void>;
}): {
  controller: SidebarGroupDndController;
  dropIndicatorIndex: number | null;
  groupIds: string[];
} {
  const [dragState, setDragState] = useState<{ activeId: string | null; overId: string | null }>({
    activeId: null,
    overId: null,
  });
  const [pendingGroupIds, setPendingGroupIds] = useState<string[] | null>(null);
  const displayedGroupIds = pendingGroupIds !== null && sameStringSet(pendingGroupIds, groupIds)
    ? pendingGroupIds
    : groupIds;

  const clearDragState = useCallback(() => {
    setDragState({ activeId: null, overId: null });
  }, []);

  const controller = useMemo<SidebarGroupDndController>(() => ({
    handleDragStart(event) {
      setDragState({
        activeId: parseSidebarGroupDndId(String(event.active.id)),
        overId: null,
      });
    },
    handleDragOver(event) {
      setDragState((current) => ({
        activeId: current.activeId,
        overId: event.over ? parseSidebarGroupDndId(String(event.over.id)) : null,
      }));
    },
    handleDragCancel() {
      clearDragState();
    },
    handleDragEnd(event) {
      const activeId = parseSidebarGroupDndId(String(event.active.id));
      const overId = event.over ? parseSidebarGroupDndId(String(event.over.id)) : null;
      if (!activeId || !overId || activeId === overId) {
        clearDragState();
        return;
      }

      const activeIndex = displayedGroupIds.indexOf(activeId);
      const overIndex = displayedGroupIds.indexOf(overId);
      if (activeIndex === -1 || overIndex === -1) {
        clearDragState();
        return;
      }

      const nextGroupIds = arrayMove(displayedGroupIds, activeIndex, overIndex);
      setPendingGroupIds(nextGroupIds);
      void Promise.resolve(reorderGroups(nextGroupIds))
        .catch(() => undefined)
        .finally(() => {
          setPendingGroupIds(null);
        });
      clearDragState();
    },
  }), [clearDragState, displayedGroupIds, reorderGroups]);

  let dropIndicatorIndex: number | null = null;
  if (dragState.activeId && dragState.overId && dragState.activeId !== dragState.overId) {
    const activeIndex = displayedGroupIds.indexOf(dragState.activeId);
    const overIndex = displayedGroupIds.indexOf(dragState.overId);
    if (activeIndex !== -1 && overIndex !== -1) {
      dropIndicatorIndex = activeIndex < overIndex ? overIndex + 1 : overIndex;
    }
  }

  return {
    controller,
    dropIndicatorIndex,
    groupIds: displayedGroupIds,
  };
}

export function SidebarProjectSortableContext({
  groupIds,
  children,
}: {
  groupIds: string[];
  children: ReactNode;
}) {
  return (
    <SortableContext
      items={groupIds.map(getSidebarGroupDndId)}
      strategy={verticalListSortingStrategy}
    >
      {children}
    </SortableContext>
  );
}

export function usePinnedProjectDroppable() {
  const { projectDragActive } = useContext(SidebarProjectDndContext);
  const payload = useMemo<SidebarThreadContainerDndPayload>(
    () => ({ kind: "sidebar-thread-container", containerId: PINNED_PROJECT_CONTAINER_ID }),
    [],
  );
  const droppable = useDroppable({
    id: PINNED_PROJECT_DROPPABLE_ID,
    disabled: !projectDragActive,
    data: payload,
  });

  return {
    ...droppable,
    projectDragActive,
  };
}

export function SidebarDropIndicator() {
  return (
    <div
      aria-hidden
      className="relative h-0 before:absolute before:inset-x-2 before:top-0 before:h-0 before:border-t before:border-token-border/80 before:content-['']"
      role="presentation"
    />
  );
}

export function replaceVisibleOrder(
  currentIds: readonly string[],
  visibleIds: readonly string[],
  nextVisibleIds: readonly string[],
): string[] {
  if (!sameStringSet(visibleIds, nextVisibleIds)) return [...currentIds];
  const visibleIdSet = new Set(visibleIds);
  let nextIndex = 0;
  return currentIds.map((projectId) => {
    if (!visibleIdSet.has(projectId)) return projectId;
    const nextProjectId = nextVisibleIds[nextIndex];
    nextIndex += 1;
    return nextProjectId ?? projectId;
  });
}
