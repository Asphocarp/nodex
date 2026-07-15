import type Database from "better-sqlite3";
import type {
  GeneralDatabaseAdHocQuery,
  GeneralDatabasePropertyDefinition,
  GeneralDatabaseRow,
  GeneralDatabaseViewDefinition,
  GeneralDatabaseViewQuery,
} from "../../shared/database-query";
import {
  QueryDatabaseOutputSchema,
  type JsonValue,
  type QueryDatabaseInput,
  type QueryDatabaseOutput,
} from "../../shared/nodex-agent-tools";
import {
  queryGeneralDatabaseAdHoc,
  queryGeneralDatabaseView,
} from "../local-store/database-query";
import { mintNodexAgentEtag } from "../local-store/nodex-agent-etag";
import {
  assertResponseSize,
  mintCursor,
  NodexAgentReadError,
  nodexAgentFingerprint,
  readCursorState,
  readProjectChangeLogSeq,
  requireProject,
} from "./read-support";
import {
  databaseValueEtagState,
  viewPlacementEtagState,
} from "./semantic-guards";

interface DatabaseQuerySnapshot {
  readonly database: GeneralDatabaseViewQuery["database"];
  readonly properties: readonly GeneralDatabasePropertyDefinition[];
  readonly rows: readonly GeneralDatabaseRow[];
  readonly view?: GeneralDatabaseViewDefinition;
}

function readQuery(
  database: Database.Database,
  projectId: string,
  input: QueryDatabaseInput,
): DatabaseQuerySnapshot {
  if (input.source.kind === "view") {
    const query = queryGeneralDatabaseView(projectId, input.source.viewId, database);
    if (query) return query;
    throw new NodexAgentReadError(
      "not_found",
      `Database View ${input.source.viewId} was not found in the bound Project`,
      false,
      "none",
      { resourceId: input.source.viewId, domainCode: "view_not_found" },
    );
  }
  const query: GeneralDatabaseAdHocQuery | null = queryGeneralDatabaseAdHoc(
    projectId,
    {
      databaseBlockId: input.source.databaseBlockId,
      ...(input.source.filter ? { filter: input.source.filter } : {}),
      ...(input.source.sort ? { sort: input.source.sort } : {}),
    },
    database,
  );
  if (query) return query;
  throw new NodexAgentReadError(
    "not_found",
    `Database ${input.source.databaseBlockId} was not found in the bound Project`,
    false,
    "none",
    { resourceId: input.source.databaseBlockId, domainCode: "database_not_found" },
  );
}

function selectedProperties(
  properties: readonly GeneralDatabasePropertyDefinition[],
  propertyIds: readonly string[] | undefined,
): readonly GeneralDatabasePropertyDefinition[] {
  const active = properties.filter((property) => property.lifecycle === "active");
  if (!propertyIds) return active;
  const byId = new Map(active.map((property) => [property.id, property] as const));
  const missing = propertyIds.find((propertyId) => !byId.has(propertyId));
  if (missing) {
    throw new NodexAgentReadError(
      "not_found",
      `Database property ${missing} was not found`,
      false,
      "none",
      { resourceId: missing, domainCode: "property_not_found" },
    );
  }
  return propertyIds.map((propertyId) => byId.get(propertyId) as GeneralDatabasePropertyDefinition);
}

function preparedValuePropertyIds(input: QueryDatabaseInput): ReadonlySet<string> {
  return new Set(
    (input.prepareFor ?? []).flatMap((preparation) =>
      preparation.kind === "value.set" ? preparation.propertyIds : []),
  );
}

function readNextPlacementIds(
  database: Database.Database,
  input: {
    readonly projectId: string;
    readonly viewId: string;
  },
): ReadonlyMap<string, string | null> {
  const rows = database.prepare(
    `
    SELECT block_id, group_key
    FROM database_view_positions
    WHERE project_id = ? AND view_id = ?
    ORDER BY group_key, rank_key, block_id
  `).all(input.projectId, input.viewId) as readonly {
    readonly block_id: string;
    readonly group_key: string | null;
  }[];
  return new Map(rows.map((row, index) => {
    const next = rows[index + 1];
    return [
      row.block_id,
      next?.group_key === row.group_key ? next.block_id : null,
    ] as const;
  }));
}

export function readNodexAgentDatabaseQuery(
  database: Database.Database,
  projectId: string,
  input: QueryDatabaseInput,
): QueryDatabaseOutput {
  requireProject(database, projectId);
  const query = readQuery(database, projectId, input);
  const properties = selectedProperties(query.properties, input.select?.propertyIds);
  const propertyIds = new Set(properties.map((property) => property.id));
  const preparedPropertyIds = preparedValuePropertyIds(input);
  const unselectedPreparedProperty = [...preparedPropertyIds].find(
    (propertyId) => !propertyIds.has(propertyId),
  );
  if (unselectedPreparedProperty) {
    throw new NodexAgentReadError(
      "invalid_arguments",
      `Prepared property ${unselectedPreparedProperty} is not selected for return`,
      false,
      "none",
      { resourceId: unselectedPreparedProperty, domainCode: "prepared_property_not_returned" },
    );
  }
  const preparesPlacement = input.prepareFor?.some(
    (preparation) => preparation.kind === "view.place",
  ) === true;
  if (preparesPlacement && !query.view) {
    throw new NodexAgentReadError(
      "invalid_arguments",
      "View placement preparation requires a View query source",
      false,
      "none",
      { resourceId: query.database.blockId, domainCode: "view_source_required" },
    );
  }
  const nextPlacementIds = preparesPlacement && query.view
    ? readNextPlacementIds(database, { projectId, viewId: query.view.id })
    : new Map<string, string | null>();
  const changeLogSeq = readProjectChangeLogSeq(database, projectId);
  const fingerprint = nodexAgentFingerprint({
    source: input.source,
    select: input.select ?? {},
  });
  const cursorState = {
    fingerprint,
    changeLogSeq,
    databaseBlockId: query.database.blockId,
    schemaRevision: query.database.schemaRevision,
    ...(query.view ? { viewId: query.view.id, viewRevision: query.view.revision } : {}),
  } satisfies Readonly<Record<string, JsonValue>>;
  const { offset } = readCursorState(database, {
    token: input.page?.cursor,
    projectId,
    subject: ["query_database", query.database.blockId],
    expected: cursorState,
    recovery: "query_database_again",
  });
  const limit = input.page?.limit ?? 50;
  const pageRows = query.rows.slice(offset, offset + limit);
  const missingPreparedPlacement = preparesPlacement
    ? pageRows.find((row) => row.position === null)
    : undefined;
  if (missingPreparedPlacement) {
    throw new NodexAgentReadError(
      "projection_not_ready",
      `Block ${missingPreparedPlacement.card.blockId} has no current View placement`,
      true,
      "query_database_again",
      {
        resourceId: missingPreparedPlacement.card.blockId,
        domainCode: "view_position_not_found",
      },
    );
  }
  const nextOffset = offset + pageRows.length;
  const hasMore = nextOffset < query.rows.length;

  const rawOutput = {
    data: {
      database: {
        databaseBlockId: query.database.blockId,
        name: query.database.name,
        properties: properties.map((property) => ({
          propertyId: property.id,
          name: property.name,
          valueType: property.valueType,
          config: property.config,
        })),
      },
      ...(query.view ? {
        view: {
          viewId: query.view.id,
          name: query.view.name,
          kind: query.view.kind,
        },
      } : {}),
      rows: pageRows.map((row) => {
        const groupPropertyId = query.view?.config.group?.propertyId;
        const groupValueRevision = groupPropertyId
          ? row.values[groupPropertyId]?.revision ?? 0
          : 0;
        return {
          blockId: row.card.blockId,
          title: row.card.content?.title ?? "",
          values: Object.fromEntries(Object.entries(row.values)
            .filter(([propertyId]) => propertyIds.has(propertyId))
            .map(([propertyId, value]) => [propertyId, {
              value: value.value,
              ...(preparedPropertyIds.has(propertyId) ? {
                etag: mintNodexAgentEtag(database, databaseValueEtagState({
                  projectId,
                  databaseBlockId: query.database.blockId,
                  blockId: row.card.blockId,
                  propertyId,
                  value: value.value as JsonValue,
                  membershipId: row.membership.id,
                  membershipRevision: row.membership.revision,
                  propertySchemaRevision:
                    query.properties.find((property) => property.id === propertyId)?.revision ?? 0,
                  valueRevision: value.revision,
                })),
              } : {}),
            }])),
          ...(query.view && row.position ? {
            placement: {
              viewId: query.view.id,
              groupKey: row.position.groupKey,
              ...(preparesPlacement ? {
                etag: mintNodexAgentEtag(database, viewPlacementEtagState({
                  projectId,
                  databaseBlockId: query.database.blockId,
                  viewId: query.view.id,
                  blockId: row.card.blockId,
                  groupKey: row.position.groupKey,
                  beforeBlockId: nextPlacementIds.get(row.card.blockId) ?? null,
                  membershipId: row.membership.id,
                  membershipRevision: row.membership.revision,
                  viewRevision: query.view.revision,
                  positionRevision: row.position.revision,
                  groupValueRevision,
                })),
              } : {}),
            },
          } : {}),
          ...(input.select?.documentSummary && row.card.content
            ? { documentSummary: row.card.content.preview }
            : {}),
        };
      }),
    },
    page: {
      hasMore,
      ...(hasMore ? {
        nextCursor: mintCursor(database, {
          projectId,
          subject: ["query_database", query.database.blockId],
          offset: nextOffset,
          state: cursorState,
        }),
      } : {}),
    },
  };
  assertResponseSize(rawOutput);
  return QueryDatabaseOutputSchema.parse(rawOutput);
}
