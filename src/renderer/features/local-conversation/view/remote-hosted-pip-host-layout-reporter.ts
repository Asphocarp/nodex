import { useEffect } from "react";
import {
  REMOTE_HOSTED_PIP_ANCHOR_HOST_ATTRIBUTE,
  REMOTE_HOSTED_PIP_MAIN_THREAD_HOST_ID,
  REMOTE_HOSTED_PIP_OBSTACLE_ATTRIBUTE,
  buildRemoteHostedPipHiddenHostLayout,
  buildRemoteHostedPipHostLayout,
  serializeRemoteHostedPipHostLayoutIdentity,
  type RemoteHostedPipHostLayout,
  type RemoteHostedPipViewportRect,
} from "../../../../shared/remote-hosted-pip";

const REMOTE_HOSTED_PIP_ANCHOR_SELECTOR =
  `[${REMOTE_HOSTED_PIP_ANCHOR_HOST_ATTRIBUTE}="${REMOTE_HOSTED_PIP_MAIN_THREAD_HOST_ID}"]`;
const REMOTE_HOSTED_PIP_OBSTACLE_SELECTOR = `[${REMOTE_HOSTED_PIP_OBSTACLE_ATTRIBUTE}]`;
const REMOTE_HOSTED_PIP_OBSERVED_SELECTOR =
  `${REMOTE_HOSTED_PIP_ANCHOR_SELECTOR},${REMOTE_HOSTED_PIP_OBSTACLE_SELECTOR}`;

export function useRemoteHostedPipHostLayoutReporter(scale = 1): void {
  useEffect(() => {
    const sendMessageFromView = window.electronBridge?.sendMessageFromView;
    if (sendMessageFromView === undefined || document.body === null) return undefined;

    const effectiveScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    let frameId: number | null = null;
    let lastIdentity: string | null = null;
    const resizeObserver = createResizeObserver(() => schedulePublish());
    const observedAttributeObserver = createObservedAttributeObserver(() => schedulePublish());
    const treeObserver = createTreeObserver((records) => {
      if (!records.some(isRemoteHostedPipObservedMutation)) return;

      refreshObservedElements();
      schedulePublish();
    });

    const publishLayout = (layout: RemoteHostedPipHostLayout) => {
      const identity = serializeRemoteHostedPipHostLayoutIdentity(layout);
      if (identity === lastIdentity) return;

      lastIdentity = identity;
      void sendMessageFromView({
        layout,
        type: "remote-hosted-pip-host-layout-changed",
      }).catch(() => undefined);
    };

    function clearLayout() {
      publishLayout(buildRemoteHostedPipHiddenHostLayout());
    }

    function schedulePublish() {
      if (frameId !== null) return;

      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        publishCurrentLayout();
      });
    }

    function publishCurrentLayout() {
      const hostElement = document.querySelector(REMOTE_HOSTED_PIP_ANCHOR_SELECTOR);
      if (!(hostElement instanceof HTMLElement)) {
        clearLayout();
        return;
      }

      const hostRect = readElementViewportRect(hostElement, effectiveScale);
      if (hostRect === null) {
        clearLayout();
        return;
      }

      const obstacleRects = Array.from(document.querySelectorAll(REMOTE_HOSTED_PIP_OBSTACLE_SELECTOR))
        .flatMap((element) => {
          if (!(element instanceof HTMLElement)) return [];

          const rect = readElementViewportRect(element, effectiveScale);
          return rect === null ? [] : [rect];
        });

      publishLayout(buildRemoteHostedPipHostLayout({
        hostRect,
        obstacleRects,
      }));
    }

    function refreshObservedElements() {
      resizeObserver?.disconnect();
      observedAttributeObserver?.disconnect();

      for (const element of document.querySelectorAll(REMOTE_HOSTED_PIP_OBSERVED_SELECTOR)) {
        resizeObserver?.observe(element);
        observedAttributeObserver?.observe(element, {
          attributeFilter: ["class", "hidden", "style"],
          attributes: true,
        });
      }
    }

    treeObserver?.observe(document.body, {
      attributeFilter: [REMOTE_HOSTED_PIP_ANCHOR_HOST_ATTRIBUTE, REMOTE_HOSTED_PIP_OBSTACLE_ATTRIBUTE],
      attributes: true,
      childList: true,
      subtree: true,
    });
    window.addEventListener("resize", schedulePublish);
    document.addEventListener("scroll", schedulePublish, true);
    refreshObservedElements();
    schedulePublish();

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
        frameId = null;
      }
      resizeObserver?.disconnect();
      observedAttributeObserver?.disconnect();
      treeObserver?.disconnect();
      window.removeEventListener("resize", schedulePublish);
      document.removeEventListener("scroll", schedulePublish, true);
      clearLayout();
    };
  }, [scale]);
}

function readElementViewportRect(element: HTMLElement, scale: number): RemoteHostedPipViewportRect | null {
  if (element.hidden) return null;

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  return {
    height: rect.height / scale,
    width: rect.width / scale,
    x: rect.left / scale,
    y: rect.top / scale,
  };
}

function isRemoteHostedPipObservedMutation(record: MutationRecord): boolean {
  if (record.type === "attributes") return true;

  for (const node of record.addedNodes) {
    if (containsRemoteHostedPipObservedElement(node)) return true;
  }
  for (const node of record.removedNodes) {
    if (containsRemoteHostedPipObservedElement(node)) return true;
  }

  return false;
}

function containsRemoteHostedPipObservedElement(node: Node): boolean {
  return node instanceof HTMLElement
    && (node.matches(REMOTE_HOSTED_PIP_OBSERVED_SELECTOR)
      || node.querySelector(REMOTE_HOSTED_PIP_OBSERVED_SELECTOR) !== null);
}

function createResizeObserver(callback: ResizeObserverCallback): ResizeObserver | null {
  if (typeof ResizeObserver === "undefined") return null;
  return new ResizeObserver(callback);
}

function createObservedAttributeObserver(callback: MutationCallback): MutationObserver | null {
  if (typeof MutationObserver === "undefined") return null;
  return new MutationObserver(callback);
}

function createTreeObserver(callback: MutationCallback): MutationObserver | null {
  if (typeof MutationObserver === "undefined") return null;
  return new MutationObserver(callback);
}
