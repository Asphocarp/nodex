import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { APP_SHELL_FLOATING_UI_LAYER_INDEX } from "@/lib/app-shell-layers";

const NodexFloatingLayerContext = createContext<number | null>(null);

function parseLayerIndex(value: CSSProperties["zIndex"]): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !/^-?\d+$/.test(value)) return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Records the current floating owner's layer in the React tree. React context
 * crosses portals, allowing a body-portalled descendant to stack above its
 * logical owner without changing the portal container or leaking layer values
 * into every feature call site.
 */
export function NodexFloatingLayerProvider({
  children,
  zIndex,
}: {
  children: ReactNode;
  zIndex: number;
}) {
  return <NodexFloatingLayerContext value={zIndex}>{children}</NodexFloatingLayerContext>;
}

/** Resolves the layer for a shared floating surface and its descendants. */
export function useNodexFloatingLayerIndex(
  explicitZIndex?: CSSProperties["zIndex"],
  minimumLayerIndex = APP_SHELL_FLOATING_UI_LAYER_INDEX,
): number {
  const ownerZIndex = useContext(NodexFloatingLayerContext);
  const explicitLayerIndex = parseLayerIndex(explicitZIndex);
  if (explicitLayerIndex !== null) return explicitLayerIndex;

  if (ownerZIndex === null) return minimumLayerIndex;
  return Math.max(minimumLayerIndex, ownerZIndex + 1);
}
