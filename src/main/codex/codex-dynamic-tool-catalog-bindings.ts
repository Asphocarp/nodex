import type { DynamicToolSpec } from "@nodex/codex-app-server-protocol/v2/DynamicToolSpec";
import {
  CODEX_APP_TOOL_NAMESPACE,
  CODEX_APP_TOOLSET_REVISION,
} from "../../shared/codex-dynamic-tool-identity";
import {
  NODEX_APP_TOOL_NAMESPACE,
  NODEX_APP_TOOLSET_REVISION,
} from "../../shared/nodex-agent-tools/identity";
import type { DynamicToolCatalogSelection } from "./dynamic-tool-registry";

const CURRENT_TOOLSET_REVISION_BY_NAMESPACE = new Map<string, number>([
  [CODEX_APP_TOOL_NAMESPACE, CODEX_APP_TOOLSET_REVISION],
  [NODEX_APP_TOOL_NAMESPACE, NODEX_APP_TOOLSET_REVISION],
]);

export function resolveDynamicToolCatalogBindings(
  specs: readonly DynamicToolSpec[] | null | undefined,
): DynamicToolCatalogSelection[] {
  if (!specs) return [];

  const bindings: DynamicToolCatalogSelection[] = [];
  const seenNamespaces = new Set<string>();
  for (const spec of specs) {
    if (spec.type !== "namespace") {
      throw new Error("Nodex requires every dynamic tool to belong to a namespace");
    }
    if (seenNamespaces.has(spec.name)) {
      throw new Error(`Duplicate dynamic-tool namespace in launch catalog: ${spec.name}`);
    }
    seenNamespaces.add(spec.name);

    const toolsetRevision = CURRENT_TOOLSET_REVISION_BY_NAMESPACE.get(spec.name);
    if (toolsetRevision === undefined) {
      throw new Error(`No toolset revision is registered for namespace ${spec.name}`);
    }
    bindings.push({ namespace: spec.name, toolsetRevision });
  }

  return bindings;
}
