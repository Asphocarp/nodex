import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type CompositionEvent,
  type FormEvent,
  type KeyboardEvent,
  type Ref,
} from "react";
import * as Y from "yjs";
import { MAX_CARD_TITLE_LENGTH } from "../../../shared/card-limits";
import { cn } from "@/lib/utils";
import { applyYTextInputReconciliation } from "@/lib/y-text-input";

type NativeTitleTextareaProps = Omit<
  ComponentPropsWithoutRef<"textarea">,
  | "defaultValue"
  | "maxLength"
  | "onChange"
  | "onCompositionEnd"
  | "onCompositionStart"
  | "onInput"
  | "title"
  | "value"
>;

export interface CollaborativeCardTitleProps
  extends NativeTitleTextareaProps {
  readonly title: Y.Text;
  readonly ref?: Ref<HTMLTextAreaElement>;
  /** Fires for every authoritative local or remote Y.Text change. */
  readonly onValueChange?: (value: string) => void;
  readonly onCompositionStart?: (
    event: CompositionEvent<HTMLTextAreaElement>,
  ) => void;
  readonly onCompositionEnd?: (
    event: CompositionEvent<HTMLTextAreaElement>,
  ) => void;
}

interface CompositionCommit {
  readonly browserValue: string;
  readonly authoritativeValue: string;
}

interface RelativeTitleSelection {
  readonly start: Y.RelativePosition;
  readonly end: Y.RelativePosition;
  readonly direction: "forward" | "backward" | "none";
}

interface AbsoluteTitleSelection {
  readonly start: number;
  readonly end: number;
  readonly direction: "forward" | "backward" | "none";
}

const TITLE_CLASS_NAME = cn(
  "w-full resize-none overflow-hidden",
  "text-xl/snug-plus font-bold",
  "text-(--foreground)",
  "border-none bg-transparent px-0.5 pt-0.75",
  "field-sizing-content focus-visible:ring-0 focus-visible:outline-none",
  "placeholder:text-(--foreground-disabled)",
);

const clampSelectionIndex = (index: number, length: number): number =>
  Math.min(Math.max(index, 0), length);

/**
 * Maps a browser selection inside an uncommitted IME draft back onto the
 * authoritative value that existed when composition started. The composed
 * range is anchored to the right-hand side of the replaced base range so the
 * Yjs relative position follows the composed text when it is committed.
 */
const mapCompositionDraftIndexToBase = (
  baseValue: string,
  draftValue: string,
  draftIndex: number,
): number => {
  const boundedDraftIndex = clampSelectionIndex(draftIndex, draftValue.length);
  let prefixLength = 0;
  const maximumPrefixLength = Math.min(baseValue.length, draftValue.length);
  while (
    prefixLength < maximumPrefixLength
    && baseValue[prefixLength] === draftValue[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  const maximumSuffixLength = Math.min(
    baseValue.length - prefixLength,
    draftValue.length - prefixLength,
  );
  while (
    suffixLength < maximumSuffixLength
    && baseValue[baseValue.length - suffixLength - 1]
      === draftValue[draftValue.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }

  if (boundedDraftIndex <= prefixLength) return boundedDraftIndex;
  const draftChangedEnd = draftValue.length - suffixLength;
  if (boundedDraftIndex >= draftChangedEnd) {
    return baseValue.length - (draftValue.length - boundedDraftIndex);
  }
  return baseValue.length - suffixLength;
};

/**
 * A controlled textarea whose only content authority is the supplied Y.Text.
 * Each ordinary input becomes one minimal Yjs edit; an IME draft is rebased
 * over the latest remote title before it is committed.
 */
export function CollaborativeCardTitle({
  title,
  ref: forwardedRef,
  onValueChange,
  onCompositionStart,
  onCompositionEnd,
  onKeyDown,
  className,
  rows = 1,
  placeholder = "Untitled",
  "aria-label": ariaLabel = "Card title",
  ...props
}: CollaborativeCardTitleProps) {
  const [value, setValue] = useState(() => title.toString());
  const [localOrigin] = useState(() => ({
    source: "collaborative-card-title",
  }));
  const draftRef = useRef(value);
  const composingRef = useRef(false);
  const compositionBaseRef = useRef(value);
  const compositionCommitRef = useRef<CompositionCommit | null>(null);
  const undoManagerRef = useRef<Y.UndoManager | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const relativeSelectionRef = useRef<RelativeTitleSelection | null>(null);
  const absoluteSelectionRef = useRef<AbsoluteTitleSelection | null>(null);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const onValueChangeRef = useRef(onValueChange);
  onValueChangeRef.current = onValueChange;

  useEffect(() => {
    const undoManager = new Y.UndoManager(title, {
      trackedOrigins: new Set([localOrigin]),
    });
    undoManagerRef.current = undoManager;

    const handleTitleChange = (): void => {
      const authoritativeValue = title.toString();
      onValueChangeRef.current?.(authoritativeValue);
      if (composingRef.current) return;
      draftRef.current = authoritativeValue;
      setValue(authoritativeValue);
    };

    const document = title.doc;
    if (!document) {
      undoManager.destroy();
      undoManagerRef.current = null;
      throw new TypeError("Collaborative Card title must belong to a Y.Doc");
    }
    const handleBeforeTransaction = (transaction: Y.Transaction): void => {
      if (transaction.origin === localOrigin) return;
      if (composingRef.current && relativeSelectionRef.current) return;
      const input = textareaRef.current;
      if (!input || input.ownerDocument.activeElement !== input) return;
      const selectionStart = input.selectionStart ?? 0;
      const selectionEnd = input.selectionEnd ?? selectionStart;
      const authoritativeSelectionStart = composingRef.current
        ? mapCompositionDraftIndexToBase(
            compositionBaseRef.current,
            draftRef.current,
            selectionStart,
          )
        : selectionStart;
      const authoritativeSelectionEnd = composingRef.current
        ? mapCompositionDraftIndexToBase(
            compositionBaseRef.current,
            draftRef.current,
            selectionEnd,
          )
        : selectionEnd;
      relativeSelectionRef.current = {
        start: Y.createRelativePositionFromTypeIndex(
          title,
          authoritativeSelectionStart,
        ),
        end: Y.createRelativePositionFromTypeIndex(
          title,
          authoritativeSelectionEnd,
        ),
        direction: input.selectionDirection ?? "none",
      };
    };
    const handleAfterTransaction = (transaction: Y.Transaction): void => {
      const relativeSelection = relativeSelectionRef.current;
      const changedParentTypes = transaction.changedParentTypes as ReadonlyMap<
        unknown,
        unknown
      >;
      if (!relativeSelection || !changedParentTypes.has(title)) {
        relativeSelectionRef.current = null;
        return;
      }
      const start = Y.createAbsolutePositionFromRelativePosition(
        relativeSelection.start,
        document,
      );
      const end = Y.createAbsolutePositionFromRelativePosition(
        relativeSelection.end,
        document,
      );
      if (!start || !end || start.type !== title || end.type !== title) return;
      if (composingRef.current) {
        relativeSelectionRef.current = {
          start: Y.createRelativePositionFromTypeIndex(title, start.index),
          end: Y.createRelativePositionFromTypeIndex(title, end.index),
          direction: relativeSelection.direction,
        };
        return;
      }
      relativeSelectionRef.current = null;
      absoluteSelectionRef.current = {
        start: start.index,
        end: end.index,
        direction: relativeSelection.direction,
      };
      setSelectionRevision((current) => current + 1);
    };

    title.observe(handleTitleChange);
    document.on("beforeTransaction", handleBeforeTransaction);
    document.on("afterTransaction", handleAfterTransaction);
    const authoritativeValue = title.toString();
    draftRef.current = authoritativeValue;
    setValue(authoritativeValue);
    onValueChangeRef.current?.(authoritativeValue);
    return () => {
      title.unobserve(handleTitleChange);
      document.off("beforeTransaction", handleBeforeTransaction);
      document.off("afterTransaction", handleAfterTransaction);
      undoManager.destroy();
      if (undoManagerRef.current === undoManager) {
        undoManagerRef.current = null;
      }
    };
  }, [localOrigin, title]);

  useLayoutEffect(() => {
    const selection = absoluteSelectionRef.current;
    absoluteSelectionRef.current = null;
    const input = textareaRef.current;
    if (!selection || !input || input.ownerDocument.activeElement !== input) {
      return;
    }
    input.setSelectionRange(
      selection.start,
      selection.end,
      selection.direction,
    );
  }, [selectionRevision, value]);

  const setTextareaRef = (node: HTMLTextAreaElement | null): void => {
    textareaRef.current = node;
    if (typeof forwardedRef === "function") {
      forwardedRef(node);
      return;
    }
    if (forwardedRef) forwardedRef.current = node;
  };

  const applyDraft = (baseValue: string, draftValue: string): void => {
    const reconciliation = applyYTextInputReconciliation({
      text: title,
      baseValue,
      draftValue,
      origin: localOrigin,
    });
    draftRef.current = reconciliation.value;
    setValue(reconciliation.value);
  };

  const handleInput = (event: FormEvent<HTMLTextAreaElement>): void => {
    const nextValue = event.currentTarget.value;
    if (nextValue.length > MAX_CARD_TITLE_LENGTH) return;
    const nativeIsComposing =
      "isComposing" in event.nativeEvent &&
      event.nativeEvent.isComposing === true;

    if (nativeIsComposing) {
      if (!composingRef.current) {
        composingRef.current = true;
        compositionBaseRef.current = title.toString();
        compositionCommitRef.current = null;
      }
      draftRef.current = nextValue;
      setValue(nextValue);
      return;
    }

    if (composingRef.current) {
      composingRef.current = false;
      applyDraft(compositionBaseRef.current, nextValue);
      compositionCommitRef.current = {
        browserValue: nextValue,
        authoritativeValue: title.toString(),
      };
      return;
    }

    const compositionCommit = compositionCommitRef.current;
    compositionCommitRef.current = null;
    if (
      compositionCommit &&
      nextValue === compositionCommit.browserValue &&
      title.toString() === compositionCommit.authoritativeValue
    ) {
      draftRef.current = compositionCommit.authoritativeValue;
      setValue(compositionCommit.authoritativeValue);
      return;
    }

    applyDraft(draftRef.current, nextValue);
  };

  const handleCompositionStart = (
    event: CompositionEvent<HTMLTextAreaElement>,
  ): void => {
    composingRef.current = true;
    compositionBaseRef.current = title.toString();
    compositionCommitRef.current = null;
    onCompositionStart?.(event);
  };

  const handleCompositionEnd = (
    event: CompositionEvent<HTMLTextAreaElement>,
  ): void => {
    const browserValue = event.currentTarget.value;
    composingRef.current = false;
    applyDraft(compositionBaseRef.current, browserValue);
    compositionCommitRef.current = {
      browserValue,
      authoritativeValue: title.toString(),
    };
    onCompositionEnd?.(event);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (composingRef.current || event.nativeEvent.isComposing) return;
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") {
      return;
    }

    event.preventDefault();
    if (event.shiftKey) {
      undoManagerRef.current?.redo();
      return;
    }
    undoManagerRef.current?.undo();
  };

  return (
    <textarea
      {...props}
      ref={setTextareaRef}
      aria-label={ariaLabel}
      value={value}
      rows={rows}
      maxLength={MAX_CARD_TITLE_LENGTH}
      placeholder={placeholder}
      className={cn(TITLE_CLASS_NAME, className)}
      onInput={handleInput}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      onKeyDown={handleKeyDown}
    />
  );
}
