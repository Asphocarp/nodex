import { describe, expect, test } from "vitest";
import { render, textContent } from "../../../../test/dom";
import {
  CODEX_SHIMMER_CADENCE_MS,
  CODEX_SHIMMER_VARIANT,
  CodexShimmerText,
} from "./codex-shimmer-text";

describe("CodexShimmerText", () => {
  test("renders a plain span when inactive", () => {
    const { container } = render(<CodexShimmerText active={false}>Static</CodexShimmerText>);

    expect(textContent(container)).toBe("Static");
    expect(Boolean(container.querySelector(".loading-shimmer-pure-text"))).toBe(false);
  });

  test("uses the Codex cadenced shimmer DOM when active", () => {
    const { container } = render(<CodexShimmerText>Loading</CodexShimmerText>);

    expect(container.querySelector(".loading-shimmer-pure-text")?.firstChild?.textContent ?? "").toBe("Loading");
    expect(Boolean(container.querySelector(".loading-shimmer-pure-text"))).toBe(true);
    expect(Boolean(container.querySelector(".codex-cadenced-shimmer-sweep"))).toBe(true);
  });

  test("keeps cadenced shimmer as the exact default variant", () => {
    expect(CODEX_SHIMMER_VARIANT).toBe("cadenced");
  });

  test("exposes Codex cadenced shimmer timing constants", () => {
    expect(CODEX_SHIMMER_CADENCE_MS.initialDelay).toBe(600);
    expect(CODEX_SHIMMER_CADENCE_MS.activeDuration).toBe(1_000);
    expect(CODEX_SHIMMER_CADENCE_MS.interval).toBe(4_000);
  });

  test("renders the optional cadenced shimmer overlay", () => {
    const { container } = render(<CodexShimmerText variant="cadenced">Loading</CodexShimmerText>);

    expect(Boolean(container.querySelector(".codex-cadenced-shimmer"))).toBe(true);
    expect(Boolean(container.querySelector(".codex-cadenced-shimmer-sweep"))).toBe(true);
    expect(Boolean(container.querySelector(".codex-cadenced-shimmer-highlight"))).toBe(true);
  });

  test("keeps the cadenced overlay static when reduced motion is requested", () => {
    const originalMatchMedia = window.matchMedia;
    const originalSetTimeout = window.setTimeout;
    let timeoutCount = 0;
    window.matchMedia = (() => ({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    })) as typeof window.matchMedia;
    window.setTimeout = ((handler: TimerHandler, timeout?: number) => {
      timeoutCount += 1;
      return originalSetTimeout(handler, timeout);
    }) as typeof window.setTimeout;

    try {
      const view = render(<CodexShimmerText>Loading</CodexShimmerText>);
      expect(Boolean(view.container.querySelector(".codex-cadenced-shimmer-sweep"))).toBe(true);
      expect(timeoutCount).toBe(0);
      view.unmount();
    } finally {
      window.matchMedia = originalMatchMedia;
      window.setTimeout = originalSetTimeout;
    }
  });
});
