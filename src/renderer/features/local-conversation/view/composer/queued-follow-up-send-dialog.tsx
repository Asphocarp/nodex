import {
  NodexDialog,
  NodexDialogAction,
  NodexDialogContent,
  NodexDialogDescription,
  NodexDialogFooter,
  NodexDialogForm,
  NodexDialogHeader,
  NodexDialogTitle,
} from "@/components/ui/dialog";

export interface QueuedFollowUpSendDialogProps {
  open: boolean;
  queuedMessageCount: number;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onClearQueue: () => void;
  onSendMessage: () => void;
}

export function QueuedFollowUpSendDialog({
  open,
  queuedMessageCount,
  pending,
  onOpenChange,
  onClearQueue,
  onSendMessage,
}: QueuedFollowUpSendDialogProps) {
  const queuedMessageNoun = queuedMessageCount === 1 ? "message" : "messages";

  return (
    <NodexDialog open={open} onOpenChange={onOpenChange}>
      <NodexDialogContent size="compact">
        <NodexDialogForm
          onSubmit={(event) => {
            event.preventDefault();
            if (pending) return;
            onSendMessage();
          }}
        >
          <NodexDialogHeader>
            <NodexDialogTitle>Send message?</NodexDialogTitle>
            <NodexDialogDescription>
              You are about to send a message. Do you want to clear the {queuedMessageCount}{" "}
              {queuedMessageNoun} previously queued?
            </NodexDialogDescription>
          </NodexDialogHeader>
          <NodexDialogFooter>
            <NodexDialogAction autoFocus tone="danger" disabled={pending} onClick={onClearQueue}>
              Clear queue
            </NodexDialogAction>
            <NodexDialogAction tone="primary" type="submit" disabled={pending}>
              Send message
            </NodexDialogAction>
          </NodexDialogFooter>
        </NodexDialogForm>
      </NodexDialogContent>
    </NodexDialog>
  );
}
