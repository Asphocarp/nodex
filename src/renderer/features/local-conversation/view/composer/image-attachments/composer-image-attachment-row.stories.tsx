import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ComposerImageAttachmentRow } from "./composer-image-attachment-row";
import type { ComposerImageAttachment } from "./composer-image-attachment-model";

const coralImage = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='320'%3E%3Cdefs%3E%3ClinearGradient id='g' x2='1' y2='1'%3E%3Cstop stop-color='%23ffb37b'/%3E%3Cstop offset='1' stop-color='%23ca4b5f'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='320' height='320' fill='url(%23g)'/%3E%3Ccircle cx='220' cy='95' r='52' fill='%23ffe5ba' fill-opacity='.9'/%3E%3Cpath d='M0 270L85 165l58 67 48-46 129 134H0z' fill='%23532855' fill-opacity='.72'/%3E%3C/svg%3E";
const blueImage = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='320'%3E%3Crect width='320' height='320' fill='%231d3557'/%3E%3Cpath d='M0 225L72 138l51 57 72-98 125 156v67H0z' fill='%234a8ca8'/%3E%3Ccircle cx='246' cy='67' r='34' fill='%23f1faee'/%3E%3C/svg%3E";

function image(
  id: string,
  filename: string,
  src: string,
  uploadProgress?: number,
): ComposerImageAttachment {
  return {
    id,
    filename,
    mimeType: "image/png",
    src,
    origin: "paste",
    materialization: null,
    materializationStatus: "pending",
    uploadStatus: uploadProgress === undefined ? "idle" : "uploading",
    ...(uploadProgress === undefined ? {} : { uploadProgress }),
    generation: 1,
  };
}

function AttachmentRowStory({
  imageCount = 2,
  mixed = false,
  uploading = false,
  width = 460,
}: {
  readonly imageCount?: number;
  readonly mixed?: boolean;
  readonly uploading?: boolean;
  readonly width?: number;
}) {
  const [attachments, setAttachments] = useState<readonly ComposerImageAttachment[]>(
    () => Array.from({ length: imageCount }, (_, index) => image(
      `image-${index + 1}`,
      index === 0 ? "sunset.png" : `mountains-${index + 1}.png`,
      index % 2 === 0 ? coralImage : blueImage,
      uploading && index === 0 ? 58 : undefined,
    )),
  );
  return (
    <div
      className="rounded-[20px] border border-token-border bg-token-input-background p-2"
      style={{ width }}
    >
      <ComposerImageAttachmentRow
        attachments={attachments}
        controller={{
          open: () => undefined,
          remove: (id) => setAttachments((current) => current.filter(
            (attachment) => attachment.id !== id,
          )),
        }}
        hasVisibleNonImageAttachments={mixed}
      >
        {mixed ? (
          <button
            type="button"
            className="inline-flex max-w-48 items-center gap-1 rounded-full bg-token-foreground/5 px-2 py-1 text-xs text-token-foreground"
          >
            brief.md
          </button>
        ) : null}
      </ComposerImageAttachmentRow>
      <div className="px-2 pt-2 pb-1 text-sm text-token-description-foreground">
        Ask anything
      </div>
    </div>
  );
}

const meta = {
  title: "Composer/Image attachments/Codex shell",
  parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const SingleImage: Story = {
  render: () => <AttachmentRowStory imageCount={1} />,
};

export const MultipleImages: Story = {
  render: () => <AttachmentRowStory />,
};

export const MixedAttachments: Story = {
  render: () => <AttachmentRowStory mixed />,
};

export const Uploading: Story = {
  render: () => <AttachmentRowStory uploading />,
};

export const HorizontalOverflow: Story = {
  render: () => <AttachmentRowStory imageCount={7} width={300} />,
};
