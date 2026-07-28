import { afterEach, describe, expect, test } from "vitest";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { render } from "../../../test/dom";
import {
  resolveRightPanelComposerPortalGeometry,
  RightPanelComposerOverlay,
} from "./right-panel-composer-overlay";

function makeTarget(): HTMLElement {
  const target = document.createElement("div");
  target.getBoundingClientRect = () => ({
    bottom: 630,
    height: 600,
    left: 20,
    right: 820,
    top: 30,
    width: 800,
    x: 20,
    y: 30,
    toJSON: () => ({}),
  });
  document.body.appendChild(target);
  return target;
}

describe("RightPanelComposerOverlay", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  test("resolves body-portal geometry in the pane coordinate space", () => {
    expect(resolveRightPanelComposerPortalGeometry({
      rect: { left: 120, top: 40, width: 900 },
      viewportHeight: 800,
      zoom: 1.5,
    })).toEqual({
      height: 760 / 1.5,
      left: 80,
      top: 40 / 1.5,
      width: 600,
      zoom: 1.5,
    });
  });

  test("anchors a non-modal portal to the pane and preserves full-width pane clearance", async () => {
    const target = makeTarget();
    render(
      <RightPanelComposerOverlay target={target}>
        <button type="button">Composer</button>
      </RightPanelComposerOverlay>,
    );

    const portalHost = await waitFor(() => {
      const host = document.body.querySelector(
        '[data-testid="right-panel-composer-overlay-host"]',
      ) as HTMLElement | null;
      if (!host) throw new Error("Expected a body-level overlay host");
      return host;
    });
    const overlay = portalHost.querySelector(
      '[data-testid="right-panel-composer-overlay"]',
    );
    expect(overlay !== null).toBe(true);
    expect(portalHost.style.left).toBe("20px");
    expect(portalHost.style.top).toBe("30px");
    expect(portalHost.style.width).toBe("800px");
    expect(target.style.getPropertyValue("--right-panel-composer-overlay-height")).toBe("102px");
    expect(target.style.getPropertyValue("--right-panel-composer-overlay-reserve")).toBe("118px");

    await waitFor(() => {
      expect(overlay?.getAttribute("aria-hidden")).toBe("false");
    });
  });

  test("resynchronizes pane zoom and bottom-panel offset from style owners", async () => {
    const target = makeTarget();
    target.style.setProperty("--codex-window-zoom", "1");
    target.style.setProperty("--app-shell-bottom-panel-height", "0px");
    render(
      <RightPanelComposerOverlay target={target}>
        <button type="button">Composer</button>
      </RightPanelComposerOverlay>,
    );

    const portalHost = await waitFor(() => {
      const host = document.body.querySelector(
        '[data-testid="right-panel-composer-overlay-host"]',
      ) as HTMLElement | null;
      if (!host) throw new Error("Expected a body-level overlay host");
      return host;
    });
    target.style.setProperty("--codex-window-zoom", "2");
    target.style.setProperty("--app-shell-bottom-panel-height", "80px");

    await waitFor(() => {
      expect(portalHost.style.left).toBe("10px");
      expect(portalHost.style.width).toBe("400px");
      const overlay = portalHost.querySelector<HTMLElement>(
        '[data-testid="right-panel-composer-overlay"]',
      );
      expect(
        overlay?.style.getPropertyValue(
          "--right-panel-composer-overlay-bottom-panel-height",
        ),
      ).toBe("80px");
    });
  });

  test("only treats pointer input outside the interactive composer as outside", async () => {
    const target = makeTarget();
    let outsidePointerDowns = 0;
    render(
      <RightPanelComposerOverlay
        target={target}
        onPointerDownOutside={() => {
          outsidePointerDowns += 1;
        }}
      >
        <button type="button">Composer</button>
      </RightPanelComposerOverlay>,
    );

    const composerButton = await waitFor(() => {
      const overlay = document.body.querySelector(
        '[data-testid="right-panel-composer-overlay"]',
      );
      if (overlay?.getAttribute("aria-hidden") !== "false") {
        throw new Error("Expected visible composer");
      }
      const button = document.body.querySelector(
        '[data-testid="right-panel-composer-overlay"] button',
      ) as HTMLButtonElement | null;
      if (!button) throw new Error("Expected composer button");
      return button;
    });
    await act(async () => {
      fireEvent.pointerDown(composerButton);
    });
    expect(outsidePointerDowns).toBe(0);

    const outsideButton = document.createElement("button");
    document.body.appendChild(outsideButton);
    await act(async () => {
      fireEvent.pointerDown(outsideButton);
    });
    expect(outsidePointerDowns).toBe(1);
  });

  test("offers explicit hide and restore controls for compact browser overlays", async () => {
    const target = makeTarget();
    render(
      <RightPanelComposerOverlay target={target} compact>
        <button type="button">Composer</button>
      </RightPanelComposerOverlay>,
    );

    const hideButton = await waitFor(() => {
      const button = document.body.querySelector(
        'button[aria-label="Hide floating composer"]',
      ) as HTMLButtonElement | null;
      if (!button) throw new Error("Expected hide control");
      return button;
    });
    expect(target.style.getPropertyValue("--right-panel-composer-overlay-reserve")).toBe("0px");
    await act(async () => {
      fireEvent.click(hideButton);
    });

    const showButton = document.body.querySelector(
      'button[aria-label="Show floating composer"]',
    ) as HTMLButtonElement | null;
    expect(showButton?.closest('[aria-hidden="false"]') !== null).toBe(true);

    if (!showButton) throw new Error("Expected show control");
    await act(async () => {
      fireEvent.click(showButton);
    });

    await waitFor(() => {
      const overlay = document.body.querySelector(
        '[data-testid="right-panel-composer-overlay"]',
      );
      expect(overlay?.getAttribute("aria-hidden")).toBe("false");
    });
  });

  test("auto-hides at Browser document bottom until explicitly restored", async () => {
    const target = makeTarget();
    const renderOverlay = (isAtDocumentBottom: boolean) => (
      <RightPanelComposerOverlay
        target={target}
        compact
        documentBottomKey="browser-one"
        isAtDocumentBottom={isAtDocumentBottom}
      >
        <button type="button">Composer</button>
      </RightPanelComposerOverlay>
    );
    const view = render(renderOverlay(false));

    view.rerender(renderOverlay(true));
    await waitFor(() => {
      const overlay = document.body.querySelector(
        '[data-testid="right-panel-composer-overlay"]',
      );
      expect(overlay?.getAttribute("aria-hidden")).toBe("true");
    });

    const hideButton = document.body.querySelector(
      'button[aria-label="Hide floating composer"]',
    );
    expect(hideButton?.getAttribute("inert")).not.toBe(null);
    const showButton = document.body.querySelector(
      'button[aria-label="Show floating composer"]',
    ) as HTMLButtonElement | null;
    if (!showButton) throw new Error("Expected show control");
    await act(async () => {
      fireEvent.click(showButton);
    });
    await waitFor(() => {
      const overlay = document.body.querySelector(
        '[data-testid="right-panel-composer-overlay"]',
      );
      expect(overlay?.getAttribute("aria-hidden")).toBe("false");
    });

    view.rerender(renderOverlay(false));
    view.rerender(renderOverlay(true));
    await waitFor(() => {
      const overlay = document.body.querySelector(
        '[data-testid="right-panel-composer-overlay"]',
      );
      expect(overlay?.getAttribute("aria-hidden")).toBe("true");
    });
  });

  test("does not auto-hide a focused non-empty draft at document bottom", async () => {
    const target = makeTarget();
    const renderOverlay = (isAtDocumentBottom: boolean) => (
      <RightPanelComposerOverlay
        target={target}
        compact
        documentBottomKey="browser-one"
        isAtDocumentBottom={isAtDocumentBottom}
      >
        <div
          contentEditable
          data-codex-composer="true"
          suppressContentEditableWarning
        >
          Keep typing
        </div>
      </RightPanelComposerOverlay>
    );
    const view = render(renderOverlay(false));
    const editor = await waitFor(() => {
      const element = document.body.querySelector(
        '[data-codex-composer="true"]',
      ) as HTMLElement | null;
      if (!element) throw new Error("Expected composer editor");
      return element;
    });
    editor.focus();

    view.rerender(renderOverlay(true));
    await waitFor(() => {
      const overlay = document.body.querySelector(
        '[data-testid="right-panel-composer-overlay"]',
      );
      expect(overlay?.getAttribute("aria-hidden")).toBe("false");
    });
  });

  test("removes pane contracts when the overlay owner unmounts", async () => {
    const target = makeTarget();
    const view = render(
      <RightPanelComposerOverlay target={target}>
        <button type="button">Composer</button>
      </RightPanelComposerOverlay>,
    );

    await waitFor(() => {
      expect(document.body.querySelector(
        '[data-testid="right-panel-composer-overlay-host"]',
      ) !== null).toBe(true);
    });

    view.unmount();

    await waitFor(() => {
      expect(document.body.querySelector(
        '[data-testid="right-panel-composer-overlay-host"]',
      ) === null).toBe(true);
    });
    expect(target.style.getPropertyValue("--right-panel-composer-overlay-height")).toBe("");
    expect(target.style.getPropertyValue("--right-panel-composer-overlay-reserve")).toBe("");
  });
});
