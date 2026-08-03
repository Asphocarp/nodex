import type { ContentAccessContext } from "./content-access-context";

export interface ResolvePageOwnershipPathInput {
  /** Authority inherited from the Page surface requesting the breadcrumb. */
  readonly accessContext: ContentAccessContext;
  readonly targetPageId: string;
}

export interface PageOwnershipPathAncestor {
  readonly pageId: string;
  readonly title: string;
  readonly lifecycle: "active" | "archived";
}

/**
 * Authorization-scoped projection of the canonical Page ownership path.
 * Ancestors are ordered from the highest visible parent to the direct parent.
 */
export type PageOwnershipPathReadModel =
  | {
      readonly libraryId: string;
      readonly storeEpoch: string;
      readonly changeLogSeq: number;
      readonly status: "missing";
      readonly targetPageId: string;
    }
  | {
      readonly libraryId: string;
      readonly storeEpoch: string;
      readonly changeLogSeq: number;
      readonly status: "available";
      readonly targetPageId: string;
      readonly ancestors: readonly PageOwnershipPathAncestor[];
    };
