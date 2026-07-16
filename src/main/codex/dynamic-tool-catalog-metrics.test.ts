import { describe, expect, test } from "vitest";
import { NODEX_AGENT_V3_CATALOG_BUDGETS } from "../../shared/nodex-agent-tools/budgets";
import {
  NESTED_MARKDOWN_AGENT_GUIDE,
  NESTED_MARKDOWN_COMPACT_HINT,
} from "../../shared/nfm/agent-guide";
import {
  formatDynamicToolCatalogMetrics,
  measureDynamicToolCatalog,
} from "./dynamic-tool-catalog-metrics";
import { buildNodexAgentV3DynamicToolCatalog } from "./nodex-dynamic-tool-registry";

describe("Nodex Agent catalog metrics", () => {
  test("renders one deterministic table with all cost centers", () => {
    const metrics = measureDynamicToolCatalog(buildNodexAgentV3DynamicToolCatalog());
    const first = formatDynamicToolCatalogMetrics(metrics);
    const second = formatDynamicToolCatalogMetrics(metrics);

    expect(first).toBe(second);
    expect(first.split("\n").filter((line) => line.includes("complete catalog"))).toHaveLength(1);
    for (const tool of metrics.tools) {
      expect(first.split("\n").filter((line) => line.startsWith(tool.name))).toHaveLength(1);
    }
  });

  test("rejects an absent or ambiguous namespace", () => {
    expect(() => measureDynamicToolCatalog([])).toThrow(
      "exactly one dynamic-tool namespace",
    );
    const catalog = buildNodexAgentV3DynamicToolCatalog();
    expect(() => measureDynamicToolCatalog([...catalog, ...catalog])).toThrow(
      "exactly one dynamic-tool namespace",
    );
  });

  test("keeps v3 within common-path and intent-tool budgets", () => {
    const catalog = buildNodexAgentV3DynamicToolCatalog();
    const metrics = measureDynamicToolCatalog(catalog);

    expect(metrics.eagerBytes).toBeLessThanOrEqual(NODEX_AGENT_V3_CATALOG_BUDGETS.eagerBytes);
    expect(metrics.completeBytes).toBeLessThanOrEqual(
      NODEX_AGENT_V3_CATALOG_BUDGETS.completeBytes,
    );
    for (const tool of metrics.tools) {
      const budget = NODEX_AGENT_V3_CATALOG_BUDGETS.tools[
        tool.name as keyof typeof NODEX_AGENT_V3_CATALOG_BUDGETS.tools
      ];
      if (budget === undefined) continue;
      expect(tool.totalBytes, tool.name).toBeLessThanOrEqual(budget);
    }

    const namespace = catalog[0];
    expect(namespace?.type).toBe("namespace");
    if (!namespace || namespace.type !== "namespace") return;
    expect(namespace.description.split(NESTED_MARKDOWN_COMPACT_HINT)).toHaveLength(2);
    expect(Buffer.byteLength(NESTED_MARKDOWN_COMPACT_HINT, "utf8")).toBeLessThanOrEqual(
      NODEX_AGENT_V3_CATALOG_BUDGETS.namespaceHintBytes,
    );
    const serialized = JSON.stringify(catalog);
    expect(serialized).not.toContain(NESTED_MARKDOWN_AGENT_GUIDE.instructions);
    expect(serialized).not.toMatch(/NFM|nfm/u);
    expect(namespace.tools.filter((tool) => tool.deferLoading !== true).map(
      (tool) => tool.name,
    )).toEqual(["fetch", "get_context", "search"]);
  });
});
