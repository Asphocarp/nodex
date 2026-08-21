import { describe, expect, test } from "vite-plus/test";
import { AnimatedDiffStats, DiffStats } from "./diff-file-shared";
import { render, textContent } from "../../../../../test/dom";

function digitPlaces(container: HTMLElement): string {
  const additions = container.querySelector<HTMLElement>("[data-diff-stat-kind='additions']");
  if (!additions) return "";
  return Array.from(additions.querySelectorAll<HTMLElement>("[data-diff-stat-digit-place]"))
    .map(
      (element) =>
        `${element.getAttribute("data-diff-stat-digit-place") ?? ""}:${element.querySelector(".diff-stat-digit-stack")?.className ?? ""}`,
    )
    .join("|");
}

describe("AnimatedDiffStats", () => {
  test("keeps place-value columns stable when rolling from 9 to 10", () => {
    const { container, rerender } = render(<AnimatedDiffStats additions={9} deletions={0} />);
    expect(digitPlaces(container)).toBe("0:diff-stat-digit-stack diff-stat-digit-stack-9");

    rerender(<AnimatedDiffStats additions={10} deletions={0} />);

    expect(digitPlaces(container)).toBe(
      "1:diff-stat-digit-stack diff-stat-digit-stack-1|0:diff-stat-digit-stack diff-stat-digit-stack-0",
    );
  });
});

describe("DiffStats", () => {
  test("can render explicit zero stats when diff metadata exists", () => {
    const hidden = render(<DiffStats additions={0} deletions={0} />);
    expect(textContent(hidden.container)).toBe("");

    const visible = render(<DiffStats additions={0} deletions={0} showZero />);
    expect(textContent(visible.container)).toBe("+0-0");
  });
});
