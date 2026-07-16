import type { Meta, StoryObj } from "@storybook/react-vite";
import { PageStageDevStoryPage } from "./page-stage-dev-story";
import {
  PAGE_STAGE_STORY_DEFAULT_PRESET,
  PAGE_STAGE_STORY_PREVIEW_MODES,
  PAGE_STAGE_STORY_RUN_TARGETS,
  PAGE_STAGE_STORY_THREAD_DENSITIES,
  resolvePageStageStoryPreset,
} from "./page-stage-dev-story-data";

const meta = {
  title: "Kanban/Page Stage",
  component: PageStageDevStoryPage,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Production-backed Page Stage scenarios. Presets are separate stories, and per-scene tuning lives in Storybook Controls instead of an in-canvas sidebar.",
      },
    },
  },
  args: {
    ...PAGE_STAGE_STORY_DEFAULT_PRESET.controls,
  },
  argTypes: {
    runInTarget: {
      control: "inline-radio",
      options: [...PAGE_STAGE_STORY_RUN_TARGETS],
    },
    threadDensity: {
      control: "inline-radio",
      options: [...PAGE_STAGE_STORY_THREAD_DENSITIES],
    },
    previewMode: {
      control: "inline-radio",
      options: [...PAGE_STAGE_STORY_PREVIEW_MODES],
    },
    existingWorktree: {
      control: "boolean",
    },
    showNewThreadAction: {
      control: "boolean",
    },
    enableOpenThread: {
      control: "boolean",
    },
    collapseThreadsByDefault: {
      control: "boolean",
    },
    collapseSecondaryProperties: {
      control: "boolean",
    },
    historyPanelActive: {
      control: "boolean",
    },
    standalone: {
      control: "boolean",
    },
    descriptionVariant: {
      control: "inline-radio",
      options: ["default", "heading-rail", "few-headings"],
    },
    renderPreview: {
      table: {
        disable: true,
      },
    },
  },
} satisfies Meta<typeof PageStageDevStoryPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Overview: Story = {};

export const DenseThreads: Story = {
  args: {
    ...resolvePageStageStoryPreset("dense-threads").controls,
  },
};

export const NewWorktreeSetup: Story = {
  args: {
    ...resolvePageStageStoryPreset("new-worktree-setup").controls,
  },
};

export const ExistingWorktree: Story = {
  args: {
    ...resolvePageStageStoryPreset("existing-worktree").controls,
  },
};

export const CloudCollapsed: Story = {
  args: {
    ...resolvePageStageStoryPreset("cloud-collapsed").controls,
  },
};

export const NestedPageWithoutProperties: Story = {
  args: {
    ...resolvePageStageStoryPreset("overview").controls,
    standalone: true,
    threadDensity: "none",
    previewMode: "none",
    showNewThreadAction: false,
    enableOpenThread: false,
    collapseThreadsByDefault: false,
    collapseSecondaryProperties: false,
  },
  parameters: {
    docs: {
      description: {
        story: "A nested standalone Page omits the Properties section when no property rows are available.",
      },
    },
  },
};

export const HeadingRail: Story = {
  args: {
    ...resolvePageStageStoryPreset("overview").controls,
    descriptionVariant: "heading-rail",
  },
};

export const HeadingRailScrub: Story = {
  args: {
    ...resolvePageStageStoryPreset("overview").controls,
    descriptionVariant: "heading-rail",
  },
  parameters: {
    docs: {
      description: {
        story: "Drag over the left heading rail to inspect instant scrub navigation and the shared marker states.",
      },
    },
  },
};

export const HeadingRailFewHeadingsHidden: Story = {
  args: {
    ...resolvePageStageStoryPreset("overview").controls,
    descriptionVariant: "few-headings",
  },
};

export const HeadingRailFullWidth: Story = {
  args: {
    ...resolvePageStageStoryPreset("existing-worktree").controls,
    descriptionVariant: "heading-rail",
  },
};

export const HeadingRailDark: Story = {
  args: {
    ...resolvePageStageStoryPreset("cloud-collapsed").controls,
    descriptionVariant: "heading-rail",
  },
  parameters: {
    backgrounds: {
      default: "dark",
    },
  },
};
