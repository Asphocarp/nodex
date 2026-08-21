import { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { AppStartupScreen } from "./app-startup-screen";
import { render } from "../test/dom";

describe("AppStartupScreen", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("keeps generic opening copy visually quiet until startup takes time", async () => {
    const { getByRole, queryByText } = render(<AppStartupScreen step={{ phase: "opening" }} />);

    expect(getByRole("status").textContent).toContain("Opening Nodex…");
    expect(queryByText("Opening Nodex…", { selector: "p" })).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(1800);
    });
    expect(queryByText("Opening Nodex…", { selector: "p" })).not.toBeNull();
  });

  test("shows only real migration status and no fake progressbar", () => {
    const { getByRole, queryByRole, getByText } = render(
      <AppStartupScreen step={{ phase: "migrating", fromVersion: 86, toVersion: 88 }} />,
    );

    expect(getByRole("status").textContent).toContain("Updating local data…");
    expect(getByText("Updating local data…", { selector: "p" })).not.toBeNull();
    expect(queryByRole("progressbar")).toBeNull();
  });

  test("shows workspace opening after local data is ready", () => {
    const { getByText, queryByText } = render(
      <AppStartupScreen step={{ phase: "opening_workspace" }} />,
    );

    expect(getByText("Opening workspace…", { selector: "p" })).not.toBeNull();
    expect(queryByText("Updating local data…")).toBeNull();
  });
});
