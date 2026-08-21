import { act, fireEvent } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { NodexAgentAuthorizationRequest, NodexAgentAuthorizationResponse } from "@/lib/types";
import { NodexTooltipProvider as TooltipProvider } from "@/components/ui/tooltip";
import { render, settleAsyncRender } from "@/test/dom";
import { NodexAgentAuthorizationRequestCard } from "./nodex-agent-authorization-request-card";

function request(effect: NodexAgentAuthorizationRequest["effect"]): NodexAgentAuthorizationRequest {
  return {
    type: "nodexAgentAuthorization",
    requestId: `nodex-auth-${effect}`,
    projectId: "project-1",
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "call-1",
    tool: "edit_document",
    effect,
    preview: {
      title: "Edit “Launch brief”",
      summary: "Append three Blocks to the Page document.",
      details: [
        { label: "Document", value: "Launch brief" },
        { label: "Method", value: "nfm.insert" },
      ],
      nfmPreview: "## Rollout\n\n- Alpha\n- Beta",
    },
    createdAt: 1,
  };
}

describe("NodexAgentAuthorizationRequestCard", () => {
  test("shows the semantic prepared change and supports a task-scoped ordinary grant", async () => {
    const responses: NodexAgentAuthorizationResponse[] = [];
    const { container, getByLabelText, getByText } = render(
      <TooltipProvider>
        <NodexAgentAuthorizationRequestCard
          request={request("write")}
          onRespond={async (_requestId, response) => {
            responses.push(response);
          }}
        />
      </TooltipProvider>,
    );
    await settleAsyncRender();

    expect(getByText("Append three Blocks to the Page document.")).toBeTruthy();
    expect(getByText("Launch brief")).toBeTruthy();
    expect(getByText(/## Rollout/)).toBeTruthy();
    const form = container.querySelector("form");
    if (!form) throw new Error("expected Nodex authorization form");

    await act(async () => {
      fireEvent.click(getByLabelText("Allow for this task"));
      fireEvent.submit(form);
      await settleAsyncRender();
    });

    expect(responses).toEqual([{ decision: "allow_task" }]);
  });

  test("offers persistent resource grants for destructive edits", async () => {
    const responses: NodexAgentAuthorizationResponse[] = [];
    const { container, getByLabelText } = render(
      <TooltipProvider>
        <NodexAgentAuthorizationRequestCard
          request={request("destructive")}
          onRespond={async (_requestId, response) => {
            responses.push(response);
          }}
        />
      </TooltipProvider>,
    );
    await settleAsyncRender();

    expect(getByLabelText("Allow for this task")).toBeTruthy();
    expect(getByLabelText("Allow for this project")).toBeTruthy();
    const form = container.querySelector("form");
    if (!form) throw new Error("expected Nodex authorization form");
    await act(async () => {
      fireEvent.click(getByLabelText("Allow for this project"));
      fireEvent.submit(form);
      await settleAsyncRender();
    });
    expect(responses).toEqual([{ decision: "allow_project" }]);
  });

  test("offers task-scoped access for reads", async () => {
    const responses: NodexAgentAuthorizationResponse[] = [];
    const { container, getByLabelText } = render(
      <TooltipProvider>
        <NodexAgentAuthorizationRequestCard
          request={request("read")}
          onRespond={async (_requestId, response) => {
            responses.push(response);
          }}
        />
      </TooltipProvider>,
    );
    await settleAsyncRender();
    const form = container.querySelector("form");
    if (!form) throw new Error("expected Nodex authorization form");
    await act(async () => {
      fireEvent.click(getByLabelText("Allow for this task"));
      fireEvent.submit(form);
      await settleAsyncRender();
    });
    expect(responses).toEqual([{ decision: "allow_task" }]);
  });

  test("renders the v3 Nested Markdown preview without changing the compact surface", async () => {
    const v3Request: NodexAgentAuthorizationRequest = {
      ...request("write"),
      tool: "create_pages",
      preview: {
        ...request("write").preview,
        nfmPreview: undefined,
        markdownPreview: "▶ Rollout\n\t- [ ] Alpha",
      },
    };
    const { getByText } = render(
      <TooltipProvider>
        <NodexAgentAuthorizationRequestCard request={v3Request} onRespond={async () => {}} />
      </TooltipProvider>,
    );
    await settleAsyncRender();

    expect(getByText(/▶ Rollout/)).toBeTruthy();
    expect(getByText(/Alpha/)).toBeTruthy();
  });
});
