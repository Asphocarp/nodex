import { useCallback } from "react";
import type { ThreadStageActions, ThreadStageModel } from "../../thread-stage-types";
import { ApprovalRequestCard } from "./request-cards/approval-request-card";
import { PlanImplementationCard } from "./request-cards/plan-implementation-card";
import { UserInputRequestCard } from "./request-cards/user-input-request-card";

const PLAN_IMPLEMENTATION_PROMPT_PREFIX = "PLEASE IMPLEMENT THIS PLAN:";

interface PendingRequestSurfaceProps {
  model: ThreadStageModel;
  actions: ThreadStageActions;
}

type PlanImplementationResponse =
  | { type: "dismiss" }
  | { type: "implement" }
  | { type: "followUp"; prompt: string };

export function PendingRequestSurface({ model, actions }: PendingRequestSurfaceProps) {
  const handleRespondPlanImplementation = useCallback(async (
    request: Extract<NonNullable<ThreadStageModel["pendingRequestSurface"]>["entries"][number], { kind: "request" }>["request"] & { type: "implementPlan" },
    response: PlanImplementationResponse,
  ) => {
    actions.onResolvePlanImplementationRequest(request.threadId, request.turnId);
    if (response.type === "dismiss") return;
    const prompt = response.type === "implement"
      ? `${PLAN_IMPLEMENTATION_PROMPT_PREFIX}\n${request.planContent}`
      : response.prompt;
    const collaborationMode = response.type === "implement" ? "default" : null;

    if (response.type === "implement") {
      actions.onCollaborationModeChange("default");
    }

    await actions.onSendPrompt(
      prompt,
      collaborationMode ? { collaborationMode } : undefined,
    );
  }, [actions]);

  const entries = model.pendingRequestSurface?.entries ?? [];
  const activeRequestCount = model.pendingRequestSurface?.activeRequestCount ?? 0;
  const backgroundRequestCount = model.pendingRequestSurface?.backgroundRequestCount ?? 0;
  const totalRequestCount = activeRequestCount + backgroundRequestCount;

  const renderActionButton = (label: string, onClick: () => void) => (
    <button
      type="button"
      className="inline-flex h-6 items-center rounded-full bg-(--background-tertiary) px-2.5 text-xs font-medium text-(--foreground-secondary) shadow-[0_0_0_1px_var(--border)] hover:opacity-80"
      onClick={onClick}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-3">
      {totalRequestCount > 1 ? (
        <div className="flex items-center justify-between rounded-2xl border border-[color-mix(in_srgb,var(--border)_78%,transparent)] bg-token-input-background/60 px-3 py-2 text-[11px] font-medium tracking-wide text-(--foreground-tertiary) uppercase">
          <span>{activeRequestCount} active request{activeRequestCount === 1 ? "" : "s"}</span>
          <span>{backgroundRequestCount} background request{backgroundRequestCount === 1 ? "" : "s"}</span>
        </div>
      ) : null}
      {entries.map((entry) => {
        const { request, surface, actorName } = entry;
        const surfaceLabel = surface === "backgroundThread"
          ? actorName
            ? `Background request · ${actorName}`
            : "Background request"
          : null;
        if (request.type === "approval") {
          return (
            <div key={request.requestId} className="flex flex-col gap-1.5">
              {surfaceLabel ? (
                <div className="px-1 text-[11px] font-medium tracking-wide text-(--foreground-tertiary) uppercase">
                  {surfaceLabel}
                </div>
              ) : null}
              <ApprovalRequestCard
                request={request}
                onRespond={actions.onRespondApproval}
              />
            </div>
          );
        }

        if (request.type === "userInput") {
          return (
            <div key={request.requestId} className="flex flex-col gap-1.5">
              {surfaceLabel ? (
                <div className="px-1 text-[11px] font-medium tracking-wide text-(--foreground-tertiary) uppercase">
                  {surfaceLabel}
                </div>
              ) : null}
              <UserInputRequestCard
                request={request}
                onRespond={actions.onRespondUserInput}
              />
            </div>
          );
        }

        if (request.type === "mcpServerElicitation") {
          return (
            <div key={request.requestId} className="flex flex-col gap-1.5">
              {surfaceLabel ? (
                <div className="px-1 text-[11px] font-medium tracking-wide text-(--foreground-tertiary) uppercase">
                  {surfaceLabel}
                </div>
              ) : null}
              <div className="flex flex-col gap-2 rounded-2xl border border-[color-mix(in_srgb,var(--accent-blue)_28%,var(--border))] bg-(--blue-bg)/35 px-3 py-2.5 shadow-card-sm">
                <div className="text-[11px] font-medium tracking-wide text-(--foreground-tertiary) uppercase">
                  MCP elicitation
                </div>
                <div className="text-sm text-(--foreground-secondary)">
                  {request.prompt?.trim() || request.title?.trim() || "Additional MCP input is required."}
                </div>
                <div className="flex items-center gap-1.5">
                  {renderActionButton("Cancel", () => {
                    void actions.onRespondMcpElicitation(request.requestId, "cancel");
                  })}
                </div>
              </div>
            </div>
          );
        }

        return (
          <div key={request.requestId} className="flex flex-col gap-1.5">
            {surfaceLabel ? (
              <div className="px-1 text-[11px] font-medium tracking-wide text-(--foreground-tertiary) uppercase">
                {surfaceLabel}
              </div>
            ) : null}
            <PlanImplementationCard
              request={request}
              onRespond={(response: PlanImplementationResponse) => handleRespondPlanImplementation(request, response)}
            />
          </div>
        );
      })}
    </div>
  );
}
