import type Database from "better-sqlite3";
import {
  canonicalizePortableRichText,
  plainTextToPortableRichText,
} from "../../shared/block-documents/portable-rich-text";
import {
  NESTED_MARKDOWN_AGENT_GUIDE,
} from "../../shared/nfm/agent-guide";
import { serializeInlineMarkdownTitle } from "../../shared/nfm/agent-title";
import type {
  GetBlockInput,
} from "../../shared/nodex-agent-tools";
import type {
  NodexAgentV3ReadCommandResult,
  NodexAgentV3ReadRequest,
} from "../../shared/nodex-agent-tools/v3-read-runtime";
import {
  FetchV3OutputSchema,
  GetContextV3OutputSchema,
  QueryDatabaseV3OutputSchema,
  SearchV3OutputSchema,
} from "../../shared/nodex-agent-tools/v3-read-schemas";
import {
  DATABASE_MODULE_V2_CONTRACT_VERSION,
  type DatabaseViewQueryResultV2,
  type DataSourceQueryResultV2,
} from "../../shared/database-module-v2";
import {
  parseDatabaseViewId,
  parseDataSourceId,
  parseDataSourcePropertyId,
} from "../../shared/database-identities";
import { readDatabaseModuleV2 } from "../local-store/database-module-v2-runtime";
import {
  authorizeNodexAgentResourceInDatabase,
  authorizeProjectResourceInDatabase,
} from "../local-store/project-resource-grants";
import { readNodexAgentBlock } from "./read-block";
import {
  readNodexAgentSearch,
  type PageSearchInput,
} from "./read-search";
import {
  assertResponseSize,
  mintCursor,
  NodexAgentReadError,
  nodexAgentFingerprint,
  readCursorState,
  readFailure,
} from "./read-support";
import {
  readPageLocation,
  requirePageStorageContext,
} from "./page-adapter";

function readContextV3(
  database: Database.Database,
  request: Extract<NodexAgentV3ReadRequest, { readonly tool: "get_context" }>,
) {
  if (!request.projectId) {
    return GetContextV3OutputSchema.parse({
      data: {
        project: null,
        access: {
          read: request.access.read,
          write: request.access.write,
          domains: request.access.read === "allowed" ? ["page", "database"] : [],
        },
        ...(request.input.include?.markdownGuide
          ? { markdownGuide: NESTED_MARKDOWN_AGENT_GUIDE }
          : {}),
      },
    });
  }
  const project = database.prepare(`
    SELECT id AS projectId, name, lifecycle,
      library_id AS libraryId, database_block_id AS boundDatabaseId
    FROM projects WHERE id = ?
  `).get(request.projectId) as {
    readonly projectId: string;
    readonly name: string;
    readonly lifecycle: "active" | "inactive" | "archived";
    readonly libraryId: string;
    readonly boundDatabaseId: string;
  } | undefined;
  if (!project) {
    throw new NodexAgentReadError(
      "not_found",
      `Project ${request.projectId} was not found`,
      false,
      "start_new_task",
    );
  }
  const catalog = request.input.include?.databases
    ? readDatabaseModuleV2(database, {
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
        projectId: request.projectId,
      read: { target: { kind: "project_default" }, mode: "catalog" },
      }, request.authority ? {
        authority: request.authority,
        ...(request.resourceAccess
          ? { resourceAccess: request.resourceAccess }
          : {}),
        callId: request.callId,
      } : undefined)
    : null;
  if (catalog && !catalog.ok) {
    throw new NodexAgentReadError(
      catalog.error.code === "authorization_denied" ? "authorization_denied" : "not_found",
      catalog.error.message,
      false,
      "none",
    );
  }
  const databases = catalog?.ok && catalog.value.value.kind === "catalog"
    ? catalog.value.value.databases.map((descriptor) => ({
        databaseId: descriptor.database.databaseId,
        name: descriptor.database.name,
        isBound: descriptor.database.databaseId === project.boundDatabaseId,
        dataSources: descriptor.dataSources
          .filter((source) => source.lifecycle === "active")
          .map((source) => ({
            dataSourceId: source.dataSourceId,
            name: source.name,
            schemaRevision: source.schemaRevision,
          })),
        views: descriptor.views
          .filter((view) => view.lifecycle === "active")
          .map((view) => ({
            viewId: view.viewId,
            dataSourceId: view.dataSourceId,
            name: view.name,
            kind: view.kind,
            isDefault: view.isDefault,
          })),
      }))
    : undefined;
  return GetContextV3OutputSchema.parse({
    data: {
      project,
      access: {
        read: request.access.read,
        write: project.lifecycle === "active"
          ? request.access.write
          : "unavailable",
        domains: request.access.read === "allowed" ? ["page", "database"] : [],
      },
      ...(databases ? { databases } : {}),
      ...(request.input.include?.markdownGuide
        ? { markdownGuide: NESTED_MARKDOWN_AGENT_GUIDE }
        : {}),
    },
  });
}

function titleMarkdown(
  title: { readonly kind: "plain"; readonly text: string }
    | { readonly kind: "rich"; readonly richText: unknown },
): string {
  const richTitle = title.kind === "plain"
    ? plainTextToPortableRichText(title.text)
    : canonicalizePortableRichText(title.richText);
  return serializeInlineMarkdownTitle(richTitle);
}

function readFetchV3(
  database: Database.Database,
  request: Extract<NodexAgentV3ReadRequest, { readonly tool: "fetch" }>,
) {
  const format = request.input.format ?? "markdown";
  const legacyFormat = format === "markdown" ? "nfm" : format;
  const prepareFor: GetBlockInput["prepareFor"] = request.input.prepareFor?.map((entry) => {
    if (entry.kind === "title") return { kind: "title.set" as const };
    if (entry.kind === "body") return { kind: "document.replace" as const };
    return {
      kind: entry.kind === "block_update" ? "block.update" as const : "block.delete" as const,
      blockIds: entry.blockIds,
    };
  });
  const owner = database.prepare(`
    SELECT page.block_id AS pageId
    FROM pages page
    WHERE page.block_id = ?
    UNION ALL
    SELECT ownership.block_id AS pageId
    FROM blocks block
    INNER JOIN block_documents ownership
      ON ownership.document_id = block.containing_document_id
    WHERE block.id = ? AND block.location_kind = 'document'
    LIMIT 1
  `).get(request.input.id, request.input.id) as { readonly pageId: string } | undefined;
  if (!owner) {
    throw new NodexAgentReadError(
      "not_found",
      `Page or Block ${request.input.id} was not found`,
      false,
      "none",
    );
  }
  const page = requirePageStorageContext(
    database,
    request.projectId,
    owner.pageId,
    "read",
    request.authority,
    request.resourceAccess,
    request.callId,
  );
  const legacy = readNodexAgentBlock(database, page.contentProjectId, {
    blockId: request.input.id,
    include: {
      ...(request.input.propertyIds
        ? { properties: { propertyIds: request.input.propertyIds } }
        : {}),
      ...(request.input.includeDataSource !== false ? { database: true } : {}),
      document: {
        format: legacyFormat,
        ...(format === "blocks" && request.input.maxDepth !== undefined
          ? { maxDepth: request.input.maxDepth }
          : {}),
      },
    },
    ...(prepareFor ? { prepareFor } : {}),
    ...(request.input.page ? { page: request.input.page } : {}),
  });
  const legacyContent = legacy.data.document?.body;
  const content = legacyContent?.format === "nfm"
    ? {
        format: "markdown" as const,
        markdown: legacyContent.content,
        contentHash: legacyContent.contentHash,
        ...(legacyContent.etag ? { etag: legacyContent.etag } : {}),
      }
    : legacyContent?.format === "blocks"
      ? {
          format: "blocks" as const,
          blocks: legacyContent.blocks.map((block) => ({
            id: block.blockId,
            parentId: block.parentBlockId,
            index: block.siblingIndex,
            depth: block.depth,
            type: block.type,
            props: block.props,
            ...(block.content !== undefined ? { content: block.content } : {}),
            ...(block.etag ? { etag: block.etag } : {}),
          })),
        }
      : legacyContent;
  const legacyTitle = legacy.data.block.title;
  return FetchV3OutputSchema.parse({
    data: {
      resource: {
        id: legacy.data.block.blockId,
        type: legacy.data.block.type,
        ...(legacyTitle ? {
          title: {
            markdown: titleMarkdown(legacyTitle.value),
            ...(legacyTitle.etag ? { etag: legacyTitle.etag } : {}),
          },
        } : {}),
        lifecycle: legacy.data.block.lifecycle,
        location: legacy.data.block.blockId === owner.pageId
          ? readPageLocation(
              database,
              request.projectId,
              owner.pageId,
              request.authority,
              request.resourceAccess,
              request.callId,
            )
          : { kind: "page", pageId: owner.pageId },
        ...(legacy.data.block.properties ? {
          properties: Object.fromEntries(Object.entries(legacy.data.block.properties).map(
            ([propertyId, value]) => [propertyId, { value: value.value }],
          )),
        } : {}),
      },
      ...(content ? { content } : {}),
      ...(request.input.includeDataSource !== false
        ? (() => {
            const membership = database.prepare(`
              SELECT source.id AS dataSourceId,
                source.home_database_block_id AS databaseId
              FROM pages page
              INNER JOIN data_sources source
                ON page.parent_kind = 'data_source'
                AND source.id = page.parent_id
              WHERE page.block_id = ?
            `).get(owner.pageId) as {
              readonly dataSourceId: string;
              readonly databaseId: string;
            } | undefined;
            return membership ? { dataSource: membership } : {};
          })()
        : {}),
    },
    ...(legacy.page ? { page: legacy.page } : {}),
  });
}

type SearchRequest = Extract<NodexAgentV3ReadRequest, { readonly tool: "search" }>;
type PageSearchResult = ReturnType<
  typeof readNodexAgentSearch
>["data"]["results"][number];

function pageMatchesSearchScope(
  database: Database.Database,
  pageId: string,
  scope: SearchRequest["input"]["scope"],
): boolean {
  if (!scope || scope.kind === "library") return true;
  if (scope.kind === "page") return pageId === scope.pageId;
  const row = database.prepare(`
    WITH RECURSIVE ancestors(page_id, parent_kind, parent_id, depth) AS (
      SELECT block_id, parent_kind, parent_id, 0
      FROM pages WHERE block_id = ?
      UNION ALL
      SELECT parent.block_id, parent.parent_kind, parent.parent_id,
        ancestors.depth + 1
      FROM ancestors
      INNER JOIN pages parent
        ON ancestors.parent_kind = 'page'
        AND parent.block_id = ancestors.parent_id
      WHERE ancestors.depth < 512
    )
    SELECT ancestors.parent_id AS dataSourceId,
      source.home_database_block_id AS databaseId
    FROM ancestors
    INNER JOIN data_sources source
      ON ancestors.parent_kind = 'data_source'
      AND source.id = ancestors.parent_id
    ORDER BY ancestors.depth LIMIT 1
  `).get(pageId) as {
    readonly dataSourceId: string;
    readonly databaseId: string;
  } | undefined;
  if (!row) return false;
  return scope.kind === "data_source"
    ? row.dataSourceId === scope.dataSourceId
    : row.databaseId === scope.databaseId;
}

function searchableContentProjects(
  database: Database.Database,
  projectId: string,
): readonly string[] {
  const project = database.prepare(`
    SELECT library_id AS libraryId FROM projects WHERE id = ?
  `).get(projectId) as { readonly libraryId: string } | undefined;
  if (!project) throw new NodexAgentReadError("not_found", "Project was not found", false, "none");
  return (database.prepare(`
    SELECT DISTINCT block.project_id AS projectId
    FROM pages page
    INNER JOIN blocks block ON block.id = page.block_id
    WHERE page.library_id = ? AND page.lifecycle <> 'deleted'
    ORDER BY block.project_id
  `).all(project.libraryId) as readonly { readonly projectId: string }[])
    .map((row) => row.projectId);
}

function readSearchV3(
  database: Database.Database,
  request: Extract<NodexAgentV3ReadRequest, { readonly tool: "search" }>,
) {
  const target = request.input.target === "blocks" ? "blocks" as const : "pages" as const;
  const limit = request.input.page?.limit ?? 50;
  const results: PageSearchResult[] = [];
  for (const contentProjectId of searchableContentProjects(database, request.projectId)) {
      const search = readNodexAgentSearch(database, contentProjectId, {
        query: request.input.query,
        target,
        scope: { kind: "project" },
        filters: {
          ...(request.input.includeArchived !== undefined
            ? { includeArchived: request.input.includeArchived }
            : {}),
          ...(request.input.blockTypes ? { blockTypes: request.input.blockTypes } : {}),
        },
        page: { limit: 100 },
      } as PageSearchInput, { pageOwnedBlocksOnly: true });
      results.push(...search.data.results);
  }
  const seen = new Set<string>();
  const visible = results.filter((result) => {
    const pageId = result.kind === "page" ? result.blockId : result.ownerBlockId;
    if (seen.has(`${result.kind}:${result.blockId}`)) return false;
    const authorization = request.authority
      ? authorizeNodexAgentResourceInDatabase(database, {
          authority: request.authority,
          resource: { kind: "page", pageId },
          action: "read",
          ...(request.resourceAccess
            ? { resourceAccess: request.resourceAccess }
            : {}),
          callId: request.callId,
          phase: "execute",
        })
      : authorizeProjectResourceInDatabase(database, {
          projectId: request.projectId,
          resource: { kind: "page", pageId },
          action: "read",
        });
    if (!authorization.allowed) return false;
    if (!pageMatchesSearchScope(database, pageId, request.input.scope)) return false;
    seen.add(`${result.kind}:${result.blockId}`);
    return true;
  });
  const pageResults = visible.slice(0, limit);
  return SearchV3OutputSchema.parse({
    data: {
      results: pageResults.map((result) => result.kind === "page"
        ? {
            kind: result.kind,
            id: result.blockId,
            title: result.title,
            location: readPageLocation(
              database,
              request.projectId,
              result.blockId,
              request.authority,
              request.resourceAccess,
              request.callId,
            ),
            matches: result.matches,
          }
        : {
            kind: result.kind,
            id: result.blockId,
            blockType: result.blockType,
            ownerPageId: result.ownerBlockId,
            source: result.source,
            quality: result.quality,
            excerpt: result.excerpt,
          }),
    },
    page: { hasMore: visible.length > pageResults.length },
  });
}

function readQueryV3(
  database: Database.Database,
  request: Extract<NodexAgentV3ReadRequest, {
    readonly tool: "query_database_view" | "query_data_source";
  }>,
) {
  const adHocInput = request.tool === "query_data_source"
    ? request.input
    : null;
  const filter = adHocInput?.filter
    ? JSON.parse(JSON.stringify(adHocInput.filter), (key, value: unknown) =>
        key === "propertyId" ? parseDataSourcePropertyId(value) : value,
      ) as typeof adHocInput.filter
    : undefined;
  const sort = adHocInput?.sort?.map((entry) => ({
    ...entry,
    field: entry.field.kind === "property"
      ? {
          kind: "property" as const,
          propertyId: parseDataSourcePropertyId(entry.field.propertyId),
        }
      : entry.field,
  }));
  const read = request.tool === "query_database_view"
    ? {
        target: {
          kind: "view" as const,
          viewId: parseDatabaseViewId(request.input.viewId),
        },
        mode: "query" as const,
      }
    : {
        target: {
          kind: "data_source" as const,
          dataSourceId: parseDataSourceId(request.input.dataSourceId),
        },
        mode: "query" as const,
        ...(filter ? { filter } : {}),
        ...(sort ? { sort } : {}),
      };
  const result = readDatabaseModuleV2(database, {
    version: DATABASE_MODULE_V2_CONTRACT_VERSION,
    projectId: request.projectId,
    read,
  }, request.authority ? {
    authority: request.authority,
    ...(request.resourceAccess ? { resourceAccess: request.resourceAccess } : {}),
    callId: request.callId,
  } : undefined);
  if (!result.ok) {
    throw new NodexAgentReadError(
      result.error.code === "authorization_denied"
        ? "authorization_denied"
        : result.error.code === "resource_not_found"
          ? "not_found"
          : "internal_error",
      result.error.message,
      false,
      "none",
      { domainCode: result.error.code },
    );
  }
  const query: DatabaseViewQueryResultV2 | DataSourceQueryResultV2 =
    result.value.value.kind === "query"
      ? result.value.value.value
      : result.value.value.kind === "data_source_query"
        ? result.value.value.value
        : (() => {
            throw new NodexAgentReadError(
              "internal_error",
              "Database Module returned an incompatible query result",
              false,
              "none",
            );
          })();
  const selectedPropertyIds = request.input.select?.propertyIds?.map(
    parseDataSourcePropertyId,
  );
  const activeProperties = query.properties.filter(
    (property) => property.lifecycle === "active",
  );
  const propertyById = new Map(
    activeProperties.map((property) => [property.propertyId, property] as const),
  );
  const properties = selectedPropertyIds
    ? selectedPropertyIds.map((propertyId) => {
        const property = propertyById.get(propertyId);
        if (property) return property;
        throw new NodexAgentReadError(
          "not_found",
          `Data Source property ${propertyId} was not found`,
          false,
          "none",
          { resourceId: propertyId, domainCode: "property_not_found" },
        );
      })
    : activeProperties;
  const selected = new Set<string>(
    properties.map((property) => property.propertyId),
  );
  const resourceId = request.tool === "query_database_view"
    ? request.input.viewId
    : request.input.dataSourceId;
  const cursorState = {
    fingerprint: nodexAgentFingerprint({
      tool: request.tool,
      input: {
        ...request.input,
        page: undefined,
      },
    }),
    changeLogSeq: result.value.changeLogSeq,
    dataSourceId: query.dataSource.dataSourceId,
    schemaRevision: query.dataSource.schemaRevision,
    ...(result.value.value.kind === "query"
      ? {
          viewId: result.value.value.value.view.viewId,
          viewRevision: result.value.value.value.view.revision,
        }
      : {}),
  };
  const subject = [request.tool, resourceId];
  const { offset } = readCursorState(database, {
    token: request.input.page?.cursor,
    projectId: request.projectId,
    subject,
    expected: cursorState,
    recovery: "none",
  });
  const limit = request.input.page?.limit ?? 50;
  const rows = query.rows.slice(offset, offset + limit);
  const nextOffset = offset + rows.length;
  const hasMore = nextOffset < query.rows.length;
  const output = {
    data: {
      database: {
        databaseId: query.database.databaseId,
        name: query.database.name,
      },
      dataSource: {
        dataSourceId: query.dataSource.dataSourceId,
        name: query.dataSource.name,
        properties: properties.map((property) => ({
          propertyId: property.propertyId,
          name: property.name,
          valueType: property.valueType,
          config: property.config,
        })),
      },
      ...(result.value.value.kind === "query" ? {
        view: {
          viewId: result.value.value.value.view.viewId,
          dataSourceId: result.value.value.value.view.dataSourceId,
          name: result.value.value.value.view.name,
          kind: result.value.value.value.view.kind,
        },
      } : {}),
      rows: rows.map((row) => ({
        pageId: row.page.pageId,
        title: row.page.title,
        values: Object.fromEntries(Object.entries(row.values)
          .filter(([propertyId]) => selected.has(propertyId))
          .map(([propertyId, value]) => [propertyId, value.value])),
        ...(result.value.value.kind === "query" && row.position ? {
          placement: {
            viewId: result.value.value.value.view.viewId,
            groupKey: row.position.groupKey,
          },
        } : {}),
        ...(request.input.select?.documentSummary
          ? { documentSummary: row.page.preview }
          : {}),
      })),
    },
    page: {
      hasMore,
      ...(hasMore ? {
        nextCursor: mintCursor(database, {
          projectId: request.projectId,
          subject,
          offset: nextOffset,
          state: cursorState,
        }),
      } : {}),
    },
  };
  assertResponseSize(output);
  return QueryDatabaseV3OutputSchema.parse(output);
}

function dispatchV3Read(
  database: Database.Database,
  request: NodexAgentV3ReadRequest,
): NodexAgentV3ReadCommandResult {
  switch (request.tool) {
    case "get_context":
      return { ok: true, tool: request.tool, output: readContextV3(database, request) };
    case "fetch":
      return { ok: true, tool: request.tool, output: readFetchV3(database, request) };
    case "search":
      return { ok: true, tool: request.tool, output: readSearchV3(database, request) };
    case "query_database_view":
    case "query_data_source":
      return { ok: true, tool: request.tool, output: readQueryV3(database, request) };
  }
}

export function readNodexAgentV3Tool(
  database: Database.Database,
  request: NodexAgentV3ReadRequest,
): NodexAgentV3ReadCommandResult {
  try {
    return database.transaction(() => dispatchV3Read(database, request)).deferred();
  } catch (error) {
    return readFailure(error);
  }
}
