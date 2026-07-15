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
import {
  assertResponseSize,
  mintCursor,
  mintRevision,
  NodexAgentReadError,
  nodexAgentFingerprint,
  readCursorState,
  readProjectChangeLogSeq,
  requireProject,
} from "./read-support";

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

export function readNodexAgentDatabaseQuery(
  database: Database.Database,
  projectId: string,
  input: QueryDatabaseInput,
): QueryDatabaseOutput {
  requireProject(database, projectId);
  const query = readQuery(database, projectId, input);
  const properties = selectedProperties(query.properties, input.select?.propertyIds);
  const propertyIds = new Set(properties.map((property) => property.id));
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
  const nextOffset = offset + pageRows.length;
  const hasMore = nextOffset < query.rows.length;

  const rawOutput = {
    schemaVersion: 1,
    data: {
      database: {
        databaseBlockId: query.database.blockId,
        name: query.database.name,
        schemaRevision: mintRevision(database, {
          kind: "database_schema",
          projectId,
          subject: [query.database.blockId],
          state: { revision: query.database.schemaRevision },
        }),
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
          revision: mintRevision(database, {
            kind: "view",
            projectId,
            subject: [query.view.id],
            state: {
              databaseBlockId: query.database.blockId,
              revision: query.view.revision,
            },
          }),
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
          locationRevision: mintRevision(database, {
            kind: "location",
            projectId,
            subject: [row.card.blockId],
            state: {
              revision: row.card.locationRevision,
              locationKind: row.card.location.kind,
              containingDocumentId: row.card.location.kind === "document"
                ? row.card.location.documentId
                : null,
              containingDatabaseId: row.card.location.kind === "database"
                ? row.card.location.databaseBlockId
                : null,
            },
          }),
          values: Object.fromEntries(Object.entries(row.values)
            .filter(([propertyId]) => propertyIds.has(propertyId))
            .map(([propertyId, value]) => [propertyId, {
              value: value.value,
              revision: mintRevision(database, {
                kind: "database_value",
                projectId,
                subject: [query.database.blockId, row.card.blockId, propertyId],
                state: {
                  membershipId: row.membership.id,
                  membershipRevision: row.membership.revision,
                  propertySchemaRevision:
                    query.properties.find((property) => property.id === propertyId)?.revision ?? 0,
                  valueRevision: value.revision,
                },
              }),
            }])),
          ...(query.view && row.position ? {
            placement: {
              viewId: query.view.id,
              groupKey: row.position.groupKey,
              revision: mintRevision(database, {
                kind: "view_placement",
                projectId,
                subject: [query.view.id, row.card.blockId],
                state: {
                  databaseBlockId: query.database.blockId,
                  viewRevision: query.view.revision,
                  membershipId: row.membership.id,
                  membershipRevision: row.membership.revision,
                  positionRevision: row.position.revision,
                  groupPropertyId: groupPropertyId ?? null,
                  groupValueRevision,
                  groupKey: row.position.groupKey,
                },
              }),
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
