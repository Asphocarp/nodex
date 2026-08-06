import type { components } from "@nodex/core-protocol";
import type {
  BlockTreeNode,
  BlockTreeValue,
  PageDocumentMaterialization,
} from "../../shared/block-documents/block-document-codec";
import {
  blockNoteToNfm,
  type BlockNoteBlockValue,
} from "../../shared/block-documents/nfm-blocknote-adapter";
import {
  portableRichTextPlainText,
  canonicalizePortableRichText,
  type PortableRichText,
} from "../../shared/block-documents/portable-rich-text";
import { serializeNfm } from "../../shared/nfm/serializer";
import { extractPlainText } from "../../shared/nfm/extract-text";
import {
  compileAgentDocumentEdit,
  type AgentDocumentEditEffects,
} from "../../shared/nodex-agent-tools/document-edit-compiler";
import type {
  EditDocumentInput,
} from "../../shared/nodex-agent-tools/write-schemas";
import type {
  AdvancedUpdatePageV3InputSchema,
  UpdatePageV3InputSchema,
} from "../../shared/nodex-agent-tools/v3-write-schemas";
import type { z } from "zod";
import type { CoreClientPort, BlockRecordApplyInput } from "./types";
import {
  blockRecordSnapshotToWindow,
  buildBatchBlockRecordApplyInput,
  buildReconcilePageTreeBlockRecordApplyInput,
  buildSetMaterializedContentBlockRecordApplyInput,
  materializeBlockRecordWindow,
  planFractionalRank,
  type BlockRecordWindow,
} from "../../shared/block-records";
import { blockKindToCore } from "../../shared/block-records/kind";
import {
  canonicalAgentBlockEtag,
  canonicalAgentPageEtag,
} from "./canonical-agent-etag";

type UpdatePageInput = z.infer<typeof UpdatePageV3InputSchema>;
type AdvancedUpdatePageInput = z.infer<typeof AdvancedUpdatePageV3InputSchema>;
type PageUpdateInput = UpdatePageInput | AdvancedUpdatePageInput;
type AgentExecutionAuthorization = components["schemas"]["AgentExecutionAuthorization"];
type NonBatchOperation = Exclude<
  components["schemas"]["BlockRecordOperation"],
  { readonly kind: "batch" }
>;

export interface CanonicalAgentPageUpdateInput {
  readonly client: CoreClientPort;
  readonly libraryId: string;
  readonly storeEpoch: string;
  readonly operationId: string;
  readonly actorId: string;
  readonly sessionId: string;
  readonly pageId: string;
  readonly input: PageUpdateInput;
  readonly authorization?: AgentExecutionAuthorization;
}

export interface CanonicalAgentPageUpdatePlan {
  readonly apply: BlockRecordApplyInput;
  readonly current: BlockRecordWindow;
  readonly target: PageDocumentMaterialization;
  readonly effects: AgentDocumentEditEffects;
}

export class CanonicalAgentPreconditionError extends Error {
  readonly code = "conflict" as const;

  constructor(message: string, readonly resourceId: string) {
    super(message);
    this.name = "CanonicalAgentPreconditionError";
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asBlockTreeValue = (value: unknown, label: string): BlockTreeValue => {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((entry) => asBlockTreeValue(entry, label));
  if (!isRecord(value)) throw new Error(`${label} is not a portable Block value`);
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, asBlockTreeValue(entry, `${label}.${key}`)]),
  );
};

const toBlockTree = (blocks: readonly BlockNoteBlockValue[]): readonly BlockTreeNode[] =>
  blocks.map((block) => ({
    id: requireId(block.id, "materialized Block"),
    type: block.type,
    props: asBlockTreeValue(block.props ?? {}, `${block.id ?? "Block"}.props`) as Readonly<
      Record<string, BlockTreeValue>
    >,
    ...(block.content === undefined
      ? {}
      : { content: asBlockTreeValue(block.content, `${block.id ?? "Block"}.content`) }),
    children: toBlockTree(block.children ?? []),
  }));

const requireId = (value: string | undefined, label: string): string => {
  if (typeof value === "string" && value.trim() === value && value.length > 0) return value;
  throw new Error(`${label} is missing a stable Block ID`);
};

const pageTitleContent = (
  window: BlockRecordWindow,
  pageId: string,
  properties: Readonly<Record<string, unknown>>,
): PortableRichText => {
  const content = window.content.find(
    (candidate) => candidate.blockId === pageId && candidate.slot === "title",
  )?.content;
  if (content !== undefined) return canonicalizePortableRichText(content);
  const title = typeof properties.title === "string" ? properties.title : "";
  return canonicalizePortableRichText([{ type: "text", text: title, styles: {} }]);
};

export const materializeCanonicalAgentPage = (
  window: BlockRecordWindow,
  pageId: string,
): PageDocumentMaterialization => {
  const page = window.records.find((record) => record.id === pageId);
  if (!page || page.kind !== "page" || page.lifecycle !== "active") {
    throw new Error(`Canonical Agent Page ${pageId} is unavailable`);
  }
  const blocks = materializeBlockRecordWindow(window);
  const blockTree = toBlockTree(blocks);
  const nfm = serializeNfm(blockNoteToNfm(blocks));
  const richTitle = pageTitleContent(window, pageId, page.properties);
  const plainText = extractPlainText(nfm);
  return {
    schemaVersion: 1,
    title: portableRichTextPlainText(richTitle),
    richTitle,
    blockTree,
    nfm,
    plainText,
    preview: plainText.length <= 240 ? plainText : `${plainText.slice(0, 240).trimEnd()}...`,
    references: [],
    assetRefs: [],
  };
};

const toEditDocumentInput = (
  pageId: string,
  input: PageUpdateInput,
): EditDocumentInput => {
  if ("edits" in input) {
    return {
      documentId: pageId,
      body: {
        kind: "blocks",
        edits: input.edits,
      },
      ...(input.safety ? { safety: input.safety } : {}),
    } as EditDocumentInput;
  }

  const body = input.body;
  return {
    documentId: pageId,
    ...(input.title
      ? {
          title: {
            value: { kind: "plain" as const, text: input.title.markdown },
            ifMatch: input.title.ifMatch,
          },
        }
      : {}),
    ...(body
      ? {
          body: body.kind === "insert"
            ? { kind: "nfm.insert" as const, at: body.at, content: body.markdown }
            : body.kind === "patch"
              ? {
                  kind: "nfm.patch" as const,
                  patches: body.patches.map((patch) => ({
                    oldNfm: patch.oldMarkdown,
                    newNfm: patch.newMarkdown,
                    ...(patch.expectedMatches === undefined
                      ? {}
                      : { expectedMatches: patch.expectedMatches }),
                  })),
                }
              : {
                  kind: "nfm.replace" as const,
                  content: body.markdown,
                  ifMatch: body.ifMatch,
                },
        }
      : {}),
    ...(input.safety ? { safety: input.safety } : {}),
  } as EditDocumentInput;
};

const deterministicBlockId = (operationId: string, localId: string): string => {
  let hash = 2166136261;
  for (const character of `${operationId}\u0000${localId}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `agent-block-${(hash >>> 0).toString(16).padStart(8, "0")}-${localId}`;
};

const flattenTarget = (
  blocks: readonly BlockTreeNode[],
  parentBlockId: string,
  current: BlockRecordWindow,
  output: {
    readonly block: BlockTreeNode;
    readonly parentBlockId: string;
    readonly rankKey: string;
    readonly contentShardId: string;
    readonly expectedBlockRevision?: number;
    readonly expectedPlacementRevision?: number;
    readonly expectedContentRevision?: number;
  }[] = [],
): typeof output => {
  const placementById = new Map(current.placements.map((placement) => [placement.blockId, placement]));
  const recordById = new Map(current.records.map((record) => [record.id, record]));
  const contentByKey = new Map(
    current.content.map((content) => [`${content.blockId}:${content.slot}`, content]),
  );
  const siblingItems = new Map<string, { id: string; rankKey: string }[]>();

  const visit = (nodes: readonly BlockTreeNode[], parentId: string): void => {
    const items = siblingItems.get(parentId) ?? [];
    siblingItems.set(parentId, items);
    for (const block of nodes) {
      const rank = planFractionalRank(items, block.id).rankKey;
      items.push({ id: block.id, rankKey: rank });
      const record = recordById.get(block.id);
      const placement = placementById.get(block.id);
      const slot = block.type === "page" ? "title" : "inline";
      const content = contentByKey.get(`${block.id}:${slot}`);
      if (record && (!placement || !content)) {
        throw new Error(`Canonical Agent Page Block ${block.id} is missing a revision boundary`);
      }
      output.push({
        block,
        parentBlockId: parentId,
        rankKey: rank,
        contentShardId: record?.contentShardId ?? `block-record-shard:${block.id}`,
        ...(record && placement && content
          ? {
              expectedBlockRevision: record.revision,
              expectedPlacementRevision: placement.revision,
              expectedContentRevision: content.head,
            }
          : {}),
      });
      visit(block.children, block.id);
    }
  };
  visit(blocks, parentBlockId);
  return output;
};

const nonBatch = (
  operation: components["schemas"]["BlockRecordOperation"],
): NonBatchOperation => {
  if (operation.kind === "batch") throw new Error("Canonical Agent Page update cannot nest a batch");
  return operation;
};

const bodyChanged = (
  current: PageDocumentMaterialization,
  target: PageDocumentMaterialization,
): boolean => JSON.stringify(current.blockTree) !== JSON.stringify(target.blockTree);

const flattenBlockTree = (
  blocks: readonly BlockTreeNode[],
): readonly BlockTreeNode[] => blocks.flatMap((block) => [
  block,
  ...flattenBlockTree(block.children),
]);

const assertIfMatch = (
  expected: string | undefined,
  actual: string,
  resourceId: string,
  label: string,
): void => {
  if (expected === undefined || expected === actual) return;
  throw new CanonicalAgentPreconditionError(
    `${label} ETag no longer matches the current canonical state`,
    resourceId,
  );
};

const validatePreconditions = (
  pageId: string,
  input: PageUpdateInput,
  current: PageDocumentMaterialization,
): void => {
  assertIfMatch(
    "title" in input ? input.title?.ifMatch : undefined,
    canonicalAgentPageEtag("title", pageId, current.richTitle),
    pageId,
    "Page title",
  );
  if ("body" in input && input.body?.kind === "replace") {
    assertIfMatch(
      input.body.ifMatch,
      canonicalAgentPageEtag("body", pageId, current.nfm),
      pageId,
      "Page body",
    );
  }
  if (!("edits" in input)) return;
  const blocks = new Map(flattenBlockTree(current.blockTree).map((block) => [block.id, block]));
  for (const edit of input.edits) {
    if (edit.kind !== "update" && edit.kind !== "delete") continue;
    const block = blocks.get(edit.blockId);
    if (!block) {
      throw new CanonicalAgentPreconditionError(
        `Block ${edit.blockId} is no longer present in the canonical Page`,
        edit.blockId,
      );
    }
    assertIfMatch(
      edit.ifMatch,
      canonicalAgentBlockEtag(edit.kind, block),
      edit.blockId,
      `Block ${edit.blockId}`,
    );
  }
};

const titleChanged = (
  current: PageDocumentMaterialization,
  target: PageDocumentMaterialization,
): boolean => JSON.stringify(current.richTitle) !== JSON.stringify(target.richTitle);

const blockIdAllocator = (operationId: string): (() => string) => {
  let sequence = 0;
  return () => deterministicBlockId(operationId, `new-${sequence++}`);
};

export const planCanonicalAgentPageUpdate = async (
  input: CanonicalAgentPageUpdateInput,
): Promise<CanonicalAgentPageUpdatePlan> => {
  const read = {
    kind: "window" as const,
    parent: { kind: "block" as const, id: input.pageId },
    include_content: true,
    include_descendants: true,
  };
  const snapshot = await input.client.blockRecordRead(read, input.authorization);
  if (
    snapshot.library_id !== input.libraryId
    || snapshot.observed_cursor.store_epoch !== input.storeEpoch
  ) {
    throw new Error("Canonical Agent Page update escaped its BlockRecord snapshot boundary");
  }
  const current = blockRecordSnapshotToWindow(snapshot, read);
  const currentMaterialization = materializeCanonicalAgentPage(current, input.pageId);
  validatePreconditions(input.pageId, input.input, currentMaterialization);
  const compiled = compileAgentDocumentEdit({
    documentId: input.pageId,
    current: currentMaterialization,
    edit: toEditDocumentInput(input.pageId, input.input),
    allocateBlockId: blockIdAllocator(input.operationId),
  });
  const target = compiled.materialization;
  const operations: NonBatchOperation[] = [];
  const pageTitle = current.content.find(
    (content) => content.blockId === input.pageId && content.slot === "title",
  );
  if (!pageTitle) throw new Error(`Canonical Agent Page ${input.pageId} has no title content shard`);
  if (titleChanged(currentMaterialization, target)) {
    const setTitle = await buildSetMaterializedContentBlockRecordApplyInput({
      operationId: input.operationId,
      actorId: input.actorId,
      sessionId: input.sessionId,
      blockId: input.pageId,
      slot: "title",
      materializedJson: target.richTitle,
      expectedRevision: pageTitle.head,
    });
    operations.push(nonBatch(setTitle.operation));
  }
  if (bodyChanged(currentMaterialization, target)) {
    const page = current.records.find((record) => record.id === input.pageId);
    if (!page) throw new Error(`Canonical Agent Page ${input.pageId} disappeared from its window`);
    const nodes = flattenTarget(target.blockTree, input.pageId, current);
    const reconcile = await buildReconcilePageTreeBlockRecordApplyInput({
      operationId: input.operationId,
      actorId: input.actorId,
      sessionId: input.sessionId,
      pageId: input.pageId,
      expectedPageRevision: page.revision,
      nodes: nodes.map((node) => ({
        block: {
          id: node.block.id,
          type: blockKindToCore(node.block.type),
          props: node.block.props,
          ...(node.block.content === undefined ? {} : { content: node.block.content }),
          children: [],
        },
        parentBlockId: node.parentBlockId,
        rankKey: node.rankKey,
        contentShardId: node.contentShardId,
        ...(node.expectedBlockRevision === undefined
          ? {}
          : {
              expectedBlockRevision: node.expectedBlockRevision,
              expectedPlacementRevision: node.expectedPlacementRevision,
              expectedContentRevision: node.expectedContentRevision,
            }),
      })),
    });
    operations.push(nonBatch(reconcile.operation));
  }
  if (operations.length === 0) throw new Error("Canonical Agent Page update produced no operation");
  const batch = await buildBatchBlockRecordApplyInput({
    operationId: input.operationId,
    actorId: input.actorId,
    sessionId: input.sessionId,
    operations,
  });
  const apply = {
    ...batch,
    ...(input.authorization ? { agent_authorization: input.authorization } : {}),
  } satisfies BlockRecordApplyInput;
  return {
    apply,
    current,
    target,
    effects: compiled.effects,
  };
};

export const commitCanonicalAgentPageUpdate = async (
  input: CanonicalAgentPageUpdateInput,
): Promise<components["schemas"]["BlockRecordCommittedValue"]> => {
  const plan = await planCanonicalAgentPageUpdate(input);
  return input.client.blockRecordApply(plan.apply);
};
