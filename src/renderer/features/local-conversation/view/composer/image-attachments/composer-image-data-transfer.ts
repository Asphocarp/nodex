import {
  isSupportedComposerImageMetadata,
  normalizeComposerImageFilenameCandidate,
} from "../../../../../../shared/composer-image-input";

export {
  COMPOSER_IMAGE_MIME_TYPES,
  isSupportedComposerImageMetadata,
} from "../../../../../../shared/composer-image-input";
const MEDIA_ONLY_HTML_LIMIT = 100_000;
const MEDIA_ELEMENT_SELECTOR = "img,svg,canvas,video";
const IGNORED_ELEMENT_SELECTOR = [
  "head",
  "script",
  "style",
  "template",
  "noscript",
  "title",
  "meta",
  "link",
].join(",");

export interface ComposerPastedFiles {
  readonly imageFiles: readonly File[];
  readonly otherFiles: readonly File[];
  readonly source: "paste";
}

export interface ComposerDataTransferClassification {
  readonly imageFiles: readonly File[];
  readonly otherFiles: readonly File[];
  readonly plainText: string;
  readonly html: string;
  readonly isMediaOnlyHtml: boolean;
  readonly hasMeaningfulText: boolean;
  readonly disposition: "consume-files" | "pass-through";
}

export function isSupportedComposerImageFile(file: File): boolean {
  return isSupportedComposerImageMetadata({
    filename: file.name,
    mimeType: file.type,
    size: file.size,
  });
}

function collectTransferFiles(dataTransfer: DataTransfer): readonly File[] {
  const fileList = Array.from(dataTransfer.files ?? []);
  const itemFiles = Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);

  if (itemFiles.length > fileList.length) return itemFiles;
  if (fileList.length > 0) return fileList;
  return itemFiles;
}

function isHiddenElement(element: Element): boolean {
  if (element.matches(IGNORED_ELEMENT_SELECTOR)) return true;
  if (element.hasAttribute("hidden")) return true;
  if (element.getAttribute("aria-hidden")?.toLowerCase() === "true") return true;
  if (element instanceof HTMLInputElement && element.type === "hidden") return true;

  const style = element.getAttribute("style")?.toLowerCase() ?? "";
  return (
    /(?:^|;)\s*display\s*:\s*none\b/.test(style) ||
    /(?:^|;)\s*visibility\s*:\s*hidden\b/.test(style)
  );
}

function hasHiddenAncestor(node: Node): boolean {
  let parent = node.parentElement;
  while (parent) {
    if (isHiddenElement(parent)) return true;
    parent = parent.parentElement;
  }
  return false;
}

function hasMediaAncestor(node: Node): boolean {
  let parent = node.parentElement;
  while (parent) {
    if (parent.matches(MEDIA_ELEMENT_SELECTOR)) return true;
    parent = parent.parentElement;
  }
  return false;
}

export function isComposerMediaOnlyHtml(html: string): boolean {
  if (!html || html.length > MEDIA_ONLY_HTML_LIMIT) return false;

  const documentNode = new DOMParser().parseFromString(html, "text/html");
  const visibleMedia = Array.from(documentNode.body.querySelectorAll(MEDIA_ELEMENT_SELECTOR)).some(
    (element) => !isHiddenElement(element) && !hasHiddenAncestor(element),
  );
  if (!visibleMedia) return false;

  const walker = documentNode.createTreeWalker(documentNode.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.textContent?.trim()) continue;
    if (hasHiddenAncestor(node)) continue;
    if (hasMediaAncestor(node)) continue;
    return false;
  }
  return true;
}

function hasMeaningfulClipboardText(plainText: string, files: readonly File[]): boolean {
  const filenames = new Set(
    files.map((file) => normalizeComposerImageFilenameCandidate(file.name)),
  );
  const lines = plainText
    .split(/\r?\n/)
    .map(normalizeComposerImageFilenameCandidate)
    .filter(Boolean);
  return lines.some((line) => !filenames.has(line));
}

export function classifyComposerDataTransfer(
  dataTransfer: DataTransfer,
): ComposerDataTransferClassification {
  const files = collectTransferFiles(dataTransfer).filter((file) => file.size > 0);
  const imageFiles = files.filter(isSupportedComposerImageFile);
  const otherFiles = files.filter((file) => !isSupportedComposerImageFile(file));
  const plainText = dataTransfer.getData("text/plain");
  const html = dataTransfer.getData("text/html");
  const isMediaOnlyHtml = isComposerMediaOnlyHtml(html);
  const hasMeaningfulText = hasMeaningfulClipboardText(plainText, files);
  const hasConsumableFiles =
    otherFiles.length > 0 || (imageFiles.length > 0 && (!hasMeaningfulText || isMediaOnlyHtml));

  return {
    imageFiles,
    otherFiles,
    plainText,
    html,
    isMediaOnlyHtml,
    hasMeaningfulText,
    disposition: hasConsumableFiles ? "consume-files" : "pass-through",
  };
}

export function handleComposerFilePaste(
  event: ClipboardEvent,
  onPasteFiles: ((payload: ComposerPastedFiles) => boolean) | undefined,
): boolean {
  if (event.defaultPrevented) return true;
  const clipboard = event.clipboardData;
  if (!clipboard) return false;

  const classification = classifyComposerDataTransfer(clipboard);
  if (classification.disposition !== "consume-files") return false;
  if (
    onPasteFiles?.({
      imageFiles: classification.imageFiles,
      otherFiles: classification.otherFiles,
      source: "paste",
    }) !== true
  )
    return false;

  event.preventDefault();
  return true;
}
