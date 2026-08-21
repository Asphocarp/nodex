import { FolderIcon } from "@/components/shared/icons";
import {
  NodexDialog,
  NodexDialogAction,
  NodexDialogBody,
  NodexDialogContent,
  NodexDialogDescription,
  NodexDialogFooter,
  NodexDialogForm,
  NodexDialogHeader,
  NodexDialogTitle,
} from "@/components/ui/dialog";
import { NodexTooltip } from "@/components/ui/tooltip";
import type { CodexSidebarThreadMoveConfirmationRequired } from "../../../shared/codex-sidebar-thread-move";

export function projectSourceFolderName(sourcePath: string): string {
  const withoutTrailingSeparators = sourcePath.replace(/[\\/]+$/, "");
  return withoutTrailingSeparators.split(/[\\/]/).at(-1) || sourcePath;
}

export function SidebarThreadMoveConfirmationDialog({
  confirmation,
  onClose,
  onContinue,
}: {
  confirmation: CodexSidebarThreadMoveConfirmationRequired;
  onClose: () => void;
  onContinue: () => void;
}) {
  return (
    <NodexDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <NodexDialogContent size="compact">
        <NodexDialogForm
          onSubmit={(event) => {
            event.preventDefault();
            onClose();
            onContinue();
          }}
        >
          <NodexDialogHeader>
            <NodexDialogTitle>Add folders to {confirmation.targetProjectName}?</NodexDialogTitle>
            <NodexDialogDescription>
              All chats in {confirmation.targetProjectName} will gain access to these folders:
            </NodexDialogDescription>
          </NodexDialogHeader>
          <NodexDialogBody className="pt-2">
            <ul className="flex min-w-0 flex-col gap-1 text-base text-token-foreground">
              {confirmation.missingProjectSources.map((sourcePath) => (
                <NodexTooltip key={sourcePath} tooltipContent={sourcePath} side="right">
                  <li className="flex min-w-0 items-center gap-2">
                    <FolderIcon className="icon-xs shrink-0 text-token-text-secondary" />
                    <span className="min-w-0 truncate">{projectSourceFolderName(sourcePath)}</span>
                  </li>
                </NodexTooltip>
              ))}
            </ul>
          </NodexDialogBody>
          <NodexDialogFooter>
            <NodexDialogAction
              className="bg-token-foreground/6 text-token-foreground enabled:hover:bg-token-foreground/10"
              onClick={onClose}
            >
              Cancel
            </NodexDialogAction>
            <NodexDialogAction tone="primary" type="submit">
              Continue
            </NodexDialogAction>
          </NodexDialogFooter>
        </NodexDialogForm>
      </NodexDialogContent>
    </NodexDialog>
  );
}
