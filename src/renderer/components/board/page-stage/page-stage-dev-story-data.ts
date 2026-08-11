import type { PageStageCollapsibleProperty } from "../../../lib/page-stage-collapsed-properties";
import type { DatabasePage, PageRunInTarget } from "../../../lib/types";
import { plainTextToPortableRichText } from "../../../../shared/block-documents";
import type { PageStageLinkedThread } from "./types";

export type PageStageStoryThreadDensity = "none" | "few" | "many";
export type PageStageStoryPreviewMode = "none" | "mixed" | "all";
export const PAGE_STAGE_STORY_RUN_TARGETS = ["localProject", "newWorktree", "cloud"] as const;
export const PAGE_STAGE_STORY_THREAD_DENSITIES = ["none", "few", "many"] as const;
export const PAGE_STAGE_STORY_PREVIEW_MODES = ["none", "mixed", "all"] as const;

export interface PageStageStoryControls {
  runInTarget: PageRunInTarget;
  threadDensity: PageStageStoryThreadDensity;
  previewMode: PageStageStoryPreviewMode;
  existingWorktree: boolean;
  showNewThreadAction: boolean;
  enableOpenThread: boolean;
  collapseThreadsByDefault: boolean;
  collapseSecondaryProperties: boolean;
  historyPanelActive: boolean;
}

export interface PageStageStoryPreset {
  id: string;
  name: string;
  description: string;
  controls: PageStageStoryControls;
}

export const PAGE_STAGE_STORY_PROJECT_ID = "nodex";
export const PAGE_STAGE_STORY_COLUMN_ID = "6-in-progress";
export const PAGE_STAGE_STORY_COLUMN_NAME = "Build";
export const PAGE_STAGE_STORY_WORKSPACE_PATH = "/workspace/nodex";
export const PAGE_STAGE_STORY_WORKTREE_PATH = "/workspace/.codex/worktrees/8153/nodex-page-stage";

export const PAGE_STAGE_STORY_PRESETS: PageStageStoryPreset[] = [
  {
    id: "overview",
    name: "Overview",
    description: "Balanced page stage with linked threads, tags, schedule, and all major chrome visible.",
    controls: {
      runInTarget: "localProject",
      threadDensity: "few",
      previewMode: "mixed",
      existingWorktree: false,
      showNewThreadAction: true,
      enableOpenThread: true,
      collapseThreadsByDefault: false,
      collapseSecondaryProperties: false,
      historyPanelActive: false,
    },
  },
  {
    id: "dense-threads",
    name: "Dense Threads",
    description: "Long linked-thread stack to refine scrolling, truncation, and spacing.",
    controls: {
      runInTarget: "localProject",
      threadDensity: "many",
      previewMode: "mixed",
      existingWorktree: false,
      showNewThreadAction: true,
      enableOpenThread: true,
      collapseThreadsByDefault: false,
      collapseSecondaryProperties: true,
      historyPanelActive: false,
    },
  },
  {
    id: "new-worktree-setup",
    name: "New Worktree",
    description: "Fresh worktree state with branch and environment selectors visible before a thread starts.",
    controls: {
      runInTarget: "newWorktree",
      threadDensity: "none",
      previewMode: "mixed",
      existingWorktree: false,
      showNewThreadAction: true,
      enableOpenThread: true,
      collapseThreadsByDefault: false,
      collapseSecondaryProperties: false,
      historyPanelActive: false,
    },
  },
  {
    id: "existing-worktree",
    name: "Existing Worktree",
    description: "Existing managed worktree plus a couple linked threads so the reset affordance can be tuned.",
    controls: {
      runInTarget: "newWorktree",
      threadDensity: "few",
      previewMode: "all",
      existingWorktree: true,
      showNewThreadAction: true,
      enableOpenThread: true,
      collapseThreadsByDefault: false,
      collapseSecondaryProperties: true,
      historyPanelActive: false,
    },
  },
  {
    id: "cloud-collapsed",
    name: "Cloud Collapsed",
    description: "Cloud target copy plus collapsed threads defaults to inspect hidden-property affordances.",
    controls: {
      runInTarget: "cloud",
      threadDensity: "few",
      previewMode: "none",
      existingWorktree: false,
      showNewThreadAction: true,
      enableOpenThread: false,
      collapseThreadsByDefault: true,
      collapseSecondaryProperties: true,
      historyPanelActive: true,
    },
  },
];

export const PAGE_STAGE_STORY_DEFAULT_PRESET = PAGE_STAGE_STORY_PRESETS[0];

function countForDensity(density: PageStageStoryThreadDensity): number {
  if (density === "few") return 3;
  if (density === "many") return 10;
  return 0;
}

function buildThreadPreview(index: number, mode: PageStageStoryPreviewMode): string | undefined {
  if (mode === "none") return undefined;
  if (mode === "mixed" && index % 2 === 1) return undefined;

  const previews = [
    "Tighten the linked thread row spacing so previews align with long titles.",
    "Validate hover, disabled, and keyboard focus states before shipping the new chrome.",
    "Compare scroll density when thread previews wrap versus staying single-line.",
    "Re-check the new worktree and cloud copy after the page stage layout pass.",
  ];

  return previews[index % previews.length];
}

export function buildPageStageStoryThreads(
  controls: Pick<PageStageStoryControls, "threadDensity" | "previewMode">,
  extraThreadCount = 0,
): PageStageLinkedThread[] {
  const total = Math.max(0, countForDensity(controls.threadDensity) + Math.max(0, extraThreadCount));

  return Array.from({ length: total }, (_, index) => ({
    threadId: `story-thread-${index + 1}`,
    title: index === 0
      ? "Polish page stage thread affordances"
      : `Page detail iteration ${String(index + 1).padStart(2, "0")}`,
    preview: buildThreadPreview(index, controls.previewMode),
    statusType: index === 0 ? "active" : "idle",
    statusActiveFlags: [],
    archived: false,
    updatedAt: Date.now() - (index + 1) * 60_000,
  }));
}

export function buildPageStageStoryPage(controls: Pick<PageStageStoryControls, "runInTarget" | "existingWorktree">): DatabasePage {
  const isLocalProject = controls.runInTarget === "localProject";
  const isNewWorktree = controls.runInTarget === "newWorktree";

  return {
    id: "story-page-stage-1",
    status: "build",
    archived: false,
    title: "Refine page stage thread property UI",
    richTitle: plainTextToPortableRichText("Refine page stage thread property UI"),
    description: [
      "## Story intent",
      "",
      "Use this development-only surface to iterate on the page stage without opening a real project page.",
      "Focus on the **Threads** property row: thread count badge, linked thread list density, CTA placement, and copy.",
      "",
      "- Verify truncation for long thread titles",
      "- Compare empty, sparse, and dense linked-thread stacks",
      "- Tune run target labels while switching between local, new worktree, and cloud",
      "",
      "### Notes",
      "The save handlers are mocked, so this story is safe to edit locally while refining layout.",
    ].join("\n"),
    priority: "p1-high",
    estimate: "m",
    tags: ["ui", "threads", "page-stage"],
    dueDate: new Date("2026-03-08T09:00:00.000Z"),
    scheduledStart: new Date("2026-03-05T14:00:00.000Z"),
    scheduledEnd: new Date("2026-03-05T15:00:00.000Z"),
    reminders: [{ offsetMinutes: 30 }],
    assignee: "asc",
    runInTarget: controls.runInTarget,
    runInLocalPath: isLocalProject ? "src/renderer/components/board" : undefined,
    runInBaseBranch: isNewWorktree ? "main" : undefined,
    runInWorktreePath: isNewWorktree && controls.existingWorktree
      ? PAGE_STAGE_STORY_WORKTREE_PATH
      : undefined,
    runInEnvironmentPath: isNewWorktree ? ".codex/environments/ui-polish.toml" : undefined,
    created: new Date("2026-03-04T09:30:00.000Z"),
    order: 0,
  };
}

export function buildPageStageStoryCollapsedProperties(
  controls: Pick<PageStageStoryControls, "collapseThreadsByDefault" | "collapseSecondaryProperties">,
): PageStageCollapsibleProperty[] {
  const properties: PageStageCollapsibleProperty[] = [];

  if (controls.collapseSecondaryProperties) {
    properties.unshift("tags", "assignee");
  }

  if (controls.collapseThreadsByDefault) {
    properties.push("threads");
  }

  return properties;
}

export function resolvePageStageStoryPreset(id: string): PageStageStoryPreset {
  return PAGE_STAGE_STORY_PRESETS.find((preset) => preset.id === id) ?? PAGE_STAGE_STORY_DEFAULT_PRESET;
}
