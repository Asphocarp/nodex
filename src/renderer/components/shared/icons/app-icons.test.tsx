import { describe, expect, test } from "vitest";
import { render } from "@/test/dom";
import {
  BoardIcon,
  CalendarIcon,
  CanvasIcon,
  CodeBracketsIcon,
  DatabaseIcon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
  NewChatIcon,
  PageIcon,
  SettingsBrowserIcon,
  SettingsComputerUseIcon,
  SettingsGitIcon,
  SettingsImportIcon,
  SettingsPasswordsIcon,
} from "./app-icons";

describe("shared icon intrinsic geometry", () => {
  test.each([
    ["new chat", NewChatIcon, "16"],
    ["folder", FolderIcon, "16"],
    ["open folder", FolderOpenIcon, "16"],
    ["database", DatabaseIcon, "16"],
    ["board", BoardIcon, "16"],
    ["canvas", CanvasIcon, "16"],
    ["code brackets", CodeBracketsIcon, "12"],
    ["calendar", CalendarIcon, "16"],
  ])("provides a CSS-independent fallback for %s", (_label, Icon, size) => {
    const view = render(<Icon />);
    const svg = view.container.querySelector("svg");

    expect(svg?.getAttribute("width")).toBe(size);
    expect(svg?.getAttribute("height")).toBe(size);
  });
});

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
