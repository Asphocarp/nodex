import type { Meta, StoryObj } from "@storybook/react-vite";

import { NodexPopover, NodexPopoverContent, NodexPopoverTrigger } from "@/components/ui/popover";
import { AttachmentPopoverView, type AttachmentProps } from "./attachment-chip";
import { AttachmentResourceIcon } from "../attachment-resource-icon";
import { InlineReferenceVisual } from "../inline-reference-visual";

const attachment = {
  kind: "file",
  mode: "materialized",
  source: "nodex://files/01a04672-d8f3-70d9-80c6-7644b70c186e",
  name: "result.json",
  mimeType: "application/json",
  bytes: 1_024,
  origin: "/Users/asc/repo/nodex/notes.local/artifacts/page-stage-same-group/result.json",
} satisfies AttachmentProps;

const preview = `{
  "status": "passed",
  "scenario": {
    "id": "board/dense",
    "sourcePageKey": "primaryBuildPage",
    "targetPageKey": "boundedProjection"
  },
  "assertions": [
    {
      "name": "Seed exposes two distinct tab groups",
      "expected": "different leaf IDs",
      "actual": {
        "sourceLeafId": "leaf:22d2efdd-a4db-4418-8fd6",
        "targetLeafId": "leaf:685a8b42-39b1-4200-b440"
      }
    }
  ]
}`;

function AttachmentPopoverStory() {
  return (
    <div className="flex min-h-[42rem] items-start justify-center pt-20">
      <div className="flex items-center gap-2 text-lg text-token-text-primary">
        <span>Build result</span>
        <NodexPopover open>
          <NodexPopoverTrigger>
            <InlineReferenceVisual
              as="button"
              type="button"
              className="cursor-interaction"
              label={attachment.name}
              icon={
                <AttachmentResourceIcon
                  kind={attachment.kind}
                  name={attachment.name}
                  mimeType={attachment.mimeType}
                  className="size-full"
                />
              }
              data-attachment-inline-chip="true"
            />
          </NodexPopoverTrigger>
          <NodexPopoverContent side="bottom" align="start" className="w-auto" initialFocus={false}>
            <AttachmentPopoverView
              attachment={attachment}
              preview={{ type: "text", content: preview, truncated: false }}
              previewAvailable
              previewLoading={false}
              isOwnedFile
              stateLabel="Owned by this Page"
              sizeLabel="1.0 KB"
              onPrimaryOpen={async () => undefined}
              onReveal={null}
              onCopyPath={async () => undefined}
              onOpenOriginal={async () => undefined}
            />
          </NodexPopoverContent>
        </NodexPopover>
        <span>is ready.</span>
      </div>
    </div>
  );
}

const meta = {
  title: "Board/Editor/Attachment Popover",
  component: AttachmentPopoverStory,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AttachmentPopoverStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const JsonFile: Story = {};
