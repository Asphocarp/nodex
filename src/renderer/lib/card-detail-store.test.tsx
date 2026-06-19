import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "bun:test";
import { render } from "@/test/dom";
import { installWindowApi } from "@/test/browser-globals";
import {
  getCardDetail,
  resetCardDetailStoreForTests,
  setCardDetail,
  setCardDetails,
  useCardDetail,
} from "./card-detail-store";
import type { Card } from "./types";

function buildCard(overrides: Partial<Card> = {}): Card {
  return {
    id: "card-1",
    status: "in_progress",
    archived: false,
    title: "Persisted title",
    description: "Persisted body",
    tags: [],
    agentBlocked: false,
    created: new Date("2026-01-01T00:00:00.000Z"),
    order: 1,
    revision: 1,
    ...overrides,
  };
}

function DetailHarness() {
  const detail = useCardDetail("project-1", "card-1");
  return (
    <span data-testid="detail-state">
      {detail.loading ? "loading" : detail.error ?? detail.card?.title ?? "empty"}
    </span>
  );
}

describe("card detail store", () => {
  beforeEach(() => {
    resetCardDetailStoreForTests();
  });

  test("does not overwrite or emit for older single-card detail replies", async () => {
    const newerCard = buildCard({
      title: "Newer title",
      description: "Newer body",
      revision: 3,
    });
    const olderCard = buildCard({
      title: "Older title",
      description: "Older body",
      revision: 2,
    });
    setCardDetail("project-1", newerCard);

    let renderCount = 0;
    function RenderCountHarness() {
      renderCount += 1;
      const detail = useCardDetail("project-1", "card-1");
      return <span data-testid="detail-title">{detail.card?.title ?? "empty"}</span>;
    }

    const view = render(<RenderCountHarness />);
    expect(view.getByTestId("detail-title").textContent).toBe("Newer title");
    expect(renderCount).toBe(1);

    await act(async () => {
      setCardDetail("project-1", olderCard);
      await Promise.resolve();
    });

    expect(getCardDetail("project-1", "card-1") === newerCard).toBeTrue();
    expect(view.getByTestId("detail-title").textContent).toBe("Newer title");
    expect(renderCount).toBe(1);
    view.unmount();
  });

  test("does not overwrite or emit for same-revision batch hydration", async () => {
    const cachedCard = buildCard({
      title: "Cached title",
      description: "Cached body",
      revision: 5,
    });
    const sameRevisionReply = buildCard({
      title: "Reply title",
      description: "Reply body",
      revision: 5,
    });
    setCardDetail("project-1", cachedCard);

    let renderCount = 0;
    function RenderCountHarness() {
      renderCount += 1;
      const detail = useCardDetail("project-1", "card-1");
      return <span data-testid="detail-title">{detail.card?.title ?? "empty"}</span>;
    }

    const view = render(<RenderCountHarness />);
    expect(view.getByTestId("detail-title").textContent).toBe("Cached title");
    expect(renderCount).toBe(1);

    await act(async () => {
      setCardDetails("project-1", [sameRevisionReply]);
      await Promise.resolve();
    });

    expect(getCardDetail("project-1", "card-1") === cachedCard).toBeTrue();
    expect(view.getByTestId("detail-title").textContent).toBe("Cached title");
    expect(renderCount).toBe(1);
    view.unmount();
  });

  test("refetches cached detail when the requested revision is newer", async () => {
    let calls = 0;
    installWindowApi({
      invoke: async (channel: string) => {
        if (channel !== "card:get") {
          throw new Error(`Unexpected channel: ${channel}`);
        }
        calls += 1;
        return buildCard({
          title: "Fresh title",
          description: "Fresh body",
          revision: 2,
        });
      },
      on: () => () => {},
    });

    setCardDetail("project-1", buildCard({
      title: "Cached title",
      description: "Cached body",
      revision: 1,
    }));

    function RevisionHarness() {
      const detail = useCardDetail("project-1", "card-1", "in_progress", 2);
      return <span data-testid="detail-title">{detail.card?.title ?? "empty"}</span>;
    }

    const view = render(<RevisionHarness />);
    expect(view.getByTestId("detail-title").textContent).toBe("Cached title");

    await waitFor(() => {
      expect(view.getByTestId("detail-title").textContent).toBe("Fresh title");
    });

    expect(calls).toBe(1);
    expect(getCardDetail("project-1", "card-1")?.revision).toBe(2);
    view.unmount();
  });

  test("does not retry continuously after a card detail miss", async () => {
    let calls = 0;
    installWindowApi({
      invoke: async (channel: string) => {
        if (channel !== "card:get") {
          throw new Error(`Unexpected channel: ${channel}`);
        }
        calls += 1;
        return null;
      },
      on: () => () => {},
    });

    const view = render(<DetailHarness />);

    await waitFor(() => {
      expect(view.getByTestId("detail-state").textContent).toBe("Card not found");
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(calls).toBe(1);
  });
});
