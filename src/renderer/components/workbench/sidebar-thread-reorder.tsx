import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
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
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createPortal } from "react-dom";
import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { replaceVisibleCodexSidebarThreadKeyOrder } from "@/lib/codex-sidebar-thread-sync";
import { cn } from "@/lib/utils";
import {
  codexSidebarProjectThreadContainerId,
  isCodexSidebarPinnedThreadContainerId,
} from "../../../shared/codex-sidebar-thread-move";
import { SidebarDropIndicator } from "./sidebar-project-group-dnd";

export interface SidebarThreadDropTarget {
  beforeThreadKey: string | null;
}

export type SidebarThreadProjectKind = "local" | "remote";

export type SidebarThreadProjectDropZone =
  | "project-gutter"
  | "project-icon"
  | "project-pagination"
  | "project-row";

export type SidebarThreadKind = "local" | "remote";

export interface SidebarThreadDndThread {
  containerId: string;
  dragOverlay: ReactNode;
  getNextThreadId?: () => string | null;
  getNextThreadKey?: () => string | null;
  nextThreadKey?: string | null;
  sourceProjectKind?: SidebarThreadProjectKind;
  targetProjectKind?: SidebarThreadProjectKind;
  threadId: string | null;
  threadKey: string;
}

export interface SidebarThreadItemDndPayload {
  kind: "sidebar-item";
  controller: SidebarThreadReorderController;
  itemId?: string;
  itemIds?: string[];
  nextItemId?: string | null;
  thread: SidebarThreadDndThread;
}

export interface SidebarThreadContainerDndPayload {
  kind: "sidebar-thread-container";
  containerId: string;
  projectDropZone?: SidebarThreadProjectDropZone;
  targetProjectKind?: SidebarThreadProjectKind;
}

export interface SidebarThreadDropRequest {
  beforeItemId?: string | null;
  beforeThreadId: string | null;
  insertAtEnd?: true;
  itemId?: string;
  sourceContainerId: string;
  targetContainerId: string;
  targetItemIds?: string[];
  threadId: string;
  useDefaultOrder?: true;
}

export interface PendingSidebarThreadDrop {
  beforeThreadId: string | null;
  homeContainerId: string | null;
  insertAtEnd?: true;
  sourceContainerId: string;
  targetContainerId: string;
  threadId: string;
  threadKey: string;
}

export type SidebarThreadDropPolicy =
  | { status: "allowed" }
  | {
      status: "blocked";
      reason:
        | "cloud-deferred"
        | "pending-cross-container"
        | "project-kind-mismatch"
        | "remote-deferred"
        | "reorder-only-source"
        | "unsupported-target";
    };

export interface SidebarThreadDropPolicyInput {
  homeContainerId: string | null;
  sourceContainerId: string;
  sourceProjectKind?: SidebarThreadProjectKind;
  targetContainerId: string;
  targetProjectKind?: SidebarThreadProjectKind;
  threadId: string | null;
  threadKind: SidebarThreadKind;
}

interface SidebarThreadDropRect {
  bottom: number;
  top: number;
}

export interface SidebarThreadReorderController {
  handleDragStart?: (event: DragStartEvent) => void;
  handleDragOver?: (event: DragOverEvent, pointerY: number | null) => void;
  handleDragCancel?: (event?: DragCancelEvent | DragEndEvent) => void;
  handleDragEnd: (event: DragEndEvent, pointerY: number | null) => void;
}

type SidebarThreadDndPayload =
  | SidebarThreadContainerDndPayload
  | SidebarThreadItemDndPayload;

interface SidebarThreadReorderContextValue {
  activeThread: SidebarThreadDndThread | null;
  activeThreadKey: string | null;
  dragActive: boolean;
  homeContainerIdByThreadId: ReadonlyMap<string, string>;
  pendingThreadDrops: PendingSidebarThreadDrop[];
}

interface SidebarThreadDragOverlayState {
  node: ReactNode;
  thread: SidebarThreadDndThread;
  threadKey: string;
  zoom: number;
}

export interface PendingVisibleThreadOrder {
  previousVisibleThreadKeys: string[];
  nextVisibleThreadKeys: string[];
}

const SidebarThreadReorderContext = createContext<SidebarThreadReorderContextValue>({
  activeThread: null,
  activeThreadKey: null,
  dragActive: false,
  homeContainerIdByThreadId: new Map(),
  pendingThreadDrops: [],
});

export function readSidebarThreadDndPayload(value: unknown): SidebarThreadDndPayload | null {
  if (!value || typeof value !== "object") return null;
  const kind = Reflect.get(value, "kind");
  if (kind === "sidebar-item") return value as SidebarThreadItemDndPayload;
  if (kind === "sidebar-thread-container") {
    return value as SidebarThreadContainerDndPayload;
  }
  return null;
}

function isProjectContainerId(containerId: string): boolean {
  return containerId.startsWith("project:")
    || containerId.startsWith("project-pinned:");
}

function isCloudContainerId(containerId: string | null): boolean {
  return containerId === "cloud";
}

export function resolveSidebarThreadDropPolicy({
  homeContainerId,
  sourceContainerId,
  sourceProjectKind,
  targetContainerId,
  targetProjectKind,
  threadId,
  threadKind,
}: SidebarThreadDropPolicyInput): SidebarThreadDropPolicy {
  const resolvedSourceProjectKind = threadKind === "remote"
    ? "remote"
    : (sourceProjectKind ?? "local");
  if (
    targetProjectKind !== undefined
    && resolvedSourceProjectKind !== targetProjectKind
  ) {
    return { status: "blocked", reason: "project-kind-mismatch" };
  }

  if (
    threadKind === "remote"
    || sourceProjectKind === "remote"
    || targetProjectKind === "remote"
  ) {
    return { status: "blocked", reason: "remote-deferred" };
  }
  if (
    isCloudContainerId(sourceContainerId)
    || isCloudContainerId(targetContainerId)
    || isCloudContainerId(homeContainerId)
  ) {
    return { status: "blocked", reason: "cloud-deferred" };
  }

  if (sourceContainerId === targetContainerId) {
    return threadId !== null || threadKind === "local"
      ? { status: "allowed" }
      : { status: "blocked", reason: "unsupported-target" };
  }
  if (sourceContainerId.startsWith("reorder-only:")) {
    return { status: "blocked", reason: "reorder-only-source" };
  }
  if (threadId === null) {
    return { status: "blocked", reason: "pending-cross-container" };
  }
  if (targetContainerId === "pinned" || isProjectContainerId(targetContainerId)) {
    return { status: "allowed" };
  }
  if (
    targetContainerId === "chats"
    && (
      isProjectContainerId(sourceContainerId)
      || sourceContainerId === "pinned"
    )
  ) {
    return { status: "allowed" };
  }
  return { status: "blocked", reason: "unsupported-target" };
}

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

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
}

export function moveSidebarThreadBefore(
  visibleThreadKeys: readonly string[],
  activeThreadKey: string,
  beforeThreadKey: string | null,
): string[] {
  if (!visibleThreadKeys.includes(activeThreadKey)) return [...visibleThreadKeys];

  const remainingThreadKeys = visibleThreadKeys.filter((threadKey) => (
    threadKey !== activeThreadKey
  ));
  const insertionIndex = beforeThreadKey === null
    ? remainingThreadKeys.length
    : remainingThreadKeys.indexOf(beforeThreadKey);
  if (insertionIndex < 0) return [...visibleThreadKeys];

  return [
    ...remainingThreadKeys.slice(0, insertionIndex),
    activeThreadKey,
    ...remainingThreadKeys.slice(insertionIndex),
  ];
}

export function resolveSidebarThreadDropTarget({
  visibleThreadKeys,
  activeThreadKey,
  overThreadKey,
  activeRect,
  overRect,
  pointerY,
}: {
  visibleThreadKeys: readonly string[];
  activeThreadKey: string | null;
  overThreadKey: string | null;
  activeRect: SidebarThreadDropRect | null;
  overRect: SidebarThreadDropRect | null;
  pointerY: number | null;
}): SidebarThreadDropTarget | null {
  if (!activeThreadKey || !overThreadKey) return null;
  if (activeThreadKey === overThreadKey) return null;
  if (!activeRect || !overRect) return null;

  const remainingThreadKeys = visibleThreadKeys.filter((threadKey) => (
    threadKey !== activeThreadKey
  ));
  const overIndex = remainingThreadKeys.indexOf(overThreadKey);
  if (overIndex < 0) return null;

  const activeMidpoint = (activeRect.top + activeRect.bottom) / 2;
  const overMidpoint = (overRect.top + overRect.bottom) / 2;
  const placement = (pointerY ?? activeMidpoint) < overMidpoint ? "before" : "after";
  const beforeThreadKey = remainingThreadKeys[
    overIndex + (placement === "after" ? 1 : 0)
  ] ?? null;
  const nextThreadKeys = moveSidebarThreadBefore(
    visibleThreadKeys,
    activeThreadKey,
    beforeThreadKey,
  );
  if (
    visibleThreadKeys.includes(activeThreadKey)
    && sameStringOrder(visibleThreadKeys, nextThreadKeys)
  ) {
    return null;
  }

  return { beforeThreadKey };
}

export function resolveDisplayedVisibleThreadKeys(
  visibleThreadKeys: string[],
  pendingVisibleThreadOrder: PendingVisibleThreadOrder | null,
): string[] {
  if (!pendingVisibleThreadOrder) return visibleThreadKeys;
  if (!sameStringOrder(
    pendingVisibleThreadOrder.previousVisibleThreadKeys,
    visibleThreadKeys,
  )) {
    return visibleThreadKeys;
  }
  if (!sameStringSet(
    pendingVisibleThreadOrder.nextVisibleThreadKeys,
    visibleThreadKeys,
  )) {
    return visibleThreadKeys;
  }
  return pendingVisibleThreadOrder.nextVisibleThreadKeys;
}

export function resolveSidebarThreadDropIndicatorIndex(
  visibleThreadKeys: readonly string[],
  dropTarget: SidebarThreadDropTarget | null,
): number | null {
  if (!dropTarget) return null;
  if (dropTarget.beforeThreadKey === null) return visibleThreadKeys.length;
  const index = visibleThreadKeys.indexOf(dropTarget.beforeThreadKey);
  return index < 0 ? null : index;
}

export interface SidebarThreadResolvedExternalDropTarget {
  beforeItemId?: string | null;
  beforeThreadId: string | null;
  insertAtEnd?: true;
  targetContainerId: string;
  targetItemIds?: string[];
  targetProjectKind?: SidebarThreadProjectKind;
  useDefaultOrder?: true;
}

function resolveTargetThreadId(
  threadKey: string | null,
  getThreadIdByThreadKey: (threadKey: string) => string | null,
): string | null {
  if (threadKey === null) return null;
  return getThreadIdByThreadKey(threadKey);
}

export function resolveSidebarThreadExternalDropTarget(
  event: DragOverEvent | DragEndEvent,
  pointerY: number | null,
  getThreadIdByThreadKey: (threadKey: string) => string | null,
): SidebarThreadResolvedExternalDropTarget | null {
  const overPayload = readSidebarThreadDndPayload(event.over?.data.current);
  if (!overPayload) return null;

  if (overPayload.kind === "sidebar-thread-container") {
    return {
      beforeThreadId: null,
      targetContainerId: overPayload.containerId,
      targetProjectKind: overPayload.targetProjectKind,
      ...(isProjectContainerId(overPayload.containerId)
        ? { useDefaultOrder: true as const }
        : {}),
    };
  }

  const activeRect = event.active.rect.current.translated;
  if (!activeRect || !event.over) return null;

  const targetThread = overPayload.thread;
  const placement = (pointerY ?? (activeRect.top + activeRect.bottom) / 2)
    < (event.over.rect.top + event.over.rect.bottom) / 2
    ? "before"
    : "after";
  const nextThreadKey = targetThread.getNextThreadKey?.()
    ?? targetThread.nextThreadKey
    ?? null;
  const nextThreadId = targetThread.getNextThreadId?.()
    ?? resolveTargetThreadId(nextThreadKey, getThreadIdByThreadKey);
  const beforeThreadId = placement === "before"
    ? targetThread.threadId
    : nextThreadId;
  const targetItemId = overPayload.itemIds?.find((itemId) => (
    itemId === String(event.over?.id)
  ));
  const beforeItemId = targetItemId === undefined
    ? undefined
    : placement === "before"
      ? targetItemId
      : (overPayload.nextItemId ?? null);
  const reachesEnd = beforeThreadId === null && nextThreadKey === null;
  const reachesItemEnd = beforeItemId === null && overPayload.nextItemId === null;

  return {
    beforeThreadId,
    targetContainerId: targetThread.containerId,
    targetProjectKind: targetThread.targetProjectKind,
    ...(beforeItemId === undefined ? {} : { beforeItemId }),
    ...(overPayload.itemIds === undefined
      ? {}
      : { targetItemIds: overPayload.itemIds }),
    ...(reachesEnd || reachesItemEnd ? { insertAtEnd: true as const } : {}),
  };
}

export function resolveSidebarThreadKeysWithPendingDrops({
  containerId,
  pendingThreadDrops,
  threadKeys,
  threadKeysInDisplayOrder,
  getThreadId = (threadKey) => threadKey,
}: {
  containerId: string;
  pendingThreadDrops: readonly PendingSidebarThreadDrop[];
  threadKeys: readonly string[];
  threadKeysInDisplayOrder?: readonly string[] | null;
  getThreadId?: (threadKey: string) => string | null;
}): string[] {
  const threadKeySet = new Set(threadKeys);
  const displayThreadKeySet = new Set(threadKeysInDisplayOrder);
  let nextThreadKeys = containerId === "chats" && threadKeysInDisplayOrder
    ? [
        ...threadKeysInDisplayOrder.filter((threadKey) => threadKeySet.has(threadKey)),
        ...threadKeys.filter((threadKey) => !displayThreadKeySet.has(threadKey)),
      ]
    : [...threadKeys];

  for (const pendingDrop of pendingThreadDrops) {
    const remainingThreadKeys = nextThreadKeys.includes(pendingDrop.threadKey)
      ? nextThreadKeys.filter((threadKey) => threadKey !== pendingDrop.threadKey)
      : nextThreadKeys;
    if (containerId !== pendingDrop.targetContainerId) {
      nextThreadKeys = remainingThreadKeys;
      continue;
    }

    const rawInsertionIndex = pendingDrop.insertAtEnd
      ? remainingThreadKeys.length
      : pendingDrop.beforeThreadId === null
        ? 0
        : remainingThreadKeys.findIndex((threadKey) => (
            getThreadId(threadKey) === pendingDrop.beforeThreadId
          ));
    const insertionIndex = rawInsertionIndex < 0
      ? remainingThreadKeys.length
      : rawInsertionIndex;
    nextThreadKeys = [
      ...remainingThreadKeys.slice(0, insertionIndex),
      pendingDrop.threadKey,
      ...remainingThreadKeys.slice(insertionIndex),
    ];
  }
  return nextThreadKeys;
}

export function getSidebarThreadContainerEdgeInsetY(
  payload: SidebarThreadContainerDndPayload,
): number {
  if (!isProjectContainerId(payload.containerId)) return 0;
  if (
    payload.projectDropZone === "project-gutter"
    || payload.projectDropZone === "project-icon"
    || payload.projectDropZone === "project-pagination"
  ) {
    return 0;
  }
  return payload.projectDropZone === "project-row" ? 7 : 10;
}

function containsPoint({
  point,
  rect,
  edgeInsetY = 0,
}: {
  point: { x: number; y: number };
  rect: { bottom: number; left: number; right: number; top: number };
  edgeInsetY?: number;
}): boolean {
  return point.x >= rect.left
    && point.x <= rect.right
    && point.y >= rect.top + edgeInsetY
    && point.y <= rect.bottom - edgeInsetY;
}

function targetContainerDetails(payload: SidebarThreadDndPayload): {
  containerId: string;
  targetProjectKind?: SidebarThreadProjectKind;
} {
  if (payload.kind === "sidebar-thread-container") {
    return {
      containerId: payload.containerId,
      targetProjectKind: payload.targetProjectKind,
    };
  }
  return {
    containerId: payload.thread.containerId,
    targetProjectKind: payload.thread.targetProjectKind,
  };
}

function isSidebarThreadTargetAllowed({
  activePayload,
  homeContainerIdByThreadId,
  targetPayload,
}: {
  activePayload: SidebarThreadItemDndPayload;
  homeContainerIdByThreadId: ReadonlyMap<string, string>;
  targetPayload: SidebarThreadDndPayload;
}): boolean {
  const target = targetContainerDetails(targetPayload);
  const activeThread = activePayload.thread;
  return resolveSidebarThreadDropPolicy({
    homeContainerId: activeThread.threadId === null
      ? null
      : (homeContainerIdByThreadId.get(activeThread.threadId) ?? null),
    sourceContainerId: activeThread.containerId,
    sourceProjectKind: activeThread.sourceProjectKind,
    targetContainerId: target.containerId,
    targetProjectKind: target.targetProjectKind,
    threadId: activeThread.threadId,
    threadKind: activeThread.sourceProjectKind === "remote" ? "remote" : "local",
  }).status === "allowed";
}

function createSidebarThreadCollisionDetection(
  homeContainerIdByThreadId: ReadonlyMap<string, string>,
): CollisionDetection {
  return (args) => {
    const activePayload = readSidebarThreadDndPayload(args.active.data.current);
    if (activePayload?.kind !== "sidebar-item") return closestCenter(args);

    const eligibleContainers = args.droppableContainers.filter((container) => {
      const targetPayload = readSidebarThreadDndPayload(container.data.current);
      if (!targetPayload) return false;
      return isSidebarThreadTargetAllowed({
        activePayload,
        homeContainerIdByThreadId,
        targetPayload,
      });
    });
    const eligibleArgs = {
      ...args,
      droppableContainers: eligibleContainers,
    };
    if (!args.pointerCoordinates) return closestCenter(eligibleArgs);

    const point = args.pointerCoordinates;
    const rowTargets = eligibleContainers.filter((container) => (
      readSidebarThreadDndPayload(container.data.current)?.kind === "sidebar-item"
    ));
    const containerTargets = eligibleContainers.filter((container) => (
      readSidebarThreadDndPayload(container.data.current)?.kind === "sidebar-thread-container"
    ));
    const isAtPoint = (container: (typeof eligibleContainers)[number]): boolean => {
      const rect = args.droppableRects.get(container.id);
      const payload = readSidebarThreadDndPayload(container.data.current);
      if (!rect || !payload) return false;
      const edgeInsetY = payload.kind === "sidebar-thread-container"
        ? getSidebarThreadContainerEdgeInsetY(payload)
        : 0;
      return containsPoint({ point, rect, edgeInsetY });
    };
    const isAncestorOf = (
      ancestor: (typeof eligibleContainers)[number],
      descendant: (typeof eligibleContainers)[number],
    ): boolean => {
      const ancestorNode = ancestor.node.current;
      const descendantNode = descendant.node.current;
      return ancestorNode !== null
        && descendantNode !== null
        && ancestorNode.contains(descendantNode);
    };

    const guaranteedContainerTargets = containerTargets.filter((container) => {
      const payload = readSidebarThreadDndPayload(container.data.current);
      return payload?.kind === "sidebar-thread-container"
        && (
          payload.projectDropZone === "project-gutter"
          || payload.projectDropZone === "project-icon"
          || payload.projectDropZone === "project-pagination"
        )
        && isAtPoint(container);
    });

    let selectedTargets = guaranteedContainerTargets;
    if (selectedTargets.length === 0) {
      const reorderBoundaryTargets = containerTargets.filter((container) => {
        const payload = readSidebarThreadDndPayload(container.data.current);
        const rect = args.droppableRects.get(container.id);
        if (
          payload?.kind !== "sidebar-thread-container"
          || !isProjectContainerId(payload.containerId)
          || payload.projectDropZone === "project-icon"
          || !rect
        ) {
          return false;
        }
        return containsPoint({ point, rect }) && !containsPoint({
          point,
          rect,
          edgeInsetY: getSidebarThreadContainerEdgeInsetY(payload),
        });
      });
      const boundaryRowTargets = rowTargets.filter((rowTarget) => (
        reorderBoundaryTargets.some((containerTarget) => (
          isAncestorOf(containerTarget, rowTarget)
        ))
      ));
      if (boundaryRowTargets.length > 0) {
        selectedTargets = boundaryRowTargets;
      } else {
        const pointRowTargets = rowTargets.filter(isAtPoint);
        const pointContainerTargets = containerTargets.filter(isAtPoint);
        const deepestContainerTargets = pointContainerTargets.filter((containerTarget) => (
          !pointContainerTargets.some((otherTarget) => (
            otherTarget !== containerTarget && isAncestorOf(containerTarget, otherTarget)
          ))
        ));
        const rowContainingContainerTargets = deepestContainerTargets.filter((containerTarget) => (
          pointRowTargets.some((rowTarget) => (
            isAncestorOf(rowTarget, containerTarget)
            && !pointRowTargets.some((otherRowTarget) => (
              isAncestorOf(containerTarget, otherRowTarget)
            ))
          ))
        ));
        const rowsInsideContainerTargets = pointRowTargets.filter((rowTarget) => (
          deepestContainerTargets.some((containerTarget) => (
            isAncestorOf(containerTarget, rowTarget)
          ))
        ));
        selectedTargets = rowContainingContainerTargets.length > 0
          ? rowContainingContainerTargets
          : rowsInsideContainerTargets.length > 0
            ? rowsInsideContainerTargets
            : pointRowTargets.length > 0
              ? pointRowTargets
              : deepestContainerTargets;
      }
    }

    if (selectedTargets.length === 0) return [];
    const { x, y } = point;
    return closestCenter({
      ...args,
      droppableContainers: selectedTargets,
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
}

export type SidebarThreadDragEndDisposition =
  | "cancelled"
  | "moved"
  | "reordered";

export function dispatchSidebarThreadDragEnd({
  cachedDropTarget,
  destinationController,
  event,
  getThreadIdByThreadKey,
  homeContainerIdByThreadId,
  onThreadDrop,
  pointerY,
  updatePendingThreadDrops,
}: {
  cachedDropTarget: SidebarThreadResolvedExternalDropTarget | null;
  destinationController: SidebarThreadReorderController | null;
  event: DragEndEvent;
  getThreadIdByThreadKey: (threadKey: string) => string | null;
  homeContainerIdByThreadId: ReadonlyMap<string, string>;
  onThreadDrop: (drop: SidebarThreadDropRequest) => Promise<void> | void;
  pointerY: number | null;
  updatePendingThreadDrops: (
    update: (current: PendingSidebarThreadDrop[]) => PendingSidebarThreadDrop[],
  ) => void;
}): SidebarThreadDragEndDisposition {
  destinationController?.handleDragCancel?.(event);
  const activePayload = readSidebarThreadDndPayload(event.active.data.current);
  if (activePayload?.kind !== "sidebar-item") return "cancelled";

  const overPayload = readSidebarThreadDndPayload(event.over?.data.current);
  if (!overPayload) {
    activePayload.controller.handleDragCancel?.(event);
    return "cancelled";
  }
  if (
    overPayload.kind === "sidebar-item"
    && overPayload.controller === activePayload.controller
  ) {
    activePayload.controller.handleDragEnd(event, pointerY);
    return "reordered";
  }
  if (!isSidebarThreadTargetAllowed({
    activePayload,
    homeContainerIdByThreadId,
    targetPayload: overPayload,
  })) {
    activePayload.controller.handleDragCancel?.(event);
    return "cancelled";
  }

  const resolvedDropTarget = resolveSidebarThreadExternalDropTarget(
    event,
    pointerY,
    getThreadIdByThreadKey,
  );
  if (!resolvedDropTarget) {
    activePayload.controller.handleDragCancel?.(event);
    return "cancelled";
  }
  const dropTarget = cachedDropTarget?.targetContainerId === resolvedDropTarget.targetContainerId
    ? cachedDropTarget
    : resolvedDropTarget;
  const activeThread = activePayload.thread;
  if (activeThread.containerId === dropTarget.targetContainerId) {
    activePayload.controller.handleDragCancel?.(event);
    return "cancelled";
  }

  activePayload.controller.handleDragCancel?.(event);
  if (activeThread.threadId === null) return "cancelled";

  const optimisticDrop: PendingSidebarThreadDrop = {
    beforeThreadId: dropTarget.beforeThreadId,
    homeContainerId: homeContainerIdByThreadId.get(activeThread.threadId) ?? null,
    sourceContainerId: activeThread.containerId,
    targetContainerId: dropTarget.targetContainerId,
    threadId: activeThread.threadId,
    threadKey: activeThread.threadKey,
    ...(dropTarget.insertAtEnd ? { insertAtEnd: true } : {}),
  };
  updatePendingThreadDrops((current) => [
    ...current.filter((pendingDrop) => pendingDrop.threadId !== activeThread.threadId),
    optimisticDrop,
  ]);

  void Promise.resolve()
    .then(() => onThreadDrop({
      beforeThreadId: dropTarget.beforeThreadId,
      sourceContainerId: activeThread.containerId,
      targetContainerId: dropTarget.targetContainerId,
      threadId: activeThread.threadId as string,
      ...(dropTarget.beforeItemId === undefined
        ? {}
        : { beforeItemId: dropTarget.beforeItemId }),
      ...(dropTarget.insertAtEnd ? { insertAtEnd: true } : {}),
      ...(dropTarget.useDefaultOrder ? { useDefaultOrder: true } : {}),
      ...(activePayload.itemId === undefined ? {} : { itemId: activePayload.itemId }),
      ...(dropTarget.targetItemIds === undefined
        ? {}
        : { targetItemIds: dropTarget.targetItemIds }),
    }))
    .catch(() => undefined)
    .finally(() => {
      updatePendingThreadDrops((current) => (
        current.filter((pendingDrop) => pendingDrop !== optimisticDrop)
      ));
    });
  return "moved";
}

const EMPTY_HOME_CONTAINER_IDS: ReadonlyMap<string, string> = new Map();
const DEFAULT_GET_THREAD_ID = (threadKey: string): string => threadKey;
const DEFAULT_THREAD_DROP = (): void => undefined;

export function SidebarThreadReorderDndProvider({
  children,
  getThreadIdByThreadKey = DEFAULT_GET_THREAD_ID,
  homeContainerIdByThreadId = EMPTY_HOME_CONTAINER_IDS,
  onThreadDrop = DEFAULT_THREAD_DROP,
}: {
  children: ReactNode;
  getThreadIdByThreadKey?: (threadKey: string) => string | null;
  homeContainerIdByThreadId?: ReadonlyMap<string, string>;
  onThreadDrop?: (drop: SidebarThreadDropRequest) => Promise<void> | void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const [activeThread, setActiveThread] = useState<SidebarThreadDragOverlayState | null>(null);
  const [pendingThreadDrops, setPendingThreadDrops] = useState<PendingSidebarThreadDrop[]>([]);
  const pointerYRef = useRef<number | null>(null);
  const destinationControllerRef = useRef<SidebarThreadReorderController | null>(null);
  const cachedDropTargetRef = useRef<SidebarThreadResolvedExternalDropTarget | null>(null);
  const baseCollisionDetection = useMemo(
    () => createSidebarThreadCollisionDetection(homeContainerIdByThreadId),
    [homeContainerIdByThreadId],
  );
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    pointerYRef.current = args.pointerCoordinates?.y ?? null;
    return baseCollisionDetection(args);
  }, [baseCollisionDetection]);

  const cancelDestinationController = useCallback((
    event?: DragCancelEvent | DragEndEvent,
  ) => {
    destinationControllerRef.current?.handleDragCancel?.(event);
    destinationControllerRef.current = null;
  }, []);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const payload = readSidebarThreadDndPayload(event.active.data.current);
    if (payload?.kind !== "sidebar-item") return;
    pointerYRef.current = null;
    cachedDropTargetRef.current = null;
    cancelDestinationController();
    setActiveThread({
      node: payload.thread.dragOverlay,
      thread: payload.thread,
      threadKey: payload.thread.threadKey,
      zoom: readWindowZoom(event.activatorEvent),
    });
    payload.controller.handleDragStart?.(event);
  }, [cancelDestinationController]);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const activePayload = readSidebarThreadDndPayload(event.active.data.current);
    if (activePayload?.kind !== "sidebar-item") return;
    const pointerY = pointerYRef.current;
    activePayload.controller.handleDragOver?.(event, pointerY);

    const overPayload = readSidebarThreadDndPayload(event.over?.data.current);
    const nextDestinationController = overPayload?.kind === "sidebar-item"
      && overPayload.controller !== activePayload.controller
      ? overPayload.controller
      : null;
    if (destinationControllerRef.current !== nextDestinationController) {
      cancelDestinationController();
      destinationControllerRef.current = nextDestinationController;
    }
    nextDestinationController?.handleDragOver?.(event, pointerY);
    cachedDropTargetRef.current = resolveSidebarThreadExternalDropTarget(
      event,
      pointerY,
      getThreadIdByThreadKey,
    );
  }, [cancelDestinationController, getThreadIdByThreadKey]);

  const handleDragCancel = useCallback((event: DragCancelEvent) => {
    const payload = readSidebarThreadDndPayload(event.active.data.current);
    cancelDestinationController(event);
    if (payload?.kind === "sidebar-item") {
      payload.controller.handleDragCancel?.(event);
    }
    pointerYRef.current = null;
    cachedDropTargetRef.current = null;
    setActiveThread(null);
  }, [cancelDestinationController]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const pointerY = pointerYRef.current;
    pointerYRef.current = null;
    setActiveThread(null);
    const destinationController = destinationControllerRef.current;
    destinationControllerRef.current = null;
    const cachedDropTarget = cachedDropTargetRef.current;
    cachedDropTargetRef.current = null;
    dispatchSidebarThreadDragEnd({
      cachedDropTarget,
      destinationController,
      event,
      getThreadIdByThreadKey,
      homeContainerIdByThreadId,
      onThreadDrop,
      pointerY,
      updatePendingThreadDrops: setPendingThreadDrops,
    });
  }, [getThreadIdByThreadKey, homeContainerIdByThreadId, onThreadDrop]);

  const contextValue = useMemo<SidebarThreadReorderContextValue>(() => ({
    activeThread: activeThread?.thread ?? null,
    activeThreadKey: activeThread?.threadKey ?? null,
    dragActive: activeThread !== null,
    homeContainerIdByThreadId,
    pendingThreadDrops,
  }), [activeThread, homeContainerIdByThreadId, pendingThreadDrops]);
  const overlay = typeof document === "undefined" ? null : createPortal(
    <DragOverlay
      adjustScale={false}
      className="pointer-events-none"
      dropAnimation={null}
      zIndex={2_147_483_647}
    >
      {activeThread ? (
        <div
          aria-hidden
          className="[--height-token-nav-row:30px] [--radius-token-row:10px]"
          inert
          style={{
            height: `calc(100% / ${activeThread.zoom})`,
            transform: `scale(${activeThread.zoom})`,
            transformOrigin: "top left",
            width: `calc(100% / ${activeThread.zoom})`,
          }}
        >
          <div className="w-fit max-w-80 overflow-hidden rounded-[var(--radius-token-row)] border border-token-border bg-token-bg-primary opacity-70 shadow-lg">
            {activeThread.node}
          </div>
        </div>
      ) : null}
    </DragOverlay>,
    document.body,
  );

  return (
    <SidebarThreadReorderContext.Provider value={contextValue}>
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
    </SidebarThreadReorderContext.Provider>
  );
}

export function usePendingSidebarThreadDrops(): readonly PendingSidebarThreadDrop[] {
  return useContext(SidebarThreadReorderContext).pendingThreadDrops;
}

export function resolveSidebarThreadProjectDropContainerId(
  projectId: string,
  sourceContainerId: string | null,
): string {
  return codexSidebarProjectThreadContainerId(
    projectId,
    isCodexSidebarPinnedThreadContainerId(sourceContainerId ?? ""),
  );
}

export function useSidebarThreadProjectDropContainerId(projectId: string): string {
  const { activeThread } = useContext(SidebarThreadReorderContext);
  return resolveSidebarThreadProjectDropContainerId(
    projectId,
    activeThread?.containerId ?? null,
  );
}

export function useSidebarThreadDropContainer({
  containerId,
  projectDropZone,
  targetProjectKind,
}: {
  containerId: string;
  projectDropZone?: SidebarThreadProjectDropZone;
  targetProjectKind?: SidebarThreadProjectKind;
}): {
  isExternalThreadDropTarget: boolean;
  isOver: boolean;
  setNodeRef: (element: HTMLElement | null) => void;
} {
  const {
    activeThread,
    homeContainerIdByThreadId,
  } = useContext(SidebarThreadReorderContext);
  const payload = useMemo<SidebarThreadContainerDndPayload>(() => ({
    kind: "sidebar-thread-container",
    containerId,
    projectDropZone,
    targetProjectKind,
  }), [containerId, projectDropZone, targetProjectKind]);
  const policy = activeThread === null
    ? null
    : resolveSidebarThreadDropPolicy({
        homeContainerId: activeThread.threadId === null
          ? null
          : (homeContainerIdByThreadId.get(activeThread.threadId) ?? null),
        sourceContainerId: activeThread.containerId,
        sourceProjectKind: activeThread.sourceProjectKind,
        targetContainerId: containerId,
        targetProjectKind,
        threadId: activeThread.threadId,
        threadKind: activeThread.sourceProjectKind === "remote" ? "remote" : "local",
      });
  const id = projectDropZone === undefined
    ? `sidebar-thread-container:${containerId}`
    : `sidebar-${projectDropZone}:${containerId}`;
  const { isOver, setNodeRef } = useDroppable({
    id,
    data: payload,
    disabled: policy?.status !== "allowed",
  });
  return {
    isExternalThreadDropTarget: policy?.status === "allowed"
      && activeThread?.containerId !== containerId,
    isOver,
    setNodeRef,
  };
}

export function SidebarThreadDropContainer({
  activeClassName,
  activeNode,
  children,
  className,
  containerId,
  projectDropZone,
  targetProjectKind,
}: {
  activeClassName?: string;
  activeNode?: ReactNode;
  children: ReactNode;
  className?: string;
  containerId: string;
  projectDropZone?: SidebarThreadProjectDropZone;
  targetProjectKind?: SidebarThreadProjectKind;
}) {
  const {
    isExternalThreadDropTarget,
    isOver,
    setNodeRef,
  } = useSidebarThreadDropContainer({
    containerId,
    projectDropZone,
    targetProjectKind,
  });
  const active = isExternalThreadDropTarget && isOver;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        className,
        active && activeClassName,
        active
          && "cursor-grabbing rounded-md bg-token-list-hover-background [&>*]:pointer-events-none",
      )}
      data-sidebar-project-drop-zone={projectDropZone}
      data-sidebar-project-kind={targetProjectKind}
    >
      {children}
      {active ? activeNode : null}
    </div>
  );
}

export function useSidebarThreadReorderController({
  visibleThreadKeys,
  onVisibleThreadOrderChange,
}: {
  visibleThreadKeys: string[];
  onVisibleThreadOrderChange: (change: {
    visibleThreadKeys: string[];
    nextVisibleThreadKeys: string[];
  }) => Promise<void>;
}): {
  controller: SidebarThreadReorderController;
  displayedVisibleThreadKeys: string[];
  dropIndicatorTarget: SidebarThreadDropTarget | null;
} {
  const [dropIndicatorTarget, setDropIndicatorTarget] = useState<SidebarThreadDropTarget | null>(
    null,
  );
  const [pendingVisibleThreadOrder, setPendingVisibleThreadOrder] = useState<
    PendingVisibleThreadOrder | null
  >(null);
  const displayedVisibleThreadKeys = resolveDisplayedVisibleThreadKeys(
    visibleThreadKeys,
    pendingVisibleThreadOrder,
  );

  const resolveDropTarget = useCallback((
    event: DragOverEvent | DragEndEvent,
    pointerY: number | null,
  ) => resolveSidebarThreadDropTarget({
    visibleThreadKeys: displayedVisibleThreadKeys,
    activeThreadKey: String(event.active.id),
    overThreadKey: event.over ? String(event.over.id) : null,
    activeRect: event.active.rect.current.translated,
    overRect: event.over?.rect ?? null,
    pointerY,
  }), [displayedVisibleThreadKeys]);

  const controller = useMemo<SidebarThreadReorderController>(() => ({
    handleDragOver(event, pointerY) {
      setDropIndicatorTarget(resolveDropTarget(event, pointerY));
    },
    handleDragCancel() {
      setDropIndicatorTarget(null);
    },
    handleDragEnd(event, pointerY) {
      const activeThreadKey = String(event.active.id);
      const target = resolveDropTarget(event, pointerY);
      setDropIndicatorTarget(null);
      if (!target) return;

      const nextVisibleThreadKeys = moveSidebarThreadBefore(
        displayedVisibleThreadKeys,
        activeThreadKey,
        target.beforeThreadKey,
      );
      const pendingOrder = {
        previousVisibleThreadKeys: displayedVisibleThreadKeys,
        nextVisibleThreadKeys,
      };
      setPendingVisibleThreadOrder(pendingOrder);

      let request: Promise<void>;
      try {
        request = onVisibleThreadOrderChange({
          visibleThreadKeys,
          nextVisibleThreadKeys,
        });
      } catch {
        setPendingVisibleThreadOrder((current) => (
          current === pendingOrder ? null : current
        ));
        return;
      }

      void request
        .finally(() => {
          setPendingVisibleThreadOrder((current) => (
            current === pendingOrder ? null : current
          ));
        })
        .catch(() => undefined);
    },
  }), [displayedVisibleThreadKeys, onVisibleThreadOrderChange, resolveDropTarget, visibleThreadKeys]);

  return {
    controller,
    displayedVisibleThreadKeys,
    dropIndicatorTarget,
  };
}

export function SidebarThreadSortableContext({
  threadKeys,
  children,
}: {
  threadKeys: string[];
  children: ReactNode;
}) {
  return (
    <SortableContext items={threadKeys} strategy={verticalListSortingStrategy}>
      {children}
    </SortableContext>
  );
}

const legacyContainerIds = new WeakMap<SidebarThreadReorderController, string>();
let nextLegacyContainerId = 0;

function getLegacySidebarThreadContainerId(
  controller: SidebarThreadReorderController,
): string {
  const existing = legacyContainerIds.get(controller);
  if (existing) return existing;
  nextLegacyContainerId += 1;
  const containerId = `reorder-only:legacy-${nextLegacyContainerId}`;
  legacyContainerIds.set(controller, containerId);
  return containerId;
}

export function SidebarThreadSortableItem({
  children,
  className,
  containerId,
  controller,
  dragOverlay,
  disabled = false,
  getNextThreadId,
  getNextThreadKey,
  itemId,
  itemIds,
  nextItemId,
  nextThreadKey,
  sourceProjectKind,
  targetProjectKind,
  threadId,
  threadKey,
}: {
  children: ReactNode;
  className?: string;
  containerId?: string;
  controller: SidebarThreadReorderController;
  dragOverlay?: ReactNode;
  disabled?: boolean;
  getNextThreadId?: () => string | null;
  getNextThreadKey?: () => string | null;
  itemId?: string;
  itemIds?: string[];
  nextItemId?: string | null;
  nextThreadKey?: string | null;
  sourceProjectKind?: SidebarThreadProjectKind;
  targetProjectKind?: SidebarThreadProjectKind;
  threadId?: string | null;
  threadKey: string;
}) {
  const { activeThreadKey, dragActive } = useContext(SidebarThreadReorderContext);
  const resolvedContainerId = containerId ?? getLegacySidebarThreadContainerId(controller);
  const resolvedThreadId = threadId === undefined ? threadKey : threadId;
  const selfPolicy = resolveSidebarThreadDropPolicy({
    homeContainerId: null,
    sourceContainerId: resolvedContainerId,
    sourceProjectKind,
    targetContainerId: resolvedContainerId,
    targetProjectKind,
    threadId: resolvedThreadId,
    threadKind: sourceProjectKind === "remote" ? "remote" : "local",
  });
  const sortableDisabled = disabled || selfPolicy.status === "blocked";
  const payload = useMemo<SidebarThreadItemDndPayload>(() => ({
    kind: "sidebar-item",
    controller,
    itemId,
    itemIds,
    nextItemId,
    thread: {
      containerId: resolvedContainerId,
      dragOverlay: dragOverlay ?? children,
      getNextThreadId,
      getNextThreadKey,
      nextThreadKey,
      sourceProjectKind,
      targetProjectKind,
      threadId: resolvedThreadId,
      threadKey,
    },
  }), [
    children,
    controller,
    dragOverlay,
    getNextThreadId,
    getNextThreadKey,
    itemId,
    itemIds,
    nextItemId,
    nextThreadKey,
    resolvedContainerId,
    resolvedThreadId,
    sourceProjectKind,
    targetProjectKind,
    threadKey,
  ]);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: threadKey,
    disabled: sortableDisabled,
    data: payload,
  });
  const activeDrag = isDragging || activeThreadKey === threadKey;
  const style: CSSProperties = {
    transform: CSS.Translate.toString(dragActive ? null : transform),
    transition: dragActive ? undefined : transition,
  };

  return (
    <div
      ref={setNodeRef}
      className={cn(
        className,
        activeDrag && "opacity-20",
        dragActive && "pointer-events-none",
      )}
      style={style}
      inert={activeDrag ? true : undefined}
      role="listitem"
    >
      <div
        key={activeDrag ? "dragging" : "idle"}
        className={cn(
          sortableDisabled
            ? "cursor-interaction"
            : "cursor-grab active:cursor-grabbing",
        )}
        {...attributes}
        {...listeners}
      >
        {children}
      </div>
    </div>
  );
}

export function SidebarThreadDropIndicator({
  compensateLayout = true,
}: {
  compensateLayout?: boolean;
}) {
  return <SidebarDropIndicator compensateLayout={compensateLayout} />;
}

export function SidebarThreadReorderRows({
  containerId,
  getItemId,
  getThreadId,
  itemIds,
  visibleThreadKeys,
  sortableThreadKeys,
  onVisibleThreadOrderChange,
  renderThread,
  renderDragOverlay,
  sourceProjectKind,
  targetProjectKind,
}: {
  containerId?: string;
  getItemId?: (threadKey: string) => string | undefined;
  getThreadId?: (threadKey: string) => string | null;
  itemIds?: string[];
  visibleThreadKeys: string[];
  sortableThreadKeys: string[];
  onVisibleThreadOrderChange: (change: {
    visibleThreadKeys: string[];
    nextVisibleThreadKeys: string[];
  }) => Promise<void>;
  renderThread: (threadKey: string) => ReactNode;
  renderDragOverlay?: (threadKey: string) => ReactNode;
  sourceProjectKind?: SidebarThreadProjectKind;
  targetProjectKind?: SidebarThreadProjectKind;
}) {
  const reorder = useSidebarThreadReorderController({
    visibleThreadKeys: sortableThreadKeys,
    onVisibleThreadOrderChange,
  });
  const displayedThreadKeys = replaceVisibleCodexSidebarThreadKeyOrder({
    threadKeysInDisplayOrder: visibleThreadKeys,
    visibleThreadKeys: sortableThreadKeys,
    nextVisibleThreadKeys: reorder.displayedVisibleThreadKeys,
  });

  return (
    <SidebarThreadSortableRows
      containerId={containerId}
      getItemId={getItemId}
      getThreadId={getThreadId}
      itemIds={itemIds}
      visibleThreadKeys={displayedThreadKeys}
      sortableThreadKeysInDisplayOrder={reorder.displayedVisibleThreadKeys}
      controller={reorder.controller}
      dropIndicatorTarget={reorder.dropIndicatorTarget}
      renderThread={renderThread}
      renderDragOverlay={renderDragOverlay}
      sourceProjectKind={sourceProjectKind}
      targetProjectKind={targetProjectKind}
    />
  );
}

export function SidebarThreadSortableRows({
  containerId,
  getItemId,
  getThreadId = DEFAULT_GET_THREAD_ID,
  itemIds,
  visibleThreadKeys,
  sortableThreadKeysInDisplayOrder,
  controller,
  dropIndicatorTarget,
  renderThread,
  renderDragOverlay,
  sourceProjectKind,
  targetProjectKind,
}: {
  containerId?: string;
  getItemId?: (threadKey: string) => string | undefined;
  getThreadId?: (threadKey: string) => string | null;
  itemIds?: string[];
  visibleThreadKeys: string[];
  sortableThreadKeysInDisplayOrder: string[];
  controller: SidebarThreadReorderController;
  dropIndicatorTarget: SidebarThreadDropTarget | null;
  renderThread: (threadKey: string) => ReactNode;
  renderDragOverlay?: (threadKey: string) => ReactNode;
  sourceProjectKind?: SidebarThreadProjectKind;
  targetProjectKind?: SidebarThreadProjectKind;
}) {
  const sortableThreadKeySet = useMemo(
    () => new Set(sortableThreadKeysInDisplayOrder),
    [sortableThreadKeysInDisplayOrder],
  );
  const visibleSortableThreadKeys = visibleThreadKeys.filter((threadKey) => (
    sortableThreadKeySet.has(threadKey)
  ));
  const lastVisibleSortableThreadKey = visibleSortableThreadKeys.at(-1) ?? null;
  const trailingIndicatorVisible = dropIndicatorTarget !== null
    && (
      dropIndicatorTarget.beforeThreadKey === null
      || !visibleThreadKeys.includes(dropIndicatorTarget.beforeThreadKey)
    );

  return (
    <SidebarThreadSortableContext threadKeys={sortableThreadKeysInDisplayOrder}>
      {visibleThreadKeys.map((threadKey) => {
        if (!sortableThreadKeySet.has(threadKey)) {
          return <Fragment key={threadKey}>{renderThread(threadKey)}</Fragment>;
        }

        const sortableIndex = sortableThreadKeysInDisplayOrder.indexOf(threadKey);
        const nextRealThreadKey = sortableThreadKeysInDisplayOrder
          .slice(sortableIndex + 1)
          .find((candidateThreadKey) => getThreadId(candidateThreadKey) !== null)
          ?? null;
        const itemId = getItemId?.(threadKey);
        const itemIndex = itemId === undefined ? -1 : (itemIds?.indexOf(itemId) ?? -1);
        const nextItemId = itemIndex < 0 ? undefined : (itemIds?.[itemIndex + 1] ?? null);

        return (
          <Fragment key={threadKey}>
            {dropIndicatorTarget?.beforeThreadKey === threadKey
              ? <SidebarThreadDropIndicator />
              : null}
            <SidebarThreadSortableItem
              containerId={containerId}
              threadKey={threadKey}
              threadId={getThreadId(threadKey)}
              controller={controller}
              dragOverlay={renderDragOverlay?.(threadKey)}
              getNextThreadId={() => resolveTargetThreadId(nextRealThreadKey, getThreadId)}
              getNextThreadKey={() => nextRealThreadKey}
              itemId={itemId}
              itemIds={itemIds}
              nextItemId={nextItemId}
              sourceProjectKind={sourceProjectKind}
              targetProjectKind={targetProjectKind}
            >
              {renderThread(threadKey)}
            </SidebarThreadSortableItem>
            {trailingIndicatorVisible && lastVisibleSortableThreadKey === threadKey
              ? <SidebarThreadDropIndicator />
              : null}
          </Fragment>
        );
      })}
    </SidebarThreadSortableContext>
  );
}
