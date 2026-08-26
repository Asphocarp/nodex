import { BlockSchema, InlineContentSchema, StyleSchema } from "@blocknote/core";
import {
  SuggestionMenu as SuggestionMenuExtension,
  SuggestionMenuOptions,
  type SuggestionMenuCloseReason,
  filterSuggestionItems,
} from "@blocknote/core/extensions";
import { autoPlacement, offset, shift, size } from "@floating-ui/react";
import { FC, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import { useBlockNoteEditor } from "../../hooks/useBlockNoteEditor.js";
import { useEditorDOMElement } from "../../hooks/useEditorDomElement.js";
import { useExtension, useExtensionState } from "../../hooks/useExtension.js";
import { FloatingUIOptions } from "../Popovers/FloatingUIOptions.js";
import {
  GenericPopover,
  GenericPopoverReference,
} from "../Popovers/GenericPopover.js";
import { SuggestionMenu } from "./SuggestionMenu.js";
import { SuggestionMenuWrapper } from "./SuggestionMenuWrapper.js";
import { getDefaultReactSlashMenuItems } from "./getDefaultReactSlashMenuItems.js";
import { DefaultReactSuggestionItem, SuggestionMenuProps } from "./types.js";

type ArrayElement<A> = A extends readonly (infer T)[] ? T : never;

type ItemType<GetItemsType extends (query: string) => Promise<any[]>> =
  ArrayElement<Awaited<ReturnType<GetItemsType>>>;

export function SuggestionMenuController<
  // This is a bit hacky, but only way I found to make types work so the optionality
  // of suggestionMenuComponent depends on the return type of getItems
  GetItemsType extends (query: string) => Promise<any[]> = (
    query: string,
  ) => Promise<DefaultReactSuggestionItem[]>,
>(
  props: {
    triggerCharacter: string;
    getItems?: GetItemsType;
    /** Query-fresh same-render items; async getItems may enrich them later. */
    getImmediateItems?: (query: string) => ItemType<GetItemsType>[];
    /** Authorization/context identity for rejecting same-query stale results. */
    requestScopeKey?: string;
    shouldOpen?: SuggestionMenuOptions["shouldOpen"];
    minQueryLength?: number;
    /**
     * Defaults to true. Disable for open-ended search surfaces where an empty
     * query is recoverable by continuing to type or pressing Backspace.
     */
    autoCloseWhenNoItems?: boolean;
    /** Closes a live session when its query reaches an invalid terminal shape. */
    shouldCloseOnQuery?: (query: string) => boolean;
    /** Keeps utility rows such as incremental disclosure actions open. */
    shouldCloseOnItemClick?: (item: ItemType<GetItemsType>) => boolean;
    floatingUIOptions?: FloatingUIOptions;
    /**
     * Override the DOM node this floating element portals into. Falls back to
     * `editor.portalElement` (which by default is mounted inside `bn-container`)
     * when omitted.
     */
    portalElement?: HTMLElement | null;
  } & (ItemType<GetItemsType> extends DefaultReactSuggestionItem
    ? {
        // can be undefined
        suggestionMenuComponent?: FC<
          SuggestionMenuProps<ItemType<GetItemsType>>
        >;
        onItemClick?: (item: ItemType<GetItemsType>) => void;
      }
    : {
        // getItems doesn't return DefaultSuggestionItem, so suggestionMenuComponent is required
        suggestionMenuComponent: FC<
          SuggestionMenuProps<ItemType<GetItemsType>>
        >;
        onItemClick: (item: ItemType<GetItemsType>) => void;
      }),
) {
  const editor = useBlockNoteEditor<
    BlockSchema,
    InlineContentSchema,
    StyleSchema
  >();
  const editorDOMElement = useEditorDOMElement();

  const {
    triggerCharacter,
    suggestionMenuComponent,
    shouldOpen,
    minQueryLength,
    onItemClick,
    getItems,
    shouldCloseOnItemClick,
    autoCloseWhenNoItems,
  } = props;

  const onItemClickOrDefault = useMemo(() => {
    return (
      onItemClick ||
      ((item: ItemType<GetItemsType>) => {
        item.onItemClick(editor);
      })
    );
  }, [editor, onItemClick]);

  const getItemsOrDefault = useMemo(() => {
    return (
      getItems ||
      ((async (query: string) =>
        filterSuggestionItems(
          getDefaultReactSlashMenuItems(editor),
          query,
        )) as any as typeof getItems)
    );
  }, [editor, getItems])!;

  const suggestionMenu = useExtension(SuggestionMenuExtension);
  const shouldOpenRef = useRef(shouldOpen);
  useLayoutEffect(() => {
    shouldOpenRef.current = shouldOpen;
  }, [shouldOpen]);
  const shouldOpenLatest = useCallback<NonNullable<SuggestionMenuOptions["shouldOpen"]>>(
    (transaction) => shouldOpenRef.current?.(transaction) ?? true,
    [],
  );

  useEffect(() => {
    return suggestionMenu.addSuggestionMenu({
      triggerCharacter,
      shouldOpen: shouldOpenLatest,
    });
  }, [suggestionMenu, triggerCharacter, shouldOpenLatest]);

  const state = useExtensionState(SuggestionMenuExtension);
  const reference = useExtensionState(SuggestionMenuExtension, {
    selector: (state) =>
      ({
        // Use first child as the editor DOM element may itself be scrollable.
        // For FloatingUI to auto-update the position during scrolling, the
        // `contextElement` must be a descendant of the scroll container.
        element: (editorDOMElement?.firstChild || undefined) as
          | Element
          | undefined,
        getBoundingClientRect: () => state?.referencePos || new DOMRect(),
      }) satisfies GenericPopoverReference,
  });

  const floatingUIOptions = useMemo<FloatingUIOptions>(
    () => ({
      ...props.floatingUIOptions,
      useFloatingOptions: {
        open: state?.show && state?.triggerCharacter === triggerCharacter,
        onOpenChange: (open, _event, reason) => {
          if (!open) {
            const closeReason: SuggestionMenuCloseReason =
              reason === "escape-key" ? "escape" : "outside";
            suggestionMenu.closeMenu(closeReason);
          }
        },
        placement: "bottom-start",
        middleware: [
          offset(10),
          // Flips the menu placement to maximize the space available, and prevents
          // the menu from being cut off by the confines of the screen.
          autoPlacement({
            allowedPlacements: ["bottom-start", "top-start"],
            padding: 10,
          }),
          shift(),
          size({
            apply({ elements, availableHeight }) {
              elements.floating.style.maxHeight = `${Math.max(0, availableHeight)}px`;
            },
            padding: 10,
          }),
        ],
        ...props.floatingUIOptions?.useFloatingOptions,
      },
      focusManagerProps: {
        disabled: true,
        ...props.floatingUIOptions?.focusManagerProps,
      },
      useDismissProps: {
        ...props.floatingUIOptions?.useDismissProps,
        escapeKey: false,
      },
      elementProps: {
        // Prevents editor blurring when clicking the scroll bar.
        onMouseDownCapture: (event) => event.preventDefault(),
        style: {
          zIndex: 80,
        },
        ...props.floatingUIOptions?.elementProps,
      },
    }),
    [
      props.floatingUIOptions,
      state?.show,
      state?.triggerCharacter,
      suggestionMenu,
      triggerCharacter,
    ],
  );

  if (
    !state ||
    (!state.ignoreQueryLength &&
      minQueryLength &&
      (state.query.startsWith(" ") || state.query.length < minQueryLength))
  ) {
    return null;
  }

  return (
    <GenericPopover
      reference={reference}
      portalElement={props.portalElement}
      {...floatingUIOptions}
    >
      {triggerCharacter && (
        <SuggestionMenuWrapper
          triggerCharacter={triggerCharacter}
          query={state.query}
          closeMenu={suggestionMenu.closeMenu}
          acceptMenu={suggestionMenu.acceptMenu}
          getItems={getItemsOrDefault}
          getImmediateItems={props.getImmediateItems}
          requestScopeKey={props.requestScopeKey}
          suggestionMenuComponent={
            suggestionMenuComponent || SuggestionMenu<ItemType<GetItemsType>>
          }
          onItemClick={onItemClickOrDefault}
          shouldCloseOnItemClick={shouldCloseOnItemClick}
          autoCloseWhenNoItems={autoCloseWhenNoItems}
          shouldCloseOnQuery={props.shouldCloseOnQuery}
          isComposing={state.isComposing}
        />
      )}
    </GenericPopover>
  );
}
