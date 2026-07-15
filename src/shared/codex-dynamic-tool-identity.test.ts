import { describe, expect, test } from "vitest";
import {
  CODEX_APP_TOOL_NAMESPACE,
  hasCodexDynamicToolIdentity,
  isCodexAppDynamicTool,
} from "./codex-dynamic-tool-identity";

describe("Codex dynamic tool identity", () => {
  test("treats namespace and tool as one identity", () => {
    const codexApp = { namespace: CODEX_APP_TOOL_NAMESPACE, tool: "search" };
    const nodexApp = { namespace: "nodex_app", tool: "search" };

    expect(hasCodexDynamicToolIdentity(codexApp, codexApp)).toBe(true);
    expect(hasCodexDynamicToolIdentity(nodexApp, codexApp)).toBe(false);
    expect(hasCodexDynamicToolIdentity({ namespace: null, tool: "search" }, codexApp)).toBe(false);
    expect(isCodexAppDynamicTool(codexApp)).toBe(true);
    expect(isCodexAppDynamicTool(nodexApp)).toBe(false);
  });
});
