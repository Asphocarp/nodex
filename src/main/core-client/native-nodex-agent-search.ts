import type { components } from "@nodex/core-protocol";
import type {
  NodexAgentV3ReadCommandResult,
  NodexAgentV3ReadRequest,
} from "../../shared/nodex-agent-tools";
import { SearchV3OutputSchema } from "../../shared/nodex-agent-tools/v3-read-schemas";
import {
  blockRecordSnapshotToWindow,
  type BlockRecord,
  type BlockRecordWindow,
} from "../../shared/block-records";
import type { RustDataAuthorityRuntime } from "./desktop-data-authority";
import { toCoreAgentExecutionAuthorization } from "./desktop-nodex-agent-resource-authority";
import { mapNativeNodexAgentCoreError } from "./native-nodex-agent-page-update";

type SearchRequest = Extract<NodexAgentV3ReadRequest, { readonly tool: "search" }>;
type SearchScope = NonNullable<SearchRequest["input"]["scope"]>;
type SearchQuality = "exact" | "prefix" | "fuzzy";
type AgentAuthorization = components["schemas"]["AgentExecutionAuthorization"];

type PageEvidence =
  | { readonly source: "title"; readonly quality: SearchQuality; readonly excerpt: string }
  | {
      readonly source: "property";
      readonly quality: SearchQuality;
      readonly propertyId: string;
      readonly propertyName: string;
      readonly excerpt: string;
    }
  | {
      readonly source: "body";
      readonly quality: SearchQuality;
      readonly blockId: string;
      readonly blockType: string;
      readonly excerpt: string;
    };

interface CanonicalSearchCursor {
  readonly version: 1;
  readonly storeEpoch: string;
  readonly commitSeq: number;
  readonly query: string;
  readonly target: "pages" | "blocks";
  readonly afterId: string;
}

interface CanonicalSearchSnapshot {
  readonly window: BlockRecordWindow;
  readonly storeEpoch: string;
  readonly commitSeq: number;
}

const SEARCH_CURSOR_PREFIX = "nxc1.search.";
const MAX_EXCERPT_CHARS = 240;

const record = (value: unknown): Readonly<Record<string, unknown>> | null => (
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null
);

const textParts = (value: unknown, output: string[] = []): readonly string[] => {
  if (typeof value === "string") {
    if (value.trim()) output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => textParts(entry, output));
    return output;
  }
  const object = record(value);
  if (!object) return output;
  if (typeof object.text === "string") output.push(object.text);
  if (typeof object.content === "string") output.push(object.content);
  Object.entries(object).forEach(([key, entry]) => {
    if (key !== "text" && key !== "content") textParts(entry, output);
  });
  return output;
};

const normalizeText = (value: string): string => value
  .normalize("NFKC")
  .toLocaleLowerCase()
  .replace(/\s+/gu, " ")
  .trim();

const words = (value: string): readonly string[] => normalizeText(value)
  .split(/[^\p{L}\p{N}_-]+/u)
  .filter(Boolean);

const editDistance = (left: string, right: string): number => {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0]!;
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex]!;
      previous[rightIndex] = left[leftIndex - 1] === right[rightIndex - 1]
        ? diagonal
        : Math.min(diagonal, above, previous[rightIndex - 1]!) + 1;
      diagonal = above;
    }
  }
  return previous[right.length]!;
};

const qualityFor = (text: string, term: string): SearchQuality | null => {
  const normalized = normalizeText(text);
  const normalizedTerm = normalizeText(term);
  if (!normalized || !normalizedTerm) return null;
  if (normalized.includes(normalizedTerm)) return "exact";
  if (words(normalized).some((word) => word.startsWith(normalizedTerm))) return "prefix";
  if (words(normalized).some((word) => (
    word.length >= 3 && editDistance(word, normalizedTerm) <= 2
  ))) return "fuzzy";
  return null;
};

const excerpt = (value: string): string => value.length <= MAX_EXCERPT_CHARS
  ? value
  : `${value.slice(0, MAX_EXCERPT_CHARS - 1)}…`;

const blockText = (
  block: BlockRecord,
  window: BlockRecordWindow,
): string => {
  const properties = Object.entries(block.properties)
    .filter(([key]) => key !== "dataSourceValues")
    .flatMap(([, value]) => textParts(value));
  const content = window.content
    .filter((entry) => entry.blockId === block.id)
    .flatMap((entry) => textParts(entry.content));
  return [...properties, ...content].join(" ");
};

const pageTitle = (page: BlockRecord, window: BlockRecordWindow): string => {
  const title = page.properties.title;
  if (typeof title === "string" && title.trim()) return title;
  const materialized = window.content.find((entry) => (
    entry.blockId === page.id && entry.slot === "title"
  ));
  return textParts(materialized?.content).join(" ").trim() || page.id;
};

const ownerPageId = (
  blockId: string,
  records: ReadonlyMap<string, BlockRecord>,
  placements: ReadonlyMap<string, BlockRecordWindow["placements"][number]>,
): string | null => {
  const visited = new Set<string>();
  let current = blockId;
  while (visited.add(current)) {
    const block = records.get(current);
    if (!block) return null;
    if (block.kind === "page") return block.id;
    const placement = placements.get(current);
    if (!placement || placement.parent.kind !== "block") return null;
    current = placement.parent.blockId;
  }
  return null;
};

const pageLocation = (
  page: BlockRecord,
  placements: ReadonlyMap<string, BlockRecordWindow["placements"][number]>,
) => {
  const placement = placements.get(page.id);
  if (!placement || placement.parent.kind === "library") {
    return { kind: "library" as const, libraryId: page.libraryId };
  }
  if (placement.parent.kind === "block") {
    return { kind: "page" as const, pageId: placement.parent.blockId };
  }
  return {
    kind: "data_source" as const,
    dataSourceId: placement.parent.dataSourceId,
  };
};

const valuesText = (page: BlockRecord): readonly {
  propertyId: string;
  value: string;
}[] => {
  const values = page.properties.dataSourceValues;
  if (!Array.isArray(values)) return [];
  return values.flatMap((entry) => {
    const value = record(entry);
    if (typeof value?.propertyId !== "string" || !("value" in value)) return [];
    return [{
      propertyId: value.propertyId,
      value: textParts(value.value).join(" "),
    }];
  });
};

const scopeAllowsPage = (
  page: BlockRecord,
  scope: SearchScope | undefined,
  placements: ReadonlyMap<string, BlockRecordWindow["placements"][number]>,
): boolean => {
  if (!scope || scope.kind === "library" || scope.kind === "database") return true;
  if (scope.kind === "page") return page.id === scope.pageId;
  const placement = placements.get(page.id);
  return placement?.parent.kind === "dataSource"
    && placement.parent.dataSourceId === scope.dataSourceId;
};

const decodeCursor = (
  cursor: string | undefined,
  expected: Pick<CanonicalSearchCursor, "query" | "target">,
  snapshot: Pick<CanonicalSearchSnapshot, "storeEpoch" | "commitSeq">,
): string | undefined => {
  if (!cursor) return undefined;
  if (!cursor.startsWith(SEARCH_CURSOR_PREFIX)) {
    throw new Error("Canonical Agent search cursor is invalid");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor.slice(SEARCH_CURSOR_PREFIX.length), "base64url").toString("utf8"));
  } catch {
    throw new Error("Canonical Agent search cursor is invalid");
  }
  const value = record(parsed);
  if (
    value?.version !== 1
    || value.query !== expected.query
    || value.target !== expected.target
    || value.storeEpoch !== snapshot.storeEpoch
    || value.commitSeq !== snapshot.commitSeq
    || typeof value.afterId !== "string"
  ) {
    throw new Error("Canonical Agent search cursor is stale");
  }
  return value.afterId;
};

const encodeCursor = (cursor: CanonicalSearchCursor): string => (
  `${SEARCH_CURSOR_PREFIX}${Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")}`
);

const readCanonicalSearchSnapshot = async (
  request: SearchRequest,
  runtime: RustDataAuthorityRuntime,
  authorization: AgentAuthorization,
): Promise<CanonicalSearchSnapshot> => {
  const client = runtime.clientForProject(request.projectId);
  const scope = request.input.scope;
  if (!scope || scope.kind === "library") {
    const read = {
      kind: "window" as const,
      parent: { kind: "library" as const },
      include_content: true,
      include_descendants: true,
      include_archived: request.input.includeArchived ?? false,
    };
    const snapshot = await client.blockRecordRead(read, authorization);
    return {
      window: blockRecordSnapshotToWindow(snapshot, read),
      storeEpoch: snapshot.observed_cursor.store_epoch,
      commitSeq: snapshot.observed_cursor.commit_seq,
    };
  }
  if (scope.kind === "page") {
    const read = {
      kind: "window" as const,
      block_ids: [scope.pageId],
      include_content: true,
      include_descendants: true,
      include_archived: request.input.includeArchived ?? false,
    };
    const snapshot = await client.blockRecordRead(read, authorization);
    return {
      window: blockRecordSnapshotToWindow(snapshot, read),
      storeEpoch: snapshot.observed_cursor.store_epoch,
      commitSeq: snapshot.observed_cursor.commit_seq,
    };
  }
  if (scope.kind === "data_source") {
    const read = {
      kind: "window" as const,
      parent: { kind: "data_source" as const, id: scope.dataSourceId },
      include_content: true,
      include_descendants: true,
      include_archived: request.input.includeArchived ?? false,
    };
    const snapshot = await client.blockRecordRead(read, authorization);
    return {
      window: blockRecordSnapshotToWindow(snapshot, read),
      storeEpoch: snapshot.observed_cursor.store_epoch,
      commitSeq: snapshot.observed_cursor.commit_seq,
    };
  }

  // Database is a metadata scope, not a Page-owned authority. Resolve its
  // canonical Data Sources through the Database module, then read each
  // authorized Data Source through BlockRecord. No Page Document/search FTS
  // data is used for the actual result set.
  const database = await client.databaseRead({
    target: { kind: "database", database_id: scope.databaseId },
    mode: "data_source_window",
    filter: null,
    sort: null,
    page_ids: null,
    window: { first: 200 },
  });
  if (database.value.kind !== "data_source_window") {
    throw new Error("Core returned the wrong Database scope variant");
  }
  const dataSourceIds = database.value.data_sources.items.flatMap((item) => {
    const value = record(item);
    return typeof value?.dataSourceId === "string" ? [value.dataSourceId] : [];
  });
  const snapshots: CanonicalSearchSnapshot[] = [];
  for (const dataSourceId of dataSourceIds) {
    const read = {
      kind: "window" as const,
      parent: { kind: "data_source" as const, id: dataSourceId },
      include_content: true,
      include_descendants: true,
      include_archived: request.input.includeArchived ?? false,
    };
    const snapshot = await client.blockRecordRead(read, authorization);
    snapshots.push({
      window: blockRecordSnapshotToWindow(snapshot, read),
      storeEpoch: snapshot.observed_cursor.store_epoch,
      commitSeq: snapshot.observed_cursor.commit_seq,
    });
  }
  const merged = snapshots.reduce<BlockRecordWindow>(
    (current, snapshot) => ({
      libraryId: current.libraryId || snapshot.window.libraryId,
      rootParent: current.rootParent,
      viewId: null,
      records: [...current.records, ...snapshot.window.records],
      placements: [...current.placements, ...snapshot.window.placements],
      viewPositions: [...current.viewPositions, ...snapshot.window.viewPositions],
      content: [...current.content, ...snapshot.window.content],
      observedLocalCommit: current.observedLocalCommit.commitSeq >= snapshot.commitSeq
        ? current.observedLocalCommit
        : { storeEpoch: snapshot.storeEpoch, commitSeq: snapshot.commitSeq },
      continuation: null,
    }),
    {
      libraryId: runtime.identity.libraryId,
      rootParent: { kind: "library", libraryId: runtime.identity.libraryId },
      viewId: null,
      records: [],
      placements: [],
      viewPositions: [],
      content: [],
      observedLocalCommit: {
        storeEpoch: runtime.rootClient.handshake.store_epoch,
        commitSeq: 0,
      },
      continuation: null,
    },
  );
  return {
    window: merged,
    storeEpoch: snapshots[0]?.storeEpoch ?? runtime.rootClient.handshake.store_epoch,
    commitSeq: snapshots.reduce((max, snapshot) => Math.max(max, snapshot.commitSeq), 0),
  };
};

const pageResults = (
  queryTerms: readonly string[],
  window: BlockRecordWindow,
  scope: SearchScope | undefined,
): readonly unknown[] => {
  const records = new Map(window.records.map((item) => [item.id, item]));
  const placements = new Map(window.placements.map((item) => [item.blockId, item]));
  const pages = window.records.filter((item) => (
    item.kind === "page"
    && (item.lifecycle === "active" || item.lifecycle === "archived")
    && scopeAllowsPage(item, scope, placements)
  ));
  return pages.flatMap((page) => {
    const title = pageTitle(page, window);
    const pageValues = valuesText(page);
    const descendants = window.records.filter((candidate) => (
      candidate.id !== page.id && ownerPageId(candidate.id, records, placements) === page.id
    ));
    const evidence = queryTerms.flatMap((term): readonly PageEvidence[] => {
      const titleQuality = qualityFor(title, term);
      if (titleQuality) {
        return [{ source: "title" as const, quality: titleQuality, excerpt: excerpt(title) }];
      }
      const property = pageValues.find((value) => qualityFor(value.value, term));
      if (property) {
        return [{
          source: "property" as const,
          quality: qualityFor(property.value, term)!,
          propertyId: property.propertyId,
          propertyName: property.propertyId,
          excerpt: excerpt(property.value),
        }];
      }
      const body = descendants
        .map((candidate) => ({ candidate, text: blockText(candidate, window) }))
        .find((candidate) => qualityFor(candidate.text, term));
      if (!body) return [];
      return [{
        source: "body" as const,
        quality: qualityFor(body.text, term)!,
        blockId: body.candidate.id,
        blockType: body.candidate.kind,
        excerpt: excerpt(body.text),
      }];
    });
    if (evidence.length !== queryTerms.length) return [];
    return [{
      kind: "page" as const,
      id: page.id,
      title,
      location: pageLocation(page, placements),
      matches: evidence.slice(0, 3),
    }];
  });
};

const blockResults = (
  queryTerms: readonly string[],
  window: BlockRecordWindow,
  scope: SearchScope | undefined,
  blockTypes: readonly string[] | undefined,
): readonly unknown[] => {
  const records = new Map(window.records.map((item) => [item.id, item]));
  const placements = new Map(window.placements.map((item) => [item.blockId, item]));
  return window.records.flatMap((block) => {
    if (block.kind === "page" || blockTypes && !blockTypes.includes(block.kind)) return [];
    const owner = ownerPageId(block.id, records, placements);
    if (!owner) return [];
    const page = records.get(owner);
    if (!page || !scopeAllowsPage(page, scope, placements)) return [];
    const text = blockText(block, window);
    const qualities = queryTerms.map((term) => qualityFor(text, term));
    if (qualities.some((quality) => quality === null || quality === "fuzzy")) return [];
    return [{
      kind: "block" as const,
      id: block.id,
      blockType: block.kind,
      ownerPageId: owner,
      source: "body" as const,
      quality: qualities.includes("exact") ? "exact" as const : "prefix" as const,
      excerpt: excerpt(text),
    }];
  });
};

export async function readNativeSearch(
  request: SearchRequest,
  runtime: RustDataAuthorityRuntime,
): Promise<NodexAgentV3ReadCommandResult> {
  if (!request.authority) {
    return {
      ok: false,
      error: {
        code: "authorization_denied",
        message: "Native Agent search requires exact Turn authority",
        retryable: false,
        recovery: "start_new_task",
      },
    };
  }
  try {
    const authorization = toCoreAgentExecutionAuthorization(
      runtime.identity.profileId,
      request.authority,
      request.callId ?? `nodex-agent:${request.tool}`,
      request.resourceAccess,
    );
    const snapshot = await readCanonicalSearchSnapshot(request, runtime, authorization);
    const queryTerms = words(request.input.query);
    const target = request.input.target ?? "pages";
    const afterId = decodeCursor(
      request.input.page?.cursor,
      { query: request.input.query, target },
      snapshot,
    );
    const results = target === "pages"
      ? pageResults(queryTerms, snapshot.window, request.input.scope)
      : blockResults(queryTerms, snapshot.window, request.input.scope, request.input.blockTypes);
    const sorted = [...results].sort((left, right) => {
      const leftId = record(left)?.id;
      const rightId = record(right)?.id;
      return typeof leftId === "string" && typeof rightId === "string"
        ? leftId.localeCompare(rightId)
        : 0;
    });
    const cursorIndex = afterId
      ? sorted.findIndex((result) => record(result)?.id === afterId)
      : -1;
    if (afterId && cursorIndex < 0) {
      throw new Error("Canonical Agent search cursor coordinate is unavailable");
    }
    const start = afterId ? cursorIndex + 1 : 0;
    const limit = request.input.page?.limit ?? 100;
    const page = sorted.slice(start, start + limit);
    const hasMore = start + limit < sorted.length;
    const lastId = record(page.at(-1))?.id;
    return {
      ok: true,
      tool: request.tool,
      output: SearchV3OutputSchema.parse({
        data: { results: page },
        page: {
          hasMore,
          ...(hasMore && typeof lastId === "string"
            ? {
                nextCursor: encodeCursor({
                  version: 1,
                  storeEpoch: snapshot.storeEpoch,
                  commitSeq: snapshot.commitSeq,
                  query: request.input.query,
                  target,
                  afterId: lastId,
                }),
              }
            : {}),
        },
      }),
    };
  } catch (error) {
    return { ok: false, error: mapNativeNodexAgentCoreError(error) };
  }
}
