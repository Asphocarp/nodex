import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import "@/globals.css";
import "@blocknote/shadcn/style.css";

import {
  CanvasIcon,
  DatabaseIcon,
  PageIcon,
} from "@/components/shared/icons";
import { LayoutTemplate } from "@/components/shared/icons/generic-icons";
import { CanvasBlockFrame } from "@/components/kanban/editor/canvas-block";
import { NodexButton } from "@/components/ui/button";
import { Button as BlockNoteButton } from "../../../third_party/blocknote/packages/shadcn/src/components/ui/button";

function expectSquareSize(element: SVGSVGElement, size: number): void {
  const bounds = element.getBoundingClientRect();
  expect(bounds.width).toBe(size);
  expect(bounds.height).toBe(size);
}

describe("icon sizing boundaries in Chromium", () => {
  test("keeps Nodex sizes across the BlockNote editor boundary", () => {
    const view = render(
      <div className="bn-shadcn" style={{ width: 640 }}>
        <span data-testid="canvas-icon"><CanvasIcon className="icon-2xs" /></span>
        <span data-testid="database-icon"><DatabaseIcon className="icon-2xs" /></span>
        <span data-testid="page-icon"><PageIcon className="icon-2xs" /></span>
        <span data-testid="generic-icon"><LayoutTemplate className="icon-2xs" /></span>
      </div>,
    );

    for (const testId of [
      "canvas-icon",
      "database-icon",
      "page-icon",
      "generic-icon",
    ]) {
      const icon = view.getByTestId(testId).querySelector("svg");
      if (!icon) {
        throw new TypeError(`Expected ${testId} to contain an SVG`);
      }
      expectSquareSize(icon, 14);
    }
  });

  test("does not let shared button defaults replace an explicit icon size", () => {
    const view = render(
      <div className="bn-shadcn" style={{ width: 640 }}>
        <BlockNoteButton data-testid="blocknote-button">
          <CanvasIcon className="icon-2xs" />
        </BlockNoteButton>
        <NodexButton data-testid="nodex-button" size="xs">
          <CanvasIcon className="icon-2xs" />
        </NodexButton>
      </div>,
    );

    const blockNoteIcon = view.getByTestId("blocknote-button").querySelector("svg");
    const nodexIcon = view.getByTestId("nodex-button").querySelector("svg");
    if (!blockNoteIcon || !nodexIcon) {
      throw new TypeError("Expected both buttons to render an SVG icon");
    }

    expectSquareSize(blockNoteIcon, 14);
    expectSquareSize(nodexIcon, 14);
  });

  test("keeps the embedded Canvas header compact inside a Page editor", () => {
    const view = render(
      <div className="bn-shadcn" style={{ width: 640 }}>
        <CanvasBlockFrame
          canvasBlockId="browser-canvas"
          title="Research Canvas"
          active={false}
          expanded={false}
        >
          <div />
        </CanvasBlockFrame>
      </div>,
    );
    const frame = view.container.querySelector<HTMLElement>("[data-canvas-block]");
    const icon = frame?.querySelector("svg");
    const header = icon?.parentElement;
    if (!icon || !header) {
      throw new TypeError("Expected the Canvas frame header and icon");
    }

    expectSquareSize(icon, 14);
    expect(header.getBoundingClientRect().height).toBeLessThan(64);
  });
});
