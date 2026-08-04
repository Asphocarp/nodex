import type { Meta, StoryObj } from "@storybook/react-vite";
import { RelationPropertyEditor } from "./relation-property-editor";

const meta = {
  title: "Workbench/RelationPropertyEditor",
  component: RelationPropertyEditor,
  args: {
    label: "Blocked by",
    candidates: [{ pageId: "page:c", title: "Ship editor" }],
    disabled: false,
    targetMatchesCurrentSource: true,
    onPatch: () => undefined,
    onClear: () => undefined,
  },
} satisfies Meta<typeof RelationPropertyEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = { args: { value: null } };

export const VisibleAndRestricted: Story = {
  args: {
    value: {
      kind: "relation",
      value: {
        value_revision: 4,
        total_count: 5,
        targets: [
          { kind: "visible", page_id: "page:a", title: "Define migration", lifecycle: "active", membership_state: "active_in_target_source" },
          { kind: "visible", page_id: "page:b", title: "Verify retention", lifecycle: "archived", membership_state: "archived" },
          { kind: "restricted" },
        ],
        restricted_count: 1,
        has_more: true,
      },
    },
  },
};

export const ReadOnly: Story = {
  args: { ...VisibleAndRestricted.args, disabled: true },
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
    ...VisibleAndRestricted.args,
    onLoadMore: () => new Promise<never>(() => undefined),
  },
};

export const LoadError: Story = {
  args: {
    ...VisibleAndRestricted.args,
    onLoadMore: () => Promise.reject(new Error("Relation targets are unavailable")),
  },
};
