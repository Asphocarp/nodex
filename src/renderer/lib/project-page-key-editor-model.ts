import {
  isPlausiblePageKeyPrefixDraft,
  normalizePageKeyPrefixInput,
} from "../../shared/page-key";
import type { DatabasePageKeyNamespaceV2 } from "../../shared/database-module-v2";
import type { PageKeyPrefixPreviewState } from "./use-page-key-prefix-preview";

export interface ProjectPageKeySaveFailure {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly detailsSaved?: boolean;
}

export interface ProjectPageKeyEditorModel {
  readonly prefix: string;
  readonly summary: string;
  readonly canSubmit: boolean;
  readonly statusText: string;
  readonly prefixError: string | null;
  readonly formError: string | null;
  readonly impactText: string | null;
  readonly history: readonly {
    readonly prefix: string;
    readonly detail: string;
  }[];
  readonly suggestedPrefix: string | null;
}

interface ProjectPageKeyEditorModelInput {
  readonly mode: "create" | "edit";
  readonly expanded: boolean;
  readonly draftPrefix: string;
  readonly currentPrefix?: string;
  readonly preview: PageKeyPrefixPreviewState;
  readonly settings?: DatabasePageKeyNamespaceV2;
  readonly settingsStatus: "idle" | "loading" | "ready" | "error";
  readonly saveFailure?: ProjectPageKeySaveFailure | null;
}

const previewSummary = (preview: PageKeyPrefixPreviewState): string =>
  "exampleKeys" in preview && preview.exampleKeys.length > 0
    ? `Page keys · ${preview.exampleKeys.join(", ")}, …`
    : "Page keys · Checking…";

export function projectPageKeyEditorModel({
  mode,
  expanded,
  draftPrefix,
  currentPrefix,
  preview,
  settings,
  settingsStatus,
  saveFailure,
}: ProjectPageKeyEditorModelInput): ProjectPageKeyEditorModel {
  const prefix = normalizePageKeyPrefixInput(draftPrefix);
  const valid = isPlausiblePageKeyPrefixDraft(prefix);
  const renamed = mode === "edit"
    && currentPrefix !== undefined
    && prefix !== currentPrefix;
  const confirmed = preview.kind === "available" || preview.kind === "current";
  let statusText = "";
  if (!valid) {
    statusText = "Use 2–8 letters or numbers, starting with a letter.";
  } else if (preview.kind === "checking") {
    statusText = "Checking…";
  } else if (preview.kind === "available") {
    statusText = preview.exampleKeys[0]
      ? `${preview.exampleKeys[0]} is available`
      : `${preview.prefix} is available`;
  } else if (preview.kind === "current") {
    statusText = "Current prefix";
  } else if (preview.kind === "reserved") {
    statusText = "Already used in this Library";
  } else if (preview.kind === "error") {
    statusText = preview.error.message;
  }

  let impactText: string | null = null;
  if (expanded && renamed && settingsStatus === "loading") {
    impactText = "Loading rename impact…";
  } else if (expanded && renamed && settingsStatus === "error") {
    impactText = "Rename impact is unavailable. Try again before saving.";
  } else if (expanded && renamed && settings) {
    impactText = settings.assignedPageCount === 0
      ? `No Pages use ${settings.currentPrefix} yet. The old prefix will be released.`
      : `${settings.assignedPageCount} ${settings.assignedPageCount === 1 ? "Page" : "Pages"} will use prefix ${prefix}; existing IDs with ${settings.currentPrefix} will keep working and remain reserved.`;
  }

  let prefixError: string | null = null;
  let formError: string | null = null;
  if (saveFailure?.code === "identity_conflict") {
    prefixError = "This prefix was claimed in another window. Check again or use the suggested prefix.";
  } else if (saveFailure?.code === "revision_conflict") {
    formError = saveFailure.detailsSaved
      ? "Project details were saved, but the prefix changed in another window. Review the latest prefix and try again."
      : "This project changed in another window. Review the latest values and try again.";
  } else if (saveFailure?.code === "not_found") {
    formError = "This project is no longer available.";
  } else if (saveFailure) {
    formError = saveFailure.detailsSaved
      ? `Project details were saved, but the prefix was not changed. ${saveFailure.message}`
      : saveFailure.message;
  }

  const renameImpactReady = !renamed || settingsStatus === "ready";
  const namespaceReady = mode !== "edit" || !expanded || settingsStatus === "ready";
  const canSubmit = mode === "edit" && !renamed
    ? namespaceReady
    : valid && confirmed && renameImpactReady;
  return {
    prefix: confirmed ? preview.prefix : prefix,
    summary: previewSummary(preview),
    canSubmit,
    statusText,
    prefixError,
    formError,
    impactText,
    history: expanded && settings
      ? settings.retiredPrefixes.map((retired) => ({
          prefix: retired.prefix,
          detail: `Numbers through ${retired.lastNumber} still resolve`,
        }))
      : [],
    suggestedPrefix: preview.kind === "reserved"
      ? preview.alternativePrefix
      : null,
  };
}
