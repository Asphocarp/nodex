import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, ImagesIcon } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "../../../../lib/utils";
import { useTheme } from "../../../../lib/use-theme";
import type { ThreadGeneratedImageGalleryItemModel } from "../../thread-stage-types";
import { calculateGeneratedImageGalleryLayout } from "../../projection/generated-image-gallery-layout";
import { ImagePreviewDialog } from "./user-message-attachments";
import { useConversationImageAsset } from "./use-conversation-image-asset";

const EMPTY_IMAGE_SRC = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
const MAX_IMAGE_REFETCHES = 2;

const DOT_FIELD_BASE_SPACING = 12;
const DOT_FIELD_RADIUS_FACTOR = 0.16;
const DOT_FIELD_MIN_RADIUS = 0.55;
const DOT_FIELD_OPACITY_CUTOFF = 0.03;
const DOT_FIELD_SIZE_FACTOR = 0.78;
const DOT_FIELD_FIRST_WEIGHT = 1.2;
const DOT_FIELD_SECOND_WEIGHT = 0.82;
const DOT_FIELD_OPACITY_POWER = 1.18;
const DOT_FIELD_DURATION_FACTOR = 1.2;
const DOT_FIELD_DURATIONS = {
  offsetX1: 4_500,
  offsetY1: 6_330,
  offsetX2: 5_600,
  offsetY2: 5_750,
  fieldSize1: 3_600,
  fieldSize2: 2_400,
} as const;

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothStep(value: number): number {
  const clamped = clampUnit(value);
  return clamped * clamped * (3 - 2 * clamped);
}

function cubicEaseInOut(value: number): number {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - ((-2 * value + 2) ** 3) / 2;
}

function triangleWave(value: number): number {
  const remainder = value % 1;
  return remainder <= 0.5 ? remainder * 2 : 2 - remainder * 2;
}

function interpolate(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

function randomBetween(start: number, end: number): number {
  return start + Math.random() * (end - start);
}

interface DotFieldGrid {
  readonly dpr: number;
  readonly height: number;
  readonly spacing: number;
  readonly width: number;
  readonly xNormals: Float32Array;
  readonly xPositions: Float32Array;
  readonly yNormals: Float32Array;
  readonly yPositions: Float32Array;
}

function GeneratedImageDotField() {
  const reducedMotion = Boolean(useReducedMotion());
  const { resolved: theme } = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!container || !canvas || !context) return;

    const fullCircle = Math.PI * 2;
    const color = getComputedStyle(container).color || (theme === "dark" ? "white" : "black");
    const randomDuration = (duration: number) => (
      duration * DOT_FIELD_DURATION_FACTOR * randomBetween(1, 1.35)
    );
    const durations = {
      offsetX1: randomDuration(DOT_FIELD_DURATIONS.offsetX1),
      offsetY1: randomDuration(DOT_FIELD_DURATIONS.offsetY1),
      offsetX2: randomDuration(DOT_FIELD_DURATIONS.offsetX2),
      offsetY2: randomDuration(DOT_FIELD_DURATIONS.offsetY2),
      fieldSize1: randomDuration(DOT_FIELD_DURATIONS.fieldSize1),
      fieldSize2: randomDuration(DOT_FIELD_DURATIONS.fieldSize2),
    };
    const phases = {
      offsetX1: Math.random(),
      offsetY1: Math.random(),
      offsetX2: Math.random(),
      offsetY2: Math.random(),
      fieldSize1: Math.random(),
      fieldSize2: Math.random(),
    };
    const bounds = {
      x1Start: randomBetween(0.1, 0.32),
      x1End: randomBetween(0.68, 0.9),
      y1Start: randomBetween(0.1, 0.32),
      y1End: randomBetween(0.68, 0.9),
      x2Start: randomBetween(0.68, 0.9),
      x2End: randomBetween(0.1, 0.32),
      y2Start: randomBetween(0.68, 0.9),
      y2End: randomBetween(0.1, 0.32),
    };
    const sizeRange = {
      firstStart: randomBetween(0.42, 0.52),
      firstEnd: randomBetween(0.62, 0.75),
      secondStart: randomBetween(0.5, 0.62),
      secondEnd: randomBetween(0.74, 0.9),
    };

    let animationFrame: number | null = null;
    let lastFrameAt = 0;
    let startedAt: number | null = null;
    let grid: DotFieldGrid | null = null;
    let gridInvalidated = true;

    const rebuildGrid = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(0, Math.floor(rect.width));
      const height = Math.max(0, Math.floor(rect.height));
      if (width === 0 || height === 0) {
        grid = null;
        gridInvalidated = false;
        return;
      }

      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const canvasWidth = Math.floor(width * dpr);
      const canvasHeight = Math.floor(height * dpr);
      if (canvas.width !== canvasWidth || canvas.height !== canvasHeight) {
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
      }

      const spacing = Math.max(1, DOT_FIELD_BASE_SPACING / dpr);
      const columnCount = Math.max(1, Math.floor(width / spacing));
      const rowCount = Math.max(1, Math.floor(height / spacing));
      const startX = (width - (columnCount - 1) * spacing) * 0.5;
      const startY = (height - (rowCount - 1) * spacing) * 0.5;
      const xPositions = new Float32Array(columnCount);
      const yPositions = new Float32Array(rowCount);
      const xNormals = new Float32Array(columnCount);
      const yNormals = new Float32Array(rowCount);
      for (let index = 0; index < columnCount; index += 1) {
        xPositions[index] = startX + index * spacing;
        xNormals[index] = columnCount === 1 ? 0.5 : index / (columnCount - 1);
      }
      for (let index = 0; index < rowCount; index += 1) {
        yPositions[index] = startY + index * spacing;
        yNormals[index] = rowCount === 1 ? 0.5 : index / (rowCount - 1);
      }
      grid = {
        dpr,
        height,
        spacing,
        width,
        xNormals,
        xPositions,
        yNormals,
        yPositions,
      };
      gridInvalidated = false;
    };

    const draw = (timestamp: number) => {
      if (!reducedMotion && lastFrameAt !== 0 && timestamp - lastFrameAt < 1_000 / 30) {
        animationFrame = requestAnimationFrame(draw);
        return;
      }
      lastFrameAt = timestamp;
      startedAt ??= timestamp;
      if (gridInvalidated || !grid) rebuildGrid();
      if (!grid) {
        animationFrame = null;
        return;
      }

      const elapsed = timestamp - startedAt;
      const phase = (duration: number, offset: number) => (
        triangleWave(elapsed / duration + offset)
      );
      const firstX = interpolate(
        bounds.x1Start,
        bounds.x1End,
        cubicEaseInOut(phase(durations.offsetX1, phases.offsetX1)),
      );
      const firstY = interpolate(
        bounds.y1Start,
        bounds.y1End,
        smoothStep(phase(durations.offsetY1, phases.offsetY1)),
      );
      const secondX = interpolate(
        bounds.x2Start,
        bounds.x2End,
        cubicEaseInOut(phase(durations.offsetX2, phases.offsetX2)),
      );
      const secondY = interpolate(
        bounds.y2Start,
        bounds.y2End,
        smoothStep(phase(durations.offsetY2, phases.offsetY2)),
      );
      const firstSize = DOT_FIELD_SIZE_FACTOR * interpolate(
        sizeRange.firstStart,
        sizeRange.firstEnd,
        smoothStep(phase(durations.fieldSize1, phases.fieldSize1)),
      );
      const secondSize = DOT_FIELD_SIZE_FACTOR * interpolate(
        sizeRange.secondStart,
        sizeRange.secondEnd,
        smoothStep(phase(durations.fieldSize2, phases.fieldSize2)),
      );

      context.save();
      context.setTransform(grid.dpr, 0, 0, grid.dpr, 0, 0);
      context.clearRect(0, 0, grid.width, grid.height);
      context.fillStyle = color;
      const radius = Math.max(
        DOT_FIELD_MIN_RADIUS,
        grid.spacing * 0.5 * DOT_FIELD_RADIUS_FACTOR,
      );
      for (let rowIndex = 0; rowIndex < grid.yPositions.length; rowIndex += 1) {
        const y = grid.yPositions[rowIndex] ?? 0;
        const normalizedY = grid.yNormals[rowIndex] ?? 0;
        for (let columnIndex = 0; columnIndex < grid.xPositions.length; columnIndex += 1) {
          const x = grid.xPositions[columnIndex] ?? 0;
          const normalizedX = grid.xNormals[columnIndex] ?? 0;
          const firstDistance = Math.hypot(normalizedX - firstX, normalizedY - firstY);
          const secondDistance = Math.hypot(normalizedX - secondX, normalizedY - secondY);
          const firstField = 1 - smoothStep(firstDistance / firstSize);
          const secondField = 1 - smoothStep(secondDistance / secondSize);
          const opacity = clampUnit(
            firstField * DOT_FIELD_FIRST_WEIGHT + secondField * DOT_FIELD_SECOND_WEIGHT,
          ) ** DOT_FIELD_OPACITY_POWER;
          if (opacity <= DOT_FIELD_OPACITY_CUTOFF) continue;
          context.globalAlpha = opacity;
          context.beginPath();
          context.moveTo(x + radius, y);
          context.arc(x, y, radius, 0, fullCircle);
          context.fill();
        }
      }
      context.restore();
      animationFrame = reducedMotion ? null : requestAnimationFrame(draw);
    };

    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          gridInvalidated = true;
          animationFrame ??= requestAnimationFrame(draw);
        });
    resizeObserver?.observe(container);
    animationFrame = requestAnimationFrame(draw);
    return () => {
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
    };
  }, [reducedMotion, theme]);

  return (
    <motion.div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden"
      initial={false}
      animate={{ opacity: reducedMotion ? 0.38 : [0.38, 0.56, 0.38] }}
      transition={reducedMotion ? { duration: 0 } : {
        duration: 1.75,
        ease: "easeInOut",
        repeat: Infinity,
      }}
      style={{
        maskImage: "linear-gradient(to top left, transparent 0%, black 30% 70%, transparent 100%)",
        WebkitMaskImage: "linear-gradient(to top left, transparent 0%, black 30% 70%, transparent 100%)",
      }}
    >
      <canvas ref={canvasRef} aria-hidden="true" className="block h-full w-full" />
    </motion.div>
  );
}

function GeneratedImagePlaceholder({ hidden }: { hidden: boolean }) {
  return (
    <div
      aria-busy="true"
      aria-hidden={hidden || undefined}
      aria-label={hidden ? undefined : "Generating image..."}
      className="electron-dark:text-white/70 relative aspect-square w-full max-w-[400px] overflow-clip rounded-[36px] bg-token-bg-tertiary/70 text-token-text-secondary dark:text-white/70"
    >
      <GeneratedImageDotField />
    </div>
  );
}

function GalleryControls({
  canGoNext,
  canGoPrevious,
  onNext,
  onPrevious,
  overflowCount,
}: {
  canGoNext: boolean;
  canGoPrevious: boolean;
  onNext: () => void;
  onPrevious: () => void;
  overflowCount: number;
}) {
  return (
    <>
      <div className="pointer-events-none absolute right-2 bottom-2 inline-flex h-6 items-center gap-0.5 rounded-full bg-black/45 pr-2 pl-1.5 text-sm font-medium leading-none text-white shadow-sm backdrop-blur-[12px] group-focus-within/generated-image-gallery-controls:opacity-0 group-hover/generated-image-gallery-controls:opacity-0">
        <ImagesIcon className="size-4 shrink-0" aria-hidden="true" />
        <span className="tabular-nums">{overflowCount}</span>
      </div>
      <div className="pointer-events-none absolute right-2 bottom-2 z-10 flex items-center gap-1 opacity-0 group-focus-within/generated-image-gallery-controls:pointer-events-auto group-focus-within/generated-image-gallery-controls:opacity-100 group-hover/generated-image-gallery-controls:pointer-events-auto group-hover/generated-image-gallery-controls:opacity-100">
        <button
          type="button"
          aria-label="Previous images"
          disabled={!canGoPrevious}
          className="flex size-6 cursor-interaction items-center justify-center rounded-full bg-black/45 p-0 text-white shadow-sm backdrop-blur-[12px] enabled:hover:bg-black/60 disabled:bg-black/45 disabled:text-white/45 disabled:opacity-100"
          onClick={onPrevious}
          onPointerUp={(event) => event.currentTarget.blur()}
        >
          <ChevronLeftIcon className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Next images"
          disabled={!canGoNext}
          className="flex size-6 cursor-interaction items-center justify-center rounded-full bg-black/45 p-0 text-white shadow-sm backdrop-blur-[12px] enabled:hover:bg-black/60 disabled:bg-black/45 disabled:text-white/45 disabled:opacity-100"
          onClick={onNext}
          onPointerUp={(event) => event.currentTarget.blur()}
        >
          <ChevronRightIcon className="size-4" aria-hidden="true" />
        </button>
      </div>
    </>
  );
}

function GeneratedImageTile({
  heightPx,
  hidden,
  image,
  imageNumber,
  onAspectRatioChange,
  onOpen,
  square,
  widthPx,
}: {
  heightPx: number;
  hidden: boolean;
  image: ThreadGeneratedImageGalleryItemModel;
  imageNumber: number;
  onAspectRatioChange: (ratio: number) => void;
  onOpen: () => void;
  square: boolean;
  widthPx: number;
}) {
  const previewAsset = useConversationImageAsset(image.previewSrc ?? image.src, {
    shouldLoadFileDataUrl: false,
  });
  const fullAsset = useConversationImageAsset(image.src ?? image.previewSrc ?? "", {
    shouldLoadFileDataUrl: false,
  });
  const [failure, setFailure] = useState<{ count: number; src: string } | null>(null);
  const previewSrc = previewAsset.previewSrc;
  const failureCount = failure?.src === previewSrc ? failure.count : 0;
  const alt = `Generated image ${imageNumber}`;

  if (!previewSrc) {
    return (
      <div
        className="generated-image-placeholder-pulse shrink-0 rounded-[16px]"
        style={{ height: heightPx, width: widthPx }}
      />
    );
  }

  return (
    <button
      type="button"
      aria-hidden={hidden || undefined}
      aria-label={alt}
      data-testid="generated-image-preview"
      tabIndex={hidden ? -1 : undefined}
      className="shrink-0 cursor-interaction overflow-hidden rounded-[16px] bg-token-main-surface-primary focus-visible:ring-1 focus-visible:ring-token-focus-border focus-visible:outline-none"
      style={{ height: heightPx, width: widthPx }}
      onClick={onOpen}
    >
      <img
        src={previewSrc}
        alt={alt}
        draggable
        className={cn(
          "block h-full",
          square ? "w-full object-cover" : "w-auto object-contain",
        )}
        referrerPolicy="no-referrer"
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "copy";
          event.dataTransfer.setData("application/x-codex-image", JSON.stringify({
            filename: `generated-image-${imageNumber}`,
            src: fullAsset.dataUrl
              ?? fullAsset.downloadSrc
              ?? fullAsset.previewSrc
              ?? previewSrc,
          }));
        }}
        onLoad={(event) => {
          setFailure(null);
          const { naturalHeight, naturalWidth } = event.currentTarget;
          if (naturalHeight <= 0 || naturalWidth <= 0) return;
          onAspectRatioChange(naturalWidth / naturalHeight);
        }}
        onError={() => {
          if (failureCount >= MAX_IMAGE_REFETCHES) return;
          setFailure({ count: failureCount + 1, src: previewSrc });
          previewAsset.refetch();
        }}
      />
    </button>
  );
}

function GeneratedImagePreview({
  image,
  imageNumber,
  onNextImage,
  onOpenChange,
  onPreviousImage,
}: {
  image: ThreadGeneratedImageGalleryItemModel;
  imageNumber: number;
  onNextImage?: () => void;
  onOpenChange: (open: boolean) => void;
  onPreviousImage?: () => void;
}) {
  const fullAsset = useConversationImageAsset(image.src ?? image.previewSrc ?? "", {
    shouldLoadFileDataUrl: true,
  });
  const alt = `Generated image ${imageNumber}`;

  return (
    <ImagePreviewDialog
      open
      onOpenChange={onOpenChange}
      src={fullAsset.previewSrc ?? EMPTY_IMAGE_SRC}
      downloadSrc={fullAsset.downloadSrc ?? EMPTY_IMAGE_SRC}
      alt={alt}
      onPreviousImage={onPreviousImage}
      onNextImage={onNextImage}
    />
  );
}

export function GeneratedImageGallery({
  images,
  pendingImageCount,
}: {
  images: readonly ThreadGeneratedImageGalleryItemModel[];
  pendingImageCount: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidthPx, setContainerWidthPx] = useState<number | null>(null);
  const [aspectRatios, setAspectRatios] = useState<Readonly<Record<string, number>>>({});
  const [startIndex, setStartIndex] = useState(0);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const updateWidth = (width: number) => {
      const nextWidth = Math.floor(width);
      setContainerWidthPx((current) => current === nextWidth ? current : nextWidth);
    };
    updateWidth(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) updateWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const ratios = [
    ...images.map((image) => aspectRatios[image.id] ?? 1),
    ...Array.from({ length: pendingImageCount }, () => 1),
  ];
  const layout = calculateGeneratedImageGalleryLayout({
    containerWidthPx,
    imageAspectRatios: ratios,
    minimumSlotCount: pendingImageCount > 0 ? 4 : 0,
  });
  const resolvedStartIndex = Math.min(startIndex, layout.maxStartIndex);
  const translateX = layout.aspectRatio === "square"
    ? resolvedStartIndex * (layout.heightPx + 8)
    : 0;
  const activePreviewImage = previewIndex === null
    ? null
    : images[previewIndex] ?? null;
  const handlePreviewOpenChange = useCallback((open: boolean) => {
    if (!open) setPreviewIndex(null);
  }, []);

  return (
    <>
      <div
        ref={containerRef}
        data-testid="generated-image-gallery"
        className={cn(
          "group/generated-image-gallery-controls relative overflow-hidden",
          images.length === 1 && pendingImageCount === 0 && "w-full max-w-[400px]",
        )}
        style={{ height: layout.heightPx }}
      >
        <div
          className="flex gap-2 transition-transform duration-basic ease-out motion-reduce:transition-none"
          style={{
            height: layout.heightPx,
            transform: translateX === 0 ? undefined : `translateX(-${translateX}px)`,
          }}
        >
          {images.map((image, index) => {
            const hidden = layout.aspectRatio === "square"
              && (index < resolvedStartIndex || index >= resolvedStartIndex + layout.visibleCount);
            const width = layout.aspectRatio === "square"
              ? layout.heightPx
              : (aspectRatios[image.id] ?? 1) * layout.heightPx;
            return (
              <div key={image.id} className="relative shrink-0">
                <GeneratedImageTile
                  heightPx={layout.heightPx}
                  hidden={hidden}
                  image={image}
                  imageNumber={index + 1}
                  square={layout.aspectRatio === "square"}
                  widthPx={width}
                  onAspectRatioChange={(ratio) => {
                    setAspectRatios((current) => current[image.id] === ratio
                      ? current
                      : { ...current, [image.id]: ratio });
                  }}
                  onOpen={() => setPreviewIndex(index)}
                />
              </div>
            );
          })}
          {Array.from({ length: pendingImageCount }, (_, index) => {
            const absoluteIndex = images.length + index;
            const hidden = layout.aspectRatio === "square"
              && (
                absoluteIndex < resolvedStartIndex
                || absoluteIndex >= resolvedStartIndex + layout.visibleCount
              );
            return (
              <div
                key={`pending-image-${index}`}
                className="relative shrink-0"
                aria-hidden={hidden || undefined}
                style={{ height: layout.heightPx, width: layout.heightPx }}
              >
                <GeneratedImagePlaceholder hidden={hidden} />
              </div>
            );
          })}
        </div>
        {layout.aspectRatio === "square" && layout.overflowCount > 0 ? (
          <GalleryControls
            overflowCount={layout.overflowCount}
            canGoPrevious={resolvedStartIndex > 0}
            canGoNext={resolvedStartIndex < layout.maxStartIndex}
            onPrevious={() => setStartIndex(Math.max(resolvedStartIndex - 1, 0))}
            onNext={() => setStartIndex(Math.min(resolvedStartIndex + 1, layout.maxStartIndex))}
          />
        ) : null}
      </div>
      {activePreviewImage ? (
        <GeneratedImagePreview
          image={activePreviewImage}
          imageNumber={(previewIndex ?? 0) + 1}
          onOpenChange={handlePreviewOpenChange}
          onPreviousImage={previewIndex !== null && previewIndex > 0
            ? () => setPreviewIndex(previewIndex - 1)
            : undefined}
          onNextImage={previewIndex !== null && previewIndex < images.length - 1
            ? () => setPreviewIndex(previewIndex + 1)
            : undefined}
        />
      ) : null}
    </>
  );
}
