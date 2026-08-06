import { createHash } from "node:crypto";
import type { components } from "@nodex/core-protocol";
import { canonicalizePortableRichText } from "../../shared/block-documents/portable-rich-text";
import type { BlockNoteBlockValue } from "../../shared/block-documents/nfm-blocknote-adapter";
import { materializeBlockRecordWindow, type BlockRecord } from "../../shared/block-records";
import type {
  NodexAgentV3ReadCommandResult,
  NodexAgentV3ReadRequest,
} from "../../shared/nodex-agent-tools";
import { FetchV3OutputSchema } from "../../shared/nodex-agent-tools/v3-read-schemas";
import { serializeInlineMarkdownTitle } from "../../shared/nfm/agent-title";
import { extractPlainText } from "../../shared/nfm/extract-text";
import type { RustDataAuthorityRuntime } from "./desktop-data-authority";
import { toCoreAgentExecutionAuthorization } from "./desktop-nodex-agent-resource-authority";
import { mapNativeNodexAgentCoreError } from "./native-nodex-agent-page-update";
import { readCanonicalAgentPage } from "./canonical-agent-page-read";
import { materializeCanonicalAgentPage } from "./canonical-agent-page-update";
import {
  canonicalAgentBlockEtag,
  canonicalAgentPageEtag,
  type CanonicalAgentBlockValue,
} from "./canonical-agent-etag";

type FetchRequest = Extract<NodexAgentV3ReadRequest, { readonly tool: "fetch" }>;
type CorePageDetail = components["schemas"]["LibraryPageDetail"];

const record = (value: unknown): Readonly<Record<string, unknown>> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;

const requiredString = (value: unknown, label: string): string => {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(`Core Agent fetch returned invalid ${label}`);
};

const selectedProperties = (
  detail: CorePageDetail | undefined,
  propertyIds: readonly string[] | undefined,
): Readonly<Record<string, { readonly value: unknown }>> | undefined => {
  if (!propertyIds || !detail) return undefined;
  const values = new Map<string, unknown>();
  for (const property of detail.intrinsic_properties) values.set(property.key, property.value);
  if (detail.data_source_context.kind === "member") {
    for (const [propertyId, entry] of Object.entries(detail.data_source_context.values)) {
      const value = record(entry)?.value;
      if (value !== undefined) values.set(propertyId, value);
    }
  }
  return Object.fromEntries(
    propertyIds.flatMap((propertyId) =>
      values.has(propertyId) ? [[propertyId, { value: values.get(propertyId) }]] : []
    ),
  );
};

const dataSource = (detail: CorePageDetail | undefined) => {
  if (!detail || detail.data_source_context.kind !== "member") return undefined;
  const database = record(detail.data_source_context.database);
  return {
    dataSourceId: detail.data_source_context.membership.data_source_id,
    databaseId: requiredString(database?.databaseId, "Page Database identity"),
  };
};

type FlatBlock = {
  readonly block: BlockNoteBlockValue;
  readonly parentId: string | null;
  readonly index: number;
  readonly depth: number;
};

const flattenBlocks = (
  blocks: readonly BlockNoteBlockValue[],
  parentId: string | null = null,
  depth = 0,
): readonly FlatBlock[] => blocks.flatMap((block, index) => [
  { block, parentId, index, depth },
  ...flattenBlocks(block.children ?? [], block.id ?? null, depth + 1),
]);

const canonicalBlockValue = (
  block: BlockNoteBlockValue,
): CanonicalAgentBlockValue => ({
  id: requiredString(block.id, "canonical Block identity"),
  type: block.type,
  props: block.props ?? {},
  ...(block.content === undefined ? {} : { content: block.content }),
  children: (block.children ?? []).map(canonicalBlockValue),
});

const lifecycle = (value: BlockRecord["lifecycle"]): "active" | "archived" | "deleted" =>
  value === "active" || value === "archived" ? value : "deleted";

const cursorPrefix = "nxc1.";
interface CanonicalFetchCursor {
  readonly version: 1;
  readonly pageId: string;
  readonly storeEpoch: string;
  readonly commitSeq: number;
  readonly offset: number;
}

const encodeCursor = (cursor: CanonicalFetchCursor): string =>
  `${cursorPrefix}${Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")}`;

const decodeCursor = (
  value: string,
  pageId: string,
  storeEpoch: string,
  commitSeq: number,
): CanonicalFetchCursor => {
  if (!value.startsWith(cursorPrefix)) throw new CanonicalAgentFetchError(
    "cursor_stale",
    "The canonical Page cursor belongs to an older read contract",
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value.slice(cursorPrefix.length), "base64url").toString("utf8"));
  } catch {
    throw new CanonicalAgentFetchError("cursor_stale", "The canonical Page cursor is invalid");
  }
  const cursor = record(parsed);
  if (
    cursor?.version !== 1
    || cursor.pageId !== pageId
    || cursor.storeEpoch !== storeEpoch
    || cursor.commitSeq !== commitSeq
    || typeof cursor.offset !== "number"
    || !Number.isSafeInteger(cursor.offset)
    || cursor.offset < 0
  ) {
    throw new CanonicalAgentFetchError(
      "cursor_stale",
      "The canonical Page changed after this cursor was issued",
    );
  }
  return cursor as unknown as CanonicalFetchCursor;
};

export class CanonicalAgentFetchError extends Error {
  constructor(
    readonly code: "cursor_stale" | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "CanonicalAgentFetchError";
  }
}

export async function readNativeFetch(
  request: FetchRequest,
  runtime: RustDataAuthorityRuntime,
): Promise<NodexAgentV3ReadCommandResult> {
  if (!request.authority) {
    return {
      ok: false,
      error: {
        code: "authorization_denied",
        message: "Native Agent fetch requires exact Turn authority",
        retryable: false,
        recovery: "start_new_task",
      },
    };
  }
  try {
    const client = runtime.clientForProject(request.projectId);
    const authorization = toCoreAgentExecutionAuthorization(
      runtime.identity.profileId,
      request.authority,
      request.callId ?? `nodex-agent:${request.tool}`,
      request.resourceAccess,
    );
    // Library metadata remains a read-only projection seam until the Database
    // and access-closure cutover is complete. It is not used for Page body,
    // Block identity, ownership, or structural content.
    const targetRead = await client.libraryRead({
      kind: "agent_block_target",
      block_id: request.input.id,
      authorization,
    });
    if (targetRead.value.kind !== "agent_block_target") {
      throw new Error("Core returned the wrong Agent Block target variant");
    }
    const targetMetadata = targetRead.value.value;
    if (!targetMetadata) throw new CanonicalAgentFetchError(
      "not_found",
      `Page or Block ${request.input.id} was not found`,
    );
    const canonical = await readCanonicalAgentPage(client, request.input.id);
    const pageRecord = canonical.pageId
      ? canonical.window.records.find((record) => record.id === canonical.pageId)
      : undefined;
    const pagePlacement = canonical.pageId
      ? canonical.window.placements.find((placement) => placement.blockId === canonical.pageId)
      : undefined;
    const materialization = canonical.pageId
      ? materializeCanonicalAgentPage(canonical.window, canonical.pageId)
      : null;
    const bodyBlocks = materialization
      ? flattenBlocks(materializeBlockRecordWindow(canonical.window))
      : [];
    const prepareKinds = new Map<string, "update" | "delete">();
    for (const entry of request.input.prepareFor ?? []) {
      if (entry.kind !== "block_update" && entry.kind !== "block_delete") continue;
      const kind = entry.kind === "block_update" ? "update" : "delete";
      for (const blockId of entry.blockIds) {
        const previous = prepareKinds.get(blockId);
        if (previous && previous !== kind) {
          throw new CanonicalAgentFetchError(
            "not_found",
            `Block ${blockId} cannot be prepared for update and deletion together`,
          );
        }
        prepareKinds.set(blockId, kind);
      }
    }
    for (const blockId of prepareKinds.keys()) {
      if (!bodyBlocks.some((entry) => entry.block.id === blockId)) {
        throw new CanonicalAgentFetchError(
          "not_found",
          `Prepared Block ${blockId} is not present in the canonical Page`,
        );
      }
    }

    const format = request.input.format ?? "markdown";
    const pageCursor = request.input.page?.cursor && canonical.pageId
      ? decodeCursor(
          request.input.page.cursor,
          canonical.pageId,
          canonical.window.observedLocalCommit.storeEpoch,
          canonical.window.observedLocalCommit.commitSeq,
        )
      : null;
    const visibleBlocks = bodyBlocks.filter((entry) =>
      request.input.maxDepth === undefined || entry.depth <= request.input.maxDepth
    );
    const offset = pageCursor?.offset ?? 0;
    const limit = request.input.page?.limit ?? visibleBlocks.length;
    const pageBlocks = visibleBlocks.slice(offset, offset + limit);
    const hasMore = offset + pageBlocks.length < visibleBlocks.length;
    const nextCursor = hasMore && canonical.pageId
      ? encodeCursor({
          version: 1,
          pageId: canonical.pageId,
          storeEpoch: canonical.window.observedLocalCommit.storeEpoch,
          commitSeq: canonical.window.observedLocalCommit.commitSeq,
          offset: offset + pageBlocks.length,
        })
      : undefined;
    const content = materialization && format === "summary"
      ? { format, text: extractPlainText(materialization.nfm, 4_096) }
      : materialization && format === "blocks"
        ? {
            format,
            blocks: pageBlocks.map((entry) => ({
              id: requiredString(entry.block.id, "canonical Block identity"),
              parentId: entry.parentId,
              index: entry.index,
              depth: entry.depth,
              type: entry.block.type,
              props: entry.block.props ?? {},
              ...(entry.block.content === undefined ? {} : { content: entry.block.content }),
              ...(prepareKinds.has(entry.block.id ?? "")
                ? {
                    etag: canonicalAgentBlockEtag(
                      prepareKinds.get(entry.block.id ?? "") ?? "update",
                      {
                        ...canonicalBlockValue(entry.block),
                      },
                    ),
                  }
                : {}),
            })),
          }
        : materialization
          ? {
              format: "markdown" as const,
              markdown: materialization.nfm,
              contentHash: createHash("sha256")
                .update(materialization.nfm)
                .digest("hex"),
              ...(request.input.prepareFor?.some((entry) => entry.kind === "body")
                ? { etag: canonicalAgentPageEtag("body", canonical.pageId ?? request.input.id, materialization.nfm) }
                : {}),
            }
          : undefined;
    const location = pagePlacement?.parent.kind === "library"
      ? { kind: "library" as const, libraryId: canonical.window.libraryId }
      : pagePlacement?.parent.kind === "block"
        ? { kind: "page" as const, pageId: pagePlacement.parent.blockId }
        : pagePlacement?.parent.kind === "dataSource"
          ? { kind: "data_source" as const, dataSourceId: pagePlacement.parent.dataSourceId }
          : { kind: "library" as const, libraryId: canonical.window.libraryId };
    const title = pageRecord && materialization
      ? {
          markdown: serializeInlineMarkdownTitle(
            canonicalizePortableRichText(materialization.richTitle),
          ),
          ...(request.input.prepareFor?.some((entry) => entry.kind === "title")
            ? {
                etag: canonicalAgentPageEtag(
                  "title",
                  pageRecord.id,
                  materialization.richTitle,
                ),
              }
            : {}),
        }
      : undefined;
    const ownsPage = canonical.pageId === canonical.target.id;
    const properties = ownsPage
      ? selectedProperties(targetMetadata.owner_page, request.input.propertyIds)
      : undefined;
    const membership = ownsPage
      ? dataSource(targetMetadata.owner_page)
      : undefined;
    return {
      ok: true,
      tool: "fetch",
      output: FetchV3OutputSchema.parse({
        data: {
          resource: {
            id: canonical.target.id,
            type: canonical.target.kind,
            ...(title ? { title } : {}),
            lifecycle: lifecycle(canonical.target.lifecycle),
            location,
            ...(properties ? { properties } : {}),
          },
          ...(content ? { content } : {}),
          ...(membership ? { dataSource: membership } : {}),
        },
        ...(format === "blocks"
          ? {
              page: {
                hasMore,
                ...(nextCursor ? { nextCursor } : {}),
              },
            }
          : {}),
      }),
    };
  } catch (error) {
    if (error instanceof CanonicalAgentFetchError) {
      return {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          retryable: false,
          recovery: error.code === "cursor_stale" ? "fetch_again" : "none",
        },
      };
    }
    return { ok: false, error: mapNativeNodexAgentCoreError(error) };
  }
}
