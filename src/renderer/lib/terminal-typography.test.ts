import { describe, expect, test } from "bun:test";
import {
  resolveTerminalTypography,
  sameTerminalTypography,
} from "./terminal-typography";

describe("terminal-typography", () => {
  test("normalizes configured font families for xterm canvas metrics", () => {
    const host = document.createElement("div");
    host.style.setProperty("--vscode-editor-font-family", "Monaco");
    host.style.setProperty("--vscode-editor-font-size", "15px");
    document.body.appendChild(host);

    const typography = resolveTerminalTypography(host);

    expect(typography.fontFamily).toBe('Monaco, "Symbols Nerd Font Mono", monospace');
    expect(typography.fontSize).toBe(15);
  });

  test("does not pass unresolved CSS variables to xterm", () => {
    const host = document.createElement("div");
    host.style.setProperty(
      "--vscode-editor-font-family",
      "var(--font-vscode-editor, monospace)",
    );
    document.body.appendChild(host);

    const typography = resolveTerminalTypography(host);

    expect(typography.fontFamily.includes("var(")).toBeFalse();
    expect(typography.fontFamily.includes("monospace")).toBeTrue();
  });

  test("does not confuse ui-monospace with the generic monospace fallback", () => {
    const host = document.createElement("div");
    host.style.setProperty("--vscode-editor-font-family", "ui-monospace");
    document.body.appendChild(host);

    const typography = resolveTerminalTypography(host);

    expect(typography.fontFamily).toBe(
      'ui-monospace, "Symbols Nerd Font Mono", monospace',
    );
  });

  test("falls back when CSS token resolution is unavailable", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const typography = resolveTerminalTypography(host);

    expect(typography.fontFamily.length > 0).toBeTrue();
    expect(typography.fontSize > 0).toBeTrue();
  });

  test("compares terminal typography snapshots", () => {
    expect(sameTerminalTypography(
      { fontFamily: "Menlo, monospace", fontSize: 14 },
      { fontFamily: "Menlo, monospace", fontSize: 14 },
    )).toBeTrue();
    expect(sameTerminalTypography(
      { fontFamily: "Menlo, monospace", fontSize: 14 },
      { fontFamily: "Monaco, monospace", fontSize: 14 },
    )).toBeFalse();
  });
});
