import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { render } from "../../test/dom";
import {
  BrowserTabFavicon,
  BrowserTabFaviconFrame,
} from "./browser-tab-favicon";

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: originalMatchMedia,
  });
});

describe("BrowserTabFavicon", () => {
  test("renders spinner-only, loading-favicon, and settled frames", () => {
    const view = render(
      <BrowserTabFaviconFrame
        faviconUrl="https://example.com/favicon.ico"
        phase="spinner-only"
      />,
    );

    expect(view.container.querySelector("[data-browser-tab-throbber='true']"))
      .not.toBeNull();
    expect(view.container.firstElementChild?.getAttribute(
      "data-browser-tab-icon-phase",
    )).toBe("spinner-only");

    view.rerender(
      <BrowserTabFaviconFrame
        faviconUrl="https://example.com/favicon.ico"
        phase="loading-favicon"
      />,
    );
    expect(view.container.querySelector("img")?.getAttribute("src"))
      .toBe("https://example.com/favicon.ico");

    view.rerender(
      <BrowserTabFaviconFrame
        faviconUrl="https://example.com/favicon.ico"
        phase="settled"
      />,
    );
    expect(view.container.querySelector("[data-browser-tab-throbber='true']"))
      .toBeNull();
  });

  test("falls back to the globe when a favicon fails", () => {
    const view = render(
      <BrowserTabFaviconFrame
        faviconUrl="https://example.com/broken.ico"
        phase="settled"
      />,
    );
    const image = view.container.querySelector("img");
    if (!image) throw new Error("Expected favicon image");

    fireEvent.error(image);

    expect(view.container.querySelector("img")).toBeNull();
    expect(view.container.querySelector("svg")).not.toBeNull();
  });

  test("retains the completed favicon until its clip transition finishes", () => {
    const view = render(
      <BrowserTabFavicon
        faviconUrl="https://example.com/favicon.ico"
        isLoading={false}
        isWaitingForResponse={false}
      />,
    );
    view.rerender(
      <BrowserTabFavicon
        faviconUrl="https://example.com/favicon.ico"
        isLoading
        isWaitingForResponse={false}
      />,
    );
    view.rerender(
      <BrowserTabFavicon
        faviconUrl={undefined}
        isLoading={false}
        isWaitingForResponse={false}
      />,
    );

    expect(view.container.querySelector("img")?.getAttribute("src"))
      .toBe("https://example.com/favicon.ico");
    const clip = view.container.querySelector<HTMLElement>(
      "[data-browser-tab-favicon-clip='true']",
    );
    if (!clip) throw new Error("Expected favicon clip frame");

    fireEvent.transitionEnd(clip, { propertyName: "clip-path" });

    expect(view.container.querySelector("img")).toBeNull();
  });

  test("disables every transition and loop under reduced motion", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({
        matches: true,
        media: "(prefers-reduced-motion: reduce)",
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => true,
      }),
    });

    const view = render(
      <BrowserTabFavicon
        faviconUrl="https://example.com/favicon.ico"
        isLoading
        isWaitingForResponse={false}
      />,
    );

    expect(view.container.firstElementChild?.classList.contains(
      "nodex-browser-tab-favicon-reduce-motion",
    )).toBe(true);
  });
});
