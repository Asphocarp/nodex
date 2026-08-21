import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vite-plus/test";
import { render } from "@/test/dom";
import { UserMessageText } from "./user-message-collapse";

vi.mock("@/lib/use-theme", () => ({
  useTheme: () => ({ resolved: "dark" }),
}));

describe("UserMessageText", () => {
  test("keeps a legacy 100,000-character message out of Markdown and opens a viewport reader", async () => {
    const text = Array.from({ length: 10_000 }, (_, index) => `legacy line ${index}`).join("\n");
    const view = render(<UserMessageText text={text} />);

    expect(view.getByText(/characters omitted/)).toBeDefined();
    expect(view.container.querySelectorAll(".codex-markdown-user").length).toBe(0);
    fireEvent.click(view.getByRole("button", { name: "View full message" }));

    await waitFor(() => {
      expect(view.getByLabelText("Full user message")).toBeDefined();
    });
    expect(view.getByLabelText("Full user message").getAttribute("data-source-viewer")).toBe(
      "true",
    );
  });
});
