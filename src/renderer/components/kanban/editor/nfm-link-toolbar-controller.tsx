import { LinkToolbarExtension } from "@blocknote/core/extensions";
import type { Range } from "@tiptap/core";
import {
  type LinkToolbarProps,
  type FloatingUIOptions,
  useBlockNoteEditor,
  useExtension,
} from "@blocknote/react";
import { useEffect, useMemo, useState, type FC } from "react";
import { NfmFloatingPopover, type NfmPopoverReference } from "./nfm-floating-popover";

interface LinkToolbarSnapshot {
  cursorType: "text" | "mouse";
  url: string;
  text: string;
  range: Range;
  element: HTMLAnchorElement;
}

function toLinkToolbarSnapshot(
  link: {
    mark: { attrs: { href?: unknown } };
    text: string;
    range: Range;
  },
  element: HTMLAnchorElement,
  cursorType: LinkToolbarSnapshot["cursorType"],
): LinkToolbarSnapshot {
  return {
    cursorType,
    url: String(link.mark.attrs.href ?? ""),
    text: link.text,
    range: link.range,
    element,
  };
}

export function NfmLinkToolbarController(props: {
  linkToolbar?: FC<LinkToolbarProps>;
  floatingUIOptions?: FloatingUIOptions;
}) {
  const editor = useBlockNoteEditor();
  const [toolbarOpen, setToolbarOpen] = useState(false);
  const [toolbarPositionFrozen, setToolbarPositionFrozen] = useState(false);
  const linkToolbar = useExtension(LinkToolbarExtension);
  const [link, setLink] = useState<LinkToolbarSnapshot | undefined>(undefined);

  useEffect(() => {
    const textCursorCallback = () => {
      if (toolbarPositionFrozen) return;

      const textCursorLink = linkToolbar.getLinkAtSelection();
      if (!textCursorLink) {
        setLink(undefined);
        setToolbarOpen(false);
        return;
      }

      const element = linkToolbar.getLinkElementAtPos(textCursorLink.range.from);
      if (!element) {
        setLink(undefined);
        setToolbarOpen(false);
        return;
      }

      setLink(toLinkToolbarSnapshot(textCursorLink, element, "text"));

      if (!toolbarPositionFrozen) {
        setToolbarOpen(true);
      }
    };

    const mouseCursorCallback = (event: MouseEvent) => {
      if (toolbarPositionFrozen) return;
      if (link !== undefined && link.cursorType === "text") return;
      if (!(event.target instanceof HTMLElement)) return;

      const mouseCursorLink = linkToolbar.getLinkAtElement(event.target);
      if (!mouseCursorLink) return;

      const element = linkToolbar.getLinkElementAtPos(mouseCursorLink.range.from);
      if (!element) return;

      setLink(toLinkToolbarSnapshot(mouseCursorLink, element, "mouse"));
    };

    const destroyOnChangeHandler = editor.onChange(textCursorCallback);
    const destroyOnSelectionChangeHandler = editor.onSelectionChange(textCursorCallback);
    const domElement = editor.domElement;

    domElement?.addEventListener("mouseover", mouseCursorCallback);

    return () => {
      destroyOnChangeHandler();
      destroyOnSelectionChangeHandler();
      domElement?.removeEventListener("mouseover", mouseCursorCallback);
    };
  }, [editor, editor.domElement, link, linkToolbar, toolbarPositionFrozen]);

  const floatingUIOptions = useMemo<FloatingUIOptions>(
    () => ({
      ...props.floatingUIOptions,
      useFloatingOptions: {
        open: toolbarOpen,
        onOpenChange: (open, _event, reason) => {
          if (toolbarPositionFrozen) return;

          if (
            link !== undefined
            && link.cursorType === "text"
            && reason === "hover"
          ) {
            return;
          }

          if (reason === "escape-key") {
            editor.focus();
          }

          setToolbarOpen(open);
        },
        placement: "top-start",
        ...props.floatingUIOptions?.useFloatingOptions,
      },
      useHoverProps: {
        enabled: !toolbarPositionFrozen && link !== undefined && link.cursorType === "mouse",
        delay: {
          open: 250,
          close: 250,
        },
        ...props.floatingUIOptions?.useHoverProps,
      },
      focusManagerProps: {
        disabled: true,
        ...props.floatingUIOptions?.focusManagerProps,
      },
      elementProps: {
        style: {
          zIndex: 50,
        },
        ...props.floatingUIOptions?.elementProps,
      },
    }),
    [editor, link, props.floatingUIOptions, toolbarOpen, toolbarPositionFrozen],
  );

  const reference = useMemo<NfmPopoverReference | undefined>(
    () => (link?.element ? { element: link.element } : undefined),
    [link?.element],
  );

  if (!editor.isEditable) {
    return null;
  }

  const Component = props.linkToolbar;
  if (!Component) {
    return null;
  }

  return (
    <NfmFloatingPopover reference={reference} {...floatingUIOptions}>
      {link && (
        <Component
          url={link.url}
          text={link.text}
          range={link.range}
          setToolbarOpen={setToolbarOpen}
          setToolbarPositionFrozen={setToolbarPositionFrozen}
        />
      )}
    </NfmFloatingPopover>
  );
}
