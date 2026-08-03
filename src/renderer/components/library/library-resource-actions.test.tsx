import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { NodexTooltipProvider } from "@/components/ui/tooltip";

import { LibraryResourceActions } from "./library-resource-actions";

const navigation = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
}));

vi.mock("@/lib/use-library-navigation", () => ({
  useApplyLibraryOperation: () => ({
    mutation: {
      mutateAsync: navigation.mutateAsync,
      isPending: false,
    },
  }),
  useLibraryCatalog: () => ({ data: { items: [] } }),
  useLibraryPath: () => ({ data: undefined, isPending: false }),
}));

const openActions = async (): Promise<void> => {
  await act(async () => {
    fireEvent.pointerDown(screen.getByRole("button", {
      name: "Actions for Research",
    }), { button: 0, ctrlKey: false });
    await Promise.resolve();
  });
};

describe("Library resource actions", () => {
  beforeEach(() => navigation.mutateAsync.mockReset());

  test("uses a plain label for the confirmation-only Archive action", async () => {
    render(
      <NodexTooltipProvider>
        <LibraryResourceActions
          target={{ kind: "page", pageId: "page-1" }}
          title="Research"
          expectedLocationRevision={2}
          expectedMetadataRevision={3}
        />
      </NodexTooltipProvider>,
    );

    await openActions();
    const archiveItem = await screen.findByRole("menuitem", { name: "Archive" });
    expect(screen.queryByRole("menuitem", { name: "Archive…" })).toBeNull();

    fireEvent.click(archiveItem);
    expect(await screen.findByRole("dialog")).not.toBeNull();
  });

  test("does not grant Project access when confirmation is cancelled", async () => {
    render(
      <NodexTooltipProvider>
        <LibraryResourceActions
          target={{ kind: "page", pageId: "page-1" }}
          title="Research"
          expectedLocationRevision={2}
          expectedMetadataRevision={3}
          projects={[{ id: "project-1", name: "Product" }]}
        />
      </NodexTooltipProvider>,
    );

    await openActions();
    fireEvent.click(await screen.findByRole("menuitem", {
      name: "Give Project access…",
    }));
    expect(await screen.findByRole("dialog")).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(navigation.mutateAsync).not.toHaveBeenCalled();
  });
});
