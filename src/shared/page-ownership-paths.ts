export interface ResolvePageOwnershipPathInput {
  /** Project whose current grants authorize the Page hierarchy read. */
  readonly requestingProjectId: string;
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
      readonly status: "missing";
      readonly targetPageId: string;
    }
  | {
      readonly status: "available";
      readonly targetPageId: string;
      readonly ancestors: readonly PageOwnershipPathAncestor[];
    };
