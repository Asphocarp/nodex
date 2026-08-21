import { describe, expect, test } from "vite-plus/test";
import { act, fireEvent } from "@testing-library/react";
import type { CodexPermissionRequest, CodexPermissionRequestResponse } from "@/lib/types";
import { render, settleAsyncRender, textContent } from "@/test/dom";
import { CodexPermissionRequestCard } from "./codex-permission-request-card";

const permissionRequest: CodexPermissionRequest = {
  type: "permissionRequest",
  requestId: "permission_1",
  projectId: "project_1",
  threadId: "thread_1",
  turnId: "turn_1",
  itemId: "permission_item_1",
  cwd: "/repo",
  reason: "Need to update generated files.",
  permissions: {
    network: null,
    fileSystem: {
      read: null,
      write: null,
      entries: [
        { path: { type: "path", path: "/repo/generated" }, access: "read" },
        { path: { type: "path", path: "/repo/generated" }, access: "write" },
      ],
    },
  },
  response: null,
  completed: false,
  createdAt: 1,
};

describe("CodexPermissionRequestCard", () => {
  test("renders normalized permission details and responds with turn/session/deny scopes", async () => {
    const responses: CodexPermissionRequestResponse[] = [];
    const { container, getByText, getByLabelText } = render(
      <CodexPermissionRequestCard
        request={permissionRequest}
        onRespond={async (_requestId, response) => {
          responses.push(response);
        }}
      />,
    );
    await settleAsyncRender();

    const renderedText = textContent(container);
    expect(Boolean(renderedText.includes("Allow read and write access to"))).toBe(true);
    expect(Boolean(renderedText.includes("/repo/generated"))).toBe(true);
    expect(Boolean(renderedText.includes("Need to update generated files."))).toBe(true);
    const form = container.querySelector("form");
    if (!form) throw new Error("expected permission form");

    await act(async () => {
      fireEvent.submit(form);
      await settleAsyncRender();
    });
    expect(responses[0]?.scope).toBe("turn");
    expect(JSON.stringify(responses[0]?.permissions)).toBe(
      JSON.stringify({
        fileSystem: permissionRequest.permissions.fileSystem,
      }),
    );

    await act(async () => {
      fireEvent.click(getByLabelText("Yes, allow for this session"));
      await settleAsyncRender();
    });
    await act(async () => {
      fireEvent.submit(form);
      await settleAsyncRender();
    });
    expect(responses[1]?.scope).toBe("session");

    await act(async () => {
      fireEvent.click(getByText("Skip"));
      await settleAsyncRender();
    });
    expect(responses[2]?.scope).toBe("turn");
    expect(JSON.stringify(responses[2]?.permissions)).toBe(JSON.stringify({}));
  });
});
