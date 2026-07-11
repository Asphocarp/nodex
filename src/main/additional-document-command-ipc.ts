import type { AdditionalDocumentCommandResult } from "../shared/additional-document-commands";
import {
  additionalDocumentCommandFailure,
  additionalDocumentCommandTransportFailure,
  bindAdditionalDocumentCommandToProject,
  type PublicAdditionalDocumentCommandRequest,
  type TrustedAdditionalDocumentCommandIdentity,
} from "../shared/additional-document-command-transport";

export const ADDITIONAL_DOCUMENT_COMMAND_IPC_CHANNEL =
  "block-documents:command" as const;

export type AdditionalDocumentCommandIpcHandler = (
  event: unknown,
  projectId: string,
  request: PublicAdditionalDocumentCommandRequest,
) => Promise<AdditionalDocumentCommandResult>;

export interface AdditionalDocumentCommandIpcDependencies {
  readonly registerHandle: (
    channel: typeof ADDITIONAL_DOCUMENT_COMMAND_IPC_CHANNEL,
    listener: AdditionalDocumentCommandIpcHandler,
  ) => void;
  readonly resolveTrustedIdentity: (
    event: unknown,
  ) => TrustedAdditionalDocumentCommandIdentity | null;
  readonly applyCommand: (
    request: PublicAdditionalDocumentCommandRequest,
  ) => Promise<AdditionalDocumentCommandResult>;
}

export const registerAdditionalDocumentCommandIpcHandler = (
  dependencies: AdditionalDocumentCommandIpcDependencies,
): void => {
  dependencies.registerHandle(
    ADDITIONAL_DOCUMENT_COMMAND_IPC_CHANNEL,
    async (event, projectId, rawRequest) => {
      const identity = dependencies.resolveTrustedIdentity(event);
      if (!identity) {
        return {
          ok: false,
          error: additionalDocumentCommandFailure(
            "invalid_request",
            "Additional Document commands are restricted to a trusted application window",
          ),
        };
      }

      const bound = bindAdditionalDocumentCommandToProject(
        rawRequest,
        projectId,
        identity,
      );
      if (!bound.ok) return bound;

      try {
        return await dependencies.applyCommand(bound.value);
      } catch (error) {
        return additionalDocumentCommandTransportFailure(bound.value, error);
      }
    },
  );
};
