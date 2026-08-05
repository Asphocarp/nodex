import type { BlockPropertyJsonValue } from "../block-property-mutations";
import type { BlockTreeNode } from "./block-document-codec";

export const ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION = 1;

export type AdditionalDocumentBearingActor = Readonly<
  Record<string, BlockPropertyJsonValue>
>;

interface AdditionalDocumentBearingOperationBase {
  readonly version: typeof ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION;
  readonly operationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly clientSessionId: string;
  readonly actor: AdditionalDocumentBearingActor;
}

export interface CreateReusableTemplateSource
  extends AdditionalDocumentBearingOperationBase {
  readonly kind: "create_reusable_template_source";
  readonly sourceBlockId: string;
  readonly documentId: string;
  readonly displayName: string;
  readonly blockTree: readonly BlockTreeNode[];
  readonly beforeBlockId?: string;
  readonly expectedBeforeLocationRevision?: number;
}

export interface CreateReusableTemplateReference
  extends AdditionalDocumentBearingOperationBase {
  readonly kind: "create_reusable_template_reference";
  readonly sourceBlockId: string;
  readonly sourceDocumentId: string;
  readonly expectedSourceGeneration: number;
  readonly expectedSourceHeadSeq: number;
  readonly hostDocumentId: string;
  readonly expectedHostGeneration: number;
  readonly expectedHostHeadSeq: number;
  readonly referenceBlockId: string;
  readonly parentBlockId?: string;
  readonly beforeBlockId?: string;
}

export interface InstantiateReusableTemplate
  extends AdditionalDocumentBearingOperationBase {
  readonly kind: "instantiate_reusable_template";
  readonly sourceBlockId: string;
  readonly sourceDocumentId: string;
  readonly expectedSourceGeneration: number;
  readonly expectedSourceHeadSeq: number;
  readonly targetDocumentId: string;
  readonly expectedTargetGeneration: number;
  readonly expectedTargetHeadSeq: number;
  readonly parentBlockId?: string;
  readonly beforeBlockId?: string;
}

export interface AdditionalDocumentBearingMutationResult {
  readonly version: typeof ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION;
  readonly operationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly mutationKind:
    | CreateReusableTemplateSource["kind"]
    | CreateReusableTemplateReference["kind"]
    | InstantiateReusableTemplate["kind"]
    | "delete_owned_source";
  readonly blockIds: readonly string[];
  readonly documentHeads: Readonly<
    Record<string, { readonly generation: number; readonly headSeq: number }>
  >;
  readonly commitSeq: number;
  readonly duplicate: boolean;
  readonly committedAt: string;
}
