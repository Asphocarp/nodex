import { useForm, useStore } from "@tanstack/react-form";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { handleFormSubmit } from "@/lib/forms";
import {
  formatCodexModelLabel,
  formatCodexReasoningEffortLabel,
  resolveCodexReasoningEffortOptions,
} from "@/lib/codex-thread-settings";
import { resolveContextWindowIndicatorState } from "@/lib/codex-context-window";
import type { CodexCollaborationModeKind, CodexPermissionState, CodexPromptInput, CodexReasoningEffort } from "@/lib/types";
import type { ComposerPickedFile } from "../../../../../shared/ipc-api";
import { shouldSubmitComposerPromptFromKeyDown } from "@/lib/composer-enter-behavior";
import { useCodexServiceTierSettings } from "@/lib/use-codex-service-tier-settings";
import {
  resolveThreadInProgressFollowUpMode,
  resolveShortcutKeycapTokens,
  resolveThreadComposerAlternateShortcutAccelerator,
  resolveThreadComposerPrimaryShortcutAccelerator,
  shouldInvertThreadInProgressFollowUpModeFromKeyDown,
} from "@/lib/thread-composer-follow-up-mode";
import {
  resolveStageThreadsComposerActionState,
  type StageThreadsBusyAction,
  type StageThreadsComposerSubmitAction,
} from "../shared/composer-action";
import { resolvePromptTextareaSize } from "../shared/prompt-textarea-size";
import { cn } from "../../../../lib/utils";
import {
  CodexFastModeIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ComposerAddFilesIcon,
  ComposerIdeContextIcon,
  ComposerPlanModeCloseIcon,
  ComposerPlanModeIcon,
  ComposerPluginsIcon,
  MicIcon,
  PlusIcon,
  SpinnerIcon,
  StopIcon,
  UpArrowIcon,
} from "@/components/shared/icons";
import { ShortcutKeycaps } from "@/components/ui/shortcut-keycaps";
import type { ThreadFooterModel, ThreadStageActions } from "../../thread-stage-types";
import { ComposerActionTooltipContent } from "./composer-submit-tooltip";
import {
  formatComposerDictationDuration,
  isComposerDictationShortcut,
  isComposerDictationShortcutTargetBlocked,
  useComposerDictation,
} from "./use-composer-dictation";
import {
  ContextWindowIndicator,
  invoke,
  NodexDropdownFlyoutSubmenuItem,
  NodexDropdownItem,
  NodexDropdownMenu,
  NodexDropdownSection,
  NodexDropdownSelectedIcon,
  NodexDropdownSeparator,
  NodexDropdownTitle,
  NodexTooltip,
  PermissionModeDropdown,
  resolvePromptTextareaMaxHeightPx,
} from "./local-conversation-thread-composer-deps";
import { ThreadComposerStatusStrip } from "./local-conversation-thread-composer-status-strip";

interface ThreadComposerProps {
  model: ThreadFooterModel;
  actions: ThreadStageActions;
  errorMessage: string | null;
  onErrorMessage: (message: string | null) => void;
}

const SERVICE_TIER_OPTIONS = [
  {
    value: null,
    label: "Standard",
    description: "Default speed, normal usage",
  },
  {
    value: "fast" as const,
    label: "Fast",
    description: "1.5x speed, increased usage",
  },
];

function isElectronLikeComposerEnvironment(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  if (window.api) {
    return true;
  }

  return document.documentElement.dataset.codexWindowType === "electron";
}

function renderModelSelectorLabel(input: {
  availableModels: ThreadFooterModel["availableModels"];
  selectedModel: string;
  serviceTier: null | "fast";
  compact?: boolean;
}) {
  const label = input.compact
    ? formatCompactCodexModelLabel(input.selectedModel, input.availableModels)
    : formatCodexModelLabel(input.selectedModel, input.availableModels);
  const showFastModeIndicator = input.serviceTier === "fast";

  return (
    <span className="flex min-w-0 items-center gap-1 tabular-nums">
      {showFastModeIndicator ? (
        <span data-fast-mode-indicator="true">
          <CodexFastModeIcon className="text-token-link-foreground" />
        </span>
      ) : null}
      <span className="truncate whitespace-nowrap">{label}</span>
    </span>
  );
}

function formatCompactCodexModelLabel(modelId: string, models: ThreadFooterModel["availableModels"]): string {
  const label = formatCodexModelLabel(modelId, models).trim();
  if (!label) return modelId;

  const withoutGptPrefix = label.replace(/^GPT(?:[-\s])?/i, "");
  const withoutCodexSuffix = withoutGptPrefix.replace(/(?:[-\s])?Codex.*$/i, "");
  const compact = withoutCodexSuffix.trim();
  return compact || label;
}

const COMPOSER_IMAGE_FILE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "tiff",
  "tif",
  "heic",
  "heif",
]);

interface ComposerFileAttachment {
  id: string;
  label: string;
  path: string;
}

interface ComposerImageAttachment {
  id: string;
  filename: string;
  path: string;
  dataUrl: string;
}

interface ComposerSkillMentionAttachment {
  id: string;
  name: string;
  path: string;
}

interface ComposerAttachmentState {
  fileAttachments: ComposerFileAttachment[];
  imageAttachments: ComposerImageAttachment[];
  skillMentions: ComposerSkillMentionAttachment[];
}

function createComposerAttachmentId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getComposerPickedFileName(file: ComposerPickedFile): string {
  return file.label.trim() || file.path.split(/[\\/]/u).filter(Boolean).at(-1) || "Attachment";
}

function isComposerImageFile(file: ComposerPickedFile): boolean {
  const name = getComposerPickedFileName(file);
  const extension = name.split(".").at(-1)?.toLowerCase() ?? "";
  return COMPOSER_IMAGE_FILE_EXTENSIONS.has(extension);
}

function buildComposerPromptInput(input: {
  prompt: string;
  attachments: ComposerAttachmentState;
}): CodexPromptInput | undefined {
  const text = input.prompt.trim();
  const images = input.attachments.imageAttachments.map((attachment) => ({
    source: attachment.dataUrl,
    caption: attachment.filename,
  }));
  const mentions = input.attachments.fileAttachments.map((attachment) => ({
    name: attachment.label,
    path: attachment.path,
  }));
  const skills = input.attachments.skillMentions.map((attachment) => ({
    name: attachment.name,
    path: attachment.path,
  }));

  if (images.length === 0 && mentions.length === 0 && skills.length === 0) {
    return undefined;
  }

  return {
    text,
    ...(images.length > 0 ? { images } : {}),
    ...(mentions.length > 0 ? { mentions } : {}),
    ...(skills.length > 0 ? { skills } : {}),
  };
}

function canStartNewThreadTarget(model: ThreadFooterModel): boolean {
  return Boolean(
    model.isNewThreadTab &&
    model.newThreadTarget !== null &&
    !model.isCloudNewThreadTarget &&
    (model.newThreadTarget.cardId || model.newThreadTarget.sessionId),
  );
}

function hasComposerAttachmentStateContent(attachments: ComposerAttachmentState): boolean {
  return attachments.fileAttachments.length > 0
    || attachments.imageAttachments.length > 0
    || attachments.skillMentions.length > 0;
}

export const __composerAddContextTestUtils = {
  buildComposerPromptInput,
  isComposerImageFile,
};

function ComposerMenuSwitch({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-state={checked ? "checked" : "unchecked"}
      className={cn(
        "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full",
        checked ? "bg-token-text-link-foreground" : "bg-token-foreground/10",
      )}
    >
      <span
        data-state={checked ? "checked" : "unchecked"}
        className={cn(
          "h-3 w-3 rounded-full border border-[color:var(--gray-0)] bg-[color:var(--gray-0)] shadow-sm",
          checked ? "translate-x-[14px]" : "translate-x-[2px]",
        )}
      />
    </span>
  );
}

function ComposerAddContextDropdown({
  model,
  actions,
  disabled,
  onPickFiles,
  onInsertPlugin,
}: {
  model: ThreadFooterModel;
  actions: ThreadStageActions;
  disabled?: boolean;
  onPickFiles: () => Promise<void>;
  onInsertPlugin: (plugin: NonNullable<ThreadFooterModel["composerPlugins"]>[number]) => void;
}) {
  const isImagesOnly = model.isCloudNewThreadTarget;
  const triggerLabel = isImagesOnly ? "Add photos and more" : "Add files and more";
  const primaryLabel = isImagesOnly ? "Add photos" : "Add photos & files";
  const ideContext = model.composerIdeContext;
  const showIdeContext = ideContext?.isConnected === true;
  const plugins = model.composerPlugins ?? [];
  const hasPlugins = plugins.length > 0;

  return (
    <NodexDropdownMenu
      disabled={disabled}
      triggerButton={(
        <button
          type="button"
          className="inline-flex size-7 items-center justify-center rounded-full border border-transparent px-0 text-(--foreground-tertiary) hover:bg-(--background-tertiary) hover:text-(--foreground-secondary)"
          aria-label={triggerLabel}
          title={triggerLabel}
          disabled={disabled}
        >
          <PlusIcon className="size-4" />
        </button>
      )}
      side="top"
      align="start"
      contentWidth="icon"
    >
      <NodexDropdownItem
        leftSlot={<ComposerAddFilesIcon className="opacity-75 group-focus:opacity-100 group-hover:opacity-100" />}
        onSelect={() => {
          void onPickFiles();
        }}
        data-add-context-row="picker"
      >
        {primaryLabel}
      </NodexDropdownItem>

      {(showIdeContext || model.collaborationModes.some((mode) => mode.mode === "plan")) ? (
        <NodexDropdownSeparator />
      ) : null}

      {showIdeContext ? (
        <NodexDropdownItem
          leftSlot={<ComposerIdeContextIcon className="opacity-75 group-focus:opacity-100 group-hover:opacity-100" />}
          rightSlot={<ComposerMenuSwitch checked={ideContext.isEnabled} />}
          onSelect={() => {
            actions.onComposerIdeContextEnabledChange?.(!ideContext.isEnabled);
          }}
          data-add-context-row="ide-context"
        >
          Include IDE context
        </NodexDropdownItem>
      ) : null}

      {model.collaborationModes.some((mode) => mode.mode === "plan") ? (
        <NodexDropdownItem
          leftSlot={<ComposerPlanModeIcon className="opacity-75 group-focus:opacity-100 group-hover:opacity-100" />}
          rightSlot={<ComposerMenuSwitch checked={model.selectedCollaborationMode === "plan"} />}
          onSelect={() => {
            actions.onCollaborationModeChange(model.selectedCollaborationMode === "plan" ? "default" : "plan");
          }}
          data-add-context-row="plan-mode"
        >
          Plan mode
        </NodexDropdownItem>
      ) : null}

      {hasPlugins ? (
        <>
          <NodexDropdownSeparator />
          <NodexDropdownFlyoutSubmenuItem
            label="Plugins"
            contentClassName="min-w-[160px]"
            triggerContent={(
              <div className="flex w-full items-center gap-1.5">
                <ComposerPluginsIcon className="opacity-75 group-focus:opacity-100 group-hover:opacity-100" />
                <span className="min-w-0 flex-1 truncate">Plugins</span>
                <ChevronRightIcon className="icon-xs shrink-0 text-token-input-placeholder-foreground opacity-75 group-focus:opacity-100 group-hover:opacity-100" />
              </div>
            )}
          >
            <NodexDropdownSection className="flex min-w-[160px] flex-col overflow-hidden">
              <NodexDropdownTitle>
                {plugins.length === 1 ? "1 installed plugin" : `${plugins.length} installed plugins`}
              </NodexDropdownTitle>
              <div className="flex max-h-80 flex-col overflow-y-auto">
                {plugins.map((plugin) => (
                  <NodexDropdownItem
                    key={`${plugin.path}:${plugin.name}`}
                    onSelect={() => onInsertPlugin(plugin)}
                    data-add-context-plugin={plugin.name}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="size-4 shrink-0 rounded bg-token-foreground/10" />
                      <span className="min-w-0 truncate">{plugin.name}</span>
                    </span>
                  </NodexDropdownItem>
                ))}
              </div>
            </NodexDropdownSection>
          </NodexDropdownFlyoutSubmenuItem>
        </>
      ) : null}
    </NodexDropdownMenu>
  );
}

function ActiveComposerModeChip({
  model,
  onSelect,
}: {
  model: ThreadFooterModel;
  onSelect: (mode: CodexCollaborationModeKind) => void;
}) {
  if (model.selectedCollaborationMode !== "plan") {
    return null;
  }

  return (
    <NodexTooltip
      tooltipContent={<PlanModeTooltipContent />}
      side="top"
      align="center"
      sideOffset={4}
      tooltipBodyClassName="text-center"
    >
      <button
        type="button"
        aria-label="Plan"
        className="group inline-flex h-7 shrink-0 cursor-interaction items-center gap-1 rounded-full border border-transparent bg-token-text-link-foreground/10 px-2 py-0 text-sm/4.5 text-token-text-link-foreground hover:bg-token-text-link-foreground/10 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
        onClick={() => {
          onSelect("default");
        }}
      >
        <span data-plan-mode-icon="plan" className="inline-flex shrink-0 group-hover:hidden">
          <ComposerPlanModeIcon />
        </span>
        <span data-plan-mode-icon="close" className="hidden shrink-0 group-hover:inline-flex">
          <ComposerPlanModeCloseIcon />
        </span>
        <span className="composer-footer__label--sm max-w-16 truncate">Plan</span>
      </button>
    </NodexTooltip>
  );
}

function PlanModeTooltipContent() {
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <span>Create a plan</span>
      <span className="inline-flex items-center gap-1 text-token-description-foreground">
        <ShortcutKeycaps keys={["Shift + Tab"]} />
        <span>to toggle</span>
      </span>
    </div>
  );
}

function resolveReasoningEffortForModelChange(input: {
  currentReasoningEffort: CodexReasoningEffort;
  nextModelId: string;
  models: ThreadFooterModel["availableModels"];
}): CodexReasoningEffort | null {
  const nextModel = input.models.find((candidate) => candidate.id === input.nextModelId && !candidate.hidden);
  const supportedOptions = resolveCodexReasoningEffortOptions(input.nextModelId, input.models);
  const supportedEfforts = new Set(supportedOptions.map((option) => option.reasoningEffort));

  if (supportedEfforts.has(input.currentReasoningEffort)) {
    return input.currentReasoningEffort;
  }

  const preferredEfforts: Array<CodexReasoningEffort | null | undefined> = [
    nextModel?.defaultReasoningEffort,
    supportedEfforts.has("high") ? "high" : null,
    supportedOptions[0]?.reasoningEffort,
  ];

  for (const effort of preferredEfforts) {
    if (effort && supportedEfforts.has(effort)) {
      return effort;
    }
  }

  return null;
}

function resolvePrimaryModelOptions(
  visibleModels: ThreadFooterModel["availableModels"],
  selectedModelId: string,
) {
  const selectedModel = visibleModels.find((candidate) => candidate.id === selectedModelId);
  const remainingModels = visibleModels.filter((candidate) => candidate.id !== selectedModelId);
  const primaryModels = [
    ...(selectedModel ? [selectedModel] : []),
    ...remainingModels,
  ].slice(0, 2);
  const primaryModelIds = new Set(primaryModels.map((candidate) => candidate.id));
  const otherModels = visibleModels.filter((candidate) => !primaryModelIds.has(candidate.id));

  return {
    primaryModels,
    otherModels,
  };
}

function renderModelMenuLabel(input: {
  modelId: string;
  availableModels: ThreadFooterModel["availableModels"];
  serviceTier: null | "fast";
  showFastIndicator: boolean;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1 tabular-nums">
      {input.showFastIndicator && input.serviceTier === "fast" ? (
        <CodexFastModeIcon className="text-token-link-foreground" />
      ) : null}
      <span className="truncate whitespace-nowrap">
        {formatCodexModelLabel(input.modelId, input.availableModels)}
      </span>
    </span>
  );
}

function ModelSelectorMenuItem({
  candidate,
  model,
  serviceTier,
  showFastIndicator,
  actions,
}: {
  candidate: ThreadFooterModel["availableModels"][number];
  model: ThreadFooterModel;
  serviceTier: null | "fast";
  showFastIndicator: boolean;
  actions: ThreadStageActions;
}) {
  const isSelected = candidate.id === model.selectedModel;
  const description = candidate.description.trim().replace(/\.$/u, "");

  return (
    <NodexDropdownItem
      key={candidate.id}
      onSelect={() => {
        const nextReasoningEffort = resolveReasoningEffortForModelChange({
          currentReasoningEffort: model.selectedReasoningEffort,
          nextModelId: candidate.id,
          models: model.availableModels,
        });

        actions.onModelChange(candidate.id);
        if (nextReasoningEffort && nextReasoningEffort !== model.selectedReasoningEffort) {
          actions.onReasoningEffortChange(nextReasoningEffort);
        }
      }}
      rightSlot={isSelected ? <NodexDropdownSelectedIcon /> : null}
      tooltipText={description || undefined}
      data-model-selected={isSelected ? "true" : undefined}
    >
      {renderModelMenuLabel({
        modelId: candidate.id,
        availableModels: model.availableModels,
        serviceTier,
        showFastIndicator,
      })}
    </NodexDropdownItem>
  );
}

function IntelligenceSelectorDropdown({
  model,
  serviceTier,
  onServiceTierChange,
  actions,
}: {
  model: ThreadFooterModel;
  serviceTier: null | "fast";
  onServiceTierChange: (nextTier: null | "fast") => void;
  actions: ThreadStageActions;
}) {
  const visibleModels = model.availableModels.filter((candidate) => !candidate.hidden);
  const { primaryModels, otherModels } = resolvePrimaryModelOptions(visibleModels, model.selectedModel);
  const modelLabel = renderModelSelectorLabel({
    selectedModel: model.selectedModel,
    availableModels: model.availableModels,
    serviceTier,
    compact: true,
  });
  const reasoningLabel = formatCodexReasoningEffortLabel(model.selectedReasoningEffort);

  return (
    <NodexDropdownMenu
      triggerButton={(
        <button
          type="button"
          aria-label="Select Codex model and reasoning"
          className="inline-flex h-7 min-w-0 items-center gap-1 rounded-full border border-transparent px-1.5 text-sm/4.5 text-token-description-foreground hover:bg-token-foreground/5 hover:text-token-foreground"
        >
          <span className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 max-w-24 truncate">{modelLabel}</span>
            <span className="shrink-0 text-token-input-placeholder-foreground">{reasoningLabel}</span>
          </span>
          <ChevronDownIcon />
        </button>
      )}
      side="top"
      align="start"
      contentWidth="menuNarrow"
    >
      <NodexDropdownSection className="flex flex-col overflow-hidden">
        <NodexDropdownTitle>Intelligence</NodexDropdownTitle>
        <div className="flex max-h-[250px] flex-col overflow-y-auto">
          {model.reasoningEffortOptions.map((option) => (
            <NodexDropdownItem
              key={option.reasoningEffort}
              onSelect={() => {
                actions.onReasoningEffortChange(option.reasoningEffort);
              }}
              rightSlot={option.reasoningEffort === model.selectedReasoningEffort ? <NodexDropdownSelectedIcon /> : null}
              data-intelligence-option={option.reasoningEffort}
              data-reasoning-selected={option.reasoningEffort === model.selectedReasoningEffort ? "true" : undefined}
            >
              {formatCodexReasoningEffortLabel(option.reasoningEffort)}
            </NodexDropdownItem>
          ))}
        </div>
      </NodexDropdownSection>
      <NodexDropdownSeparator />
      <NodexDropdownFlyoutSubmenuItem
        label={formatCodexModelLabel(model.selectedModel, model.availableModels)}
        contentClassName="min-w-[200px]"
        triggerContent={(
          <div className="flex w-full items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate">
              {renderModelSelectorLabel({
                selectedModel: model.selectedModel,
                availableModels: model.availableModels,
                serviceTier,
              })}
            </span>
            <ChevronRightIcon className="icon-xs shrink-0 text-token-input-placeholder-foreground opacity-75 group-focus:opacity-100 group-hover:opacity-100" />
          </div>
        )}
      >
        <NodexDropdownSection className="flex min-w-[200px] flex-col overflow-hidden">
          <NodexDropdownTitle>Change model</NodexDropdownTitle>
          <div className="vertical-scroll-fade-mask flex max-h-[250px] flex-col overflow-y-auto">
            {visibleModels.length === 0 ? (
              <NodexDropdownItem disabled>No Codex models available</NodexDropdownItem>
            ) : (
              primaryModels.map((candidate) => (
                <ModelSelectorMenuItem
                  key={candidate.id}
                  candidate={candidate}
                  model={model}
                  serviceTier={serviceTier}
                  showFastIndicator
                  actions={actions}
                />
              ))
            )}
            {otherModels.length > 0 ? (
              <NodexDropdownFlyoutSubmenuItem label="Other models" contentClassName="min-w-[200px]">
                <NodexDropdownSection className="flex min-w-[200px] flex-col overflow-hidden">
                  {otherModels.map((candidate) => (
                    <ModelSelectorMenuItem
                      key={candidate.id}
                      candidate={candidate}
                      model={model}
                      serviceTier={serviceTier}
                      showFastIndicator={false}
                      actions={actions}
                    />
                  ))}
                </NodexDropdownSection>
              </NodexDropdownFlyoutSubmenuItem>
            ) : null}
          </div>
        </NodexDropdownSection>
      </NodexDropdownFlyoutSubmenuItem>
      <NodexDropdownFlyoutSubmenuItem label="Speed" contentClassName="min-w-64">
        <NodexDropdownSection className="flex min-w-64 flex-col overflow-hidden pt-1">
          <NodexDropdownTitle>Change speed</NodexDropdownTitle>
          {SERVICE_TIER_OPTIONS.map((option) => (
            <NodexDropdownItem
              key={option.label}
              onSelect={() => onServiceTierChange(option.value)}
              rightSlot={option.value === serviceTier ? <NodexDropdownSelectedIcon /> : null}
              subText={option.description}
              allowWrap
            >
              {option.label}
            </NodexDropdownItem>
          ))}
        </NodexDropdownSection>
      </NodexDropdownFlyoutSubmenuItem>
    </NodexDropdownMenu>
  );
}

export function ThreadComposer({ model, actions, errorMessage, onErrorMessage }: ThreadComposerProps) {
  const [busyAction, setBusyAction] = useState<StageThreadsBusyAction>(null);
  const [permissionState, setPermissionState] = useState<CodexPermissionState | null>(null);
  const [dictationToastMessage, setDictationToastMessage] = useState<string | null>(null);
  const [fileAttachments, setFileAttachments] = useState<ComposerFileAttachment[]>([]);
  const [imageAttachments, setImageAttachments] = useState<ComposerImageAttachment[]>([]);
  const [skillMentions, setSkillMentions] = useState<ComposerSkillMentionAttachment[]>([]);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const dictationShortcutActiveRef = useRef(false);
  const attachmentGenerationRef = useRef(0);
  const { serviceTierSettings, setServiceTier } = useCodexServiceTierSettings();
  const attachmentState = useMemo<ComposerAttachmentState>(() => ({
    fileAttachments,
    imageAttachments,
    skillMentions,
  }), [fileAttachments, imageAttachments, skillMentions]);
  const hasAttachments = hasComposerAttachmentStateContent(attachmentState);
  const incrementAttachmentGeneration = useCallback(() => {
    attachmentGenerationRef.current += 1;
  }, []);
  const resetComposerAttachments = useCallback(() => {
    incrementAttachmentGeneration();
    setFileAttachments([]);
    setImageAttachments([]);
    setSkillMentions([]);
  }, [incrementAttachmentGeneration]);

  const submitPrompt = useCallback(async (
    input: {
      prompt: string;
      reset?: () => void;
      invertInProgressFollowUpMode?: boolean;
    },
  ) => {
    const nextPrompt = input.prompt.trim();
    const promptInput = buildComposerPromptInput({
      prompt: nextPrompt,
      attachments: attachmentState,
    });
    const hasPromptAttachments = promptInput !== undefined;
    const target = model.newThreadTarget;
    const inProgressFollowUpMode = resolveThreadInProgressFollowUpMode({
      invertInProgressFollowUpMode: input.invertInProgressFollowUpMode,
      isQueueingEnabled: model.isQueueingEnabled,
    });

    if (!nextPrompt && !hasPromptAttachments) {
      return;
    }

    setBusyAction("send");
    onErrorMessage(null);

    try {
      if (!model.conversation) {
        if (!target) return;
        if (target.sessionId) {
          if (!actions.onStartThreadForSession) {
            onErrorMessage("Session thread creation is not available.");
            return;
          }
          await actions.onStartThreadForSession({
            projectId: target.projectId,
            sessionId: target.sessionId,
            prompt: nextPrompt,
            promptInput,
            runInTarget: target.runInTarget,
            runInEnvironmentPath: target.runInEnvironmentPath,
            worktreeStartMode: target.worktreeStartMode,
            worktreeBranchPrefix: target.worktreeBranchPrefix,
          });
        } else if (target.cardId) {
          await actions.onStartThreadForCard({
            projectId: target.projectId,
            cardId: target.cardId,
            prompt: nextPrompt,
            promptInput,
          });
        } else {
          onErrorMessage("Select a card or session before starting a new thread.");
          return;
        }
      } else if (model.isThreadRunning) {
        if (inProgressFollowUpMode === "queue") {
          await actions.onEnqueueQueuedFollowUp(model.conversation.threadId, nextPrompt, {
            collaborationMode: model.selectedCollaborationMode,
            promptInput,
          });
        } else {
          if (!model.activeTurn) {
            onErrorMessage("Codex is already running. Wait for the active turn to load or queue the follow-up instead.");
            return;
          }
          await actions.onSteerPrompt({
            expectedTurnId: model.activeTurn.turnId,
            prompt: nextPrompt,
            promptInput,
            collaborationMode: model.selectedCollaborationMode,
          });
        }
      } else {
        await actions.onSendPrompt(nextPrompt, {
          collaborationMode: model.selectedCollaborationMode,
          promptInput,
        });
      }
      input.reset?.();
      resetComposerAttachments();
    } catch (error) {
      onErrorMessage(error instanceof Error ? error.message : "Could not send prompt");
    } finally {
      setBusyAction(null);
    }
  }, [
    actions,
    attachmentState,
    model.activeTurn,
    model.conversation,
    model.isQueueingEnabled,
    model.isThreadRunning,
    model.newThreadTarget,
    model.selectedCollaborationMode,
    onErrorMessage,
    resetComposerAttachments,
  ]);

  const promptForm = useForm({
    defaultValues: { prompt: "" },
    onSubmit: async ({ value, formApi }) => {
      await submitPrompt({
        prompt: value.prompt,
        reset: () => {
          formApi.reset();
        },
      });
    },
  });
  const prompt = useStore(promptForm.store, (state) => state.values.prompt);
  const isDictationSupported = useMemo(
    () =>
      model.dictation.isEnabled
      && isElectronLikeComposerEnvironment()
      && typeof navigator !== "undefined"
      && typeof navigator.mediaDevices?.getUserMedia === "function"
      && typeof MediaRecorder !== "undefined",
    [model.dictation.isEnabled],
  );

  const insertDictationTranscript = useCallback((transcript: string): string => {
    const textarea = promptTextareaRef.current;
    const normalizedTranscript = transcript.trim();
    if (normalizedTranscript.length === 0) {
      return prompt;
    }

    if (textarea) {
      const selectionStart = textarea.selectionStart ?? prompt.length;
      const selectionEnd = textarea.selectionEnd ?? selectionStart;
      const nextPrompt = `${prompt.slice(0, selectionStart)}${normalizedTranscript}${prompt.slice(selectionEnd)}`;
      promptForm.setFieldValue("prompt", nextPrompt);
      requestAnimationFrame(() => {
        textarea.focus();
        const nextSelection = selectionStart + normalizedTranscript.length;
        textarea.setSelectionRange(nextSelection, nextSelection);
      });
      return nextPrompt;
    }

    const nextPrompt = `${prompt}${normalizedTranscript}`;
    promptForm.setFieldValue("prompt", nextPrompt);
    return nextPrompt;
  }, [prompt, promptForm]);

  const insertComposerTextAtSelection = useCallback((text: string) => {
    const textarea = promptTextareaRef.current;
    if (!textarea) {
      promptForm.setFieldValue("prompt", `${prompt}${text}`);
      return;
    }

    const selectionStart = textarea.selectionStart ?? prompt.length;
    const selectionEnd = textarea.selectionEnd ?? selectionStart;
    const nextPrompt = `${prompt.slice(0, selectionStart)}${text}${prompt.slice(selectionEnd)}`;
    promptForm.setFieldValue("prompt", nextPrompt);
    requestAnimationFrame(() => {
      textarea.focus();
      const nextSelection = selectionStart + text.length;
      textarea.setSelectionRange(nextSelection, nextSelection);
    });
  }, [prompt, promptForm]);

  const handleInsertPluginMention = useCallback((plugin: NonNullable<ThreadFooterModel["composerPlugins"]>[number]) => {
    const pluginName = plugin.name.trim();
    const pluginPath = plugin.path.trim();
    if (!pluginName || !pluginPath) return;
    incrementAttachmentGeneration();
    setSkillMentions((current) => [
      ...current,
      {
        id: createComposerAttachmentId("skill"),
        name: pluginName,
        path: pluginPath,
      },
    ]);
    insertComposerTextAtSelection(`${prompt.trim().length === 0 ? "" : " "}@${pluginName} `);
  }, [incrementAttachmentGeneration, insertComposerTextAtSelection, prompt]);

  const handlePickComposerFiles = useCallback(async () => {
    const imagesOnly = model.isCloudNewThreadTarget;
    attachmentGenerationRef.current += 1;
    const generation = attachmentGenerationRef.current;

    try {
      const pickedFiles = await invoke("composer:pick-files", {
        imagesOnly,
        title: imagesOnly ? "Select photos" : "Select files",
      }) as ComposerPickedFile[];
      if (attachmentGenerationRef.current !== generation || pickedFiles.length === 0) {
        return;
      }

      const nextFileAttachments: ComposerFileAttachment[] = [];
      const nextImageAttachments: ComposerImageAttachment[] = [];

      for (const pickedFile of pickedFiles) {
        if (!isComposerImageFile(pickedFile)) {
          if (!imagesOnly) {
            nextFileAttachments.push({
              id: createComposerAttachmentId("file"),
              label: getComposerPickedFileName(pickedFile),
              path: pickedFile.path,
            });
          }
          continue;
        }

        if (!pickedFile.imageDataUrl) continue;
        nextImageAttachments.push({
          id: createComposerAttachmentId("image"),
          filename: getComposerPickedFileName(pickedFile),
          path: pickedFile.path,
          dataUrl: pickedFile.imageDataUrl,
        });
      }

      if (attachmentGenerationRef.current !== generation) {
        return;
      }
      if (nextFileAttachments.length > 0) {
        setFileAttachments((current) => [...current, ...nextFileAttachments]);
      }
      if (nextImageAttachments.length > 0) {
        setImageAttachments((current) => [...current, ...nextImageAttachments]);
      }
    } catch (error) {
      onErrorMessage(error instanceof Error ? error.message : "Could not add files");
    }
  }, [model.isCloudNewThreadTarget, onErrorMessage]);

  const showDictationToast = useCallback((message: string) => {
    setDictationToastMessage(message);
  }, []);

  const {
    isDictating,
    isTranscribing,
    recordingDurationMs,
    waveformCanvasRef,
    startDictation,
    stopDictation,
  } = useComposerDictation({
    enabled: isDictationSupported,
    onTranscriptInsert: (transcript) => {
      insertDictationTranscript(transcript);
    },
    onTranscriptSend: (transcript) => {
      const nextPrompt = insertDictationTranscript(transcript);
      window.setTimeout(() => {
        void submitPrompt({
          prompt: nextPrompt,
          reset: () => {
            promptForm.reset();
          },
        });
      }, 0);
    },
    onStartError: (error) => {
      console.error("[composer-dictation:start]", error);
      showDictationToast("Unable to start dictation");
    },
    onTranscribeError: (error) => {
      console.error("[composer-dictation:transcribe]", error);
      showDictationToast("Unable to transcribe audio");
    },
    onUnsupported: () => {
      showDictationToast("Dictation is not available on this device");
    },
  });
  const startDictationRef = useRef(startDictation);
  const stopDictationRef = useRef(stopDictation);

  useEffect(() => {
    if (!dictationToastMessage) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setDictationToastMessage(null);
    }, 4000);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [dictationToastMessage]);

  useEffect(() => {
    startDictationRef.current = startDictation;
    stopDictationRef.current = stopDictation;
  }, [startDictation, stopDictation]);

  const resizePromptTextarea = useCallback(() => {
    const textarea = promptTextareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const { heightPx, hasOverflow } = resolvePromptTextareaSize({
      scrollHeight: textarea.scrollHeight,
      maxHeightPx: resolvePromptTextareaMaxHeightPx(),
    });
    textarea.style.height = heightPx > 0 ? `${heightPx}px` : "";
    textarea.style.overflowY = hasOverflow ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    resizePromptTextarea();
  }, [prompt, resizePromptTextarea]);

  useEffect(() => {
    if (!isDictationSupported || model.dictation.isRealtimeVoiceActive) {
      dictationShortcutActiveRef.current = false;
      return;
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.repeat || !isComposerDictationShortcut(event)) {
        return;
      }
      if (isComposerDictationShortcutTargetBlocked(event.target)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (dictationShortcutActiveRef.current) {
        return;
      }

      dictationShortcutActiveRef.current = true;
      void startDictationRef.current();
    };

    const handleKeyUp = (event: globalThis.KeyboardEvent) => {
      if (!isComposerDictationShortcut(event)) {
        return;
      }
      if (isComposerDictationShortcutTargetBlocked(event.target)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (!dictationShortcutActiveRef.current) {
        return;
      }

      dictationShortcutActiveRef.current = false;
      stopDictationRef.current("insert");
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("keyup", handleKeyUp, true);
    return () => {
      dictationShortcutActiveRef.current = false;
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("keyup", handleKeyUp, true);
    };
  }, [
    isDictationSupported,
    model.dictation.isRealtimeVoiceActive,
  ]);

  useEffect(() => {
    const composerIntent = model.composerIntent;
    const threadId = model.conversation?.threadId ?? model.body.threadId;
    if (!composerIntent || !threadId) return;

    resetComposerAttachments();
    promptForm.setFieldValue("prompt", composerIntent.prompt);
    requestAnimationFrame(() => {
      const textarea = promptTextareaRef.current;
      if (!textarea) return;
      textarea.focus();
      const selectionStart = composerIntent.prompt.length;
      textarea.setSelectionRange(selectionStart, selectionStart);
    });
    actions.onConsumeComposerIntent(threadId, composerIntent.focusNonce);
  }, [actions, model.body.threadId, model.composerIntent, model.conversation?.threadId, promptForm, resetComposerAttachments]);

  useEffect(() => {
    resetComposerAttachments();
  }, [model.conversation?.threadId, model.isNewThreadTab, resetComposerAttachments]);

  useEffect(() => {
    let cancelled = false;

    void invoke("codex:permission:state:get", model.projectId)
      .then((result) => {
        if (cancelled) return;
        setPermissionState(result as CodexPermissionState);
      })
      .catch(() => {
        if (cancelled) return;
        setPermissionState(null);
      });

    return () => {
      cancelled = true;
    };
  }, [model.permissionMode, model.projectId]);

  const handleInterrupt = useCallback(async () => {
    if (!model.conversation || !model.isThreadRunning) return;
    setBusyAction("interrupt");
    onErrorMessage(null);
    try {
      await actions.onInterruptTurn(model.activeTurn?.turnId ?? undefined);
    } catch (error) {
      onErrorMessage(error instanceof Error ? error.message : "Could not stop Codex");
    } finally {
      setBusyAction(null);
    }
  }, [actions, model.activeTurn?.turnId, model.conversation, model.isThreadRunning, onErrorMessage]);

  const handleRemoveFileAttachment = useCallback((attachmentId: string) => {
    incrementAttachmentGeneration();
    setFileAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
  }, [incrementAttachmentGeneration]);

  const handleRemoveImageAttachment = useCallback((attachmentId: string) => {
    incrementAttachmentGeneration();
    setImageAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
  }, [incrementAttachmentGeneration]);

  const handleRemoveSkillMention = useCallback((attachmentId: string) => {
    incrementAttachmentGeneration();
    setSkillMentions((current) => current.filter((attachment) => attachment.id !== attachmentId));
  }, [incrementAttachmentGeneration]);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const hasMultilinePrompt = prompt.includes("\n");

    if (shouldInvertThreadInProgressFollowUpModeFromKeyDown({
      enterBehavior: model.composerEnterBehavior,
      key: event.key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      isComposing: event.nativeEvent.isComposing,
    }) && model.conversation && model.isThreadRunning) {
      event.preventDefault();
      void submitPrompt({
        prompt,
        reset: () => {
          promptForm.reset();
        },
        invertInProgressFollowUpMode: true,
      });
      return;
    }

    if (!shouldSubmitComposerPromptFromKeyDown({
      enterBehavior: model.composerEnterBehavior,
      hasMultilinePrompt,
      key: event.key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      isComposing: event.nativeEvent.isComposing,
    })) {
      return;
    }

    event.preventDefault();
    void promptForm.handleSubmit();
  }, [model.composerEnterBehavior, model.conversation, model.isThreadRunning, prompt, promptForm, submitPrompt]);

  const hasDraftContent = prompt.trim().length > 0 || hasAttachments;
  const hasMultilinePrompt = prompt.includes("\n");
  const isMacPlatform = typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");

  const composerActionState = resolveStageThreadsComposerActionState({
    canSendPrompt: model.conversation !== null || canStartNewThreadTarget(model),
    isThreadRunning: model.isThreadRunning,
    busyAction,
    hasDraftContent,
    isQueueingEnabled: model.isQueueingEnabled,
  });
  const isSendPending = busyAction === "send" && composerActionState.action === "send";
  const canRunPrimaryAction = Boolean(
    hasDraftContent &&
    (model.conversation !== null || canStartNewThreadTarget(model)),
  );
  const primaryShortcutKeys = resolveShortcutKeycapTokens({
    accelerator: resolveThreadComposerPrimaryShortcutAccelerator({
      enterBehavior: model.composerEnterBehavior,
      hasMultilinePrompt,
    }),
    isMacPlatform,
  });
  const alternateShortcutKeys = resolveShortcutKeycapTokens({
    accelerator: resolveThreadComposerAlternateShortcutAccelerator(model.composerEnterBehavior),
    isMacPlatform,
  });
  const contextWindowIndicatorState = resolveContextWindowIndicatorState(model.conversation);
  const composerActionTooltip = renderComposerActionTooltipContent({
    action: composerActionState.action,
    submitAction: composerActionState.submitAction,
    alternateInProgressSubmitAction: composerActionState.alternateInProgressSubmitAction,
    isThreadRunning: model.isThreadRunning,
    primaryShortcutKeys,
    alternateShortcutKeys,
  });
  return (
    <>
      <div className="relative">
        {dictationToastMessage ? (
          <button
            type="button"
            onClick={() => setDictationToastMessage(null)}
            className="absolute inset-x-0 -top-10 z-20 mx-auto inline-flex w-fit max-w-[min(24rem,100%)] items-center rounded-full border border-(--destructive)/30 bg-(--destructive)/10 px-3 py-1 text-xs font-medium text-(--destructive)"
            title={dictationToastMessage}
          >
            {dictationToastMessage}
          </button>
        ) : null}
        <form
          className="relative overflow-hidden rounded-3xl bg-token-input-background/90 bg-clip-padding shadow-card-md ring ring-black/10 backdrop-blur-lg electron:shadow-[0_4px_16px_0_rgba(0,0,0,0.05)] electron:dark:bg-token-dropdown-background"
          onSubmit={(event) => handleFormSubmit(event, promptForm.handleSubmit)}
        >
          <div className="relative z-10">
            <div className="px-2 py-1.5">
              <div className="flex w-full flex-wrap items-center justify-start gap-1" />
            </div>

            <div className="mb-2 grow px-3">
              <div
                data-composer-prompt-frame="true"
                className="h-auto max-h-[25dvh] min-h-[4dvh] overflow-hidden text-sm text-(--foreground)"
              >
                <textarea
                  ref={promptTextareaRef}
                  value={prompt}
                  placeholder={
                    model.conversation
                      ? "Ask for follow-up changes"
                      : model.isNewThreadTab
                        ? model.newThreadTarget
                          ? model.isCloudNewThreadTarget
                            ? "Cloud run target is currently mock-only"
                            : "Write the first prompt for this new thread..."
                          : "Select a card or session before starting a new thread"
                        : "Select a thread"
                  }
                  onChange={(event) => {
                    promptForm.setFieldValue("prompt", event.target.value);
                  }}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  className="scrollbar-token min-h-10 w-full resize-none overflow-y-auto border-0 bg-transparent p-0 text-sm/editor text-(--foreground) placeholder:text-(--foreground-tertiary) focus:outline-none"
                  disabled={(model.conversation === null && !canStartNewThreadTarget(model)) || busyAction !== null}
                />
              </div>
            </div>

            {hasAttachments ? (
              <div className="mb-2 flex flex-wrap items-center gap-1 px-3" data-composer-attachments="true">
                {imageAttachments.map((attachment) => (
                  <button
                    key={attachment.id}
                    type="button"
                    className="inline-flex max-w-48 items-center gap-1 rounded-full bg-token-foreground/5 px-2 py-1 text-xs text-token-foreground hover:bg-token-foreground/10"
                    onClick={() => handleRemoveImageAttachment(attachment.id)}
                    title={`Remove ${attachment.filename}`}
                  >
                    <span className="size-3 rounded-sm bg-token-text-link-foreground/20" />
                    <span className="min-w-0 truncate">{attachment.filename}</span>
                    <span className="text-token-description-foreground">x</span>
                  </button>
                ))}
                {fileAttachments.map((attachment) => (
                  <button
                    key={attachment.id}
                    type="button"
                    className="inline-flex max-w-48 items-center gap-1 rounded-full bg-token-foreground/5 px-2 py-1 text-xs text-token-foreground hover:bg-token-foreground/10"
                    onClick={() => handleRemoveFileAttachment(attachment.id)}
                    title={`Remove ${attachment.label}`}
                  >
                    <ComposerAddFilesIcon className="size-3 text-token-description-foreground" />
                    <span className="min-w-0 truncate">{attachment.label}</span>
                    <span className="text-token-description-foreground">x</span>
                  </button>
                ))}
                {skillMentions.map((attachment) => (
                  <button
                    key={attachment.id}
                    type="button"
                    className="inline-flex max-w-48 items-center gap-1 rounded-full bg-token-foreground/5 px-2 py-1 text-xs text-token-foreground hover:bg-token-foreground/10"
                    onClick={() => handleRemoveSkillMention(attachment.id)}
                    title={`Remove ${attachment.name}`}
                  >
                    <ComposerPluginsIcon className="size-3 text-token-description-foreground" />
                    <span className="min-w-0 truncate">{attachment.name}</span>
                    <span className="text-token-description-foreground">x</span>
                  </button>
                ))}
              </div>
            ) : null}

            {errorMessage && <div className="px-3 pb-2 text-xs text-(--destructive)">{errorMessage}</div>}

            {isDictating ? (
              <div className="mb-2 flex items-center gap-2 px-2">
                <button
                  type="button"
                  className="inline-flex size-7 items-center justify-center rounded-full border border-transparent px-0 text-(--foreground-tertiary) opacity-50"
                  aria-label={model.isCloudNewThreadTarget ? "Add photos and more" : "Add files and more"}
                  title={model.isCloudNewThreadTarget ? "Add photos and more" : "Add files and more"}
                  disabled
                >
                  <PlusIcon className="size-4" />
                </button>
                <div className="flex h-7 min-w-0 flex-1 items-center">
                  <canvas
                    ref={waveformCanvasRef}
                    className="h-7 w-full text-(--foreground)"
                  />
                </div>
                <span className="text-sm tabular-nums text-(--foreground-secondary)">
                  {formatComposerDictationDuration(recordingDurationMs)}
                </span>
                <NodexTooltip tooltipContent={<span className="text-token-foreground">Stop dictation</span>} side="top" sideOffset={4}>
                  <button
                    type="button"
                    className="inline-flex size-7 items-center justify-center rounded-full border border-transparent px-0 text-(--foreground-secondary) transition-colors duration-100 hover:bg-(--background-tertiary) hover:text-(--foreground)"
                    aria-label="Stop dictation"
                    onClick={() => stopDictation("insert")}
                    disabled={isTranscribing}
                  >
                    <StopIcon className="size-4" />
                  </button>
                </NodexTooltip>
                <NodexTooltip tooltipContent={<span className="text-token-foreground">Transcribe and send</span>} side="top" sideOffset={4}>
                  <button
                    type="button"
                    className={cn(
                      "inline-flex size-7 items-center justify-center rounded-full bg-(--foreground) p-0.5 text-(--background) focus-visible:outline-2 focus-visible:outline-(--ring)",
                      isTranscribing && "opacity-50",
                    )}
                    aria-label="Transcribe and send"
                    onClick={() => stopDictation("send")}
                    disabled={isTranscribing}
                  >
                    <UpArrowIcon className="size-5" />
                  </button>
                </NodexTooltip>
              </div>
            ) : (
              <div
                data-composer-form-footer="true"
                className="mb-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1.25 px-2"
              >
                <div className="flex w-full min-w-0 flex-nowrap items-center justify-start gap-1.25">
                  <ComposerAddContextDropdown
                    model={model}
                    actions={actions}
                    onPickFiles={handlePickComposerFiles}
                    onInsertPlugin={handleInsertPluginMention}
                  />

                  <ActiveComposerModeChip
                    model={model}
                    onSelect={actions.onCollaborationModeChange}
                  />

                  <PermissionModeDropdown
                    selectedMode={model.permissionMode}
                    availableModes={permissionState?.availableModes}
                    guardianApprovalEnabled={permissionState?.guardianApprovalEnabled ?? false}
                    customDescription={permissionState?.customDescription ?? null}
                    accentCurrentMode
                    onSelect={actions.onPermissionModeChange}
                  />
                </div>

                <div className="flex min-w-0 items-center justify-end gap-2">
                  <ContextWindowIndicator
                    state={contextWindowIndicatorState}
                    account={model.account}
                    className="ml-0"
                    showFallbackLabel={false}
                  />
                  <IntelligenceSelectorDropdown
                    model={model}
                    serviceTier={serviceTierSettings.serviceTier}
                    onServiceTierChange={(nextTier) => setServiceTier(nextTier, "composer_menu")}
                    actions={actions}
                  />
                  {isDictationSupported ? (
                    <NodexTooltip
                      tooltipContent={<span className="text-token-foreground">Click to dictate or hold</span>}
                      shortcut={model.dictation.shortcutLabel}
                      side="top"
                      sideOffset={4}
                    >
                      <button
                        type="button"
                        className="inline-flex size-7 items-center justify-center rounded-full border border-transparent px-0 text-(--foreground-tertiary) transition-colors duration-100 hover:bg-(--background-tertiary) hover:text-(--foreground-secondary)"
                        aria-label="Dictate"
                        onClick={() => {
                          void startDictation();
                        }}
                        disabled={model.dictation.isRealtimeVoiceActive}
                      >
                        {isTranscribing ? (
                          <SpinnerIcon className="size-4" />
                        ) : (
                          <MicIcon className="size-4" />
                        )}
                      </button>
                    </NodexTooltip>
                  ) : null}

                  <NodexTooltip
                    tooltipContent={composerActionTooltip}
                    side="top"
                    tooltipBodyClassName={cn(
                      composerActionState.action === "stop" || !model.isThreadRunning
                        ? "text-center text-pretty"
                        : "max-w-none",
                    )}
                  >
                    <span className="inline-flex">
                      <button
                        type={composerActionState.action === "stop" ? "button" : "submit"}
                        className={cn(
                          "inline-flex size-7 items-center justify-center rounded-full p-0.5 focus-visible:outline-2 focus-visible:outline-(--ring)",
                          "bg-(--foreground) text-(--background)",
                          (composerActionState.disabled || (composerActionState.action !== "stop" && !canRunPrimaryAction)) && !isSendPending && "opacity-50",
                          isSendPending && "cursor-wait",
                        )}
                        onClick={composerActionState.action === "stop" ? () => void handleInterrupt() : undefined}
                        disabled={composerActionState.action === "stop"
                          ? composerActionState.disabled
                          : composerActionState.disabled || !canRunPrimaryAction}
                        aria-label={composerActionState.label}
                      >
                        {isSendPending ? (
                          <SpinnerIcon className="size-5" />
                        ) : composerActionState.action === "stop" ? (
                          <StopIcon className="size-4" />
                        ) : (
                          <UpArrowIcon className="size-5" />
                        )}
                      </button>
                    </span>
                  </NodexTooltip>
                </div>
              </div>
            )}
          </div>
        </form>
      </div>

      <ThreadComposerStatusStrip
        model={model}
        actions={actions}
        onErrorMessage={onErrorMessage}
        projectSelectorDisabled={busyAction !== null}
      />
    </>
  );
}

function renderComposerActionTooltipContent(input: {
  action: "send" | "stop";
  submitAction: StageThreadsComposerSubmitAction | null;
  alternateInProgressSubmitAction: Exclude<StageThreadsComposerSubmitAction, "send"> | null;
  isThreadRunning: boolean;
  primaryShortcutKeys: readonly string[];
  alternateShortcutKeys: readonly string[];
}) {
  return (
    <ComposerActionTooltipContent
      action={input.action}
      submitAction={input.submitAction}
      alternateInProgressSubmitAction={input.alternateInProgressSubmitAction}
      isThreadRunning={input.isThreadRunning}
      primaryShortcutKeys={input.primaryShortcutKeys}
      alternateShortcutKeys={input.alternateShortcutKeys}
    />
  );
}
