import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import "../../../../globals.css";
import { UserMessageText } from "./user-message-collapse";

describe("UserMessageText browser collapse", () => {
  test("measures real layout and removes clipped links from keyboard navigation", async () => {
    const message = Array.from(
      { length: 60 },
      (_value, index) => `[Reference ${index + 1}](https://example.test/${index + 1})`,
    ).join("\n");
    const view = render(
      <div style={{ width: 420 }}>
        <UserMessageText text={message} collapsedLineCount={5} />
      </div>,
    );

    const showMore = await view.findByRole("button", { name: "Show more" });
    const links = view.getAllByRole("link", { hidden: true });
    const clippedLink = links.at(-1);
    expect(clippedLink).toBeDefined();
    if (!clippedLink) throw new Error("Expected the final message link");

    await waitFor(() => {
      expect(clippedLink.getAttribute("aria-hidden")).toBe("true");
      expect(clippedLink.hasAttribute("inert")).toBe(true);
    });

    fireEvent.click(showMore);
    await waitFor(() => {
      expect(view.getByRole("button", { name: "Show less" }).getAttribute("aria-expanded"))
        .toBe("true");
      expect(clippedLink.getAttribute("aria-hidden")).toBeNull();
      expect(clippedLink.hasAttribute("inert")).toBe(false);
    });
  });
});
