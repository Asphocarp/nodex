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
  QueryDatabaseInput,
  SearchInput,
} from "../../shared/nodex-agent-tools";
import type { DocumentId } from "../../shared/nodex-agent-tools/base-schemas";
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
import { readNodexAgentBlock } from "./read-block";
import { readNodexAgentContext } from "./read-context";
import { readNodexAgentDatabaseQuery } from "./read-query-database";
import { readNodexAgentSearch } from "./read-search";
import { readFailure } from "./read-support";
import { requireCardDocumentId, toCardLocation } from "./card-adapter";

function readContextV3(
  database: Database.Database,
  request: Extract<NodexAgentV3ReadRequest, { readonly tool: "get_context" }>,
) {
  const legacy = readNodexAgentContext(database, {
    projectId: request.projectId,
    access: request.access,
    request: {
      include: request.input.include
        ? {
            ...(request.input.include.databases ? { databases: true } : {}),
            ...(request.input.include.markdownGuide ? { nfmGuide: true } : {}),
          }
        : undefined,
    },
  });
  return GetContextV3OutputSchema.parse({
    data: {
      project: legacy.data.project,
      access: legacy.data.access,
      ...(legacy.data.databases ? { databases: legacy.data.databases } : {}),
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
  const legacy = readNodexAgentBlock(database, request.projectId, {
    blockId: request.input.id,
    include: {
      ...(request.input.propertyIds
        ? { properties: { propertyIds: request.input.propertyIds } }
        : {}),
      ...(request.input.includeDatabase !== false ? { database: true } : {}),
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
        location: toCardLocation(database, request.projectId, legacy.data.block.location),
        ...(legacy.data.block.properties ? {
          properties: Object.fromEntries(Object.entries(legacy.data.block.properties).map(
            ([propertyId, value]) => [propertyId, { value: value.value }],
          )),
        } : {}),
      },
      ...(content ? { content } : {}),
      ...(legacy.data.database ? { database: legacy.data.database } : {}),
    },
    ...(legacy.page ? { page: legacy.page } : {}),
  });
}

function searchScope(
  database: Database.Database,
  projectId: string,
  scope: Extract<NodexAgentV3ReadRequest, { readonly tool: "search" }>["input"]["scope"],
): SearchInput["scope"] {
  if (!scope || scope.kind === "project" || scope.kind === "database") return scope;
  return {
    kind: "document",
    documentId: requireCardDocumentId(database, projectId, scope.cardId) as DocumentId,
  };
}

function readSearchV3(
  database: Database.Database,
  request: Extract<NodexAgentV3ReadRequest, { readonly tool: "search" }>,
) {
  const legacy = readNodexAgentSearch(database, request.projectId, {
    query: request.input.query,
    ...(request.input.target ? { target: request.input.target } : {}),
    ...(request.input.scope
      ? { scope: searchScope(database, request.projectId, request.input.scope) }
      : {}),
    ...(request.input.includeArchived !== undefined || request.input.blockTypes !== undefined
      ? {
          filters: {
            ...(request.input.includeArchived !== undefined
              ? { includeArchived: request.input.includeArchived }
              : {}),
            ...(request.input.blockTypes ? { blockTypes: request.input.blockTypes } : {}),
          },
        }
      : {}),
    ...(request.input.page ? { page: request.input.page } : {}),
  } as SearchInput, { cardOwnedBlocksOnly: true });
  return SearchV3OutputSchema.parse({
    data: {
      results: legacy.data.results.map((result) => result.kind === "card"
        ? {
            kind: result.kind,
            id: result.blockId,
            title: result.title,
            location: toCardLocation(database, request.projectId, result.location),
            matches: result.matches,
          }
        : {
            kind: result.kind,
            id: result.blockId,
            blockType: result.blockType,
            cardId: result.ownerBlockId,
            source: result.source,
            quality: result.quality,
            excerpt: result.excerpt,
          }),
    },
    ...(legacy.page ? { page: legacy.page } : {}),
  });
}

function queryInput(
  request: Extract<NodexAgentV3ReadRequest, {
    readonly tool: "query_database_view" | "advanced_query_database";
  }>,
): QueryDatabaseInput {
  if (request.tool === "query_database_view") {
    return {
      source: { kind: "view", viewId: request.input.viewId },
      ...(request.input.select ? { select: request.input.select } : {}),
      ...(request.input.page ? { page: request.input.page } : {}),
    };
  }
  return {
    source: {
      kind: "database",
      databaseBlockId: request.input.databaseBlockId,
      ...(request.input.filter ? { filter: request.input.filter } : {}),
      ...(request.input.sort ? { sort: request.input.sort } : {}),
    },
    ...(request.input.select ? { select: request.input.select } : {}),
    ...(request.input.page ? { page: request.input.page } : {}),
  };
}

function readQueryV3(
  database: Database.Database,
  request: Extract<NodexAgentV3ReadRequest, {
    readonly tool: "query_database_view" | "advanced_query_database";
  }>,
) {
  const legacy = readNodexAgentDatabaseQuery(
    database,
    request.projectId,
    queryInput(request),
  );
  return QueryDatabaseV3OutputSchema.parse({
    data: {
      database: legacy.data.database,
      ...(legacy.data.view ? { view: legacy.data.view } : {}),
      rows: legacy.data.rows.map((row) => ({
        cardId: row.blockId,
        title: row.title,
        values: Object.fromEntries(Object.entries(row.values).map(
          ([propertyId, value]) => [propertyId, value.value],
        )),
        ...(row.placement ? {
          placement: { viewId: row.placement.viewId, groupKey: row.placement.groupKey },
        } : {}),
        ...(row.documentSummary !== undefined
          ? { documentSummary: row.documentSummary }
          : {}),
      })),
    },
    ...(legacy.page ? { page: legacy.page } : {}),
  });
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
    case "advanced_query_database":
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
