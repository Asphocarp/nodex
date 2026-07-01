import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { NodexTooltipProvider as TooltipProvider } from "@/components/ui/tooltip";
import { CODEX_DEFAULT_SERVICE_TIER_STORAGE_KEY } from "@/lib/codex-service-tier-settings";
import { writeAtom } from "@/lib/persisted-atom-store";
import type {
  CodexCollaborationModeKind,
  CodexModelOption,
  CodexPermissionMode,
  CodexReasoningEffortOption,
} from "@/lib/types";
import type { ThreadFooterModel, ThreadStageActions } from "../../thread-stage-types";
import {
  buildThreadStageStorySurfaceModels,
  buildThreadStageStoryScenario,
  type ThreadStageStoryControls,
} from "../thread-stage-story-fixtures";
import { ThreadComposer } from "./local-conversation-thread-composer";
import { PROMPT_HISTORY_ATOM_KEY } from "./thread-composer-prompt-history";

interface ComposerSendButtonStoryProps {
  isQueueingEnabled: boolean;
  composerEnterBehavior: "enter" | "cmdIfMultiline";
  draftPrompt: string;
  initialServiceTier: "standard" | "fast";
  permissionMode: CodexPermissionMode;
  selectedModel: string;
  selectedModelDisplayName: string;
  modelCatalog: "default" | "expanded";
  selectedModelReasoningSupport: "default" | "highOnly";
  selectedCollaborationMode: CodexCollaborationModeKind;
  threadState: "existingThread" | "newChat";
  surfaceWidth: "normal" | "narrow";
  addContextState: "default" | "ideConnected" | "plugins";
  seedPromptHistory: boolean;
}

const LONG_PROMPT_STORY_DRAFT = Array.from(
  { length: 32 },
  (_, index) => `Refine the composer scroll behavior pass ${index + 1}: keep the native textarea as the only vertical scroll surface while preserving the footer controls.`,
).join("\n");

function resolveStoryReasoningOptions(args: ComposerSendButtonStoryProps, fallback: CodexReasoningEffortOption[]) {
  if (args.selectedModelReasoningSupport === "highOnly") {
    return [
      {
        reasoningEffort: "high" as const,
        description: "Spend more time reasoning before answering.",
      },
    ];
  }

  return fallback;
}

function resolveStoryAvailableModels(input: {
  args: ComposerSendButtonStoryProps;
  footerModel: ThreadFooterModel;
  selectedModelOption: CodexModelOption;
}): CodexModelOption[] {
  const baseModels = [
    input.selectedModelOption,
    ...input.footerModel.availableModels.filter((model) => model.id !== input.args.selectedModel),
  ];

  if (input.args.modelCatalog !== "expanded") {
    return baseModels;
  }

  const expandedModels: CodexModelOption[] = [
    {
      id: "gpt-5.4",
      model: "gpt-5.4",
      displayName: "GPT-5.4",
      description: "Previous stable Codex model.",
      hidden: false,
      isDefault: false,
      defaultReasoningEffort: "high",
      supportedReasoningEfforts: input.footerModel.reasoningEffortOptions,
    },
    {
      id: "gpt-5.4-mini",
      model: "gpt-5.4-mini",
      displayName: "GPT-5.4-Mini",
      description: "Small fast Codex model.",
      hidden: false,
      isDefault: false,
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: input.footerModel.reasoningEffortOptions,
    },
    {
      id: "gpt-5.3-codex-spark",
      model: "gpt-5.3-codex-spark",
      displayName: "GPT-5.3-Codex-Spark",
      description: "Ultra-fast Codex model.",
      hidden: false,
      isDefault: false,
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: input.footerModel.reasoningEffortOptions,
    },
  ];
  const selectedAndExpandedModelIds = new Set([
    input.selectedModelOption.id,
    ...expandedModels.map((model) => model.id),
  ]);

  return [
    input.selectedModelOption,
    ...expandedModels.filter((model) => model.id !== input.selectedModelOption.id),
    ...input.footerModel.availableModels.filter((model) => !selectedAndExpandedModelIds.has(model.id)),
  ];
}

function buildModel(args: ComposerSendButtonStoryProps): ThreadFooterModel {
  const controls: ThreadStageStoryControls = {
    preset: args.threadState === "newChat" ? "new-thread" : "streaming",
    permissionMode: args.permissionMode,
    authenticatedAccount: true,
    isQueueingEnabled: args.isQueueingEnabled,
    collapseAgentBody: false,
  };
  const scenario = buildThreadStageStoryScenario(controls);
  const newChatTarget = scenario.runtime.newThreadTarget
    ? {
        ...scenario.runtime.newThreadTarget,
        sessionId: "session_story",
        runInTarget: "localProject" as const,
      }
    : null;
  const runtime = {
    ...scenario.runtime,
    ...(args.threadState === "newChat"
      ? {
          newThreadTarget: newChatTarget,
        }
      : {}),
    composerIntent: args.draftPrompt.trim().length === 0
      ? null
      : {
        prompt: args.draftPrompt,
        focusNonce: 1,
      },
  };
  const footerModel = buildThreadStageStorySurfaceModels(scenario, controls, runtime).footerModel;
  const selectedModelReasoningOptions = resolveStoryReasoningOptions(args, footerModel.reasoningEffortOptions);
  const selectedModelOption = {
    id: args.selectedModel,
    model: args.selectedModel,
    displayName: args.selectedModelDisplayName,
    description: "Story-selected Codex model.",
    hidden: false,
    isDefault: false,
    defaultReasoningEffort: selectedModelReasoningOptions[0]?.reasoningEffort ?? footerModel.selectedReasoningEffort,
    supportedReasoningEfforts: selectedModelReasoningOptions,
  };

  return {
    ...footerModel,
    availableModels: resolveStoryAvailableModels({ args, footerModel, selectedModelOption }),
    selectedModel: args.selectedModel,
    selectedReasoningEffort: selectedModelReasoningOptions.some((option) => option.reasoningEffort === footerModel.selectedReasoningEffort)
      ? footerModel.selectedReasoningEffort
      : selectedModelReasoningOptions[0]?.reasoningEffort ?? footerModel.selectedReasoningEffort,
    reasoningEffortOptions: selectedModelReasoningOptions,
    selectedCollaborationMode: args.selectedCollaborationMode,
    ...(args.threadState === "newChat" && newChatTarget
      ? {
          newThreadTarget: newChatTarget,
          newThreadProjectSelector: {
            selectedProjectId: newChatTarget.projectId,
            disabled: false,
            canAddProject: true,
            projects: [
              {
                id: newChatTarget.projectId,
                label: newChatTarget.projectName,
                description: footerModel.projectWorkspacePath ?? "/Users/asc/repo/nodex",
                primaryWorkspaceRoot: footerModel.projectWorkspacePath ?? "/Users/asc/repo/nodex",
                searchText: `${newChatTarget.projectId} ${newChatTarget.projectName}`,
              },
              {
                id: "project_devtools_codex",
                label: "Devtools Codex",
                description: "/Users/asc/repo/devtools-codex",
                primaryWorkspaceRoot: "/Users/asc/repo/devtools-codex",
                searchText: "project_devtools_codex devtools codex",
              },
            ],
          },
          newThreadStartInSelector: {
            target: {
              runInTarget: "localProject" as const,
            },
            disabled: false,
            worktreeAvailable: true,
            environments: [],
            environmentsLoading: false,
            selectedEnvironmentPath: null,
            worktreeStartMode: "autoBranch" as const,
            worktreeBranchPrefix: "codex/",
          },
        }
      : {}),
    ...(args.addContextState === "ideConnected"
      ? {
          composerIdeContext: {
            isConnected: true,
            isEnabled: false,
          },
        }
      : {}),
    ...(args.addContextState === "plugins"
      ? {
          composerPlugins: [
            { name: "Computer Use", path: "/plugins/computer-use" },
            { name: "Browser Use", path: "/plugins/browser-use" },
          ],
        }
      : {}),
    composerEnterBehavior: args.composerEnterBehavior,
  };
}

function buildActions(): ThreadStageActions {
  return {
    onCollaborationModeChange: () => { },
    onModelChange: () => { },
    onReasoningEffortChange: () => { },
    onPermissionModeChange: () => { },
    onQueueingEnabledChange: () => { },
    onRefreshAccount: async () => {
      throw new Error("not implemented");
    },
    onStartChatGptLogin: async () => ({ type: "apiKey" }),
    onStartApiKeyLogin: async () => ({ type: "apiKey" }),
    onCancelLogin: async () => { },
    onLogout: async () => { },
    onSendPrompt: async () => { },
    onSteerPrompt: async () => { },
    onInterruptTurn: async () => { },
    onRespondApproval: async () => { },
    onRespondUserInput: async () => { },
    onRespondMcpElicitation: async () => { },
    onResolvePlanImplementationRequest: async () => { },
    onEnqueueQueuedFollowUp: async () => { },
    onRemoveQueuedFollowUp: async () => { },
    onReorderQueuedFollowUps: async () => { },
    onSendQueuedFollowUpNow: async () => { },
    onEditQueuedFollowUp: async () => { },
    onEditLastUserTurn: async () => { },
    onForkFromTurn: async () => { },
    onUnarchiveThread: async () => { },
    onOpenTurnDiffReview: () => { },
    onConsumeComposerIntent: () => { },
    onOpenThread: () => { },
    onCleanBackgroundTerminals: async () => { },
    onNewThreadProjectChange: () => { },
    onRequestNewChatProjectCreate: () => { },
    onNewThreadStartInTargetChange: () => { },
    onNewThreadStartInEnvironmentChange: () => { },
    onRefreshNewThreadStartInEnvironments: async () => { },
    onOpenNewThreadLocalEnvironmentsSettings: () => { },
  };
}

function ComposerSendButtonStory(args: ComposerSendButtonStoryProps) {
  useEffect(() => {
    void writeAtom(
      PROMPT_HISTORY_ATOM_KEY,
      args.seedPromptHistory
        ? {
            thread_storybook: [
              "Re-run the composer prompt history parity checklist.",
              "Apply the latest queued follow-up before restoring history.",
            ],
          }
        : [],
    );
  }, [args.seedPromptHistory]);

  if (typeof localStorage !== "undefined") {
    if (args.initialServiceTier === "fast") {
      localStorage.setItem(CODEX_DEFAULT_SERVICE_TIER_STORAGE_KEY, "fast");
    } else {
      localStorage.removeItem(CODEX_DEFAULT_SERVICE_TIER_STORAGE_KEY);
    }
  }

  const surfaceWidthClassName = args.surfaceWidth === "narrow" ? "max-w-[390px]" : "max-w-3xl";

  return (
    <div className="min-h-[320px] rounded-[24px] border border-(--border) bg-(--background) p-5 shadow-[0_18px_48px_rgba(0,0,0,0.16)]">
      <div className="mb-4 max-w-2xl">
        <div className="text-sm font-semibold text-(--foreground)">Composer Send Button</div>
        <div className="mt-1 text-sm/relaxed text-(--foreground-secondary)">
          Running-thread composer states reconstructed from the Codex Electron send-button state machine. Hover the primary action to inspect the exact running-thread queue-versus-steer tooltip and platform keycaps.
        </div>
      </div>
      <TooltipProvider>
        <div className={surfaceWidthClassName}>
          <ThreadComposer
            model={buildModel(args)}
            actions={buildActions()}
            errorMessage={null}
            onErrorMessage={() => { }}
          />
        </div>
      </TooltipProvider>
    </div>
  );
}

const meta = {
  title: "Workbench/Threads/Composer Send Button",
  component: ComposerSendButtonStory,
  args: {
    isQueueingEnabled: false,
    composerEnterBehavior: "enter",
    draftPrompt: "",
    initialServiceTier: "standard",
    permissionMode: "auto",
    selectedModel: "gpt-5.5",
    selectedModelDisplayName: "GPT-5.5",
    modelCatalog: "default",
    selectedModelReasoningSupport: "default",
    selectedCollaborationMode: "default",
    threadState: "existingThread",
    surfaceWidth: "normal",
    addContextState: "default",
    seedPromptHistory: false,
  },
  argTypes: {
    isQueueingEnabled: {
      control: "boolean",
    },
    composerEnterBehavior: {
      control: "radio",
      options: ["enter", "cmdIfMultiline"],
    },
    draftPrompt: {
      control: "text",
    },
    initialServiceTier: {
      control: "radio",
      options: ["standard", "fast"],
    },
    permissionMode: {
      control: "radio",
      options: ["auto", "full-access", "custom"],
    },
    selectedModel: {
      control: "text",
    },
    selectedModelDisplayName: {
      control: "text",
    },
    modelCatalog: {
      control: "radio",
      options: ["default", "expanded"],
    },
    selectedModelReasoningSupport: {
      control: "radio",
      options: ["default", "highOnly"],
    },
    selectedCollaborationMode: {
      control: "radio",
      options: ["default", "plan"],
    },
    threadState: {
      control: "radio",
      options: ["existingThread", "newChat"],
    },
    surfaceWidth: {
      control: "radio",
      options: ["normal", "narrow"],
    },
    addContextState: {
      control: "radio",
      options: ["default", "ideConnected", "plugins"],
    },
    seedPromptHistory: {
      control: "boolean",
    },
  },
  parameters: {
    docs: {
      description: {
        component:
          "Focused Codex-style parity story for the running-thread composer button. Empty draft keeps Stop; any draft switches to submit, which becomes Steer or Queue based on the queue-follow-ups preference and shows the exact platform keycap tooltip rows.",
      },
    },
  },
} satisfies Meta<typeof ComposerSendButtonStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const RunningStop: Story = {
  args: {
    isQueueingEnabled: false,
    composerEnterBehavior: "enter",
    draftPrompt: "",
  },
};

export const NewChatEmptyNarrow: Story = {
  args: {
    isQueueingEnabled: false,
    composerEnterBehavior: "enter",
    draftPrompt: "",
    threadState: "newChat",
    surfaceWidth: "narrow",
  },
};

export const RunningSteer: Story = {
  args: {
    isQueueingEnabled: false,
    composerEnterBehavior: "enter",
    draftPrompt: "Steer the current run toward the MCP transcript cleanup.",
  },
};

export const RunningQueue: Story = {
  args: {
    isQueueingEnabled: true,
    composerEnterBehavior: "enter",
    draftPrompt: "Queue this after the current tool-call batch finishes.",
  },
};

export const RunningQueueMultilineCmdEnter: Story = {
  args: {
    isQueueingEnabled: true,
    composerEnterBehavior: "cmdIfMultiline",
    draftPrompt: "Queue this after the current tool-call batch finishes.\nInclude a compact reasoning summary.",
  },
};

export const RunningQueueSingleLineCmdIfMultiline: Story = {
  args: {
    isQueueingEnabled: true,
    composerEnterBehavior: "cmdIfMultiline",
    draftPrompt: "Queue this after the current tool-call batch finishes.",
  },
};

export const RunningSteerMultilineCmdEnter: Story = {
  args: {
    isQueueingEnabled: false,
    composerEnterBehavior: "cmdIfMultiline",
    draftPrompt: "Steer the current run toward the MCP transcript cleanup.\nPrefer deduping the approval rows.",
  },
};

export const LongPromptScroll: Story = {
  args: {
    isQueueingEnabled: false,
    composerEnterBehavior: "cmdIfMultiline",
    draftPrompt: LONG_PROMPT_STORY_DRAFT,
    surfaceWidth: "narrow",
  },
};

export const RunningQueueFastTier: Story = {
  args: {
    isQueueingEnabled: true,
    composerEnterBehavior: "enter",
    draftPrompt: "Queue this after the current tool-call batch finishes.",
    initialServiceTier: "fast",
  },
};

export const PromptHistoryAndQueuedFollowUpRecall: Story = {
  args: {
    isQueueingEnabled: true,
    composerEnterBehavior: "enter",
    draftPrompt: "",
    seedPromptHistory: true,
  },
  parameters: {
    docs: {
      description: {
        story:
          "Seeds thread-scoped prompt history while the streaming fixture also exposes a queued follow-up; ArrowUp should consume the latest queued follow-up before restoring history.",
      },
    },
  },
};

export const FastModelIndicator: Story = {
  args: {
    isQueueingEnabled: false,
    composerEnterBehavior: "enter",
    draftPrompt: "",
    initialServiceTier: "fast",
  },
};

export const DefaultIntelligenceSelector: Story = {
  args: {
    isQueueingEnabled: false,
    composerEnterBehavior: "enter",
    draftPrompt: "",
  },
};

export const NewChatStatusStrip: Story = {
  args: {
    isQueueingEnabled: false,
    composerEnterBehavior: "enter",
    draftPrompt: "",
    threadState: "newChat",
  },
};

export const ExpandedModelSubmenu: Story = {
  args: {
    isQueueingEnabled: false,
    composerEnterBehavior: "enter",
    draftPrompt: "",
    initialServiceTier: "fast",
    modelCatalog: "expanded",
  },
};

export const LimitedIntelligenceSupport: Story = {
  args: {
    selectedModel: "gpt-5.5-high-only",
    selectedModelDisplayName: "GPT-5.5 High Only",
    selectedModelReasoningSupport: "highOnly",
  },
};

export const PlanModeActive: Story = {
  args: {
    isQueueingEnabled: false,
    composerEnterBehavior: "enter",
    draftPrompt: "",
    selectedCollaborationMode: "plan",
  },
};

export const PlanKeywordSuggestion: Story = {
  args: {
    isQueueingEnabled: false,
    composerEnterBehavior: "enter",
    draftPrompt: "Plan the migration from local fallback settings to thread-owned next-turn settings.",
    selectedCollaborationMode: "default",
  },
};

export const ExistingThreadSettingsReflected: Story = {
  args: {
    isQueueingEnabled: false,
    composerEnterBehavior: "enter",
    draftPrompt: "",
    selectedCollaborationMode: "plan",
    selectedModel: "gpt-5.3-codex",
    selectedModelDisplayName: "GPT-5.3 Codex",
    selectedModelReasoningSupport: "default",
  },
};

export const NewThreadDraftPlanMode: Story = {
  args: {
    isQueueingEnabled: false,
    composerEnterBehavior: "enter",
    draftPrompt: "",
    threadState: "newChat",
    selectedCollaborationMode: "plan",
  },
};

export const AddContextIdeConnected: Story = {
  args: {
    addContextState: "ideConnected",
  },
};

export const AddContextPlugins: Story = {
  args: {
    addContextState: "plugins",
  },
};

export const InlineSlashCommandMenu: Story = {
  args: {
    draftPrompt: "/",
    modelCatalog: "expanded",
    addContextState: "plugins",
  },
};

export const InlineSlashCommandMenuFiltered: Story = {
  args: {
    draftPrompt: "/mo",
    modelCatalog: "expanded",
  },
};

export const InlineSlashCommandMenuEmpty: Story = {
  args: {
    draftPrompt: "/zzzz",
  },
};

export const FullAccessPermissions: Story = {
  args: {
    permissionMode: "full-access",
  },
};

export const CustomPermissions: Story = {
  args: {
    permissionMode: "custom",
  },
};

export const NarrowLongModelLabel: Story = {
  args: {
    selectedModel: "gpt-5.5-codex-experimental-long-context",
    selectedModelDisplayName: "GPT-5.5 Codex Experimental Long Context",
    surfaceWidth: "narrow",
  },
};
