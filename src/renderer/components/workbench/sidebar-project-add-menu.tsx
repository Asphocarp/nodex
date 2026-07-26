import { useEffect, useRef, useState } from "react";
import {
  NodexDropdownItem,
  NodexDropdownMenu,
} from "@/components/ui/dropdown";
import { invoke } from "@/lib/api";
import type { Project, ProjectCreateInput } from "@/lib/types";
import {
  CodexSidebarActionButton,
} from "./codex-sidebar";
import { ProjectCreateDialog } from "./project-edit-dialog";
import { CodexProjectAddIcon } from "@/components/shared/icons";

export type SidebarCreateProjectHandler = (input: ProjectCreateInput) => Promise<Project | null>;

export const CODEX_PROJECT_ADD_BUTTON_CLASS = "outline-hidden cursor-interaction relative isolate h-6 w-6 overflow-visible rounded-md !p-1 text-token-foreground opacity-75 hover:opacity-100";
const CODEX_PROJECT_ADD_MENU_ICON_CLASS = "icon-xs opacity-75 group-focus:opacity-100 group-hover:opacity-100";

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? filePath;
}

export function SidebarProjectAddMenu({
  onCreateProject,
  openSetupTick,
}: {
  onCreateProject: SidebarCreateProjectHandler;
  openSetupTick?: number;
}) {
  const [setupOpen, setSetupOpen] = useState(false);
  const [lastOpenSetupTick, setLastOpenSetupTick] = useState(openSetupTick ?? 0);
  const openSetupAfterMenuCloseRef = useRef(false);

  useEffect(() => {
    if (openSetupTick === undefined || openSetupTick === lastOpenSetupTick) return;
    setLastOpenSetupTick(openSetupTick);
    setSetupOpen(true);
  }, [lastOpenSetupTick, openSetupTick]);

  const createFromExistingFolder = async () => {
    const picked = (await invoke("projects:pick-source-roots")) as string[];
    const sourceRoot = picked[0];
    if (!sourceRoot) return;
    await onCreateProject({
      name: basename(sourceRoot),
      sources: picked,
    });
  };

  return (
    <>
      <NodexDropdownMenu
        align="start"
        side="bottom"
        contentWidth="menu"
        onCloseAutoFocus={(event) => {
          if (!openSetupAfterMenuCloseRef.current) return;
          openSetupAfterMenuCloseRef.current = false;
          event.preventDefault();
          setSetupOpen(true);
        }}
        triggerButton={(
          <CodexSidebarActionButton
            label="Add new project"
            className={CODEX_PROJECT_ADD_BUTTON_CLASS}
          >
            <CodexProjectAddIcon />
          </CodexSidebarActionButton>
        )}
      >
        <NodexDropdownItem
          leftSlot={<CodexProjectAddIcon className={CODEX_PROJECT_ADD_MENU_ICON_CLASS} />}
          onSelect={() => {
            openSetupAfterMenuCloseRef.current = true;
          }}
        >
          Start from scratch
        </NodexDropdownItem>
        <NodexDropdownItem
          leftSlot={<CodexProjectAddIcon className={CODEX_PROJECT_ADD_MENU_ICON_CLASS} />}
          onSelect={() => {
            void createFromExistingFolder();
          }}
        >
          Use an existing folder
        </NodexDropdownItem>
      </NodexDropdownMenu>
      <ProjectCreateDialog
        open={setupOpen}
        onOpenChange={setSetupOpen}
        onCreate={async ({ name, sources }) => {
          const fallbackName = sources[0] ? basename(sources[0]) : "Untitled project";
          const project = await onCreateProject({
            name: name.trim() || fallbackName,
            sources,
          });
          if (!project) throw new Error("Could not create project");
        }}
      />
    </>
  );
}
