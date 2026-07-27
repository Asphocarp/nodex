import {
  NodexDialog,
  NodexDialogAction,
  NodexDialogContent,
  NodexDialogDescription,
  NodexDialogFooter,
  NodexDialogFrame,
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
  blocked: CodexSidebarThreadMoveBlocked;
  onClose: () => void;
}) {
  const missingProjectSources = blocked.missingProjectSources;
  const pathList = formatMissingProjectSourceList(missingProjectSources);
  const folderLabel = missingProjectSources.length === 1 ? "folder" : "folders";

  return (
    <NodexDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <NodexDialogContent size="compact" showCloseButton={false}>
        <NodexDialogFrame>
          <NodexDialogHeader>
            <NodexDialogTitle>
              This task can&apos;t be moved to {blocked.targetProjectName}
            </NodexDialogTitle>
            <NodexDialogDescription>
              The project doesn&apos;t have access to the {pathList} {folderLabel}.
            </NodexDialogDescription>
          </NodexDialogHeader>
          <NodexDialogFooter>
            <NodexDialogAction tone="primary" onClick={onClose}>
              OK
            </NodexDialogAction>
          </NodexDialogFooter>
        </NodexDialogFrame>
      </NodexDialogContent>
    </NodexDialog>
  );
}
