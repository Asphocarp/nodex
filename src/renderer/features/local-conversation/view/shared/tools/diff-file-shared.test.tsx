import { describe, expect, test } from "bun:test";
import { AnimatedDiffStats } from "./diff-file-shared";
import { render } from "../../../../../test/dom";

function digitPlaces(container: HTMLElement): string {
  const additions = container.querySelector<HTMLElement>("[data-diff-stat-kind='additions']");
  if (!additions) return "";
  return Array.from(additions.querySelectorAll<HTMLElement>("[data-diff-stat-digit-place]"))
    .map((element) => `${element.getAttribute("data-diff-stat-digit-place") ?? ""}:${element.querySelector(".diff-stat-digit-stack")?.className ?? ""}`)
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
