import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";

import { CARD_DETAIL_CONTRACT_VERSION, parseCardDetail } from "../../shared/card-detail";
import { plainTextToPortableRichText } from "../../shared/block-documents";
import { render } from "@/test/dom";
import { installWindowApi } from "@/test/browser-globals";
import {
  getCardDetail,
  resetCardDetailStoreForTests,
  setCardDetail,
  useCardDetail,
} from "./card-detail-store";

const buildDetail = (headSeq = 1) => parseCardDetail({
  version: CARD_DETAIL_CONTRACT_VERSION,
  card: {
    blockId: "card-1",
    projectId: "project-1",
    lifecycle: "active",
    location: { kind: "document", documentId: "document-host" },
    locationRevision: 2,
    metadataRevision: 1,
    documentId: "document-card-1",
    documentGeneration: 1,
    documentHeadSeq: headSeq,
    documentAuthority: "ydoc_primary",
    content: {
      projectedSeq: headSeq,
      title: `Nested ${headSeq}`,
      richTitle: plainTextToPortableRichText(`Nested ${headSeq}`),
      preview: "Body",
      plainText: "Body",
    },
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
  },
  document: {
    readiness: "ready",
    schemaKey: "nodex.card",
    schemaVersion: 2,
  },
  properties: {
    projectId: "project-1",
    storeEpoch: "epoch-1",
    changeLogSeq: headSeq,
    cardBlockId: "card-1",
    metadataRevision: 1,
    fields: [
      ["isAllDay", false],
      ["recurrence", null],
      ["reminders", []],
      ["scheduleTimezone", null],
      ["agentBlocked", false],
      ["agentStatus", null],
      ["runInTarget", "localProject"],
      ["runInLocalPath", null],
      ["runInBaseBranch", null],
      ["runInWorktreePath", null],
      ["runInEnvironmentPath", null],
    ].map(([field, value]) => ({
      scope: "intrinsic",
      field,
      revision: 1,
      value,
    })),
  },
  databaseContext: { kind: "standalone" },
});

function Harness() {
  const snapshot = useCardDetail("project-1", "card-1");
  return (
    <span data-testid="detail-state">
      {snapshot.loading
        ? "loading"
        : snapshot.error ?? snapshot.detail?.card.content?.title ?? "empty"}
    </span>
  );
}

describe("Card Detail store", () => {
  beforeEach(() => resetCardDetailStoreForTests());

  test("loads a standalone Card through the typed command", async () => {
    let calls = 0;
    installWindowApi({
      invoke: async (channel: string) => {
        expect(channel).toBe("card:get");
        calls += 1;
        return { ok: true, value: buildDetail() };
      },
      on: () => () => undefined,
    });

    const view = render(<Harness />);
    await waitFor(() => {
      expect(view.getByTestId("detail-state").textContent).toBe("Nested 1");
    });
    expect(calls).toBe(1);
    expect(getCardDetail("project-1", "card-1")?.databaseContext.kind).toBe(
      "standalone",
    );
  });

  test("does not replace a newer Document coordinate with a stale reply", () => {
    setCardDetail(buildDetail(3));
    setCardDetail(buildDetail(2), { acceptEqualFreshness: true });

    expect(getCardDetail("project-1", "card-1")?.card.documentHeadSeq).toBe(3);
  });

  test("refreshes a standalone Card when a cross-window Database transfer may change its capability", async () => {
    const subscriptions = new Map<
      string,
      (...args: unknown[]) => void
    >();
    let calls = 0;
    installWindowApi({
      invoke: async () => {
        calls += 1;
        return { ok: true, value: buildDetail(calls) };
      },
      on: (channel: string, callback: (...args: unknown[]) => void) => {
        subscriptions.set(channel, callback);
        return () => subscriptions.delete(channel);
      },
    });

    const view = render(<Harness />);
    await waitFor(() => {
      expect(view.getByTestId("detail-state").textContent).toBe("Nested 1");
    });

    await act(async () => {
      subscriptions.get("database-changed")?.({
        version: 1,
        projectId: "project-1",
        storeEpoch: "epoch-1",
        operationId: "transfer-1",
        sourceKind: "block_transfer",
        affectedDatabaseBlockIds: [],
        changeLogSeq: 2,
      });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(view.getByTestId("detail-state").textContent).toBe("Nested 2");
    });
    expect(calls).toBe(2);
  });
});
