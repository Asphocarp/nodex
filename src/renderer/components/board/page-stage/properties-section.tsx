import { useMemo, useState } from "react";

import { ThreadsIcon } from "@/components/workbench/threads-icon";
import { NodexDropdown } from "@/components/ui/dropdown";
import { toast } from "@/components/ui/toast";
import { SchedulePopover } from "@/components/board/schedule-popover";
import { dataSourcePropertyIcon } from "@/components/database/data-source-property-presentation";
import {
  DATABASE_PAGE_PROPERTY_EMPTY_TRIGGER_CLASS_NAME,
  PropertyEmptyValue,
} from "@/components/database/property-empty-value";
import { DATABASE_PAGE_PROPERTY_OUTLINED_TOKEN_CLASS_NAME } from "@/components/database/property-value-chip";
import {
  ActivitySpinnerIcon,
  ChevronDownIcon,
  PageMenuOpenNewChatIcon,
  PlusIcon,
  ThreadIcon,
} from "@/components/shared/icons";
import { PageChatActivityGlyph } from "@/components/shared/page-chat-activity-glyph";
import { XIcon } from "@/components/shared/icons/generic-icons";
import { presentPageChatItemActivity } from "@/lib/page-chat-activity-presentation";
import { cn } from "@/lib/utils";
import { PageStageDataSourcePropertyControl } from "./data-source-property-control";
import type { PageStageController } from "./use-page-stage-controller";
import { PageFilesRow } from "./page-files-row";

interface PageStagePropertiesSectionProps {
  readonly controller: PageStageController;
}

function RelatedChatAddControl({
  controller,
  empty,
}: PageStagePropertiesSectionProps & { readonly empty: boolean }) {
  const { relatedChats, relatedChatCandidates, onCreateRelatedChat, onLinkRelatedChat, saving } =
    controller;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [linkingSessionId, setLinkingSessionId] = useState<string | null>(null);
  const linkedSessionIds = useMemo(
    () => new Set(relatedChats.map((chat) => chat.sessionId)),
    [relatedChats],
  );
  const availableCandidates = useMemo(
    () => relatedChatCandidates.filter((chat) => !linkedSessionIds.has(chat.sessionId)),
    [linkedSessionIds, relatedChatCandidates],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredCandidates = normalizedQuery
    ? availableCandidates.filter((candidate) =>
        [candidate.displayTitle, candidate.projectName]
          .filter(Boolean)
          .some((value) => value?.toLocaleLowerCase().includes(normalizedQuery)),
      )
    : availableCandidates;
  if (!onCreateRelatedChat && !onLinkRelatedChat) return null;

  const triggerButton = empty ? (
    <button
      type="button"
      aria-label="Add chat"
      disabled={saving}
      className={cn(
        "flex min-h-6 min-w-0 items-center text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-token-focus disabled:opacity-40",
        DATABASE_PAGE_PROPERTY_EMPTY_TRIGGER_CLASS_NAME,
      )}
    >
      <PropertyEmptyValue className="truncate" />
    </button>
  ) : (
    <button
      type="button"
      aria-label="Add chat"
      disabled={saving}
      className="flex size-5 shrink-0 items-center justify-center rounded-sm text-(--foreground-tertiary) opacity-60 hover:bg-(--background-tertiary) hover:text-(--foreground-secondary) hover:opacity-100 focus-visible:outline-2 focus-visible:outline-token-focus focus-visible:opacity-100 disabled:opacity-40"
    >
      <PlusIcon className="icon-2xs shrink-0" />
    </button>
  );

  return (
    <NodexDropdown.Menu
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery("");
      }}
      triggerButton={triggerButton}
      triggerTooltipContent={empty ? undefined : "Add chat"}
      contentWidth="menuFixed"
      align="start"
    >
      {onCreateRelatedChat ? (
        <NodexDropdown.Item
          leftSlot={<PageMenuOpenNewChatIcon />}
          onSelect={() => {
            void Promise.resolve(onCreateRelatedChat()).catch(() => {
              toast.danger("Couldn’t create chat");
            });
          }}
        >
          New chat
        </NodexDropdown.Item>
      ) : null}
      {onCreateRelatedChat && onLinkRelatedChat ? <NodexDropdown.Separator /> : null}
      {onLinkRelatedChat ? (
        <NodexDropdown.FlyoutSubmenuItem
          label="Link to chat…"
          leftSlot={<ThreadIcon className="icon-xs shrink-0" />}
          disabled={availableCandidates.length === 0}
          contentClassName="w-[280px] p-1"
        >
          <NodexDropdown.SearchInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a chat…"
            aria-label="Find a chat to link"
          />
          <NodexDropdown.ScrollList className="mt-1">
            {filteredCandidates.length === 0 ? (
              <NodexDropdown.Message compact>
                {normalizedQuery ? "No matching chats" : "No chats available"}
              </NodexDropdown.Message>
            ) : (
              filteredCandidates.map((candidate) => (
                <NodexDropdown.ActionRow
                  key={candidate.sessionId}
                  disabled={linkingSessionId !== null}
                  className="items-center gap-1.5"
                  onClick={() => {
                    setLinkingSessionId(candidate.sessionId);
                    void onLinkRelatedChat(candidate.sessionId)
                      .then(() => setOpen(false))
                      .catch(() => toast.danger("Couldn’t link chat"))
                      .finally(() => setLinkingSessionId(null));
                  }}
                >
                  <ThreadIcon className="icon-xs shrink-0 text-token-text-secondary" />
                  <span className="min-w-0 flex-1 truncate text-left">
                    {candidate.displayTitle}
                  </span>
                  {candidate.projectName ? (
                    <span className="max-w-24 shrink truncate text-xs text-token-description-foreground">
                      {candidate.projectName}
                    </span>
                  ) : null}
                  {linkingSessionId === candidate.sessionId ? (
                    <ActivitySpinnerIcon className="size-3 shrink-0" />
                  ) : null}
                </NodexDropdown.ActionRow>
              ))
            )}
          </NodexDropdown.ScrollList>
        </NodexDropdown.FlyoutSubmenuItem>
      ) : null}
    </NodexDropdown.Menu>
  );
}

function RelatedChatsPropertyRow({ controller }: PageStagePropertiesSectionProps) {
  const {
    relatedChats,
    relatedChatsLoading,
    relatedChatsError,
    relatedChatsHasMore,
    relatedChatsLoadingMore,
    onOpenRelatedChat,
    onRemoveRelatedChat,
    onRetryRelatedChats,
    onLoadMoreRelatedChats,
    saving,
    currentSessionId,
    handleOpenRelatedChat,
    handleRemoveRelatedChat,
  } = controller;
  const empty = relatedChats.length === 0;
  const showEmptyControl = empty && !relatedChatsLoading;

  return (
    <div className="grid min-h-7.5 grid-cols-[10rem_minmax(0,1fr)] items-start">
      <div className="flex min-h-7.5 min-w-0 items-center gap-1.5 pl-1.5">
        <div className="flex w-5 shrink-0 items-center justify-center text-(--foreground-secondary)">
          <ThreadsIcon />
        </div>
        <span className="min-w-0 truncate text-sm/5 text-(--foreground-secondary)">
          Linked chats
        </span>
      </div>

      <div className={cn("min-w-0 px-2", showEmptyControl && !relatedChatsError && "self-center")}>
        {relatedChatsError ? (
          <div className="flex min-h-7 items-center gap-2 text-xs text-(--red-text)">
            <span className="min-w-0 flex-1 truncate">{relatedChatsError}</span>
            {onRetryRelatedChats ? (
              <button
                type="button"
                className="shrink-0 text-(--foreground-secondary) hover:text-(--foreground)"
                onClick={() => void onRetryRelatedChats()}
              >
                Retry
              </button>
            ) : null}
          </div>
        ) : null}
        {relatedChatsLoading && relatedChats.length === 0 ? (
          <div
            role="status"
            aria-label="Loading linked chats"
            className="flex h-7 items-center px-1.5 text-(--foreground-tertiary)"
          >
            <ActivitySpinnerIcon className="size-3.5" />
          </div>
        ) : null}
        {relatedChats.length > 0 ? (
          <div className="flex min-h-7 flex-wrap items-center gap-1 py-0.5">
            {relatedChats.map((chat) => {
              const activity = presentPageChatItemActivity(chat);
              const current = currentSessionId === chat.sessionId;
              return (
                <span
                  key={chat.sessionId}
                  data-page-stage-related-chat-session-id={chat.sessionId}
                  data-page-stage-related-chat-chip="true"
                  className={cn(
                    DATABASE_PAGE_PROPERTY_OUTLINED_TOKEN_CLASS_NAME,
                    "group/related-chat relative max-w-64 gap-0 p-0 hover:bg-token-foreground/5",
                    current
                      ? "text-token-text-primary ring-token-border-heavy"
                      : "text-token-text-secondary hover:text-token-text-primary",
                  )}
                >
                  <button
                    type="button"
                    aria-current={current ? "true" : undefined}
                    disabled={!onOpenRelatedChat}
                    onClick={() => void handleOpenRelatedChat(chat.sessionId)}
                    className={cn(
                      "flex h-full min-w-0 flex-1 items-center gap-1 pl-1.5 text-left outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-token-focus disabled:opacity-60",
                      onRemoveRelatedChat ? "pr-6" : "pr-1.5",
                    )}
                  >
                    <PageChatActivityGlyph
                      activity={activity}
                      className={cn("size-4", activity.execution === "idle" && "text-inherit")}
                      unreadRingClassName="ring-token-main-surface-primary"
                    />
                    <span className="min-w-0 flex-1 truncate">{chat.displayTitle}</span>
                  </button>
                  {onRemoveRelatedChat ? (
                    <button
                      type="button"
                      aria-label={`Remove relation to ${chat.displayTitle}`}
                      disabled={saving}
                      className="absolute right-0.5 top-1/2 flex size-5 -translate-y-1/2 shrink-0 items-center justify-center rounded-sm text-token-description-foreground opacity-0 hover:bg-token-foreground/10 hover:text-token-text-primary group-hover/related-chat:opacity-100 group-focus-within/related-chat:opacity-100 disabled:opacity-40"
                      onClick={() => void handleRemoveRelatedChat(chat.sessionId)}
                    >
                      <XIcon className="size-3" />
                    </button>
                  ) : null}
                </span>
              );
            })}
            {relatedChatsHasMore && onLoadMoreRelatedChats ? (
              <button
                type="button"
                disabled={relatedChatsLoadingMore}
                className="flex h-5.5 items-center gap-1 rounded-md px-1.5 text-xs text-token-description-foreground hover:bg-token-foreground/5 hover:text-token-text-secondary disabled:opacity-50"
                onClick={() => void onLoadMoreRelatedChats()}
              >
                {relatedChatsLoadingMore ? <ActivitySpinnerIcon className="size-3" /> : null}
                Load more
              </button>
            ) : null}
            <RelatedChatAddControl controller={controller} empty={false} />
          </div>
        ) : null}
        {showEmptyControl ? <RelatedChatAddControl controller={controller} empty={true} /> : null}
      </div>
    </div>
  );
}

export function PageStagePropertiesSection({ controller }: PageStagePropertiesSectionProps) {
  if (!controller.page) return null;
  const { propertyControls } = controller;
  const isCollapsed = (propertyId: string): boolean => {
    if (propertyId === "tags") return controller.collapseTagsByDefault;
    if (propertyId === "assignee") return controller.collapseAssigneeByDefault;
    return false;
  };

  return (
    <section className="border-b-[0.5px] border-(--table-border) pb-3" aria-label="Properties">
      <div className="flex items-center gap-2 py-0.75 pl-1.5">
        <h2 className="text-base/4.5 font-medium text-(--foreground-secondary)">Properties</h2>
      </div>

      <div className="flex flex-col pb-1">
        <PageFilesRow controller={controller} />

        {propertyControls.sectionProperties.map((item) => {
          if (!controller.showCollapsedProperties && isCollapsed(item.property.propertyId)) {
            return null;
          }
          const Icon = dataSourcePropertyIcon(item.property);
          return (
            <div key={item.property.propertyId} className="flex min-h-7.5 items-center">
              <div className="flex w-40 shrink-0 items-center gap-1.5 pl-1.5">
                <div className="flex w-5 items-center justify-center text-(--foreground-secondary)">
                  <Icon className="size-4 shrink-0" />
                </div>
                <span className="truncate text-sm/5 text-(--foreground-secondary)">
                  {item.property.name}
                </span>
              </div>
              <PageStageDataSourcePropertyControl
                item={item}
                controls={propertyControls}
                className="min-w-0 flex-1 px-2"
              />
            </div>
          );
        })}

        {controller.hasRelatedChatsRow &&
        (controller.showCollapsedProperties || !controller.collapseThreadsByDefault) ? (
          <RelatedChatsPropertyRow controller={controller} />
        ) : null}

        {propertyControls.hasScheduleCapability &&
        controller.schedulePage &&
        (controller.showCollapsedProperties || !controller.collapseScheduleByDefault) ? (
          <SchedulePopover schedule={controller.schedule} page={controller.schedulePage} />
        ) : null}
      </div>

      {controller.collapsedPropertyCount > 0 ? (
        <button
          type="button"
          onClick={() => controller.setPropertiesExpanded((current) => !current)}
          className="flex h-8 items-center gap-1.5 rounded-sm px-1.5 text-sm text-(--foreground-tertiary) hover:bg-(--background-tertiary)"
        >
          <ChevronDownIcon
            className={cn(
              "icon-2xs shrink-0 transition-transform duration-150",
              controller.propertiesExpanded ? "rotate-180" : "-rotate-90",
            )}
          />
          {controller.collapsedPropertyLabel}
        </button>
      ) : null}
    </section>
  );
}
