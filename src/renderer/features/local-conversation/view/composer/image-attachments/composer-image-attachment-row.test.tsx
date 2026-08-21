import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import {
  registerUserAttachmentImagePreviewOpener,
  type OpenUserAttachmentImagePreviewOptions,
} from "@/features/user-attachment-image-editor";
import type { ComposerImageAttachment } from "./composer-image-attachment-model";
import {
  ComposerImageAttachmentRow,
  openComposerImageAttachment,
} from "./composer-image-attachment-row";

const attachment: ComposerImageAttachment = {
  id: "image-1",
  filename: "diagram.png",
  mimeType: "image/png",
  src: "data:image/png;base64,aW1hZ2U=",
  origin: "paste",
  materialization: null,
  materializationStatus: "failed",
  uploadStatus: "idle",
  generation: 1,
};

let unregisterOpener: (() => void) | null = null;

afterEach(() => {
  unregisterOpener?.();
  unregisterOpener = null;
});

describe("ComposerImageAttachmentRow", () => {
  test("routes an image click through the shared image opener contract", async () => {
    const opened: OpenUserAttachmentImagePreviewOptions[] = [];
    unregisterOpener = registerUserAttachmentImagePreviewOpener(async (options) => {
      opened.push(options);
      return true;
    });

    await expect(
      openComposerImageAttachment({
        attachment,
        attachmentCount: 2,
        composerTarget: {
          channelId: "session:session-1::root",
          placement: "root",
        },
        policy: "image_click",
        projectId: "project-1",
        threadId: "thread-1",
      }),
    ).resolves.toBe(true);

    expect(opened).toEqual([
      {
        alt: "User attachment",
        attachmentSrc: attachment.src,
        attachmentId: "image-1",
        availableImageCount: 2,
        downloadSrc: attachment.src,
        entrypoint: "image_click",
        imageSource: "uploaded",
        openInEditor: true,
        policy: "image_click",
        previewSrc: attachment.src,
        projectId: "project-1",
        src: attachment.src,
        threadId: "thread-1",
        title: "User attachment",
        composerTarget: {
          channelId: "session:session-1::root",
          placement: "root",
        },
        dataUrl: attachment.src,
      },
    ]);
  });

  test("does not mount a Composer-owned lightbox after a thumbnail click", async () => {
    const open = vi.fn();
    const view = render(
      <ComposerImageAttachmentRow
        attachments={[attachment]}
        controller={{ open, remove: vi.fn() }}
        hasVisibleNonImageAttachments={false}
      />,
    );
    const trigger = view.getByRole("button", { name: "diagram.png" });

    await act(async () => {
      fireEvent.click(trigger);
    });

    expect(open).toHaveBeenCalledWith("image-1");
    expect(view.queryByRole("button", { name: "Close image preview" })).toBeNull();
  });
});
