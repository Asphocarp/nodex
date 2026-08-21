import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fireEvent, getByRole, waitFor } from "@testing-library/dom";
import { MotionConfig } from "motion/react";
import type {
  EditableImageDescriptor,
  GeneratedImageDescriptor,
  ImageComment,
  NormalizedUserAttachmentImageEditorOptions,
  PlaygroundTool,
  SingleImageTool,
} from "../model/types";
import { GeneratedImagePlayground } from "./generated-image-playground";
import { GeneratedImageRail } from "./generated-image-rail";
import { ImageZoomViewer } from "./image-zoom-viewer";
import { ImageCommentModeToolbar } from "./image-editor-toolbar";
import { SingleImageEditor } from "./single-image-editor";
import { UserAttachmentImageEditorSurface } from "./user-attachment-image-editor-surface";

const STORY_NOW = Date.UTC(2026, 7, 14, 3, 30);

function imageFixture(
  label: string,
  accent: string,
  shape: string,
  size: { height: number; width: number } = { height: 768, width: 1024 },
): string {
  return `data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#10141a"/><stop offset="1" stop-color="#242a33"/></linearGradient></defs>
      <rect width="${size.width}" height="${size.height}" fill="url(#g)"/>
      <${shape} fill="${accent}" opacity=".88"/>
      <text x="${size.width / 2}" y="${size.height - 78}" text-anchor="middle" fill="white" font-family="sans-serif" font-size="48">${label}</text>
    </svg>
  `)}`;
}

const GENERATED_IMAGES: GeneratedImageDescriptor[] = [
  ["Generated image 1", "#6192f6", "circle cx='330' cy='330' r='210'"],
  ["Generated image 2", "#ec8f5e", "rect x='265' y='150' width='500' height='440' rx='84'"],
  ["Generated image 3", "#72b68c", "path d='M512 110 830 590H194Z'"],
].map(([alt, accent, shape], index) => {
  const src = imageFixture(alt, accent, shape);
  return {
    id: `fixture-${index + 1}`,
    alt,
    attachmentId: `image-playground:fixture-${index + 1}`,
    attachmentSrc: src,
    generatedOrdinal: index + 1,
    groupId: index < 2 ? "turn-one" : "turn-two",
    previewSrc: src,
    referrerPolicy: "no-referrer",
    source: "generated",
    src,
    status: "ready",
    tabTitle: alt,
    turnStartedAtMs: index < 2 ? STORY_NOW - 120_000 : STORY_NOW,
  };
});

const SEEDED_COMMENT: ImageComment = {
  id: "comment-fixture",
  text: "Replace the foreground shape with frosted glass",
  x: 0.36,
  y: 0.42,
};

function uploadedFixture(id: string, alt: string, src: string): EditableImageDescriptor {
  return {
    id,
    alt,
    attachmentSrc: src,
    downloadSrc: src,
    previewSrc: src,
    source: "uploaded",
    src,
  };
}

const PORTRAIT_IMAGE = uploadedFixture(
  "portrait-fixture",
  "Portrait attachment",
  imageFixture("Portrait", "#6192f6", "rect x='154' y='130' width='460' height='680' rx='96'", {
    height: 1024,
    width: 768,
  }),
);
const LANDSCAPE_IMAGE = uploadedFixture(
  "landscape-fixture",
  "Landscape attachment",
  imageFixture("Landscape", "#72b68c", "rect x='250' y='100' width='780' height='420' rx='96'", {
    height: 640,
    width: 1280,
  }),
);
const EMPTY_IMAGE_COMMENTS: readonly ImageComment[] = [];

function SingleStory({
  height = 760,
  image = GENERATED_IMAGES[0]!,
  initialComments = EMPTY_IMAGE_COMMENTS,
  initialTool = "navigate",
  width = 620,
}: {
  height?: number;
  image?: EditableImageDescriptor;
  initialComments?: readonly ImageComment[];
  initialTool?: SingleImageTool;
  width?: number;
}) {
  const [comments, setComments] = useState<readonly ImageComment[]>(initialComments);
  const [tool, setTool] = useState<SingleImageTool>(initialTool);
  return (
    <div
      className="overflow-hidden border border-token-border bg-token-bg-primary"
      style={{ height, width }}
    >
      <SingleImageEditor
        comments={comments}
        entrypoint="image_click"
        image={image}
        onCommentsChange={setComments}
        onSubmitIntent={async () => true}
        onToolChange={setTool}
        tool={tool}
      />
    </div>
  );
}

function FocusedGeneratedStory() {
  const [activeImageId, setActiveImageId] = useState(GENERATED_IMAGES[0]!.id);
  const activeImage =
    GENERATED_IMAGES.find((image) => image.id === activeImageId) ?? GENERATED_IMAGES[0]!;
  return (
    <div className="flex h-[760px] w-[620px] overflow-hidden border border-token-border bg-token-bg-primary">
      <GeneratedImageRail
        activeId={activeImageId}
        images={GENERATED_IMAGES}
        onSelect={(image) => setActiveImageId(image.id)}
      />
      <div className="min-w-0 flex-1">
        <SingleImageEditor
          comments={[]}
          entrypoint="image_click"
          hasImageRail
          image={activeImage}
          onCommentsChange={() => undefined}
          onSubmitIntent={async () => true}
        />
      </div>
    </div>
  );
}

const PENDING_IMAGE: GeneratedImageDescriptor = {
  id: "fixture-pending",
  alt: "Generating image…",
  attachmentSrc: "",
  generatedOrdinal: 4,
  groupId: "turn-three",
  loading: true,
  source: "generated",
  src: "",
  status: "loading",
  turnStartedAtMs: STORY_NOW,
};

const FAILED_IMAGE: GeneratedImageDescriptor = {
  ...PENDING_IMAGE,
  id: "fixture-failed",
  alt: "Generated image 5",
  error: "Image could not be loaded",
  generatedOrdinal: 5,
  loading: false,
  status: "failed",
};

const EMPTY_IMAGE_COMMENTS_BY_ID: Readonly<Record<string, readonly ImageComment[]>> = {};

function PlaygroundStory({
  height = 760,
  images = GENERATED_IMAGES,
  initialComments = EMPTY_IMAGE_COMMENTS_BY_ID,
  initialTool = "navigate",
  initialZoom = 100,
  width = 920,
}: {
  height?: number;
  images?: readonly GeneratedImageDescriptor[];
  initialComments?: Readonly<Record<string, readonly ImageComment[]>>;
  initialTool?: PlaygroundTool;
  initialZoom?: number;
  width?: number;
}) {
  const [activeImageId, setActiveImageId] = useState(GENERATED_IMAGES[0]!.id);
  const [comments, setComments] = useState(initialComments);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set([GENERATED_IMAGES[0]!.id]),
  );
  const [tool, setTool] = useState<PlaygroundTool>(initialTool);
  const [zoom, setZoom] = useState(initialZoom);
  const [activeDraftImageId, setActiveDraftImageId] = useState<string | null>(null);
  return (
    <div
      className="overflow-hidden border border-token-border bg-token-bg-primary"
      style={{ height, width }}
    >
      <GeneratedImagePlayground
        activeDraftImageId={activeDraftImageId}
        activeImageId={activeImageId}
        commentsByImageId={comments}
        groups={[
          { id: "turn-one", images: images.slice(0, 2), turnStartedAtMs: STORY_NOW - 120_000 },
          { id: "turn-two", images: images.slice(2, 3), turnStartedAtMs: STORY_NOW - 60_000 },
          { id: "turn-three", images: images.slice(3), turnStartedAtMs: STORY_NOW },
        ]}
        selectedImageIds={selected}
        tool={tool}
        zoomPercent={zoom}
        onActiveDraftImageIdChange={setActiveDraftImageId}
        onCommentsChange={(imageId, nextComments) => {
          setComments((current) => ({ ...current, [imageId]: nextComments }));
        }}
        onImageActivate={(image) => {
          if (tool === "navigate") {
            setActiveImageId(image.id);
            setSelected(new Set([image.id]));
            return;
          }
          setSelected((current) => {
            const next = new Set(current);
            if (next.has(image.id)) next.delete(image.id);
            else next.add(image.id);
            return next;
          });
        }}
        onResolvedSource={() => undefined}
        onSendComments={() => undefined}
        onToolChange={setTool}
        onZoomPercentChange={setZoom}
      />
    </div>
  );
}

function ZoomedAndPannableStory() {
  const [zoomPercent, setZoomPercent] = useState<number | null>(200);
  return (
    <div className="@container relative flex h-[760px] w-[620px] flex-col overflow-hidden border border-token-border bg-token-bg-primary">
      <ImageZoomViewer
        alt={LANDSCAPE_IMAGE.alt}
        manualZoomPercent={zoomPercent}
        src={LANDSCAPE_IMAGE.src}
        onManualZoomPercentChange={setZoomPercent}
      />
    </div>
  );
}

function LocalFileControlsStory() {
  return (
    <SingleStory
      image={{
        ...PORTRAIT_IMAGE,
        downloadSrc: "/tmp/nodex-synthetic-attachment.png",
        localPath: "/tmp/nodex-synthetic-attachment.png",
      }}
    />
  );
}

function CoachmarkStory() {
  useState(() => {
    window.localStorage.removeItem("has-dismissed-image-canvas-view-coachmark-v1");
    return true;
  });
  const options: NormalizedUserAttachmentImageEditorOptions = {
    availableImageCount: GENERATED_IMAGES.length,
    composerTarget: null,
    entrypoint: "canvas_button",
    generatedImages: GENERATED_IMAGES,
    imageSource: "generated",
    images: GENERATED_IMAGES,
    initialImageId: GENERATED_IMAGES[0]!.id,
    initialPlaygroundTool: "navigate",
    initialView: "single",
    openInEditor: true,
    policy: "edit_button",
    projectId: null,
    threadId: null,
    title: GENERATED_IMAGES[0]!.alt,
    tooltip: GENERATED_IMAGES[0]!.alt,
  };
  return (
    <div className="h-[760px] w-[920px] overflow-hidden border border-token-border bg-token-bg-primary">
      <UserAttachmentImageEditorSurface fullWidth options={options} />
    </div>
  );
}

function AccentSendStatesStory() {
  const states = (
    <div className="flex flex-col items-start gap-4 p-6">
      <ImageCommentModeToolbar
        commentCount={2}
        emptyMessage="Add a comment"
        onCancel={() => undefined}
        onSend={() => undefined}
      />
      <ImageCommentModeToolbar
        commentCount={0}
        emptyMessage="Add a comment"
        onCancel={() => undefined}
        onSend={() => undefined}
      />
      <ImageCommentModeToolbar
        commentCount={2}
        emptyMessage="Add a comment"
        isSubmitting
        onCancel={() => undefined}
        onSend={() => undefined}
      />
    </div>
  );
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-token-border">
      <section aria-label="Light theme" className="bg-token-bg-primary">
        {states}
      </section>
      <section aria-label="Dark theme" className="dark bg-token-bg-primary">
        {states}
      </section>
    </div>
  );
}

async function openNewCommentAtBottomRight(canvasElement: HTMLElement) {
  const surface = getByRole(canvasElement, "button", {
    name: "Image comment surface",
  });
  const rect = surface.getBoundingClientRect();
  fireEvent.click(surface, {
    clientX: rect.right - 2,
    clientY: rect.bottom - 2,
    detail: 1,
  });
  await waitFor(() => {
    const input = canvasElement.querySelector('input[name="image-comment-instruction"]');
    if (!input) throw new Error("Expected the image comment editor");
    return input;
  });
}

async function paintRemoveMask(canvasElement: HTMLElement) {
  const canvas = await waitFor(() => {
    const element = canvasElement.querySelector<HTMLCanvasElement>(
      'canvas[aria-label="Mark areas to remove"]',
    );
    if (!element) throw new Error("Expected the remove-mask canvas");
    return element;
  });
  Object.assign(canvas, {
    hasPointerCapture: () => true,
    releasePointerCapture: () => undefined,
    setPointerCapture: () => undefined,
  });
  const rect = canvas.getBoundingClientRect();
  fireEvent.pointerDown(canvas, {
    button: 0,
    clientX: rect.left + rect.width * 0.3,
    clientY: rect.top + rect.height * 0.35,
    pointerId: 17,
  });
  fireEvent.pointerMove(canvas, {
    clientX: rect.left + rect.width * 0.65,
    clientY: rect.top + rect.height * 0.58,
    pointerId: 17,
  });
  fireEvent.pointerUp(canvas, {
    clientX: rect.left + rect.width * 0.65,
    clientY: rect.top + rect.height * 0.58,
    pointerId: 17,
  });
  await waitFor(() => getByRole(canvasElement, "button", { name: "Undo" }));
}

const meta = {
  title: "Image Editor/Attachment Editor",
  parameters: {
    a11y: { test: "error" },
    layout: "centered",
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const FocusedAttachment: Story = { render: () => <SingleStory /> };
export const FocusedGeneratedRail: Story = { render: () => <FocusedGeneratedStory /> };
export const ToolbarAt449: Story = {
  render: () => <SingleStory width={449} />,
};
export const ToolbarAt450: Story = {
  render: () => <SingleStory width={450} />,
};
export const ToolbarAt451: Story = {
  render: () => <SingleStory width={451} />,
};
export const ToolbarLabelsAt629: Story = {
  render: () => <SingleStory width={629} />,
};
export const ToolbarLabelsAt630: Story = {
  render: () => <SingleStory width={630} />,
};
export const ToolbarLabelsAt631: Story = {
  render: () => <SingleStory width={631} />,
};
export const PortraitAttachment: Story = {
  render: () => <SingleStory image={PORTRAIT_IMAGE} />,
};
export const LandscapeAttachment: Story = {
  render: () => <SingleStory image={LANDSCAPE_IMAGE} />,
};
export const ManualZoomAndPan: Story = {
  render: () => <ZoomedAndPannableStory />,
};
export const LocalFileControls: Story = {
  render: () => <LocalFileControlsStory />,
};
export const CommentMode: Story = {
  render: () => <SingleStory initialComments={[SEEDED_COMMENT]} initialTool="comment" />,
};
export const CommentHoverMarker: Story = {
  render: () => <SingleStory initialTool="comment" />,
  play: async ({ canvasElement }) => {
    const surface = getByRole(canvasElement, "button", {
      name: "Image comment surface",
    });
    const rect = surface.getBoundingClientRect();
    fireEvent.pointerMove(surface, {
      clientX: rect.left + rect.width * 0.78,
      clientY: rect.top + rect.height * 0.28,
    });
    await waitFor(() => {
      const marker = canvasElement.querySelector('[data-testid="image-comment-hover-marker"]');
      if (!marker) throw new Error("Expected the hover marker");
    });
  },
};
export const NewCommentCornerClamp: Story = {
  render: () => <SingleStory initialTool="comment" />,
  play: async ({ canvasElement }) => {
    await openNewCommentAtBottomRight(canvasElement);
  },
};
export const EditExistingComment: Story = {
  render: () => <SingleStory initialComments={[SEEDED_COMMENT]} initialTool="comment" />,
  play: async ({ canvasElement }) => {
    fireEvent.click(
      getByRole(canvasElement, "button", {
        name: "Edit comment 1",
      }),
    );
    await waitFor(() => {
      const editor = canvasElement.querySelector('textarea[name="image-comment-instruction"]');
      if (!editor) throw new Error("Expected the saved-comment editor");
    });
  },
};
export const RemoveMaskMode: Story = {
  render: () => <SingleStory initialTool="remove" />,
};
export const RemoveMaskPainted: Story = {
  render: () => <SingleStory initialTool="remove" />,
  play: async ({ canvasElement }) => {
    await paintRemoveMask(canvasElement);
  },
};
export const RemoveMaskAfterUndo: Story = {
  render: () => <SingleStory initialTool="remove" />,
  play: async ({ canvasElement }) => {
    await paintRemoveMask(canvasElement);
    fireEvent.click(getByRole(canvasElement, "button", { name: "Undo" }));
    await waitFor(() => getByRole(canvasElement, "button", { name: "Redo" }));
  },
};
export const ResizeMenu: Story = {
  render: () => <SingleStory />,
  play: async ({ canvasElement }) => {
    const trigger = getByRole(canvasElement, "button", { name: "Resize" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    await waitFor(() =>
      getByRole(document.body, "menuitem", {
        name: /Square.*1:1/u,
      }),
    );
  },
};
export const LoadingImage: Story = {
  render: () => <SingleStory image={{ ...GENERATED_IMAGES[0]!, loading: true }} />,
};
export const FailedImage: Story = {
  render: () => <SingleStory image={{ ...GENERATED_IMAGES[0]!, error: true }} />,
};
export const GeneratedCanvas: Story = { render: () => <PlaygroundStory /> };
export const GeneratedCanvasNarrow: Story = {
  render: () => <PlaygroundStory width={620} />,
};
export const GeneratedCanvasZoom25: Story = {
  render: () => <PlaygroundStory initialZoom={25} />,
};
export const GeneratedCanvasZoom200: Story = {
  render: () => <PlaygroundStory initialZoom={200} />,
};
export const GeneratedCanvasComments: Story = {
  render: () => (
    <PlaygroundStory
      initialComments={{ [GENERATED_IMAGES[0]!.id]: [SEEDED_COMMENT] }}
      initialTool="comment"
    />
  ),
};
export const GeneratedCanvasSelection: Story = {
  render: () => <PlaygroundStory initialTool="select" />,
};
export const GeneratedCanvasPendingAndFailed: Story = {
  render: () => <PlaygroundStory images={[...GENERATED_IMAGES, PENDING_IMAGE, FAILED_IMAGE]} />,
};
export const CanvasViewCoachmark: Story = {
  render: () => <CoachmarkStory />,
  play: async () => {
    await waitFor(
      () =>
        getByRole(document.body, "dialog", {
          name: "Try Canvas view",
        }),
      { timeout: 5_000 },
    );
  },
};
export const GeneratedCanvasReducedMotion: Story = {
  render: () => (
    <MotionConfig reducedMotion="always">
      <PlaygroundStory images={[...GENERATED_IMAGES, PENDING_IMAGE]} />
    </MotionConfig>
  ),
};
export const GeneratedCanvasDark: Story = {
  globals: { theme: "dark" },
  render: () => <PlaygroundStory />,
};
export const AccentSendStates: Story = {
  render: () => <AccentSendStatesStory />,
  play: async ({ canvasElement }) => {
    const enabled = Array.from(canvasElement.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Send" && !button.disabled,
    );
    enabled?.focus();
  },
};
export const FocusedAttachmentLight: Story = {
  globals: { theme: "light" },
  render: () => <SingleStory />,
};
export const FocusedAttachmentDark: Story = {
  globals: { theme: "dark" },
  render: () => <SingleStory />,
};
export const FocusedAttachmentElectronDark: Story = {
  globals: { theme: "dark" },
  render: () => (
    <div className="dark electron-dark" data-codex-window-type="electron">
      <SingleStory />
    </div>
  ),
};
