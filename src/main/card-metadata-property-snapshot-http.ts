import type { Hono } from "hono";

import type { CardMetadataPropertySnapshot } from "../shared/card-metadata-property-compiler";
import {
  cardMetadataPropertySnapshotFailure,
  cardMetadataPropertySnapshotHttpStatus,
  type CardMetadataPropertySnapshotCommandResult,
} from "../shared/card-metadata-property-snapshot-transport";
import {
  cardMetadataPropertySnapshotReadFailure,
  readCanonicalCardMetadataIdentity,
} from "./card-metadata-property-snapshot-boundary";

export interface CardMetadataPropertySnapshotHttpDependencies {
  readonly readSnapshot: (
    projectId: string,
    cardBlockId: string,
  ) => CardMetadataPropertySnapshot | Promise<CardMetadataPropertySnapshot>;
}

export const registerCardMetadataPropertySnapshotHttpRoute = (
  app: Hono,
  dependencies: CardMetadataPropertySnapshotHttpDependencies,
): void => {
  app.get(
    "/api/projects/:projectId/cards/:cardBlockId/metadata-property-snapshot",
    async (context) => {
      const projectId = readCanonicalCardMetadataIdentity(
        context.req.param("projectId"),
      );
      const cardBlockId = readCanonicalCardMetadataIdentity(
        context.req.param("cardBlockId"),
      );
      context.header("Cache-Control", "no-store");
      if (!projectId || !cardBlockId) {
        return context.json(
          {
            ok: false,
            error: cardMetadataPropertySnapshotFailure(
              "invalid_request",
              "Project and Card identities must be canonical non-empty strings",
            ),
          } satisfies CardMetadataPropertySnapshotCommandResult,
          400,
        );
      }
      try {
        return context.json({
          ok: true,
          value: await dependencies.readSnapshot(projectId, cardBlockId),
        } satisfies CardMetadataPropertySnapshotCommandResult);
      } catch (error) {
        const result = cardMetadataPropertySnapshotReadFailure(error);
        if (result.ok) return context.json(result);
        return context.json(
          result,
          cardMetadataPropertySnapshotHttpStatus(result.error),
        );
      }
    },
  );
};
