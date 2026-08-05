import type { components } from "@nodex/core-protocol";

export type ProjectionImpact = components["schemas"]["ProjectionImpact"];

export type ProjectionScope =
  | { readonly kind: "library"; readonly libraryId: string }
  | {
      readonly kind: "project";
      readonly libraryId: string;
      readonly projectId: string;
    };

export interface ProjectionCursor {
  readonly storeEpoch: string;
  readonly commitSeq: number;
}

export type ProjectionStreamMessage =
  | {
      readonly version: 1;
      readonly kind: "checkpoint";
      readonly scope: ProjectionScope;
      readonly cursor: ProjectionCursor;
    }
  | {
      readonly version: 1;
      readonly kind: "changed";
      readonly scope: ProjectionScope;
      readonly cursor: ProjectionCursor;
      readonly impact: ProjectionImpact;
      /** Top-level durable mutation identity when this event came from a commit. */
      readonly operationId?: string | null;
      readonly committedAt?: string;
    }
  | {
      readonly version: 1;
      readonly kind: "resync";
      readonly scope: ProjectionScope;
      readonly cursor: ProjectionCursor;
      readonly reason:
        | "event_gap"
        | "reconnect"
        | "authorization_filter_failed";
    };

export const projectionScopeKey = (scope: ProjectionScope): string =>
  scope.kind === "library"
    ? `library:${scope.libraryId}`
    : `project:${scope.libraryId}:${scope.projectId}`;

export const projectionCursorCovers = (
  actual: ProjectionCursor | null,
  required: ProjectionCursor,
): boolean =>
  actual?.storeEpoch === required.storeEpoch
  && actual.commitSeq >= required.commitSeq;
