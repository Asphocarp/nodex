import type { Meta, StoryObj } from "@storybook/react-vite";
import { fireEvent, getByRole, waitFor } from "@testing-library/dom";
import { parseDataSourceId, parseDataSourcePropertyId } from "../../../shared/database-identities";
import { testPropertySemantics } from "../../../shared/testing/database-property-record";
import type { DataSourcePropertyRecordV2 } from "../../../shared/database-module-v2";
import { PageCreateDialog } from "./page-create-dialog";

const timestamp = "2026-08-08T00:00:00.000Z";
const property = (
  propertyId: "priority" | "estimate" | "tags",
  valueType: "select" | "multi_select",
): DataSourcePropertyRecordV2 => ({
  propertyId: parseDataSourcePropertyId(propertyId),
  dataSourceId: parseDataSourceId("source-story"),
  name: propertyId,
  ...testPropertySemantics(valueType, 3),
  valueType,
  config:
    propertyId === "tags"
      ? {
          options: [
            { id: "tag-ui", name: "UI", color: "blue" },
            { id: "tag-product", name: "Product", color: "green" },
            { id: "tag-polish", name: "Polish", color: "orange" },
          ],
        }
      : {},
  rankKey: propertyId,
  lifecycle: "active",
  revision: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
});

const target = {
  surfaceId: "surface-story",
  panelTabId: "tab-story",
  project: {
    id: "project-story",
    name: "Nodex Desktop",
    appearance: {
      color: "blue" as const,
      marker: { kind: "icon" as const, icon: "terminal" as const },
    },
  },
  databaseViewId: "view-story",
  clientSessionId: "session-story",
  accessContext: { kind: "project" as const, projectId: "project-story" },
  properties: [
    property("priority", "select"),
    property("estimate", "select"),
    property("tags", "multi_select"),
  ],
  columns: [
    { id: "triage" as const, name: "Triage" },
    { id: "plan" as const, name: "Plan" },
    { id: "build" as const, name: "Build" },
    { id: "ship" as const, name: "Ship" },
  ],
  readOnlyReason: null,
};

const origin = {
  surfaceId: target.surfaceId,
  panelTabId: target.panelTabId,
  projectId: target.project.id,
  databaseViewId: target.databaseViewId,
  kind: "header" as const,
  columnId: "plan" as const,
};

const referenceViewport = {
  defaultViewport: "composer-reference",
  options: {
    "composer-reference": {
      name: "Composer reference (1800×1131)",
      styles: { width: "1800px", height: "1131px" },
    },
  },
};

const narrowViewport = {
  defaultViewport: "composer-narrow",
  options: {
    "composer-narrow": {
      name: "Composer narrow (390×844)",
      styles: { width: "390px", height: "844px" },
    },
  },
};

const meta = {
  title: "Board/Page create dialog",
  component: PageCreateDialog,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    requestId: "storybook-request",
    target,
    origin,
    onClose: () => undefined,
  },
} satisfies Meta<typeof PageCreateDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

const openPropertyPicker = async (
  canvasElement: HTMLElement,
  label: "Status" | "Priority" | "Estimate",
) => {
  await waitFor(() => {
    const title = getByRole(canvasElement, "textbox", { name: "Page title" });
    if (document.activeElement !== title) {
      throw new Error("Waiting for Page create autofocus.");
    }
  });
  fireEvent.click(getByRole(canvasElement, "button", { name: label }));
  await waitFor(() =>
    getByRole(document.body, "combobox", {
      name: `Search ${label} options`,
    }),
  );
};

export const Default: Story = {
  parameters: {
    viewport: referenceViewport,
    docs: {
      description: {
        story:
          "The composer presents Status, Priority, Estimate, and Tags as one compact chip strip; empty chips retain their semantic icons and property names.",
      },
    },
  },
};

export const StatusPickerOpen: Story = {
  parameters: {
    viewport: referenceViewport,
    docs: {
      description: {
        story:
          "The Status pill opens the compact searchable property picker with the current workflow state highlighted.",
      },
    },
  },
  play: ({ canvasElement }) => openPropertyPicker(canvasElement, "Status"),
};

export const PriorityPickerOpen: Story = {
  parameters: {
    viewport: referenceViewport,
    docs: {
      description: {
        story:
          "Priority uses the same searchable semantic picker, including an explicit No priority action once a value is selected.",
      },
    },
  },
  args: {
    restoredSnapshot: {
      title: "Choose a priority",
      descriptionNfm: "",
      status: "plan",
      priority: "p1-high",
      estimate: null,
      tagNames: [],
      createMore: false,
      expanded: false,
    },
  },
  play: ({ canvasElement }) => openPropertyPicker(canvasElement, "Priority"),
};

export const EstimatePickerOpen: Story = {
  parameters: {
    viewport: referenceViewport,
    docs: {
      description: {
        story:
          "Estimate shares the searchable semantic picker and presents the canonical size scale in order.",
      },
    },
  },
  args: {
    restoredSnapshot: {
      title: "Choose an estimate",
      descriptionNfm: "",
      status: "plan",
      priority: null,
      estimate: "m",
      tagNames: [],
      createMore: false,
      expanded: false,
    },
  },
  play: ({ canvasElement }) => openPropertyPicker(canvasElement, "Estimate"),
};

export const ExpandedRestoredDraft: Story = {
  parameters: { viewport: referenceViewport },
  args: {
    requestId: "storybook-expanded-request",
    restoredSnapshot: {
      title: "Prepare the release narrative",
      descriptionNfm: "Explain the user-visible outcome and the decisions behind it.",
      status: "build",
      priority: "p1-high",
      estimate: "m",
      tagNames: ["Product", "Polish"],
      createMore: false,
      expanded: true,
    },
  },
};

export const NarrowCompact: Story = {
  parameters: { viewport: narrowViewport },
  args: {
    requestId: "storybook-narrow-compact-request",
    restoredSnapshot: {
      title: "Keep the compact composer usable in a narrow panel",
      descriptionNfm:
        "Properties wrap below the continuous writing plane without creating nested cards.",
      status: "plan",
      priority: "p2-medium",
      estimate: "s",
      tagNames: ["UI", "Product", "Polish"],
      createMore: true,
      expanded: false,
    },
  },
};

export const NarrowExpanded: Story = {
  parameters: { viewport: narrowViewport },
  args: {
    requestId: "storybook-narrow-expanded-request",
    restoredSnapshot: {
      title: "Expand the writing plane without losing the draft",
      descriptionNfm:
        "The description absorbs the available height while properties and actions stay anchored below it.",
      status: "build",
      priority: "p1-high",
      estimate: "m",
      tagNames: ["UI", "Polish"],
      createMore: false,
      expanded: true,
    },
  },
};

export const WrappedProperties: Story = {
  parameters: {
    viewport: {
      defaultViewport: "composer-wrap",
      options: {
        "composer-wrap": {
          name: "Property wrapping (560×844)",
          styles: { width: "560px", height: "844px" },
        },
      },
    },
  },
  args: {
    requestId: "storybook-wrapped-properties-request",
    target: {
      ...target,
      project: {
        ...target.project,
        name: "Nodex Desktop Release Workspace",
      },
    },
    restoredSnapshot: {
      title: "Preserve density when property labels grow",
      descriptionNfm:
        "Each property remains one compact chip and the strip wraps as a single group.",
      status: "ship",
      priority: "p0-critical",
      estimate: "xl",
      tagNames: ["Product", "Polish"],
      createMore: false,
      expanded: false,
    },
  },
};

export const MinimalSchema: Story = {
  args: {
    requestId: "storybook-minimal-request",
    target: {
      ...target,
      properties: [],
    },
  },
};

export const DarkExpanded: Story = {
  globals: { theme: "dark" },
  parameters: { viewport: referenceViewport },
  args: {
    requestId: "storybook-dark-expanded-request",
    restoredSnapshot: {
      title: "Review the expanded composer in dark mode",
      descriptionNfm:
        "The writing plane stays flat; contrast comes from the shared modal surface and restrained focus boundary.",
      status: "build",
      priority: "p1-high",
      estimate: "l",
      tagNames: ["UI", "Polish"],
      createMore: true,
      expanded: true,
    },
  },
};
