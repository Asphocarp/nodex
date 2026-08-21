import { describe, expect, test } from "vitest";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { render, settleAsyncRender } from "../../../test/dom";
import { usePortalHost } from "./use-portal-host";

const CONVERSATION_ATTRIBUTE = "data-above-composer-conversation-id";
const PRIMARY_ATTRIBUTE = "data-above-composer-portal";
const PRIMARY_FALLBACK_ID = "above-composer-portal";
const QUEUE_ATTRIBUTE = "data-above-composer-queue-portal";
const QUEUE_FALLBACK_ID = "above-composer-queue-portal";

function RoutedPortal({
  attribute,
  children,
  conversationId,
  fallbackId,
}: {
  attribute: string;
  children: ReactNode;
  conversationId?: string | null;
  fallbackId: string;
}) {
  const host = usePortalHost({ attribute, conversationId, fallbackId });
  if (!host) return null;
  return createPortal(children, host);
}

describe("usePortalHost", () => {
  test("routes primary and queue content to hosts owned by the same conversation", async () => {
    const { container } = render(
      <>
        <div
          id={PRIMARY_FALLBACK_ID}
          data-above-composer-portal="true"
          data-above-composer-conversation-id="thread-other"
        />
        <div
          id={PRIMARY_FALLBACK_ID}
          data-above-composer-portal="true"
          data-above-composer-conversation-id="thread-target"
        />
        <div
          id={QUEUE_FALLBACK_ID}
          data-above-composer-queue-portal="true"
          data-above-composer-conversation-id="thread-other"
        />
        <div
          id={QUEUE_FALLBACK_ID}
          data-above-composer-queue-portal="true"
          data-above-composer-conversation-id="thread-target"
        />
        <RoutedPortal
          attribute={PRIMARY_ATTRIBUTE}
          conversationId="thread-target"
          fallbackId={PRIMARY_FALLBACK_ID}
        >
          <span data-primary-probe="true" />
        </RoutedPortal>
        <RoutedPortal
          attribute={QUEUE_ATTRIBUTE}
          conversationId="thread-target"
          fallbackId={QUEUE_FALLBACK_ID}
        >
          <span data-queue-probe="true" />
        </RoutedPortal>
      </>,
    );

    await settleAsyncRender();

    const targetPrimary = container.querySelector(
      `[${PRIMARY_ATTRIBUTE}][${CONVERSATION_ATTRIBUTE}="thread-target"]`,
    );
    const otherPrimary = container.querySelector(
      `[${PRIMARY_ATTRIBUTE}][${CONVERSATION_ATTRIBUTE}="thread-other"]`,
    );
    const targetQueue = container.querySelector(
      `[${QUEUE_ATTRIBUTE}][${CONVERSATION_ATTRIBUTE}="thread-target"]`,
    );
    const otherQueue = container.querySelector(
      `[${QUEUE_ATTRIBUTE}][${CONVERSATION_ATTRIBUTE}="thread-other"]`,
    );

    expect(targetPrimary?.querySelector("[data-primary-probe]") !== null).toBe(true);
    expect(otherPrimary?.querySelector("[data-primary-probe]") === null).toBe(true);
    expect(targetQueue?.querySelector("[data-queue-probe]") !== null).toBe(true);
    expect(otherQueue?.querySelector("[data-queue-probe]") === null).toBe(true);
  });

  test("fails closed instead of using an id fallback owned by another conversation", async () => {
    const { container } = render(
      <>
        <div id={PRIMARY_FALLBACK_ID} data-legacy-fallback="true" />
        <div data-above-composer-portal="true" data-above-composer-conversation-id="thread-other" />
        <RoutedPortal
          attribute={PRIMARY_ATTRIBUTE}
          conversationId="thread-target"
          fallbackId={PRIMARY_FALLBACK_ID}
        >
          <span data-primary-probe="true" />
        </RoutedPortal>
      </>,
    );

    await settleAsyncRender();

    expect(container.querySelector("[data-primary-probe]") === null).toBe(true);
  });

  test("keeps the legacy id fallback when no attributed hosts exist", async () => {
    const { container } = render(
      <>
        <div id={PRIMARY_FALLBACK_ID} data-legacy-fallback="true" />
        <RoutedPortal
          attribute={PRIMARY_ATTRIBUTE}
          conversationId="thread-target"
          fallbackId={PRIMARY_FALLBACK_ID}
        >
          <span data-primary-probe="true" />
        </RoutedPortal>
      </>,
    );

    await settleAsyncRender();

    const fallbackHost = container.querySelector("[data-legacy-fallback]");
    expect(fallbackHost?.querySelector("[data-primary-probe]") !== null).toBe(true);
  });
});
