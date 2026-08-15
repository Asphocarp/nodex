export type NodexHomeMarkLayerOwner = "canvas" | "svg";

/**
 * Hands presentation between mutually exclusive layers without relying on
 * inherited visibility. Glyph paths toggle their own visibility, so only an
 * ancestor display boundary can guarantee that the static SVG is fully absent.
 */
export function setNodexHomeMarkLayerOwner(input: {
  canvas: HTMLCanvasElement | null;
  owner: NodexHomeMarkLayerOwner;
  staticMark: SVGSVGElement | null;
}): void {
  const { canvas, owner, staticMark } = input;
  if (owner === "canvas") {
    if (staticMark) {
      staticMark.style.display = "none";
      staticMark.style.visibility = "";
    }
    if (canvas) canvas.style.visibility = "visible";
    return;
  }
  if (canvas) canvas.style.visibility = "hidden";
  if (staticMark) {
    staticMark.style.display = "";
    staticMark.style.visibility = "";
  }
}
