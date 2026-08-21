import { ActivitySpinnerIcon, SidePanelSideChatIcon } from "@/components/shared/icons";
import { NodexButton } from "@/components/ui/button";

export function SideChatLoadingPanel({ title }: { title: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-token-main-surface-primary p-6 select-none">
      <div className="mx-auto flex h-full w-full max-w-2xl flex-col items-center justify-center text-center">
        <div className="relative mb-3 flex size-10 items-center justify-center rounded-xl bg-token-bg-secondary text-token-text-secondary">
          <SidePanelSideChatIcon className="icon-md opacity-40" />
          <ActivitySpinnerIcon
            className="icon-xs text-token-text-secondary"
            containerClassName="absolute"
          />
        </div>
        <div className="text-base font-semibold text-token-text-primary">{title}</div>
      </div>
    </div>
  );
}

export function SideChatExpiredPanel({ onRecreateSideChat }: { onRecreateSideChat: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-token-main-surface-primary p-6 select-none">
      <div className="mx-auto flex h-full w-full max-w-2xl flex-col items-center justify-center text-center">
        <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-token-bg-secondary text-token-text-secondary">
          <SidePanelSideChatIcon className="icon-md" />
        </div>
        <div className="text-base font-semibold text-token-text-primary">Side chat expired</div>
        <div className="mt-1 max-w-sm text-sm text-token-text-secondary">
          This temporary side chat is no longer available; start a new side chat to continue
        </div>
        <NodexButton type="button" size="sm" className="mt-4" onClick={onRecreateSideChat}>
          Start new side chat
        </NodexButton>
      </div>
    </div>
  );
}
