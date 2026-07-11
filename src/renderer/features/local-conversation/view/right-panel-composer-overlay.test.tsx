import { afterEach, describe, expect, test } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { APP_SHELL_RIGHT_PANEL_COMPOSER_OVERLAY_LAYER_CLASS } from "@/lib/app-shell-layers";
import { render } from "../../../test/dom";
import { RightPanelComposerOverlay } from "./right-panel-composer-overlay";

function makeTarget(): HTMLElement {
  const target = document.createElement("div");
  document.body.appendChild(target);
  return target;
}

describe("RightPanelComposerOverlay", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("renders into the portal target and enters on animation end", async () => {
    const target = makeTarget();
    render(
      <RightPanelComposerOverlay target={target} visible={true}>
        <button type="button">Composer</button>
      </RightPanelComposerOverlay>,
    );

    await waitFor(() => {
      const root = target.querySelector('[data-testid="right-panel-composer-overlay"]');
      if (!root) throw new Error("Expected overlay root");
      expect(root.getAttribute("aria-hidden")).toBe("true");
    });

    const root = target.querySelector('[data-testid="right-panel-composer-overlay"]') as HTMLElement;
    expect(root.className.includes("pointer-events-none")).toBe(true);
    expect(root.className.includes(APP_SHELL_RIGHT_PANEL_COMPOSER_OVERLAY_LAYER_CLASS)).toBe(true);
    expect(root.style.transform).toBe(
      "translateY(calc(118px - var(--right-panel-composer-overlay-reserve, 0px)))",
    );
    expect(target.style.getPropertyValue("--right-panel-composer-overlay-height")).toBe("102px");

    fireEvent.animationEnd(root);

    await waitFor(() => {
      expect(root.getAttribute("aria-hidden")).toBe("false");
    });
    expect(root.querySelector(".pointer-events-auto") !== null).toBe(true);
  });

  test("guards outside pointer events with the interactive composer subtree", async () => {
    const target = makeTarget();
    let outsidePointerDowns = 0;
    render(
      <RightPanelComposerOverlay
        target={target}
        visible={true}
        onPointerDownOutside={() => {
          outsidePointerDowns += 1;
        }}
      >
        <button type="button">Composer</button>
      </RightPanelComposerOverlay>,
    );

    const root = target.querySelector('[data-testid="right-panel-composer-overlay"]') as HTMLElement;
    fireEvent.animationEnd(root);

    await waitFor(() => {
      expect(root.getAttribute("aria-hidden")).toBe("false");
    });

    const composerButton = target.querySelector("button") as HTMLButtonElement;
    fireEvent.pointerDown(composerButton);
    expect(outsidePointerDowns).toBe(0);

    const outsideButton = document.createElement("button");
    document.body.appendChild(outsideButton);
    fireEvent.pointerDown(outsideButton);
    expect(outsidePointerDowns).toBe(1);
  });

  test("exits on opacity transition end and removes host CSS variables", async () => {
    const target = makeTarget();
    const view = render(
      <RightPanelComposerOverlay target={target} visible={true}>
        <button type="button">Composer</button>
      </RightPanelComposerOverlay>,
    );

    const root = target.querySelector('[data-testid="right-panel-composer-overlay"]') as HTMLElement;
    fireEvent.animationEnd(root);

    await waitFor(() => {
      expect(root.getAttribute("aria-hidden")).toBe("false");
    });

    view.rerender(
      <RightPanelComposerOverlay target={target} visible={false}>
        <button type="button">Composer</button>
      </RightPanelComposerOverlay>,
    );

    await waitFor(() => {
      expect(root.getAttribute("aria-hidden")).toBe("true");
    });

    fireEvent.transitionEnd(root, { propertyName: "opacity" });

    await waitFor(() => {
      expect(target.querySelector('[data-testid="right-panel-composer-overlay"]') === null).toBe(true);
    });
    expect(target.style.getPropertyValue("--right-panel-composer-overlay-height")).toBe("");
    expect(target.style.getPropertyValue("--right-panel-composer-overlay-reserve")).toBe("");
  });
});
