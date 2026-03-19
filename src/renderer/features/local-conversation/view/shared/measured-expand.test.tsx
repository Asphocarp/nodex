import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { render, settleAsyncRender } from "../../../../test/dom";
import { MeasuredExpand } from "./measured-expand";

const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

describe("MeasuredExpand", () => {
  beforeEach(() => {
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof globalThis.requestAnimationFrame;

    globalThis.cancelAnimationFrame = (() => {}) as typeof globalThis.cancelAnimationFrame;

    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      const element = this as HTMLElement;
      const className = typeof element.className === "string" ? element.className : "";
      if (className.includes("measured-expand-inner")) {
        return {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          bottom: 120,
          right: 200,
          width: 200,
          height: 120,
          toJSON() {
            return {};
          },
        };
      }

      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        bottom: 0,
        right: 200,
        width: 200,
        height: 0,
        toJSON() {
          return {};
        },
      };
    };
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  test("settles to auto height after opening", async () => {
    const { container, rerender } = render(
      <MeasuredExpand open={false} className="measured-expand-outer" innerClassName="measured-expand-inner">
        <div>Body</div>
      </MeasuredExpand>,
    );

    rerender(
      <MeasuredExpand open className="measured-expand-outer" innerClassName="measured-expand-inner">
        <div>Body</div>
      </MeasuredExpand>,
    );
    await settleAsyncRender();

    const outer = container.firstElementChild as HTMLDivElement | null;
    expect(Boolean(outer)).toBeTrue();
    if (!outer) return;

    expect(Boolean(outer.style.height === "120px" || outer.style.height === "auto")).toBeTrue();
    if (outer.style.height !== "auto") {
      fireEvent.transitionEnd(outer);
    }
    expect(outer.style.height).toBe("auto");
  });

  test("does not restart the animation on ordinary rerenders while open", async () => {
    const { container, rerender } = render(
      <MeasuredExpand open className="measured-expand-outer" innerClassName="measured-expand-inner">
        <div>Body A</div>
      </MeasuredExpand>,
    );
    await settleAsyncRender();

    const outer = container.firstElementChild as HTMLDivElement | null;
    expect(Boolean(outer)).toBeTrue();
    if (!outer) return;

    expect(outer.style.height).toBe("auto");

    rerender(
      <MeasuredExpand open className="measured-expand-outer" innerClassName="measured-expand-inner">
        <div>Body B</div>
      </MeasuredExpand>,
    );
    await settleAsyncRender();

    expect(outer.style.height).toBe("auto");
  });
});
