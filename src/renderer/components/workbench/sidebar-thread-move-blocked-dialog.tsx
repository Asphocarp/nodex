import { NodexButton } from "@/components/ui/button";
import {
  NodexDialog,
  NodexDialogContent,
  NodexDialogDescription,
  NodexDialogFooter,
  NodexDialogHeader,
  NodexDialogTitle,
} from "@/components/ui/dialog";
import type { CodexSidebarThreadMoveBlocked } from "../../../shared/codex-sidebar-thread-move";

const englishListFormatter = new Intl.ListFormat("en", {
  style: "long",
  type: "conjunction",
});

export function formatMissingProjectSourceList(paths: readonly string[]): string {
  return englishListFormatter.format(paths);
}

export function SidebarThreadMoveBlockedDialog({
  blocked,
  onClose,
}: {
  blocked: CodexSidebarThreadMoveBlocked | null;
  onClose: () => void;
}) {
  const missingProjectSources = blocked?.missingProjectSources ?? [];
  const pathList = formatMissingProjectSourceList(missingProjectSources);
  const folderLabel = missingProjectSources.length === 1 ? "folder" : "folders";

  return (
    <NodexDialog
      open={blocked !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <NodexDialogContent className="max-w-[420px] rounded-2xl" showCloseButton={false}>
        <NodexDialogHeader className="gap-2 text-left">
          <NodexDialogTitle className="text-base">
            This task can&apos;t be moved to {blocked?.targetProjectName ?? "this project"}
          </NodexDialogTitle>
          <NodexDialogDescription>
            The project doesn&apos;t have access to the {pathList} {folderLabel}.
          </NodexDialogDescription>
        </NodexDialogHeader>
        <NodexDialogFooter className="sm:justify-end">
          <NodexButton type="button" onClick={onClose}>
            OK
          </NodexButton>
        </NodexDialogFooter>
      </NodexDialogContent>
    </NodexDialog>
  );
}
