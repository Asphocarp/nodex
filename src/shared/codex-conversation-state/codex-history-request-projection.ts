import type {
  CodexCommandAction,
  CodexItemView,
  CodexUserInputQuestion,
} from "../types";
import { projectCodexParsedCommand } from "../codex-command-action-projection";
import type { CodexCanonicalServerRequest } from "./codex-conversation-state";

export interface ProjectCodexHistoryRequestsInput {
  readonly threadId: string;
  readonly turnId: string;
  readonly cwd: string | null;
  readonly items: readonly CodexItemView[];
  readonly requests: readonly CodexCanonicalServerRequest[];
  readonly observedAtMs?: number;
}

function requestItemId(prefix: string, requestId: string | number): string {
  return `${prefix}:${String(requestId)}`;
}

function projectUserInputQuestions(
  questions: Extract<
    CodexCanonicalServerRequest,
    { method: "item/tool/requestUserInput" }
  >["params"]["questions"],
): CodexUserInputQuestion[] {
  return questions.map((question) => ({
    id: question.id,
    header: question.header,
    question: question.question,
    isOther: question.isOther === true,
    options: (question.options ?? []).map((option) => ({
      label: option.label,
      description: option.description,
    })),
  }));
}

/** Exact R2 request pass: project pending requests after raw turn items. */
export function projectCodexHistoryRequestViews(
  input: ProjectCodexHistoryRequestsInput,
): CodexItemView[] {
  const items = [...input.items];
  const observedAtMs = input.observedAtMs ?? Date.now();

  for (const request of input.requests) {
    if (!("turnId" in request.params) || request.params.turnId !== input.turnId) continue;

    if (request.method === "item/commandExecution/requestApproval") {
      const actions = request.params.commandActions ?? [];
      const proposedExecpolicyAmendment = request.params.proposedExecpolicyAmendment ?? [];
      const fallbackCommand = request.params.command
        ?? (proposedExecpolicyAmendment.length > 0 ? proposedExecpolicyAmendment.join(" ") : "");
      const commandStrings = actions.map((action) => action.command);
      const command = commandStrings.length > 0 ? commandStrings.join(" && ") : fallbackCommand;
      const parsedAction: CodexCommandAction = actions[0]
        ?? { type: "unknown", command };
      items.push({
        threadId: input.threadId,
        turnId: input.turnId,
        itemId: requestItemId(`command-approval:${request.params.itemId}`, request.id),
        rawItemId: request.params.itemId,
        type: "commandExecutionApproval",
        normalizedKind: "commandExecution",
        semanticKind: "exec",
        status: "inProgress",
        requestId: request.id,
        callId: request.params.itemId,
        command,
        cmd: commandStrings.length > 0 ? commandStrings : [fallbackCommand],
        cwd: input.cwd,
        commandActions: actions,
        parsedCmd: projectCodexParsedCommand(parsedAction, false),
        approvalRequestId: request.id,
        approvalReason: request.params.reason ?? null,
        networkApprovalContext: request.params.networkApprovalContext ?? null,
        proposedExecpolicyAmendment: request.params.proposedExecpolicyAmendment ?? null,
        proposedNetworkPolicyAmendments: request.params.proposedNetworkPolicyAmendments ?? null,
        aggregatedOutput: null,
        exitCode: null,
        rawItem: request,
        createdAt: request.params.startedAtMs,
        updatedAt: request.params.startedAtMs,
      });
      continue;
    }

    if (request.method === "item/fileChange/requestApproval") {
      let targetIndex = -1;
      for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index]!;
        if (item.semanticKind !== "patch" || (item.callId ?? item.itemId) !== request.params.itemId) {
          continue;
        }
        targetIndex = index;
        break;
      }
      if (targetIndex < 0) continue;
      const target = items[targetIndex]!;
      items[targetIndex] = {
        ...target,
        requestId: request.id,
        approvalRequestId: request.id,
        grantRoot: request.params.grantRoot ?? null,
      };
      continue;
    }

    if (request.method === "item/tool/requestUserInput") {
      const completed = (request as { completed?: boolean }).completed === true;
      const questions = projectUserInputQuestions(request.params.questions);
      items.push({
        threadId: input.threadId,
        turnId: input.turnId,
        itemId: requestItemId(`user-input:${request.params.itemId}`, request.id),
        rawItemId: request.params.itemId,
        type: "requestUserInput",
        normalizedKind: "userInputRequest",
        semanticKind: "systemEvent",
        status: completed ? "completed" : "inProgress",
        requestId: request.id,
        callId: request.params.itemId,
        userInputQuestions: questions,
        markdownText: questions.length === 1 ? "Asked 1 question" : `Asked ${questions.length} questions`,
        rawItem: request,
        createdAt: observedAtMs,
        updatedAt: observedAtMs,
      });
      continue;
    }

    if (request.method === "item/permissions/requestApproval") {
      const alreadyProjected = items.some((item) =>
        item.semanticKind === "permissionRequest" && item.requestId === request.id
      );
      if (alreadyProjected) continue;
      items.push({
        threadId: input.threadId,
        turnId: input.turnId,
        itemId: `permission-request-${String(request.id)}`,
        type: "permissionRequest",
        normalizedKind: "systemEvent",
        semanticKind: "permissionRequest",
        status: "inProgress",
        requestId: request.id,
        markdownText: request.params.reason ?? "Permission request",
        rawItem: {
          type: "permissionRequest",
          requestId: request.id,
          turnId: request.params.turnId,
          reason: request.params.reason,
          permissions: request.params.permissions,
          completed: false,
          response: null,
        },
        createdAt: request.params.startedAtMs,
        updatedAt: request.params.startedAtMs,
      });
    }
  }

  return items;
}
