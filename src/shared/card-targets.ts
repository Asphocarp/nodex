import type { CardContentSummary } from "./database-query";

export interface ResolveCardTargetInput {
  /**
   * The Project containing the surface that resolves this target. Card IDs are
   * globally stable, but the explicit scope is the future authorization seam.
   */
  readonly requestingProjectId: string;
  readonly targetBlockId: string;
}

/**
 * Membership-independent read model for opening or previewing a Card Block.
 * Database properties and View position deliberately do not participate: a
 * Card may live in a Space or another Document without being a Database row.
 */
export type CardTargetReadModel =
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
      readonly card: CardContentSummary & {
        readonly lifecycle: "active" | "archived";
      };
      readonly document: {
        readonly readiness: "pending_genesis" | "ready" | "failed";
        readonly schemaKey: string;
        readonly schemaVersion: number;
      };
    };
