import { describe, expect, mock, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { render, settleAsyncRender } from "../../../test/dom";

let copyResult:
  | { ok: true }
  | { ok: false; message: string } = { ok: true };
let focusCalls = 0;

mock.module("@blocknote/react", () => ({
  useBlockNoteEditor: () => ({
    focus: () => {
      focusCalls += 1;
    },
  }),
  useComponentsContext: () => ({
    FormattingToolbar: {
      Button: ({
        label,
        onClick,
      }: {
        label: string;
        onClick?: () => void;
      }) => (
        <button type="button" onClick={onClick}>
          {label}
        </button>
      ),
    },
  }),
  useDictionary: () => ({
    formatting_toolbar: {},
    generic: {},
    link_toolbar: {},
  }),
  useEditorState: () => ({
    type: "image",
    props: {
      url: "nodex://assets/diagram.png",
    },
  }),
  useExtension: () => ({}),
}));

describe("CopyImageButton", () => {
  test("restores editor focus after a successful native image copy", async () => {
    copyResult = { ok: true };
    focusCalls = 0;

    const { CopyImageButton } = await import("./copy-image-button");
    const notices: string[] = [];
    const view = render(
      <CopyImageButton
        copyImageToClipboardImpl={async () => copyResult}
        onShowNotice={(_type, message) => {
          notices.push(message);
        }}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: "Copy image" }));
    await settleAsyncRender();

    expect(focusCalls).toBe(1);
    expect(notices.length).toBe(0);
  });

  test("shows an editor error notice when native image copy fails", async () => {
    copyResult = { ok: false, message: "Could not load the image file." };
    focusCalls = 0;

    const { CopyImageButton } = await import("./copy-image-button");
    const notices: string[] = [];
    const view = render(
      <CopyImageButton
        copyImageToClipboardImpl={async () => copyResult}
        onShowNotice={(_type, message) => {
          notices.push(message);
        }}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: "Copy image" }));
    await settleAsyncRender();

    expect(focusCalls).toBe(0);
    expect(notices[0]).toBe("Could not load the image file.");
  });
});
