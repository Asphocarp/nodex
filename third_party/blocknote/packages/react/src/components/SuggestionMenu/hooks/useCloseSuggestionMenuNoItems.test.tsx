import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useCloseSuggestionMenuNoItems } from "./useCloseSuggestionMenuNoItems.js";

describe("useCloseSuggestionMenuNoItems", () => {
  it("defers invalid-query closure until IME composition settles", () => {
    const closeMenu = vi.fn();
    const { rerender } = renderHook(
      ({ isComposing }) =>
        useCloseSuggestionMenuNoItems(
          [],
          "abcd",
          closeMenu,
          3,
          () => true,
          true,
          true,
          isComposing,
        ),
      { initialProps: { isComposing: true } },
    );

    expect(closeMenu).not.toHaveBeenCalled();

    rerender({ isComposing: false });

    expect(closeMenu).toHaveBeenCalledOnce();
  });
});
