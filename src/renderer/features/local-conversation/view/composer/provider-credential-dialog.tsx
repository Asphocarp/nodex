import { useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import type { ModalCloseProps } from "@/lib/modal-registry";
import type {
  AgentProviderCredentialMutationResult,
  AgentProviderOption,
} from "../../../../../shared/agent-runtime";

export interface ProviderCredentialDialogProps extends ModalCloseProps {
  readonly provider: AgentProviderOption;
  readonly onCredentialSet: (
    providerId: string,
    apiKey: string,
  ) => Promise<AgentProviderCredentialMutationResult>;
  readonly onCredentialDelete?: (
    providerId: string,
  ) => Promise<AgentProviderCredentialMutationResult>;
  readonly onConfigured?: () => void | Promise<void>;
}

function isReadyStatus(result: AgentProviderCredentialMutationResult): boolean {
  return result.status === "ready"
    || result.status === "inherited"
    || result.status === "runtimeManaged";
}

export function ProviderCredentialDialog({
  provider,
  onCredentialSet,
  onCredentialDelete,
  onConfigured,
  onClose,
}: ProviderCredentialDialogProps) {
  const [apiKey, setApiKey] = useState("");
  const [pendingAction, setPendingAction] = useState<"save" | "remove" | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const canRemove = provider.credentialStatus === "ready" && onCredentialDelete !== undefined;

  useEffect(() => {
    setApiKey("");
    setPendingAction(null);
    setErrorMessage(null);
  }, [provider.id]);

  return (
    <NodexDialog
      open
      onOpenChange={(open) => {
        if (!open && pendingAction === null) onClose();
      }}
    >
      <NodexDialogContent size="narrow">
        <NodexDialogForm
          onSubmit={(event) => {
            event.preventDefault();
            const normalizedApiKey = apiKey.trim();
            if (!normalizedApiKey || pendingAction !== null) return;

            setPendingAction("save");
            setErrorMessage(null);
            void onCredentialSet(provider.id, normalizedApiKey)
              .then(async (result) => {
                if (!isReadyStatus(result)) {
                  throw new Error(`Credential setup returned ${result.status}`);
                }
                await onConfigured?.();
                onClose();
              })
              .catch((error) => {
                setErrorMessage(error instanceof Error ? error.message : String(error));
              })
              .finally(() => setPendingAction(null));
          }}
        >
          <NodexDialogHeader>
            <NodexDialogTitle>{provider.displayName} credential</NodexDialogTitle>
            <NodexDialogDescription>
              Enter an API key to use this provider.
            </NodexDialogDescription>
          </NodexDialogHeader>

          <NodexDialogBody className="gap-1.5">
            <label
              htmlFor="agent-provider-api-key"
              className="semantic-text-secondary text-sm"
            >
              API key
            </label>
            <Input
              id="agent-provider-api-key"
              type="password"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              placeholder={provider.credentialEnvKey ?? "API key"}
              disabled={pendingAction !== null}
              onChange={(event) => setApiKey(event.target.value)}
            />
            <span className="text-tertiary text-xs">
              Saved in your operating system keychain.
            </span>
            {errorMessage ? (
              <span role="alert" className="text-danger text-xs">
                {errorMessage}
              </span>
            ) : null}
          </NodexDialogBody>

          <NodexDialogFooter className={canRemove ? "justify-between" : undefined}>
            {canRemove ? (
              <NodexDialogAction
                tone="danger"
                disabled={pendingAction !== null}
                onClick={() => {
                  if (!onCredentialDelete || pendingAction !== null) return;
                  setPendingAction("remove");
                  setErrorMessage(null);
                  void onCredentialDelete(provider.id)
                    .then(() => onClose())
                    .catch((error) => {
                      setErrorMessage(error instanceof Error ? error.message : String(error));
                    })
                    .finally(() => setPendingAction(null));
                }}
              >
                {pendingAction === "remove" ? "Removing…" : "Remove"}
              </NodexDialogAction>
            ) : null}
            <div className="flex items-center gap-3">
              <NodexDialogAction
                disabled={pendingAction !== null}
                onClick={onClose}
              >
                Cancel
              </NodexDialogAction>
              <NodexDialogAction
                type="submit"
                tone="primary"
                disabled={pendingAction !== null || apiKey.trim().length === 0}
              >
                {pendingAction === "save" ? "Saving…" : "Save"}
              </NodexDialogAction>
            </div>
          </NodexDialogFooter>
        </NodexDialogForm>
      </NodexDialogContent>
    </NodexDialog>
  );
}
