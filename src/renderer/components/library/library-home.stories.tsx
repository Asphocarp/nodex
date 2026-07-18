import type { Meta, StoryObj } from "@storybook/react-vite";
import { Plus } from "lucide-react";
import { NodexButton } from "../ui/button";

import { parseDatabaseId } from "../../../shared/database-identities";

import { LibraryHomeView } from "./library-home";

const meta = {
  title: "Library/Library Home",
  component: LibraryHomeView,
  parameters: { layout: "fullscreen" },
  args: {
    query: "",
    kind: "all",
    lifecycle: "active",
    onQueryChange: () => {},
    onKindChange: () => {},
    onLifecycleChange: () => {},
    onOpen: () => {},
    newAction: (
      <NodexButton size="sm">
        <Plus className="icon-sm" />
        New
      </NodexButton>
    ),
  },
} satisfies Meta<typeof LibraryHomeView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MixedLibrary: Story = {
  args: {
    items: [
      {
        target: { kind: "page", pageId: "page-1" },
        title: "Launch notes with a title long enough to demonstrate truncation",
        kind: "page",
        lifecycle: "active",
        locationLabel: "Product",
        updatedAt: "2026-07-18T08:00:00.000Z",
        locationRevision: 1,
        metadataRevision: 1,
      },
      {
        target: { kind: "database", databaseId: parseDatabaseId("database-1") },
        title: "Tasks",
        kind: "database",
        lifecycle: "active",
        locationLabel: "Library",
        updatedAt: "2026-07-17T08:00:00.000Z",
        locationRevision: 1,
        metadataRevision: 1,
      },
    ],
  },
};

export const EmptyArchive: Story = {
  args: { lifecycle: "archived", items: [] },
};

export const Loading: Story = {
  args: { items: [], loading: true },
};

export const Error: Story = {
  args: { items: [], error: "Library could not be loaded", onRetry: () => {} },
};
