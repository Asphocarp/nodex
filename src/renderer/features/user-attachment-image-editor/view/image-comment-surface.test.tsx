import { act, useState } from "react";
import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { render } from "../../../test/dom";
import type { ImageComment } from "../model/types";
import { ImageCommentSurface } from "./image-comment-surface";

const IMAGE_SRC = "data:image/png;base64,AQID";

function CommentHarness({
  onCommentsChange,
}: {
  onCommentsChange: (comments: readonly ImageComment[]) => void;
}) {
  const [comments, setComments] = useState<readonly ImageComment[]>([]);
  const updateComments = (next: readonly ImageComment[]) => {
    setComments(next);
    onCommentsChange(next);
  };
  return (
    <div className="h-[300px] w-[400px]">
      <ImageCommentSurface
        alt="Example"
        comments={comments}
        src={IMAGE_SRC}
        onDeleteComment={(commentId) => {
          updateComments(comments.filter((comment) => comment.id !== commentId));
        }}
        onSubmitComment={(comment) => {
          const existing = comments.some((candidate) => candidate.id === comment.id);
          updateComments(existing
            ? comments.map((candidate) => candidate.id === comment.id ? comment : candidate)
            : [...comments, comment]);
        }}
      />
    </div>
  );
}

function installSurfaceGeometry(target: HTMLElement): void {
  const surface = target.parentElement;
  const parent = surface?.parentElement;
  if (!surface || !parent) throw new Error("Comment surface geometry is unavailable");
  Object.defineProperties(surface, {
    clientHeight: { configurable: true, value: 300 },
    clientWidth: { configurable: true, value: 400 },
    offsetLeft: { configurable: true, value: 0 },
    offsetTop: { configurable: true, value: 0 },
  });
  Object.defineProperties(parent, {
    clientHeight: { configurable: true, value: 300 },
    clientWidth: { configurable: true, value: 400 },
  });
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
    bottom: 300,
    height: 300,
    left: 0,
    right: 400,
    toJSON: () => ({}),
    top: 0,
    width: 400,
    x: 0,
    y: 0,
  });
}

describe("ImageCommentSurface", () => {
  test("creates, edits, and deletes normalized positional comments", async () => {
    const onCommentsChange = vi.fn();
    const view = render(<CommentHarness onCommentsChange={onCommentsChange} />);
    const target = view.getByRole("button", { name: "Image comment surface" });
    installSurfaceGeometry(target);

    await act(async () => {
      fireEvent.click(target, { clientX: 100, clientY: 225, detail: 1 });
    });
    const input = view.getByPlaceholderText("Add a comment…");
    await act(async () => {
      fireEvent.change(input, { target: { value: "Remove the label" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });

    await waitFor(() => expect(onCommentsChange).toHaveBeenCalledTimes(1));
    const created = onCommentsChange.mock.calls[0]?.[0]?.[0] as ImageComment;
    expect(created).toMatchObject({ text: "Remove the label", x: 0.25, y: 0.75 });

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Edit comment 1" }));
    });
    const textarea = view.getByRole("textbox");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "Replace the label" } });
      fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    });

    await waitFor(() => expect(onCommentsChange).toHaveBeenCalledTimes(2));
    expect(onCommentsChange.mock.calls[1]?.[0]?.[0]).toMatchObject({
      id: created.id,
      text: "Replace the label",
      x: 0.25,
      y: 0.75,
    });

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Edit comment 1" }));
    });
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Delete comment" }));
    });
    await waitFor(() => expect(view.queryByRole("button", { name: "Edit comment 1" }))
      .toBeNull());
    expect(onCommentsChange.mock.calls[2]?.[0]).toEqual([]);
  });

  test("cancels an unsaved draft with Escape", async () => {
    const view = render(<CommentHarness onCommentsChange={() => undefined} />);
    const target = view.getByRole("button", { name: "Image comment surface" });
    installSurfaceGeometry(target);

    await act(async () => {
      fireEvent.click(target, { clientX: 200, clientY: 150, detail: 1 });
    });
    await act(async () => {
      fireEvent.keyDown(view.getByPlaceholderText("Add a comment…"), { key: "Escape" });
    });

    await waitFor(() => expect(view.queryByPlaceholderText("Add a comment…"))
      .toBeNull());
  });
});
