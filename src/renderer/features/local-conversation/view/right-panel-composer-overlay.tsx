import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon, PlusIcon } from "@/components/shared/icons";
import {
  RIGHT_PANEL_COMPOSER_OVERLAY_HEIGHT_PX,
  RIGHT_PANEL_COMPOSER_OVERLAY_HEIGHT_VAR,
  RIGHT_PANEL_COMPOSER_OVERLAY_RESERVE_PX,
  RIGHT_PANEL_COMPOSER_OVERLAY_RESERVE_VAR,
} from "@/lib/right-panel-composer-overlay-reserve";
import { APP_SHELL_RIGHT_PANEL_COMPOSER_OVERLAY_LAYER_CLASS } from "@/lib/app-shell-layers";
import { cn } from "@/lib/utils";
import {
  RightPanelComposerPresentationProvider,
  type RightPanelComposerPresentation,
} from "./right-panel-composer-presentation";

interface RightPanelComposerOverlayProps {
  target: HTMLElement | null;
  compact?: boolean;
  visibility?: RightPanelComposerOverlayVisibility;
  children: ReactNode;
  onPointerDownOutside?: () => void;
}

export type RightPanelComposerOverlayAttention =
  | "none"
  | "activity"
  | "request";

export type RightPanelComposerOverlayVisibility =
  | { readonly kind: "always" }
  | {
      readonly kind: "controlled";
      readonly visible: boolean;
      readonly attention: RightPanelComposerOverlayAttention;
      readonly focusRequestKey?: number;
      readonly onVisibleChange: (visible: boolean) => void;
    }
  | {
      readonly kind: "browser-auto";
      readonly documentBottomKey: string | null;
      readonly isAtDocumentBottom: boolean;
    }
  | {
      readonly kind: "controlled-browser-auto";
      readonly visible: boolean;
      readonly attention: RightPanelComposerOverlayAttention;
      readonly onVisibleChange: (visible: boolean) => void;
      readonly documentBottomKey: string | null;
      readonly isAtDocumentBottom: boolean;
    };

export interface RightPanelComposerPortalGeometry {
  height: number;
  left: number;
  top: number;
  width: number;
  zoom: number;
}

export function resolveRightPanelComposerPortalGeometry({
  rect,
  viewportHeight,
  zoom,
}: {
  rect: Pick<DOMRect, "left" | "top" | "width">;
  viewportHeight: number;
  zoom: number;
}): RightPanelComposerPortalGeometry {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return {
    height: Math.max(0, viewportHeight - rect.top) / safeZoom,
    left: rect.left / safeZoom,
    top: rect.top / safeZoom,
    width: rect.width / safeZoom,
    zoom: safeZoom,
  };
}

function readWindowZoom(target: HTMLElement): number {
  const view = target.ownerDocument.defaultView;
  if (!view) return 1;

  const rawZoom = view.getComputedStyle(target)
    .getPropertyValue("--codex-window-zoom");
  const zoom = Number.parseFloat(rawZoom);
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

function findInlineCustomPropertyOwner(
  target: HTMLElement,
  property: string,
): HTMLElement | null {
  let current: HTMLElement | null = target;
  while (current) {
    if (current.style.getPropertyValue(property).trim()) return current;
    current = current.parentElement;
  }
  return null;
}

function writeRightPanelComposerOverlayVars(
  target: HTMLElement,
  reservePx: number,
) {
  target.style.setProperty(
    RIGHT_PANEL_COMPOSER_OVERLAY_HEIGHT_VAR,
    `${RIGHT_PANEL_COMPOSER_OVERLAY_HEIGHT_PX}px`,
  );
  target.style.setProperty(
    RIGHT_PANEL_COMPOSER_OVERLAY_RESERVE_VAR,
    `${reservePx}px`,
  );
}

function removeRightPanelComposerOverlayVars(target: HTMLElement) {
  target.style.removeProperty(RIGHT_PANEL_COMPOSER_OVERLAY_HEIGHT_VAR);
  target.style.removeProperty(RIGHT_PANEL_COMPOSER_OVERLAY_RESERVE_VAR);
}

function isOpenComposerMenuTarget(
  target: EventTarget | null,
  composer: HTMLElement | null,
): boolean {
  if (!(target instanceof Element)) return false;
  if (!target.closest("[data-radix-popper-content-wrapper]")) return false;
  return composer
    ?.querySelector('[aria-haspopup="menu"][data-state="open"]') != null;
}

function hasFocusedComposerDraft(composer: HTMLElement | null): boolean {
  const editor = composer?.querySelector<HTMLElement>(
    '[data-codex-composer="true"]',
  );
  if (!editor?.textContent?.trim()) return false;

  const activeElement = editor.ownerDocument.activeElement;
  if (!(activeElement instanceof Element)) return false;
  if (composer?.contains(activeElement)) return true;
  return isOpenComposerMenuTarget(activeElement, composer);
}

function resolvePresentation({
  focused,
  hovered,
}: {
  focused: boolean;
  hovered: boolean;
}): RightPanelComposerPresentation {
  if (focused) return "expanded";
  if (hovered) return "compact-hovered";
  return "compact";
}

function useAnchoredBodyPortalGeometry(
  target: HTMLElement | null,
  reservePx: number,
): {
  bottomPanelHeight: string;
  geometry: RightPanelComposerPortalGeometry | null;
} {
  const [geometry, setGeometry] =
    useState<RightPanelComposerPortalGeometry | null>(null);
  const [bottomPanelHeight, setBottomPanelHeight] = useState("0px");

  const syncGeometry = useEffectEvent(() => {
    if (!target) return;
    const view = target.ownerDocument.defaultView;
    if (!view) return;

    setGeometry(resolveRightPanelComposerPortalGeometry({
      rect: target.getBoundingClientRect(),
      viewportHeight: view.innerHeight,
      zoom: readWindowZoom(target),
    }));
    const computedStyle = view.getComputedStyle(target);
    setBottomPanelHeight(
      computedStyle.getPropertyValue("--app-shell-bottom-panel-height").trim()
        || "0px",
    );
  });

  useLayoutEffect(() => {
    if (!target) {
      setGeometry(null);
      return;
    }

    writeRightPanelComposerOverlayVars(target, reservePx);
    syncGeometry();
    return () => removeRightPanelComposerOverlayVars(target);
  }, [reservePx, target]);

  useLayoutEffect(() => {
    if (!target) return;
    const view = target.ownerDocument.defaultView;
    if (!view) return;

    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(syncGeometry);
    resizeObserver?.observe(target);
    const mutationObserver = typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(syncGeometry);
    const observedStyleOwners = new Set([
      findInlineCustomPropertyOwner(target, "--app-shell-bottom-panel-height"),
      findInlineCustomPropertyOwner(target, "--codex-window-zoom"),
    ].filter((owner): owner is HTMLElement => owner !== null));
    for (const owner of observedStyleOwners) {
      mutationObserver?.observe(owner, {
        attributes: true,
        attributeFilter: ["style"],
      });
    }
    view.addEventListener("resize", syncGeometry);
    return () => {
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      view.removeEventListener("resize", syncGeometry);
    };
  }, [target]);

  return { bottomPanelHeight, geometry };
}

export function RightPanelComposerOverlay({
  target,
  compact = false,
  visibility = { kind: "always" },
  children,
  onPointerDownOutside,
}: RightPanelComposerOverlayProps) {
  const [hiddenReason, setHiddenReason] =
    useState<"manual" | "document-bottom" | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const interactiveRef = useRef<HTMLDivElement | null>(null);
  const revealButtonRef = useRef<HTMLButtonElement | null>(null);
  const focusRevealAfterHideRef = useRef(false);
  const documentBottomKey = visibility.kind === "browser-auto"
    || visibility.kind === "controlled-browser-auto"
    ? visibility.documentBottomKey
    : null;
  const isAtDocumentBottom = visibility.kind === "browser-auto"
    || visibility.kind === "controlled-browser-auto"
    ? visibility.isAtDocumentBottom
    : false;
  const previousDocumentBottomRef = useRef({
    key: documentBottomKey,
    value: false,
  });
  const contentVisible = visibility.kind === "controlled"
    ? visibility.visible
    : visibility.kind === "controlled-browser-auto"
      ? visibility.visible && hiddenReason === null
    : visibility.kind === "browser-auto"
      ? hiddenReason === null
      : true;
  const canHide = visibility.kind !== "always";
  const controlledFocusRequestKey = visibility.kind === "controlled"
    ? visibility.focusRequestKey ?? 0
    : 0;
  const consumedControlledFocusRequestKeyRef = useRef<number | null>(null);
  const reservePx = contentVisible && !compact
    ? RIGHT_PANEL_COMPOSER_OVERLAY_RESERVE_PX
    : 0;
  const { bottomPanelHeight, geometry } =
    useAnchoredBodyPortalGeometry(target, reservePx);

  const presentation = compact
    ? resolvePresentation({ focused, hovered })
    : "default";

  const handleDocumentPointerDown = useEffectEvent((event: PointerEvent) => {
    if (!contentVisible || !onPointerDownOutside) return;

    const eventTarget = event.target;
    const NodeConstructor = target?.ownerDocument.defaultView?.Node;
    if (!NodeConstructor || !(eventTarget instanceof NodeConstructor)) return;
    if (interactiveRef.current?.contains(eventTarget as Node)) return;

    onPointerDownOutside();
  });

  useEffect(() => {
    const document = target?.ownerDocument ?? globalThis.document;
    document?.addEventListener("pointerdown", handleDocumentPointerDown, true);
    return () => {
      document?.removeEventListener("pointerdown", handleDocumentPointerDown, true);
    };
  }, [target]);

  useLayoutEffect(() => {
    if (
      visibility.kind !== "browser-auto"
      && visibility.kind !== "controlled-browser-auto"
    ) {
      previousDocumentBottomRef.current = {
        key: documentBottomKey,
        value: false,
      };
      setHiddenReason(null);
      return;
    }

    const previous = previousDocumentBottomRef.current;
    const tabChanged = previous.key !== documentBottomKey;
    const wasAtDocumentBottom = tabChanged ? false : previous.value;
    previousDocumentBottomRef.current = {
      key: documentBottomKey,
      value: isAtDocumentBottom,
    };

    if (
      isAtDocumentBottom
      && !wasAtDocumentBottom
      && !hasFocusedComposerDraft(interactiveRef.current)
    ) {
      setHiddenReason((current) => current ?? "document-bottom");
      return;
    }
    if (!isAtDocumentBottom) {
      setHiddenReason((current) =>
        current === "document-bottom" ? null : current
      );
    }
  }, [documentBottomKey, isAtDocumentBottom, visibility.kind]);

  useLayoutEffect(() => {
    if (!contentVisible || controlledFocusRequestKey <= 0) return;
    if (
      consumedControlledFocusRequestKeyRef.current
      === controlledFocusRequestKey
    ) return;

    const frame = requestAnimationFrame(() => {
      const editor = interactiveRef.current
        ?.querySelector<HTMLElement>('[data-codex-composer="true"]')
        ?? null;
      if (!editor) return;
      editor.focus();
      consumedControlledFocusRequestKeyRef.current =
        controlledFocusRequestKey;
    });
    return () => cancelAnimationFrame(frame);
  }, [contentVisible, controlledFocusRequestKey, target]);

  useLayoutEffect(() => {
    if (contentVisible || !focusRevealAfterHideRef.current) return;
    focusRevealAfterHideRef.current = false;
    const frame = requestAnimationFrame(() => {
      revealButtonRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [contentVisible]);

  const handleBlurCapture = (event: ReactFocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    const NodeConstructor =
      event.currentTarget.ownerDocument.defaultView?.Node;
    if (
      NodeConstructor
      && nextTarget instanceof NodeConstructor
      && event.currentTarget.contains(nextTarget as Node)
    ) {
      return;
    }
    if (isOpenComposerMenuTarget(nextTarget, interactiveRef.current)) return;
    setFocused(false);
    onPointerDownOutside?.();
  };

  const handlePointerEnter = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    setHovered(true);
  };

  const handleReveal = () => {
    if (
      visibility.kind === "controlled"
      || visibility.kind === "controlled-browser-auto"
    ) {
      visibility.onVisibleChange(true);
    }
    setHiddenReason(null);
    setFocused(true);
    requestAnimationFrame(() => {
      interactiveRef.current
        ?.querySelector<HTMLElement>('[data-codex-composer="true"]')
        ?.focus();
    });
  };

  if (!target || !geometry) return null;

  const portalStyle: CSSProperties = {
    height: geometry.height,
    left: geometry.left,
    top: geometry.top,
    width: geometry.width,
    zoom: geometry.zoom,
  };
  const overlayStyle = {
    "--right-panel-composer-overlay-bottom-panel-height": bottomPanelHeight,
    bottom: "var(--right-panel-composer-overlay-bottom-panel-height)",
    transform: "translateY(0px)",
  } as CSSProperties;

  const overlay = (
    <div
      data-testid="right-panel-composer-overlay-host"
      data-overlay-attention={
        visibility.kind === "controlled"
        || visibility.kind === "controlled-browser-auto"
          ? visibility.attention
          : "none"
      }
      className={cn(
        "pointer-events-none fixed",
        compact ? "overflow-hidden" : "overflow-visible",
        APP_SHELL_RIGHT_PANEL_COMPOSER_OVERLAY_LAYER_CLASS,
      )}
      style={portalStyle}
    >
      <div
        data-testid="right-panel-composer-overlay"
        aria-hidden={!contentVisible}
        className={cn(
          "pointer-events-none absolute inset-x-0 transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none",
          APP_SHELL_RIGHT_PANEL_COMPOSER_OVERLAY_LAYER_CLASS,
          contentVisible ? "opacity-100" : "opacity-0",
        )}
        style={overlayStyle}
      >
        <div className="mx-auto w-full max-w-(--thread-content-max-width) px-toolbar pb-6">
          <div
            data-right-panel-composer-overlay-content="true"
            className={cn(
              "mx-auto w-full transition-[max-width] duration-150 ease-out motion-reduce:transition-none [--right-panel-composer-accessory-inline-inset:13px]",
              compact && presentation !== "expanded" ? "max-w-sm" : "max-w-full",
            )}
          >
            <div
              ref={interactiveRef}
              className={cn(
                "group/floating-composer relative isolate",
                contentVisible ? "pointer-events-auto" : "pointer-events-none",
              )}
              onPointerEnter={handlePointerEnter}
              onPointerLeave={() => setHovered(false)}
              onFocusCapture={() => setFocused(true)}
              onBlurCapture={handleBlurCapture}
            >
              <div
                className={cn(
                  "relative z-10 min-w-0 transition-opacity duration-150 ease-out motion-reduce:transition-none",
                  contentVisible
                    ? presentation === "compact"
                      ? "opacity-95 delay-300"
                      : "opacity-100"
                    : "opacity-0",
                )}
                inert={!contentVisible}
              >
                <RightPanelComposerPresentationProvider
                  presentation={presentation}
                >
                  {children}
                </RightPanelComposerPresentationProvider>
              </div>
              {canHide ? (
                <button
                  type="button"
                  aria-label="Hide floating composer"
                  aria-hidden={!contentVisible}
                  inert={!contentVisible}
                  className={cn(
                    "composer-surface-chrome cursor-interaction absolute top-full left-1/2 z-0 flex h-7 w-36 -translate-x-1/2 items-end justify-center rounded-b-2xl bg-token-input-background/90 pb-0.5 text-token-description-foreground backdrop-blur-lg transition-[opacity,translate] duration-150 ease-out hover:-translate-y-3 focus-visible:-translate-y-3 focus-visible:ring-1 focus-visible:ring-token-focus-border focus-visible:outline-none motion-reduce:transition-none",
                    contentVisible
                      ? presentation === "expanded"
                        ? "pointer-events-auto -translate-y-4 opacity-100"
                        : "pointer-events-none -translate-y-full opacity-0 delay-75 group-hover/floating-composer:pointer-events-auto group-hover/floating-composer:-translate-y-4 group-hover/floating-composer:opacity-100 group-hover/floating-composer:delay-150 group-focus-within/floating-composer:pointer-events-auto group-focus-within/floating-composer:-translate-y-4 group-focus-within/floating-composer:opacity-100 group-focus-within/floating-composer:delay-0"
                      : "pointer-events-none -translate-y-full opacity-0",
                  )}
                  onClick={(event) => {
                    focusRevealAfterHideRef.current = event.detail === 0;
                    event.currentTarget.blur();
                    setFocused(false);
                    if (
                      visibility.kind === "controlled"
                      || visibility.kind === "controlled-browser-auto"
                    ) {
                      visibility.onVisibleChange(false);
                    } else {
                      setHiddenReason("manual");
                    }
                    onPointerDownOutside?.();
                  }}
                >
                  <ChevronDownIcon className="size-3" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const reveal = (
    <div
      className={cn(
        "pointer-events-none fixed overflow-hidden",
        APP_SHELL_RIGHT_PANEL_COMPOSER_OVERLAY_LAYER_CLASS,
      )}
      style={portalStyle}
      aria-hidden={contentVisible}
      inert={contentVisible}
    >
      <button
        ref={revealButtonRef}
        type="button"
        aria-label="Show floating composer"
        className={cn(
          "composer-surface-chrome cursor-interaction absolute right-0 bottom-0 left-0 mx-auto h-4 w-40 rounded-t-2xl bg-token-input-background/90 text-token-description-foreground opacity-95 backdrop-blur-lg transition-[height,opacity,translate] duration-150 ease-out hover:h-5 hover:opacity-100 focus-visible:h-5 focus-visible:ring-1 focus-visible:ring-token-focus-border focus-visible:outline-none motion-reduce:transition-none",
          !contentVisible
            ? "pointer-events-auto translate-y-0"
            : "pointer-events-none translate-y-full opacity-0",
        )}
        style={{
          bottom: bottomPanelHeight,
        }}
        onClick={handleReveal}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-3 top-0 flex h-4 items-center select-none"
        >
          <PlusIcon className="ml-1 size-2.5 shrink-0 opacity-50" />
          <span className="absolute top-1/2 left-1/2 h-0.5 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current opacity-30" />
          <ChevronDownIcon className="ml-auto size-2.5 rotate-180 opacity-60" />
        </span>
      </button>
    </div>
  );

  return (
    <>
      {createPortal(overlay, target.ownerDocument.body)}
      {canHide ? createPortal(reveal, target.ownerDocument.body) : null}
    </>
  );
}
