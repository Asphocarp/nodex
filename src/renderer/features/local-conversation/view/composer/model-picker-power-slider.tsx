import { useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";
import { cn } from "@/lib/utils";
import type { ComposerPowerChoice } from "./composer-intelligence-power-policy";

const DRAG_ACTIVATION_DISTANCE_PX = 4;

function resolveIndexAtClientX(
  clientX: number,
  rect: Pick<DOMRect, "left" | "width">,
  count: number,
): number {
  if (count <= 1 || rect.width <= 0) return 0;
  const progress = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return Math.round(progress * (count - 1));
}

export interface ModelPickerPowerSliderProps {
  readonly choices: readonly ComposerPowerChoice[];
  readonly selectedIndex: number;
  readonly disabled?: boolean;
  readonly onSelect: (index: number) => void;
}

export function ModelPickerPowerSlider({
  choices,
  selectedIndex,
  disabled = false,
  onSelect,
}: ModelPickerPowerSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const pointerStartRef = useRef<{ pointerId: number; clientX: number } | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const boundedSelectedIndex = choices[selectedIndex] ? selectedIndex : 0;
  const selected = choices[boundedSelectedIndex];
  if (!selected) return null;

  const selectIndex = (index: number) => {
    if (disabled) return;
    const bounded = Math.min(choices.length - 1, Math.max(0, index));
    onSelect(bounded);
  };
  const resolvePointerIndex = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return boundedSelectedIndex;
    return resolveIndexAtClientX(clientX, rect, choices.length);
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const index = resolvePointerIndex(event.clientX);
    setHoveredIndex(index);
    const start = pointerStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientX - start.clientX) < DRAG_ACTIVATION_DISTANCE_PX) return;
    selectIndex(index);
  };
  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    pointerStartRef.current = null;
    selectIndex(resolvePointerIndex(event.clientX));
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (disabled || event.deltaY === 0) return;
    event.preventDefault();
    selectIndex(boundedSelectedIndex + (event.deltaY > 0 ? -1 : 1));
  };
  const activeIndex = hoveredIndex ?? boundedSelectedIndex;

  return (
    <div className="flex flex-col gap-2 px-2 pt-2 pb-1.5">
      <div
        ref={trackRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Power"
        aria-valuemin={0}
        aria-valuemax={choices.length - 1}
        aria-valuenow={boundedSelectedIndex}
        aria-valuetext={`${selected.modelLabel} ${selected.reasoningLabel}`}
        aria-disabled={disabled || undefined}
        className="relative h-8 touch-none outline-none focus-visible:ring-1 focus-visible:ring-token-foreground/45"
        onPointerDown={(event) => {
          if (disabled) return;
          pointerStartRef.current = { pointerId: event.pointerId, clientX: event.clientX };
          try {
            event.currentTarget.setPointerCapture?.(event.pointerId);
          } catch {
            // Synthetic and older browser pointer streams may not expose an active capture target.
          }
          setHoveredIndex(resolvePointerIndex(event.clientX));
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={() => {
          pointerStartRef.current = null;
          setHoveredIndex(null);
        }}
        onPointerLeave={() => {
          if (!pointerStartRef.current) setHoveredIndex(null);
        }}
        onWheel={handleWheel}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            selectIndex(boundedSelectedIndex - 1);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            selectIndex(boundedSelectedIndex + 1);
          } else if (event.key === "Home") {
            event.preventDefault();
            selectIndex(0);
          } else if (event.key === "End") {
            event.preventDefault();
            selectIndex(choices.length - 1);
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            selectIndex(activeIndex);
          }
        }}
      >
        <div className="absolute inset-x-1 top-1/2 h-px -translate-y-1/2 bg-token-foreground/15" />
        <div
          aria-hidden="true"
          className="absolute top-1/2 h-px -translate-y-1/2 bg-token-foreground/60"
          style={{
            left: "4px",
            width: `calc((100% - 8px) * ${boundedSelectedIndex / Math.max(1, choices.length - 1)})`,
          }}
        />
        {choices.map((choice, index) => {
          const progress = choices.length <= 1 ? 0 : index / (choices.length - 1);
          const active = index === boundedSelectedIndex;
          const hovered = index === hoveredIndex;
          return (
            <span
              key={choice.id}
              aria-hidden="true"
              className={cn(
                "absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-token-dropdown-background ring-1 ring-token-foreground/25",
                active && "size-4 bg-token-foreground ring-token-foreground",
                hovered && !active && "bg-token-foreground/40",
              )}
              style={{ left: `calc(4px + (100% - 8px) * ${progress})` }}
            />
          );
        })}
      </div>
      <div className="flex items-center justify-between text-xs text-token-description-foreground">
        <span>Faster</span>
        <span className="min-w-0 truncate px-2 text-center text-token-text-secondary">
          {choices[activeIndex]?.modelLabel} {choices[activeIndex]?.reasoningLabel}
        </span>
        <span>Smarter</span>
      </div>
      <span className="sr-only" aria-live="polite">
        {selected.modelLabel} {selected.reasoningLabel}
      </span>
    </div>
  );
}
