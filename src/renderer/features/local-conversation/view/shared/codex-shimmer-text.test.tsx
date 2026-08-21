import { describe, expect, test } from "vite-plus/test";
import { render, textContent } from "../../../../test/dom";
import {
  CODEX_SHIMMER_CADENCE_MS,
  CODEX_SHIMMER_VARIANT,
  CodexShimmerProvider,
  CodexShimmerText,
} from "./codex-shimmer-text";

describe("CodexShimmerText", () => {
  test("renders a plain span when inactive", () => {
    const { container } = render(<CodexShimmerText active={false}>Static</CodexShimmerText>);

    expect(textContent(container)).toBe("Static");
    expect(
      container.querySelector("[data-codex-shimmer]")?.getAttribute("data-codex-shimmer"),
    ).toBe("static");
  });

  test("uses the Codex cadenced shimmer DOM when active", () => {
    const { container } = render(<CodexShimmerText>Loading</CodexShimmerText>);

    expect(
      container.querySelector("[data-codex-shimmer='cadenced']")?.firstChild?.textContent ?? "",
    ).toBe("Loading");
    expect(Boolean(container.querySelector("[data-codex-shimmer-sweep='true']"))).toBe(true);
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

    expect(
      container.querySelector("[data-codex-shimmer]")?.getAttribute("data-codex-shimmer"),
    ).toBe("cadenced");
    expect(Boolean(container.querySelector("[data-codex-shimmer-sweep='true']"))).toBe(true);
  });

  test("suppresses nested shimmer without changing its text", () => {
    const { container } = render(
      <CodexShimmerProvider enabled={false}>
        <CodexShimmerText>Nested activity</CodexShimmerText>
      </CodexShimmerProvider>,
    );

    expect(textContent(container)).toBe("Nested activity");
    expect(
      container.querySelector("[data-codex-shimmer]")?.getAttribute("data-codex-shimmer"),
    ).toBe("static");
    expect(container.querySelector("[data-codex-shimmer-sweep]")).toBe(null);
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
      expect(Boolean(view.container.querySelector("[data-codex-shimmer-sweep='true']"))).toBe(true);
      expect(timeoutCount).toBe(0);
      view.unmount();
    } finally {
      window.matchMedia = originalMatchMedia;
      window.setTimeout = originalSetTimeout;
    }
  });
});
