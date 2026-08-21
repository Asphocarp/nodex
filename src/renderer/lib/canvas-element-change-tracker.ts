import {
  canvasSceneElementHash,
  canonicalizeCanvasSceneElement,
  chooseCanvasSceneElementWinner,
  type CanvasSceneElement,
} from "../../shared/block-documents";

export interface CanvasElementObservationDelta {
  readonly elementCandidates: readonly CanvasSceneElement[];
  readonly changedImageCandidates: readonly CanvasSceneElement[];
}

export interface CanvasElementChangeTracker {
  observeLocal(elementsIncludingDeleted: readonly unknown[]): CanvasElementObservationDelta;
  acceptRemotePresentation(
    elementsIncludingDeleted: readonly unknown[],
    dirtyElementIds: ReadonlySet<string>,
  ): void;
  markHandedOff(candidates: readonly CanvasSceneElement[]): void;
  markRejected(candidates: readonly CanvasSceneElement[]): void;
  reset(elementsIncludingDeleted: readonly unknown[]): void;
}

interface ElementStamp {
  readonly version: number;
  readonly versionNonce: number;
  readonly orderKey: string | undefined;
  readonly isDeleted: boolean;
  readonly hash: string;
}

const elementId = (element: CanvasSceneElement): string => element.id as string;

const elementStamp = (element: CanvasSceneElement): ElementStamp => ({
  version: element.version as number,
  versionNonce: element.versionNonce as number,
  orderKey: typeof element.index === "string" ? element.index : undefined,
  isDeleted: element.isDeleted === true,
  hash: canvasSceneElementHash(element),
});

const sameStamp = (left: ElementStamp, right: ElementStamp): boolean =>
  left.version === right.version &&
  left.versionNonce === right.versionNonce &&
  left.orderKey === right.orderKey &&
  left.isDeleted === right.isDeleted &&
  left.hash === right.hash;

const canonicalRuntimeElement = (value: unknown): CanvasSceneElement =>
  canonicalizeCanvasSceneElement(value, { runtime: true });

const chooseLatest = (
  current: CanvasSceneElement | undefined,
  candidate: CanvasSceneElement,
): CanvasSceneElement => (current ? chooseCanvasSceneElementWinner(current, candidate) : candidate);

const isChangedImageCandidate = (element: CanvasSceneElement): boolean =>
  element.isDeleted !== true && element.type === "image" && typeof element.fileId === "string";

export const createCanvasElementChangeTracker = (
  initialElementsIncludingDeleted: readonly unknown[],
): CanvasElementChangeTracker => {
  const observed = new Map<string, ElementStamp>();
  const dirty = new Map<string, CanvasSceneElement>();

  const reset = (elementsIncludingDeleted: readonly unknown[]): void => {
    observed.clear();
    dirty.clear();
    for (const value of elementsIncludingDeleted) {
      const element = canonicalRuntimeElement(value);
      observed.set(elementId(element), elementStamp(element));
    }
  };

  const observeLocal = (
    elementsIncludingDeleted: readonly unknown[],
  ): CanvasElementObservationDelta => {
    const changed = new Map<string, CanvasSceneElement>();

    for (const value of elementsIncludingDeleted) {
      const element = canonicalRuntimeElement(value);
      const id = elementId(element);
      const stamp = elementStamp(element);
      const previous = observed.get(id);

      observed.set(id, stamp);
      if (previous && sameStamp(previous, stamp) && !dirty.has(id)) continue;

      const candidate = chooseLatest(dirty.get(id), element);
      dirty.set(id, candidate);
      changed.set(id, candidate);
    }

    for (const [id, candidate] of dirty) {
      if (!changed.has(id)) changed.set(id, candidate);
    }

    const elementCandidates = [...changed.values()];
    return {
      elementCandidates,
      changedImageCandidates: elementCandidates.filter(isChangedImageCandidate),
    };
  };

  const acceptRemotePresentation = (
    elementsIncludingDeleted: readonly unknown[],
    dirtyElementIds: ReadonlySet<string>,
  ): void => {
    for (const value of elementsIncludingDeleted) {
      const element = canonicalRuntimeElement(value);
      const id = elementId(element);
      if (dirty.has(id) || dirtyElementIds.has(id)) continue;
      observed.set(id, elementStamp(element));
    }
  };

  const markHandedOff = (candidates: readonly CanvasSceneElement[]): void => {
    for (const value of candidates) {
      const candidate = canonicalRuntimeElement(value);
      const id = elementId(candidate);
      const current = dirty.get(id);
      if (!current) continue;
      if (!sameStamp(elementStamp(current), elementStamp(candidate))) continue;
      dirty.delete(id);
    }
  };

  const markRejected = (candidates: readonly CanvasSceneElement[]): void => {
    for (const value of candidates) {
      const candidate = canonicalRuntimeElement(value);
      const id = elementId(candidate);
      dirty.set(id, chooseLatest(dirty.get(id), candidate));
    }
  };

  reset(initialElementsIncludingDeleted);

  return {
    observeLocal,
    acceptRemotePresentation,
    markHandedOff,
    markRejected,
    reset,
  };
};
