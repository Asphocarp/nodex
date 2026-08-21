import type { ReactNode } from "react";
import {
  openUserAttachmentImagePreview,
  type ImageEditComposerTarget,
  type ImageEditorFeaturePolicy,
} from "@/features/user-attachment-image-editor";
import type { ComposerImageAttachmentController } from "./use-composer-image-attachments";
import {
  resolveComposerImageAttachmentSize,
  type ComposerImageAttachment,
} from "./composer-image-attachment-model";
import { ComposerImageAttachmentThumbnail } from "./composer-image-attachment-thumbnail";

export interface ComposerImageAttachmentRowProps {
  readonly attachments: readonly ComposerImageAttachment[];
  readonly children?: ReactNode;
  readonly controller: Pick<ComposerImageAttachmentController, "open" | "remove">;
  readonly hasVisibleNonImageAttachments: boolean;
}

function buildPreviewOptions(input: {
  readonly attachment: ComposerImageAttachment;
  readonly attachmentCount: number;
  readonly composerTarget: ImageEditComposerTarget;
  readonly entrypoint: "image_click" | "lightbox_edit_button";
  readonly openInEditor: boolean;
  readonly policy: ImageEditorFeaturePolicy;
  readonly projectId: string | null;
  readonly threadId: string | null;
}) {
  return {
    alt: "User attachment",
    attachmentSrc: input.attachment.src,
    attachmentId: input.attachment.id,
    availableImageCount: input.attachmentCount,
    composerTarget: input.composerTarget,
    ...(input.attachment.src.startsWith("data:image/") ? { dataUrl: input.attachment.src } : {}),
    downloadSrc: input.attachment.src,
    entrypoint: input.entrypoint,
    imageSource: "uploaded" as const,
    ...(input.attachment.materialization
      ? {
          hostId: input.attachment.materialization.hostId,
          ...(input.attachment.materialization.localPath
            ? { localPath: input.attachment.materialization.localPath }
            : {}),
          ...(input.attachment.materialization.managedSource
            ? { managedSource: input.attachment.materialization.managedSource }
            : {}),
        }
      : {}),
    openInEditor: input.openInEditor,
    policy: input.policy,
    previewSrc: input.attachment.src,
    projectId: input.projectId,
    src: input.attachment.src,
    threadId: input.threadId,
    title: "User attachment",
  };
}

export async function openComposerImageAttachment(input: {
  readonly attachment: ComposerImageAttachment;
  readonly attachmentCount: number;
  readonly composerTarget: ImageEditComposerTarget;
  readonly policy: ImageEditorFeaturePolicy;
  readonly projectId: string | null;
  readonly threadId: string | null;
}): Promise<boolean> {
  return openUserAttachmentImagePreview(
    buildPreviewOptions({
      ...input,
      entrypoint: "image_click",
      openInEditor: true,
    }),
  );
}

export function ComposerImageAttachmentRow({
  attachments,
  children,
  controller,
  hasVisibleNonImageAttachments,
}: ComposerImageAttachmentRowProps) {
  const size = resolveComposerImageAttachmentSize(hasVisibleNonImageAttachments);
  const previewEnabled = attachments.length > 0;

  return (
    <div className="hide-scrollbar w-full overflow-x-auto p-px">
      <div className="flex min-w-max items-end gap-2">
        {attachments.map((attachment) => (
          <ComposerImageAttachmentThumbnail
            key={attachment.id}
            attachment={attachment}
            previewEnabled={previewEnabled}
            size={size}
            onOpen={controller.open}
            onRemove={controller.remove}
          />
        ))}
        {children}
      </div>
    </div>
  );
}
