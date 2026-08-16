export interface NodexHomeMarkRendererRetirement {
  dispose(): void;
}

/**
 * Keeps a hidden canvas alive through the SVG ownership paint. Chromium may
 * still be compositing its previous drawing buffer during that handoff.
 */
export function retireNodexHomeMarkRendererAfterPaint(input: {
  cancelFrame?: (frame: number) => void;
  onDisposed?: () => void;
  renderer: NodexHomeMarkRendererRetirement;
  requestFrame?: (callback: FrameRequestCallback) => number;
}): () => void {
  const {
    cancelFrame = cancelAnimationFrame,
    renderer,
    requestFrame = requestAnimationFrame,
  } = input;
  let pending = true;
  const dispose = () => {
    try {
      renderer.dispose();
    } finally {
      input.onDisposed?.();
    }
  };
  const frame = requestFrame(() => {
    if (!pending) return;
    pending = false;
    dispose();
  });

  return () => {
    if (!pending) return;
    pending = false;
    cancelFrame(frame);
    dispose();
  };
}
