import { useCallback, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";

export type TextCollapseState = "uncollapsible" | "collapsed" | "expanded";

export interface PreWrappedLineMeasurement {
  lineCount: number;
  heightPx: number;
}

interface PreWrappedLineMeasurementInput {
  text: string;
  font: string;
  lineHeightPx: number;
  maxWidthPx: number;
  measureTextWidth?: (value: string) => number | null;
}

interface TextMeasurementMetrics {
  font: string;
  lineHeightPx: number;
  maxWidthPx: number;
}

interface UseMeasuredTextCollapseInput {
  text: string;
  collapsedLineCount: number;
  fallbackFontSizePx: number;
}

const LINE_HEIGHT_FALLBACK_MULTIPLIER = 1.5;

function normalizePreWrappedText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function createCanvasTextMeasurer(font: string): ((value: string) => number | null) | null {
  if (typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.font = font;
  return (value: string) => {
    const width = context.measureText(value).width;
    return Number.isFinite(width) ? width : null;
  };
}

function resolveFontSizePx(style: CSSStyleDeclaration, fallbackFontSizePx: number): number {
  const fontSizePx = Number.parseFloat(style.fontSize);
  if (Number.isFinite(fontSizePx) && fontSizePx > 0) return fontSizePx;
  return fallbackFontSizePx;
}

function resolveLineHeightPx(style: CSSStyleDeclaration, fontSizePx: number): number {
  const lineHeightPx = Number.parseFloat(style.lineHeight);
  if (Number.isFinite(lineHeightPx) && lineHeightPx > 0) return lineHeightPx;
  return fontSizePx * LINE_HEIGHT_FALLBACK_MULTIPLIER;
}

function buildCanvasFont(style: CSSStyleDeclaration, fontSizePx: number): string {
  return [
    style.fontStyle || "normal",
    style.fontVariant || "normal",
    style.fontWeight || "400",
    `${fontSizePx}px`,
    style.fontFamily || "sans-serif",
  ].join(" ");
}

function readTextMeasurementMetrics(
  element: HTMLElement | null,
  fallbackFontSizePx: number,
): TextMeasurementMetrics | null {
  if (!element || element.clientWidth <= 0) return null;

  const ownerWindow = element.ownerDocument.defaultView ?? window;
  const style = ownerWindow.getComputedStyle(element);
  const fontSizePx = resolveFontSizePx(style, fallbackFontSizePx);

  return {
    font: buildCanvasFont(style, fontSizePx),
    lineHeightPx: resolveLineHeightPx(style, fontSizePx),
    maxWidthPx: element.clientWidth,
  };
}

function areMetricsEqual(left: TextMeasurementMetrics | null, right: TextMeasurementMetrics | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.font === right.font
    && left.lineHeightPx === right.lineHeightPx
    && left.maxWidthPx === right.maxWidthPx
  );
}

function measureWrappedVisualLineCount(
  segment: string,
  maxWidthPx: number,
  measureTextWidth: (value: string) => number | null,
): number | null {
  if (segment.length === 0) return 1;

  let lineCount = 1;
  let currentLine = "";

  for (const character of Array.from(segment)) {
    const candidateLine = `${currentLine}${character}`;
    const candidateWidth = measureTextWidth(candidateLine);
    if (candidateWidth === null) return null;

    if (currentLine.length === 0 || candidateWidth <= maxWidthPx) {
      currentLine = candidateLine;
      continue;
    }

    lineCount += 1;
    currentLine = character;
  }

  return lineCount;
}

export function measurePreWrappedLineCount({
  text,
  font,
  lineHeightPx,
  maxWidthPx,
  measureTextWidth,
}: PreWrappedLineMeasurementInput): PreWrappedLineMeasurement | null {
  if (maxWidthPx <= 0 || lineHeightPx <= 0) return null;

  const resolvedMeasureTextWidth = measureTextWidth ?? createCanvasTextMeasurer(font);
  if (!resolvedMeasureTextWidth) return null;

  const normalizedText = normalizePreWrappedText(text);
  const segments = normalizedText.split("\n");
  let lineCount = 0;

  for (const segment of segments) {
    const segmentLineCount = measureWrappedVisualLineCount(segment, maxWidthPx, resolvedMeasureTextWidth);
    if (segmentLineCount === null) return null;
    lineCount += segmentLineCount;
  }

  return {
    lineCount,
    heightPx: lineCount * lineHeightPx,
  };
}

export function useMeasuredTextCollapse({
  text,
  collapsedLineCount,
  fallbackFontSizePx,
}: UseMeasuredTextCollapseInput) {
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [expandedText, setExpandedText] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<TextMeasurementMetrics | null>(null);

  const updateMetrics = useEffectEvent(() => {
    const nextMetrics = readTextMeasurementMetrics(element, fallbackFontSizePx);
    setMetrics((currentMetrics) => (
      areMetricsEqual(currentMetrics, nextMetrics) ? currentMetrics : nextMetrics
    ));
  });

  const setTextContentMeasurementRef = useCallback((node: HTMLElement | null) => {
    setElement(node);
  }, []);

  useLayoutEffect(() => {
    updateMetrics();

    if (element === null) return;
    if (typeof ResizeObserver === "undefined") return;

    if (resizeObserverRef.current === null) {
      resizeObserverRef.current = new ResizeObserver(() => {
        updateMetrics();
      });
    }

    resizeObserverRef.current.observe(element);
    return () => {
      resizeObserverRef.current?.unobserve(element);
    };
  }, [element]);

  useLayoutEffect(() => () => {
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
  }, []);

  const measuredLineCount = useMemo(() => {
    if (!metrics) return null;
    return measurePreWrappedLineCount({
      text,
      font: metrics.font,
      lineHeightPx: metrics.lineHeightPx,
      maxWidthPx: metrics.maxWidthPx,
    })?.lineCount ?? null;
  }, [metrics, text]);

  const collapseState: TextCollapseState =
    measuredLineCount === null || measuredLineCount <= collapsedLineCount
      ? "uncollapsible"
      : expandedText === text
        ? "expanded"
        : "collapsed";

  const handleToggleExpansion = useCallback(() => {
    setExpandedText((currentText) => (currentText === text ? null : text));
  }, [text]);

  return {
    setTextContentMeasurementRef,
    collapseState,
    handleToggleExpansion,
  };
}
