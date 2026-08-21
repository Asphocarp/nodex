import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  pointerWithin,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragCancelEvent,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  PINNED_PROJECT_CONTAINER_ID,
  readSidebarGroupDndPayload,
  SidebarProjectDndStateProvider,
} from "./sidebar-project-group-dnd";
import {
  createSidebarThreadCollisionDetection,
  dispatchSidebarThreadDragEnd,
  readSidebarThreadDndPayload,
  reconcilePendingSidebarThreadDrops,
  SidebarThreadDndStateProvider,
  type PendingSidebarThreadDrop,
  type SidebarThreadCanonicalLanes,
  type SidebarThreadDndThread,
  type SidebarThreadDropCommit,
  type SidebarThreadDropRequest,
  type SidebarThreadReorderController,
} from "./sidebar-thread-reorder";
import {
  readSidebarLibraryDragResource,
  readSidebarLibraryOwnershipDropTarget,
  resolveSidebarLibraryDropDecision,
  type SidebarLibraryDragResource,
} from "./sidebar-library-dnd";
import type { LibraryWriteParent } from "../../../shared/library-module";

const EMPTY_HOME_CONTAINER_IDS: ReadonlyMap<string, string> = new Map();
const DEFAULT_GET_THREAD_ID = (threadKey: string): string => threadKey;
const DEFAULT_PROJECT_ERROR_REPORTER = (error: unknown): void => {
  console.error("Sidebar project reorder failed", error);
};
const DEFAULT_THREAD_ERROR_REPORTER = (error: unknown): void => {
  console.error("Sidebar task reorder failed", error);
};
const DEFAULT_THREAD_DROP = (): null => null;
const EMPTY_CANONICAL_THREAD_LANES: SidebarThreadCanonicalLanes = new Map();

type ActiveSidebarDrag =
  | {
      kind: "project";
      node: ReactNode;
      projectId: string;
      zoom: number;
    }
  | {
      kind: "thread";
      node: ReactNode;
      thread: SidebarThreadDndThread;
      zoom: number;
    }
  | {
      kind: "library";
      node: ReactNode;
      resource: SidebarLibraryDragResource;
      zoom: number;
    };

function readWindowZoom(event: Event): number {
  if (typeof window === "undefined") return 1;
  const target = event.target;
  if (!(target instanceof Element)) return 1;

  const rawZoom = window.getComputedStyle(target).getPropertyValue("--codex-window-zoom");
  const zoom = Number.parseFloat(rawZoom);
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

function clearTextSelection(): void {
  if (typeof document === "undefined") return;
  document.getSelection()?.removeAllRanges();
}

const sidebarProjectCollisionDetection: CollisionDetection = (args) => {
  const activePayload = readSidebarGroupDndPayload(args.active.data.current);
  if (!activePayload) return closestCenter(args);

  const eligibleContainers = args.droppableContainers.filter((container) => {
    const projectPayload = readSidebarGroupDndPayload(container.data.current);
    const threadPayload = readSidebarThreadDndPayload(container.data.current);
    return (
      (projectPayload !== null && projectPayload.controller === activePayload.controller) ||
      (threadPayload?.kind === "sidebar-thread-container" &&
        threadPayload.containerId === PINNED_PROJECT_CONTAINER_ID)
    );
  });
  const eligibleArgs = {
    ...args,
    droppableContainers: eligibleContainers,
  };
  const pointerCollisions = pointerWithin({
    ...eligibleArgs,
    droppableContainers: eligibleContainers.filter(
      (container) => readSidebarGroupDndPayload(container.data.current) !== null,
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

export function SidebarReorderDndProvider({
  children,
  getThreadIdByThreadKey = DEFAULT_GET_THREAD_ID,
  homeContainerIdByThreadId = EMPTY_HOME_CONTAINER_IDS,
  onProjectError = DEFAULT_PROJECT_ERROR_REPORTER,
  onProjectDrop,
  onThreadError = DEFAULT_THREAD_ERROR_REPORTER,
  onThreadDrop = DEFAULT_THREAD_DROP,
  onLibraryMove,
  onLibraryGrant,
}: {
  children: ReactNode;
  getThreadIdByThreadKey?: (threadKey: string) => string | null;
  homeContainerIdByThreadId?: ReadonlyMap<string, string>;
  onProjectError?: (error: unknown) => void;
  onProjectDrop?: (drop: { projectId: string; targetContainerId: string }) => void;
  onThreadError?: (error: unknown) => void;
  onThreadDrop?: (
    drop: SidebarThreadDropRequest,
  ) => Promise<SidebarThreadDropCommit | null> | SidebarThreadDropCommit | null;
  onLibraryMove?: (drop: {
    resource: SidebarLibraryDragResource;
    parent: LibraryWriteParent;
  }) => void | Promise<void>;
  onLibraryGrant?: (drop: { resource: SidebarLibraryDragResource; projectId: string }) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const [activeDrag, setActiveDrag] = useState<ActiveSidebarDrag | null>(null);
  const [pendingThreadDrops, setPendingThreadDrops] = useState<PendingSidebarThreadDrop[]>([]);
  const canonicalThreadLanesRef = useRef<SidebarThreadCanonicalLanes>(EMPTY_CANONICAL_THREAD_LANES);
  const pointerYRef = useRef<number | null>(null);
  const destinationControllerRef = useRef<SidebarThreadReorderController | null>(null);
  const updatePendingThreadDrops = useCallback(
    (update: (current: PendingSidebarThreadDrop[]) => PendingSidebarThreadDrop[]) => {
      setPendingThreadDrops((current) =>
        reconcilePendingSidebarThreadDrops(update(current), canonicalThreadLanesRef.current),
      );
    },
    [],
  );
  const reportCanonicalThreadLanes = useCallback((lanes: SidebarThreadCanonicalLanes) => {
    canonicalThreadLanesRef.current = lanes;
    setPendingThreadDrops((current) => reconcilePendingSidebarThreadDrops(current, lanes));
  }, []);
  const threadCollisionDetection = useMemo(
    () => createSidebarThreadCollisionDetection(homeContainerIdByThreadId),
    [homeContainerIdByThreadId],
  );
  const collisionDetection = useCallback<CollisionDetection>(
    (args) => {
      pointerYRef.current = args.pointerCoordinates?.y ?? null;
      if (readSidebarGroupDndPayload(args.active.data.current)) {
        return sidebarProjectCollisionDetection(args);
      }
      if (readSidebarThreadDndPayload(args.active.data.current)?.kind === "sidebar-item") {
        return threadCollisionDetection(args);
      }
      if (readSidebarLibraryDragResource(args.active.data.current)) {
        const eligibleContainers = args.droppableContainers.filter(
          (container) =>
            readSidebarLibraryOwnershipDropTarget(container.data.current) !== null ||
            readSidebarGroupDndPayload(container.data.current) !== null,
        );
        const eligibleArgs = { ...args, droppableContainers: eligibleContainers };
        const pointerCollisions = pointerWithin(eligibleArgs);
        return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(eligibleArgs);
      }
      return closestCenter(args);
    },
    [threadCollisionDetection],
  );

  const cancelDestinationController = useCallback((event?: DragCancelEvent | DragEndEvent) => {
    destinationControllerRef.current?.handleDragCancel?.(event);
    destinationControllerRef.current = null;
  }, []);

  const resetGestureState = useCallback(() => {
    pointerYRef.current = null;
    setActiveDrag(null);
  }, []);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      pointerYRef.current = null;
      cancelDestinationController();
      clearTextSelection();

      const projectPayload = readSidebarGroupDndPayload(event.active.data.current);
      if (projectPayload) {
        setActiveDrag({
          kind: "project",
          node: projectPayload.dragOverlay,
          projectId: projectPayload.projectId,
          zoom: readWindowZoom(event.activatorEvent),
        });
        projectPayload.controller.handleDragStart?.(event);
        return;
      }

      const threadPayload = readSidebarThreadDndPayload(event.active.data.current);
      if (threadPayload?.kind === "sidebar-item") {
        setActiveDrag({
          kind: "thread",
          node: threadPayload.thread.dragOverlay,
          thread: threadPayload.thread,
          zoom: readWindowZoom(event.activatorEvent),
        });
        threadPayload.controller.handleDragStart?.(event);
        return;
      }
      const libraryResource = readSidebarLibraryDragResource(event.active.data.current);
      if (!libraryResource) return;
      setActiveDrag({
        kind: "library",
        node: libraryResource.dragOverlay,
        resource: libraryResource,
        zoom: readWindowZoom(event.activatorEvent),
      });
    },
    [cancelDestinationController],
  );

  const refreshDragTarget = useCallback(
    (event: DragMoveEvent | DragOverEvent) => {
      const projectPayload = readSidebarGroupDndPayload(event.active.data.current);
      if (projectPayload) {
        projectPayload.controller.handleDragOver?.(event, pointerYRef.current);
        return;
      }

      const activePayload = readSidebarThreadDndPayload(event.active.data.current);
      if (activePayload?.kind !== "sidebar-item") return;
      const pointerY = pointerYRef.current;
      activePayload.controller.handleDragOver?.(event, pointerY);

      const overPayload = readSidebarThreadDndPayload(event.over?.data.current);
      const nextDestinationController =
        overPayload?.kind === "sidebar-item" && overPayload.controller !== activePayload.controller
          ? overPayload.controller
          : null;
      if (destinationControllerRef.current !== nextDestinationController) {
        cancelDestinationController();
        destinationControllerRef.current = nextDestinationController;
      }
      nextDestinationController?.handleDragOver?.(event, pointerY);
    },
    [cancelDestinationController],
  );

  const handleDragCancel = useCallback(
    (event: DragCancelEvent) => {
      cancelDestinationController(event);
      const projectPayload = readSidebarGroupDndPayload(event.active.data.current);
      if (projectPayload) {
        projectPayload.controller.handleDragCancel?.(event);
        resetGestureState();
        return;
      }

      const threadPayload = readSidebarThreadDndPayload(event.active.data.current);
      if (threadPayload?.kind === "sidebar-item") {
        threadPayload.controller.handleDragCancel?.(event);
      }
      resetGestureState();
    },
    [cancelDestinationController, resetGestureState],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const pointerY = pointerYRef.current;
      const destinationController = destinationControllerRef.current;
      destinationControllerRef.current = null;
      resetGestureState();

      const projectPayload = readSidebarGroupDndPayload(event.active.data.current);
      if (projectPayload) {
        const overPayload = readSidebarThreadDndPayload(event.over?.data.current);
        if (
          overPayload?.kind === "sidebar-thread-container" &&
          overPayload.containerId === PINNED_PROJECT_CONTAINER_ID
        ) {
          projectPayload.controller.handleDragCancel?.(event);
          onProjectDrop?.({
            projectId: projectPayload.projectId,
            targetContainerId: overPayload.containerId,
          });
          return;
        }

        projectPayload.controller.handleDragEnd(event, pointerY);
        return;
      }

      const libraryResource = readSidebarLibraryDragResource(event.active.data.current);
      if (libraryResource) {
        const overProject = readSidebarGroupDndPayload(event.over?.data.current);
        const overRect = event.over?.rect;
        const preferNest =
          pointerY !== null && overRect
            ? Math.abs(pointerY - (overRect.top + overRect.height / 2)) <= overRect.height * 0.3
            : false;
        const decision = resolveSidebarLibraryDropDecision(
          event.active.data.current,
          event.over?.data.current,
          overProject?.projectId ?? null,
          preferNest,
        );
        if (decision.kind === "move") {
          void onLibraryMove?.({
            resource: decision.resource,
            parent: decision.parent,
          });
        }
        if (decision.kind === "grant") {
          onLibraryGrant?.({
            resource: decision.resource,
            projectId: decision.projectId,
          });
        }
        return;
      }

      dispatchSidebarThreadDragEnd({
        destinationController,
        event,
        getThreadIdByThreadKey,
        homeContainerIdByThreadId,
        onError: onThreadError,
        onThreadDrop,
        pointerY,
        updatePendingThreadDrops,
      });
    },
    [
      getThreadIdByThreadKey,
      homeContainerIdByThreadId,
      onProjectDrop,
      onLibraryGrant,
      onLibraryMove,
      onThreadDrop,
      onThreadError,
      resetGestureState,
      updatePendingThreadDrops,
    ],
  );

  const overlay =
    typeof document === "undefined"
      ? null
      : createPortal(
          <DragOverlay
            adjustScale={false}
            className="pointer-events-none"
            dropAnimation={null}
            zIndex={2_147_483_647}
          >
            {activeDrag ? (
              <div
                aria-hidden
                className="[--height-token-row:30px] [--height-token-nav-row:30px] [--radius-token-row:10px]"
                inert
                style={{
                  height: `calc(100% / ${activeDrag.zoom})`,
                  transform: `scale(${activeDrag.zoom})`,
                  transformOrigin: "top left",
                  width: `calc(100% / ${activeDrag.zoom})`,
                }}
              >
                <div className="w-fit max-w-80 overflow-hidden rounded-[var(--radius-token-row)] border border-token-border bg-token-bg-primary opacity-70 shadow-lg">
                  {activeDrag.node}
                </div>
              </div>
            ) : null}
          </DragOverlay>,
          document.body,
        );
  const activeProjectId = activeDrag?.kind === "project" ? activeDrag.projectId : null;
  const activeThread = activeDrag?.kind === "thread" ? activeDrag.thread : null;

  return (
    <SidebarThreadDndStateProvider
      activeThread={activeThread}
      homeContainerIdByThreadId={homeContainerIdByThreadId}
      onError={onThreadError}
      pendingThreadDrops={pendingThreadDrops}
      reportCanonicalLanes={reportCanonicalThreadLanes}
    >
      <SidebarProjectDndStateProvider activeProjectId={activeProjectId} onError={onProjectError}>
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={handleDragStart}
          onDragMove={refreshDragTarget}
          onDragOver={refreshDragTarget}
          onDragCancel={handleDragCancel}
          onDragEnd={handleDragEnd}
        >
          {children}
          {overlay}
        </DndContext>
      </SidebarProjectDndStateProvider>
    </SidebarThreadDndStateProvider>
  );
}
