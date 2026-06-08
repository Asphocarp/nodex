import { useState, useRef, useCallback, useEffect } from "react";
import { useTerminal } from "@/lib/use-terminal";
import { getPanelHeight, setPanelHeight as storePanelHeight } from "@/lib/terminal-sessions";
import { cn } from "@/lib/utils";

const TERMINAL_MIN_HEIGHT = 120;
const TERMINAL_MAX_HEIGHT = 600;

interface TerminalPanelProps {
  terminalId: string;
  cwd?: string | null;
  panelHeight?: number;
  onPanelHeightChange?: (height: number) => void;
}

function clampPanelHeight(height: number): number {
  if (!Number.isFinite(height)) return TERMINAL_MIN_HEIGHT;
  return Math.min(
    TERMINAL_MAX_HEIGHT,
    Math.max(TERMINAL_MIN_HEIGHT, Math.round(height)),
  );
}

function normalizeCwd(value: string | null | undefined): string | undefined {
  const trimmedValue = value?.trim();
  if (!trimmedValue) return undefined;
  return trimmedValue;
}

export function TerminalPanel({
  terminalId,
  cwd,
  panelHeight,
  onPanelHeightChange,
}: TerminalPanelProps) {
  const [uncontrolledPanelHeight, setUncontrolledPanelHeight] = useState(() =>
    getPanelHeight(terminalId),
  );
  const isResizingRef = useRef(false);
  const isControlledHeight = typeof panelHeight === "number";
  const resolvedPanelHeight = clampPanelHeight(
    isControlledHeight ? panelHeight : uncontrolledPanelHeight,
  );
  const setNextPanelHeight = useCallback(
    (nextHeight: number) => {
      const normalizedHeight = clampPanelHeight(nextHeight);
      if (!isControlledHeight) {
        setUncontrolledPanelHeight(normalizedHeight);
      }
      onPanelHeightChange?.(normalizedHeight);
    },
    [isControlledHeight, onPanelHeightChange],
  );

  const { containerRef, isUnavailable } =
    useTerminal({ terminalId, visible: true, cwd: normalizeCwd(cwd) });

  // ── Vertical resize handle ──────────────────────────────────────────
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizingRef.current = true;
      const startY = e.clientY;
      const startHeight = resolvedPanelHeight;

      const onMouseMove = (ev: MouseEvent) => {
        const delta = startY - ev.clientY; // dragging up = positive = taller
        setNextPanelHeight(startHeight + delta);
      };

      const onMouseUp = () => {
        isResizingRef.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [resolvedPanelHeight, setNextPanelHeight],
  );

  const handleResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      event.key !== "ArrowUp" &&
      event.key !== "ArrowDown" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Home") {
      setNextPanelHeight(TERMINAL_MIN_HEIGHT);
      return;
    }

    if (event.key === "End") {
      setNextPanelHeight(TERMINAL_MAX_HEIGHT);
      return;
    }

    const direction = event.key === "ArrowUp" ? 1 : -1;
    setNextPanelHeight(resolvedPanelHeight + direction * 24);
  }, [resolvedPanelHeight, setNextPanelHeight]);

  // Persist height per session when uncontrolled.
  useEffect(() => {
    if (isControlledHeight) return;
    storePanelHeight(terminalId, resolvedPanelHeight);
  }, [isControlledHeight, resolvedPanelHeight, terminalId]);

  return (
    <div
      className="flex shrink-0 flex-col"
      style={{ height: resolvedPanelHeight }}
    >
      {/* Resize handle */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal panel height"
        aria-valuemin={TERMINAL_MIN_HEIGHT}
        aria-valuemax={TERMINAL_MAX_HEIGHT}
        aria-valuenow={resolvedPanelHeight}
        tabIndex={0}
        onMouseDown={handleResizeStart}
        onKeyDown={handleResizeKeyDown}
        className={cn(
          "h-0.75 shrink-0 cursor-row-resize outline-none",
          "transition-colors duration-150 hover:bg-(--accent-blue)",
          "active:bg-(--accent-blue)",
          "focus-visible:bg-(--accent-blue) focus-visible:ring-2 focus-visible:ring-(--ring)",
        )}
      />

      {/* Terminal container */}
      {isUnavailable ? (
        <div className="flex flex-1 items-center justify-center text-sm text-(--foreground-tertiary)">
          Terminal requires the Electron desktop app
        </div>
      ) : (
        <div
          ref={containerRef}
          className="nodex-terminal min-h-0 flex-1"
        />
      )}
    </div>
  );
}
