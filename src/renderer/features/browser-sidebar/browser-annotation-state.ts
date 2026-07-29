import type {
  BrowserAnnotationAnchor,
  BrowserAnnotationDesignChange,
  BrowserAnnotationSelectionEvent,
} from "../../../shared/browser-annotation";

export interface BrowserAnnotationDraftState {
  anchors: BrowserAnnotationAnchor[];
  designChange: BrowserAnnotationDesignChange | null;
  intent: "comment" | "designChange";
  note: string;
  originalView: boolean;
  pageUrl: string;
  selectionMode: "inspect" | "region";
}

export function createBrowserAnnotationDraftState(
  pageUrl: string,
): BrowserAnnotationDraftState {
  return {
    anchors: [],
    designChange: null,
    intent: "comment",
    note: "",
    originalView: false,
    pageUrl,
    selectionMode: "inspect",
  };
}

function sameAnchor(
  left: BrowserAnnotationAnchor,
  right: BrowserAnnotationAnchor,
): boolean {
  if (left.kind !== right.kind || left.pageUrl !== right.pageUrl) return false;
  if (left.kind === "element") {
    return left.selector === right.selector
      && left.elementPath === right.elementPath
      && JSON.stringify(left.framePath ?? []) === JSON.stringify(right.framePath ?? []);
  }
  return left.rect.x === right.rect.x
    && left.rect.y === right.rect.y
    && left.rect.width === right.rect.width
    && left.rect.height === right.rect.height;
}

export function applyBrowserAnnotationSelection(
  state: BrowserAnnotationDraftState,
  selection: BrowserAnnotationSelectionEvent,
): BrowserAnnotationDraftState {
  if (selection.anchor.pageUrl !== state.pageUrl) return state;
  if (!selection.multiSelect) {
    return {
      ...state,
      anchors: [selection.anchor],
      designChange: null,
      originalView: false,
    };
  }

  const existingIndex = state.anchors.findIndex((anchor) =>
    sameAnchor(anchor, selection.anchor)
  );
  const nextAnchors = existingIndex === -1
    ? [...state.anchors, selection.anchor].slice(-32)
    : state.anchors.filter((_, index) => index !== existingIndex);
  return {
    ...state,
    anchors: nextAnchors,
    designChange: nextAnchors.some((anchor) =>
        anchor.id === state.designChange?.anchorId
      )
      ? state.designChange
      : null,
  };
}

export function applyBrowserAnnotationAnchorUpdate(
  state: BrowserAnnotationDraftState,
  anchor: BrowserAnnotationAnchor,
): BrowserAnnotationDraftState {
  if (anchor.pageUrl !== state.pageUrl) return state;
  let changed = false;
  const anchors = state.anchors.map((current) => {
    if (current.id !== anchor.id) return current;
    changed = true;
    return anchor;
  });
  return changed ? { ...state, anchors } : state;
}

export function removeBrowserAnnotationAnchor(
  state: BrowserAnnotationDraftState,
  anchorId: string,
): BrowserAnnotationDraftState {
  const anchors = state.anchors.filter((anchor) => anchor.id !== anchorId);
  return {
    ...state,
    anchors,
    designChange: state.designChange?.anchorId === anchorId
      ? null
      : state.designChange,
  };
}

export function resetBrowserAnnotationDraft(
  state: BrowserAnnotationDraftState,
): BrowserAnnotationDraftState {
  return {
    ...state,
    anchors: [],
    designChange: null,
    note: "",
    originalView: false,
  };
}

export function navigateBrowserAnnotationDraft(
  state: BrowserAnnotationDraftState,
  pageUrl: string,
): BrowserAnnotationDraftState {
  if (pageUrl === state.pageUrl) return state;
  return createBrowserAnnotationDraftState(pageUrl);
}

export function updateBrowserAnnotationDesignChange(
  state: BrowserAnnotationDraftState,
  input: {
    anchorId: string;
    property: BrowserAnnotationDesignChange["property"];
    after: string;
  },
): BrowserAnnotationDraftState {
  const anchor = state.anchors.find((candidate) => candidate.id === input.anchorId);
  if (!anchor || anchor.kind !== "element") {
    return { ...state, designChange: null };
  }
  return {
    ...state,
    designChange: {
      anchorId: input.anchorId,
      property: input.property,
      before: anchor.computedStyle?.[input.property] ?? "",
      after: input.after.slice(0, 512),
    },
  };
}
