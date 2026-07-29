import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
} from "react";
import {
  formatCodexModelLabel,
  formatCodexReasoningEffortLabel,
  resolveCodexReasoningEffortOptions,
} from "@/lib/codex-thread-settings";
import { resolveContextWindowIndicatorState } from "@/lib/codex-context-window";
import type {
  CodexComposerAppshotContext,
  CodexComposerAppshotTarget,
  CodexPermissionState,
  CodexPromptDocumentInput,
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
  createPastedTextAttachment,
  readPastedTextAttachment,
  removePastedTextAttachment,
} from "@/lib/api";
import {
  findAgentModel,
  findAgentProvider,
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
  ComposerAddFilesIcon,
  ComposerPlanModeCloseIcon,
  ComposerPlanModeIcon,
  MicIcon,
  PlusIcon,
  ReviewFileDocumentIcon,
  SpinnerIcon,
  StopIcon,
  UpArrowIcon,
} from "@/components/shared/icons";
import { ShortcutKeycaps } from "@/components/ui/shortcut-keycaps";
import { toast } from "@/components/ui/toast";
import {
  NodexDialog,
  NodexDialogAction,
  NodexDialogBody,
  NodexDialogContent,
  NodexDialogDescription,
  NodexDialogFooter,
  NodexDialogForm,
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
  NodexDropdownItem,
  NodexDropdownMenu,
  NodexDropdownMessage,
  NodexDropdownSearchInput,
  NodexDropdownSection,
  NodexDropdownSelectedIcon,
  NodexDropdownSeparator,
  NodexDropdownSummarySubmenuItem,
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
  COMPOSER_LARGE_PASTE_CHAR_THRESHOLD,
  ComposerPromptEditor,
  parseComposerPromptMentionLink,
  serializeComposerPromptMentionLink,
  type ComposerPromptMentionInput,
  type ComposerPromptEditorHandle,
  type ComposerPromptEditorKeyboardEvent,
  type ComposerSuggestionAction,
} from "./composer-prompt-editor";
import {
  inactiveComposerSuggestionState,
  type ComposerSuggestionState,
} from "./composer-suggestion-state";
import {
  ComposerAdaptiveFooter,
  ComposerInput,
  type ComposerAdaptiveLayout,
} from "./composer-adaptive-footer";
import { useThreadComposerPromptHistoryRecall } from "./thread-composer-prompt-history";
import { InlineSlashCommandMenu } from "./slash-command-menu/inline-slash-command-menu";
import { ExpandedSlashCommandDialog } from "./slash-command-menu/expanded-slash-command-dialog";
import {
  buildComposerSlashCommands,
  canUseComposerGoal,
} from "./slash-command-menu/slash-command-registry";
import {
  filterComposerSlashCommands,
  groupComposerSlashCommandMatches,
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
  COMPOSER_FOOTER_LABEL_NARROW_CLASS_NAME,
  COMPOSER_FOOTER_LABEL_WIDE_CLASS_NAME,
  COMPOSER_FOOTER_PLAN_ACCESSORY_BUTTON_CLASS_NAME,
  ComposerFooterAccessoryDivider,
} from "../shared/composer-footer-controls";
import {
  IntelligenceSelectorTrigger,
  INTELLIGENCE_SELECTOR_SIDE_OFFSET_PX,
  type IntelligenceSelectorLabelCandidate,
  useIntelligenceSelectorTriggerGeometry,
} from "./intelligence-selector-trigger";
import {
  clearComposerCompletedDraftAtom,
  composerAddedFilesAtom,
  composerAppshotContextsAtom,
  composerConsumedIntentNonceAtom,
  composerDraftInitializedAtom,
  composerDraftTransferFamily,
  composerFileAttachmentsAtom,
  composerGoalModeActiveAtom,
  composerImageAttachmentsAtom,
  composerPastedTextAttachmentsAtom,
  composerResetGenerationAtom,
  composerReviewCommentAttachmentsFamily,
  useComposerPromptDraft,
  type ComposerCompletedDraftSnapshot,
  type ComposerFileAttachment,
  type ComposerImageAttachment,
  type ComposerPastedTextAttachment,
} from "./composer-draft-state";
import {
  useScopedAtom,
  useScopedAtomValue,
  useScopeHandle,
  useSetScopedAtom,
  appScope,
} from "@/lib/maitai";
import { openModal } from "@/lib/modal-registry";
import { ComposerScope } from "@/lib/workbench-ui-scopes";
import { ProviderCredentialDialog } from "./provider-credential-dialog";
import {
  ComposerAddContextMenu,
  type ComposerAddContextMenuHandle,
  ComposerAddContextTrigger,
} from "./composer-add-context-menu";
import { useRightPanelComposerPresentation } from "../right-panel-composer-presentation";
import {
  clearBrowserAnnotationAttachments,
  getBrowserAnnotationAttachmentsSnapshot,
  removeBrowserAnnotationAttachment,
  replaceBrowserAnnotationAttachments,
  subscribeBrowserAnnotationAttachments,
  type BrowserAnnotationAttachment,
} from "../../../browser-sidebar/browser-annotation-attachments";
import {
  consumeBrowserImageAttachments,
  getBrowserImageAttachmentsSnapshot,
  subscribeBrowserImageAttachments,
} from "../../../browser-sidebar/browser-image-attachments";
import {
  clearBrowserImageDragState,
  getBrowserImageDragSnapshot,
  subscribeBrowserImageDragState,
} from "../../../browser-sidebar/browser-image-drag-state";

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
  appshotContexts: readonly CodexComposerAppshotContext[];
  pastedTextAttachments: readonly ComposerPastedTextAttachment[];
  commentAttachments: readonly CodexReviewDiffCommentAttachment[];
  browserAnnotationAttachments: readonly BrowserAnnotationAttachment[];
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

function extractComposerPromptMentions(prompt: string): {
  readonly text: string;
  readonly documentItems: readonly CodexPromptDocumentInput[];
  readonly mentions: NonNullable<CodexPromptInput["mentions"]>;
  readonly skills: NonNullable<CodexPromptInput["skills"]>;
} {
  const documentItems: CodexPromptDocumentInput[] = [];
  const mentions: NonNullable<CodexPromptInput["mentions"]> = [];
  const skills: NonNullable<CodexPromptInput["skills"]> = [];
  const textParts: string[] = [];
  const mentionPattern = /\[([^\]\n]+)\]\(([^)\n]+)\)/gu;
  let cursor = 0;

  for (const match of prompt.matchAll(mentionPattern)) {
    const rawLabel = match[1] ?? "";
    const rawPath = match[2] ?? "";
    const mention = parseComposerPromptMentionLink(rawLabel, rawPath);
    if (!mention) continue;

    const precedingText = prompt.slice(cursor, match.index);
    if (precedingText) {
      textParts.push(precedingText);
      documentItems.push({ type: "text", text: precedingText });
    }
    if (mention.kind === "skill") {
      const skill = { name: mention.name, path: mention.path };
      skills.push(skill);
      documentItems.push({ type: "skill", ...skill });
    } else {
      const promptMention = { name: mention.name, path: mention.path };
      mentions.push(promptMention);
      documentItems.push({ type: "mention", ...promptMention });
    }
    cursor = match.index + match[0].length;
  }

  const trailingText = prompt.slice(cursor);
  if (trailingText) {
    textParts.push(trailingText);
    documentItems.push({ type: "text", text: trailingText });
  }

  return {
    text: textParts.join(""),
    documentItems,
    mentions,
    skills,
  };
}

function buildComposerPromptInput(input: {
  prompt: string;
  attachments: ComposerAttachmentState;
}): CodexPromptInput | undefined {
  const parsedPrompt = extractComposerPromptMentions(input.prompt);
  const text = parsedPrompt.text;
  const images = input.attachments.imageAttachments.map((attachment) => ({
    source: attachment.dataUrl,
    caption: attachment.filename,
  }));
  const appshots = input.attachments.appshotContexts.map((context) => ({
    ...context,
  }));
  const textAttachments = input.attachments.pastedTextAttachments.flatMap((attachment) => (
    attachment.status === "ready"
      ? [{ ...attachment.attachment, file: { ...attachment.attachment.file } }]
      : []
  ));
  const fileAttachments = dedupeCodexLiveFileAttachments(
    input.attachments.fileAttachments.map((item) => item.attachment),
  ).map((attachment) => ({ ...attachment }));
  const addedFiles = dedupeCodexLiveFileAttachments(
    input.attachments.addedFiles.map((item) => item.attachment),
  ).map((attachment) => ({ ...attachment }));
  const mentions = parsedPrompt.mentions;
  const skills = parsedPrompt.skills;
  const commentAttachments = [...input.attachments.commentAttachments];
  const browserAnnotationAttachments = [
    ...input.attachments.browserAnnotationAttachments,
  ];

  if (
    images.length === 0
    && appshots.length === 0
    && textAttachments.length === 0
    && fileAttachments.length === 0
    && addedFiles.length === 0
    && mentions.length === 0
    && skills.length === 0
    && commentAttachments.length === 0
    && browserAnnotationAttachments.length === 0
  ) {
    return undefined;
  }

  return {
    text,
    ...(parsedPrompt.documentItems.length > 0
      ? { documentItems: [...parsedPrompt.documentItems] }
      : {}),
    ...(images.length > 0 ? { images } : {}),
    ...(appshots.length > 0 ? { appshots } : {}),
    ...(textAttachments.length > 0 ? { textAttachments } : {}),
    ...(fileAttachments.length > 0 ? { fileAttachments } : {}),
    ...(addedFiles.length > 0 ? { addedFiles } : {}),
    ...(mentions.length > 0 ? { mentions } : {}),
    ...(skills.length > 0 ? { skills } : {}),
    ...(commentAttachments.length > 0 ? { commentAttachments } : {}),
    ...(browserAnnotationAttachments.length > 0
      ? { browserAnnotationAttachments }
      : {}),
  };
}

function getComposerAttachmentNameFromPath(path: string, fallback: string): string {
  return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? fallback;
}

function serializePersistedPromptMention(
  mention: { readonly name: string; readonly path: string },
): string {
  const parsed = parseComposerPromptMentionLink(
    `@${mention.name}`,
    mention.path,
  );
  return serializeComposerPromptMentionLink(parsed ?? {
    kind: "file",
    name: mention.name,
    displayName: mention.name,
    path: mention.path,
  });
}

function buildPersistedMentionPrompt(promptInput?: CodexPromptInput): string {
  return [
    ...(promptInput?.mentions ?? [])
      .map(serializePersistedPromptMention),
    ...(promptInput?.skills ?? [])
      .map((skill) => serializeComposerPromptMentionLink({
        kind: "skill",
        name: skill.name,
        displayName: skill.name,
        path: skill.path,
      })),
  ].join(" ");
}

function buildPersistedPromptDocument(
  promptInput?: CodexPromptInput,
): string | null {
  if (!promptInput?.documentItems) return null;
  return promptInput.documentItems.map((item) => {
    switch (item.type) {
      case "text":
        return item.text;
      case "mention":
        return serializePersistedPromptMention(item);
      case "skill":
        return serializeComposerPromptMentionLink({
          kind: "skill",
          name: item.name,
          displayName: item.name,
          path: item.path,
        });
    }
  }).join("");
}

function mergePersistedMentionPrompt(
  prompt: string,
  mentionPrompt: string,
): string {
  if (!mentionPrompt) return prompt;
  if (!prompt) return `${mentionPrompt} `;
  const separator = /\s$/u.test(prompt) ? "" : " ";
  return `${prompt}${separator}${mentionPrompt} `;
}

function appendPersistedPromptDocument(
  prompt: string,
  documentPrompt: string,
): string {
  if (!documentPrompt) return prompt;
  if (!prompt) return documentPrompt;
  const separator = /\s$/u.test(prompt) || /^\s/u.test(documentPrompt)
    ? ""
    : " ";
  return `${prompt}${separator}${documentPrompt}`;
}

function removePersistedMentionPrompt(prompt: string): string {
  return prompt
    .replace(
      /\[([^\]\n]+)\]\(([^)\n]+)\)/gu,
      (serialized, rawLabel: string, rawPath: string) => {
        const mention = parseComposerPromptMentionLink(rawLabel, rawPath);
        return mention ? "" : serialized;
      },
    )
    .trimEnd();
}

function buildComposerAttachmentStateFromPromptInput(promptInput?: CodexPromptInput): ComposerAttachmentState {
  const fileAttachments = dedupeCodexLiveFileAttachments(
    promptInput?.fileAttachments ?? [],
  ).map((attachment) => ({
    uiId: createComposerAttachmentId("file"),
    attachment: { ...attachment },
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
    appshotContexts: (promptInput?.appshots ?? []).map((context) => ({
      ...context,
    })),
    pastedTextAttachments: (promptInput?.textAttachments ?? []).map((attachment) => {
      const id = createComposerAttachmentId("pasted_text");
      if (!("text" in attachment)) {
        const fileBacked = { ...attachment, file: { ...attachment.file } };
        return {
          id,
          status: "ready" as const,
          preview: fileBacked.preview,
          characterCount: fileBacked.characterCount ?? 0,
          attachment: fileBacked,
        };
      }

      if (attachment.file) {
        const fileBacked = {
          file: { ...attachment.file },
          preview: attachment.preview ?? summarizeComposerPastedText(attachment.text),
          ...(attachment.hostId === undefined ? {} : { hostId: attachment.hostId }),
          characterCount: attachment.characterCount ?? attachment.text.length,
        };
        return {
          id,
          status: "ready" as const,
          preview: fileBacked.preview,
          characterCount: fileBacked.characterCount,
          attachment: fileBacked,
        };
      }

      return {
        id,
        status: "failed" as const,
        generation: 0,
        preview: attachment.preview ?? summarizeComposerPastedText(attachment.text),
        characterCount: attachment.characterCount ?? attachment.text.length,
        error: "Paste this text again to attach it.",
      };
    }),
    fileAttachments,
    addedFiles,
    commentAttachments: promptInput?.commentAttachments ?? [],
    browserAnnotationAttachments: promptInput?.browserAnnotationAttachments ?? [],
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
    || attachments.appshotContexts.length > 0
    || attachments.pastedTextAttachments.length > 0
    || attachments.commentAttachments.length > 0
    || attachments.browserAnnotationAttachments.length > 0;
}

function hasSubmittableComposerAttachmentState(attachments: ComposerAttachmentState): boolean {
  return attachments.fileAttachments.length > 0
    || attachments.addedFiles.length > 0
    || attachments.imageAttachments.length > 0
    || attachments.appshotContexts.length > 0
    || attachments.pastedTextAttachments.some((attachment) => attachment.status === "ready")
    || attachments.commentAttachments.length > 0
    || attachments.browserAnnotationAttachments.length > 0;
}

function summarizeComposerPastedText(text: string): string {
  const normalized = text.trim().replace(/\s+/gu, " ");
  if (normalized.length === 0) return "Pasted text";
  if (normalized.length <= 80) return normalized;
  return `${normalized.slice(0, 79)}…`;
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
    pastedTextAttachments: attachments.pastedTextAttachments.flatMap((attachment) => (
      attachment.status === "ready"
        ? [{ ...attachment.attachment, file: { ...attachment.attachment.file } }]
        : []
    )),
    hasUnsupportedAttachments: attachments.fileAttachments.length > 0
      || attachments.addedFiles.length > 0
      || attachments.appshotContexts.length > 0
      || attachments.commentAttachments.length > 0
      || attachments.browserAnnotationAttachments.length > 0,
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
  buildPersistedMentionPrompt,
  buildPersistedPromptDocument,
  isComposerImageFile,
  removePersistedMentionPrompt,
};

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
        size="compact"
        showCloseButton={false}
      >
        <NodexDialogForm
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm();
          }}
        >
          <NodexDialogHeader>
            <NodexDialogTitle>
              {getThreadGoalMessage("composer.threadGoal.replaceConfirmation.title")}
            </NodexDialogTitle>
            <NodexDialogDescription>
              {getThreadGoalMessage("composer.threadGoal.replaceConfirmation.subtitle")}
            </NodexDialogDescription>
          </NodexDialogHeader>
          <NodexDialogBody>
            <div className="line-clamp-4 rounded-lg bg-token-bg-secondary px-3 py-2 text-sm text-token-foreground">
              {confirmation.draft.objective}
            </div>
          </NodexDialogBody>
          <NodexDialogFooter>
            <NodexDialogAction
              disabled={pending}
              onClick={onCancel}
            >
              {getThreadGoalMessage("composer.threadGoal.replaceConfirmation.cancel")}
            </NodexDialogAction>
            <NodexDialogAction tone="primary" type="submit" disabled={pending}>
              {getThreadGoalMessage("composer.threadGoal.replaceConfirmation.confirm")}
            </NodexDialogAction>
          </NodexDialogFooter>
        </NodexDialogForm>
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
      onSelect={(event) => {
        event.preventDefault();
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

function LegacyModelSelectorDropdown({
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim().toLocaleLowerCase();
  const matchingModels = model.availableModels.filter((candidate) => (
    !candidate.hidden
    && (!normalizedQuery || `${candidate.displayName} ${candidate.id}`.toLocaleLowerCase().includes(normalizedQuery))
  ));
  const visibleModels = matchingModels.slice(0, 50);
  const hiddenMatchCount = matchingModels.length - visibleModels.length;
  const modelLabel = formatCompactCodexModelLabel(
    model.selectedModel,
    model.availableModels,
  );
  const reasoningLabel = formatCodexReasoningEffortLabel(model.selectedReasoningEffort);
  const labelCandidates = useMemo<readonly IntelligenceSelectorLabelCandidate[]>(() => {
    const candidates = model.availableModels
      .filter((candidate) => !candidate.hidden)
      .flatMap((candidate) => {
        const modelCandidateLabel = formatCompactCodexModelLabel(
          candidate.id,
          model.availableModels,
        );
        const efforts = candidate.supportedReasoningEfforts.length > 0
          ? candidate.supportedReasoningEfforts.map((option) => option.reasoningEffort)
          : [candidate.defaultReasoningEffort ?? model.selectedReasoningEffort];
        return efforts.map((effort) => ({
          id: `${candidate.id}:${effort}`,
          modelLabel: modelCandidateLabel,
          reasoningLabel: formatCodexReasoningEffortLabel(effort),
        }));
      });

    return [
      ...candidates,
      {
        id: `selected:${model.selectedModel}:${model.selectedReasoningEffort}`,
        modelLabel,
        reasoningLabel,
      },
    ];
  }, [
    model.availableModels,
    model.selectedModel,
    model.selectedReasoningEffort,
    modelLabel,
    reasoningLabel,
  ]);
  const triggerGeometry = useIntelligenceSelectorTriggerGeometry(labelCandidates);

  return (
    <NodexDropdownMenu
      open={menuOpen}
      onOpenChange={setMenuOpen}
      triggerButton={(
        <IntelligenceSelectorTrigger
          geometry={triggerGeometry}
          isOpen={menuOpen}
          labelCandidates={labelCandidates}
          modelLabel={modelLabel}
          reasoningLabel={reasoningLabel}
          showFastIndicator={serviceTier === "fast"}
          title={`OpenAI · ${formatCodexModelLabel(model.selectedModel, model.availableModels)} · ${reasoningLabel}`}
        />
      )}
      side="top"
      align="end"
      alignOffset={triggerGeometry.alignOffset}
      sideOffset={INTELLIGENCE_SELECTOR_SIDE_OFFSET_PX}
      contentClassName="w-56"
    >
      <NodexDropdownSummarySubmenuItem
        ariaLabel={`Model ${formatCodexModelLabel(model.selectedModel, model.availableModels)}`}
        label="Model"
        value={formatCodexModelLabel(model.selectedModel, model.availableModels)}
        contentClassName="w-[280px]"
      >
        <NodexDropdownSection className="flex w-full min-w-0 flex-col overflow-hidden">
          <NodexDropdownTitle>Model</NodexDropdownTitle>
          {model.availableModels.filter((candidate) => !candidate.hidden).length > 8 ? (
            <NodexDropdownSearchInput
              value={query}
              placeholder="Filter models…"
              onChange={(event) => setQuery(event.target.value)}
            />
          ) : null}
          <div className="vertical-scroll-fade-mask flex max-h-[250px] flex-col overflow-y-auto">
            {visibleModels.length === 0 ? (
              <NodexDropdownMessage compact centered>No matching models</NodexDropdownMessage>
            ) : visibleModels.map((candidate) => (
              <ModelSelectorMenuItem
                key={candidate.id}
                candidate={candidate}
                model={model}
                serviceTier={serviceTier}
                showFastIndicator
                actions={actions}
              />
            ))}
            {hiddenMatchCount > 0 ? (
              <NodexDropdownMessage compact centered>
                Refine the search to see {hiddenMatchCount} more models
              </NodexDropdownMessage>
            ) : null}
          </div>
        </NodexDropdownSection>
      </NodexDropdownSummarySubmenuItem>

      <NodexDropdownSummarySubmenuItem
        ariaLabel={`Effort ${reasoningLabel}`}
        label="Effort"
        value={reasoningLabel}
        contentClassName="min-w-[180px]"
      >
        <NodexDropdownSection className="flex min-w-[180px] flex-col overflow-hidden">
          <NodexDropdownTitle>Effort</NodexDropdownTitle>
          {model.reasoningEffortOptions.map((option) => (
            <NodexDropdownItem
              key={option.reasoningEffort}
              onSelect={(event) => {
                event.preventDefault();
                actions.onReasoningEffortChange(option.reasoningEffort);
              }}
              rightSlot={
                option.reasoningEffort === model.selectedReasoningEffort
                  ? <NodexDropdownSelectedIcon />
                  : null
              }
              tooltipText={option.description || undefined}
              data-intelligence-option={option.reasoningEffort}
              data-reasoning-selected={
                option.reasoningEffort === model.selectedReasoningEffort
                  ? "true"
                  : undefined
              }
            >
              {formatCodexReasoningEffortLabel(option.reasoningEffort)}
            </NodexDropdownItem>
          ))}
        </NodexDropdownSection>
      </NodexDropdownSummarySubmenuItem>

      <NodexDropdownSummarySubmenuItem
        ariaLabel={`Speed ${serviceTier === "fast" ? "Fast" : "Standard"}`}
        label="Speed"
        value={serviceTier === "fast" ? "Fast" : "Standard"}
        contentClassName="w-[233px]"
      >
        <NodexDropdownSection className="flex w-full min-w-0 flex-col overflow-hidden">
          <NodexDropdownTitle>Speed</NodexDropdownTitle>
          {SERVICE_TIER_OPTIONS.map((option) => (
            <NodexDropdownItem
              key={option.label}
              onSelect={(event) => {
                event.preventDefault();
                onServiceTierChange(option.value);
              }}
              rightSlot={option.value === serviceTier ? <NodexDropdownSelectedIcon /> : null}
              subText={option.description}
              allowWrap
            >
              {option.label}
            </NodexDropdownItem>
          ))}
        </NodexDropdownSection>
      </NodexDropdownSummarySubmenuItem>
    </NodexDropdownMenu>
  );
}

function formatProviderCredentialIssue(provider: AgentProviderOption): string | null {
  switch (provider.credentialStatus) {
    case "ready":
    case "inherited":
    case "runtimeManaged":
      return null;
    case "missing":
      return "API key required";
    case "unavailable":
      return "Secure storage unavailable";
    case "unsupported":
      return "Credential setup unsupported";
  }
}

function canConfigureProvider(
  provider: AgentProviderOption,
  actions: ThreadStageActions,
): boolean {
  return provider.credentialEnvKey !== null
    && actions.onProviderCredentialSet !== undefined
    && provider.credentialStatus !== "runtimeManaged";
}

function isProviderSelectable(provider: AgentProviderOption): boolean {
  return provider.supportedByNodex
    && provider.models.some((model) => !model.hidden)
    && provider.credentialStatus !== "unavailable"
    && provider.credentialStatus !== "unsupported";
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
  const requiresNewThread = model.executionIdentityLocked === true
    && !selected
    && candidate.switchPolicy === "new-thread";

  return (
    <NodexDropdownItem
      disabled={requiresNewThread}
      onSelect={(event) => {
        event.preventDefault();
        void actions.onExecutionProfileChange?.(
          selectAgentModel(candidate, current ?? null),
          "model",
        );
      }}
      rightSlot={selected ? <NodexDropdownSelectedIcon /> : null}
      tooltipText={
        requiresNewThread
          ? "Start a new task to use this model"
          : candidate.description ?? undefined
      }
      data-agent-model-selected={selected ? "true" : undefined}
    >
      {candidate.displayName}
    </NodexDropdownItem>
  );
}

function AgentModelSelectorDropdown({
  model,
  actions,
}: {
  model: ThreadFooterModel;
  serviceTier: CodexServiceTier;
  onServiceTierChange: (nextTier: CodexServiceTier) => void;
  actions: ThreadStageActions;
}) {
  const appHandle = useScopeHandle(appScope);
  const catalog = model.agentProviderCatalog;
  const profile = model.executionProfile;
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const providerId = profile?.providerId;

  useEffect(() => {
    setQuery("");
  }, [providerId]);

  const labelCandidates = useMemo<readonly IntelligenceSelectorLabelCandidate[]>(() => {
    if (!catalog || !profile) return [];

    const currentModel = findAgentModel(catalog, profile);
    const currentReasoning = currentModel?.supportedReasoningEfforts.find(
      (option) => option.value === profile.reasoningEffort,
    );
    const currentModelLabel = currentModel?.displayName ?? profile.modelId;
    const currentReasoningLabel = currentReasoning?.displayName
      ?? (profile.reasoningEffort
        ? formatCodexReasoningEffortLabel(profile.reasoningEffort)
        : null);
    const reasoningLabels = new Set<string>();
    for (const candidateProvider of catalog.providers) {
      for (const candidateModel of candidateProvider.models) {
        if (candidateModel.hidden) continue;
        for (const effort of candidateModel.supportedReasoningEfforts) {
          reasoningLabels.add(effort.displayName);
        }
      }
    }
    if (currentReasoningLabel) reasoningLabels.add(currentReasoningLabel);
    const candidates: IntelligenceSelectorLabelCandidate[] = [
      {
        id: "maximum-model-label",
        modelLabel: "",
        reasoningLabel: null,
        reserveModelLabelWidth: true,
      },
      ...Array.from(reasoningLabels, (reasoningLabel) => ({
        id: `maximum-model-label:${reasoningLabel}`,
        modelLabel: "",
        reasoningLabel,
        reserveModelLabelWidth: true,
      })),
    ];

    return [
      ...candidates,
      {
        id: `selected:${profile.providerId}:${profile.modelId}:${profile.reasoningEffort ?? "default"}`,
        modelLabel: currentModelLabel,
        reasoningLabel: currentReasoningLabel,
      },
    ];
  }, [catalog, profile]);
  const triggerGeometry = useIntelligenceSelectorTriggerGeometry(labelCandidates);

  if (!catalog || !profile) return null;

  const provider = findAgentProvider(catalog, profile.providerId);
  const selectedModel = findAgentModel(catalog, profile);
  if (!provider) return null;
  const normalizedQuery = deferredQuery.trim().toLocaleLowerCase();
  const matchingModels = provider.models.filter((candidate) => (
    !candidate.hidden
    && (!normalizedQuery || `${candidate.displayName} ${candidate.modelId}`.toLocaleLowerCase().includes(normalizedQuery))
  ));
  const visibleModels = matchingModels.slice(0, 50);
  const hiddenMatchCount = matchingModels.length - visibleModels.length;
  const reasoningOptions = selectedModel?.supportedReasoningEfforts ?? [];
  const selectedReasoning = reasoningOptions.find(
    (option) => option.value === profile.reasoningEffort,
  );
  const speedOptions = selectedModel?.supportedServiceTiers ?? [];
  const selectedSpeed = speedOptions.find((option) => option.value === profile.serviceTier);
  const modelLabel = selectedModel?.displayName ?? profile.modelId;
  const reasoningLabel = selectedReasoning?.displayName
    ?? (profile.reasoningEffort
      ? formatCodexReasoningEffortLabel(profile.reasoningEffort)
      : null);
  const identityLocked = model.executionIdentityLocked === true;
  const showProviderRow = catalog.providers.length > 1
    || canConfigureProvider(provider, actions);
  const manageCurrentProvider = provider.credentialStatus !== "missing"
    && canConfigureProvider(provider, actions);
  const lockedTooltip = identityLocked
    ? "Start a new task to change provider"
    : undefined;

  const selectProvider = (candidate: AgentProviderOption) => {
    const next = selectAgentProvider(catalog, candidate.id, profile);
    if (next) return actions.onExecutionProfileChange?.(next, "provider");
    return undefined;
  };
  const openCredentialDialog = (
    candidate: AgentProviderOption,
    selectAfterConfigure: boolean,
  ) => {
    const onCredentialSet = actions.onProviderCredentialSet;
    if (!onCredentialSet) return;

    setMenuOpen(false);
    queueMicrotask(() => {
      openModal(appHandle, ProviderCredentialDialog, {
        provider: candidate,
        onCredentialSet,
        onCredentialDelete: actions.onProviderCredentialDelete,
        onConfigured: selectAfterConfigure
          ? () => selectProvider(candidate)
          : undefined,
      });
    });
  };

  return (
    <NodexDropdownMenu
      open={menuOpen}
      onOpenChange={setMenuOpen}
      triggerButton={(
        <IntelligenceSelectorTrigger
          geometry={triggerGeometry}
          isOpen={menuOpen}
          labelCandidates={labelCandidates}
          modelLabel={modelLabel}
          reasoningLabel={reasoningLabel}
          showFastIndicator={selectedSpeed?.value === "fast"}
          title={[
            provider.displayName,
            modelLabel,
            reasoningLabel,
          ].filter(Boolean).join(" · ")}
        />
      )}
      side="top"
      align="end"
      alignOffset={triggerGeometry.alignOffset}
      sideOffset={INTELLIGENCE_SELECTOR_SIDE_OFFSET_PX}
      contentClassName="w-56"
    >
      {showProviderRow ? (
        <NodexDropdownSummarySubmenuItem
          ariaLabel={`Provider ${provider.displayName}`}
          label="Provider"
          value={provider.displayName}
          disabled={identityLocked}
          tooltipText={lockedTooltip}
          contentClassName="min-w-60"
        >
          <NodexDropdownSection className="flex min-w-60 flex-col overflow-hidden">
            <NodexDropdownTitle>Provider</NodexDropdownTitle>
            {catalog.providers.map((candidate) => {
              const credentialIssue = formatProviderCredentialIssue(candidate);
              const needsCredential = candidate.credentialStatus === "missing";
              const canConfigure = canConfigureProvider(candidate, actions);
              const disabled = identityLocked
                || !isProviderSelectable(candidate)
                || (needsCredential && !canConfigure);

              return (
                <NodexDropdownItem
                  key={candidate.id}
                  disabled={disabled}
                  onSelect={(event) => {
                    if (needsCredential) {
                      openCredentialDialog(candidate, true);
                      return;
                    }

                    event.preventDefault();
                    void selectProvider(candidate);
                  }}
                  rightSlot={
                    candidate.id === provider.id
                      ? <NodexDropdownSelectedIcon />
                      : null
                  }
                  subText={credentialIssue ?? undefined}
                  tooltipText={disabled ? credentialIssue ?? lockedTooltip : undefined}
                >
                  {candidate.displayName}
                </NodexDropdownItem>
              );
            })}
            {manageCurrentProvider ? (
              <>
                <NodexDropdownSeparator />
                <NodexDropdownItem
                  onSelect={() => openCredentialDialog(provider, false)}
                >
                  Manage {provider.displayName} credential…
                </NodexDropdownItem>
              </>
            ) : null}
          </NodexDropdownSection>
        </NodexDropdownSummarySubmenuItem>
      ) : null}

      <NodexDropdownSummarySubmenuItem
        ariaLabel={`Model ${modelLabel}`}
        label="Model"
        value={modelLabel}
        contentClassName="w-[280px]"
      >
        <NodexDropdownSection className="flex w-full min-w-0 flex-col overflow-hidden">
          <NodexDropdownTitle>{provider.displayName}</NodexDropdownTitle>
          {provider.models.filter((candidate) => !candidate.hidden).length > 8 ? (
            <NodexDropdownSearchInput
              value={query}
              placeholder="Filter models…"
              onChange={(event) => setQuery(event.target.value)}
            />
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
        </NodexDropdownSection>
      </NodexDropdownSummarySubmenuItem>

      {reasoningOptions.length > 0 ? (
        <NodexDropdownSummarySubmenuItem
          ariaLabel={`Effort ${reasoningLabel ?? "Provider default"}`}
          label="Effort"
          value={reasoningLabel ?? "Provider default"}
          contentClassName="min-w-[180px]"
        >
          <NodexDropdownSection className="flex min-w-[180px] flex-col overflow-hidden">
            <NodexDropdownTitle>Effort</NodexDropdownTitle>
            {reasoningOptions.map((option) => (
              <NodexDropdownItem
                key={option.value}
                onSelect={(event) => {
                  event.preventDefault();
                  const next = selectAgentReasoningEffort(catalog, profile, option.value);
                  if (next) {
                    void actions.onExecutionProfileChange?.(
                      next,
                      "reasoningEffort",
                    );
                  }
                }}
                rightSlot={
                  option.value === profile.reasoningEffort
                    ? <NodexDropdownSelectedIcon />
                    : null
                }
                subText={
                  option.value.toLocaleLowerCase() === "ultra"
                    ? option.description ?? undefined
                    : undefined
                }
                tooltipText={
                  option.value.toLocaleLowerCase() === "ultra"
                    ? undefined
                    : option.description ?? undefined
                }
                data-intelligence-option={option.value}
              >
                {option.displayName}
              </NodexDropdownItem>
            ))}
          </NodexDropdownSection>
        </NodexDropdownSummarySubmenuItem>
      ) : null}

      {speedOptions.length > 1 ? (
        <NodexDropdownSummarySubmenuItem
          ariaLabel={`Speed ${selectedSpeed?.displayName ?? "Standard"}`}
          label="Speed"
          value={selectedSpeed?.displayName ?? "Standard"}
          contentClassName="w-[233px]"
        >
          <NodexDropdownSection className="flex w-full min-w-0 flex-col overflow-hidden">
            <NodexDropdownTitle>Speed</NodexDropdownTitle>
            {speedOptions.map((option) => (
              <NodexDropdownItem
                key={option.value ?? "standard"}
                onSelect={(event) => {
                  event.preventDefault();
                  void actions.onExecutionProfileChange?.({
                    ...profile,
                    serviceTier: option.value,
                  }, "serviceTier");
                }}
                rightSlot={
                  option.value === profile.serviceTier
                    ? <NodexDropdownSelectedIcon />
                    : null
                }
                subText={option.description ?? undefined}
                allowWrap
              >
                {option.displayName}
              </NodexDropdownItem>
            ))}
          </NodexDropdownSection>
        </NodexDropdownSummarySubmenuItem>
      ) : null}

      {identityLocked ? (
        <>
          <NodexDropdownSeparator />
          <NodexDropdownMessage compact>
            Start a new task to change provider.
          </NodexDropdownMessage>
        </>
      ) : null}
    </NodexDropdownMenu>
  );
}

function ModelSelectorDropdown(props: {
  model: ThreadFooterModel;
  serviceTier: CodexServiceTier;
  onServiceTierChange: (nextTier: CodexServiceTier) => void;
  actions: ThreadStageActions;
}) {
  if (props.model.agentProviderCatalog && props.model.executionProfile && props.actions.onExecutionProfileChange) {
    return <AgentModelSelectorDropdown {...props} />;
  }
  return <LegacyModelSelectorDropdown {...props} />;
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
  setAppshotContexts: (
    value: readonly CodexComposerAppshotContext[],
  ) => void;
  setPastedTextAttachments: (value: readonly ComposerPastedTextAttachment[]) => void;
  setGoalModeActive: (value: boolean) => void;
  threadId: string | null;
}): void {
  input.setFileAttachments(input.snapshot.fileAttachments);
  input.setAddedFiles(input.snapshot.addedFiles);
  input.setImageAttachments(input.snapshot.imageAttachments);
  input.setAppshotContexts(input.snapshot.appshotContexts);
  input.setPastedTextAttachments(input.snapshot.pastedTextAttachments);
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
  const { floating: isFloatingComposer } =
    useRightPanelComposerPresentation();
  const composerThreadId = model.conversation?.threadId ?? model.threadId;
  const browserAnnotationConversationId = composerThreadId
    ?? model.newThreadTarget?.sessionId
    ?? null;
  const promptDraft = useComposerPromptDraft(composerThreadId);
  const [initialized, setInitialized] = useScopedAtom(composerDraftInitializedAtom);
  const [consumedIntentNonce, setConsumedIntentNonce] = useScopedAtom(
    composerConsumedIntentNonceAtom,
  );
  const [, setFileAttachments] = useScopedAtom(composerFileAttachmentsAtom);
  const [, setAddedFiles] = useScopedAtom(composerAddedFilesAtom);
  const [, setImageAttachments] = useScopedAtom(composerImageAttachmentsAtom);
  const [, setAppshotContexts] = useScopedAtom(composerAppshotContextsAtom);
  const [, setPastedTextAttachments] = useScopedAtom(
    composerPastedTextAttachmentsAtom,
  );
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
        setAppshotContexts,
        setPastedTextAttachments,
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
      const mentionPrompt = buildPersistedMentionPrompt(intent.promptInput);
      const documentPrompt = buildPersistedPromptDocument(intent.promptInput);
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
        setAppshotContexts((current) => appendUniqueBy(
          current,
          restored.appshotContexts,
          (context) => context.id,
        ));
        setPastedTextAttachments((current) => appendUniqueBy(
          current,
          restored.pastedTextAttachments,
          (attachment) => attachment.id,
        ));
        for (const attachment of restored.commentAttachments) {
          addReviewDiffCommentAttachment(composerThreadId, attachment);
        }
        if (browserAnnotationConversationId) {
          replaceBrowserAnnotationAttachments(
            browserAnnotationConversationId,
            appendUniqueBy(
              getBrowserAnnotationAttachmentsSnapshot(
                browserAnnotationConversationId,
              ),
              restored.browserAnnotationAttachments,
              (attachment) => attachment.id,
            ),
          );
        }
      } else {
        setFileAttachments(restored.fileAttachments);
        setAddedFiles(restored.addedFiles);
        setImageAttachments(restored.imageAttachments);
        setAppshotContexts(restored.appshotContexts);
        setPastedTextAttachments(restored.pastedTextAttachments);
        replaceReviewCommentAttachments(composerThreadId, restored.commentAttachments);
        if (browserAnnotationConversationId) {
          replaceBrowserAnnotationAttachments(
            browserAnnotationConversationId,
            restored.browserAnnotationAttachments,
          );
        }
      }

      if (
        intent.prompt.length > 0
        || intent.clearText === true
        || mentionPrompt.length > 0
        || documentPrompt !== null
      ) {
        const nextPrompt = intent.clearText === true
          ? ""
          : documentPrompt !== null
            ? append
              ? appendPersistedPromptDocument(
                  promptDraft.prompt,
                  documentPrompt,
                )
              : documentPrompt
            : mergePersistedMentionPrompt(
                append
                  ? intent.prompt || promptDraft.prompt
                  : removePersistedMentionPrompt(
                      intent.prompt || promptDraft.prompt,
                    ),
                mentionPrompt,
              );
        void promptDraft.setPrompt(nextPrompt)
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
    browserAnnotationConversationId,
    composerThreadId,
    initialized,
    intent,
    model.newThreadTarget?.sessionId,
    onErrorMessage,
    promptDraft,
    setAddedFiles,
    setAppshotContexts,
    setConsumedIntentNonce,
    setFileAttachments,
    setGoalModeActive,
    setImageAttachments,
    setInitialized,
    setPastedTextAttachments,
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
        className={cn(
          "border border-token-border bg-token-main-surface-primary",
          isFloatingComposer
            ? "h-11 rounded-full"
            : "min-h-24 rounded-[20px]",
        )}
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
  const { floating: isFloatingComposer } = useRightPanelComposerPresentation();
  const canStartNewThread = canStartNewThreadTarget(model);
  const [busyAction, setBusyAction] = useState<StageThreadsBusyAction>(null);
  const [permissionState, setPermissionState] = useState<CodexPermissionState | null>(null);
  const [dictationToastMessage, setDictationToastMessage] = useState<string | null>(null);
  const [fileAttachments, setFileAttachments] = useScopedAtom(composerFileAttachmentsAtom);
  const [addedFiles, setAddedFiles] = useScopedAtom(composerAddedFilesAtom);
  const [imageAttachments, setImageAttachments] = useScopedAtom(composerImageAttachmentsAtom);
  const [appshotContexts, setAppshotContexts] = useScopedAtom(
    composerAppshotContextsAtom,
  );
  const [pastedTextAttachments, setPastedTextAttachments] = useScopedAtom(
    composerPastedTextAttachmentsAtom,
  );
  const [suggestionState, setSuggestionState] = useState<ComposerSuggestionState>(
    () => inactiveComposerSuggestionState(),
  );
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
  const addContextMenuRef = useRef<ComposerAddContextMenuHandle>(null);
  const appendPromptToHistoryRef = useRef<(text: string) => void>(() => {});
  const resetPromptHistorySelectionRef = useRef<() => void>(() => {});
  const dictationShortcutActiveRef = useRef(false);
  const attachmentGenerationRef = useRef(0);
  const pastedTextSourcesRef = useRef(new Map<string, string>());
  const pastedTextOperationGenerationRef = useRef(new Map<string, number>());
  const pastedTextOperationCounterRef = useRef(0);
  const composerMountedRef = useRef(true);
  const { serviceTierSettings, setServiceTier } = useCodexServiceTierSettings();
  const composerThreadId = model.conversation?.threadId ?? model.threadId;
  useEffect(() => {
    promptEditorRef.current?.syncMentionMetadata({
      apps: model.composerApps ?? [],
      plugins: model.composerPlugins ?? [],
      skills: model.composerSkills ?? [],
    });
  }, [
    model.composerApps,
    model.composerPlugins,
    model.composerSkills,
  ]);
  const browserAnnotationConversationId = composerThreadId
    ?? model.newThreadTarget?.sessionId
    ?? "";
  const getBrowserAnnotationsSnapshot = useCallback(
    () => getBrowserAnnotationAttachmentsSnapshot(browserAnnotationConversationId),
    [browserAnnotationConversationId],
  );
  const browserAnnotationAttachments = useSyncExternalStore(
    subscribeBrowserAnnotationAttachments,
    getBrowserAnnotationsSnapshot,
    getBrowserAnnotationsSnapshot,
  );
  const getBrowserImagesSnapshot = useCallback(
    () => getBrowserImageAttachmentsSnapshot(browserAnnotationConversationId),
    [browserAnnotationConversationId],
  );
  const browserImageAttachments = useSyncExternalStore(
    subscribeBrowserImageAttachments,
    getBrowserImagesSnapshot,
    getBrowserImagesSnapshot,
  );
  const getBrowserImageDrag = useCallback(
    () => getBrowserImageDragSnapshot(browserAnnotationConversationId),
    [browserAnnotationConversationId],
  );
  const browserImageDrag = useSyncExternalStore(
    subscribeBrowserImageDragState,
    getBrowserImageDrag,
    getBrowserImageDrag,
  );
  useEffect(() => {
    if (browserImageAttachments.length === 0) return;
    const attachmentIds = browserImageAttachments.map((attachment) => attachment.id);
    setImageAttachments((current) => {
      const existing = new Set(
        current.flatMap((attachment) => [attachment.id, attachment.path]),
      );
      return [
        ...current,
        ...browserImageAttachments.filter((attachment) =>
          !existing.has(attachment.id) && !existing.has(attachment.path)
        ),
      ];
    });
    consumeBrowserImageAttachments(
      browserAnnotationConversationId,
      attachmentIds,
    );
  }, [
    browserAnnotationConversationId,
    browserImageAttachments,
    setImageAttachments,
  ]);
  const commentAttachments = useScopedAtomValue(
    composerReviewCommentAttachmentsFamily(composerThreadId),
  );
  const attachmentState = useMemo<ComposerAttachmentState>(() => ({
    fileAttachments,
    addedFiles,
    imageAttachments,
    appshotContexts,
    pastedTextAttachments,
    commentAttachments,
    browserAnnotationAttachments,
  }), [
    addedFiles,
    appshotContexts,
    browserAnnotationAttachments,
    commentAttachments,
    fileAttachments,
    imageAttachments,
    pastedTextAttachments,
  ]);
  const hasAttachments = hasComposerAttachmentStateContent(attachmentState);
  const hasSubmittableAttachments = hasSubmittableComposerAttachmentState(attachmentState);
  const hasPendingPastedTextAttachments = pastedTextAttachments.some(
    (attachment) => attachment.status === "pending",
  );
  const pastedTextAttachmentsRef = useRef(pastedTextAttachments);
  pastedTextAttachmentsRef.current = pastedTextAttachments;
  const incrementAttachmentGeneration = useCallback(() => {
    attachmentGenerationRef.current += 1;
  }, []);

  const runPastedTextMaterialization = useCallback((input: {
    readonly id: string;
    readonly text: string;
    readonly preview: string;
    readonly characterCount: number;
    readonly generation: number;
  }) => {
    void createPastedTextAttachment({ text: input.text })
      .then((attachment) => {
        const isCurrent = composerMountedRef.current
          && pastedTextOperationGenerationRef.current.get(input.id) === input.generation;
        if (!isCurrent) {
          return removePastedTextAttachment({ file: attachment.file }).catch(() => undefined);
        }

        pastedTextSourcesRef.current.delete(input.id);
        pastedTextOperationGenerationRef.current.delete(input.id);
        setPastedTextAttachments((current) => current.map((item) => (
          item.id === input.id && item.status === "pending" && item.generation === input.generation
            ? {
                id: input.id,
                status: "ready",
                preview: attachment.preview,
                characterCount: attachment.characterCount ?? input.characterCount,
                attachment,
              }
            : item
        )));
      })
      .catch((error: unknown) => {
        if (
          !composerMountedRef.current
          || pastedTextOperationGenerationRef.current.get(input.id) !== input.generation
        ) {
          return;
        }

        setPastedTextAttachments((current) => current.map((item) => (
          item.id === input.id && item.status === "pending" && item.generation === input.generation
            ? {
                id: input.id,
                status: "failed",
                generation: input.generation,
                preview: input.preview,
                characterCount: input.characterCount,
                error: error instanceof Error ? error.message : "Could not add pasted text.",
              }
            : item
        )));
      });
  }, [setPastedTextAttachments]);

  const handleLargeTextPaste = useCallback((text: string): boolean => {
    const id = createComposerAttachmentId("pasted_text");
    pastedTextOperationCounterRef.current += 1;
    const generation = pastedTextOperationCounterRef.current;
    const preview = summarizeComposerPastedText(text);
    pastedTextSourcesRef.current.set(id, text);
    pastedTextOperationGenerationRef.current.set(id, generation);
    setPastedTextAttachments((current) => [
      ...current,
      {
        id,
        status: "pending",
        generation,
        preview,
        characterCount: text.length,
      },
    ]);
    runPastedTextMaterialization({
      id,
      text,
      preview,
      characterCount: text.length,
      generation,
    });
    return true;
  }, [runPastedTextMaterialization, setPastedTextAttachments]);

  const handleRetryPastedTextAttachment = useCallback((attachmentId: string) => {
    const text = pastedTextSourcesRef.current.get(attachmentId);
    const attachment = pastedTextAttachmentsRef.current.find((item) => item.id === attachmentId);
    if (!text || !attachment || attachment.status !== "failed") return;

    pastedTextOperationCounterRef.current += 1;
    const generation = pastedTextOperationCounterRef.current;
    pastedTextOperationGenerationRef.current.set(attachmentId, generation);
    setPastedTextAttachments((current) => current.map((item) => (
      item.id === attachmentId
        ? {
            id: item.id,
            status: "pending",
            generation,
            preview: item.preview,
            characterCount: item.characterCount,
          }
        : item
    )));
    runPastedTextMaterialization({
      id: attachmentId,
      text,
      preview: attachment.preview,
      characterCount: attachment.characterCount,
      generation,
    });
  }, [runPastedTextMaterialization, setPastedTextAttachments]);

  useEffect(() => {
    const pastedTextSources = pastedTextSourcesRef.current;
    const pastedTextOperationGenerations = pastedTextOperationGenerationRef.current;
    composerMountedRef.current = true;
    return () => {
      composerMountedRef.current = false;
      pastedTextSources.clear();
      pastedTextOperationGenerations.clear();
    };
  }, []);
  const recordSuccessfulPromptSubmit = useCallback((text: string) => {
    appendPromptToHistoryRef.current(text);
    resetPromptHistorySelectionRef.current();
  }, []);
  const completeSuccessfulSubmission = useCallback((text: string) => {
    recordSuccessfulPromptSubmit(text);
    incrementAttachmentGeneration();
    clearBrowserAnnotationAttachments(browserAnnotationConversationId);
    clearSubmittedDraft();
  }, [
    browserAnnotationConversationId,
    clearSubmittedDraft,
    incrementAttachmentGeneration,
    recordSuccessfulPromptSubmit,
  ]);
  const cleanupSubmittedPastedTextAttachments = useCallback(async () => {
    const readyAttachments = pastedTextAttachmentsRef.current.flatMap((attachment) => (
      attachment.status === "ready" ? [attachment.attachment.file] : []
    ));
    await Promise.allSettled(
      readyAttachments.map((file) => removePastedTextAttachment({ file })),
    );
  }, []);

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
    if (hasPendingPastedTextAttachments) return;
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
      hasAttachments: hasSubmittableAttachments,
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
        const sideChatPromptInput = buildComposerPromptInput({
          prompt: sideChatPrompt,
          attachments: attachmentState,
        });
        await actions.onOpenSideChat({
          prompt: sideChatPrompt,
          promptInput: sideChatPromptInput,
        });
        await cleanupSubmittedPastedTextAttachments();
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
      if (target?.runInTarget !== "newWorktree") {
        await cleanupSubmittedPastedTextAttachments();
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
    hasSubmittableAttachments,
    hasPendingPastedTextAttachments,
    model.activeTurn,
    model.conversation,
    model.isThreadRunning,
    model.newThreadTarget,
    model.selectedCollaborationMode,
    onErrorMessage,
    cleanupSubmittedPastedTextAttachments,
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

  const handleInsertPromptMention = useCallback((
    mention: ComposerPromptMentionInput,
  ) => {
    promptEditorRef.current?.insertMention(mention);
  }, []);

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

  const handleCaptureAppshot = useCallback(async (
    target: CodexComposerAppshotTarget,
  ): Promise<void> => {
    attachmentGenerationRef.current += 1;
    const generation = attachmentGenerationRef.current;
    try {
      const context = await invoke("codex:composer-appshot:capture", {
        targetId: target.id,
      });
      if (attachmentGenerationRef.current !== generation) return;
      setAppshotContexts((current) => appendUniqueBy(
        current,
        [context],
        (item) => item.id,
      ));
    } catch (error) {
      toast.danger("Unable to attach Appshot", {
        description: error instanceof Error
          ? error.message
          : `Could not capture ${target.appName}`,
      });
    }
  }, [setAppshotContexts]);

  const handleBrowserImageDragOver = useCallback((
    event: DragEvent<HTMLDivElement>,
  ) => {
    if (!browserImageDrag) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }, [browserImageDrag]);

  const handleBrowserImageDrop = useCallback(async (
    event: DragEvent<HTMLDivElement>,
  ) => {
    if (!browserImageDrag) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    try {
      const result = await invoke("browser-sidebar-command", {
        type: "attach-dragged-image",
        browserConversationId: browserImageDrag.browserConversationId,
        browserViewScopeId: browserImageDrag.browserViewScopeId,
        browserTabId: browserImageDrag.browserTabId,
      });
      if (!result.ok) onErrorMessage(result.message);
    } catch (error) {
      onErrorMessage(
        error instanceof Error ? error.message : "Could not add Browser image",
      );
    } finally {
      clearBrowserImageDragState(browserAnnotationConversationId);
    }
  }, [
    browserAnnotationConversationId,
    browserImageDrag,
    onErrorMessage,
  ]);

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
          hasDraftContent: nextPrompt.trim().length > 0 || hasSubmittableAttachments || goalModeActive,
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
    if (model.projectId === null) {
      setPermissionState(model.permissionState ?? null);
      return;
    }
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
  }, [model.permissionMode, model.permissionState, model.projectId]);

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

  const handleRemoveAppshotContext = useCallback((contextId: string) => {
    incrementAttachmentGeneration();
    setAppshotContexts((current) => current.filter(
      (context) => context.id !== contextId,
    ));
  }, [incrementAttachmentGeneration, setAppshotContexts]);

  const handleRemovePastedTextAttachment = useCallback((attachmentId: string) => {
    const attachment = pastedTextAttachmentsRef.current.find((item) => item.id === attachmentId);
    if (!attachment) return;

    pastedTextOperationGenerationRef.current.delete(attachmentId);
    pastedTextSourcesRef.current.delete(attachmentId);
    incrementAttachmentGeneration();
    setPastedTextAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
    if (attachment.status === "ready") {
      void removePastedTextAttachment({ file: attachment.attachment.file }).catch((error: unknown) => {
        onErrorMessage(error instanceof Error ? error.message : "Could not remove pasted text");
      });
    }
  }, [incrementAttachmentGeneration, onErrorMessage, setPastedTextAttachments]);

  const handleShowPastedTextInField = useCallback((attachmentId: string) => {
    const item = pastedTextAttachmentsRef.current.find((attachment) => attachment.id === attachmentId);
    if (!item || item.status !== "ready") return;

    void readPastedTextAttachment({ file: item.attachment.file })
      .then(async (text) => {
        if (
          text.length >= COMPOSER_LARGE_PASTE_CHAR_THRESHOLD
          && !window.confirm("This pasted text is large and may make the editor slower. Show it anyway?")
        ) {
          return;
        }

        const editor = promptEditorRef.current;
        if (editor) {
          editor.setText(text);
        } else {
          setPrompt(text);
        }
        setPastedTextAttachments((current) => current.filter(
          (attachment) => attachment.id !== attachmentId,
        ));
        await removePastedTextAttachment({ file: item.attachment.file });
      })
      .catch((error: unknown) => {
        onErrorMessage(error instanceof Error ? error.message : "Could not restore pasted text");
      });
  }, [onErrorMessage, setPastedTextAttachments, setPrompt]);

  const handleRemoveCommentAttachment = useCallback((attachmentId: string) => {
    removeReviewDiffCommentAttachment(composerThreadId, attachmentId);
  }, [composerThreadId]);

  const handleRemoveBrowserAnnotationAttachment = useCallback(
    (attachmentId: string) => {
      removeBrowserAnnotationAttachment(
        browserAnnotationConversationId,
        attachmentId,
      );
    },
    [browserAnnotationConversationId],
  );

  const slashCommands = useMemo(() => buildComposerSlashCommands({
    model,
    actions,
    serviceTier: serviceTierSettings.serviceTier,
    setServiceTier,
    openExpandedDialog: () => setSlashDialogOpen(true),
    onPetToggle: handleToggleDesktopPet,
    activateGoalMode,
  }), [
    activateGoalMode,
    actions,
    handleToggleDesktopPet,
    model,
    serviceTierSettings.serviceTier,
    setServiceTier,
  ]);
  const slashTrigger = useMemo<ComposerSlashTriggerState>(() => {
    if (
      suggestionState.active
      && suggestionState.kind === "slash-command"
      && suggestionState.trigger === "/"
      && suggestionState.range
    ) {
      return {
        active: true,
        trigger: "/",
        query: suggestionState.query,
        from: suggestionState.range.from,
        to: suggestionState.range.to,
      };
    }
    const cursor = suggestionState.anchorPos ?? 0;
    return {
      active: false,
      trigger: "/",
      query: "",
      from: cursor,
      to: cursor,
    };
  }, [suggestionState]);
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
    promptEditorRef.current?.closeSuggestions();
    setNestedSlashCommand(null);
    setInlineSlashHighlightIntent({ commandId: null, source: "programmatic" });
  }, []);
  const closeAddContextMenu = useCallback(() => {
    const editor = promptEditorRef.current;
    if (!editor) return;
    const suggestion = editor.getSuggestionState();
    if (suggestion.active && suggestion.range) {
      editor.clearRange(suggestion.range);
    }
    editor.closeSuggestions();
  }, []);
  const dismissAddContextMenu = useCallback(() => {
    promptEditorRef.current?.dismissSuggestions();
  }, []);

  const handleSuggestionStateChange = useCallback((
    nextSuggestion: ComposerSuggestionState,
  ) => {
    setSuggestionState(nextSuggestion);
    if (nextSuggestion.active) {
      if (
        nextSuggestion.kind !== "slash-command"
        || nextSuggestion.source === null
      ) {
        setNestedSlashCommand(null);
      }
      return;
    }
    setNestedSlashCommand(null);
    setInlineSlashHighlightIntent({ commandId: null, source: "programmatic" });
  }, []);

  const clearInlineSlashTrigger = useCallback((trigger: ComposerSlashTriggerState) => {
    promptEditorRef.current?.clearRange({ from: trigger.from, to: trigger.to });
    promptEditorRef.current?.closeSuggestions();
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
            promptEditorRef.current?.closeSuggestions();
          },
        });
        closeSlashMenu();
        return;
      }

      if (command.Content) {
        promptEditorRef.current?.openSlashSubmenu({
          kind: "slash-command",
          commandId: command.id,
          ...(command.dismissOnInput === true ? { dismissOnInput: true } : {}),
        });
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

  const backFromNestedSlashMenu = useCallback(() => {
    promptEditorRef.current?.openSlashSubmenu(null);
    setNestedSlashCommand(null);
  }, []);

  const handleSuggestionAction = useCallback((
    action: ComposerSuggestionAction,
  ): boolean => {
    if (
      suggestionState.active
      && (
        suggestionState.kind === "at-mention"
        || suggestionState.kind === "skill-mention"
      )
    ) {
      if (action === "next" || action === "previous") {
        return addContextMenuRef.current?.moveHighlight(action) ?? false;
      }
      if (action === "complete-query" || action === "insert-mention") {
        const didSubmit = addContextMenuRef.current
          ?.submitHighlighted(action) ?? false;
        if (!didSubmit && action === "insert-mention") {
          promptEditorRef.current?.closeSuggestions();
        }
        return true;
      }
      return true;
    }

    if (
      !suggestionState.active
      || suggestionState.kind !== "slash-command"
    ) {
      return false;
    }
    if (nestedSlashCommand) {
      if (action === "insert-mention") {
        closeSlashMenu();
        return true;
      }
      if (
        action === "complete-query"
        || action === "next"
        || action === "previous"
      ) {
        return true;
      }
      if (action === "dismiss") {
        setNestedSlashCommand(null);
        return true;
      }
      return action === "backspace";
    }
    if (action === "next" || action === "previous") {
      setInlineSlashHighlightIntent({
        commandId: resolveNextSlashHighlight({
          matches: slashMatches,
          currentCommandId: highlightedInlineSlashCommandId,
          direction: action,
        }),
        source: "keyboard",
      });
      return slashMatches.length > 0;
    }
    if (
      (action === "complete-query" || action === "insert-mention")
      && !nestedSlashCommand
    ) {
      const highlighted = slashMatches.find((match) =>
        match.command.id === highlightedInlineSlashCommandId
      )?.command ?? slashMatches[0]?.command ?? null;
      if (!highlighted) {
        if (action === "insert-mention") {
          promptEditorRef.current?.closeSuggestions();
        }
        return true;
      }
      selectSlashCommand(highlighted, "inline");
      return true;
    }
    if (action === "dismiss") {
      setNestedSlashCommand(null);
      setInlineSlashHighlightIntent({
        commandId: null,
        source: "programmatic",
      });
      return true;
    }
    return action === "backspace";
  }, [
    highlightedInlineSlashCommandId,
    closeSlashMenu,
    nestedSlashCommand,
    selectSlashCommand,
    slashMatches,
    suggestionState.active,
    suggestionState.kind,
  ]);

  const handleKeyDown = useCallback((event: ComposerPromptEditorKeyboardEvent): boolean => {
    if (nestedSlashCommand && event.key === "Escape") {
      event.preventDefault();
      closeSlashMenu();
      return true;
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
      hasDraftContent: prompt.trim().length > 0 || hasSubmittableAttachments || goalModeActive,
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
    hasSubmittableAttachments,
    model.composerEnterBehavior,
    model.conversation,
    model.isQueueingEnabled,
    model.isThreadRunning,
    nestedSlashCommand,
    handlePromptHistoryKeyDown,
    planModeAvailable,
    prompt,
    slashMenuOpen,
    submitPrompt,
    togglePlanMode,
  ]);

  const hasDraftContent = prompt.trim().length > 0 || hasSubmittableAttachments || goalModeActive;
  const hasFooterGoalChip = goalModeActive || Boolean(model.conversation?.threadGoal && actions.onClearThreadGoal);
  const hasMultilinePrompt = prompt.includes("\n");
  const floatingComposerSingleLine =
    isFloatingComposer
    && !hasAttachments
    && !hasMultilinePrompt
    && !errorMessage
    && !isDictating;
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
    !hasPendingPastedTextAttachments &&
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
    : isFloatingComposer
    ? "Do anything"
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
  const contextSuggestionOpen = suggestionState.active
    && suggestionState.kind === "at-mention";
  const composerPluginCwds = useMemo(
    () => Array.from(new Set(
      [model.cwd, model.projectWorkspacePath]
        .flatMap((candidate) =>
          candidate?.trim() ? [candidate.trim()] : []
        ),
    )),
    [model.cwd, model.projectWorkspacePath],
  );
  const addContextControl = (
    <ComposerAddContextTrigger
      open={contextSuggestionOpen}
      imagesOnly={model.isCloudNewThreadTarget}
      disabled={isPromptEditorDisabled}
      onToggle={() => {
        promptEditorRef.current?.toggleContextSuggestions();
      }}
    />
  );
  const intelligenceControls = (
    <>
      <ContextWindowIndicator
        state={contextWindowIndicatorState}
        account={model.account}
        showFallbackLabel={false}
      />
      <ModelSelectorDropdown
        model={model}
        serviceTier={serviceTierSettings.serviceTier}
        onServiceTierChange={(nextTier) => setServiceTier(nextTier, "composer_menu")}
        actions={actions}
      />
    </>
  );
  const dictationControl = isDictationSupported ? (
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
  ) : null;
  const primaryActionControl = (
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
  );
  const renderPromptEditor = (singleLine = false) => (
    <ComposerPromptEditor
      ref={promptEditorRef}
      data-composer-prompt-frame="true"
      value={prompt}
      placeholder={promptPlaceholder}
      disabled={isPromptEditorDisabled}
      singleLine={singleLine}
      onChange={(nextPrompt) => {
        setPrompt(nextPrompt);
      }}
      onKeyDown={handleKeyDown}
      onLargeTextPaste={handleLargeTextPaste}
      onSuggestionStateChange={handleSuggestionStateChange}
      onSuggestionAction={handleSuggestionAction}
    />
  );
  const composerLayout: ComposerAdaptiveLayout = floatingComposerSingleLine
    ? "single-line"
    : "multiline";
  const floatingLeadingControls = addContextControl;
  const floatingTrailingControls = (
    <div className="flex min-w-0 shrink-0 items-center gap-2">
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
      <div className="flex min-w-0 items-center gap-1">
        {intelligenceControls}
      </div>
      <PermissionModeDropdown
        selectedMode={model.permissionMode}
        availableModes={permissionState?.availableModes}
        autoReviewAvailable={permissionState?.autoReviewAvailable ?? false}
        customDescription={permissionState?.customDescription ?? null}
        triggerVariant="icon"
        onSelect={actions.onPermissionModeChange}
      />
      {dictationControl}
      {primaryActionControl}
    </div>
  );
  const standardLeadingControls = (
    <div className="flex min-w-0 items-center gap-[5px]">
      {addContextControl}
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
  );
  const standardTrailingControls = (
    <div className="flex min-w-0 items-center justify-end w-full">
      <div className="flex min-w-0 flex-1 justify-end">
        <div className="flex min-w-0 items-center gap-1">
          {intelligenceControls}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {dictationControl}
        {primaryActionControl}
      </div>
    </div>
  );
  const dictationRowContent = (
    <>
      <button
        type="button"
        className="inline-flex size-7 items-center justify-center rounded-full border border-transparent px-0 text-(--foreground-tertiary) opacity-50"
        aria-label={model.isCloudNewThreadTarget ? "Add photos and more" : "Add files and more"}
        title={model.isCloudNewThreadTarget ? "Add photos and more" : "Add files and more"}
        disabled
      >
        <PlusIcon className="size-4" />
      </button>
      <div className="flex h-token-button-composer min-w-0 flex-1 items-center">
        <canvas
          ref={waveformCanvasRef}
          className="h-token-button-composer w-full text-token-foreground"
        />
      </div>
      <span className="text-sm text-token-foreground/70 tabular-nums">
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
    </>
  );
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
      <div
        className={cn(
          "relative",
          browserImageDrag
            && "rounded-[20px] ring-2 ring-token-focus-border ring-offset-2 ring-offset-transparent",
        )}
        data-browser-image-drop-active={browserImageDrag ? "true" : "false"}
        onDragOver={handleBrowserImageDragOver}
        onDrop={(event) => {
          void handleBrowserImageDrop(event);
        }}
      >
        <ComposerAddContextMenu
          ref={addContextMenuRef}
          suggestion={suggestionState}
          isHomeMenu={model.isNewThreadTab}
          imagesOnly={model.isCloudNewThreadTarget}
          plugins={model.composerPlugins ?? []}
          pluginsLoading={model.composerPluginsLoading}
          skills={model.composerSkills ?? []}
          skillsLoading={model.composerSkillsLoading}
          apps={model.composerApps ?? []}
          appsLoading={model.composerAppsLoading}
          sites={model.composerSites ?? []}
          sitesAvailable={model.composerSitesAvailable === true}
          sitesLoading={model.composerSitesLoading}
          chatGptConversations={model.composerChatGptConversations ?? []}
          chatGptConversationsAvailable={
            model.composerChatGptConversationsAvailable === true
          }
          chatGptConversationsLoading={
            model.composerChatGptConversationsLoading
          }
          workspaceRoot={model.cwd ?? model.projectWorkspacePath ?? null}
          pluginCwds={composerPluginCwds}
          projectId={model.projectId}
          projectSelector={
            model.isNewThreadTab
              ? model.newThreadProjectSelector ?? null
              : null
          }
          goalAvailable={canUseComposerGoal(model, actions)}
          planModeAvailable={planModeAvailable}
          planModeActive={model.selectedCollaborationMode === "plan"}
          onClose={closeAddContextMenu}
          onDismiss={dismissAddContextMenu}
          onPickFiles={handlePickComposerFiles}
          onActivateGoal={activateGoalMode}
          onTogglePlanMode={() => {
            togglePlanMode();
          }}
          onCaptureAppshot={handleCaptureAppshot}
          onProjectChange={(projectId) => {
            actions.onNewThreadProjectChange?.(projectId);
          }}
          onStartNewChatWithPrompt={actions.onStartNewChatWithPrompt}
          onCapabilitiesChanged={actions.onComposerCapabilitiesChanged}
          onPrefillPrompt={(nextPrompt) => {
            setPrompt(nextPrompt);
            window.requestAnimationFrame(() => {
              promptEditorRef.current?.focus();
            });
          }}
          onInsertMention={handleInsertPromptMention}
        />
        <InlineSlashCommandMenu
          open={slashMenuOpen}
          isHomeMenu={model.isNewThreadTab}
          groups={slashGroups}
          matches={slashMatches}
          highlightedCommandId={highlightedInlineSlashCommandId}
          highlightedSource={highlightedInlineSlashCommandSource}
          nestedCommand={nestedSlashCommand}
          onHighlight={(commandId, source) => setInlineSlashHighlightIntent({ commandId, source })}
          onSelect={(command) => selectSlashCommand(command, "inline")}
          onClose={closeSlashMenu}
          onBack={backFromNestedSlashMenu}
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
            "composer-surface-chrome relative flex flex-col bg-token-input-background/90 backdrop-blur-lg electron:dark:bg-token-dropdown-background",
            floatingComposerSingleLine
              ? "overflow-visible rounded-full"
              : "overflow-y-auto _multilineSurface_1u8sk_2",
            showExternalFooter && "z-10",
          )}
        >
          <div className="relative z-10 flex min-h-0 flex-1 flex-col">
            {!floatingComposerSingleLine ? (
              <div
                className="_attachmentsDefault_1u8sk_2"
                data-composer-attachments="true"
              >
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
                  {appshotContexts.map((context) => (
                    <div
                      key={context.id}
                      className="group relative h-24 w-36 shrink-0 overflow-hidden rounded-xl border border-token-border bg-token-main-surface-secondary"
                      data-composer-appshot="true"
                      title={context.windowTitle
                        ? `${context.appName} — ${context.windowTitle}`
                        : context.appName}
                    >
                      <img
                        src={context.imageDataUrl}
                        alt={`${context.appName} Appshot`}
                        draggable={false}
                        className="size-full object-cover"
                      />
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-linear-to-t from-black/75 to-transparent px-2 pt-5 pb-1.5 text-[11px] text-white">
                        {context.appIconDataUrl ? (
                          <img
                            src={context.appIconDataUrl}
                            alt=""
                            aria-hidden="true"
                            draggable={false}
                            className="size-3.5 shrink-0 object-contain"
                          />
                        ) : null}
                        <span className="min-w-0 truncate">
                          {context.appName}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="absolute top-1 right-1 inline-flex size-5 items-center justify-center rounded-full bg-black/60 text-white opacity-80 backdrop-blur-sm transition-opacity hover:opacity-100 focus-visible:outline-2 focus-visible:outline-token-focus-border"
                        onClick={() => handleRemoveAppshotContext(context.id)}
                        aria-label={`Remove ${context.appName} Appshot`}
                      >
                        <CodexCloseIcon className="size-3" />
                      </button>
                    </div>
                  ))}
                  {pastedTextAttachments.map((attachment, index) => (
                    <div
                      key={attachment.id}
                      className="inline-flex max-w-72 items-center gap-1 rounded-full bg-token-foreground/5 py-1 pr-1 pl-2 text-xs text-token-foreground"
                      title={attachment.status === "failed" ? attachment.error : attachment.preview}
                    >
                      {attachment.status === "pending" ? (
                        <SpinnerIcon className="size-3 text-token-description-foreground" />
                      ) : (
                        <ComposerAddFilesIcon className="size-3 text-token-description-foreground" />
                      )}
                      <span className="min-w-0 truncate">
                        {attachment.status === "pending"
                          ? "Adding pasted text…"
                          : attachment.status === "failed"
                            ? "Pasted text failed"
                            : "Pasted text.txt"}
                      </span>
                      <span className="shrink-0 text-token-description-foreground">
                        {attachment.characterCount.toLocaleString()} chars
                      </span>
                      {attachment.status === "failed" ? (
                        <button
                          type="button"
                          className="rounded px-1 hover:bg-token-foreground/10"
                          onClick={() => handleRetryPastedTextAttachment(attachment.id)}
                        >
                          Retry
                        </button>
                      ) : null}
                      {attachment.status === "ready" ? (
                        <button
                          type="button"
                          className="rounded px-1 hover:bg-token-foreground/10"
                          onClick={() => handleShowPastedTextInField(attachment.id)}
                        >
                          Show in text field
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="rounded px-1 text-token-description-foreground hover:bg-token-foreground/10"
                        onClick={() => handleRemovePastedTextAttachment(attachment.id)}
                        aria-label={`Remove pasted text ${index + 1}`}
                      >
                        x
                      </button>
                    </div>
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
                  {browserAnnotationAttachments.map((attachment) => (
                    <button
                      key={attachment.id}
                      type="button"
                      className="inline-flex max-w-72 items-center gap-1 rounded-full bg-token-foreground/5 px-2 py-1 text-xs text-token-foreground hover:bg-token-foreground/10"
                      onClick={() =>
                        handleRemoveBrowserAnnotationAttachment(attachment.id)
                      }
                      title={`Remove browser annotation on ${attachment.pageTitle || attachment.pageUrl}`}
                    >
                      <ReviewFileDocumentIcon className="size-3 text-token-description-foreground" />
                      <span className="min-w-0 truncate">
                        {attachment.pageTitle || "Browser annotation"}
                      </span>
                      <span className="shrink-0 text-token-description-foreground">
                        {attachment.anchors.length}{" "}
                        {attachment.anchors.length === 1 ? "anchor" : "anchors"}
                      </span>
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
            ) : null}

            {isDictating ? (
              isFloatingComposer ? (
                <div className="grid min-h-11 grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] items-center gap-2 px-2 py-1">
                  {dictationRowContent}
                </div>
              ) : (
                <>
                  <ComposerInput layout="multiline">
                    {renderPromptEditor()}
                  </ComposerInput>
                  {errorMessage ? (
                    <div className="px-3 pb-2 text-xs text-(--destructive)">
                      {errorMessage}
                    </div>
                  ) : null}
                  <div className="mb-2 flex items-center gap-2 px-2">
                    {dictationRowContent}
                  </div>
                </>
              )
            ) : (
              <>
                {errorMessage && isFloatingComposer ? (
                  <div className="px-3 pt-2 text-xs text-(--destructive)">
                    {errorMessage}
                  </div>
                ) : null}
                <ComposerAdaptiveFooter
                  layout={composerLayout}
                  input={(
                    <>
                      <ComposerInput layout={composerLayout}>
                        {renderPromptEditor(floatingComposerSingleLine)}
                      </ComposerInput>
                      {errorMessage && !isFloatingComposer ? (
                        <div className="px-3 pb-2 text-xs text-(--destructive)">
                          {errorMessage}
                        </div>
                      ) : null}
                    </>
                  )}
                  leadingControls={
                    isFloatingComposer
                      ? floatingLeadingControls
                      : standardLeadingControls
                  }
                  trailingControls={
                    isFloatingComposer
                      ? floatingTrailingControls
                      : standardTrailingControls
                  }
                />
              </>
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
