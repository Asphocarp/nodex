import { describe, expect, test } from "vitest";
import { CodexRendererViewRegistry } from "./codex-renderer-view-registry";

describe("CodexRendererViewRegistry", () => {
  test("routes presentation to the most recently activated visible renderer", () => {
    const registry = new CodexRendererViewRegistry();

    registry.setActive("thread-1", "renderer-1", true);
    registry.setActive("thread-1", "renderer-2", true);
    expect(registry.resolvePresentationClient("thread-1")).toBe("renderer-2");

    registry.setActive("thread-1", "renderer-1", true);
    expect(registry.resolvePresentationClient("thread-1")).toBe("renderer-1");
  });

  test("falls back to another visible renderer when the active client leaves", () => {
    const registry = new CodexRendererViewRegistry();
    registry.setActive("thread-1", "renderer-1", true);
    registry.setActive("thread-1", "renderer-2", true);

    registry.setActive("thread-1", "renderer-2", false);

    expect(registry.hasActiveView("thread-1")).toBe(true);
    expect(registry.resolvePresentationClient("thread-1")).toBe("renderer-1");
  });

  test("removes every view owned by a disposed client without affecting peers", () => {
    const registry = new CodexRendererViewRegistry();
    registry.setActive("thread-1", "renderer-1", true);
    registry.setActive("thread-2", "renderer-1", true);
    registry.setActive("thread-2", "renderer-2", true);

    expect(registry.removeClient("renderer-1")).toEqual(["thread-1", "thread-2"]);
    expect(registry.resolvePresentationClient("thread-1")).toBeNull();
    expect(registry.resolvePresentationClient("thread-2")).toBe("renderer-2");

    registry.clearConversation("thread-2");
    expect(registry.hasActiveView("thread-2")).toBe(false);
  });
});
