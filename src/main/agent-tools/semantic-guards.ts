import type {
  BlockTreeNode,
  BlockTreeValue,
} from "../../shared/block-documents/block-document-codec";
import type { PortableRichText } from "../../shared/block-documents/portable-rich-text";
import type { JsonValue } from "../../shared/nodex-agent-tools";
import type { NodexAgentEtagState } from "../local-store/nodex-agent-etag";

function blockState(node: BlockTreeNode): JsonValue {
  return {
    type: node.type,
    props: node.props as Readonly<Record<string, BlockTreeValue>>,
    ...(node.content === undefined ? {} : { content: node.content }),
  } as JsonValue;
}

function subtreeState(node: BlockTreeNode): JsonValue {
  return {
    id: node.id,
    ...blockState(node) as Readonly<Record<string, JsonValue>>,
    children: node.children.map(subtreeState),
  };
}

export function titleEtagState(input: {
  readonly projectId: string;
  readonly documentId: string;
  readonly richTitle: PortableRichText;
}): NodexAgentEtagState {
  return {
    kind: "title",
    projectId: input.projectId,
    subject: [input.documentId],
    state: { richTitle: input.richTitle as unknown as JsonValue },
  };
}

export function documentBodyEtagState(input: {
  readonly projectId: string;
  readonly documentId: string;
  readonly nfm: string;
}): NodexAgentEtagState {
  return {
    kind: "document_body",
    projectId: input.projectId,
    subject: [input.documentId],
    state: { nfm: input.nfm },
  };
}

export function documentBlockEtagState(input: {
  readonly projectId: string;
  readonly documentId: string;
  readonly block: BlockTreeNode;
}): NodexAgentEtagState {
  return {
    kind: "document_block",
    projectId: input.projectId,
    subject: [input.documentId, input.block.id],
    state: { block: blockState(input.block) },
  };
}

export function documentSubtreeEtagState(input: {
  readonly projectId: string;
  readonly documentId: string;
  readonly block: BlockTreeNode;
}): NodexAgentEtagState {
  return {
    kind: "document_subtree",
    projectId: input.projectId,
    subject: [input.documentId, input.block.id],
    state: { subtree: subtreeState(input.block) },
  };
}

export function databaseValueEtagState(input: {
  readonly projectId: string;
  readonly databaseBlockId: string;
  readonly blockId: string;
  readonly propertyId: string;
  readonly value: JsonValue;
  readonly membershipId: string;
  readonly membershipRevision: number;
  readonly propertySchemaRevision: number;
  readonly valueRevision: number;
}): NodexAgentEtagState {
  return {
    kind: "database_value",
    projectId: input.projectId,
    subject: [input.databaseBlockId, input.blockId, input.propertyId],
    state: {
      value: input.value,
      membershipId: input.membershipId,
      membershipRevision: input.membershipRevision,
      propertySchemaRevision: input.propertySchemaRevision,
      valueRevision: input.valueRevision,
    },
  };
}

export function viewPlacementEtagState(input: {
  readonly projectId: string;
  readonly databaseBlockId: string;
  readonly viewId: string;
  readonly blockId: string;
  readonly groupKey: string | null;
  readonly beforeBlockId: string | null;
  readonly membershipId: string;
  readonly membershipRevision: number;
  readonly viewRevision: number;
  readonly positionRevision: number;
  readonly groupValueRevision: number;
}): NodexAgentEtagState {
  return {
    kind: "view_placement",
    projectId: input.projectId,
    subject: [input.databaseBlockId, input.viewId, input.blockId],
    state: {
      groupKey: input.groupKey,
      beforeBlockId: input.beforeBlockId,
      membershipId: input.membershipId,
      membershipRevision: input.membershipRevision,
      viewRevision: input.viewRevision,
      positionRevision: input.positionRevision,
      groupValueRevision: input.groupValueRevision,
    },
  };
}
