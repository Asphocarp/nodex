import type { components } from "@nodex/core-protocol";
import type { AdditionalDocumentCommandRequest } from "../additional-document-commands";
import type {
  CanvasSceneMutationRequest,
  CanvasSceneMutationResult,
  DocumentMutationRequest,
  DocumentVersionDetail,
  DocumentVersionSummary,
  OwnedDocumentDescriptor,
} from "../block-documents";
import type {
  CommittedModuleValue,
  CoreModuleResult,
  DeepCoreModule,
  ModuleApplyRequest,
  ModuleMutationReceipt,
  ModuleReadRequest,
  ModuleReadSnapshot,
} from "./common";

export type OwnedDocumentRead =
  | { readonly kind: "descriptor"; readonly ownerBlockId: string }
  | {
      readonly kind: "sync_yjs";
      readonly documentId: string;
      readonly stateVector: Uint8Array;
    }
  | { readonly kind: "sync_canvas"; readonly documentId: string }
  | {
      readonly kind: "list_versions";
      readonly documentId: string;
      readonly beforeVersionId?: string;
      readonly limit?: number;
    }
  | {
      readonly kind: "get_version";
      readonly documentId: string;
      readonly versionId: string;
    };

export type OwnedDocumentReadValue =
  | { readonly kind: "descriptor"; readonly descriptor: OwnedDocumentDescriptor }
  | {
      readonly kind: "yjs_sync";
      readonly descriptor: OwnedDocumentDescriptor;
      readonly update: Uint8Array;
    }
  | {
      readonly kind: "canvas_sync";
      readonly descriptor: OwnedDocumentDescriptor;
      readonly sceneJson: Uint8Array;
      readonly sceneHash: string;
    }
  | {
      readonly kind: "versions";
      readonly items: readonly DocumentVersionSummary[];
      readonly nextVersionId: string | null;
    }
  | { readonly kind: "version"; readonly value: DocumentVersionDetail };

export type OwnedDocumentIntent =
  | { readonly kind: "prepare_owner"; readonly ownerBlockId: string }
  | {
      readonly kind: "apply_yjs_update";
      readonly documentId: string;
      readonly generation: number;
      readonly baseHeadSeq: number;
      readonly updateId: string;
      readonly touchedBlockIds: readonly string[];
      readonly update: Uint8Array;
    }
  | {
      readonly kind: "apply_semantic_mutation";
      readonly request: DocumentMutationRequest;
    }
  | {
      readonly kind: "apply_canvas_mutation";
      readonly request: CanvasSceneMutationRequest;
    }
  | {
      readonly kind: "create_checkpoint";
      readonly documentId: string;
      readonly generation: number;
      readonly expectedHeadSeq: number;
      readonly cause: string;
      readonly label?: string;
    }
  | {
      readonly kind: "restore_version";
      readonly documentId: string;
      readonly versionId: string;
      readonly generation: number;
      readonly expectedHeadSeq: number;
    }
  | {
      readonly kind: "apply_additional_owner_command";
      readonly request: AdditionalDocumentCommandRequest;
    };

export interface OwnedDocumentCommitValue {
  readonly documentId: string;
  readonly generation: number;
  readonly headSeq: number;
  readonly outcome: "committed" | "no_change";
  readonly canvas?: CanvasSceneMutationResult;
}

export interface OwnedDocumentReceipt extends ModuleMutationReceipt {
  readonly documentId: string;
  readonly generation: number;
  readonly headSeq: number;
}

export type OwnedDocumentModuleReadRequest = ModuleReadRequest<OwnedDocumentRead>;
export type OwnedDocumentModuleReadResult = CoreModuleResult<
  ModuleReadSnapshot<OwnedDocumentReadValue>
>;
export type OwnedDocumentModuleApplyRequest = ModuleApplyRequest<OwnedDocumentIntent>;
export type OwnedDocumentModuleApplyResult = CoreModuleResult<
  CommittedModuleValue<OwnedDocumentCommitValue, OwnedDocumentReceipt>
>;

export type OwnedDocumentModule = DeepCoreModule<
  OwnedDocumentModuleReadRequest,
  OwnedDocumentModuleReadResult,
  OwnedDocumentModuleApplyRequest,
  OwnedDocumentModuleApplyResult
>;

export type OwnedDocumentEvent = components["schemas"]["OwnedDocumentEvent"];
