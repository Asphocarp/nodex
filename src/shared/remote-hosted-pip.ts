export const REMOTE_HOSTED_PIP_MAIN_THREAD_HOST_ID = "codex-main-thread";
export const REMOTE_HOSTED_PIP_ANCHOR_HOST_ATTRIBUTE = "data-pip-anchor-host";
export const REMOTE_HOSTED_PIP_OBSTACLE_ATTRIBUTE = "data-pip-obstacle";

export type RemoteHostedPipPresentationScope = "thread" | "all";
export type RemoteHostedPipAnchorAlignment = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface RemoteHostedPipViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RemoteHostedPipPoint {
  x: number;
  y: number;
}

export interface RemoteHostedPipAnchor {
  alignment: RemoteHostedPipAnchorAlignment;
  point: RemoteHostedPipPoint;
}

export interface RemoteHostedPipHostLayout {
  anchors: RemoteHostedPipAnchor[] | null;
  anchorRect: RemoteHostedPipViewportRect | null;
  animated: boolean;
  hostId: string;
  presentationScope: RemoteHostedPipPresentationScope;
}

export interface RemoteHostedPipHostLayoutInput {
  hostId?: string;
  hostRect: RemoteHostedPipViewportRect;
  obstacleRects: RemoteHostedPipViewportRect[];
  presentationScope?: RemoteHostedPipPresentationScope;
}

export interface RemoteHostedPipHostLayoutChangedMessage {
  type: "remote-hosted-pip-host-layout-changed";
  layout: RemoteHostedPipHostLayout;
}

export interface RemoteHostedPipActiveThreadChangedMessage {
  type: "remote-hosted-pip-active-thread-changed";
  conversationId: string | null;
}

export interface RemoteHostedPipHiddenThreadIdsChangedMessage {
  type: "remote-hosted-pip-hidden-thread-ids-changed";
  hiddenThreadIds: string[];
}

export interface RemoteHostedPipStreamStateChangedMessage {
  type: "remote-hosted-pip-stream-state-changed";
  conversationId: string;
  isActive: boolean;
  isAnyActive: boolean;
}

export interface RemoteHostedPipHiddenThreadIdsRequestedMessage {
  type: "remote-hosted-pip-hidden-thread-ids-requested";
  hiddenThreadIds: string[];
}

export type CodexDesktopMessageFromView =
  | RemoteHostedPipActiveThreadChangedMessage
  | RemoteHostedPipHostLayoutChangedMessage
  | RemoteHostedPipHiddenThreadIdsChangedMessage;

export type CodexDesktopMessageForView =
  | RemoteHostedPipStreamStateChangedMessage
  | RemoteHostedPipHiddenThreadIdsRequestedMessage;

interface RemoteHostedPipRelativeRect {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
}

interface RemoteHostedPipAnchorCandidate {
  priority: number;
  rect: RemoteHostedPipRelativeRect;
}

const REMOTE_HOSTED_PIP_VIEWPORT_MARGIN_PX = 24;
const REMOTE_HOSTED_PIP_OBSTACLE_MARGIN_PX = 12;
const REMOTE_HOSTED_PIP_DEFAULT_CONTENT_RECT = {
  height: 250,
  width: 250,
};
const REMOTE_HOSTED_PIP_MAX_ADJUSTMENTS = 6;
const REMOTE_HOSTED_PIP_OVERLAP_PENALTY = 1_000_000_000;
const REMOTE_HOSTED_PIP_OVERLAP_AREA_WEIGHT = 10_000;
const REMOTE_HOSTED_PIP_PRIORITY_WEIGHT = 1_000_000;

const REMOTE_HOSTED_PIP_ANCHOR_ALIGNMENTS: RemoteHostedPipAnchorAlignment[] = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

export function buildRemoteHostedPipHiddenHostLayout({
  hostId = REMOTE_HOSTED_PIP_MAIN_THREAD_HOST_ID,
  presentationScope = "thread",
}: {
  hostId?: string;
  presentationScope?: RemoteHostedPipPresentationScope;
} = {}): RemoteHostedPipHostLayout {
  return {
    anchors: null,
    anchorRect: null,
    animated: false,
    hostId,
    presentationScope,
  };
}

export function buildRemoteHostedPipHostLayout({
  hostId = REMOTE_HOSTED_PIP_MAIN_THREAD_HOST_ID,
  hostRect,
  obstacleRects,
  presentationScope = "thread",
}: RemoteHostedPipHostLayoutInput): RemoteHostedPipHostLayout {
  const paddedObstacleRects = obstacleRects.map((rect) => buildPaddedObstacleRect(hostRect, rect));

  return {
    anchorRect: hostRect,
    anchors: REMOTE_HOSTED_PIP_ANCHOR_ALIGNMENTS.map((alignment) =>
      buildRemoteHostedPipAnchor(alignment, hostRect, paddedObstacleRects)
    ),
    animated: false,
    hostId,
    presentationScope,
  };
}

export function serializeRemoteHostedPipHostLayoutIdentity(layout: RemoteHostedPipHostLayout): string {
  return JSON.stringify({
    anchors: layout.anchors,
    anchorRect: layout.anchorRect,
    hostId: layout.hostId,
    presentationScope: layout.presentationScope,
  });
}

function buildRemoteHostedPipAnchor(
  alignment: RemoteHostedPipAnchorAlignment,
  hostRect: RemoteHostedPipViewportRect,
  obstacleRects: RemoteHostedPipRelativeRect[],
): RemoteHostedPipAnchor {
  const sourceRect = getDefaultAnchorContentRect(alignment, hostRect);
  let currentRect = sourceRect;

  for (let index = 0; index < REMOTE_HOSTED_PIP_MAX_ADJUSTMENTS; index += 1) {
    const obstacle = findIntersectingObstacle(currentRect, obstacleRects);
    if (obstacle === null) break;

    currentRect = resolveNextAnchorContentRect({
      alignment,
      hostRect,
      obstacle,
      obstacles: obstacleRects,
      rect: currentRect,
      sourceRect,
    });
  }

  return {
    alignment,
    point: getAnchorPoint(alignment, hostRect, currentRect),
  };
}

function getDefaultAnchorContentRect(
  alignment: RemoteHostedPipAnchorAlignment,
  hostRect: RemoteHostedPipViewportRect,
): RemoteHostedPipRelativeRect {
  switch (alignment) {
    case "top-left":
      return createRelativeRect(
        REMOTE_HOSTED_PIP_VIEWPORT_MARGIN_PX,
        REMOTE_HOSTED_PIP_VIEWPORT_MARGIN_PX,
        REMOTE_HOSTED_PIP_DEFAULT_CONTENT_RECT,
      );
    case "top-right":
      return createRelativeRect(
        hostRect.width - REMOTE_HOSTED_PIP_DEFAULT_CONTENT_RECT.width - REMOTE_HOSTED_PIP_VIEWPORT_MARGIN_PX,
        REMOTE_HOSTED_PIP_VIEWPORT_MARGIN_PX,
        REMOTE_HOSTED_PIP_DEFAULT_CONTENT_RECT,
      );
    case "bottom-left":
      return createRelativeRect(
        REMOTE_HOSTED_PIP_VIEWPORT_MARGIN_PX,
        hostRect.height - REMOTE_HOSTED_PIP_DEFAULT_CONTENT_RECT.height - REMOTE_HOSTED_PIP_VIEWPORT_MARGIN_PX,
        REMOTE_HOSTED_PIP_DEFAULT_CONTENT_RECT,
      );
    case "bottom-right":
      return createRelativeRect(
        hostRect.width - REMOTE_HOSTED_PIP_DEFAULT_CONTENT_RECT.width - REMOTE_HOSTED_PIP_VIEWPORT_MARGIN_PX,
        hostRect.height - REMOTE_HOSTED_PIP_DEFAULT_CONTENT_RECT.height - REMOTE_HOSTED_PIP_VIEWPORT_MARGIN_PX,
        REMOTE_HOSTED_PIP_DEFAULT_CONTENT_RECT,
      );
  }
}

function resolveNextAnchorContentRect({
  alignment,
  hostRect,
  obstacle,
  obstacles,
  rect,
  sourceRect,
}: {
  alignment: RemoteHostedPipAnchorAlignment;
  hostRect: RemoteHostedPipViewportRect;
  obstacle: RemoteHostedPipRelativeRect;
  obstacles: RemoteHostedPipRelativeRect[];
  rect: RemoteHostedPipRelativeRect;
  sourceRect: RemoteHostedPipRelativeRect;
}): RemoteHostedPipRelativeRect {
  const candidates = buildAnchorCandidates(alignment, rect, obstacle).map((candidate) => ({
    priority: candidate.priority,
    rect: clampRelativeRectToHost(candidate.rect, hostRect),
  }));
  let bestCandidate = candidates[0];
  let bestScore = bestCandidate ? scoreAnchorCandidate(bestCandidate, obstacles, sourceRect) : Number.POSITIVE_INFINITY;

  for (const candidate of candidates.slice(1)) {
    const score = scoreAnchorCandidate(candidate, obstacles, sourceRect);
    if (score >= bestScore) continue;

    bestCandidate = candidate;
    bestScore = score;
  }

  return bestCandidate?.rect ?? rect;
}

function buildAnchorCandidates(
  alignment: RemoteHostedPipAnchorAlignment,
  rect: RemoteHostedPipRelativeRect,
  obstacle: RemoteHostedPipRelativeRect,
): RemoteHostedPipAnchorCandidate[] {
  const below = createRelativeRect(rect.left, obstacle.bottom, rect);
  const above = createRelativeRect(rect.left, obstacle.top - rect.height, rect);
  const right = createRelativeRect(obstacle.right, rect.top, rect);
  const left = createRelativeRect(obstacle.left - rect.width, rect.top, rect);

  switch (alignment) {
    case "top-left":
      return [
        { priority: 0, rect: below },
        { priority: 1, rect: right },
        { priority: 2, rect: left },
        { priority: 3, rect: above },
      ];
    case "top-right":
      return [
        { priority: 0, rect: below },
        { priority: 1, rect: left },
        { priority: 2, rect: right },
        { priority: 3, rect: above },
      ];
    case "bottom-left":
      return [
        { priority: 0, rect: above },
        { priority: 1, rect: right },
        { priority: 2, rect: left },
        { priority: 3, rect: below },
      ];
    case "bottom-right":
      return [
        { priority: 0, rect: above },
        { priority: 1, rect: left },
        { priority: 2, rect: right },
        { priority: 3, rect: below },
      ];
  }
}

function scoreAnchorCandidate(
  candidate: RemoteHostedPipAnchorCandidate,
  obstacles: RemoteHostedPipRelativeRect[],
  sourceRect: RemoteHostedPipRelativeRect,
): number {
  const overlapArea = obstacles.reduce((sum, obstacle) => sum + getIntersectionArea(candidate.rect, obstacle), 0);

  return (
    (overlapArea > 0 ? REMOTE_HOSTED_PIP_OVERLAP_PENALTY : 0)
    + overlapArea * REMOTE_HOSTED_PIP_OVERLAP_AREA_WEIGHT
    + candidate.priority * REMOTE_HOSTED_PIP_PRIORITY_WEIGHT
    + (candidate.rect.left - sourceRect.left) ** 2
    + (candidate.rect.top - sourceRect.top) ** 2
  );
}

function findIntersectingObstacle(
  rect: RemoteHostedPipRelativeRect,
  obstacles: RemoteHostedPipRelativeRect[],
): RemoteHostedPipRelativeRect | null {
  for (const obstacle of obstacles) {
    if (getIntersectionArea(rect, obstacle) > 0) return obstacle;
  }

  return null;
}

function buildPaddedObstacleRect(
  hostRect: RemoteHostedPipViewportRect,
  obstacleRect: RemoteHostedPipViewportRect,
): RemoteHostedPipRelativeRect {
  return createRelativeRectFromEdges({
    bottom: obstacleRect.y - hostRect.y + obstacleRect.height + REMOTE_HOSTED_PIP_OBSTACLE_MARGIN_PX,
    left: obstacleRect.x - hostRect.x - REMOTE_HOSTED_PIP_OBSTACLE_MARGIN_PX,
    right: obstacleRect.x - hostRect.x + obstacleRect.width + REMOTE_HOSTED_PIP_OBSTACLE_MARGIN_PX,
    top: obstacleRect.y - hostRect.y - REMOTE_HOSTED_PIP_OBSTACLE_MARGIN_PX,
  });
}

function getAnchorPoint(
  alignment: RemoteHostedPipAnchorAlignment,
  hostRect: RemoteHostedPipViewportRect,
  rect: RemoteHostedPipRelativeRect,
): RemoteHostedPipPoint {
  switch (alignment) {
    case "top-left":
      return {
        x: hostRect.x + rect.left,
        y: hostRect.y + rect.top,
      };
    case "top-right":
      return {
        x: hostRect.x + rect.right,
        y: hostRect.y + rect.top,
      };
    case "bottom-left":
      return {
        x: hostRect.x + rect.left,
        y: hostRect.y + rect.bottom,
      };
    case "bottom-right":
      return {
        x: hostRect.x + rect.right,
        y: hostRect.y + rect.bottom,
      };
  }
}

function clampRelativeRectToHost(
  rect: RemoteHostedPipRelativeRect,
  hostRect: RemoteHostedPipViewportRect,
): RemoteHostedPipRelativeRect {
  return createRelativeRect(
    clamp(rect.left, REMOTE_HOSTED_PIP_VIEWPORT_MARGIN_PX, Math.max(REMOTE_HOSTED_PIP_VIEWPORT_MARGIN_PX, hostRect.width - rect.width - REMOTE_HOSTED_PIP_VIEWPORT_MARGIN_PX)),
    clamp(rect.top, REMOTE_HOSTED_PIP_VIEWPORT_MARGIN_PX, Math.max(REMOTE_HOSTED_PIP_VIEWPORT_MARGIN_PX, hostRect.height - rect.height - REMOTE_HOSTED_PIP_VIEWPORT_MARGIN_PX)),
    rect,
  );
}

function createRelativeRect(
  left: number,
  top: number,
  size: Pick<RemoteHostedPipRelativeRect, "height" | "width">,
): RemoteHostedPipRelativeRect {
  return {
    bottom: top + size.height,
    height: size.height,
    left,
    right: left + size.width,
    top,
    width: size.width,
  };
}

function createRelativeRectFromEdges({
  bottom,
  left,
  right,
  top,
}: {
  bottom: number;
  left: number;
  right: number;
  top: number;
}): RemoteHostedPipRelativeRect {
  return {
    bottom,
    height: bottom - top,
    left,
    right,
    top,
    width: right - left,
  };
}

function getIntersectionArea(leftRect: RemoteHostedPipRelativeRect, rightRect: RemoteHostedPipRelativeRect): number {
  const width = Math.min(leftRect.right, rightRect.right) - Math.max(leftRect.left, rightRect.left);
  const height = Math.min(leftRect.bottom, rightRect.bottom) - Math.max(leftRect.top, rightRect.top);
  return width <= 0 || height <= 0 ? 0 : width * height;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
