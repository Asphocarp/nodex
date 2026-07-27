import type { components } from "@nodex/core-protocol";
import type {
  ProjectSessionInvalidationScope as RendererProjectSessionInvalidationScope,
} from "../ipc-api";

/**
 * Narrow bridge aliases used while mapping generated Core events into the
 * renderer's camel-cased invalidation contract. Project Workspace
 * reads/intents/results must come directly from `@nodex/core-protocol`.
 */
export type ProjectCatalogChangeKind =
  components["schemas"]["ProjectCatalogChangeKind"];

export type ProjectSessionInvalidationScope =
  RendererProjectSessionInvalidationScope;
