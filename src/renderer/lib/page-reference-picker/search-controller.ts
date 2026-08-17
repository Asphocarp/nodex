import {
  type LibraryPageReferenceCandidate,
} from "../../../shared/library-module";
import { readLibraryModule } from "../api";
import {
  deduplicatePageReferenceCandidates,
  resolvePageReferenceDisabledReason,
} from "./candidate-model";
import type {
  PageReferenceCandidate,
  PageReferencePickerRequest,
} from "./types";

export function resolvePageReferenceSourcePageId(
  request: PageReferencePickerRequest,
): string | undefined {
  if (request.intent === "reference_block") return undefined;
  return request.hostPageId ?? undefined;
}

export async function loadPageReferenceCandidates(
  request: PageReferencePickerRequest,
): Promise<PageReferenceCandidate[]> {
  const sourcePageId = resolvePageReferenceSourcePageId(request);
  const result = await readLibraryModule(request.accessContext, {
    read: {
      mode: "page_reference_candidates",
      query: request.query,
      limit: Math.max(1, Math.min(60, Math.floor(request.limit))),
      ...(sourcePageId === undefined
        ? {}
        : { sourcePageId }),
    },
  });
  if (!result.ok) throw new Error(result.error.message);
  if (result.value.value.kind !== "page_reference_candidates") {
    throw new Error("Library returned the wrong Page reference read model");
  }
  return deduplicatePageReferenceCandidates(
    result.value.value.items.map((item: LibraryPageReferenceCandidate) => ({
      ...item,
      lifecycle: "active" as const,
      disabledReason: resolvePageReferenceDisabledReason({
        pageId: item.pageId,
        hostPageId: request.hostPageId,
        ancestorPageIds: request.ancestorPageIds,
        intent: request.intent,
      }),
    })),
    request.limit,
  );
}

export interface PageReferenceSearchController {
  search(request: PageReferencePickerRequest): Promise<{
    readonly status: "current" | "stale";
    readonly items: readonly PageReferenceCandidate[];
  }>;
}

export function createPageReferenceSearchController(
  loader: typeof loadPageReferenceCandidates = loadPageReferenceCandidates,
): PageReferenceSearchController {
  let generation = 0;
  return {
    async search(request) {
      const current = ++generation;
      const items = await loader(request);
      return {
        status: current === generation ? "current" : "stale",
        items: current === generation ? items : [],
      };
    },
  };
}
