import type { Meta, StoryObj } from "@storybook/react-vite";
import { fireEvent, getByRole, waitFor } from "@testing-library/dom";
import { RelationPropertyEditor } from "./relation-property-editor";

const visibleAndRestrictedValue = {
  kind: "relation",
  value: {
    value_revision: 4,
    total_count: 5,
    targets: [
      { kind: "visible", edge_id: "a".repeat(64), page_id: "page:a", title: "Define migration", lifecycle: "active", membership_state: "active_in_target_source" },
      { kind: "visible", edge_id: "b".repeat(64), page_id: "page:b", title: "Verify retention", lifecycle: "archived", membership_state: "archived" },
    ],
    restricted_count: 1,
    has_more: true,
  },
};

const meta: Meta<typeof RelationPropertyEditor> = {
  title: "Database/Relation Property Editor",
  component: RelationPropertyEditor,
  args: {
    label: "Blocked by",
    candidates: [{ pageId: "page:c", title: "Ship editor" }],
    disabled: false,
    targetMatchesCurrentSource: true,
    onPatch: () => undefined,
    onClear: () => undefined,
    onLoadTargetDescriptor: async () => ({ name: "Product work" }),
    onSearchCandidates: async () => ({
      candidates: [{ pageId: "page:c", title: "Ship editor" }],
      nextCursor: null,
      projectionRevision: 7,
    }),
  },
};

export default meta;
type Story = StoryObj<typeof RelationPropertyEditor>;

export const Empty: Story = { args: { value: null } };
export const VisibleAndRestricted: Story = { args: { value: visibleAndRestrictedValue } };
export const ReadOnly: Story = {
  args: { value: visibleAndRestrictedValue, disabled: true },
};
export const OutOfSource: Story = {
  args: {
    value: {
      kind: "relation",
      value: {
        value_revision: 2,
        total_count: 1,
        targets: [{
          kind: "visible",
          edge_id: "c".repeat(64),
          page_id: "page:moved",
          title: "Moved dependency",
          lifecycle: "active",
          membership_state: "out_of_source",
        }],
        restricted_count: 0,
        has_more: false,
      },
    },
  },
};
export const LoadingMore: Story = {
  args: {
    value: visibleAndRestrictedValue,
    onLoadMore: () => new Promise<never>(() => undefined),
  },
};
export const LoadError: Story = {
  args: {
    value: visibleAndRestrictedValue,
    onLoadMore: () => Promise.reject(new Error("Relation targets are unavailable")),
  },
  play: async ({ canvasElement }) => {
    fireEvent.click(getByRole(canvasElement, "button", {
      name: "Edit Blocked by relation",
    }));
    fireEvent.click(await waitFor(() => getByRole(document.body, "button", {
      name: "Load more selected",
    })));
    await waitFor(() => getByRole(document.body, "button", {
      name: "Couldn’t load selected pages. Retry",
    }));
  },
};
export const SearchError: Story = {
  args: {
    value: null,
    onSearchCandidates: () => Promise.reject(new Error("Transport unavailable")),
  },
  play: async ({ canvasElement }) => {
    fireEvent.click(getByRole(canvasElement, "button", {
      name: "Edit Blocked by relation",
    }));
    await waitFor(() => getByRole(document.body, "button", {
      name: "Couldn’t load pages. Retry",
    }));
  },
};
