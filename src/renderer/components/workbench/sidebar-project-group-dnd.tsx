import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  pointerWithin,
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
import {
  sortableKeyboardCoordinates,
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { createPortal } from "react-dom";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export const SIDEBAR_GROUP_DND_PREFIX = "sidebar-group:";
export const PINNED_PROJECT_CONTAINER_ID = "pinned";
export const PINNED_PROJECT_DROPPABLE_ID = `sidebar-thread-container:${PINNED_PROJECT_CONTAINER_ID}`;

export interface SidebarGroupDndController {
  handleDragStart?: (event: DragStartEvent) => void;
  handleDragOver?: (event: DragOverEvent, pointerY: number | null) => void;
  handleDragCancel?: (event: DragCancelEvent | DragEndEvent) => void;
  handleDragEnd: (event: DragEndEvent, pointerY: number | null) => void;
}

export interface SidebarGroupDndPayload {
  kind: "sidebar-group";
  controller: SidebarGroupDndController;
  dragOverlay: ReactNode;
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
  activeProjectId: string | null;
  projectDragActive: boolean;
}

const SidebarProjectDndContext = createContext<SidebarProjectDndContextValue>({
  activeProjectId: null,
  projectDragActive: false,
});

interface SidebarProjectDragOverlayState {
  node: ReactNode;
  projectId: string;
  zoom: number;
}

interface SidebarDropRect {
  bottom: number;
  top: number;
}

export interface SidebarGroupDropTarget {
  beforeGroupId: string | null;
}

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

  const eligibleContainers = args.droppableContainers.filter((container) => {
    const payload = readSidebarDndPayload(container.data.current);
    return (
      (
        payload?.kind === "sidebar-group"
        && payload.controller === activePayload.controller
      )
      || (
        payload?.kind === "sidebar-thread-container"
        && payload.containerId === PINNED_PROJECT_CONTAINER_ID
      )
    );
  });
  const eligibleArgs = {
    ...args,
    droppableContainers: eligibleContainers,
  };
  const pointerCollisions = pointerWithin({
    ...eligibleArgs,
    droppableContainers: eligibleContainers.filter((container) =>
      readSidebarDndPayload(container.data.current)?.kind === "sidebar-group"
    ),
  });
  if (pointerCollisions.length > 0) return pointerCollisions;
  if (!args.pointerCoordinates) return closestCenter(eligibleArgs);

  const { x, y } = args.pointerCoordinates;
  return closestCenter({
    ...eligibleArgs,
    collisionRect: {
      ...args.collisionRect,
      bottom: y,
      height: 0,
      left: x,
      right: x,
      top: y,
      width: 0,
    },
  });
};

function readWindowZoom(event: Event): number {
  if (typeof window === "undefined") return 1;
  const target = event.target;
  if (!(target instanceof Element)) return 1;

  const rawZoom = window.getComputedStyle(target).getPropertyValue("--codex-window-zoom");
  const zoom = Number.parseFloat(rawZoom);
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

function sameStringOrder(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((item, index) => item === right[index]);
}

export function moveSidebarGroupBefore(
  groupIds: readonly string[],
  activeGroupId: string,
  beforeGroupId: string | null,
): string[] {
  if (!groupIds.includes(activeGroupId)) return [...groupIds];

  const remainingGroupIds = groupIds.filter((groupId) => groupId !== activeGroupId);
  const insertionIndex = beforeGroupId === null
    ? remainingGroupIds.length
    : remainingGroupIds.indexOf(beforeGroupId);
  if (insertionIndex < 0) return [...groupIds];

  return [
    ...remainingGroupIds.slice(0, insertionIndex),
    activeGroupId,
    ...remainingGroupIds.slice(insertionIndex),
  ];
}

export function resolveSidebarGroupDropTarget({
  groupIds,
  activeGroupId,
  overGroupId,
  activeRect,
  overRect,
  pointerY,
}: {
  groupIds: readonly string[];
  activeGroupId: string | null;
  overGroupId: string | null;
  activeRect: SidebarDropRect | null;
  overRect: SidebarDropRect | null;
  pointerY: number | null;
}): SidebarGroupDropTarget | null {
  if (!activeGroupId || !overGroupId) return null;
  if (activeGroupId === overGroupId) return null;
  if (!activeRect || !overRect) return null;

  const remainingGroupIds = groupIds.filter((groupId) => groupId !== activeGroupId);
  const overIndex = remainingGroupIds.indexOf(overGroupId);
  if (overIndex < 0) return null;

  const activeMidpoint = (activeRect.top + activeRect.bottom) / 2;
  const overMidpoint = (overRect.top + overRect.bottom) / 2;
  const placement = (pointerY ?? activeMidpoint) < overMidpoint ? "before" : "after";
  const beforeGroupId = remainingGroupIds[overIndex + (placement === "after" ? 1 : 0)] ?? null;
  const nextGroupIds = moveSidebarGroupBefore(groupIds, activeGroupId, beforeGroupId);
  if (sameStringOrder(groupIds, nextGroupIds)) return null;

  return { beforeGroupId };
}

export function SidebarProjectDndProvider({
  children,
  onProjectDrop,
}: {
  children: ReactNode;
  onProjectDrop?: (drop: { projectId: string; targetContainerId: string }) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const [activeProject, setActiveProject] = useState<SidebarProjectDragOverlayState | null>(null);
  const pointerYRef = useRef<number | null>(null);
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    pointerYRef.current = args.pointerCoordinates?.y ?? null;
    return sidebarProjectCollisionDetection(args);
  }, []);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const payload = readSidebarDndPayload(event.active.data.current);
    if (payload?.kind !== "sidebar-group") return;
    setActiveProject({
      node: payload.dragOverlay,
      projectId: payload.projectId,
      zoom: readWindowZoom(event.activatorEvent),
    });
    payload.controller.handleDragStart?.(event);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const payload = readSidebarDndPayload(event.active.data.current);
    if (payload?.kind !== "sidebar-group") return;
    payload.controller.handleDragOver?.(event, pointerYRef.current);
  }, []);

  const handleDragCancel = useCallback((event: DragCancelEvent) => {
    const payload = readSidebarDndPayload(event.active.data.current);
    if (payload?.kind === "sidebar-group") {
      payload.controller.handleDragCancel?.(event);
    }
    pointerYRef.current = null;
    setActiveProject(null);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const payload = readSidebarDndPayload(event.active.data.current);
    if (payload?.kind !== "sidebar-group") {
      pointerYRef.current = null;
      setActiveProject(null);
      return;
    }

    const pointerY = pointerYRef.current;
    pointerYRef.current = null;
    setActiveProject(null);
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

    payload.controller.handleDragEnd(event, pointerY);
  }, [onProjectDrop]);

  const contextValue = useMemo(
    () => ({
      activeProjectId: activeProject?.projectId ?? null,
      projectDragActive: activeProject !== null,
    }),
    [activeProject],
  );
  const overlay = typeof document === "undefined" ? null : createPortal(
    <DragOverlay
      adjustScale={false}
      className="pointer-events-none"
      dropAnimation={null}
      zIndex={2_147_483_647}
    >
      {activeProject ? (
        <div
          aria-hidden
          className="[--height-token-nav-row:30px] [--radius-token-row:10px]"
          inert
          style={{
            height: `calc(100% / ${activeProject.zoom})`,
            transform: `scale(${activeProject.zoom})`,
            transformOrigin: "top left",
            width: `calc(100% / ${activeProject.zoom})`,
          }}
        >
          <div className="w-fit max-w-80 overflow-hidden rounded-[var(--radius-token-row)] border border-token-border bg-token-bg-primary opacity-70 shadow-lg">
            {activeProject.node}
          </div>
        </div>
      ) : null}
    </DragOverlay>,
    document.body,
  );

  return (
    <SidebarProjectDndContext.Provider value={contextValue}>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragCancel={handleDragCancel}
        onDragEnd={handleDragEnd}
      >
        {children}
        {overlay}
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
  const [dropTarget, setDropTarget] = useState<SidebarGroupDropTarget | null>(null);
  const [pendingGroupIds, setPendingGroupIds] = useState<string[] | null>(null);
  const displayedGroupIds = pendingGroupIds !== null && sameStringSet(pendingGroupIds, groupIds)
    ? pendingGroupIds
    : groupIds;

  const resolveDropTarget = useCallback((
    event: DragOverEvent | DragEndEvent,
    pointerY: number | null,
  ) => resolveSidebarGroupDropTarget({
    groupIds: displayedGroupIds,
    activeGroupId: parseSidebarGroupDndId(String(event.active.id)),
    overGroupId: event.over ? parseSidebarGroupDndId(String(event.over.id)) : null,
    activeRect: event.active.rect.current.translated,
    overRect: event.over?.rect ?? null,
    pointerY,
  }), [displayedGroupIds]);

  const controller = useMemo<SidebarGroupDndController>(() => ({
    handleDragOver(event, pointerY) {
      setDropTarget(resolveDropTarget(event, pointerY));
    },
    handleDragCancel() {
      setDropTarget(null);
    },
    handleDragEnd(event, pointerY) {
      const activeId = parseSidebarGroupDndId(String(event.active.id));
      const target = resolveDropTarget(event, pointerY);
      setDropTarget(null);
      if (!activeId || !target) {
        return;
      }

      const nextGroupIds = moveSidebarGroupBefore(
        displayedGroupIds,
        activeId,
        target.beforeGroupId,
      );
      setPendingGroupIds(nextGroupIds);
      void Promise.resolve(reorderGroups(nextGroupIds))
        .catch(() => undefined)
        .finally(() => {
          setPendingGroupIds(null);
        });
    },
  }), [displayedGroupIds, reorderGroups, resolveDropTarget]);

  const dropIndicatorIndex = dropTarget === null
    ? null
    : dropTarget.beforeGroupId === null
      ? displayedGroupIds.length
      : displayedGroupIds.indexOf(dropTarget.beforeGroupId);

  return {
    controller,
    dropIndicatorIndex,
    groupIds: displayedGroupIds,
  };
}

export function useSidebarProjectDndState(): SidebarProjectDndContextValue {
  return useContext(SidebarProjectDndContext);
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

export function SidebarDropIndicator({
  compensateLayout = true,
}: {
  compensateLayout?: boolean;
}) {
  const indicator = (
    <div
      aria-hidden
      className="relative h-0 before:absolute before:top-[-1px] before:right-2 before:left-2 before:h-0.5 before:rounded-full before:bg-token-text-link-foreground before:content-[''] after:absolute after:top-[-4px] after:left-1 after:size-2 after:rounded-full after:border-2 after:border-token-text-link-foreground after:bg-token-side-bar-background after:content-['']"
      role="presentation"
    />
  );
  if (!compensateLayout) return indicator;

  return <div className="-mb-px">{indicator}</div>;
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
