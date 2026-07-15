import {
  CARD_DETAIL_CONTRACT_VERSION,
  type CardDetailCommandResult,
} from "../../../../shared/card-detail";
import { plainTextToPortableRichText } from "../../../../shared/block-documents";
import type { BlockPropertyJsonValue } from "../../../../shared/block-property-mutations";
import type {
  CardDatabaseMetadataField,
  CardDatabasePropertyCoordinate,
  CardIntrinsicMetadataField,
  CardIntrinsicPropertyCoordinate,
} from "../../../../shared/card-metadata-property-compiler";
import type { Card } from "@/lib/types";

/** Storybook-only bridge from existing Database-row fixtures to Card Detail. */
export const buildCardDetailStoryCommandResult = (
  projectId: string,
  card: Card | null,
): CardDetailCommandResult => {
  if (!card) {
    return {
      ok: false,
      error: {
        code: "card_not_found",
        message: "Story Card was not found",
        retryable: false,
      },
    };
  }
  const databaseBlockId = `database:${projectId}:story`;
  const intrinsicField = (
    field: CardIntrinsicMetadataField,
    value: unknown,
  ): CardIntrinsicPropertyCoordinate => ({
    scope: "intrinsic",
    field,
    revision: 1,
    value: value as BlockPropertyJsonValue,
  });
  const databaseField = (
    field: CardDatabaseMetadataField,
    value: unknown,
  ): CardDatabasePropertyCoordinate => ({
    scope: "database",
    field,
    databaseBlockId,
    propertyId: `${databaseBlockId}:property:${field}`,
    revision: 1,
    value: value as BlockPropertyJsonValue,
  });
  const intrinsic = [
    intrinsicField("isAllDay", Boolean(card.isAllDay)),
    intrinsicField("recurrence", card.recurrence ?? null),
    intrinsicField("reminders", card.reminders ?? []),
    intrinsicField("scheduleTimezone", card.scheduleTimezone ?? null),
    intrinsicField("runInTarget", card.runInTarget ?? "localProject"),
    intrinsicField("runInLocalPath", card.runInLocalPath ?? null),
    intrinsicField("runInBaseBranch", card.runInBaseBranch ?? null),
    intrinsicField("runInWorktreePath", card.runInWorktreePath ?? null),
    intrinsicField("runInEnvironmentPath", card.runInEnvironmentPath ?? null),
  ];
  const database = [
    databaseField("status", card.status),
    databaseField("priority", card.priority ?? null),
    databaseField("estimate", card.estimate ?? null),
    databaseField("tags", card.tags),
    databaseField("dueDate", card.dueDate?.toISOString().slice(0, 10) ?? null),
    databaseField("scheduledStart", card.scheduledStart?.toISOString() ?? null),
    databaseField("scheduledEnd", card.scheduledEnd?.toISOString() ?? null),
    databaseField("assignee", card.assignee ?? null),
  ];
  return {
    ok: true,
    value: {
      version: CARD_DETAIL_CONTRACT_VERSION,
      card: {
        blockId: card.id,
        projectId,
        lifecycle: card.archived ? "archived" : "active",
        location: { kind: "database", databaseBlockId },
        locationRevision: 1,
        metadataRevision: card.revision ?? 1,
        documentId: `document:${card.id}`,
        documentGeneration: 1,
        documentHeadSeq: 1,
        documentAuthority: "ydoc_primary",
        content: {
          projectedSeq: 1,
          title: card.title,
          richTitle:
            card.richTitle ?? plainTextToPortableRichText(card.title),
          preview: card.description.slice(0, 240),
          plainText: card.description,
        },
        createdAt: card.created.toISOString(),
        updatedAt: card.created.toISOString(),
      },
      document: {
        readiness: "ready",
        schemaKey: "nodex.card",
        schemaVersion: 2,
      },
      properties: {
        projectId,
        storeEpoch: "store-epoch:storybook",
        changeLogSeq: 1,
        cardBlockId: card.id,
        metadataRevision: card.revision ?? 1,
        fields: [...intrinsic, ...database],
      },
      databaseContext: {
        kind: "member",
        membership: {
          id: `membership:${card.id}`,
          databaseBlockId,
          revision: 1,
        },
      },
    },
  };
};
