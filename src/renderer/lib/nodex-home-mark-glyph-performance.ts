import {
  NODEX_HOME_MARK_GLYPH_SCENES,
  type NodexHomeMarkGlyphScene,
  type NodexHomeMarkGlyphSceneId,
} from "@/components/ui/nodex-home-mark-glyph-scenes.generated";

export const NODEX_HOME_MARK_CUE_FPS = 60;
export const NODEX_HOME_MARK_HELLO_DURATION_FRAMES = 373;
export const NODEX_HOME_MARK_LOADER_DURATION_FRAMES = 721;
export const NODEX_HOME_MARK_LOADER_HOLD_FRAMES = 20;

export type NodexHomeMarkCueId = "hello" | "loader";

export interface NodexHomeMarkCueFrame {
  readonly complete: boolean;
  readonly frame: number;
  readonly nextChangeMs: number;
  readonly sceneId: NodexHomeMarkGlyphSceneId;
}

interface HelloBoundary {
  readonly atFrame: number;
  readonly sceneId: NodexHomeMarkGlyphSceneId;
}

export const NODEX_HOME_MARK_HELLO_BOUNDARIES = [
  { atFrame: 0, sceneId: "prompt" },
  { atFrame: 20, sceneId: "prompt-no-cursor" },
  { atFrame: 40, sceneId: "prompt" },
  { atFrame: 60, sceneId: "prompt-no-cursor" },
  { atFrame: 80, sceneId: "face" },
  { atFrame: 89, sceneId: "wink" },
  { atFrame: 97, sceneId: "split" },
  { atFrame: 103, sceneId: "inverted" },
  { atFrame: 109, sceneId: "bar-caret" },
  { atFrame: 115, sceneId: "bars" },
  { atFrame: 121, sceneId: "prompt" },
  { atFrame: 141, sceneId: "prompt-no-cursor" },
  { atFrame: 161, sceneId: "prompt" },
  { atFrame: 181, sceneId: "prompt-no-cursor" },
  { atFrame: 201, sceneId: "prompt" },
  { atFrame: 221, sceneId: "prompt-no-cursor" },
  { atFrame: 241, sceneId: "prompt" },
  { atFrame: 251, sceneId: "offset-caret" },
  { atFrame: 260, sceneId: "wink" },
  { atFrame: 268, sceneId: "double-bars" },
  { atFrame: 274, sceneId: "chevron-equals" },
  { atFrame: 280, sceneId: "code" },
  { atFrame: 286, sceneId: "bar-caret" },
  { atFrame: 292, sceneId: "prompt" },
  { atFrame: 312, sceneId: "prompt-no-cursor" },
  { atFrame: 332, sceneId: "prompt" },
  { atFrame: 352, sceneId: "prompt-no-cursor" },
  { atFrame: 372, sceneId: "prompt" },
] as const satisfies readonly HelloBoundary[];

function elapsedFrame(elapsedMs: number): number {
  const frame = Math.max(0, elapsedMs) * NODEX_HOME_MARK_CUE_FPS / 1_000;
  const nearestFrame = Math.round(frame);
  return Math.abs(frame - nearestFrame) < 0.000001 ? nearestFrame : frame;
}

export function resolveNodexHomeMarkHelloFrame(
  elapsedMs: number,
): NodexHomeMarkCueFrame {
  const frame = elapsedFrame(elapsedMs);
  if (frame >= NODEX_HOME_MARK_HELLO_DURATION_FRAMES) {
    return {
      complete: true,
      frame: NODEX_HOME_MARK_HELLO_DURATION_FRAMES,
      nextChangeMs: 0,
      sceneId: "prompt",
    };
  }
  let boundary: HelloBoundary = NODEX_HOME_MARK_HELLO_BOUNDARIES[0];
  let nextFrame = NODEX_HOME_MARK_HELLO_DURATION_FRAMES;
  for (let index = NODEX_HOME_MARK_HELLO_BOUNDARIES.length - 1; index >= 0; index -= 1) {
    const candidate = NODEX_HOME_MARK_HELLO_BOUNDARIES[index];
    if (frame < candidate.atFrame) continue;
    boundary = candidate;
    nextFrame = NODEX_HOME_MARK_HELLO_BOUNDARIES[index + 1]?.atFrame
      ?? NODEX_HOME_MARK_HELLO_DURATION_FRAMES;
    break;
  }
  return {
    complete: false,
    frame,
    nextChangeMs: Math.max(8, (nextFrame - frame) / NODEX_HOME_MARK_CUE_FPS * 1_000),
    sceneId: boundary.sceneId,
  };
}

export function resolveNodexHomeMarkLoaderFrame(
  elapsedMs: number,
): NodexHomeMarkCueFrame {
  const frame = elapsedFrame(elapsedMs);
  if (frame >= NODEX_HOME_MARK_LOADER_DURATION_FRAMES) {
    return {
      complete: true,
      frame: NODEX_HOME_MARK_LOADER_DURATION_FRAMES,
      nextChangeMs: 0,
      sceneId: "prompt",
    };
  }
  const hold = Math.floor(frame / NODEX_HOME_MARK_LOADER_HOLD_FRAMES);
  const nextFrame = Math.min(
    (hold + 1) * NODEX_HOME_MARK_LOADER_HOLD_FRAMES,
    NODEX_HOME_MARK_LOADER_DURATION_FRAMES,
  );
  return {
    complete: false,
    frame,
    nextChangeMs: Math.max(8, (nextFrame - frame) / NODEX_HOME_MARK_CUE_FPS * 1_000),
    sceneId: hold % 2 === 0 ? "prompt" : "prompt-no-cursor",
  };
}

export function resolveNodexHomeMarkCueFrame(
  cueId: NodexHomeMarkCueId,
  elapsedMs: number,
): NodexHomeMarkCueFrame {
  return cueId === "hello"
    ? resolveNodexHomeMarkHelloFrame(elapsedMs)
    : resolveNodexHomeMarkLoaderFrame(elapsedMs);
}

export function getNodexHomeMarkGlyphScene(
  sceneId: NodexHomeMarkGlyphSceneId,
): NodexHomeMarkGlyphScene {
  return NODEX_HOME_MARK_GLYPH_SCENES[sceneId];
}

export interface NodexHomeMarkGlyphPerformance {
  getScene(): NodexHomeMarkGlyphScene;
  getSceneId(): NodexHomeMarkGlyphSceneId;
  startRandom(): void;
  dispose(): void;
}

/** Runs only at authored cue boundaries; idle and in-between frames do no work. */
export function createNodexHomeMarkGlyphPerformance(input: {
  onScene: (
    sceneId: NodexHomeMarkGlyphSceneId,
    scene: NodexHomeMarkGlyphScene,
  ) => void;
  random?: () => number;
  now?: () => number;
}): NodexHomeMarkGlyphPerformance {
  const random = input.random ?? Math.random;
  const now = input.now ?? performance.now.bind(performance);
  let activeCue: { id: NodexHomeMarkCueId; startedAt: number } | null = null;
  let sceneId: NodexHomeMarkGlyphSceneId = "prompt";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const setScene = (nextSceneId: NodexHomeMarkGlyphSceneId) => {
    if (sceneId === nextSceneId) return;
    sceneId = nextSceneId;
    input.onScene(sceneId, NODEX_HOME_MARK_GLYPH_SCENES[sceneId]);
  };

  const tick = () => {
    timer = null;
    if (!activeCue || disposed) return;
    const frame = resolveNodexHomeMarkCueFrame(
      activeCue.id,
      now() - activeCue.startedAt,
    );
    setScene(frame.sceneId);
    if (frame.complete) {
      activeCue = null;
      return;
    }
    timer = setTimeout(tick, frame.nextChangeMs);
  };

  return {
    getScene: () => NODEX_HOME_MARK_GLYPH_SCENES[sceneId],
    getSceneId: () => sceneId,
    startRandom: () => {
      if (disposed || activeCue) return;
      activeCue = { id: random() < 0.5 ? "hello" : "loader", startedAt: now() };
      tick();
    },
    dispose: () => {
      disposed = true;
      activeCue = null;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
