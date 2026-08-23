import type { RequestId } from "@nodex/codex-app-server-protocol";
import type { CodexApprovalResponse } from "../../shared/codex-approval-response";
import type {
  CodexCanonicalOptionPickerResponse,
  CodexCanonicalSetupCodexStepResponse,
  CodexCanonicalSetupContextPickerResponse,
} from "../../shared/codex-conversation-state/codex-conversation-state";
import type {
  CodexMcpServerElicitationAction,
  CodexMcpServerElicitationResponse,
  CodexPermissionRequestResponse,
} from "../../shared/types";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import type { CodexServerRequestResponsesService } from "./CodexServerRequestResponses";

export interface CodexServerRequestResponsesPromiseAdapter {
  readonly approval: (input: {
    readonly threadId?: string;
    readonly requestId: RequestId;
    readonly response: CodexApprovalResponse;
  }) => Promise<boolean>;
  readonly userInput: (input: {
    readonly threadId?: string;
    readonly requestId: RequestId;
    readonly answers: Readonly<Record<string, readonly string[]>>;
  }) => Promise<boolean>;
  readonly mcpElicitation: (input: {
    readonly threadId?: string;
    readonly requestId: RequestId;
    readonly response: CodexMcpServerElicitationAction | CodexMcpServerElicitationResponse;
  }) => Promise<boolean>;
  readonly permission: (input: {
    readonly threadId?: string;
    readonly requestId: RequestId;
    readonly response: CodexPermissionRequestResponse;
  }) => Promise<boolean>;
  readonly optionPicker: (input: {
    readonly threadId: string;
    readonly requestId: RequestId;
    readonly response: CodexCanonicalOptionPickerResponse;
  }) => Promise<boolean>;
  readonly setupContextPicker: (input: {
    readonly threadId: string;
    readonly requestId: RequestId;
    readonly response: CodexCanonicalSetupContextPickerResponse;
  }) => Promise<boolean>;
  readonly setupCodexStep: (input: {
    readonly threadId: string;
    readonly requestId: RequestId;
    readonly response: CodexCanonicalSetupCodexStepResponse;
  }) => Promise<boolean>;
  readonly declineAll: (threadId: string) => Promise<void>;
}

export const makeCodexServerRequestResponsesPromiseAdapter = (
  runtime: CodexServerRequestResponsesService,
  callbacks: Pick<ScopedCallbackRuntime["Service"], "runPromise">,
): CodexServerRequestResponsesPromiseAdapter => ({
  approval: (input) => callbacks.runPromise(runtime.approval(input)),
  userInput: (input) => callbacks.runPromise(runtime.userInput(input)),
  mcpElicitation: (input) => callbacks.runPromise(runtime.mcpElicitation(input)),
  permission: (input) => callbacks.runPromise(runtime.permission(input)),
  optionPicker: (input) => callbacks.runPromise(runtime.optionPicker(input)),
  setupContextPicker: (input) => callbacks.runPromise(runtime.setupContextPicker(input)),
  setupCodexStep: (input) => callbacks.runPromise(runtime.setupCodexStep(input)),
  declineAll: (threadId) => callbacks.runPromise(runtime.declineAll(threadId)),
});
