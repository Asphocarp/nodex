import { describe, expect, test } from "bun:test";
import { NodexTooltipProvider as TooltipProvider } from "@/components/ui/tooltip";
import { act, fireEvent } from "@testing-library/react";
import { render, settleAsyncRender, textContent } from "@/test/dom";
import type { CodexApprovalRequest, CodexConversationItem } from "@/lib/types";
import { buildCodexFileChangeMap } from "../../../../../../shared/codex-file-change";
import { CodexApprovalRequestCard } from "./codex-approval-request-card";

const approvalRequest: CodexApprovalRequest = {
  type: "approval",
  requestId: "approval_1",
  kind: "command",
  projectId: "project_1",
  threadId: "thread_1",
  turnId: "turn_1",
  itemId: "item_1",
  approvalReason: "Do you want to let me restage the thread Storybook files and verify the index state before committing?",
  reason: "Do you want to let me restage the thread Storybook files and verify the index state before committing?",
  command: "git add docs/FRONTEND.md && git status --short",
  cwd: "/workspace/nodex",
  cmd: ["git", "add"],
  proposedExecpolicyAmendment: ["git", "add"],
  createdAt: 1,
};

describe("CodexApprovalRequestCard", () => {
  test("renders the codex approval shell with command preview and skip action", async () => {
    const { container } = render(
      <TooltipProvider>
        <CodexApprovalRequestCard
          request={approvalRequest}
          onRespond={async () => { }}
          onSubmitLocalFollowup={async () => { }}
        />
      </TooltipProvider>,
    );
    await settleAsyncRender();

    const rendered = textContent(container);
    expect(Boolean(rendered.includes("Do you want to let me restage the thread Storybook files and verify the index state before committing?"))).toBeTrue();
    expect(Boolean(rendered.includes("git add docs/FRONTEND.md && git status --short"))).toBeTrue();
    expect(Boolean(rendered.includes("Yes"))).toBeTrue();
    expect(Boolean(rendered.includes("Yes, and don't ask again for commands that start with"))).toBeTrue();
    expect(Boolean(rendered.includes("No, and tell Codex what to do differently"))).toBeTrue();
    expect(Boolean(rendered.includes("Skip"))).toBeTrue();
    expect(Boolean(rendered.includes("Submit"))).toBeTrue();
    expect(container.querySelector(".request-input-panel__inline-freeform")).not.toBeNull();
    expect(container.querySelector(".rounded-2xl.border.backdrop-blur-sm")).not.toBeNull();
  });

  test("renders a background actor inline in the prompt instead of as a separate header", async () => {
    const backgroundApprovalRequest: CodexApprovalRequest = {
      ...approvalRequest,
      approvalReason: undefined,
      reason: undefined,
    };

    const { container } = render(
      <TooltipProvider>
        <CodexApprovalRequestCard
          request={backgroundApprovalRequest}
          actorName="Worker 1"
          approvalQuestionActor={<span className="font-medium">Worker 1</span>}
          onRespond={async () => { }}
          onSubmitLocalFollowup={async () => { }}
        />
      </TooltipProvider>,
    );
    await settleAsyncRender();

    const rendered = textContent(container);
    expect(Boolean(rendered.includes("Do you want Worker 1 to run this command?"))).toBeTrue();
    expect(Boolean(rendered.includes("Worker 1Worker 1"))).toBeFalse();
  });

  test("maps approval submit and skip actions to distinct response paths", async () => {
    const decisions: string[] = [];
    const { container, getByText } = render(
      <TooltipProvider>
        <CodexApprovalRequestCard
          request={approvalRequest}
          onRespond={async (_requestId, decision) => {
            decisions.push(typeof decision === "string" ? decision : JSON.stringify(decision));
          }}
          onSubmitLocalFollowup={async () => { }}
        />
      </TooltipProvider>,
    );
    await settleAsyncRender();
    const form = container.querySelector("form");
    if (!(form instanceof HTMLFormElement)) {
      throw new Error("Expected approval form.");
    }

    await act(async () => {
      fireEvent.click(getByText("Yes"));
      fireEvent.submit(form);
      await settleAsyncRender();
    });

    expect(decisions[0]).toBe("accept");

    await act(async () => {
      fireEvent.click(getByText("Skip"));
      await settleAsyncRender();
    });

    expect(decisions[1]).toBe("decline");
  });

  test("renders file approval previews from the canonical patch row model", async () => {
    const fileRequest: CodexApprovalRequest = {
      ...approvalRequest,
      kind: "file",
      itemId: "patch-1",
      approvalReason: undefined,
      reason: undefined,
      command: undefined,
      cmd: undefined,
      proposedExecpolicyAmendment: undefined,
      grantRoot: "/workspace/nodex",
    };
    const requestItem: CodexConversationItem = {
      threadId: "thread_1",
      turnId: "turn_1",
      itemId: "patch-1",
      entryId: "patch-1",
      type: "file_change",
      kind: "fileChange",
      semanticKind: "patch",
      status: "inProgress",
      approvalRequestId: "approval_1",
      fileChange: {
        paths: ["src/app.ts"],
        changes: buildCodexFileChangeMap([{ type: "add", path: "src/app.ts", content: "export const app = true;\n" }]),
        diffs: [],
      },
      createdAt: 1,
      updatedAt: 1,
    };

    const { container } = render(
      <TooltipProvider>
        <CodexApprovalRequestCard
          request={fileRequest}
          requestItem={requestItem}
          onRespond={async () => { }}
          onSubmitLocalFollowup={async () => { }}
        />
      </TooltipProvider>,
    );
    await settleAsyncRender();

    const rendered = textContent(container);
    expect(Boolean(rendered.includes("Do you want to make these changes?"))).toBeTrue();
    expect(Boolean(rendered.includes("src/app.ts"))).toBeTrue();
    expect(Boolean(rendered.includes("+1 -0"))).toBeTrue();
  });
});
