import {
  DATABASE_MODULE_V2_CONTRACT_VERSION,
  type DatabaseContainerDescriptorV2,
  type DataSourceDescriptorV2,
  type DatabaseViewRecordV2,
} from "../../shared/database-module-v2";
import type {
  DatabaseJsonValue,
  DatabaseViewFilterNode,
  DatabaseViewSort,
} from "../../shared/database-kernel";
import {
  evaluateDatabaseViewFilter,
  stableStringifyDatabaseJson,
} from "../../shared/database-kernel";
import {
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
} from "../../shared/database-identities";
import type {
  NodexAgentV3ReadCommandResult,
  NodexAgentV3ReadRequest,
} from "../../shared/nodex-agent-tools";
import { QueryDatabaseV3OutputSchema } from "../../shared/nodex-agent-tools/v3-read-schemas";
import type { RustDataAuthorityRuntime } from "./desktop-data-authority";
import { toCoreAgentExecutionAuthorization } from "./desktop-nodex-agent-resource-authority";
import { mapNativeNodexAgentCoreError } from "./native-nodex-agent-page-update";
import { createCoreDatabaseModuleAdapter } from "./database-module-adapter";
import {
  blockRecordSnapshotToWindow,
  type BlockRecord,
  type BlockRecordWindow,
} from "../../shared/block-records";

type QueryRequest = Extract<NodexAgentV3ReadRequest, {
  readonly tool: "query_database_view" | "query_data_source";
}>;

interface CanonicalDatabaseCursor {
  readonly version: 1;
  readonly storeEpoch: string;
  readonly commitSeq: number;
  readonly query: string;
  readonly afterId: string;
}

const CANONICAL_DATABASE_CURSOR_PREFIX = "nxc1.database.";

const objectRecord = (value: unknown): Readonly<Record<string, unknown>> | null => (
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
  const object = objectRecord(value);
  if (!object) return output;
  if (typeof object.text === "string") output.push(object.text);
  if (typeof object.content === "string") output.push(object.content);
  Object.entries(object).forEach(([key, entry]) => {
    if (key !== "text" && key !== "content") textParts(entry, output);
  });
  return output;
};

const pageTitle = (page: BlockRecord, window: BlockRecordWindow): string => {
  if (typeof page.properties.title === "string" && page.properties.title.trim()) {
    return page.properties.title;
  }
  const title = window.content.find((entry) => (
    entry.blockId === page.id && entry.slot === "title"
  ));
  return textParts(title?.content).join(" ").trim() || page.id;
};

const ownerPageId = (
  blockId: string,
  records: ReadonlyMap<string, BlockRecord>,
  placements: ReadonlyMap<string, BlockRecordWindow["placements"][number]>,
): string | null => {
  const visited = new Set<string>();
  let current = blockId;
  while (visited.add(current)) {
    const record = records.get(current);
    if (!record) return null;
    if (record.kind === "page") return current;
    const placement = placements.get(current);
    if (!placement || placement.parent.kind !== "block") return null;
    current = placement.parent.blockId;
  }
  return null;
};

const dataSourceValues = (
  page: BlockRecord,
): ReadonlyMap<string, DatabaseJsonValue> => {
  const raw = page.properties.dataSourceValues;
  if (!Array.isArray(raw)) return new Map();
  return new Map(raw.flatMap((entry) => {
    const value = objectRecord(entry);
    if (typeof value?.propertyId !== "string" || !("value" in value)) return [];
    return [[value.propertyId, value.value as DatabaseJsonValue] as const];
  }));
};

const pageBodyPreview = (
  pageId: string,
  records: ReadonlyMap<string, BlockRecord>,
  placements: ReadonlyMap<string, BlockRecordWindow["placements"][number]>,
  content: BlockRecordWindow["content"],
): string => content
  .filter((entry) => (
    entry.slot !== "title"
    && ownerPageId(entry.blockId, records, placements) === pageId
  ))
  .flatMap((entry) => textParts(entry.content))
  .join(" ")
  .trim();

const compareDatabaseValues = (
  left: DatabaseJsonValue | undefined,
  right: DatabaseJsonValue | undefined,
): number => {
  const leftEmpty = left === undefined || left === null || left === "";
  const rightEmpty = right === undefined || right === null || right === "";
  if (leftEmpty && rightEmpty) return 0;
  if (leftEmpty) return -1;
  if (rightEmpty) return 1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "boolean" && typeof right === "boolean") {
    return Number(left) - Number(right);
  }
  return stableStringifyDatabaseJson(left).localeCompare(
    stableStringifyDatabaseJson(right),
  );
};

const sortCanonicalPages = (
  pages: readonly BlockRecord[],
  sort: readonly DatabaseViewSort[],
  valuesByPage: ReadonlyMap<string, ReadonlyMap<string, DatabaseJsonValue>>,
  positions: ReadonlyMap<string, BlockRecordWindow["viewPositions"][number]>,
): readonly BlockRecord[] => [...pages].sort((left, right) => {
  for (const rule of sort) {
    const leftValues = valuesByPage.get(left.id);
    const rightValues = valuesByPage.get(right.id);
    const leftValue = rule.field.kind === "title"
      ? left.properties.title as DatabaseJsonValue | undefined
      : rule.field.kind === "created"
        ? left.id
        : rule.field.kind === "property"
          ? leftValues?.get(rule.field.propertyId)
          : positions.get(left.id)?.rankKey;
    const rightValue = rule.field.kind === "title"
      ? right.properties.title as DatabaseJsonValue | undefined
      : rule.field.kind === "created"
        ? right.id
        : rule.field.kind === "property"
          ? rightValues?.get(rule.field.propertyId)
          : positions.get(right.id)?.rankKey;
    const leftEmpty = leftValue === undefined || leftValue === null || leftValue === "";
    const rightEmpty = rightValue === undefined || rightValue === null || rightValue === "";
    if (leftEmpty !== rightEmpty) {
      const emptyOrder = rule.nulls === "first" ? -1 : 1;
      return leftEmpty ? emptyOrder : -emptyOrder;
    }
    const compared = compareDatabaseValues(leftValue, rightValue);
    if (compared !== 0) return rule.direction === "asc" ? compared : -compared;
  }
  return (positions.get(left.id)?.rankKey ?? "").localeCompare(
    positions.get(right.id)?.rankKey ?? "",
  ) || left.id.localeCompare(right.id);
});

const decodeCanonicalDatabaseCursor = (
  cursor: string | undefined,
  expected: Pick<CanonicalDatabaseCursor, "query">,
  snapshot: Pick<CanonicalDatabaseCursor, "storeEpoch" | "commitSeq">,
): string | undefined => {
  if (!cursor) return undefined;
  if (!cursor.startsWith(CANONICAL_DATABASE_CURSOR_PREFIX)) {
    throw new Error("Canonical Agent Database cursor is invalid");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(
      cursor.slice(CANONICAL_DATABASE_CURSOR_PREFIX.length),
      "base64url",
    ).toString("utf8"));
  } catch {
    throw new Error("Canonical Agent Database cursor is invalid");
  }
  const value = objectRecord(parsed);
  if (
    value?.version !== 1
    || value.query !== expected.query
    || value.storeEpoch !== snapshot.storeEpoch
    || value.commitSeq !== snapshot.commitSeq
    || typeof value.afterId !== "string"
  ) {
    throw new Error("Canonical Agent Database cursor is stale");
  }
  return value.afterId;
};

const encodeCanonicalDatabaseCursor = (
  cursor: CanonicalDatabaseCursor,
): string => `${CANONICAL_DATABASE_CURSOR_PREFIX}${Buffer.from(
  JSON.stringify(cursor),
  "utf8",
).toString("base64url")}`;

const projectCanonicalDatabaseQuery = (
  request: QueryRequest,
  window: BlockRecordWindow,
  database: DatabaseContainerDescriptorV2,
  source: DataSourceDescriptorV2,
  view: DatabaseViewRecordV2,
) => {
  const records = new Map(window.records.map((record) => [record.id, record]));
  const placements = new Map(window.placements.map((placement) => [placement.blockId, placement]));
  const positions = new Map(
    window.viewPositions
      .filter((position) => position.viewId === view.viewId)
      .map((position) => [position.blockId, position]),
  );
  const pages = window.records.filter((record) => {
    const placement = placements.get(record.id);
    return record.kind === "page"
      && (record.lifecycle === "active" || record.lifecycle === "archived")
      && placement?.parent.kind === "dataSource"
      && placement.parent.dataSourceId === source.dataSource.dataSourceId;
  });
  const valuesByPage = new Map(pages.map((page) => [page.id, dataSourceValues(page)]));
  const filter: DatabaseViewFilterNode = request.tool === "query_data_source"
    ? request.input.filter ?? view.config.filter
    : view.config.filter;
  const sort: readonly DatabaseViewSort[] = request.tool === "query_data_source"
    ? request.input.sort ?? view.config.sort
    : view.config.sort;
  const filtered = pages.filter((page) => evaluateDatabaseViewFilter(
    filter,
    (propertyId) => valuesByPage.get(page.id)?.get(propertyId),
  ));
  const sorted = sortCanonicalPages(filtered, sort, valuesByPage, positions);
  const query = stableStringifyDatabaseJson({
    tool: request.tool,
    dataSourceId: source.dataSource.dataSourceId,
    viewId: view.viewId,
    filter,
    sort,
    select: request.input.select ?? null,
  });
  const afterId = decodeCanonicalDatabaseCursor(
    request.input.page?.cursor,
    { query },
    {
      storeEpoch: window.observedLocalCommit.storeEpoch,
      commitSeq: window.observedLocalCommit.commitSeq,
    },
  );
  const cursorIndex = afterId
    ? sorted.findIndex((page) => page.id === afterId)
    : -1;
  if (afterId && cursorIndex < 0) {
    throw new Error("Canonical Agent Database cursor coordinate is unavailable");
  }
  const start = afterId ? cursorIndex + 1 : 0;
  const limit = request.input.page?.limit ?? 200;
  const pageRows = sorted.slice(start, start + limit);
  const hasMore = start + limit < sorted.length;
  const selectedPropertyIds = request.input.select?.propertyIds;
  const activeProperties = source.properties.filter((property) => property.lifecycle === "active");
  const selectedProperties = selectedPropertyIds === undefined
    ? activeProperties
    : selectedPropertyIds.map((propertyId) => {
        const property = activeProperties.find((candidate) => (
          String(candidate.propertyId) === propertyId
        ));
        if (!property) throw new Error(`Data Source property ${propertyId} was not found`);
        return property;
      });
  const selected = new Set(selectedProperties.map((property) => property.propertyId));
  const data = {
    database: {
      databaseId: database.database.databaseId,
      name: database.database.name,
    },
    dataSource: {
      dataSourceId: source.dataSource.dataSourceId,
      name: source.dataSource.name,
      properties: selectedProperties.map((property) => ({
        propertyId: property.propertyId,
        name: property.name,
        valueType: property.valueType,
        config: property.config,
      })),
    },
    ...(request.tool === "query_database_view"
      ? {
          view: {
            viewId: view.viewId,
            dataSourceId: view.dataSourceId,
            name: view.name,
            kind: view.kind,
          },
        }
      : {}),
    rows: pageRows.map((page) => {
      const values = valuesByPage.get(page.id) ?? new Map();
      const position = positions.get(page.id);
      const body = pageBodyPreview(page.id, records, placements, window.content);
      return {
        pageId: page.id,
        title: pageTitle(page, window),
        values: Object.fromEntries(
          [...values.entries()]
            .filter(([propertyId]) => selected.has(propertyId))
            .map(([propertyId, value]) => [propertyId, value]),
        ),
        ...(request.tool === "query_database_view" && position
          ? {
              placement: {
                viewId: view.viewId,
                groupKey: position.groupKey,
              },
            }
          : {}),
        ...(request.input.select?.documentSummary
          ? { documentSummary: body }
          : {}),
      };
    }),
  };
  const lastId = pageRows.at(-1)?.id;
  return {
    data,
    page: {
      hasMore,
      ...(hasMore && lastId
        ? {
            nextCursor: encodeCanonicalDatabaseCursor({
              version: 1,
              storeEpoch: window.observedLocalCommit.storeEpoch,
              commitSeq: window.observedLocalCommit.commitSeq,
              query,
              afterId: lastId,
            }),
          }
        : {}),
    },
  };
};

export async function readNativeDatabaseQuery(
  request: QueryRequest,
  runtime: RustDataAuthorityRuntime,
): Promise<NodexAgentV3ReadCommandResult> {
  if (!request.authority) {
    return {
      ok: false,
      error: {
        code: "authorization_denied",
        message: "Native Agent Database query requires exact Turn authority",
        retryable: false,
        recovery: "start_new_task",
      },
    };
  }
  try {
    const authority = request.authority;
    const client = runtime.clientForProject(request.projectId);
    const authorization = toCoreAgentExecutionAuthorization(
      runtime.identity.profileId,
      authority,
      request.callId ?? `nodex-agent:${request.tool}`,
      request.resourceAccess,
    );
    const agentQuery = {
      authorization,
      // This read is only the canonical Database-module resolver and
      // authorization boundary. The result rows come from BlockRecord below,
      // so a Database-module cursor must never become the renderer/Agent
      // cursor coordinate.
      cursor: null,
      limit: 1,
    };
    const snapshot = await client.databaseRead({
      target: request.tool === "query_database_view"
        ? {
            kind: "agent_view",
            view_id: request.input.viewId,
            query: agentQuery,
          }
        : {
            kind: "agent_data_source",
            data_source_id: request.input.dataSourceId,
            query: agentQuery,
          },
      mode: "agent_query",
      filter: request.tool === "query_data_source"
        ? request.input.filter ?? null
        : null,
      sort: request.tool === "query_data_source"
        ? request.input.sort ?? null
        : null,
    });
    if (snapshot.value.kind !== "agent_query") {
      throw new Error("Core returned the wrong Agent Database query variant");
    }
    const agentWindow = snapshot.value.value;
    const descriptorAdapter = createCoreDatabaseModuleAdapter({
      client,
      projectId: request.projectId,
      libraryId: authority.libraryId,
      storeEpoch: snapshot.store_epoch,
    });
    const descriptors = await Promise.all([
      descriptorAdapter.read({
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
        projectId: request.projectId,
        read: {
          target: {
            kind: "database",
            databaseId: parseDatabaseId(agentWindow.database_id),
          },
          mode: "database",
        },
      }),
      descriptorAdapter.read({
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
        projectId: request.projectId,
        read: {
          target: {
            kind: "data_source",
            dataSourceId: parseDataSourceId(agentWindow.data_source_id),
          },
          mode: "data_source",
        },
      }),
      descriptorAdapter.read({
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
        projectId: request.projectId,
        read: {
          target: {
            kind: "view",
            viewId: parseDatabaseViewId(agentWindow.view_id),
          },
          mode: "view",
        },
      }),
    ]);
    const [databaseResult, sourceResult, viewResult] = descriptors;
    if (
      !databaseResult?.ok
      || databaseResult.value.value.kind !== "database"
      || !sourceResult?.ok
      || sourceResult.value.value.kind !== "data_source"
      || !viewResult?.ok
      || viewResult.value.value.kind !== "view"
    ) {
      throw new Error("Core returned an incompatible Agent Database descriptor");
    }
    const read = {
      kind: "window" as const,
      parent: { kind: "data_source" as const, id: agentWindow.data_source_id },
      view_id: agentWindow.view_id,
      include_content: true,
      include_descendants: true,
      include_archived: false,
    };
    const canonicalSnapshot = await client.blockRecordRead(read, authorization);
    const canonicalWindow = blockRecordSnapshotToWindow(canonicalSnapshot, read);
    const output = projectCanonicalDatabaseQuery(
      request,
      canonicalWindow,
      databaseResult.value.value.value,
      sourceResult.value.value.value,
      viewResult.value.value.value,
    );
    return {
      ok: true,
      tool: request.tool,
      output: QueryDatabaseV3OutputSchema.parse(output),
    };
  } catch (error) {
    return { ok: false, error: mapNativeNodexAgentCoreError(error) };
  }
}
