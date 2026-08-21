import { describe, expect, test } from "vitest";
import {
  CODEX_APP_TOOL_NAMESPACE,
  CODEX_APP_TOOLSET_REVISION,
} from "../../shared/codex-dynamic-tool-identity";
import {
  NODEX_APP_TOOL_NAMESPACE,
  NODEX_APP_TOOLSET_REVISION,
} from "../../shared/nodex-agent-tools";
import { resolveDynamicToolCatalogBindings } from "./codex-dynamic-tool-catalog-bindings";

describe("resolveDynamicToolCatalogBindings", () => {
  test("binds every injected namespace to its host-owned current revision", () => {
    expect(
      resolveDynamicToolCatalogBindings([
        {
          type: "namespace",
          name: CODEX_APP_TOOL_NAMESPACE,
          description: "Codex app tools",
          tools: [],
        },
        {
          type: "namespace",
          name: NODEX_APP_TOOL_NAMESPACE,
          description: "Nodex content tools",
          tools: [],
        },
      ]),
    ).toEqual([
      {
        namespace: CODEX_APP_TOOL_NAMESPACE,
        toolsetRevision: CODEX_APP_TOOLSET_REVISION,
      },
      {
        namespace: NODEX_APP_TOOL_NAMESPACE,
        toolsetRevision: NODEX_APP_TOOLSET_REVISION,
      },
    ]);
  });

  test("rejects unnamespaced, duplicate, and unversioned catalogs", () => {
    expect(() =>
      resolveDynamicToolCatalogBindings([
        {
          type: "function",
          name: "loose",
          description: "Loose tool",
          inputSchema: {},
        },
      ]),
    ).toThrow("every dynamic tool to belong to a namespace");

    expect(() =>
      resolveDynamicToolCatalogBindings([
        { type: "namespace", name: "codex_app", description: "First", tools: [] },
        { type: "namespace", name: "codex_app", description: "Second", tools: [] },
      ]),
    ).toThrow("Duplicate dynamic-tool namespace");

    expect(() =>
      resolveDynamicToolCatalogBindings([
        {
          type: "namespace",
          name: "foreign_app",
          description: "Foreign tools",
          tools: [],
        },
      ]),
    ).toThrow("No toolset revision is registered");
  });
});
