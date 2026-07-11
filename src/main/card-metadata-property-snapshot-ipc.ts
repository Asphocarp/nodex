import type { CardMetadataPropertySnapshot } from "../shared/card-metadata-property-compiler";
import {
  cardMetadataPropertySnapshotFailure,
  type CardMetadataPropertySnapshotCommandResult,
} from "../shared/card-metadata-property-snapshot-transport";
import {
  cardMetadataPropertySnapshotReadFailure,
  readCanonicalCardMetadataIdentity,
} from "./card-metadata-property-snapshot-boundary";

export const CARD_METADATA_PROPERTY_SNAPSHOT_IPC_CHANNEL =
  "cards:metadata-properties:snapshot" as const;

export type CardMetadataPropertySnapshotIpcHandler = (
  event: unknown,
  projectId: string,
  cardBlockId: string,
) => Promise<CardMetadataPropertySnapshotCommandResult>;

export interface CardMetadataPropertySnapshotIpcDependencies {
  readonly registerHandle: (
    channel: typeof CARD_METADATA_PROPERTY_SNAPSHOT_IPC_CHANNEL,
    listener: CardMetadataPropertySnapshotIpcHandler,
  ) => void;
  readonly isTrustedEvent: (event: unknown) => boolean;
  readonly readSnapshot: (
    projectId: string,
    cardBlockId: string,
  ) => CardMetadataPropertySnapshot | Promise<CardMetadataPropertySnapshot>;
}

export const registerCardMetadataPropertySnapshotIpcHandler = (
  dependencies: CardMetadataPropertySnapshotIpcDependencies,
): void => {
  dependencies.registerHandle(
    CARD_METADATA_PROPERTY_SNAPSHOT_IPC_CHANNEL,
    async (event, rawProjectId, rawCardBlockId) => {
      if (!dependencies.isTrustedEvent(event)) {
        return {
          ok: false,
          error: cardMetadataPropertySnapshotFailure(
            "invalid_request",
            "Card metadata snapshots are restricted to a trusted application window",
          ),
        };
      }
      const projectId = readCanonicalCardMetadataIdentity(rawProjectId);
      const cardBlockId = readCanonicalCardMetadataIdentity(rawCardBlockId);
      if (!projectId || !cardBlockId) {
        return {
          ok: false,
          error: cardMetadataPropertySnapshotFailure(
            "invalid_request",
            "Project and Card identities must be canonical non-empty strings",
          ),
        };
      }
      try {
        return {
          ok: true,
          value: await dependencies.readSnapshot(projectId, cardBlockId),
        };
      } catch (error) {
        return cardMetadataPropertySnapshotReadFailure(error);
      }
    },
  );
};
