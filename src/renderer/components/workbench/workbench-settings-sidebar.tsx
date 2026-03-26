import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SettingsSectionDefinition, SettingsSectionId } from "./workbench-settings-sections";

interface SettingsSidebarProps {
  activeSectionId: SettingsSectionId;
  sections: SettingsSectionDefinition[];
  onBack: () => void;
  onSelectSection: (sectionId: SettingsSectionId) => void;
}

function SettingsSidebarList({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 gap-0">
      <div className="flex flex-col gap-px">{children}</div>
    </div>
  );
}

function SettingsSidebarItem({
  active,
  disabled = false,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  icon: SettingsSectionDefinition["icon"];
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      className={cn(
        "opacity-75 hover:opacity-100 active:opacity-100 focus-visible:outline-token-border relative px-row-x py-row-y cursor-interaction shrink-0 items-center overflow-hidden rounded-lg text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:opacity-50 disabled:active:opacity-50 gap-2 flex w-full font-normal",
        active ? "bg-token-list-hover-background opacity-100" : "hover:bg-token-list-hover-background",
      )}
    >
      <div
        className={cn(
          "flex min-w-0 items-center text-base gap-2 flex-1",
          active
            ? "text-token-list-active-selection-foreground"
            : "text-token-foreground",
        )}
      >
        <Icon
          className={cn(
            "icon-sm inline-block align-middle",
            active ? "text-token-list-active-selection-icon-foreground" : undefined,
          )}
        />
        <span className="truncate">{label}</span>
      </div>
    </button>
  );
}

export function SettingsSidebar({
  activeSectionId,
  sections,
  onBack,
  onSelectSection,
}: SettingsSidebarProps) {
  return (
    <aside
      className={cn(
        "window-fx-sidebar-surface hidden h-full min-h-0 w-token-sidebar shrink-0 flex-col md:flex",
      )}
    >
      <div className="draggable h-toolbar w-full" />
      <nav className="px-row-x" aria-label="Settings">
        <div className="flex flex-col">
          <button
            type="button"
            onClick={onBack}
            className={cn(
              "group relative mb-2 flex w-full items-center gap-2 rounded-lg px-row-x py-row-y text-base outline-none",
              "cursor-interaction text-token-text-secondary hover:bg-token-list-hover-background",
              "focus-visible:ring-token-focus focus-visible:ring-1 electron:opacity-75",
            )}
          >
            <ChevronLeft className="icon-xs" />
            <span>Back to app</span>
          </button>

          <SettingsSidebarList>
            {sections.map((section) => (
              <SettingsSidebarItem
                key={section.id}
                active={activeSectionId === section.id}
                disabled={section.disabled}
                icon={section.icon}
                label={section.label}
                onClick={() => onSelectSection(section.id)}
              />
            ))}
          </SettingsSidebarList>
        </div>
      </nav>
    </aside>
  );
}
