import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { render, settleAsyncRender } from "@/test/dom";
import { QueuedFollowUpSendDialog } from "./queued-follow-up-send-dialog";

async function renderDialog(
  overrides: Partial<ComponentProps<typeof QueuedFollowUpSendDialog>> = {},
) {
  const props: ComponentProps<typeof QueuedFollowUpSendDialog> = {
    open: true,
    queuedMessageCount: 1,
    pending: false,
    onOpenChange: vi.fn(),
    onClearQueue: vi.fn(),
    onSendMessage: vi.fn(),
    ...overrides,
  };
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<QueuedFollowUpSendDialog {...props} />);
    await Promise.resolve();
  });
  await settleAsyncRender();
  return { props, view };
}

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
    await Promise.resolve();
  });
  await settleAsyncRender();
}

describe("QueuedFollowUpSendDialog", () => {
  afterEach(async () => {
    await settleAsyncRender();
    await act(async () => {
      cleanup();
      document.body.replaceChildren();
      await Promise.resolve();
    });
    await settleAsyncRender();
  });

  test.each([
    [1, "You are about to send a message. Do you want to clear the 1 message previously queued?"],
    [2, "You are about to send a message. Do you want to clear the 2 messages previously queued?"],
    [0, "You are about to send a message. Do you want to clear the 0 messages previously queued?"],
  ])("renders exact queue copy for count %i", async (queuedMessageCount, description) => {
    const { view } = await renderDialog({ queuedMessageCount });

    expect(view.getByRole("heading", { name: "Send message?" })).toBeDefined();
    expect(view.getByText(description)).toBeDefined();
  });

  test("focuses Clear queue first and invokes each explicit action", async () => {
    const onClearQueue = vi.fn();
    const onSendMessage = vi.fn();
    const { view } = await renderDialog({ onClearQueue, onSendMessage });
    const clearQueue = view.getByRole("button", { name: "Clear queue" });

    await waitFor(() => {
      expect(document.activeElement).toBe(clearQueue);
    });

    await click(clearQueue);
    expect(onClearQueue).toHaveBeenCalledTimes(1);
    expect(onSendMessage).not.toHaveBeenCalled();

    await click(view.getByRole("button", { name: "Send message" }));
    expect(onSendMessage).toHaveBeenCalledTimes(1);
  });

  test("dismisses through Escape, the overlay, and the close button without choosing an action", async () => {
    const onOpenChange = vi.fn();
    const onClearQueue = vi.fn();
    const onSendMessage = vi.fn();
    const first = await renderDialog({ onOpenChange, onClearQueue, onSendMessage });

    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
      await Promise.resolve();
    });
    await settleAsyncRender();
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.objectContaining({ reason: "escape" }));
    expect(onClearQueue).not.toHaveBeenCalled();
    expect(onSendMessage).not.toHaveBeenCalled();

    first.view.unmount();
    onOpenChange.mockClear();
    const second = await renderDialog({ onOpenChange, onClearQueue, onSendMessage });
    const overlay = document.body.querySelector<HTMLElement>("[data-slot='codex-dialog-overlay']");
    if (!overlay) throw new Error("Expected dialog overlay.");
    await act(async () => {
      fireEvent.pointerDown(overlay, { button: 0, pointerType: "mouse" });
      fireEvent.click(overlay);
      await Promise.resolve();
    });
    await settleAsyncRender();
    expect(onOpenChange).toHaveBeenCalledWith(
      false,
      expect.objectContaining({ reason: "outside" }),
    );
    expect(onClearQueue).not.toHaveBeenCalled();
    expect(onSendMessage).not.toHaveBeenCalled();

    second.view.unmount();
    onOpenChange.mockClear();
    const third = await renderDialog({ onOpenChange, onClearQueue, onSendMessage });
    await click(third.view.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.objectContaining({ reason: "close" }));
    expect(onClearQueue).not.toHaveBeenCalled();
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  test("disables both decisions while pending", async () => {
    const onClearQueue = vi.fn();
    const onSendMessage = vi.fn();
    const { view } = await renderDialog({ pending: true, onClearQueue, onSendMessage });
    const clearQueue = view.getByRole("button", { name: "Clear queue" });
    const sendMessage = view.getByRole("button", { name: "Send message" });

    expect(clearQueue.hasAttribute("disabled")).toBe(true);
    expect(sendMessage.hasAttribute("disabled")).toBe(true);

    await click(clearQueue);
    await click(sendMessage);
    expect(onClearQueue).not.toHaveBeenCalled();
    expect(onSendMessage).not.toHaveBeenCalled();
  });
});
