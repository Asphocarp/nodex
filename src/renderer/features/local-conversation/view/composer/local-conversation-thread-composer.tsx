import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  formatCodexModelLabel,
  formatCodexReasoningEffortLabel,
  resolveCodexReasoningEffortOptions,
} from "@/lib/codex-thread-settings";
import { resolveContextWindowIndicatorState } from "@/lib/codex-context-window";
import type {
  CodexPermissionState,
  CodexPromptInput,
  CodexReasoningEffort,
  CodexReviewDiffCommentAttachment,
  CodexServiceTier,
  CodexThreadGoalDraftInput,
  CodexThreadGoalMaterializedDraft,
} from "@/lib/types";
import type { ComposerPickedFile } from "../../../../../shared/ipc-api";
import { dedupeCodexLiveFileAttachments } from "../../../../../shared/codex-live-file-attachments";
import { useCodexServiceTierSettings } from "@/lib/use-codex-service-tier-settings";
import {
  findAgentModel,
  findAgentProvider,
  isAgentProviderCredentialReady,
  selectAgentModel,
  selectAgentProvider,
  selectAgentReasoningEffort,
} from "@/lib/agent-execution-profile";
import type { AgentModelOption, AgentProviderOption } from "../../../../../shared/agent-runtime";
import {
  resolveShortcutKeycapTokens,
  resolveThreadComposerAlternateShortcutAccelerator,
  resolveThreadComposerPrimaryShortcutAccelerator,
} from "@/lib/thread-composer-follow-up-mode";
import {
  resolveComposerSubmitIntentFromKeyDown,
  resolveStageThreadsComposerActionState,
  type StageThreadsBusyAction,
  type StageThreadsComposerFollowUpAction,
  type StageThreadsComposerSubmitAction,
} from "../shared/composer-action";
import { cn } from "../../../../lib/utils";
import {
  CodexCloseIcon,
  CodexFastModeIcon,
  CodexGoalClearIcon,
  CodexGoalTargetIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ComposerAddFilesIcon,
  ComposerIdeContextIcon,
  ComposerPlanModeCloseIcon,
  ComposerPlanModeIcon,
  ComposerPluginsIcon,
  MicIcon,
  PlusIcon,
  ReviewFileDocumentIcon,
  SpinnerIcon,
  StopIcon,
  UpArrowIcon,
} from "@/components/shared/icons";
import { ShortcutKeycaps } from "@/components/ui/shortcut-keycaps";
import { toast } from "@/components/ui/toast";
import { NodexButton } from "@/components/ui/button";
import {
  NodexDialog,
  NodexDialogContent,
  NodexDialogDescription,
  NodexDialogFooter,
  NodexDialogHeader,
  NodexDialogTitle,
} from "@/components/ui/dialog";
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
  NodexDropdownMessage,
  NodexDropdownSearchInput,
  NodexDropdownSection,
  NodexDropdownSelectedIcon,
  NodexDropdownSeparator,
  NodexDropdownTitle,
  NodexTooltip,
  PermissionModeDropdown,
} from "./local-conversation-thread-composer-deps";
import {
  shouldShowThreadComposerStatusStrip,
  ThreadComposerExternalFooterSlot,
  ThreadComposerStatusStrip,
} from "./local-conversation-thread-composer-status-strip";
import {
  ComposerPromptEditor,
  type ComposerPromptEditorHandle,
  type ComposerPromptEditorKeyboardEvent,
} from "./composer-prompt-editor";
import { useThreadComposerPromptHistoryRecall } from "./thread-composer-prompt-history";
import { InlineSlashCommandMenu } from "./slash-command-menu/inline-slash-command-menu";
import { ExpandedSlashCommandDialog } from "./slash-command-menu/expanded-slash-command-dialog";
import { buildComposerSlashCommands } from "./slash-command-menu/slash-command-registry";
import {
  filterComposerSlashCommands,
  groupComposerSlashCommandMatches,
  inactiveSlashTrigger,
  resolveComposerSlashHighlight,
  resolveNextSlashHighlight,
} from "./slash-command-menu/slash-command-filter";
import type {
  ComposerSlashCommand,
  ComposerSlashCommandHighlightIntent,
  ComposerSlashTriggerState,
} from "./slash-command-menu/slash-command-types";
import {
  addReviewDiffCommentAttachment,
  clearReviewDiffCommentAttachments,
  removeReviewDiffCommentAttachment,
} from "@/lib/review-diff-comment-attachment-store";
import {
  formatReviewDiffCommentLineLabel,
  getReviewDiffCommentText,
} from "../../../../../shared/review-diff-comments";
import {
  hasPlanMode,
  resolveNextComposerPlanMode,
  shouldShowComposerPlanKeywordSuggestion,
} from "./composer-plan-mode";
import {
  buildComposerThreadGoalDraft,
  type ComposerThreadGoalDraft,
} from "./composer-thread-goal-draft";
import { getThreadGoalMessage } from "../../thread-goal-copy";
import {
  cleanupMaterializedThreadGoalDraft,
  materializeThreadGoalDraft,
} from "../../thread-goal-materialization";
import {
  COMPOSER_FOOTER_GHOST_BUTTON_CLASS_NAME,
  COMPOSER_FOOTER_GHOST_ICON_BUTTON_CLASS_NAME,
  COMPOSER_FOOTER_LABEL_NARROW_CLASS_NAME,
  COMPOSER_FOOTER_LABEL_WIDE_CLASS_NAME,
  COMPOSER_FOOTER_PLAN_ACCESSORY_BUTTON_CLASS_NAME,
  ComposerFooterAccessoryDivider,
} from "../shared/composer-footer-controls";
import {
  clearComposerCompletedDraftAtom,
  composerAddedFilesAtom,
  composerConsumedIntentNonceAtom,
  composerDraftInitializedAtom,
  composerDraftTransferFamily,
  composerFileAttachmentsAtom,
  composerGoalModeActiveAtom,
  composerImageAttachmentsAtom,
  composerPastedTextAttachmentsAtom,
  composerResetGenerationAtom,
  composerReviewCommentAttachmentsFamily,
  composerSkillMentionsAtom,
  useComposerPromptDraft,
  type ComposerCompletedDraftSnapshot,
  type ComposerFileAttachment,
  type ComposerImageAttachment,
  type ComposerPastedTextAttachment,
  type ComposerSkillMentionAttachment,
} from "./composer-draft-state";
import {
  useScopedAtom,
  useScopedAtomValue,
  useScopeHandle,
  useSetScopedAtom,
} from "@/lib/maitai";
import { ComposerScope } from "@/lib/workbench-ui-scopes";

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
  serviceTier: CodexServiceTier;
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
          <CodexFastModeIcon className="icon-2xs text-token-link-foreground shrink-0" />
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

interface ComposerAttachmentState {
  fileAttachments: readonly ComposerFileAttachment[];
  addedFiles: readonly ComposerFileAttachment[];
  imageAttachments: readonly ComposerImageAttachment[];
  pastedTextAttachments: readonly ComposerPastedTextAttachment[];
  skillMentions: readonly ComposerSkillMentionAttachment[];
  commentAttachments: readonly CodexReviewDiffCommentAttachment[];
}

interface ThreadGoalSubmissionDraft extends ComposerThreadGoalDraft {
  imageAttachments: NonNullable<CodexThreadGoalDraftInput["imageAttachments"]>;
  pastedTextAttachments: NonNullable<CodexThreadGoalDraftInput["pastedTextAttachments"]>;
  hasUnsupportedAttachments: boolean;
}

interface ThreadGoalReplacementConfirmationState {
  draft: ThreadGoalSubmissionDraft;
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
  const text = input.prompt;
  const images = input.attachments.imageAttachments.map((attachment) => ({
    source: attachment.dataUrl,
    caption: attachment.filename,
  }));
  const textAttachments = input.attachments.pastedTextAttachments.map((attachment) => ({
    text: attachment.text,
    ...(attachment.file === undefined ? {} : { file: { ...attachment.file } }),
    ...(attachment.preview === undefined ? {} : { preview: attachment.preview }),
    ...(attachment.hostId === undefined ? {} : { hostId: attachment.hostId }),
    ...(attachment.characterCount === undefined
      ? {}
      : { characterCount: attachment.characterCount }),
  }));
  const fileAttachments = dedupeCodexLiveFileAttachments(
    input.attachments.fileAttachments.map((item) => item.attachment),
  ).map((attachment) => ({ ...attachment }));
  const addedFiles = dedupeCodexLiveFileAttachments(
    input.attachments.addedFiles.map((item) => item.attachment),
  ).map((attachment) => ({ ...attachment }));
  const skills = input.attachments.skillMentions.map((attachment) => ({
    name: attachment.name,
    path: attachment.path,
  }));
  const commentAttachments = [...input.attachments.commentAttachments];

  if (
    images.length === 0
    && textAttachments.length === 0
    && fileAttachments.length === 0
    && addedFiles.length === 0
    && skills.length === 0
    && commentAttachments.length === 0
  ) {
    return undefined;
  }

  return {
    text,
    ...(images.length > 0 ? { images } : {}),
    ...(textAttachments.length > 0 ? { textAttachments } : {}),
    ...(fileAttachments.length > 0 ? { fileAttachments } : {}),
    ...(addedFiles.length > 0 ? { addedFiles } : {}),
    ...(skills.length > 0 ? { skills } : {}),
    ...(commentAttachments.length > 0 ? { commentAttachments } : {}),
  };
}

function getComposerAttachmentNameFromPath(path: string, fallback: string): string {
  return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? fallback;
}

function buildComposerAttachmentStateFromPromptInput(promptInput?: CodexPromptInput): ComposerAttachmentState {
  const fileAttachments = promptInput?.fileAttachments !== undefined
    ? dedupeCodexLiveFileAttachments(promptInput.fileAttachments).map((attachment) => ({
        uiId: createComposerAttachmentId("file"),
        attachment: { ...attachment },
      }))
    : (promptInput?.mentions ?? []).map((mention) => ({
        uiId: createComposerAttachmentId("file"),
        attachment: {
          label: mention.name.trim()
            || getComposerAttachmentNameFromPath(mention.path, "Attachment"),
          path: mention.path,
          fsPath: mention.path,
        },
      }));
  const addedFiles = dedupeCodexLiveFileAttachments(
    promptInput?.addedFiles ?? [],
  ).map((attachment) => ({
    uiId: createComposerAttachmentId("added_file"),
    attachment: { ...attachment },
  }));
  return {
    imageAttachments: (promptInput?.images ?? []).map((image) => ({
      id: createComposerAttachmentId("image"),
      filename: image.caption?.trim() || getComposerAttachmentNameFromPath(image.source, "Image"),
      path: image.source,
      dataUrl: image.source,
    })),
    pastedTextAttachments: (promptInput?.textAttachments ?? []).map((attachment) => ({
      id: createComposerAttachmentId("pasted_text"),
      text: attachment.text,
      ...(attachment.file === undefined ? {} : { file: { ...attachment.file } }),
      ...(attachment.preview === undefined ? {} : { preview: attachment.preview }),
      ...(attachment.hostId === undefined ? {} : { hostId: attachment.hostId }),
      ...(attachment.characterCount === undefined
        ? {}
        : { characterCount: attachment.characterCount }),
    })),
    fileAttachments,
    addedFiles,
    skillMentions: (promptInput?.skills ?? []).map((skill) => ({
      id: createComposerAttachmentId("skill"),
      name: skill.name.trim() || getComposerAttachmentNameFromPath(skill.path, "Skill"),
      path: skill.path,
    })),
    commentAttachments: promptInput?.commentAttachments ?? [],
  };
}

function canStartNewThreadTarget(model: ThreadFooterModel): boolean {
  return Boolean(
    model.isNewThreadTab &&
    model.newThreadTarget !== null &&
    !model.isCloudNewThreadTarget &&
    Boolean(model.newThreadTarget.sessionId),
  );
}

function hasComposerAttachmentStateContent(attachments: ComposerAttachmentState): boolean {
  return attachments.fileAttachments.length > 0
    || attachments.addedFiles.length > 0
    || attachments.imageAttachments.length > 0
    || attachments.pastedTextAttachments.length > 0
    || attachments.skillMentions.length > 0
    || attachments.commentAttachments.length > 0;
}

function buildThreadGoalSubmissionDraft(
  draft: ComposerThreadGoalDraft,
  attachments: ComposerAttachmentState,
): ThreadGoalSubmissionDraft {
  return {
    ...draft,
    imageAttachments: attachments.imageAttachments.map((attachment) => ({
      src: attachment.dataUrl,
      localPath: attachment.path,
      filename: attachment.filename,
    })),
    pastedTextAttachments: attachments.pastedTextAttachments.map((attachment) => ({
      text: attachment.text,
      ...(attachment.file === undefined ? {} : { file: { ...attachment.file } }),
      ...(attachment.preview === undefined ? {} : { preview: attachment.preview }),
      ...(attachment.hostId === undefined ? {} : { hostId: attachment.hostId }),
      ...(attachment.characterCount === undefined
        ? {}
        : { characterCount: attachment.characterCount }),
    })),
    hasUnsupportedAttachments: attachments.fileAttachments.length > 0
      || attachments.addedFiles.length > 0
      || attachments.skillMentions.length > 0
      || attachments.commentAttachments.length > 0,
  };
}

function parseSideChatCommand(prompt: string): string | null {
  const match = prompt.match(/^\/side(?:\s+([\s\S]*))?$/u);
  if (!match) return null;
  return (match[1] ?? "").trim();
}

export const __composerAddContextTestUtils = {
  buildComposerAttachmentStateFromPromptInput,
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
  const planModeAvailable = hasPlanMode(model.collaborationModes);
  const togglePlanMode = () => {
    const nextMode = resolveNextComposerPlanMode({
      currentMode: model.selectedCollaborationMode,
      modes: model.collaborationModes,
    });
    if (!nextMode) return;
    void actions.onCollaborationModeChange(nextMode);
  };

  return (
    <NodexDropdownMenu
      disabled={disabled}
      triggerButton={(
        <button
          type="button"
          className={COMPOSER_FOOTER_GHOST_ICON_BUTTON_CLASS_NAME}
          aria-label={triggerLabel}
          title={triggerLabel}
          disabled={disabled}
        >
          <PlusIcon className="icon-sm" />
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

      {(showIdeContext || planModeAvailable) ? (
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

      {planModeAvailable ? (
        <NodexDropdownItem
          leftSlot={<ComposerPlanModeIcon className="opacity-75 group-focus:opacity-100 group-hover:opacity-100" />}
          rightSlot={<ComposerMenuSwitch checked={model.selectedCollaborationMode === "plan"} />}
          onSelect={togglePlanMode}
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
  onToggle,
}: {
  model: ThreadFooterModel;
  onToggle: () => void;
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
        className={COMPOSER_FOOTER_PLAN_ACCESSORY_BUTTON_CLASS_NAME}
        onClick={() => {
          onToggle();
        }}
      >
        <ComposerPlanModeIcon className="group-hover:hidden" />
        <ComposerPlanModeCloseIcon className="hidden group-hover:block" />
        <span className={COMPOSER_FOOTER_LABEL_NARROW_CLASS_NAME}>Plan</span>
      </button>
    </NodexTooltip>
  );
}

function ActiveGoalModeChip({
  active,
  onClear,
}: {
  active: boolean;
  onClear: () => void;
}) {
  if (!active) {
    return null;
  }

  return (
    <NodexTooltip
      tooltipContent={<span className="text-token-foreground">{getThreadGoalMessage("composer.goalModeIndicator.tooltip")}</span>}
      side="top"
      align="center"
      sideOffset={4}
    >
      <button
        type="button"
        aria-label={getThreadGoalMessage("composer.goalModeIndicator.clear")}
        className={COMPOSER_FOOTER_PLAN_ACCESSORY_BUTTON_CLASS_NAME}
        onClick={() => {
          onClear();
        }}
      >
        <CodexGoalTargetIcon className="icon-xs shrink-0 group-hover:hidden" />
        <CodexGoalClearIcon className="icon-xs hidden shrink-0 group-hover:block" />
        <span className={COMPOSER_FOOTER_LABEL_WIDE_CLASS_NAME}>
          {getThreadGoalMessage("composer.goalModeIndicator")}
        </span>
      </button>
    </NodexTooltip>
  );
}

function ThreadGoalReplacementConfirmationDialog({
  confirmation,
  pending,
  onCancel,
  onConfirm,
}: {
  confirmation: ThreadGoalReplacementConfirmationState | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!confirmation) {
    return null;
  }

  return (
    <NodexDialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onCancel();
        }
      }}
    >
      <NodexDialogContent
        className="max-w-[28rem] gap-4 rounded-2xl p-5"
        showCloseButton={false}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm();
          }}
        >
          <NodexDialogHeader className="gap-1 text-left">
            <NodexDialogTitle className="text-base">
              {getThreadGoalMessage("composer.threadGoal.replaceConfirmation.title")}
            </NodexDialogTitle>
            <NodexDialogDescription>
              {getThreadGoalMessage("composer.threadGoal.replaceConfirmation.subtitle")}
            </NodexDialogDescription>
          </NodexDialogHeader>
          <div className="line-clamp-4 rounded-lg bg-token-bg-secondary px-3 py-2 text-sm text-token-foreground">
            {confirmation.draft.objective}
          </div>
          <NodexDialogFooter>
            <NodexButton
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={onCancel}
            >
              {getThreadGoalMessage("composer.threadGoal.replaceConfirmation.cancel")}
            </NodexButton>
            <NodexButton type="submit" disabled={pending}>
              {getThreadGoalMessage("composer.threadGoal.replaceConfirmation.confirm")}
            </NodexButton>
          </NodexDialogFooter>
        </form>
      </NodexDialogContent>
    </NodexDialog>
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

function PlanKeywordSuggestion({
  onUsePlanMode,
  onDismiss,
}: {
  onUsePlanMode: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="@container pointer-events-none absolute inset-x-0 bottom-full z-20 mb-2 flex justify-center"
      data-plan-keyword-suggestion="true"
    >
      <div className="pointer-events-auto flex w-full max-w-full justify-center">
        <div
          className="relative inline-flex max-w-full min-w-0 items-center justify-between gap-4 overflow-hidden rounded-3xl border border-token-border/80 bg-token-dropdown-background/90 py-1.5 pr-2 pl-3 text-token-foreground shadow-md backdrop-blur-sm"
          data-codex-above-composer-suggestion="keyword-plan-mode"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="flex items-center justify-center text-token-foreground">
              <ComposerPlanModeIcon className="icon-xs shrink-0" />
            </span>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate text-sm leading-[18px] font-medium text-token-foreground">
                Create a plan
              </span>
              <span className="hidden text-sm leading-none text-token-description-foreground @[500px]:inline">
                <button
                  type="button"
                  className="border-token-border no-drag cursor-interaction pointer-events-none flex !h-auto items-center gap-1 rounded-md border bg-token-bg-fog px-1 py-0.5 text-xs leading-[18px] !leading-none whitespace-nowrap text-token-button-tertiary-foreground select-none focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:bg-token-list-hover-background data-[state=open]:bg-token-list-hover-background"
                  aria-hidden="true"
                  tabIndex={-1}
                >
                  Shift + Tab
                </button>
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="border-token-border no-drag cursor-interaction flex items-center gap-1 rounded-full border border-transparent bg-token-foreground/5 px-2.5 py-0.5 text-sm leading-[18px] whitespace-nowrap text-token-foreground select-none focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:bg-token-foreground/10 data-[state=open]:bg-token-foreground/10"
              data-codex-above-composer-suggestion-action="true"
              onClick={(event) => {
                event.stopPropagation();
                onUsePlanMode();
              }}
            >
              Use plan mode
            </button>
            <button
              type="button"
              aria-label="Dismiss suggestion"
              className="no-drag flex size-[22px] shrink-0 cursor-interaction items-center justify-center rounded-full border border-transparent text-token-description-foreground select-none hover:bg-token-list-hover-background focus:outline-none"
              onClick={(event) => {
                event.stopPropagation();
                onDismiss();
              }}
            >
              <CodexCloseIcon className="icon-xs" />
            </button>
          </div>
        </div>
      </div>
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
  serviceTier: CodexServiceTier;
  showFastIndicator: boolean;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1 tabular-nums">
      {input.showFastIndicator && input.serviceTier === "fast" ? (
        <CodexFastModeIcon className="icon-2xs text-token-link-foreground shrink-0" />
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
  serviceTier: CodexServiceTier;
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

function LegacyIntelligenceSelectorDropdown({
  model,
  serviceTier,
  onServiceTierChange,
  actions,
}: {
  model: ThreadFooterModel;
  serviceTier: CodexServiceTier;
  onServiceTierChange: (nextTier: CodexServiceTier) => void;
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
          className={`${COMPOSER_FOOTER_GHOST_BUTTON_CLASS_NAME} min-w-0`}
        >
          <span className="flex max-w-40 min-w-0 items-center gap-1.5">
            <span className="flex min-w-0 items-center gap-1 tabular-nums">
              <span className="truncate whitespace-nowrap text-token-foreground">{modelLabel}</span>
            </span>
            <span className="_labelSm_z984f_2 shrink-0 text-token-description-foreground">{reasoningLabel}</span>
          </span>
          <ChevronDownIcon className="icon-2xs text-token-input-placeholder-foreground" />
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

function formatProviderCredentialStatus(provider: AgentProviderOption): string {
  switch (provider.credentialStatus) {
    case "ready":
      return "API key saved";
    case "inherited":
      return "Using environment key";
    case "runtimeManaged":
      return "Managed by Codex sign-in";
    case "missing":
      return "API key required";
    case "unavailable":
      return "Secure storage unavailable";
    case "unsupported":
      return "Credential setup unsupported";
  }
}

function ProviderCredentialControl({
  provider,
  actions,
}: {
  provider: AgentProviderOption;
  actions: ThreadStageActions;
}) {
  const [editing, setEditing] = useState(provider.credentialStatus === "missing");
  const [apiKey, setApiKey] = useState("");
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const canManage = provider.credentialEnvKey !== null
    && actions.onProviderCredentialSet
    && actions.onProviderCredentialDelete;
  const isReady = isAgentProviderCredentialReady(provider);

  if (!canManage || provider.credentialStatus === "runtimeManaged") {
    return (
      <NodexDropdownMessage compact>{formatProviderCredentialStatus(provider)}</NodexDropdownMessage>
    );
  }

  if (!editing) {
    return (
      <div className="flex min-w-0 items-center gap-2 px-2 py-1.5 text-xs">
        <span className="min-w-0 flex-1 truncate text-token-description-foreground">
          {formatProviderCredentialStatus(provider)}
        </span>
        <button
          type="button"
          className="shrink-0 cursor-interaction text-token-link-foreground focus:outline-none hover:underline"
          onClick={() => {
            setErrorMessage(null);
            setEditing(true);
          }}
        >
          {isReady ? "Replace" : "Configure"}
        </button>
        {provider.credentialStatus === "ready" ? (
          <button
            type="button"
            className="shrink-0 cursor-interaction text-token-description-foreground focus:outline-none hover:text-token-error-foreground"
            disabled={pending}
            onClick={() => {
              setPending(true);
              setErrorMessage(null);
              void actions.onProviderCredentialDelete?.(provider.id)
                .catch((error) => {
                  setErrorMessage(error instanceof Error ? error.message : String(error));
                })
                .finally(() => setPending(false));
            }}
          >
            Remove
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-1.5 px-2 py-2"
      onSubmit={(event) => {
        event.preventDefault();
        const normalized = apiKey.trim();
        if (!normalized || pending) return;
        setPending(true);
        setErrorMessage(null);
        void actions.onProviderCredentialSet?.(provider.id, normalized)
          .then(() => {
            setApiKey("");
            setEditing(false);
          })
          .catch((error) => {
            setErrorMessage(error instanceof Error ? error.message : String(error));
          })
          .finally(() => setPending(false));
      }}
    >
      <div className="flex items-center gap-1.5">
        <input
          type="password"
          aria-label={`${provider.displayName} API key`}
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          placeholder={provider.credentialEnvKey ?? "API key"}
          className="h-7 min-w-0 flex-1 rounded-md border border-token-input-border bg-token-input-background px-2 text-xs text-token-input-foreground outline-none placeholder:text-token-input-placeholder-foreground focus:border-token-input-border-focus"
          onChange={(event) => setApiKey(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
        />
        <button
          type="submit"
          disabled={pending || apiKey.trim().length === 0}
          className="h-7 shrink-0 cursor-interaction rounded-md bg-token-button-primary-background px-2 text-xs text-token-button-primary-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      <span className="truncate text-[11px] text-token-description-foreground">
        Stored by the main process in encrypted OS storage.
      </span>
      {errorMessage ? (
        <span className="text-[11px] text-token-error-foreground">{errorMessage}</span>
      ) : null}
    </form>
  );
}

function AgentModelMenuItem({
  candidate,
  model,
  actions,
}: {
  candidate: AgentModelOption;
  model: ThreadFooterModel;
  actions: ThreadStageActions;
}) {
  const current = model.executionProfile;
  const selected = current?.providerId === candidate.providerId
    && current.modelId === candidate.modelId;
  const locked = model.executionProfileLocked === true;

  return (
    <NodexDropdownItem
      disabled={locked}
      onSelect={() => {
        actions.onExecutionProfileChange?.(selectAgentModel(candidate, current ?? null));
      }}
      rightSlot={selected ? <NodexDropdownSelectedIcon /> : null}
      subText={candidate.description ?? undefined}
      tooltipText={locked ? "Start a new thread to change provider or model" : undefined}
      data-agent-model-selected={selected ? "true" : undefined}
    >
      {candidate.displayName}
    </NodexDropdownItem>
  );
}

function AgentIntelligenceSelectorDropdown({
  model,
  serviceTier,
  onServiceTierChange,
  actions,
}: {
  model: ThreadFooterModel;
  serviceTier: CodexServiceTier;
  onServiceTierChange: (nextTier: CodexServiceTier) => void;
  actions: ThreadStageActions;
}) {
  const catalog = model.agentProviderCatalog;
  const profile = model.executionProfile;
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  if (!catalog || !profile) return null;

  const provider = findAgentProvider(catalog, profile.providerId);
  const selectedModel = findAgentModel(catalog, profile);
  if (!provider) return null;
  const normalizedQuery = deferredQuery.trim().toLocaleLowerCase();
  const matchingModels = provider.models.filter((candidate) => (
    !candidate.hidden
    && (!normalizedQuery || `${candidate.displayName} ${candidate.modelId}`.toLocaleLowerCase().includes(normalizedQuery))
  ));
  const orderedModels = [
    ...matchingModels.filter((candidate) => candidate.modelId === profile.modelId),
    ...matchingModels.filter((candidate) => candidate.modelId !== profile.modelId),
  ];
  const visibleModels = orderedModels.slice(0, 50);
  const hiddenMatchCount = matchingModels.length - visibleModels.length;
  const reasoningOptions = selectedModel?.supportedReasoningEfforts ?? [];
  const modelLabel = selectedModel?.displayName ?? profile.modelId;
  const reasoningLabel = formatCodexReasoningEffortLabel(profile.reasoningEffort ?? undefined);
  const locked = model.executionProfileLocked === true;
  const effectiveServiceTier = profile.providerId === "openai" ? serviceTier : null;

  return (
    <NodexDropdownMenu
      triggerButton={(
        <button
          type="button"
          aria-label="Select provider, model, and reasoning"
          className={`${COMPOSER_FOOTER_GHOST_BUTTON_CLASS_NAME} min-w-0`}
        >
          <span className="flex max-w-48 min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate whitespace-nowrap text-token-foreground">
              {effectiveServiceTier === "fast" ? (
                <CodexFastModeIcon className="icon-2xs mr-1 inline text-token-link-foreground" />
              ) : null}
              {modelLabel}
            </span>
            <span className="_labelSm_z984f_2 shrink-0 text-token-description-foreground">
              {reasoningLabel}
            </span>
          </span>
          <ChevronDownIcon className="icon-2xs text-token-input-placeholder-foreground" />
        </button>
      )}
      side="top"
      align="start"
      contentWidth="menuNarrow"
    >
      <NodexDropdownSection className="flex flex-col overflow-hidden">
        <NodexDropdownTitle>Reasoning</NodexDropdownTitle>
        {reasoningOptions.length === 0 ? (
          <NodexDropdownMessage compact>Runtime default</NodexDropdownMessage>
        ) : reasoningOptions.map((option) => (
          <NodexDropdownItem
            key={option.value}
            disabled={locked}
            onSelect={() => {
              const next = selectAgentReasoningEffort(catalog, profile, option.value);
              if (next) actions.onExecutionProfileChange?.(next);
            }}
            rightSlot={option.value === profile.reasoningEffort ? <NodexDropdownSelectedIcon /> : null}
            subText={option.description ?? undefined}
            tooltipText={locked ? "Reasoning is fixed for this thread" : undefined}
            data-intelligence-option={option.value}
          >
            {formatCodexReasoningEffortLabel(option.value)}
          </NodexDropdownItem>
        ))}
      </NodexDropdownSection>
      <NodexDropdownSeparator />
      <NodexDropdownFlyoutSubmenuItem
        label={modelLabel}
        contentClassName="min-w-[280px]"
        triggerContent={(
          <div className="flex w-full min-w-0 items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate">{provider.displayName} · {modelLabel}</span>
            <ChevronRightIcon className="icon-xs shrink-0 text-token-input-placeholder-foreground" />
          </div>
        )}
      >
        <NodexDropdownSection className="flex min-w-[280px] flex-col overflow-hidden">
          <NodexDropdownTitle>{provider.displayName}</NodexDropdownTitle>
          {provider.models.filter((candidate) => !candidate.hidden).length > 8 ? (
            <div className="px-1 pb-1">
              <NodexDropdownSearchInput
                value={query}
                placeholder="Filter models…"
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          ) : null}
          <div className="vertical-scroll-fade-mask flex max-h-[250px] flex-col overflow-y-auto">
            {visibleModels.length === 0 ? (
              <NodexDropdownMessage compact centered>No matching models</NodexDropdownMessage>
            ) : visibleModels.map((candidate) => (
              <AgentModelMenuItem
                key={`${candidate.providerId}:${candidate.modelId}`}
                candidate={candidate}
                model={model}
                actions={actions}
              />
            ))}
            {hiddenMatchCount > 0 ? (
              <NodexDropdownMessage compact centered>
                Refine the search to see {hiddenMatchCount} more models
              </NodexDropdownMessage>
            ) : null}
          </div>
          <NodexDropdownSeparator />
          <NodexDropdownFlyoutSubmenuItem
            label="Change provider"
            disabled={locked}
            contentClassName="min-w-60"
          >
            <NodexDropdownSection className="flex min-w-60 flex-col overflow-hidden">
              <NodexDropdownTitle>Provider</NodexDropdownTitle>
              {catalog.providers.map((candidate) => (
                <NodexDropdownItem
                  key={candidate.id}
                  disabled={!candidate.supportedByNodex || candidate.models.every((item) => item.hidden)}
                  onSelect={() => {
                    const next = selectAgentProvider(catalog, candidate.id, profile);
                    if (next) actions.onExecutionProfileChange?.(next);
                  }}
                  rightSlot={candidate.id === provider.id ? <NodexDropdownSelectedIcon /> : null}
                  subText={formatProviderCredentialStatus(candidate)}
                >
                  {candidate.displayName}
                </NodexDropdownItem>
              ))}
            </NodexDropdownSection>
          </NodexDropdownFlyoutSubmenuItem>
          <NodexDropdownSeparator />
          <ProviderCredentialControl provider={provider} actions={actions} />
          {locked ? (
            <NodexDropdownMessage compact>Provider and model are fixed for this thread.</NodexDropdownMessage>
          ) : null}
        </NodexDropdownSection>
      </NodexDropdownFlyoutSubmenuItem>
      {profile.providerId === "openai" && !locked ? (
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
      ) : null}
    </NodexDropdownMenu>
  );
}

function IntelligenceSelectorDropdown(props: {
  model: ThreadFooterModel;
  serviceTier: CodexServiceTier;
  onServiceTierChange: (nextTier: CodexServiceTier) => void;
  actions: ThreadStageActions;
}) {
  if (props.model.agentProviderCatalog && props.model.executionProfile && props.actions.onExecutionProfileChange) {
    return <AgentIntelligenceSelectorDropdown {...props} />;
  }
  return <LegacyIntelligenceSelectorDropdown {...props} />;
}

function replaceReviewCommentAttachments(
  threadId: string | null,
  attachments: readonly CodexReviewDiffCommentAttachment[],
): void {
  clearReviewDiffCommentAttachments(threadId);
  for (const attachment of attachments) addReviewDiffCommentAttachment(threadId, attachment);
}

function appendUniqueBy<Value>(
  current: readonly Value[],
  incoming: readonly Value[],
  getKey: (value: Value) => string,
): readonly Value[] {
  const next = new Map(current.map((value) => [getKey(value), value] as const));
  for (const value of incoming) next.set(getKey(value), value);
  return [...next.values()];
}

function applyCompletedDraftSnapshot(input: {
  snapshot: ComposerCompletedDraftSnapshot;
  setFileAttachments: (value: readonly ComposerFileAttachment[]) => void;
  setAddedFiles: (value: readonly ComposerFileAttachment[]) => void;
  setImageAttachments: (value: readonly ComposerImageAttachment[]) => void;
  setPastedTextAttachments: (value: readonly ComposerPastedTextAttachment[]) => void;
  setSkillMentions: (value: readonly ComposerSkillMentionAttachment[]) => void;
  setGoalModeActive: (value: boolean) => void;
  threadId: string | null;
}): void {
  input.setFileAttachments(input.snapshot.fileAttachments);
  input.setAddedFiles(input.snapshot.addedFiles);
  input.setImageAttachments(input.snapshot.imageAttachments);
  input.setPastedTextAttachments(input.snapshot.pastedTextAttachments);
  input.setSkillMentions(input.snapshot.skillMentions);
  input.setGoalModeActive(input.snapshot.goalModeActive);
  replaceReviewCommentAttachments(input.threadId, input.snapshot.commentAttachments);
}

interface HydratedThreadComposerProps extends ThreadComposerProps {
  readonly prompt: string;
  readonly setPrompt: (prompt: string) => void;
  readonly clearSubmittedDraft: () => void;
}

export function ThreadComposer(props: ThreadComposerProps) {
  const { model, actions, onErrorMessage } = props;
  const composerThreadId = model.conversation?.threadId ?? model.threadId;
  const promptDraft = useComposerPromptDraft(composerThreadId);
  const [initialized, setInitialized] = useScopedAtom(composerDraftInitializedAtom);
  const [consumedIntentNonce, setConsumedIntentNonce] = useScopedAtom(
    composerConsumedIntentNonceAtom,
  );
  const [, setFileAttachments] = useScopedAtom(composerFileAttachmentsAtom);
  const [, setAddedFiles] = useScopedAtom(composerAddedFilesAtom);
  const [, setImageAttachments] = useScopedAtom(composerImageAttachmentsAtom);
  const [, setPastedTextAttachments] = useScopedAtom(
    composerPastedTextAttachmentsAtom,
  );
  const [, setSkillMentions] = useScopedAtom(composerSkillMentionsAtom);
  const [, setGoalModeActive] = useScopedAtom(composerGoalModeActiveAtom);
  const resetGeneration = useScopedAtomValue(composerResetGenerationAtom);
  const clearCompletedDraft = useSetScopedAtom(clearComposerCompletedDraftAtom);
  const composerHandle = useScopeHandle(ComposerScope);
  const transferDefinition = composerDraftTransferFamily(
    composerThreadId ?? `inactive:${composerHandle.path}`,
  );
  const [transfer, setTransfer] = useScopedAtom(transferDefinition);
  const consumedIntentNonceRef = useRef(consumedIntentNonce);
  const consumedTransferIdRef = useRef<string | null>(null);
  const intent = model.composerIntent ?? model.newThreadComposerIntent ?? null;

  useLayoutEffect(() => {
    if (promptDraft.loadable.status === "loading") return;

    if (
      transfer
      && composerThreadId
      && transfer.targetConversationId === composerThreadId
      && consumedTransferIdRef.current !== transfer.transferId
    ) {
      consumedTransferIdRef.current = transfer.transferId;
      applyCompletedDraftSnapshot({
        snapshot: transfer,
        setFileAttachments,
        setAddedFiles,
        setImageAttachments,
        setPastedTextAttachments,
        setSkillMentions,
        setGoalModeActive,
        threadId: composerThreadId,
      });
      void promptDraft.setPrompt(transfer.prompt).catch((error: unknown) => {
        onErrorMessage(error instanceof Error ? error.message : "Could not restore composer draft");
      });
      setTransfer(null);
    }

    if (intent && consumedIntentNonceRef.current !== intent.focusNonce) {
      consumedIntentNonceRef.current = intent.focusNonce;
      const restored = buildComposerAttachmentStateFromPromptInput(intent.promptInput);
      const append = intent.attachmentMode === "append";
      if (append) {
        setFileAttachments((current) => appendUniqueBy(
          current,
          restored.fileAttachments,
          (attachment) => attachment.attachment.fsPath ?? attachment.attachment.path ?? attachment.uiId,
        ));
        setAddedFiles((current) => appendUniqueBy(
          current,
          restored.addedFiles,
          (attachment) => attachment.attachment.fsPath ?? attachment.attachment.path ?? attachment.uiId,
        ));
        setImageAttachments((current) => appendUniqueBy(
          current,
          restored.imageAttachments,
          (attachment) => attachment.path || attachment.dataUrl,
        ));
        setPastedTextAttachments((current) => appendUniqueBy(
          current,
          restored.pastedTextAttachments,
          (attachment) => attachment.id,
        ));
        setSkillMentions((current) => appendUniqueBy(
          current,
          restored.skillMentions,
          (attachment) => attachment.path,
        ));
        for (const attachment of restored.commentAttachments) {
          addReviewDiffCommentAttachment(composerThreadId, attachment);
        }
      } else {
        setFileAttachments(restored.fileAttachments);
        setAddedFiles(restored.addedFiles);
        setImageAttachments(restored.imageAttachments);
        setPastedTextAttachments(restored.pastedTextAttachments);
        setSkillMentions(restored.skillMentions);
        replaceReviewCommentAttachments(composerThreadId, restored.commentAttachments);
      }

      if (intent.prompt.length > 0 || intent.clearText === true) {
        void promptDraft.setPrompt(intent.clearText === true ? "" : intent.prompt)
          .catch((error: unknown) => {
            onErrorMessage(error instanceof Error ? error.message : "Could not apply composer intent");
          });
      }
      setConsumedIntentNonce(intent.focusNonce);
      if (composerThreadId) {
        actions.onConsumeComposerIntent(composerThreadId, intent.focusNonce);
      } else if (model.newThreadTarget?.sessionId) {
        actions.onConsumeNewThreadComposerIntent?.(
          model.newThreadTarget.sessionId,
          intent.focusNonce,
        );
      }
    }

    if (!initialized) setInitialized(true);
  }, [
    actions,
    composerThreadId,
    initialized,
    intent,
    model.newThreadTarget?.sessionId,
    onErrorMessage,
    promptDraft,
    setAddedFiles,
    setConsumedIntentNonce,
    setFileAttachments,
    setGoalModeActive,
    setImageAttachments,
    setInitialized,
    setPastedTextAttachments,
    setSkillMentions,
    setTransfer,
    transfer,
  ]);

  const setPrompt = useCallback((nextPrompt: string) => {
    void promptDraft.setPrompt(nextPrompt).catch((error: unknown) => {
      onErrorMessage(error instanceof Error ? error.message : "Could not save composer draft");
    });
  }, [onErrorMessage, promptDraft]);
  const clearSubmittedDraft = useCallback(() => {
    clearCompletedDraft();
    clearReviewDiffCommentAttachments(composerThreadId);
    void promptDraft.clear().catch((error: unknown) => {
      onErrorMessage(error instanceof Error ? error.message : "Could not clear composer draft");
    });
  }, [clearCompletedDraft, composerThreadId, onErrorMessage, promptDraft]);

  if (promptDraft.loadable.status === "loading" || !initialized) {
    return (
      <div
        data-composer-draft-hydration="loading"
        className="min-h-24 rounded-[20px] border border-token-border bg-token-main-surface-primary"
      />
    );
  }

  return (
    <HydratedThreadComposer
      key={resetGeneration}
      {...props}
      prompt={promptDraft.prompt}
      setPrompt={setPrompt}
      clearSubmittedDraft={clearSubmittedDraft}
    />
  );
}

function HydratedThreadComposer({
  model,
  actions,
  errorMessage,
  onErrorMessage,
  prompt,
  setPrompt,
  clearSubmittedDraft,
}: HydratedThreadComposerProps) {
  const canStartNewThread = canStartNewThreadTarget(model);
  const [busyAction, setBusyAction] = useState<StageThreadsBusyAction>(null);
  const [permissionState, setPermissionState] = useState<CodexPermissionState | null>(null);
  const [dictationToastMessage, setDictationToastMessage] = useState<string | null>(null);
  const [fileAttachments, setFileAttachments] = useScopedAtom(composerFileAttachmentsAtom);
  const [addedFiles, setAddedFiles] = useScopedAtom(composerAddedFilesAtom);
  const [imageAttachments, setImageAttachments] = useScopedAtom(composerImageAttachmentsAtom);
  const [pastedTextAttachments, setPastedTextAttachments] = useScopedAtom(
    composerPastedTextAttachmentsAtom,
  );
  const [skillMentions, setSkillMentions] = useScopedAtom(composerSkillMentionsAtom);
  const [slashTrigger, setSlashTrigger] = useState<ComposerSlashTriggerState>(() => inactiveSlashTrigger());
  const [inlineSlashHighlightIntent, setInlineSlashHighlightIntent] = useState<ComposerSlashCommandHighlightIntent>({
    commandId: null,
    source: "programmatic",
  });
  const [nestedSlashCommand, setNestedSlashCommand] = useState<ComposerSlashCommand | null>(null);
  const [slashDialogOpen, setSlashDialogOpen] = useState(false);
  const [desktopPetVisible, setDesktopPetVisible] = useState(false);
  const [planKeywordSuggestionDismissed, setPlanKeywordSuggestionDismissed] = useState(false);
  const [goalModeActive, setGoalModeActive] = useScopedAtom(composerGoalModeActiveAtom);
  const [goalReplacementConfirmation, setGoalReplacementConfirmation] = useState<ThreadGoalReplacementConfirmationState | null>(null);
  const promptEditorRef = useRef<ComposerPromptEditorHandle>(null);
  const appendPromptToHistoryRef = useRef<(text: string) => void>(() => {});
  const resetPromptHistorySelectionRef = useRef<() => void>(() => {});
  const dictationShortcutActiveRef = useRef(false);
  const attachmentGenerationRef = useRef(0);
  const { serviceTierSettings, setServiceTier } = useCodexServiceTierSettings();
  const composerThreadId = model.conversation?.threadId ?? model.threadId;
  const commentAttachments = useScopedAtomValue(
    composerReviewCommentAttachmentsFamily(composerThreadId),
  );
  const attachmentState = useMemo<ComposerAttachmentState>(() => ({
    fileAttachments,
    addedFiles,
    imageAttachments,
    pastedTextAttachments,
    skillMentions,
    commentAttachments,
  }), [addedFiles, commentAttachments, fileAttachments, imageAttachments, pastedTextAttachments, skillMentions]);
  const hasAttachments = hasComposerAttachmentStateContent(attachmentState);
  const incrementAttachmentGeneration = useCallback(() => {
    attachmentGenerationRef.current += 1;
  }, []);
  const recordSuccessfulPromptSubmit = useCallback((text: string) => {
    appendPromptToHistoryRef.current(text);
    resetPromptHistorySelectionRef.current();
  }, []);
  const completeSuccessfulSubmission = useCallback((text: string) => {
    recordSuccessfulPromptSubmit(text);
    incrementAttachmentGeneration();
    clearSubmittedDraft();
  }, [clearSubmittedDraft, incrementAttachmentGeneration, recordSuccessfulPromptSubmit]);

  const submitThreadGoalDraft = useCallback(async (
    draft: ThreadGoalSubmissionDraft,
  ): Promise<boolean> => {
    if (draft.hasUnsupportedAttachments) {
      toast.danger(getThreadGoalMessage("composer.threadGoal.materializeError"), {
        id: "thread-goal-materialize-failed",
      });
      return false;
    }

    if (!model.conversation) {
      const target = model.newThreadTarget;
      if (!target?.sessionId || !actions.onStartThreadForSession) {
        onErrorMessage("Session thread creation is not available.");
        return false;
      }

      setBusyAction("send");
      onErrorMessage(null);
      let prompt = draft.objective;
      const threadGoalDraft: CodexThreadGoalDraftInput = {
        objective: draft.objective,
        imageAttachments: draft.imageAttachments.map((attachment) => ({ ...attachment })),
        pastedTextAttachments: draft.pastedTextAttachments.map((attachment) => ({ ...attachment })),
      };
      let threadGoalMaterializedDraft: CodexThreadGoalMaterializedDraft | undefined;
      if (target.runInTarget !== "newWorktree") {
        let materialized: CodexThreadGoalMaterializedDraft;
        try {
          materialized = await materializeThreadGoalDraft(threadGoalDraft);
        } catch {
          toast.danger(getThreadGoalMessage("composer.threadGoal.materializeError"), {
            id: "thread-goal-materialize-failed",
          });
          setBusyAction(null);
          return false;
        }
        prompt = materialized.objective;
        threadGoalMaterializedDraft = materialized;
      }

      try {
        await actions.onStartThreadForSession({
          projectId: target.projectId,
          sessionId: target.sessionId,
          prompt,
          threadGoalDraft,
          ...(threadGoalMaterializedDraft === undefined
            ? {}
            : { threadGoalMaterializedDraft }),
          runInTarget: target.runInTarget,
          runInEnvironmentPath: target.runInEnvironmentPath,
          worktreeStartMode: target.worktreeStartMode,
          worktreeBranchPrefix: target.worktreeBranchPrefix,
        });
        completeSuccessfulSubmission(draft.objective);
        return true;
      } catch (error) {
        onErrorMessage(error instanceof Error ? error.message : "Could not start thread goal");
        return false;
      } finally {
        setBusyAction(null);
      }
    }

    if (!actions.onSetThreadGoal) {
      onErrorMessage(getThreadGoalMessage("composer.threadGoal.setError"));
      return false;
    }

    setBusyAction("send");
    onErrorMessage(null);
    let materialized: CodexThreadGoalMaterializedDraft | null = null;
    try {
      materialized = await materializeThreadGoalDraft({
        objective: draft.objective,
        imageAttachments: draft.imageAttachments,
        pastedTextAttachments: draft.pastedTextAttachments,
      });
    } catch {
      toast.danger(getThreadGoalMessage("composer.threadGoal.materializeError"), {
        id: "thread-goal-materialize-failed",
      });
      setBusyAction(null);
      return false;
    }

    try {
      await actions.onSetThreadGoal({
        threadId: model.conversation.threadId,
        objective: materialized.objective,
        status: "active",
      });
      materialized = null;
      completeSuccessfulSubmission(draft.objective);
      return true;
    } catch {
      await cleanupMaterializedThreadGoalDraft(materialized);
      toast.danger(getThreadGoalMessage("composer.threadGoal.setError"), {
        id: "thread-goal-set-failed",
      });
      return false;
    } finally {
      setBusyAction(null);
    }
  }, [
    actions,
    completeSuccessfulSubmission,
    model.conversation,
    onErrorMessage,
    model.newThreadTarget,
  ]);

  const submitPrompt = useCallback(async (
    input: {
      prompt: string;
      submitAction: StageThreadsComposerSubmitAction | null;
    },
  ) => {
    const nextPrompt = input.prompt;
    const trimmedPrompt = nextPrompt.trim();
    const promptInput = buildComposerPromptInput({
      prompt: nextPrompt,
      attachments: attachmentState,
    });
    const hasPromptAttachments = promptInput !== undefined;
    const target = model.newThreadTarget;
    const goalActionAvailable = model.conversation !== null
      ? Boolean(actions.onSetThreadGoal)
      : Boolean(actions.onStartThreadForSession) && canStartNewThread;
    const goalDraftResult = buildComposerThreadGoalDraft({
      promptRaw: input.prompt,
      goalActionAvailable,
      goalModeActive,
      hasAttachments,
    });

    if (goalDraftResult.status === "empty") {
      setGoalModeActive(false);
      return;
    }

    if (goalDraftResult.status === "ready") {
      const currentGoal = model.conversation?.threadGoal ?? null;
      const submissionDraft = buildThreadGoalSubmissionDraft(goalDraftResult.draft, attachmentState);
      if (
        currentGoal
        && (
          currentGoal.objective !== submissionDraft.objective
          || submissionDraft.hasAttachments
        )
      ) {
        setGoalReplacementConfirmation({
          draft: submissionDraft,
        });
        return;
      }

      await submitThreadGoalDraft(submissionDraft);
      return;
    }

    if (!trimmedPrompt && !hasPromptAttachments) {
      return;
    }

    const sideChatPrompt = parseSideChatCommand(trimmedPrompt);
    if (sideChatPrompt !== null) {
      if (model.conversation?.source?.sideConversation === true) {
        toast.danger("'/side' is unavailable in side chats. Return to the main thread first", {
          id: "side-chat-unavailable-in-side-chat",
        });
        return;
      }
      if (!model.conversation || !actions.onOpenSideChat) {
        toast.danger("Failed to open side chat", {
          id: "side-chat-open-failed",
        });
        return;
      }

      setBusyAction("send");
      onErrorMessage(null);
      try {
        await actions.onOpenSideChat({
          prompt: sideChatPrompt,
          promptInput: promptInput
            ? {
                ...promptInput,
                text: sideChatPrompt,
              }
            : undefined,
        });
        completeSuccessfulSubmission(sideChatPrompt);
      } catch {
        toast.danger("Failed to open side chat", {
          id: "side-chat-open-failed",
        });
      } finally {
        setBusyAction(null);
      }
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
        } else {
          onErrorMessage("Select a session before starting a new thread.");
          return;
        }
      } else if (model.isThreadRunning) {
        if (input.submitAction === "queue") {
          await actions.onEnqueueQueuedFollowUp(model.conversation.threadId, nextPrompt, {
            collaborationMode: model.selectedCollaborationMode,
            promptInput,
          });
        } else if (input.submitAction === "steer") {
          if (!model.activeTurn || model.activeTurn.turnId === null) {
            onErrorMessage("Codex is already running. Wait for the active turn to load or queue the follow-up instead.");
            return;
          }
          await actions.onSteerPrompt({
            expectedTurnId: model.activeTurn.turnId,
            prompt: nextPrompt,
            promptInput,
            collaborationMode: model.selectedCollaborationMode,
          });
        } else {
          onErrorMessage("Codex is already running. Choose Queue or Steer before submitting a follow-up.");
          return;
        }
      } else {
        await actions.onSendPrompt(nextPrompt, {
          collaborationMode: model.selectedCollaborationMode,
          promptInput,
        });
      }
      completeSuccessfulSubmission(nextPrompt);
    } catch (error) {
      onErrorMessage(error instanceof Error ? error.message : "Could not send prompt");
    } finally {
      setBusyAction(null);
    }
  }, [
    actions,
    attachmentState,
    canStartNewThread,
    completeSuccessfulSubmission,
    goalModeActive,
    hasAttachments,
    model.activeTurn,
    model.conversation,
    model.isThreadRunning,
    model.newThreadTarget,
    model.selectedCollaborationMode,
    onErrorMessage,
    setGoalModeActive,
    submitThreadGoalDraft,
  ]);
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
    const normalizedTranscript = transcript.trim();
    if (normalizedTranscript.length === 0) {
      return prompt;
    }

    const editor = promptEditorRef.current;
    if (editor) {
      return editor.insertText(normalizedTranscript);
    }

    const nextPrompt = `${prompt}${normalizedTranscript}`;
    setPrompt(nextPrompt);
    return nextPrompt;
  }, [prompt, setPrompt]);

  const insertComposerTextAtSelection = useCallback((text: string) => {
    const editor = promptEditorRef.current;
    if (!editor) {
      setPrompt(`${prompt}${text}`);
      return;
    }

    editor.insertText(text);
  }, [prompt, setPrompt]);

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
  }, [incrementAttachmentGeneration, insertComposerTextAtSelection, prompt, setSkillMentions]);

  const handleToggleDesktopPet = useCallback(() => {
    setDesktopPetVisible((current) => !current);
  }, []);

  const activateGoalMode = useCallback(() => {
    setGoalModeActive(true);
    setPlanKeywordSuggestionDismissed(true);
    if (model.selectedCollaborationMode !== "plan") {
      return;
    }

    const nextMode = resolveNextComposerPlanMode({
      currentMode: model.selectedCollaborationMode,
      modes: model.collaborationModes,
    });
    if (nextMode) {
      void actions.onCollaborationModeChange(nextMode);
    }
  }, [actions, model.collaborationModes, model.selectedCollaborationMode, setGoalModeActive]);

  const clearFooterGoal = useCallback(() => {
    const savedGoal = model.conversation?.threadGoal ?? null;
    const clearThreadGoal = actions.onClearThreadGoal;
    setGoalModeActive(false);

    if (!savedGoal || !clearThreadGoal) {
      return;
    }

    void (async () => {
      try {
        await clearThreadGoal(savedGoal.threadId);
        promptEditorRef.current?.focusAtEnd();
      } catch {
        toast.danger(getThreadGoalMessage("composer.threadGoal.clearError"));
      }
    })();
  }, [actions.onClearThreadGoal, model.conversation?.threadGoal, setGoalModeActive]);

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
              uiId: createComposerAttachmentId("file"),
              attachment: {
                label: getComposerPickedFileName(pickedFile),
                path: pickedFile.path,
                fsPath: pickedFile.path,
              },
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
        setFileAttachments((current) => {
          const combined = [...current, ...nextFileAttachments];
          const retained = new Set(dedupeCodexLiveFileAttachments(
            combined.map((item) => item.attachment),
          ));
          return combined.filter((item) => retained.has(item.attachment));
        });
      }
      if (nextImageAttachments.length > 0) {
        setImageAttachments((current) => [...current, ...nextImageAttachments]);
      }
    } catch (error) {
      onErrorMessage(error instanceof Error ? error.message : "Could not add files");
    }
  }, [model.isCloudNewThreadTarget, onErrorMessage, setFileAttachments, setImageAttachments]);

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
        const actionState = resolveStageThreadsComposerActionState({
          canSendPrompt: model.conversation !== null || canStartNewThread,
          isThreadRunning: model.isThreadRunning,
          busyAction,
          hasDraftContent: nextPrompt.trim().length > 0 || hasAttachments || goalModeActive,
          isQueueingEnabled: model.isQueueingEnabled,
        });
        void submitPrompt({
          prompt: nextPrompt,
          submitAction: actionState.primarySubmitAction,
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
    setFileAttachments((current) => current.filter((attachment) =>
      attachment.uiId !== attachmentId
    ));
  }, [incrementAttachmentGeneration, setFileAttachments]);

  const handleRemoveAddedFile = useCallback((attachmentId: string) => {
    incrementAttachmentGeneration();
    setAddedFiles((current) => current.filter((attachment) =>
      attachment.uiId !== attachmentId
    ));
  }, [incrementAttachmentGeneration, setAddedFiles]);

  const handleRemoveImageAttachment = useCallback((attachmentId: string) => {
    incrementAttachmentGeneration();
    setImageAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
  }, [incrementAttachmentGeneration, setImageAttachments]);

  const handleRemovePastedTextAttachment = useCallback((attachmentId: string) => {
    incrementAttachmentGeneration();
    setPastedTextAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
  }, [incrementAttachmentGeneration, setPastedTextAttachments]);

  const handleRemoveSkillMention = useCallback((attachmentId: string) => {
    incrementAttachmentGeneration();
    setSkillMentions((current) => current.filter((attachment) => attachment.id !== attachmentId));
  }, [incrementAttachmentGeneration, setSkillMentions]);

  const handleRemoveCommentAttachment = useCallback((attachmentId: string) => {
    removeReviewDiffCommentAttachment(composerThreadId, attachmentId);
  }, [composerThreadId]);

  const slashCommands = useMemo(() => buildComposerSlashCommands({
    model,
    actions,
    serviceTier: serviceTierSettings.serviceTier,
    setServiceTier,
    insertPluginMention: handleInsertPluginMention,
    openExpandedDialog: () => setSlashDialogOpen(true),
    onPetToggle: handleToggleDesktopPet,
    activateGoalMode,
  }), [
    activateGoalMode,
    actions,
    handleInsertPluginMention,
    handleToggleDesktopPet,
    model,
    serviceTierSettings.serviceTier,
    setServiceTier,
  ]);
  const slashMatches = useMemo(() => filterComposerSlashCommands({
    commands: slashCommands,
    query: slashTrigger.active ? slashTrigger.query : "",
    composerText: prompt,
    trigger: slashTrigger.trigger,
  }), [prompt, slashCommands, slashTrigger.active, slashTrigger.query, slashTrigger.trigger]);
  const slashGroups = useMemo(() => groupComposerSlashCommandMatches(slashMatches), [slashMatches]);
  const slashMenuOpen = slashTrigger.active || nestedSlashCommand !== null;
  const planModeAvailable = hasPlanMode(model.collaborationModes);
  const togglePlanMode = useCallback((): boolean => {
    const nextMode = resolveNextComposerPlanMode({
      currentMode: model.selectedCollaborationMode,
      modes: model.collaborationModes,
    });
    if (!nextMode) return false;
    void actions.onCollaborationModeChange(nextMode);
    if (nextMode === "plan") {
      setGoalModeActive(false);
    }
    setPlanKeywordSuggestionDismissed(false);
    return true;
  }, [actions, model.collaborationModes, model.selectedCollaborationMode, setGoalModeActive]);
  const showPlanKeywordSuggestion = shouldShowComposerPlanKeywordSuggestion({
    prompt,
    currentMode: model.selectedCollaborationMode,
    modes: model.collaborationModes,
    dismissed: planKeywordSuggestionDismissed || goalModeActive,
  });
  const resolvedInlineSlashHighlight = resolveComposerSlashHighlight({
    matches: slashMatches,
    intent: inlineSlashHighlightIntent,
  });
  const highlightedInlineSlashCommandId = slashMenuOpen
    ? resolvedInlineSlashHighlight.commandId
    : null;
  const highlightedInlineSlashCommandSource = slashMenuOpen
    ? resolvedInlineSlashHighlight.source
    : "programmatic";
  const promptHistoryScopeKey = model.conversation?.threadId
    ?? model.threadId
    ?? model.newThreadTarget?.sessionId
    ?? model.projectId
    ?? null;
  const selectLatestQueuedFollowUpForArrowUp = useCallback((): boolean => {
    if (prompt.trim().length !== 0 || hasAttachments || slashMenuOpen || busyAction !== null) {
      return false;
    }

    const threadId = model.conversation?.threadId ?? model.threadId;
    if (!threadId) return false;

    const latestQueuedFollowUp = model.composerShell.queuedFollowUpRows.at(-1);
    if (!latestQueuedFollowUp) return false;

    void actions.onEditQueuedFollowUp({
      threadId,
      followUpId: latestQueuedFollowUp.followUpId,
      prompt: latestQueuedFollowUp.prompt,
      promptInput: latestQueuedFollowUp.promptInput,
    });
    return true;
  }, [
    actions,
    busyAction,
    hasAttachments,
    model.composerShell.queuedFollowUpRows,
    model.conversation?.threadId,
    model.threadId,
    prompt,
    slashMenuOpen,
  ]);
  const {
    appendPromptToHistory,
    handlePromptHistoryKeyDown,
    resetHistorySelection,
  } = useThreadComposerPromptHistoryRecall({
    editorRef: promptEditorRef,
    scopeKey: promptHistoryScopeKey,
    composerText: prompt,
    selectLatestQueuedFollowUp: selectLatestQueuedFollowUpForArrowUp,
  });
  appendPromptToHistoryRef.current = appendPromptToHistory;
  resetPromptHistorySelectionRef.current = resetHistorySelection;

  useEffect(() => {
    if (prompt.trim().length > 0 && model.selectedCollaborationMode !== "plan") {
      return;
    }
    setPlanKeywordSuggestionDismissed(false);
  }, [model.selectedCollaborationMode, prompt]);

  const closeSlashMenu = useCallback(() => {
    setSlashTrigger(inactiveSlashTrigger());
    setNestedSlashCommand(null);
    setInlineSlashHighlightIntent({ commandId: null, source: "programmatic" });
  }, []);

  const handleSlashTriggerChange = useCallback((nextTrigger: ComposerSlashTriggerState) => {
    setSlashTrigger(nextTrigger);
    if (nextTrigger.active) {
      setNestedSlashCommand(null);
      return;
    }
    setInlineSlashHighlightIntent({ commandId: null, source: "programmatic" });
  }, []);

  const clearInlineSlashTrigger = useCallback((trigger: ComposerSlashTriggerState) => {
    promptEditorRef.current?.clearRange({ from: trigger.from, to: trigger.to });
    setSlashTrigger(inactiveSlashTrigger());
  }, []);

  const selectSlashCommand = useCallback((command: ComposerSlashCommand, source: "inline" | "dialog") => {
    if (command.isEnabled === false) return;

    if (source === "inline") {
      const trigger = slashTrigger;
      if (command.onSelectFromInlineSlash) {
        void command.onSelectFromInlineSlash({
          source: "inline",
          trigger,
          clearTrigger: () => clearInlineSlashTrigger(trigger),
          replaceTrigger: (text) => {
            promptEditorRef.current?.replaceTextRange({ from: trigger.from, to: trigger.to, text });
            setSlashTrigger(inactiveSlashTrigger());
          },
        });
        closeSlashMenu();
        return;
      }

      if (command.Content) {
        clearInlineSlashTrigger(trigger);
        setNestedSlashCommand(command);
        return;
      }

      clearInlineSlashTrigger(trigger);
      void command.onSelect?.({ source: "inline" });
      closeSlashMenu();
      return;
    }

    if (command.Content) {
      setNestedSlashCommand(command);
      setSlashDialogOpen(false);
      return;
    }
    void command.onSelect?.({ source: "dialog" });
    setSlashDialogOpen(false);
  }, [clearInlineSlashTrigger, closeSlashMenu, slashTrigger]);

  const handleKeyDown = useCallback((event: ComposerPromptEditorKeyboardEvent): boolean => {
    if (slashMenuOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSlashMenu();
        return true;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setInlineSlashHighlightIntent({
          commandId: resolveNextSlashHighlight({
            matches: slashMatches,
            currentCommandId: highlightedInlineSlashCommandId,
            direction: event.key === "ArrowDown" ? "next" : "previous",
          }),
          source: "keyboard",
        });
        return true;
      }

      if (event.key === "Enter" && !nestedSlashCommand) {
        const highlighted = slashMatches.find((match) => match.command.id === highlightedInlineSlashCommandId)?.command
          ?? slashMatches[0]?.command
          ?? null;
        if (highlighted) {
          event.preventDefault();
          selectSlashCommand(highlighted, "inline");
          return true;
        }
      }
    }

    if (
      event.key === "Tab" &&
      event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !slashMenuOpen &&
      planModeAvailable
    ) {
      event.preventDefault();
      event.stopPropagation();
      togglePlanMode();
      return true;
    }

    if (handlePromptHistoryKeyDown(event)) {
      return true;
    }

    const hasMultilinePrompt = prompt.includes("\n");
    const isComposing = "nativeEvent" in event
      ? event.nativeEvent.isComposing
      : event.isComposing;
    const actionState = resolveStageThreadsComposerActionState({
      canSendPrompt: model.conversation !== null || canStartNewThread,
      isThreadRunning: model.isThreadRunning,
      busyAction,
      hasDraftContent: prompt.trim().length > 0 || hasAttachments || goalModeActive,
      isQueueingEnabled: model.isQueueingEnabled,
    });

    const submitIntent = resolveComposerSubmitIntentFromKeyDown({
      enterBehavior: model.composerEnterBehavior,
      hasMultilinePrompt,
      isThreadRunning: model.isThreadRunning,
      primarySubmitAction: actionState.primarySubmitAction,
      alternateSubmitAction: actionState.alternateSubmitAction,
      key: event.key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      isComposing,
    });
    if (!submitIntent) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    void submitPrompt({
      prompt,
      submitAction: submitIntent.submitAction,
    });
    return true;
  }, [
    busyAction,
    canStartNewThread,
    closeSlashMenu,
    goalModeActive,
    hasAttachments,
    highlightedInlineSlashCommandId,
    model.composerEnterBehavior,
    model.conversation,
    model.isQueueingEnabled,
    model.isThreadRunning,
    nestedSlashCommand,
    handlePromptHistoryKeyDown,
    planModeAvailable,
    prompt,
    selectSlashCommand,
    slashMatches,
    slashMenuOpen,
    submitPrompt,
    togglePlanMode,
  ]);

  const hasDraftContent = prompt.trim().length > 0 || hasAttachments || goalModeActive;
  const hasFooterGoalChip = goalModeActive || Boolean(model.conversation?.threadGoal && actions.onClearThreadGoal);
  const hasMultilinePrompt = prompt.includes("\n");
  const isMacPlatform = typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");

  const composerActionState = resolveStageThreadsComposerActionState({
    canSendPrompt: model.conversation !== null || canStartNewThread,
    isThreadRunning: model.isThreadRunning,
    busyAction,
    hasDraftContent,
    isQueueingEnabled: model.isQueueingEnabled,
  });
  const isSendPending = busyAction === "send" && composerActionState.action === "send";
  const canRunPrimaryAction = Boolean(
    hasDraftContent &&
    (model.conversation !== null || canStartNewThread),
  );
  const handleCancelGoalReplacement = useCallback(() => {
    if (busyAction !== null) return;
    setGoalReplacementConfirmation(null);
  }, [busyAction]);
  const handleConfirmGoalReplacement = useCallback(() => {
    const confirmation = goalReplacementConfirmation;
    if (!confirmation || busyAction !== null) return;

    void (async () => {
      const succeeded = await submitThreadGoalDraft(confirmation.draft);
      if (succeeded) {
        setGoalReplacementConfirmation(null);
      }
    })();
  }, [busyAction, goalReplacementConfirmation, submitThreadGoalDraft]);
  const promptPlaceholder = goalModeActive
    ? getThreadGoalMessage("composer.placeholder.goal")
    : model.selectedCollaborationMode === "plan"
    ? "Describe your task to generate a plan..."
    : model.conversation
    ? "Ask for follow-up changes"
    : model.isNewThreadTab
      ? model.newThreadTarget
        ? model.isCloudNewThreadTarget
          ? "Cloud run target is currently mock-only"
          : "Do anything"
        : "Select a card or session before starting a new thread"
      : "Select a thread";
  const isPromptEditorDisabled = (model.conversation === null && !canStartNewThread) || busyAction !== null;
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
  const showExternalFooter = shouldShowThreadComposerStatusStrip(model);
  const composerActionTooltip = renderComposerActionTooltipContent({
    action: composerActionState.action,
    primarySubmitAction: composerActionState.primarySubmitAction,
    alternateSubmitAction: composerActionState.alternateSubmitAction,
    isThreadRunning: model.isThreadRunning,
    primaryShortcutKeys,
    alternateShortcutKeys,
  });
  return (
    <>
      <ThreadComposerExternalFooterSlot visible={showExternalFooter}>
        <ThreadComposerStatusStrip
          model={model}
          actions={actions}
          onErrorMessage={onErrorMessage}
          projectSelectorDisabled={busyAction !== null}
        />
      </ThreadComposerExternalFooterSlot>
      <div className="relative">
        <InlineSlashCommandMenu
          open={slashMenuOpen}
          groups={slashGroups}
          matches={slashMatches}
          highlightedCommandId={highlightedInlineSlashCommandId}
          highlightedSource={highlightedInlineSlashCommandSource}
          nestedCommand={nestedSlashCommand}
          onHighlight={(commandId, source) => setInlineSlashHighlightIntent({ commandId, source })}
          onSelect={(command) => selectSlashCommand(command, "inline")}
          onClose={closeSlashMenu}
          onBack={closeSlashMenu}
        />
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
        {showPlanKeywordSuggestion ? (
          <PlanKeywordSuggestion
            onUsePlanMode={() => {
              togglePlanMode();
            }}
            onDismiss={() => {
              setPlanKeywordSuggestionDismissed(true);
            }}
          />
        ) : null}
        <div
          className={cn(
            "composer-surface-chrome relative flex flex-col bg-token-input-background/90 backdrop-blur-lg electron:dark:bg-token-dropdown-background _multilineSurface_1u8sk_2",
            showExternalFooter && "z-10",
          )}
        >
          <div className="relative z-10 flex min-h-0 flex-1 flex-col">
            <div className="_attachmentsDefault_1u8sk_2" data-composer-attachments="true">
              {hasAttachments ? (
                <div className="composer-attachment-surface flex flex-wrap items-center gap-1">
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
                  {pastedTextAttachments.map((attachment, index) => (
                    <button
                      key={attachment.id}
                      type="button"
                      className="inline-flex max-w-48 items-center gap-1 rounded-full bg-token-foreground/5 px-2 py-1 text-xs text-token-foreground hover:bg-token-foreground/10"
                      onClick={() => handleRemovePastedTextAttachment(attachment.id)}
                      title={`Remove pasted text ${index + 1}`}
                    >
                      <ComposerAddFilesIcon className="size-3 text-token-description-foreground" />
                      <span className="min-w-0 truncate">Pasted text {index + 1}</span>
                      <span className="text-token-description-foreground">x</span>
                    </button>
                  ))}
                  {fileAttachments.map((attachment) => (
                    <button
                      key={attachment.uiId}
                      type="button"
                      className="inline-flex max-w-48 items-center gap-1 rounded-full bg-token-foreground/5 px-2 py-1 text-xs text-token-foreground hover:bg-token-foreground/10"
                      onClick={() => handleRemoveFileAttachment(attachment.uiId)}
                      title={`Remove ${attachment.attachment.label}`}
                    >
                      <ComposerAddFilesIcon className="size-3 text-token-description-foreground" />
                      <span className="min-w-0 truncate">{attachment.attachment.label}</span>
                      <span className="text-token-description-foreground">x</span>
                    </button>
                  ))}
                  {addedFiles.map((attachment) => (
                    <button
                      key={attachment.uiId}
                      type="button"
                      className="inline-flex max-w-48 items-center gap-1 rounded-full bg-token-foreground/5 px-2 py-1 text-xs text-token-foreground hover:bg-token-foreground/10"
                      onClick={() => handleRemoveAddedFile(attachment.uiId)}
                      title={`Remove ${attachment.attachment.label}`}
                    >
                      <ComposerAddFilesIcon className="size-3 text-token-description-foreground" />
                      <span className="min-w-0 truncate">{attachment.attachment.label}</span>
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
                  {commentAttachments.map((attachment) => {
                    const lineLabel = formatReviewDiffCommentLineLabel({
                      side: attachment.position.side,
                      line: attachment.position.line,
                      ...(attachment.position.start_line ? { startLine: attachment.position.start_line } : {}),
                      ...(attachment.position.start_side ? { startSide: attachment.position.start_side } : {}),
                    });
                    const fileLabel = getComposerAttachmentNameFromPath(attachment.position.path, attachment.position.path);
                    const commentText = getReviewDiffCommentText(attachment);
                    return (
                      <button
                        key={attachment.id}
                        type="button"
                        className="inline-flex max-w-64 items-center gap-1 rounded-full bg-token-foreground/5 px-2 py-1 text-xs text-token-foreground hover:bg-token-foreground/10"
                        onClick={() => handleRemoveCommentAttachment(attachment.id)}
                        title={`Remove ${lineLabel}: ${commentText}`}
                      >
                        <ReviewFileDocumentIcon className="size-3 text-token-description-foreground" />
                        <span className="min-w-0 truncate">{fileLabel}</span>
                        <span className="shrink-0 text-token-description-foreground">{lineLabel.replace("Comment on ", "")}</span>
                        <span className="text-token-description-foreground">x</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <div className="contents">
              <div className="mb-1 flex-grow overflow-y-auto px-3">
                <ComposerPromptEditor
                  ref={promptEditorRef}
                  data-composer-prompt-frame="true"
                  value={prompt}
                  placeholder={promptPlaceholder}
                  disabled={isPromptEditorDisabled}
                  onChange={setPrompt}
                  onKeyDown={handleKeyDown}
                  onSlashTriggerChange={handleSlashTriggerChange}
                />
              </div>
            </div>

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
                className="_footer_1u8sk_2 grid grid-cols-[minmax(0,auto)_auto_minmax(0,1fr)] items-center gap-[5px] select-none mb-2 px-2"
              >
                <div className="flex min-w-0 items-center gap-[5px]">
                  <ComposerAddContextDropdown
                    model={model}
                    actions={actions}
                    onPickFiles={handlePickComposerFiles}
                    onInsertPlugin={handleInsertPluginMention}
                  />

                  <PermissionModeDropdown
                    selectedMode={model.permissionMode}
                    availableModes={permissionState?.availableModes}
                    autoReviewAvailable={permissionState?.autoReviewAvailable ?? false}
                    customDescription={permissionState?.customDescription ?? null}
                    onSelect={actions.onPermissionModeChange}
                  />

                  {model.selectedCollaborationMode === "plan" || goalModeActive ? (
                    <ComposerFooterAccessoryDivider />
                  ) : null}

                  <ActiveComposerModeChip
                    model={model}
                    onToggle={togglePlanMode}
                  />
                  <ActiveGoalModeChip
                    active={hasFooterGoalChip}
                    onClear={clearFooterGoal}
                  />
                </div>

                <div className="flex items-center" />

                <div className="flex min-w-0 items-center justify-end w-full">
                  <div className="flex min-w-0 flex-1 justify-end">
                    <div className="flex min-w-0 items-center gap-1">
                      <ContextWindowIndicator
                        state={contextWindowIndicatorState}
                        account={model.account}
                        showFallbackLabel={false}
                      />
                      <IntelligenceSelectorDropdown
                        model={model}
                        serviceTier={serviceTierSettings.serviceTier}
                        onServiceTierChange={(nextTier) => setServiceTier(nextTier, "composer_menu")}
                        actions={actions}
                      />
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {isDictationSupported ? (
                      <NodexTooltip
                        tooltipContent={<span className="text-token-foreground">Click to dictate or hold</span>}
                        shortcut={model.dictation.shortcutLabel}
                        side="top"
                        sideOffset={4}
                      >
                        <button
                          type="button"
                          className="border-token-border no-drag cursor-interaction flex h-token-button-composer aspect-square items-center justify-center gap-1 rounded-full border border-transparent px-0 py-0 text-sm leading-[18px] whitespace-nowrap text-token-text-tertiary select-none transition-colors duration-100 focus:outline-none enabled:hover:bg-token-list-hover-background enabled:hover:text-token-foreground disabled:cursor-not-allowed disabled:opacity-40 data-[state=open]:bg-token-list-hover-background"
                          aria-label="Dictate"
                          onClick={() => {
                            void startDictation();
                          }}
                          disabled={model.dictation.isRealtimeVoiceActive}
                        >
                          {isTranscribing ? (
                            <SpinnerIcon className="icon-xs" />
                          ) : (
                            <MicIcon className="icon-xs" />
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
                          type="button"
                          className={cn(
                            "focus-visible:outline-token-button-background cursor-interaction flex h-token-button-composer aspect-square items-center justify-center rounded-full bg-token-foreground p-0.5 text-token-dropdown-background transition-opacity focus-visible:outline-2",
                            (composerActionState.disabled || (composerActionState.action !== "stop" && !canRunPrimaryAction)) && !isSendPending && "opacity-50",
                            isSendPending && "cursor-wait",
                          )}
                          onClick={composerActionState.action === "stop"
                            ? () => void handleInterrupt()
                            : () => void submitPrompt({
                                prompt,
                                submitAction: composerActionState.primarySubmitAction,
                              })}
                          disabled={composerActionState.action === "stop"
                            ? composerActionState.disabled
                            : composerActionState.disabled || !canRunPrimaryAction}
                          aria-label={composerActionState.label}
                        >
                          {isSendPending ? (
                            <SpinnerIcon className="icon-sm" />
                          ) : composerActionState.action === "stop" ? (
                            <StopIcon className="icon-xs" />
                          ) : (
                            <UpArrowIcon className="icon-sm" />
                          )}
                        </button>
                      </span>
                    </NodexTooltip>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {slashDialogOpen ? (
        <ExpandedSlashCommandDialog
          commands={slashCommands}
          composerText={prompt}
          onSelect={(command) => selectSlashCommand(command, "dialog")}
          onClose={() => setSlashDialogOpen(false)}
        />
      ) : null}
      <ThreadGoalReplacementConfirmationDialog
        confirmation={goalReplacementConfirmation}
        pending={busyAction !== null}
        onCancel={handleCancelGoalReplacement}
        onConfirm={handleConfirmGoalReplacement}
      />
      {desktopPetVisible ? (
        <button
          type="button"
          className="fixed right-5 bottom-5 z-50 flex size-14 items-center justify-center rounded-full bg-token-dropdown-background/95 text-token-foreground shadow-xl-spread ring-[0.5px] ring-token-border/50 backdrop-blur-sm hover:bg-token-list-hover-background"
          aria-label="Hide desktop pet"
          title="Hide desktop pet"
          onClick={() => setDesktopPetVisible(false)}
        >
          <span className="text-lg" aria-hidden="true">Codex</span>
        </button>
      ) : null}
    </>
  );
}

function renderComposerActionTooltipContent(input: {
  action: "send" | "stop";
  primarySubmitAction: StageThreadsComposerSubmitAction | null;
  alternateSubmitAction: StageThreadsComposerFollowUpAction | null;
  isThreadRunning: boolean;
  primaryShortcutKeys: readonly string[];
  alternateShortcutKeys: readonly string[];
}) {
  return (
    <ComposerActionTooltipContent
      action={input.action}
      primarySubmitAction={input.primarySubmitAction}
      alternateSubmitAction={input.alternateSubmitAction}
      isThreadRunning={input.isThreadRunning}
      primaryShortcutKeys={input.primaryShortcutKeys}
      alternateShortcutKeys={input.alternateShortcutKeys}
    />
  );
}
