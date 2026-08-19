import { act, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  __getNodexToastSnapshotForTests,
  __resetNodexToastStoreForTests,
} from "@/components/ui/toast";
import { buildPageDeepLink } from "@/lib/page-deeplink";
import { render } from "@/test/dom";
import { DatabaseViewPageContextMenu } from "./database-view-page-context-menu";

const mocks = vi.hoisted(() => ({
  loadPageDocumentMaterialization: vi.fn(),
  writeTextToClipboard: vi.fn(),
}));

vi.mock("@/lib/clipboard", () => ({
  writeTextToClipboard: mocks.writeTextToClipboard,
}));

vi.mock("@/lib/page-prompt-context", () => ({
  loadPageDocumentMaterialization: mocks.loadPageDocumentMaterialization,
}));

vi.mock("@/components/board/editor/nfm-send-to-thread-menu", () => ({
  NfmSendToThreadMenu: ({
    onAccept,
  }: {
    readonly onAccept: (request: {
      readonly target: { readonly kind: "thread"; readonly threadId: string };
      readonly mode: "send";
    }) => Promise<void> | void;
  }) => (
    <button
      type="button"
      onClick={() => onAccept({
        target: { kind: "thread", threadId: "thread-1" },
        mode: "send",
      })}
    >
      Choose chat
    </button>
  ),
}));

const page = {
  libraryId: "library-1",
  projectId: "project-1",
  pageId: "page-1",
  pageKey: "LAB-13",
  titleSnapshot: "Release plan",
} as const;

function renderMenu(actionPort: Parameters<
  typeof DatabaseViewPageContextMenu
>[0]["actionPort"] = {}) {
  return render(
    <DatabaseViewPageContextMenu
      page={page}
      canMoveUp
      canMoveDown
      propertyBindings={[]}
      actionPort={actionPort}
      onMove={() => undefined}
    >
      <button type="button">Page target</button>
    </DatabaseViewPageContextMenu>,
  );
}

async function openMenu(screen: ReturnType<typeof renderMenu>): Promise<void> {
  await act(async () => {
    fireEvent.contextMenu(screen.getByRole("button", { name: "Page target" }), {
      clientX: 80,
      clientY: 60,
    });
    await Promise.resolve();
  });
  const search = await screen.findByRole("textbox", {
    name: "Search Page actions and properties",
  });
  await waitFor(() => expect(search).toBe(document.activeElement));
}

async function openSubmenu(
  screen: ReturnType<typeof renderMenu>,
  name: "Copy" | "Move" | "Open in",
): Promise<void> {
  await act(async () => {
    fireEvent.pointerMove(screen.getByRole("menuitem", { name }), {
      pointerType: "mouse",
    });
    await Promise.resolve();
  });
}

describe("DatabaseViewPageContextMenu", () => {
  beforeEach(() => {
    __resetNodexToastStoreForTests();
    mocks.writeTextToClipboard.mockReset().mockResolvedValue(true);
    mocks.loadPageDocumentMaterialization.mockReset().mockResolvedValue({
      title: "Release plan",
      nfm: "# Release\n\nShip it",
    });
  });

  test("copies Page identity, deeplink, title, and canonical Markdown", async () => {
    const screen = renderMenu();

    await openMenu(screen);
    await openSubmenu(screen, "Copy");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy ID" }));
    await waitFor(() => expect(mocks.writeTextToClipboard).toHaveBeenLastCalledWith("LAB-13"));

    await openMenu(screen);
    await openSubmenu(screen, "Copy");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy deeplink" }));
    await waitFor(() => expect(mocks.writeTextToClipboard).toHaveBeenLastCalledWith(
      buildPageDeepLink({ pageId: "page-1" }),
    ));

    await openMenu(screen);
    await openSubmenu(screen, "Copy");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy title" }));
    await waitFor(() => expect(mocks.writeTextToClipboard).toHaveBeenLastCalledWith("Release plan"));

    await openMenu(screen);
    await openSubmenu(screen, "Copy");
    fireEvent.click(await screen.findByRole("menuitem", {
      name: "Copy content as Markdown",
    }));
    await waitFor(() => expect(mocks.loadPageDocumentMaterialization).toHaveBeenCalledWith({
      projectId: "project-1",
      pageId: "page-1",
    }));
    expect(mocks.writeTextToClipboard).toHaveBeenLastCalledWith("# Release\n\nShip it");
  });

  test("reports clipboard failure through the shared toast surface", async () => {
    mocks.writeTextToClipboard.mockResolvedValue(false);
    const screen = renderMenu();

    await openMenu(screen);
    await openSubmenu(screen, "Copy");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy title" }));

    await waitFor(() => expect(
      __getNodexToastSnapshotForTests().some((item) =>
        item.kind === "plain" && item.title === "Failed to copy title"
      ),
    ).toBe(true));
  });

  test("hands Send to chat off after the context menu closes", async () => {
    const sendToChat = vi.fn(async () => undefined);
    const screen = renderMenu({ sendToChat });

    await openMenu(screen);
    await openSubmenu(screen, "Open in");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Send to chat…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Choose chat" }));

    await waitFor(() => expect(sendToChat).toHaveBeenCalledWith({
      projectId: "project-1",
      pageId: "page-1",
      pageKey: "LAB-13",
      titleSnapshot: "Release plan",
      target: { kind: "thread", threadId: "thread-1" },
    }));
  });

  test("keeps Radix keyboard navigation across the submenu boundary", async () => {
    const screen = renderMenu();
    await openMenu(screen);
    const search = await screen.findByRole("textbox", {
      name: "Search Page actions and properties",
    });

    await act(async () => {
      fireEvent.keyDown(search, { key: "ArrowDown" });
      await Promise.resolve();
    });
    expect(screen.getByRole("menuitem", { name: "Open in" })).toBe(document.activeElement);
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? search, { key: "ArrowDown" });
    });
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Copy" }))
      .toBe(document.activeElement));
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? search, { key: "ArrowDown" });
    });
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Move" }))
      .toBe(document.activeElement));
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? search, { key: "ArrowRight" });
      await Promise.resolve();
    });

    const moveToTop = await screen.findByRole("menuitem", { name: "Move to top" });
    await waitFor(() => expect(moveToTop).toBe(document.activeElement));
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? search, { key: "ArrowLeft" });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: "Move to top" }))
      .toBeNull());
    expect(screen.getByRole("menuitem", { name: "Move" })).toBe(document.activeElement);

    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? search, { key: "Escape" });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.queryByRole("textbox", {
      name: "Search Page actions and properties",
    })).toBeNull());
  });
});
