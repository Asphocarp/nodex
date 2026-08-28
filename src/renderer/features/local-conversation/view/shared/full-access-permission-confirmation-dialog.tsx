import {
  PermissionFilesCapabilityIcon,
  PermissionFullAccessWarningIcon,
  PermissionInternetCapabilityIcon,
  PermissionTerminalCapabilityIcon,
} from "@/components/shared/icons";
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
import type { ModalCloseProps } from "@/lib/modal-registry";

export const PERMISSIONS_LEARN_MORE_URL =
  "https://developers.openai.com/codex/concepts/sandboxing#how-you-control-it";

const FULL_ACCESS_CAPABILITIES = [
  {
    title: "Files and folders",
    description: "Read, create, modify, upload, or delete files anywhere on this computer",
    icon: PermissionFilesCapabilityIcon,
  },
  {
    title: "Terminal commands",
    description: "Run commands, install software, and change system settings",
    icon: PermissionTerminalCapabilityIcon,
  },
  {
    title: "Internet and connected apps",
    description: "Access websites, send data, and use enabled plugins",
    icon: PermissionInternetCapabilityIcon,
  },
] as const;

function openPermissionsDocumentation(): void {
  window.open(PERMISSIONS_LEARN_MORE_URL, "_blank", "noopener,noreferrer");
}

export function FullAccessPermissionConfirmationDialog({
  onClose,
  onConfirm,
}: ModalCloseProps & {
  readonly onConfirm: () => void;
}) {
  return (
    <NodexDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <NodexDialogContent showCloseButton={false}>
        <NodexDialogForm
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm();
            onClose();
          }}
        >
          <NodexDialogHeader>
            <NodexDialogTitle className="flex items-center gap-2">
              <PermissionFullAccessWarningIcon />
              <span>Turn on Full Access?</span>
            </NodexDialogTitle>
          </NodexDialogHeader>

          <NodexDialogBody>
            <NodexDialogDescription className="text-pretty">
              Nodex will be able to run commands, use the internet, and create and edit files
              anywhere on this computer without your permission. This includes but is not limited
              to:
            </NodexDialogDescription>
          </NodexDialogBody>

          <NodexDialogBody>
            <div className="rounded-2xl bg-token-foreground/5 px-4 py-3">
              {FULL_ACCESS_CAPABILITIES.map((capability) => {
                const CapabilityIcon = capability.icon;

                return (
                  <div
                    key={capability.title}
                    className="flex items-center gap-3 border-b-[0.5px] border-token-border/70 py-2 first:pt-0 last:border-b-0 last:pb-0"
                  >
                    <CapabilityIcon />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-token-foreground">
                        {capability.title}
                      </div>
                      <div className="text-xs text-token-description-foreground">
                        {capability.description}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </NodexDialogBody>

          <NodexDialogBody className="text-token-description-foreground">
            <p className="text-pretty">
              This comes with risks like loss or exposure of sensitive data and prompt injection.
              You can turn this off.{" "}
              <button
                type="button"
                className="cursor-interaction text-token-text-link-foreground"
                onClick={openPermissionsDocumentation}
              >
                Learn more
              </button>
            </p>
          </NodexDialogBody>

          <NodexDialogFooter>
            <NodexDialogAction autoFocus className="rounded-full px-5 py-2" onClick={onClose}>
              Cancel
            </NodexDialogAction>
            <NodexDialogAction type="submit" tone="danger" className="rounded-full px-5 py-2">
              <PermissionFullAccessWarningIcon className="icon-xs" />
              Confirm
            </NodexDialogAction>
          </NodexDialogFooter>
        </NodexDialogForm>
      </NodexDialogContent>
    </NodexDialog>
  );
}
