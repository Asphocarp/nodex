import { Settings } from "lucide-react";

export function LeftSidebarFooter({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div className="border-t border-(--sidebar-border) px-(--sidebar-shell-padding-x) py-(--sidebar-row-padding-y)">
      <button
        type="button"
        onClick={onOpenSettings}
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-(--sidebar-foreground-secondary) hover:bg-(--sidebar-accent) hover:text-(--sidebar-foreground)"
        title="Settings"
        aria-label="Settings"
      >
        <Settings className="size-3.5" />
      </button>
    </div>
  );
}
