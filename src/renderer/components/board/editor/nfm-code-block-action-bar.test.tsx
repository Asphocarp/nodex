import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vite-plus/test";
import { NfmCodeBlockActionBar } from "./nfm-code-block-action-bar";

describe("NfmCodeBlockActionBar", () => {
  test("offers searchable language, copy, and More actions", () => {
    const onLanguageChange = vi.fn();
    const onCopy = vi.fn(async () => true);
    const onMore = vi.fn();
    render(
      <NfmCodeBlockActionBar
        languageId="typescript"
        mode="all"
        onLanguageChange={onLanguageChange}
        onCopy={onCopy}
        onMore={onMore}
      />,
    );

    expect(screen.getByRole("toolbar", { name: "Code block action bar" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open language dropdown" }));
    expect(screen.getAllByRole("option")).toHaveLength(88);

    fireEvent.change(screen.getByRole("combobox", { name: "Search code languages" }), {
      target: { value: "coq" },
    });
    const rocq = screen.getByRole("option", { name: "Rocq" });
    expect(rocq.getAttribute("aria-selected")).toBe("false");
    fireEvent.click(rocq);
    expect(onLanguageChange).toHaveBeenCalledWith("rocq");

    fireEvent.click(screen.getByRole("button", { name: "Copy code to clipboard" }));
    expect(onCopy).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Open block actions menu" }));
    expect(onMore).toHaveBeenCalledOnce();
  });

  test("keeps every capability reachable through More in a narrow block", () => {
    render(
      <NfmCodeBlockActionBar
        languageId="text"
        mode="more_only"
        onLanguageChange={vi.fn()}
        onCopy={vi.fn(async () => true)}
        onMore={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Open language dropdown" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy code to clipboard" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open block actions menu" })).not.toBeNull();
  });
});
