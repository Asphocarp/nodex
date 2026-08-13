export const DOT_FIELD_OPACITY_CUTOFF = 0.03;
export const DOT_FIELD_SIZE_FACTOR = 0.78;
export const DOT_FIELD_FIRST_WEIGHT = 1.2;
export const DOT_FIELD_SECOND_WEIGHT = 0.82;
export const DOT_FIELD_OPACITY_POWER = 1.18;
export const DOT_FIELD_DURATION_FACTOR = 1.2;
export const DOT_FIELD_OPACITY_DURATION_MS = 1_750;

const DOT_FIELD_DURATIONS = {
  offsetX1: 4_500,
  offsetY1: 6_330,
  offsetX2: 5_600,
  offsetY2: 5_750,
  fieldSize1: 3_600,
  fieldSize2: 2_400,
} as const;

export type GeneratedImageLoadingPresentation =
  | "default"
  | "single"
  | "playground"
  | "thumbnail";

export interface GeneratedImageDotFieldPresentation {
  readonly radius: number | null;
  readonly radiusFactor: number;
  readonly spacing: number;
}

export function resolveGeneratedImageDotFieldPresentation(
  presentation: GeneratedImageLoadingPresentation,
): GeneratedImageDotFieldPresentation {
  if (presentation === "playground") {
    return { radius: 1.5, radiusFactor: 0, spacing: 14 };
  }
  if (presentation === "thumbnail") {
    return { radius: 0.75, radiusFactor: 0, spacing: 6 };
  }
  return { radius: null, radiusFactor: 0.16, spacing: 12 };
}

export function resolveGeneratedImageDotFieldGridSpacing(
  presentation: GeneratedImageLoadingPresentation,
  devicePixelRatio: number,
): number {
  const { spacing } = resolveGeneratedImageDotFieldPresentation(presentation);
  if (presentation === "playground" || presentation === "thumbnail") {
    return spacing;
  }
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? devicePixelRatio
    : 1;
  return Math.max(1, spacing / dpr);
}

interface DotFieldChannels {
  readonly offsetX1: number;
  readonly offsetY1: number;
  readonly offsetX2: number;
  readonly offsetY2: number;
  readonly fieldSize1: number;
  readonly fieldSize2: number;
}

export interface GeneratedImageDotFieldConfig {
  readonly bounds: {
    readonly x1Start: number;
    readonly x1End: number;
    readonly y1Start: number;
    readonly y1End: number;
    readonly x2Start: number;
    readonly x2End: number;
    readonly y2Start: number;
    readonly y2End: number;
  };
  readonly durations: DotFieldChannels;
  readonly phases: DotFieldChannels;
  readonly sizeRange: {
    readonly firstStart: number;
    readonly firstEnd: number;
    readonly secondStart: number;
    readonly secondEnd: number;
  };
}

export interface GeneratedImageDotFieldFrame {
  readonly firstSize: number;
  readonly firstX: number;
  readonly firstY: number;
  readonly secondSize: number;
  readonly secondX: number;
  readonly secondY: number;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function generatedImageDotFieldSmoothStep(value: number): number {
  const clamped = clampUnit(value);
  return clamped * clamped * (3 - 2 * clamped);
}

function cubicEaseInOut(value: number): number {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - ((-2 * value + 2) ** 3) / 2;
}

function triangleWave(value: number): number {
  const remainder = ((value % 1) + 1) % 1;
  return remainder <= 0.5 ? remainder * 2 : 2 - remainder * 2;
}

function interpolate(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

function randomBetween(start: number, end: number, random: () => number): number {
  return start + random() * (end - start);
}

export function createStableGeneratedImageRandom(seed: string): () => number {
  let state = 2_166_136_261;
  for (const character of seed) {
    state ^= character.codePointAt(0) ?? 0;
    state = Math.imul(state, 16_777_619);
  }
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function createGeneratedImageDotFieldConfig(
  random: () => number = Math.random,
): GeneratedImageDotFieldConfig {
  const randomDuration = (duration: number) => (
    duration * DOT_FIELD_DURATION_FACTOR * randomBetween(1, 1.35, random)
  );
  return {
    durations: {
      offsetX1: randomDuration(DOT_FIELD_DURATIONS.offsetX1),
      offsetY1: randomDuration(DOT_FIELD_DURATIONS.offsetY1),
      offsetX2: randomDuration(DOT_FIELD_DURATIONS.offsetX2),
      offsetY2: randomDuration(DOT_FIELD_DURATIONS.offsetY2),
      fieldSize1: randomDuration(DOT_FIELD_DURATIONS.fieldSize1),
      fieldSize2: randomDuration(DOT_FIELD_DURATIONS.fieldSize2),
    },
    phases: {
      offsetX1: random(),
      offsetY1: random(),
      offsetX2: random(),
      offsetY2: random(),
      fieldSize1: random(),
      fieldSize2: random(),
    },
    bounds: {
      x1Start: randomBetween(0.1, 0.32, random),
      x1End: randomBetween(0.68, 0.9, random),
      y1Start: randomBetween(0.1, 0.32, random),
      y1End: randomBetween(0.68, 0.9, random),
      x2Start: randomBetween(0.68, 0.9, random),
      x2End: randomBetween(0.1, 0.32, random),
      y2Start: randomBetween(0.68, 0.9, random),
      y2End: randomBetween(0.1, 0.32, random),
    },
    sizeRange: {
      firstStart: randomBetween(0.42, 0.52, random),
      firstEnd: randomBetween(0.62, 0.75, random),
      secondStart: randomBetween(0.5, 0.62, random),
      secondEnd: randomBetween(0.74, 0.9, random),
    },
  };
}

export function resolveGeneratedImageDotFieldFrame(
  elapsedMs: number,
  config: GeneratedImageDotFieldConfig,
): GeneratedImageDotFieldFrame {
  const elapsed = Math.max(0, elapsedMs);
  const phase = (duration: number, offset: number) => (
    triangleWave(elapsed / duration + offset)
  );
  return {
    firstX: interpolate(
      config.bounds.x1Start,
      config.bounds.x1End,
      cubicEaseInOut(phase(config.durations.offsetX1, config.phases.offsetX1)),
    ),
    firstY: interpolate(
      config.bounds.y1Start,
      config.bounds.y1End,
      generatedImageDotFieldSmoothStep(
        phase(config.durations.offsetY1, config.phases.offsetY1),
      ),
    ),
    secondX: interpolate(
      config.bounds.x2Start,
      config.bounds.x2End,
      cubicEaseInOut(phase(config.durations.offsetX2, config.phases.offsetX2)),
    ),
    secondY: interpolate(
      config.bounds.y2Start,
      config.bounds.y2End,
      generatedImageDotFieldSmoothStep(
        phase(config.durations.offsetY2, config.phases.offsetY2),
      ),
    ),
    firstSize: DOT_FIELD_SIZE_FACTOR * interpolate(
      config.sizeRange.firstStart,
      config.sizeRange.firstEnd,
      generatedImageDotFieldSmoothStep(
        phase(config.durations.fieldSize1, config.phases.fieldSize1),
      ),
    ),
    secondSize: DOT_FIELD_SIZE_FACTOR * interpolate(
      config.sizeRange.secondStart,
      config.sizeRange.secondEnd,
      generatedImageDotFieldSmoothStep(
        phase(config.durations.fieldSize2, config.phases.fieldSize2),
      ),
    ),
  };
}
