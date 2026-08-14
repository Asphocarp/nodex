import { animate, motionValue, type MotionValue } from "motion/react";
import { useCallback, useEffect, useRef, type PointerEvent } from "react";
import { useResolvedReducedMotion } from "@/lib/use-reduced-motion";
import {
  canMergeNodexMarkAxes,
  composeNodexMarkRotorPose,
  nodexMarkPoseDistanceDegrees,
  resolveNodexHomeMarkClickAxis,
  resolveNodexHomeMarkFieldMorph,
  type NodexMarkVec3,
} from "@/lib/nodex-home-mark-motion";
import type { NodexHomeMarkRenderer } from "./nodex-home-mark-renderer";

type RendererModule = typeof import("./nodex-home-mark-renderer");
type AnimationControls = ReturnType<typeof animate>;

interface ActiveRotor {
  axis: NodexMarkVec3;
  progress: MotionValue<number>;
  targetTurns: number;
  generation: number;
  controls: AnimationControls | null;
}

let rendererModulePromise: Promise<RendererModule> | null = null;

function preloadRenderer(): Promise<RendererModule> {
  rendererModulePromise ??= import("./nodex-home-mark-renderer");
  return rendererModulePromise;
}

function readElementColor(element: HTMLElement): readonly [number, number, number] {
  const channels = getComputedStyle(element).color.match(/[\d.]+/g)?.slice(0, 3);
  if (!channels || channels.length !== 3) return [223 / 255, 223 / 255, 223 / 255];
  return [
    Number(channels[0]) / 255,
    Number(channels[1]) / 255,
    Number(channels[2]) / 255,
  ];
}

export function NodexHomeMark() {
  const reducedMotion = useResolvedReducedMotion();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const visualRef = useRef<HTMLDivElement | null>(null);
  const staticMarkRef = useRef<SVGSVGElement | null>(null);
  const rendererRef = useRef<NodexHomeMarkRenderer | null>(null);
  const rendererCreationRef = useRef<Promise<NodexHomeMarkRenderer | null> | null>(null);
  const activeRotorsRef = useRef<ActiveRotor[]>([]);
  const scaleMotionRef = useRef(motionValue(1));
  const scaleControlsRef = useRef<AnimationControls | null>(null);
  const scaleGenerationRef = useRef(0);
  const lifecycleGenerationRef = useRef(0);
  const renderQueuedRef = useRef(false);
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;

  const showStaticMark = useCallback(() => {
    if (staticMarkRef.current) staticMarkRef.current.style.visibility = "visible";
  }, []);

  const renderNow = () => {
    renderQueuedRef.current = false;
    const visual = visualRef.current;
    if (!visual) return;
    const chargedScale = scaleMotionRef.current.get();
    visual.style.transform = `scale(${chargedScale})`;
    const renderer = rendererRef.current;
    const host = hostRef.current;
    if (!renderer || !host) return;
    const rotation = composeNodexMarkRotorPose(
      activeRotorsRef.current.map((rotor) => ({
        axis: rotor.axis,
        turns: rotor.progress.get(),
      })),
    );
    renderer.render({
      rotation,
      morph: resolveNodexHomeMarkFieldMorph(
        nodexMarkPoseDistanceDegrees(rotation),
      ),
      chargedScale,
      color: readElementColor(host),
    });
  };

  const scheduleRender = () => {
    if (renderQueuedRef.current) return;
    renderQueuedRef.current = true;
    queueMicrotask(renderNow);
  };

  const disposeRuntime = useCallback(() => {
    lifecycleGenerationRef.current += 1;
    scaleGenerationRef.current += 1;
    scaleControlsRef.current?.stop();
    scaleControlsRef.current = null;
    for (const rotor of activeRotorsRef.current) rotor.controls?.stop();
    activeRotorsRef.current = [];
    rendererCreationRef.current = null;
    rendererRef.current?.dispose();
    rendererRef.current = null;
    scaleMotionRef.current.set(1);
    if (visualRef.current) visualRef.current.style.transform = "";
    showStaticMark();
  }, [showStaticMark]);

  const ensureRenderer = async (): Promise<NodexHomeMarkRenderer | null> => {
    if (rendererRef.current) return rendererRef.current;
    if (rendererCreationRef.current) return rendererCreationRef.current;
    const generation = lifecycleGenerationRef.current;
    const creation = preloadRenderer()
      .then((module) => {
        if (
          generation !== lifecycleGenerationRef.current
          || reducedMotionRef.current
          || !visualRef.current
        ) {
          return null;
        }
        const renderer = module.createNodexHomeMarkRenderer({
          devicePixelRatio: globalThis.devicePixelRatio || 1,
          onContextLost: disposeRuntime,
        });
        if (!renderer) return null;
        rendererRef.current = renderer;
        renderNow();
        visualRef.current.append(renderer.canvas);
        if (staticMarkRef.current) staticMarkRef.current.style.visibility = "hidden";
        return renderer;
      })
      .catch(() => null)
      .finally(() => {
        if (rendererCreationRef.current === creation) {
          rendererCreationRef.current = null;
        }
      });
    rendererCreationRef.current = creation;
    return creation;
  };

  const springOptions = (onComplete?: () => void) => ({
    type: "spring" as const,
    duration: 0.56,
    bounce: 0.15,
    onUpdate: scheduleRender,
    onComplete,
  });

  const releaseScale = () => {
    if (activeRotorsRef.current.length > 0) return;
    const generation = ++scaleGenerationRef.current;
    scaleControlsRef.current?.stop();
    scaleControlsRef.current = animate(
      scaleMotionRef.current,
      1,
      springOptions(() => {
        if (
          generation !== scaleGenerationRef.current
          || activeRotorsRef.current.length > 0
        ) {
          return;
        }
        showStaticMark();
        rendererRef.current?.dispose();
        rendererRef.current = null;
        scaleControlsRef.current = null;
        if (visualRef.current) visualRef.current.style.transform = "";
      }),
    );
  };

  const chargeScale = () => {
    scaleGenerationRef.current += 1;
    scaleControlsRef.current?.stop();
    scaleControlsRef.current = animate(
      scaleMotionRef.current,
      1.17,
      springOptions(),
    );
  };

  const animateRotor = (rotor: ActiveRotor) => {
    const generation = ++rotor.generation;
    rotor.controls?.stop();
    rotor.controls = animate(
      rotor.progress,
      rotor.targetTurns,
      springOptions(() => {
        if (generation !== rotor.generation) return;
        const index = activeRotorsRef.current.indexOf(rotor);
        if (index >= 0) activeRotorsRef.current.splice(index, 1);
        rotor.controls = null;
        scheduleRender();
        releaseScale();
      }),
    );
  };

  const play = (axis: NodexMarkVec3) => {
    const mergeCandidate = activeRotorsRef.current.at(-1);
    if (mergeCandidate && canMergeNodexMarkAxes(mergeCandidate.axis, axis)) {
      mergeCandidate.targetTurns += 1;
      animateRotor(mergeCandidate);
      return;
    }
    const rotor: ActiveRotor = {
      axis,
      progress: motionValue(0),
      targetTurns: 1,
      generation: 0,
      controls: null,
    };
    activeRotorsRef.current.push(rotor);
    animateRotor(rotor);
  };

  const handlePointerEnter = () => {
    if (reducedMotion) return;
    if (globalThis.matchMedia?.("(pointer: fine)").matches === false) return;
    void preloadRenderer();
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || reducedMotion) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const axis = resolveNodexHomeMarkClickAxis({
      clientX: event.clientX,
      clientY: event.clientY,
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
    });
    chargeScale();
    void ensureRenderer().then((renderer) => {
      if (!renderer || reducedMotionRef.current) {
        releaseScale();
        return;
      }
      play(axis);
      scheduleRender();
    });
  };

  useEffect(() => {
    if (reducedMotion) disposeRuntime();
  }, [disposeRuntime, reducedMotion]);

  useEffect(() => disposeRuntime, [disposeRuntime]);

  return (
    <div
      ref={hostRef}
      className="relative size-14 shrink-0 cursor-pointer touch-manipulation overflow-visible text-token-foreground opacity-30 transition-opacity duration-150 ease-[cubic-bezier(.23,1,.32,1)] select-none hover:opacity-40 motion-reduce:cursor-default motion-reduce:transition-none"
      aria-hidden="true"
      data-nodex-home-mark="true"
      onPointerEnter={handlePointerEnter}
      onPointerUp={handlePointerUp}
    >
      <div
        ref={visualRef}
        className="relative size-14 origin-center"
      >
        <svg
          ref={staticMarkRef}
          viewBox="0 0 800 800"
          className="size-14 overflow-visible"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <g transform="translate(400 400) scale(1.17) translate(-400 -400)">
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M516.873 75.5087392L118.087 100.056361C94.1999 101.687361 75.6836 122.231 75.6836 145.374V533.247C75.6836 554.992 83.1691 576.12 96.9608 593.302L182.945 700.417C196.847 717.735 218.725 727.272 241.359 725.88L683.965 698.635C706.65 697.237 724.31 679.047 724.31 657.08V216.106C724.31 202.514 717.448 192.0449767454 705.923 184.2539767454L565.813 84.9898232546C551.533 75.3358232546 534.255 74.3219392 516.873 75.5087392ZM137.862 152.3110570608C132.315 148.2040570608 134.955 136.8422343 141.923 136.3432343L519.555 113.0977657C531.588 112.2347657 543.543 113.628 553.273 120.522L629.043 174.203C631.918 176.241 630.57 179.2065641 627.008 179.4005641L227.097 204.0174359C214.994 204.6754359 203.048 198.7999429392 193.425 191.6759429392ZM208.339 270.767C208.339 257.775 218.835 247.044 232.257 246.313L655.075 223.286C668.158 222.574 679.168 232.633 679.168 245.295V627.132C679.168 640.1 668.71 650.82 655.315 651.582L235.172 675.487C220.615 676.317 208.339 665.13 208.339 651.037V270.767Z"
              fill="currentColor"
            />
            <path
              d="M305 352L411 438.203L305 535"
              stroke="currentColor"
              strokeWidth="50"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M458.035 565.638L579.966 558.361"
              stroke="currentColor"
              strokeWidth="50"
              strokeLinecap="round"
            />
          </g>
        </svg>
      </div>
    </div>
  );
}
