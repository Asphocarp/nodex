import type { DynamicToolNamespaceSpec } from "@nodex/codex-app-server-protocol/v2/DynamicToolNamespaceSpec";
import type { DynamicToolNamespaceTool } from "@nodex/codex-app-server-protocol/v2/DynamicToolNamespaceTool";
import type { DynamicToolSpec } from "@nodex/codex-app-server-protocol/v2/DynamicToolSpec";

export interface DynamicToolMetric {
  readonly name: string;
  readonly descriptionBytes: number;
  readonly schemaBytes: number;
  readonly totalBytes: number;
  readonly deferred: boolean;
}

export interface DynamicToolCatalogMetrics {
  readonly namespace: string;
  readonly namespaceBytes: number;
  readonly eagerBytes: number;
  readonly completeBytes: number;
  readonly tools: readonly DynamicToolMetric[];
}

function utf8JsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function requireSingleNamespace(catalog: readonly DynamicToolSpec[]): DynamicToolNamespaceSpec {
  if (catalog.length !== 1 || catalog[0]?.type !== "namespace") {
    throw new Error("Catalog measurement requires exactly one dynamic-tool namespace");
  }
  return catalog[0];
}

function namespaceWithTools(
  namespace: DynamicToolNamespaceSpec,
  tools: readonly DynamicToolNamespaceTool[],
): DynamicToolNamespaceSpec {
  return { ...namespace, tools: [...tools] };
}

/** Measure the exact JSON payload shapes published to app-server. */
export function measureDynamicToolCatalog(
  catalog: readonly DynamicToolSpec[],
): DynamicToolCatalogMetrics {
  const namespace = requireSingleNamespace(catalog);
  const eagerTools = namespace.tools.filter((tool) => tool.deferLoading !== true);

  return {
    namespace: namespace.name,
    namespaceBytes: utf8JsonBytes(namespaceWithTools(namespace, [])),
    eagerBytes: utf8JsonBytes([namespaceWithTools(namespace, eagerTools)]),
    completeBytes: utf8JsonBytes(catalog),
    tools: namespace.tools.map((tool) => ({
      name: tool.name,
      descriptionBytes: Buffer.byteLength(tool.description, "utf8"),
      schemaBytes: utf8JsonBytes(tool.inputSchema),
      totalBytes: utf8JsonBytes(tool),
      deferred: tool.deferLoading === true,
    })),
  };
}

export function formatDynamicToolCatalogMetrics(metrics: DynamicToolCatalogMetrics): string {
  const rows = [
    ["scope", "loading", "description", "schema", "total", "bytes/4"],
    [
      "namespace",
      "shared",
      "-",
      "-",
      metrics.namespaceBytes,
      Math.ceil(metrics.namespaceBytes / 4),
    ],
    ["eager catalog", "eager", "-", "-", metrics.eagerBytes, Math.ceil(metrics.eagerBytes / 4)],
    [
      "complete catalog",
      "all",
      "-",
      "-",
      metrics.completeBytes,
      Math.ceil(metrics.completeBytes / 4),
    ],
    ...metrics.tools.map((tool) => [
      tool.name,
      tool.deferred ? "deferred" : "eager",
      tool.descriptionBytes,
      tool.schemaBytes,
      tool.totalBytes,
      Math.ceil(tool.totalBytes / 4),
    ]),
  ];
  const widths = rows[0].map((_, column) =>
    Math.max(...rows.map((row) => String(row[column]).length)),
  );

  return rows
    .map((row, rowIndex) => {
      const rendered = row
        .map((cell, column) => {
          const value = String(cell);
          return column < 2 ? value.padEnd(widths[column]) : value.padStart(widths[column]);
        })
        .join("  ");
      if (rowIndex !== 0) return rendered;
      return `${rendered}\n${widths.map((width) => "-".repeat(width)).join("  ")}`;
    })
    .join("\n");
}
