import { describe, expect, test } from "vitest";
import { render } from "@/test/dom";
import {
  FileIcon,
  PageIcon,
  SettingsBrowserIcon,
  SettingsComputerUseIcon,
  SettingsGitIcon,
  SettingsImportIcon,
  SettingsPasswordsIcon,
} from "./app-icons";

describe("file and page identity icons", () => {
  test("share one geometry while preserving semantic component names", () => {
    const fileView = render(<FileIcon />);
    const pageView = render(<PageIcon />);
    const fileSvg = fileView.container.querySelector("svg");
    const pageSvg = pageView.container.querySelector("svg");

    expect(fileSvg?.getAttribute("viewBox")).toBe("0 0 21 21");
    expect(pageSvg?.getAttribute("viewBox")).toBe("0 0 21 21");
    expect(fileSvg?.querySelector("path")?.getAttribute("d")).toBe(
      pageSvg?.querySelector("path")?.getAttribute("d"),
    );
    expect(fileSvg?.querySelector("path")?.getAttribute("fill")).toBe("currentColor");
    expect(fileSvg?.hasAttribute("data-file-page-icon")).toBe(true);
    expect(pageSvg?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("settings identity icons", () => {
  test.each([
    ["import", SettingsImportIcon, "0 0 20 20"],
    ["browser", SettingsBrowserIcon, "0 0 16 16"],
    ["computer use", SettingsComputerUseIcon, "0 0 21 20"],
    ["git", SettingsGitIcon, "0 0 20 20"],
    ["passwords", SettingsPasswordsIcon, "0 0 20 20"],
  ])("renders an app-owned geometry for %s", (_label, Icon, viewBox) => {
    const view = render(<Icon />);
    const svg = view.container.querySelector("svg");

    expect(svg?.getAttribute("viewBox")).toBe(viewBox);
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.querySelectorAll("path, circle").length).toBeGreaterThan(0);
  });
});
