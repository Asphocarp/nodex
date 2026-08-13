import { useState } from "react";
import { ChevronDownIcon, CloseIcon } from "@/components/shared/icons";
import { LoadingResultsShimmer } from "@/components/ui/loading-results-shimmer";
import {
  NodexPopover,
  NodexPopoverContent,
  NodexPopoverTrigger,
} from "@/components/ui/popover";
import { useCodexMcpApps } from "../../../use-codex-mcp-apps";
import type {
  CodexCanonicalSetupCodexStepResponse,
  CodexOptionPickerRequest,
  CodexSetupCodexStepRequest,
  CodexProtocolRequestId,
} from "@/lib/types";
import {
  getCodexSetupRoleLabel,
  resolveCodexSetupTaskSuggestions,
  shuffleCodexSetupRoles,
  type CodexSetupRoleId,
} from "../../../setup-codex-onboarding";
import {
  useCodexSetupRoleState,
  useSetCodexSetupRoles,
} from "../../../setup-codex-role-state";
import {
  buildCodexSetupSelectedSourceIds,
  resolveCodexSetupBrowseSources,
  resolveCodexSetupFallbackSources,
  type CodexSetupContextSource,
} from "../../../setup-codex-context-sources";
import {
  SETUP_TASK_FORM_POLICY,
  RequestComposerView,
  buildUserInputAnswers,
  type RequestComposerRequest,
} from "../../shared/request-cards/local-conversation-request-cards";
import { CodexOptionPickerRequestCard } from "./codex-option-picker-request-card";

interface CodexSetupCodexStepRequestCardProps {
  request: CodexSetupCodexStepRequest;
  onRespond: (
    requestId: CodexProtocolRequestId,
    response: CodexCanonicalSetupCodexStepResponse,
  ) => Promise<void>;
}

function CodexSetupRoleRequestCard({
  request,
  onRespond,
}: CodexSetupCodexStepRequestCardProps) {
  const [roles] = useState<CodexSetupRoleId[]>(() => shuffleCodexSetupRoles());
  const setSetupRoles = useSetCodexSetupRoles();
  const roleByLabel = new Map(roles.map((role) => [getCodexSetupRoleLabel(role), role]));
  const optionRequest: CodexOptionPickerRequest = {
    ...request,
    type: "optionPicker",
    question: "What type of work do you do?",
    options: roles.map((role) => ({
      label: getCodexSetupRoleLabel(role),
      description: "",
    })),
    allowMultiple: true,
    submitLabel: "Continue",
    skipLabel: null,
  };

  return (
    <CodexOptionPickerRequestCard
      request={optionRequest}
      showFreeform={false}
      onRespond={async (requestId, response) => {
        const selectedRoles = response.action === "submit"
          ? response.selectedOptions.flatMap((label) => {
              const role = roleByLabel.get(label);
              return role ? [role] : [];
            })
          : [];
        if (response.action === "submit") {
          await setSetupRoles(selectedRoles);
        }
        await onRespond(requestId, {
          step: "role",
          action: response.action,
          selectedRoles,
        });
      }}
    />
  );
}

function CodexSetupTaskRequestCard({
  request,
  onRespond,
}: CodexSetupCodexStepRequestCardProps) {
  const roleState = useCodexSetupRoleState();
  const taskRequest: RequestComposerRequest = {
    requestId: request.requestId,
    questions: [{
      id: "first_task",
      header: "First task",
      question: "What's something we can knock off your list today?",
      isOther: true,
      otherPlaceholder: "No, and tell ChatGPT what to do differently",
      options: resolveCodexSetupTaskSuggestions(roleState.roles).map((suggestion) => ({
        label: suggestion.title,
        description: suggestion.prompt,
      })),
    }],
  };

  const respond = async (
    action: "submit" | "skip" | "dismiss",
    answer: string | null = null,
  ) => {
    await onRespond(request.requestId, {
      step: "task",
      action,
      answers: answer
        ? { first_task: { answers: [answer] } }
        : {},
    });
  };

  return (
    <RequestComposerView
      header="First task"
      request={taskRequest}
      policy={SETUP_TASK_FORM_POLICY}
      onSubmit={async (nextRequest, state) => {
        const answer = buildUserInputAnswers(nextRequest, state).first_task?.[0]?.trim() ?? "";
        await respond("submit", answer || null);
      }}
      onSkip={async () => respond("skip")}
      onEscapeDismiss={async () => respond("dismiss")}
      submitErrorMessage="Could not submit setup task"
      skipErrorMessage="Could not skip setup task"
      dismissErrorMessage="Could not dismiss setup task"
    />
  );
}

function ComposerKeycap() {
  return (
    <kbd aria-hidden className="inline-flex h-4 min-w-4 items-center justify-center rounded-md bg-current/10 px-1.5 font-sans text-xs leading-4">
      ⏎
    </kbd>
  );
}

function ContextSourceLogo({ source }: { source: CodexSetupContextSource }) {
  if (!source.logoUrl && !source.logoUrlDark) {
    return (
      <span className="flex size-6 items-center justify-center rounded-md bg-token-foreground/10 text-xs font-medium">
        {source.name.slice(0, 1).toUpperCase()}
      </span>
    );
  }

  return (
    <picture>
      {source.logoUrlDark ? <source media="(prefers-color-scheme: dark)" srcSet={source.logoUrlDark} /> : null}
      <img
        src={source.logoUrl ?? source.logoUrlDark ?? undefined}
        alt={source.name}
        className="size-6 rounded-md object-contain"
      />
    </picture>
  );
}

function ContextSourceRow({
  source,
  onConnect,
}: {
  source: CodexSetupContextSource;
  onConnect?: (source: CodexSetupContextSource) => void;
}) {
  return (
    <div className="flex min-h-10 items-center gap-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-token-border bg-token-background">
        <ContextSourceLogo source={source} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-token-foreground">{source.name}</div>
        {source.description ? (
          <div className="truncate text-sm text-token-text-tertiary">{source.description}</div>
        ) : null}
      </div>
      <button
        type="button"
        disabled={source.connected || !onConnect}
        className="inline-flex h-token-button-composer shrink-0 items-center rounded-lg bg-token-foreground/10 px-3 text-sm text-token-foreground hover:bg-token-foreground/15 disabled:cursor-default disabled:opacity-60"
        onClick={() => onConnect?.(source)}
      >
        {source.connected ? "Connected" : "Connect"}
      </button>
    </div>
  );
}

function ContextSkeleton() {
  return (
    <LoadingResultsShimmer
      className="min-h-34 justify-center"
      lines={3}
      maxWidth={92}
      minWidth={62}
      seed="setup-context-sources"
    />
  );
}

export function CodexSetupContextRequestCardView({
  request,
  recommendedSources,
  browseSources,
  isLoading = false,
  onConnectSource,
  onRespond,
}: {
  request: CodexSetupCodexStepRequest;
  recommendedSources: readonly CodexSetupContextSource[];
  browseSources: readonly CodexSetupContextSource[];
  isLoading?: boolean;
  onConnectSource?: (source: CodexSetupContextSource) => void;
  onRespond: CodexSetupCodexStepRequestCardProps["onRespond"];
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const filteredBrowseSources = browseSources.filter((source) => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return true;
    return [source.id, source.name, source.description ?? ""]
      .some((value) => value.toLowerCase().includes(normalizedQuery));
  });

  const connect = (source: CodexSetupContextSource) => {
    if (source.connected) return;
    setSelectedIds((current) => current.includes(source.id) ? current : [...current, source.id]);
    onConnectSource?.(source);
  };

  const respond = async (action: "continue" | "skip" | "dismiss") => {
    await onRespond(request.requestId, {
      step: "context",
      action,
      selectedSources: action === "continue"
        ? buildCodexSetupSelectedSourceIds(selectedIds, recommendedSources)
        : [],
    });
  };

  return (
    <div className="flex flex-col overflow-hidden rounded-[28px] bg-token-input-background text-token-foreground electron:elevation-prominent extension:border extension:border-token-border">
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <div className="text-sm font-medium">Where can we pull context from?</div>
        <button
          type="button"
          aria-label="Dismiss"
          className="inline-flex h-token-button-composer aspect-square items-center justify-center rounded-lg text-token-text-tertiary hover:bg-token-list-hover-background hover:text-token-foreground"
          onClick={() => void respond("dismiss")}
        >
          <CloseIcon className="icon-2xs" />
        </button>
      </div>

      <div
        aria-busy={isLoading}
        aria-label={isLoading ? "Loading context sources" : undefined}
        aria-live="polite"
        className="flex flex-col gap-2 px-4"
        role={isLoading ? "status" : undefined}
      >
        {isLoading
          ? <ContextSkeleton />
          : recommendedSources.map((source) => (
              <ContextSourceRow key={source.id} source={source} onConnect={onConnectSource ? connect : undefined} />
            ))}
      </div>

      <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-4">
        <NodexPopover>
          <NodexPopoverTrigger asChild>
            <button
              type="button"
              disabled={isLoading}
              className="inline-flex h-token-button-composer items-center gap-1 rounded-lg bg-token-foreground/10 px-3 text-sm text-token-foreground hover:bg-token-foreground/15 disabled:opacity-40"
            >
              <span>Browse all</span>
              <ChevronDownIcon className="icon-2xs" />
            </button>
          </NodexPopoverTrigger>
          <NodexPopoverContent align="start" side="top" className="w-96 p-0">
            <div className="p-1">
              <input
                aria-label="Search apps and plugins"
                placeholder="Search apps and plugins"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                className="h-9 w-full rounded-lg bg-transparent px-3 text-sm outline-none placeholder:text-token-text-tertiary"
              />
            </div>
            <div className="max-h-64 overflow-y-auto pb-1">
              {isLoading ? (
                <div className="px-3 py-4 text-center text-sm text-token-text-tertiary">Loading apps...</div>
              ) : filteredBrowseSources.length > 0 ? (
                filteredBrowseSources.map((source) => (
                  <button
                    key={source.id}
                    type="button"
                    disabled={source.connected}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-token-list-hover-background disabled:cursor-default"
                    onClick={() => connect(source)}
                  >
                    <ContextSourceLogo source={source} />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm">{source.name}</span>
                        {source.connected ? <span className="shrink-0 text-xs text-token-text-tertiary">Connected</span> : null}
                      </span>
                      {source.description ? <span className="line-clamp-1 text-xs text-token-text-tertiary">{source.description}</span> : null}
                    </span>
                    {!source.connected && selectedIds.includes(source.id) ? <span aria-label="Selected">✓</span> : null}
                  </button>
                ))
              ) : (
                <div className="px-3 py-4 text-center text-sm text-token-text-tertiary">No apps found</div>
              )}
            </div>
          </NodexPopoverContent>
        </NodexPopover>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex h-token-button-composer items-center rounded-lg px-2 text-sm text-token-description-foreground hover:bg-token-list-hover-background"
            onClick={() => void respond("skip")}
          >
            Skip
          </button>
          <button
            type="button"
            disabled={isLoading}
            className="inline-flex h-token-button-composer items-center gap-1 rounded-lg bg-token-foreground px-2 text-token-dropdown-background hover:bg-token-foreground/80 disabled:opacity-40"
            onClick={() => void respond("continue")}
          >
            <span className="text-sm font-medium">Continue</span>
            <ComposerKeycap />
          </button>
        </div>
      </div>
    </div>
  );
}

function CodexSetupContextRequestCard({
  request,
  onRespond,
}: CodexSetupCodexStepRequestCardProps) {
  const { data: apps = [], isPending } = useCodexMcpApps();
  const connectedApps = apps.filter((app) => app.isAccessible && app.isEnabled);
  return (
    <CodexSetupContextRequestCardView
      request={request}
      recommendedSources={resolveCodexSetupFallbackSources(connectedApps)}
      browseSources={resolveCodexSetupBrowseSources(connectedApps, "")}
      isLoading={isPending}
      onRespond={onRespond}
    />
  );
}

export function CodexSetupCodexStepRequestCard(
  props: CodexSetupCodexStepRequestCardProps,
) {
  switch (props.request.step) {
    case "role":
      return <CodexSetupRoleRequestCard {...props} />;
    case "task":
      return <CodexSetupTaskRequestCard {...props} />;
    case "context":
      return <CodexSetupContextRequestCard {...props} />;
  }
}
