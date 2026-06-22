import { describe, expect, test } from "bun:test";
import {
  isCodexCompactWindowUrl,
  resolveCodexRendererOsFromText,
  resolveCodexRendererWindowChrome,
} from "./codex-window-runtime";

describe("codex window runtime helpers", () => {
  test("normalizes renderer OS from navigator platform text", () => {
    expect(resolveCodexRendererOsFromText("MacIntel")).toBe("darwin");
    expect(resolveCodexRendererOsFromText("Win32")).toBe("win32");
    expect(resolveCodexRendererOsFromText("Linux x86_64")).toBe("linux");
    expect(resolveCodexRendererOsFromText("Plan 9")).toBe("unknown");
  });

  test("matches Codex Electron window chrome by platform", () => {
    expect(resolveCodexRendererWindowChrome("browser", "win32")).toBe("native");
    expect(resolveCodexRendererWindowChrome("electron", "darwin")).toBe("native");
    expect(resolveCodexRendererWindowChrome("electron", "unknown")).toBe("native");
    expect(resolveCodexRendererWindowChrome("electron", "linux")).toBe("application-menu");
    expect(resolveCodexRendererWindowChrome("electron", "win32")).toBe("application-menu");
  });

  test("detects compact Codex window routes", () => {
    expect(isCodexCompactWindowUrl("app://-/avatar-overlay")).toBeTrue();
    expect(isCodexCompactWindowUrl("app://-/global-dictation")).toBeTrue();
    expect(isCodexCompactWindowUrl("app://-/global-dictation/session")).toBeTrue();
    expect(isCodexCompactWindowUrl("app://-/hotkey-window")).toBeTrue();
    expect(isCodexCompactWindowUrl("app://-/?initialRoute=/hotkey-window")).toBeTrue();
    expect(isCodexCompactWindowUrl("app://-/?initialRoute=/avatar-overlay?x=1")).toBeTrue();
    expect(isCodexCompactWindowUrl("app://-/")).toBeFalse();
    expect(isCodexCompactWindowUrl("app://-/settings")).toBeFalse();
    expect(isCodexCompactWindowUrl("not a url")).toBeFalse();
  });
});
