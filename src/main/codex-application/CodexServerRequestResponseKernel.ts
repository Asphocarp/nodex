import type { RequestId } from "@nodex/codex-app-server-protocol";
import type { DynamicToolCallResponse } from "@nodex/codex-app-server-protocol/v2/DynamicToolCallResponse";
import { CodexAppServerNoResponse } from "@nodex/effect-codex-app-server/protocol";
import type { CodexApprovalResponse } from "../../shared/codex-approval-response";
import { getCodexApprovalRequestMethod } from "../../shared/codex-approval";
import type {
  CodexCanonicalConversationState,
  CodexCanonicalOptionPickerResponse,
  CodexCanonicalSetupCodexStepResponse,
  CodexCanonicalSetupContextPickerResponse,
} from "../../shared/codex-conversation-state/codex-conversation-state";
import {
  reduceCodexConversationApprovalResponse,
  reduceCodexConversationMcpElicitationResponse,
  reduceCodexConversationOnboardingInputResponse,
  reduceCodexConversationOptionPickerResponse,
  reduceCodexConversationPermissionResponse,
  reduceCodexConversationSetupCodexStepResponse,
  reduceCodexConversationSetupContextPickerResponse,
  reduceCodexConversationUserInputResponse,
  reduceCodexServerRequestSetupCodexStepResponseRawState,
  type CodexServerRequestLifecycleResult,
  type CodexServerRequestRawLifecycleResult,
  type CodexServerRequestRawState,
} from "../../shared/codex-conversation-state/codex-server-request-lifecycle";
import {
  CODEX_APP_TOOL_NAMESPACE,
  hasCodexDynamicToolIdentity,
} from "../../shared/codex-dynamic-tool-identity";
import { normalizeCodexMcpServerElicitationResponse } from "../../shared/codex-mcp-elicitation";
import type {
  CodexMcpServerElicitationAction,
  CodexMcpServerElicitationResponse,
  CodexPermissionRequestResponse,
} from "../../shared/types";
import { buildCodexAppDynamicToolSuccess } from "../codex/codex-app-meta-thread-tools";
import type { CodexPendingServerRequestRuntimeService } from "./CodexPendingServerRequestRuntime";

export interface CodexServerRequestConversationProjection {
  readonly canonicalState: CodexCanonicalConversationState | null;
  readonly rawState: CodexServerRequestRawState;
  readonly streamRole: "follower" | "owner" | null;
}

export type CodexServerRequestResolvedEvent =
  | {
      readonly type: "approval";
      readonly requestId: RequestId;
      readonly decision: CodexApprovalResponse["decision"];
    }
  | { readonly type: "user-input"; readonly requestId: RequestId };

export interface CodexServerRequestResponseKernelProjection {
  readonly read: (threadId: string) => CodexServerRequestConversationProjection | null;
  readonly resolveThreadId: (requestId: RequestId) => string | null;
  readonly applyCanonical: (input: {
    readonly threadId: string;
    readonly before: CodexCanonicalConversationState;
    readonly lifecycle: CodexServerRequestLifecycleResult;
  }) => void;
  readonly applyRaw: (input: {
    readonly threadId: string;
    readonly lifecycle: CodexServerRequestRawLifecycleResult;
  }) => void;
  readonly clearApprovalAttachment: (input: {
    readonly threadId: string;
    readonly turnId: string;
    readonly requestId: RequestId;
  }) => void;
  readonly removeUserInputProjection: (input: {
    readonly threadId: string;
    readonly turnId: string;
    readonly requestId: RequestId;
  }) => void;
  readonly hasRendererOwner: (threadId: string) => boolean;
  readonly broadcast: (input: {
    readonly threadId: string;
    readonly lifecycle: CodexServerRequestRawLifecycleResult | CodexServerRequestLifecycleResult;
    readonly additionalTurnIds?: readonly string[];
  }) => void;
  readonly emitResolved: (event: CodexServerRequestResolvedEvent) => void;
}

export interface CodexApprovalResponseInput {
  readonly threadId?: string;
  readonly requestId: RequestId;
  readonly response: CodexApprovalResponse;
}

export interface CodexUserInputResponseInput {
  readonly threadId?: string;
  readonly requestId: RequestId;
  readonly answers: Readonly<Record<string, readonly string[]>>;
}

export interface CodexMcpElicitationResponseInput {
  readonly threadId?: string;
  readonly requestId: RequestId;
  readonly response: CodexMcpServerElicitationAction | CodexMcpServerElicitationResponse;
}

export interface CodexPermissionResponseInput {
  readonly threadId?: string;
  readonly requestId: RequestId;
  readonly response: CodexPermissionRequestResponse;
}

export interface CodexOptionPickerResponseInput {
  readonly threadId: string;
  readonly requestId: RequestId;
  readonly response: CodexCanonicalOptionPickerResponse;
}

export interface CodexSetupContextPickerResponseInput {
  readonly threadId: string;
  readonly requestId: RequestId;
  readonly response: CodexCanonicalSetupContextPickerResponse;
}

export interface CodexSetupCodexStepResponseInput {
  readonly threadId: string;
  readonly requestId: RequestId;
  readonly response: CodexCanonicalSetupCodexStepResponse;
}

export interface CodexApprovalResponseTarget {
  readonly threadId: string;
  readonly follower: boolean;
}

export interface CodexUserInputResponseResult {
  readonly accepted: boolean;
  readonly observeResponse: boolean;
  readonly threadId: string | null;
}

export interface CodexServerRequestResponseKernel {
  readonly approvalTarget: (
    input: CodexApprovalResponseInput,
  ) => CodexApprovalResponseTarget | null;
  readonly approval: (input: CodexApprovalResponseInput & { readonly threadId: string }) => boolean;
  readonly userInput: (input: CodexUserInputResponseInput) => CodexUserInputResponseResult;
  readonly mcpElicitation: (input: CodexMcpElicitationResponseInput) => boolean;
  readonly permission: (input: CodexPermissionResponseInput) => boolean;
  readonly optionPicker: (input: CodexOptionPickerResponseInput) => boolean;
  readonly setupContextPicker: (input: CodexSetupContextPickerResponseInput) => boolean;
  readonly setupCodexStep: (input: CodexSetupCodexStepResponseInput) => boolean;
  readonly requests: (threadId: string) => CodexServerRequestRawState["requests"];
}

const normalizeUserInputAnswers = (
  answers: Readonly<Record<string, readonly string[]>>,
): {
  readonly protocol: Readonly<Record<string, { readonly answers: readonly string[] }>>;
  readonly transcript: Readonly<Record<string, readonly string[]>>;
} => {
  const protocol: Record<string, { readonly answers: readonly string[] }> = {};
  const transcript: Record<string, readonly string[]> = {};
  for (const [questionId, values] of Object.entries(answers)) {
    const normalized = Array.isArray(values)
      ? values.filter((value): value is string => typeof value === "string")
      : [];
    protocol[questionId] = { answers: normalized };
    transcript[questionId] = normalized;
  }
  return { protocol, transcript };
};

const dynamicToolSuccess = (value: unknown): DynamicToolCallResponse =>
  buildCodexAppDynamicToolSuccess(value);

export const makeCodexServerRequestResponseKernel = (options: {
  readonly inbox: CodexPendingServerRequestRuntimeService;
  readonly projection: CodexServerRequestResponseKernelProjection;
}): CodexServerRequestResponseKernel => {
  const broadcastIfDormant = (
    threadId: string,
    lifecycle: CodexServerRequestRawLifecycleResult | CodexServerRequestLifecycleResult,
    additionalTurnIds?: readonly string[],
  ): void => {
    if (options.projection.hasRendererOwner(threadId)) return;
    options.projection.broadcast({
      threadId,
      lifecycle,
      ...(additionalTurnIds === undefined ? {} : { additionalTurnIds }),
    });
  };

  const approvalTarget = (
    input: CodexApprovalResponseInput,
  ): CodexApprovalResponseTarget | null => {
    const pending = options.inbox.find(
      "approval",
      input.requestId,
      (candidate) =>
        (input.threadId === undefined || candidate.threadId === input.threadId) &&
        candidate.request.kind === input.response.kind,
    );
    if (!pending) return null;
    const projection = options.projection.read(pending.threadId);
    const before = projection?.canonicalState;
    if (!projection || !before) return null;
    const lifecycle = reduceCodexConversationApprovalResponse(
      before,
      input.requestId,
      getCodexApprovalRequestMethod(input.response.kind),
    );
    if (lifecycle.selectedRequests.length === 0) return null;
    return { threadId: pending.threadId, follower: projection.streamRole === "follower" };
  };

  const approval = (input: CodexApprovalResponseInput & { readonly threadId: string }): boolean => {
    const pending = options.inbox.find(
      "approval",
      input.requestId,
      (candidate) =>
        candidate.threadId === input.threadId && candidate.request.kind === input.response.kind,
    );
    if (!pending) return false;
    const projection = options.projection.read(input.threadId);
    const before = projection?.canonicalState;
    if (!projection || !before) return false;
    const lifecycle = reduceCodexConversationApprovalResponse(
      before,
      input.requestId,
      getCodexApprovalRequestMethod(input.response.kind),
    );
    if (lifecycle.selectedRequests.length === 0) return false;
    const selected = options.inbox.takeAll(
      "approval",
      input.requestId,
      (candidate) => candidate.threadId === input.threadId,
    );
    for (const [index, entry] of selected.entries()) {
      options.inbox.complete(
        entry,
        projection.streamRole === "follower" || index > 0
          ? CodexAppServerNoResponse
          : { decision: input.response.decision },
      );
    }
    options.projection.applyCanonical({ threadId: input.threadId, before, lifecycle });
    for (const entry of selected) {
      options.projection.clearApprovalAttachment({
        threadId: entry.threadId,
        turnId: entry.turnId,
        requestId: input.requestId,
      });
    }
    options.inbox.abandonIdentity(input.threadId, input.requestId);
    options.projection.emitResolved({
      type: "approval",
      requestId: input.requestId,
      decision: input.response.decision,
    });
    broadcastIfDormant(
      input.threadId,
      lifecycle,
      selected.map((entry) => entry.turnId),
    );
    return true;
  };

  const userInput = (input: CodexUserInputResponseInput): CodexUserInputResponseResult => {
    const threadId = input.threadId?.trim() || options.projection.resolveThreadId(input.requestId);
    if (!threadId) return { accepted: false, observeResponse: false, threadId: null };
    const projection = options.projection.read(threadId);
    const before = projection?.canonicalState;
    if (!projection || !before) return { accepted: false, observeResponse: false, threadId };
    const normalized = normalizeUserInputAnswers(input.answers);
    const canonicalRequest = before.requests.find((candidate) => candidate.id === input.requestId);
    if (
      canonicalRequest?.method === "item/tool/call" &&
      hasCodexDynamicToolIdentity(canonicalRequest.params, {
        namespace: CODEX_APP_TOOL_NAMESPACE,
        tool: "request_onboarding_input",
      })
    ) {
      const lifecycle = reduceCodexConversationOnboardingInputResponse(before, input.requestId);
      if (lifecycle.selectedRequests.length === 0) {
        return { accepted: false, observeResponse: false, threadId };
      }
      const selected = options.inbox.takeAll(
        "dynamic-tool",
        input.requestId,
        (candidate) => candidate.disposition === "stored" && candidate.threadId === threadId,
      );
      let completed = false;
      for (const entry of selected) {
        const matches = hasCodexDynamicToolIdentity(entry.request.params, {
          namespace: CODEX_APP_TOOL_NAMESPACE,
          tool: "request_onboarding_input",
        });
        options.inbox.complete(
          entry,
          !completed && matches
            ? dynamicToolSuccess({ answers: normalized.protocol })
            : CodexAppServerNoResponse,
        );
        completed ||= matches;
      }
      options.projection.applyCanonical({ threadId, before, lifecycle });
      options.inbox.abandonIdentity(threadId, input.requestId);
      options.projection.emitResolved({ type: "user-input", requestId: input.requestId });
      broadcastIfDormant(threadId, lifecycle);
      return { accepted: true, observeResponse: false, threadId };
    }

    const pending = options.inbox.find(
      "user-input",
      input.requestId,
      (candidate) => candidate.threadId === threadId,
    );
    if (!pending) return { accepted: false, observeResponse: false, threadId };
    const lifecycle = reduceCodexConversationUserInputResponse(
      before,
      input.requestId,
      normalized.transcript,
      { now: () => Date.now() },
    );
    if (lifecycle.selectedRequests.length === 0) {
      return { accepted: false, observeResponse: false, threadId };
    }
    const selected = options.inbox.takeAll(
      "user-input",
      input.requestId,
      (candidate) => candidate.threadId === threadId,
    );
    for (const [index, entry] of selected.entries()) {
      options.inbox.complete(
        entry,
        index === 0 ? { answers: normalized.protocol } : CodexAppServerNoResponse,
      );
    }
    options.projection.applyCanonical({ threadId, before, lifecycle });
    options.projection.removeUserInputProjection({
      threadId,
      turnId: pending.turnId,
      requestId: input.requestId,
    });
    options.inbox.abandonIdentity(threadId, input.requestId);
    options.projection.emitResolved({ type: "user-input", requestId: input.requestId });
    broadcastIfDormant(threadId, lifecycle);
    return { accepted: true, observeResponse: true, threadId };
  };

  const mcpElicitation = (input: CodexMcpElicitationResponseInput): boolean => {
    const pending = options.inbox.find(
      "mcp-elicitation",
      input.requestId,
      (candidate) => input.threadId === undefined || candidate.threadId === input.threadId,
    );
    if (!pending) return false;
    const projection = options.projection.read(pending.threadId);
    const before = projection?.canonicalState;
    if (!before) return false;
    const response = normalizeCodexMcpServerElicitationResponse(input.response);
    const lifecycle = reduceCodexConversationMcpElicitationResponse(
      before,
      input.requestId,
      response,
      { now: () => Date.now() },
    );
    if (lifecycle.selectedRequests.length === 0) return false;
    const turnIds = new Set<string>();
    for (const request of lifecycle.selectedRequests) {
      const entry = options.inbox.takeFirst(
        "mcp-elicitation",
        request.id,
        (candidate) => candidate.threadId === pending.threadId,
      );
      if (!entry) continue;
      options.inbox.complete(entry, response);
      if (entry.turnId) turnIds.add(entry.turnId);
    }
    options.projection.applyCanonical({ threadId: pending.threadId, before, lifecycle });
    for (const requestId of new Set(lifecycle.selectedRequests.map((request) => request.id))) {
      options.inbox.abandonIdentity(pending.threadId, requestId);
    }
    broadcastIfDormant(pending.threadId, lifecycle, [...turnIds]);
    return true;
  };

  const permission = (input: CodexPermissionResponseInput): boolean => {
    const pending = options.inbox.find(
      "permission",
      input.requestId,
      (candidate) => input.threadId === undefined || candidate.threadId === input.threadId,
    );
    if (!pending) return false;
    const projection = options.projection.read(pending.threadId);
    const before = projection?.canonicalState;
    if (!before) return false;
    const lifecycle = reduceCodexConversationPermissionResponse(
      before,
      input.requestId,
      input.response,
      { now: () => Date.now() },
    );
    if (lifecycle.selectedRequests.length === 0) return false;
    const selected = options.inbox.takeAll(
      "permission",
      input.requestId,
      (candidate) => candidate.threadId === pending.threadId,
    );
    for (const [index, entry] of selected.entries()) {
      options.inbox.complete(entry, index === 0 ? input.response : CodexAppServerNoResponse);
    }
    options.projection.applyCanonical({ threadId: pending.threadId, before, lifecycle });
    options.inbox.abandonIdentity(pending.threadId, input.requestId);
    broadcastIfDormant(pending.threadId, lifecycle);
    return true;
  };

  const storedPicker = (
    input:
      | (CodexOptionPickerResponseInput & { readonly kind: "option" })
      | (CodexSetupContextPickerResponseInput & { readonly kind: "context" }),
  ): boolean => {
    const projection = options.projection.read(input.threadId);
    const before = projection?.canonicalState;
    if (!before) return false;
    const lifecycle =
      input.kind === "option"
        ? reduceCodexConversationOptionPickerResponse(before, input.requestId)
        : reduceCodexConversationSetupContextPickerResponse(before, input.requestId);
    const request = lifecycle.selectedRequests[0];
    if (!request) return false;
    const directMethod =
      input.kind === "option"
        ? "item/tool/requestOptionPicker"
        : "item/tool/requestSetupCodexContextPicker";
    const dynamicTool =
      input.kind === "option" ? "request_option_picker" : "setup_codex_context_picker";
    const isDirect = request.method === directMethod;
    const isDynamic =
      request.method === "item/tool/call" &&
      hasCodexDynamicToolIdentity(request.params, {
        namespace: CODEX_APP_TOOL_NAMESPACE,
        tool: dynamicTool,
      });
    let completed = false;
    for (const entry of options.inbox.takeAll(
      "private",
      input.requestId,
      (candidate) => candidate.threadId === input.threadId,
    )) {
      const matches = isDirect && entry.request.method === directMethod;
      options.inbox.complete(
        entry,
        !completed && matches ? input.response : CodexAppServerNoResponse,
      );
      completed ||= matches;
    }
    for (const entry of options.inbox.takeAll(
      "dynamic-tool",
      input.requestId,
      (candidate) => candidate.disposition === "stored" && candidate.threadId === input.threadId,
    )) {
      const matches =
        isDynamic &&
        hasCodexDynamicToolIdentity(entry.request.params, {
          namespace: CODEX_APP_TOOL_NAMESPACE,
          tool: dynamicTool,
        });
      options.inbox.complete(
        entry,
        !completed && matches ? dynamicToolSuccess(input.response) : CodexAppServerNoResponse,
      );
      completed ||= matches;
    }
    options.inbox.abandonIdentity(input.threadId, input.requestId);
    options.projection.applyCanonical({ threadId: input.threadId, before, lifecycle });
    broadcastIfDormant(input.threadId, lifecycle);
    return true;
  };

  const setupCodexStep = (input: CodexSetupCodexStepResponseInput): boolean => {
    const projection = options.projection.read(input.threadId);
    if (!projection) return false;
    const canonical = input.threadId.length > 0 ? projection.canonicalState : null;
    const lifecycle = canonical
      ? reduceCodexConversationSetupCodexStepResponse(canonical, input.requestId, input.response)
      : reduceCodexServerRequestSetupCodexStepResponseRawState(
          projection.rawState,
          input.requestId,
          input.response,
        );
    if (lifecycle.selectedRequests.length === 0) return false;
    const result = (() => {
      switch (input.response.step) {
        case "role":
          return {
            action: input.response.action,
            selectedRoles: [...input.response.selectedRoles],
          };
        case "task":
          return { action: input.response.action, answers: input.response.answers };
        case "context":
          return {
            action: input.response.action,
            selectedSources: [...input.response.selectedSources],
          };
      }
    })();
    let completed = false;
    for (const entry of options.inbox.takeAll(
      "dynamic-tool",
      input.requestId,
      (candidate) => candidate.disposition === "stored" && candidate.threadId === input.threadId,
    )) {
      const matches = hasCodexDynamicToolIdentity(entry.request.params, {
        namespace: CODEX_APP_TOOL_NAMESPACE,
        tool: "setup_codex_step",
      });
      options.inbox.complete(
        entry,
        !completed && matches ? dynamicToolSuccess(result) : CodexAppServerNoResponse,
      );
      completed ||= matches;
    }
    if (canonical) {
      options.projection.applyCanonical({
        threadId: input.threadId,
        before: canonical,
        lifecycle: lifecycle as CodexServerRequestLifecycleResult,
      });
    } else {
      options.projection.applyRaw({
        threadId: input.threadId,
        lifecycle: lifecycle as CodexServerRequestRawLifecycleResult,
      });
    }
    options.inbox.abandonIdentity(input.threadId, input.requestId);
    broadcastIfDormant(input.threadId, lifecycle);
    return true;
  };

  return {
    approvalTarget,
    approval,
    userInput,
    mcpElicitation,
    permission,
    optionPicker: (input) => storedPicker({ ...input, kind: "option" }),
    setupContextPicker: (input) => storedPicker({ ...input, kind: "context" }),
    setupCodexStep,
    requests: (threadId) => options.projection.read(threadId)?.rawState.requests ?? [],
  };
};
