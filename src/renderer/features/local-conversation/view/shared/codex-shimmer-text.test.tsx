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

  test("uses the Codex classic shimmer class when active", () => {
    const { container } = render(<CodexShimmerText>Loading</CodexShimmerText>);

    expect(textContent(container)).toBe("Loading");
    expect(Boolean(container.querySelector(".loading-shimmer-pure-text"))).toBe(true);
  });

  test("keeps classic shimmer as the default variant", () => {
    expect(CODEX_SHIMMER_VARIANT).toBe("classic");
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
});
