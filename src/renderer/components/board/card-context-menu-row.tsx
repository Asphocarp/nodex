import {
  Copy,
  Image,
  LayoutGrid,
  MessageCirclePlusIcon,
  PanelRightOpen,
  SendHorizontal,
  SlidersHorizontal,
  Star,
  Trash2,
} from "@/components/shared/icons/generic-icons";
import type { CardActionMenuEntry } from "./card-context-menu-model";

function ActionIcon({ entryId }: { entryId: CardActionMenuEntry["id"] }) {
  const className = "size-4 shrink-0";

  switch (entryId) {
    case "favorite":
      return <Star className={className} strokeWidth={1.8} />;
    case "edit-icon":
      return <Image className={className} strokeWidth={1.8} />;
    case "edit-property":
      return <SlidersHorizontal className={className} strokeWidth={1.8} />;
    case "layout":
      return <LayoutGrid className={className} strokeWidth={1.8} />;
    case "property-visibility":
      return <PanelRightOpen className={className} strokeWidth={1.8} />;
    case "open-page":
      return <PanelRightOpen className={className} strokeWidth={1.8} />;
    case "open-in-new-chat":
      return <MessageCirclePlusIcon className={className} strokeWidth={1.8} />;
    case "send-to-chat":
      return <SendHorizontal className={className} strokeWidth={1.8} />;
    case "copy-link":
      return <Copy className={className} strokeWidth={1.8} />;
    case "duplicate":
      return <Copy className={className} strokeWidth={1.8} />;
    case "delete":
      return <Trash2 className={className} strokeWidth={1.8} />;
  }
}

function CardContextMenuMockBadge({ reason }: { reason: string }) {
  return (
    <span
      title={reason}
      className="inline-flex h-4 shrink-0 items-center rounded-sm bg-token-foreground/5 px-1 text-[10px] font-medium uppercase leading-none text-token-description-foreground"
    >
      Mock
    </span>
  );
}

export function CardContextMenuActionRowContent({ entry }: { entry: CardActionMenuEntry }) {
  return (
    <>
      <span className="flex size-5 shrink-0 items-center justify-center text-token-description-foreground">
        <ActionIcon entryId={entry.id} />
      </span>
      <span className="min-w-0 flex-1 truncate">{entry.label}</span>
      {entry.mockReason ? (
        <CardContextMenuMockBadge reason={entry.mockReason} />
      ) : null}
      {entry.shortcut ? (
        <span className="shrink-0 text-xs text-token-description-foreground">
          {entry.shortcut}
        </span>
      ) : null}
    </>
  );
}
