import { act } from "react";
import { fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { installWindowApi } from "../../../test/browser-globals";
import { renderWithMaitai, settleAsyncRender } from "../../../test/dom";
import { TestQueryProvider } from "../../../test/query";
import type { EditableImageDescriptor, ImageEditSubmissionIntent } from "../model/types";
import { SingleImageEditor } from "./single-image-editor";

const IMAGE_SRC = "data:image/png;base64,AQID";
const invokeCalls: Array<[string, ...unknown[]]> = [];

function createSubmitIntentSpy() {
  return vi.fn<(intent: ImageEditSubmissionIntent) => Promise<boolean>>(async () => true);
}

beforeEach(() => {
  invokeCalls.length = 0;
  installWindowApi({
    invoke: async (channel: string, ...args: unknown[]) => {
      invokeCalls.push([channel, ...args]);
      return true;
    },
    on: () => () => undefined,
  });
});

function renderEditor(image: EditableImageDescriptor, onSubmitIntent = createSubmitIntentSpy()) {
  return renderWithMaitai(
    <TestQueryProvider>
      <div className="h-[600px] w-[700px]">
        <SingleImageEditor
          comments={[]}
          entrypoint="image_click"
          image={image}
          onCommentsChange={() => undefined}
          onSubmitIntent={onSubmitIntent}
        />
      </div>
    </TestQueryProvider>,
  );
}

describe("SingleImageEditor", () => {
  test("retries a descriptor-level failure against the current source", async () => {
    const view = renderEditor({
      id: "failed-image",
      alt: "Uploaded reference",
      attachmentSrc: IMAGE_SRC,
      error: "Initial resolution failed",
      source: "uploaded",
      src: IMAGE_SRC,
    });
    expect(view.getByText("Image could not be loaded")).toBeTruthy();

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Retry" }));
    });

    await waitFor(() => expect(view.getByRole("img", { name: "Uploaded reference" })).toBeTruthy());
  });

  test("offers the five authored aspect ratios and submits the original image", async () => {
    const onSubmitIntent = createSubmitIntentSpy();
    const image: EditableImageDescriptor = {
      id: "uploaded-image",
      alt: "Uploaded reference",
      attachmentSrc: IMAGE_SRC,
      source: "uploaded",
      src: IMAGE_SRC,
    };
    const view = renderEditor(image, onSubmitIntent);
    expect(view.getAllByRole("button", { name: "Download" })).toHaveLength(1);

    await act(async () => {
      fireEvent.pointerDown(await view.findByRole("button", { name: "Resize" }), {
        button: 0,
        ctrlKey: false,
      });
      await settleAsyncRender();
    });
    expect(view.getByRole("menuitem", { name: /Square.*1:1/u })).toBeTruthy();
    expect(view.getByRole("menuitem", { name: /Portrait.*3:4/u })).toBeTruthy();
    expect(view.getByRole("menuitem", { name: /Story.*9:16/u })).toBeTruthy();
    expect(view.getByRole("menuitem", { name: /Landscape.*4:3/u })).toBeTruthy();
    expect(view.getByRole("menuitem", { name: /Widescreen.*16:9/u })).toBeTruthy();

    await act(async () => {
      fireEvent.click(view.getByRole("menuitem", { name: /Story.*9:16/u }));
    });
    await waitFor(() => expect(onSubmitIntent).toHaveBeenCalledOnce());
    expect(onSubmitIntent.mock.calls[0]?.[0]).toMatchObject({
      attachmentIds: ["uploaded-image"],
      attachments: [{ image, role: "original" }],
      mode: "resize",
      promptRaw: "Make the aspect ratio 9:16",
    });
  });

  test("uses the generated-image loading field without exposing zoom", () => {
    const view = renderEditor({
      id: "pending-generated-image",
      alt: "Generating image…",
      attachmentSrc: "",
      loading: true,
      source: "generated",
      src: "",
    });

    expect(view.getByLabelText("Generating image...")).toBeTruthy();
    expect(view.queryByRole("button", { name: /^Zoom/u })).toBeNull();
    expect((view.getByRole("button", { name: "Download" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  test("opens a trusted local image with its default app and groups secondary actions", async () => {
    const view = renderEditor({
      id: "local-image",
      alt: "Local reference",
      attachmentSrc: IMAGE_SRC,
      downloadSrc: "/tmp/local-reference.png",
      previewSrc: IMAGE_SRC,
      source: "uploaded",
      src: IMAGE_SRC,
    });

    expect(view.queryByRole("button", { name: "Download" })).toBeNull();
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Open image" }));
    });
    expect(invokeCalls).toContainEqual(["shell:open-path-default", "/tmp/local-reference.png"]);

    await act(async () => {
      fireEvent.pointerDown(view.getByRole("button", { name: "Open options" }), {
        button: 0,
        ctrlKey: false,
      });
      await settleAsyncRender();
    });
    await act(async () => {
      fireEvent.click(view.getByRole("menuitem", { name: "Open in folder" }));
    });
    expect(invokeCalls).toContainEqual([
      "shell:open-file-link",
      { path: "/tmp/local-reference.png" },
      "fileManager",
    ]);
  });
});
