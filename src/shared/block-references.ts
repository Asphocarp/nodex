import type { CardSummary } from "./types";

export interface ResolveCardReferenceInput {
  /**
   * The Project containing the reference surface. Targets remain globally
   * addressable, so this need not equal the target Card's Project.
   */
  readonly requestingProjectId: string;
  readonly targetBlockId: string;
}

export type CardReferenceReadModel =
  | {
      readonly status: "missing";
      readonly targetBlockId: string;
    }
  | {
      readonly status: "invalid_target";
      readonly targetBlockId: string;
      readonly actualBlockType: string;
    }
  | {
      readonly status: "deleted";
      readonly targetBlockId: string;
      readonly projectId: string;
    }
  | {
      readonly status: "available";
      readonly targetBlockId: string;
      readonly projectId: string;
      readonly lifecycle: "active" | "archived";
      readonly summary: CardSummary;
      readonly document: {
        readonly documentId: string;
        readonly generation: number;
        readonly headSeq: number;
        readonly readiness: "pending_genesis" | "ready" | "failed";
        readonly authority: "legacy_shadow" | "ydoc_primary";
        readonly schemaKey: string;
        readonly schemaVersion: number;
      };
    };
