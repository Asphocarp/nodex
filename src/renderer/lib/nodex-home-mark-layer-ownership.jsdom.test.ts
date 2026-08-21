import { describe, expect, test } from "vite-plus/test";
import { setNodexHomeMarkLayerOwner } from "./nodex-home-mark-layer-ownership";

describe("Nodex home mark layer ownership", () => {
  test("removes the complete SVG while canvas owns presentation", () => {
    const staticMark = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const glyph = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const canvas = document.createElement("canvas");
    staticMark.style.visibility = "hidden";
    glyph.style.visibility = "visible";
    staticMark.append(glyph);

    setNodexHomeMarkLayerOwner({ canvas, owner: "canvas", staticMark });

    expect(staticMark.style.display).toBe("none");
    expect(canvas.style.visibility).toBe("visible");

    setNodexHomeMarkLayerOwner({ canvas, owner: "svg", staticMark });

    expect(canvas.style.visibility).toBe("hidden");
    expect(staticMark.style.display).toBe("");
    expect(staticMark.style.visibility).toBe("");
    expect(glyph.style.visibility).toBe("visible");
  });
});
