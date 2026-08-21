export const GENERATED_IMAGE_VIEW_TRANSITION_DURATION_MS = 450;
export const GENERATED_IMAGE_VIEW_TRANSITION_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

export interface GeneratedImageTransitionRect {
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
}

export interface GeneratedImageViewTransitionPlan {
  readonly keyframes: Keyframe[];
  readonly options: KeyframeAnimationOptions;
}

function normalizeScale(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}

export function isUsableGeneratedImageTransitionRect(
  rect: GeneratedImageTransitionRect | null | undefined,
): rect is GeneratedImageTransitionRect {
  return (
    rect !== null &&
    rect !== undefined &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

/**
 * Reprojects the active image's old physical rect onto its new visual.
 * DOMRect deltas include the Electron root zoom, and Canvas adds CSS zoom;
 * scale remains the unadjusted ratio of the two measured rectangles.
 */
export function createGeneratedImageViewTransitionPlan(input: {
  readonly after: GeneratedImageTransitionRect;
  readonly before: GeneratedImageTransitionRect;
  readonly canvasZoomPercent: number;
  readonly enteringCanvas: boolean;
  readonly windowZoom: number;
}): GeneratedImageViewTransitionPlan {
  const canvasZoom = input.enteringCanvas ? normalizeScale(input.canvasZoomPercent / 100) : 1;
  const translationScale = normalizeScale(input.windowZoom) * canvasZoom;
  const translateX = round4((input.before.left - input.after.left) / translationScale);
  const translateY = round4((input.before.top - input.after.top) / translationScale);
  const scaleX = round4(input.before.width / input.after.width);
  const scaleY = round4(input.before.height / input.after.height);

  return {
    keyframes: [
      {
        transform: `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`,
        transformOrigin: "top left",
      },
      { transform: "none", transformOrigin: "top left" },
    ],
    options: {
      duration: GENERATED_IMAGE_VIEW_TRANSITION_DURATION_MS,
      easing: GENERATED_IMAGE_VIEW_TRANSITION_EASING,
      fill: "both",
    },
  };
}

export function readImageEditorWindowZoom(element: Element | null): number {
  if (!element || typeof window === "undefined") return 1;
  const rawValue = window.getComputedStyle(element).getPropertyValue("--codex-window-zoom");
  const zoom = Number.parseFloat(rawValue);
  return normalizeScale(zoom);
}

export function scrollGeneratedImageTransitionTargetIntoView(element: HTMLElement): void {
  const scroller = element.closest<HTMLElement>("[data-generated-image-playground-scroll]");
  const clippedRight =
    scroller !== null &&
    element.getBoundingClientRect().right > scroller.getBoundingClientRect().right;
  if (typeof element.scrollIntoView !== "function") return;
  element.scrollIntoView({
    block: "start",
    inline: clippedRight ? "center" : "nearest",
  });
}
