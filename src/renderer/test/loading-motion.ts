export interface LoadingAnimationStyle {
  display: string;
  opacity: string;
  visibility: string;
}

export interface NormalizedLoadingAnimation {
  animatedProperties: string[];
  currentTimeMs: number | null;
  delayMs: number;
  durationMs: number | "auto";
  hiddenByAncestor: boolean;
  iterationCount: number;
  playState: AnimationPlayState;
  pseudoElement: string | null;
  target: string;
}

type StyleReader = (element: Element) => LoadingAnimationStyle;

function isElementTarget(value: unknown): value is Element {
  if (typeof Element !== "undefined") return value instanceof Element;
  if (typeof value !== "object" || value === null) return false;
  return "tagName" in value && "getAttribute" in value;
}

function readAnimationElement(target: KeyframeEffect["target"]): Element | null {
  if (target == null) return null;
  if ("element" in target && isElementTarget(target.element)) {
    return target.element;
  }
  return isElementTarget(target) ? target : null;
}

function describeAnimationTarget(element: Element | null): string {
  if (!element) return "unknown";
  const testId = element.getAttribute("data-testid");
  if (testId) return `${element.tagName.toLowerCase()}[data-testid="${testId}"]`;
  const role = element.getAttribute("role");
  if (role) return `${element.tagName.toLowerCase()}[role="${role}"]`;
  const label = element.getAttribute("aria-label");
  if (label) return `${element.tagName.toLowerCase()}[aria-label="${label}"]`;
  return element.tagName.toLowerCase();
}

function isAnimationTargetHidden(element: Element | null, readStyle: StyleReader): boolean {
  for (let current = element; current; current = current.parentElement) {
    const style = readStyle(current);
    if (style.display === "none" || style.visibility === "hidden") return true;
    if (Number.parseFloat(style.opacity) === 0) return true;
  }
  return false;
}

function readAnimatedProperties(keyframes: ComputedKeyframe[]): string[] {
  const metadata = new Set(["composite", "computedOffset", "easing", "offset"]);
  return [
    ...new Set(
      keyframes
        .flatMap((keyframe) => Object.keys(keyframe))
        .filter((property) => !metadata.has(property)),
    ),
  ].sort();
}

function isKeyframeEffect(effect: AnimationEffect): effect is KeyframeEffect {
  return typeof (effect as Partial<KeyframeEffect>).getKeyframes === "function";
}

function normalizeDuration(duration: ComputedEffectTiming["duration"]): number | "auto" {
  if (typeof duration === "number") return duration;
  if (duration === "auto" || duration == null) return "auto";
  const parsed = Number(duration.toString());
  return Number.isFinite(parsed) ? parsed : "auto";
}

export function normalizeLoadingAnimation(
  animation: Animation,
  readStyle: StyleReader = (element) => getComputedStyle(element),
): NormalizedLoadingAnimation | null {
  const effect = animation.effect;
  if (!effect || !isKeyframeEffect(effect)) return null;
  const target = readAnimationElement(effect.target);
  const timing = effect.getComputedTiming();

  return {
    animatedProperties: readAnimatedProperties(effect.getKeyframes()),
    currentTimeMs: typeof animation.currentTime === "number" ? animation.currentTime : null,
    delayMs: timing.delay ?? 0,
    durationMs: normalizeDuration(timing.duration),
    hiddenByAncestor: isAnimationTargetHidden(target, readStyle),
    iterationCount: timing.iterations ?? 1,
    playState: animation.playState,
    pseudoElement: effect.pseudoElement,
    target: describeAnimationTarget(target),
  };
}

export function readLoadingAnimations(root: Element): NormalizedLoadingAnimation[] {
  return root
    .getAnimations({ subtree: true })
    .map((animation) => normalizeLoadingAnimation(animation))
    .filter((animation): animation is NormalizedLoadingAnimation => animation !== null);
}
