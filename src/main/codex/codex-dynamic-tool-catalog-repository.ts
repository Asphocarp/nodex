import { getDb } from "../local-store/database";
import type { DynamicToolCatalogSelection } from "./dynamic-tool-registry";

interface DynamicToolCatalogRow {
  readonly namespace: string;
  readonly toolset_revision: number;
}

function normalizeBinding(
  binding: DynamicToolCatalogSelection,
): DynamicToolCatalogSelection {
  const namespace = binding.namespace.trim();
  if (!namespace) throw new Error("Dynamic-tool namespace is required");
  if (!Number.isSafeInteger(binding.toolsetRevision) || binding.toolsetRevision <= 0) {
    throw new Error("Dynamic-tool revision must be a positive safe integer");
  }
  return { namespace, toolsetRevision: binding.toolsetRevision };
}

export function replaceCodexThreadDynamicToolCatalogs(
  threadId: string,
  bindings: readonly DynamicToolCatalogSelection[],
): void {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) throw new Error("Codex thread identity is required");

  const normalizedBindings = bindings.map(normalizeBinding);
  const namespaces = new Set(normalizedBindings.map((binding) => binding.namespace));
  if (namespaces.size !== normalizedBindings.length) {
    throw new Error("A Codex thread cannot bind multiple revisions of one namespace");
  }

  const database = getDb();
  const replace = database.transaction(() => {
    database.prepare(
      "DELETE FROM codex_thread_dynamic_tool_catalogs WHERE thread_id = ?",
    ).run(normalizedThreadId);
    const insert = database.prepare(`
      INSERT INTO codex_thread_dynamic_tool_catalogs (
        thread_id,
        namespace,
        toolset_revision
      ) VALUES (?, ?, ?)
    `);
    for (const binding of normalizedBindings) {
      insert.run(normalizedThreadId, binding.namespace, binding.toolsetRevision);
    }
  });
  replace.immediate();
}

export function getCodexThreadDynamicToolCatalogs(
  threadId: string,
): DynamicToolCatalogSelection[] {
  const rows = getDb().prepare(`
    SELECT namespace, toolset_revision
    FROM codex_thread_dynamic_tool_catalogs
    WHERE thread_id = ?
    ORDER BY namespace
  `).all(threadId) as DynamicToolCatalogRow[];

  return rows.map((row) => ({
    namespace: row.namespace,
    toolsetRevision: row.toolset_revision,
  }));
}

export function getCodexThreadDynamicToolRevision(
  threadId: string,
  namespace: string,
): number | null {
  const row = getDb().prepare(`
    SELECT toolset_revision
    FROM codex_thread_dynamic_tool_catalogs
    WHERE thread_id = ? AND namespace = ?
  `).get(threadId, namespace) as Pick<DynamicToolCatalogRow, "toolset_revision"> | undefined;
  return row?.toolset_revision ?? null;
}

export function copyCodexThreadDynamicToolCatalogs(
  sourceThreadId: string,
  targetThreadId: string,
): void {
  replaceCodexThreadDynamicToolCatalogs(
    targetThreadId,
    getCodexThreadDynamicToolCatalogs(sourceThreadId),
  );
}
