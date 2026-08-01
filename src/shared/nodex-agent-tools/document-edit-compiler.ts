import type {
  BlockTreeNode,
  BlockTreeValue,
  PageDocumentMaterialization,
} from "../block-documents/block-document-codec";
import {
  createDetachedPageDocumentFromBlockTree,
  semanticEmptyDocumentRoot,
} from "../block-documents/block-document-codec";
import {
  prepareDocumentOperationUpdate,
} from "../block-documents/document-operation-engine";
import type { DocumentBlockOperation } from "../block-documents/document-operations";
import { replacePageDocumentBodyFromNfm } from "../block-documents/legacy-nfm-shadow-translator";
import { nfmToBlockNoteWithIds } from "../block-documents/nfm-blocknote-adapter";
import {
  plainTextToPortableRichText,
  portableRichTextPlainText,
  portableRichTextSemanticSource,
  type PortableRichText,
} from "../block-documents/portable-rich-text";
import { parseNfm } from "../nfm/parser";
import type { DocumentAnchor, TextInput } from "./base-schemas";
import type { EditDocumentInput, NewBlockDraftInput } from "./write-schemas";
import {
  AgentDocumentEditCompilerError,
  applyExactNfmPatches,
} from "./exact-nfm-patches";

export {
  AgentDocumentEditCompilerError,
  applyExactNfmPatches,
  type AgentDocumentEditCompilerErrorCode,
} from "./exact-nfm-patches";

const MAX_AGENT_DOCUMENT_BLOCKS = 512;

export interface AgentDocumentEditEffects {
  readonly createdBlockIds: readonly string[];
  readonly localBlockIds: Readonly<Record<string, string>>;
  readonly copiedBlockIds: Readonly<Record<string, string>>;
  readonly updatedBlockIds: readonly string[];
  readonly movedBlockIds: readonly string[];
  readonly deletedBlockIds: readonly string[];
  readonly deletedOwnerBlockIds: readonly string[];
  readonly titleChanged: boolean;
}

export type CompiledAgentDocumentEditMutation =
  | {
      readonly kind: "operations";
      readonly operations: readonly DocumentBlockOperation[];
    }
  | {
      readonly kind: "replace_nfm";
      readonly nfm: string;
      readonly richTitle?: PortableRichText;
    };

export interface CompiledAgentDocumentEdit {
  readonly mutation: CompiledAgentDocumentEditMutation;
  readonly effects: AgentDocumentEditEffects;
  readonly materialization: PageDocumentMaterialization;
  readonly destructive: boolean;
}

interface Coordinate {
  readonly block: BlockTreeNode;
  readonly parentBlockId: string | null;
  readonly siblingIndex: number;
}

function flattenCoordinates(
  blocks: readonly BlockTreeNode[],
  parentBlockId: string | null = null,
): readonly Coordinate[] {
  return blocks.flatMap((block, siblingIndex) => [{
    block,
    parentBlockId,
    siblingIndex,
  }, ...flattenCoordinates(block.children, block.id)]);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${stableStringify(record[key])}`
  ).join(",")}}`;
}

function semanticFieldsEqual(left: BlockTreeNode, right: BlockTreeNode): boolean {
  return left.type === right.type
    && stableStringify(left.props) === stableStringify(right.props)
    && stableStringify(left.content) === stableStringify(right.content);
}

function toRichTitle(title: TextInput | undefined): PortableRichText | undefined {
  if (!title) return undefined;
  return title.kind === "plain"
    ? plainTextToPortableRichText(title.text)
    : title.richText;
}

function blockCount(blocks: readonly BlockTreeNode[]): number {
  return blocks.reduce((total, block) => total + 1 + blockCount(block.children), 0);
}

function assertBoundedBlockCount(blocks: readonly BlockTreeNode[]): void {
  if (blockCount(blocks) <= MAX_AGENT_DOCUMENT_BLOCKS) return;
  throw new AgentDocumentEditCompilerError(
    "invalid_nfm",
    `NFM content may contain at most ${MAX_AGENT_DOCUMENT_BLOCKS} Blocks`,
  );
}

function toBlockTreeNode(value: {
  readonly id?: string;
  readonly type: string;
  readonly props?: Readonly<Record<string, unknown>>;
  readonly content?: unknown;
  readonly children?: readonly unknown[];
}): BlockTreeNode {
  if (!value.id) {
    throw new AgentDocumentEditCompilerError(
      "invalid_nfm",
      "NFM Block identity allocation failed",
    );
  }
  return {
    id: value.id,
    type: value.type,
    props: (value.props ?? {}) as Readonly<Record<string, BlockTreeValue>>,
    ...(value.content === undefined ? {} : { content: value.content as BlockTreeValue }),
    children: (value.children ?? []).map((child) =>
      toBlockTreeNode(child as Parameters<typeof toBlockTreeNode>[0])
    ),
  };
}

function parseNfmFragment(
  content: string,
  allocateBlockId: () => string,
): readonly BlockTreeNode[] {
  try {
    const parsed = parseNfm(content);
    if (parsed.length === 0) {
      throw new AgentDocumentEditCompilerError(
        "invalid_arguments",
        "NFM insertion must contain at least one Block; use <empty-block/> to insert an intentional empty Block",
      );
    }
    const blocks = nfmToBlockNoteWithIds(parsed, allocateBlockId)
      .map(toBlockTreeNode);
    assertBoundedBlockCount(blocks);
    if (flattenCoordinates(blocks).some(({ block }) => block.type === "page")) {
      throw new AgentDocumentEditCompilerError(
        "invalid_nfm",
        "NFM insertion cannot create or move an owning Page; use create_pages, move_pages, or duplicate_page",
      );
    }
    return blocks;
  } catch (error) {
    if (error instanceof AgentDocumentEditCompilerError) throw error;
    throw new AgentDocumentEditCompilerError(
      "invalid_nfm",
      error instanceof Error ? error.message : "NFM content is invalid",
    );
  }
}

function promoteEmptySeed(
  seedId: string,
  blocks: readonly BlockTreeNode[],
): readonly DocumentBlockOperation[] {
  const [first, ...remaining] = blocks;
  if (!first) {
    throw new AgentDocumentEditCompilerError(
      "invalid_arguments",
      "NFM insertion must contain at least one Block; use <empty-block/> to insert an intentional empty Block",
    );
  }
  return [
    {
      kind: "update_block",
      blockId: seedId,
      patch: {
        type: first.type,
        props: first.props,
        ...(first.content === undefined
          ? { unsetContent: true as const }
          : { content: first.content }),
      },
    },
    ...first.children.map((block): DocumentBlockOperation => ({
      kind: "insert_block",
      block,
      parentBlockId: seedId,
    })),
    ...remaining.map((block): DocumentBlockOperation => ({
      kind: "insert_block",
      block,
    })),
  ];
}

type NfmInsertion = Extract<
  NonNullable<EditDocumentInput["body"]>,
  { readonly kind: "nfm.insert" }
>;

function seedFirstAllocator(
  seedId: string,
  allocateBlockId: () => string,
): () => string {
  let reusableSeedId: string | undefined = seedId;
  return () => {
    if (reusableSeedId === undefined) return allocateBlockId();
    const blockId = reusableSeedId;
    reusableSeedId = undefined;
    return blockId;
  };
}

function compileNfmInsertion(
  current: readonly BlockTreeNode[],
  insertion: NfmInsertion,
  allocateBlockId: () => string,
): readonly DocumentBlockOperation[] {
  const seed = semanticEmptyDocumentRoot(current);
  const isRootEdge = (insertion.at.kind === "start" || insertion.at.kind === "end")
    && insertion.at.parentBlockId === undefined;
  if (!seed || !isRootEdge) {
    const blocks = parseNfmFragment(insertion.content, allocateBlockId);
    const anchor = resolveDocumentAnchor(current, insertion.at);
    return blocks.map((block) => ({ kind: "insert_block", block, ...anchor }));
  }

  const blocks = parseNfmFragment(
    insertion.content,
    seedFirstAllocator(seed.id, allocateBlockId),
  );
  if (semanticEmptyDocumentRoot(blocks)) return [];
  return promoteEmptySeed(seed.id, blocks);
}

function childrenOf(
  current: readonly BlockTreeNode[],
  parentBlockId: string | undefined,
): readonly BlockTreeNode[] {
  if (!parentBlockId) return current;
  const parent = flattenCoordinates(current)
    .find(({ block }) => block.id === parentBlockId)?.block;
  if (parent) return parent.children;
  throw new AgentDocumentEditCompilerError(
    "invalid_arguments",
    `Anchor parent Block ${parentBlockId} does not exist`,
  );
}

export function resolveDocumentAnchor(
  current: readonly BlockTreeNode[],
  anchor: DocumentAnchor,
): { readonly parentBlockId?: string; readonly beforeBlockId?: string } {
  if (anchor.kind === "start" || anchor.kind === "end") {
    const siblings = childrenOf(current, anchor.parentBlockId);
    return {
      ...(anchor.parentBlockId ? { parentBlockId: anchor.parentBlockId } : {}),
      ...(anchor.kind === "start" && siblings[0]
        ? { beforeBlockId: siblings[0].id }
        : {}),
    };
  }
  const coordinates = flattenCoordinates(current);
  const index = coordinates.findIndex(({ block }) => block.id === anchor.blockId);
  const coordinate = coordinates[index];
  if (!coordinate) {
    throw new AgentDocumentEditCompilerError(
      "invalid_arguments",
      `Anchor Block ${anchor.blockId} does not exist`,
    );
  }
  if (anchor.kind === "before") {
    return {
      ...(coordinate.parentBlockId ? { parentBlockId: coordinate.parentBlockId } : {}),
      beforeBlockId: coordinate.block.id,
    };
  }
  const siblings = childrenOf(current, coordinate.parentBlockId ?? undefined);
  const siblingIndex = siblings.findIndex((block) => block.id === coordinate.block.id);
  const next = siblings[siblingIndex + 1];
  return {
    ...(coordinate.parentBlockId ? { parentBlockId: coordinate.parentBlockId } : {}),
    ...(next ? { beforeBlockId: next.id } : {}),
  };
}

function allocateDraft(
  draft: NewBlockDraftInput,
  allocateBlockId: () => string,
  localBlockIds: Map<string, string>,
): BlockTreeNode {
  if (localBlockIds.has(draft.localId)) {
    throw new AgentDocumentEditCompilerError(
      "invalid_arguments",
      `Local Block identity ${draft.localId} is repeated`,
    );
  }
  const blockId = allocateBlockId();
  localBlockIds.set(draft.localId, blockId);
  return {
    id: blockId,
    type: draft.type,
    props: (draft.props ?? {}) as Readonly<Record<string, BlockTreeValue>>,
    ...(draft.content === undefined ? {} : { content: draft.content as BlockTreeValue }),
    children: (draft.children ?? []).map((child) =>
      allocateDraft(child, allocateBlockId, localBlockIds)
    ),
  };
}

function compileStableEdits(
  current: readonly BlockTreeNode[],
  edits: Extract<NonNullable<EditDocumentInput["body"]>, { readonly kind: "blocks" }>["edits"],
  allocateBlockId: () => string,
  localBlockIds: Map<string, string>,
): readonly DocumentBlockOperation[] {
  return edits.map((edit): DocumentBlockOperation => {
    if (edit.kind === "insert") {
      return {
        kind: "insert_block",
        block: allocateDraft(edit.block, allocateBlockId, localBlockIds),
        ...resolveDocumentAnchor(current, edit.at),
      };
    }
    if (edit.kind === "update") {
      return {
        kind: "update_block",
        blockId: edit.blockId,
        patch: edit.patch as {
          readonly type?: string;
          readonly props?: Readonly<Record<string, BlockTreeValue>>;
          readonly content?: BlockTreeValue;
          readonly unsetContent?: true;
        },
      };
    }
    if (edit.kind === "move") {
      return {
        kind: "move_block",
        blockId: edit.blockId,
        ...resolveDocumentAnchor(current, edit.at),
      };
    }
    return { kind: "delete_block", blockId: edit.blockId };
  });
}

function deriveEffects(
  current: PageDocumentMaterialization,
  target: PageDocumentMaterialization,
  localBlockIds: ReadonlyMap<string, string>,
): AgentDocumentEditEffects {
  const currentCoordinates = flattenCoordinates(current.blockTree);
  const targetCoordinates = flattenCoordinates(target.blockTree);
  const currentById = new Map(currentCoordinates.map((coordinate) => [coordinate.block.id, coordinate]));
  const targetById = new Map(targetCoordinates.map((coordinate) => [coordinate.block.id, coordinate]));
  const createdBlockIds = targetCoordinates
    .filter(({ block }) => !currentById.has(block.id))
    .map(({ block }) => block.id);
  const deletedBlockIds = currentCoordinates
    .filter(({ block }) => !targetById.has(block.id))
    .map(({ block }) => block.id);
  const updatedBlockIds = targetCoordinates.flatMap((coordinate) => {
    const before = currentById.get(coordinate.block.id);
    return before && !semanticFieldsEqual(before.block, coordinate.block)
      ? [coordinate.block.id]
      : [];
  });
  const movedBlockIds = targetCoordinates.flatMap((coordinate) => {
    const before = currentById.get(coordinate.block.id);
    return before && (
      before.parentBlockId !== coordinate.parentBlockId
      || before.siblingIndex !== coordinate.siblingIndex
    ) ? [coordinate.block.id] : [];
  });
  return {
    createdBlockIds,
    localBlockIds: Object.fromEntries(localBlockIds),
    copiedBlockIds: {},
    updatedBlockIds,
    movedBlockIds,
    deletedBlockIds,
    deletedOwnerBlockIds: deletedBlockIds.filter((blockId) =>
      currentById.get(blockId)?.block.type === "page"
    ),
    titleChanged:
      portableRichTextSemanticSource(current.richTitle)
      !== portableRichTextSemanticSource(target.richTitle),
  };
}

function withRichTitle(
  materialization: PageDocumentMaterialization,
  richTitle: PortableRichText | undefined,
): PageDocumentMaterialization {
  if (!richTitle) return materialization;
  return {
    ...materialization,
    richTitle,
    title: portableRichTextPlainText(richTitle),
  };
}

function compileReplacement(
  current: PageDocumentMaterialization,
  documentId: string,
  nfm: string,
  richTitle: PortableRichText | undefined,
  allocateBlockId: () => string,
): { readonly materialization: PageDocumentMaterialization; readonly mutation: CompiledAgentDocumentEditMutation } {
  const detached = createDetachedPageDocumentFromBlockTree({
    documentId,
    richTitle: current.richTitle,
    blockTree: current.blockTree,
  });
  try {
    const replacement = replacePageDocumentBodyFromNfm({
      document: detached.document,
      nfm,
      allocateBlockId,
    });
    const materialization = withRichTitle(replacement.materialization, richTitle);
    assertBoundedBlockCount(materialization.blockTree);
    return {
      materialization,
      mutation: {
        kind: "replace_nfm",
        nfm: materialization.nfm,
        ...(richTitle ? { richTitle } : {}),
      },
    };
  } catch (error) {
    if (error instanceof AgentDocumentEditCompilerError) throw error;
    throw new AgentDocumentEditCompilerError(
      "invalid_nfm",
      error instanceof Error ? error.message : "NFM replacement is invalid",
    );
  } finally {
    detached.document.destroy();
  }
}

export function compileAgentDocumentEdit(input: {
  readonly documentId: string;
  readonly current: PageDocumentMaterialization;
  readonly edit: EditDocumentInput;
  readonly allocateBlockId: () => string;
}): CompiledAgentDocumentEdit {
  const richTitle = toRichTitle(input.edit.title?.value);
  const localBlockIds = new Map<string, string>();
  let mutation: CompiledAgentDocumentEditMutation;
  let materialization: PageDocumentMaterialization;

  if (input.edit.body?.kind === "nfm.replace" || input.edit.body?.kind === "nfm.patch") {
    const nfm = input.edit.body.kind === "nfm.replace"
      ? input.edit.body.content
      : applyExactNfmPatches(input.current.nfm, input.edit.body.patches);
    ({ mutation, materialization } = compileReplacement(
      input.current,
      input.documentId,
      nfm,
      richTitle,
      input.allocateBlockId,
    ));
  } else {
    const titleOperations: DocumentBlockOperation[] = richTitle
      ? [{ kind: "set_rich_title", richTitle }]
      : [];
    let bodyOperations: readonly DocumentBlockOperation[] = [];
    if (input.edit.body?.kind === "nfm.insert") {
      bodyOperations = compileNfmInsertion(
        input.current.blockTree,
        input.edit.body,
        input.allocateBlockId,
      );
    } else if (input.edit.body?.kind === "blocks") {
      bodyOperations = compileStableEdits(
        input.current.blockTree,
        input.edit.body.edits,
        input.allocateBlockId,
        localBlockIds,
      );
    }
    const operations = [...titleOperations, ...bodyOperations];
    const detached = createDetachedPageDocumentFromBlockTree({
      documentId: input.documentId,
      richTitle: input.current.richTitle,
      blockTree: input.current.blockTree,
    });
    try {
      const prepared = prepareDocumentOperationUpdate({
        document: detached.document,
        operations,
      });
      materialization = prepared.materialization;
      assertBoundedBlockCount(materialization.blockTree);
      mutation = { kind: "operations", operations };
    } finally {
      detached.document.destroy();
    }
  }

  const effects = deriveEffects(input.current, materialization, localBlockIds);
  if (
    effects.deletedOwnerBlockIds.length > 0
    && input.edit.safety?.allowDeletingOwnedBlocks !== true
  ) {
    throw new AgentDocumentEditCompilerError(
      "protected_owner_deletion",
      `Document edit would delete owning Page Block(s): ${effects.deletedOwnerBlockIds.join(", ")}`,
    );
  }
  return {
    mutation,
    effects,
    materialization,
    destructive: effects.deletedBlockIds.length > 0,
  };
}
