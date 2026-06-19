import {
  defaultProps,
  isTableCellSelection,
  type DefaultProps,
} from "@blocknote/core";
import { FormattingToolbarExtension } from "@blocknote/core/extensions";
import { flip, offset, shift } from "@floating-ui/react";
import {
  FormattingToolbar,
  PositionPopover,
  useBlockNoteEditor,
  useEditorState,
  useExtension,
  useExtensionState,
  type FloatingUIOptions,
  type FormattingToolbarProps,
} from "@blocknote/react";
import { useMemo, useRef, type FC } from "react";
import {
  isBlockLevelSelection,
  shouldUseTextActionMenu,
  type TextActionMenuEligibilityInput,
} from "./nfm-text-action-menu-model";
import { NFM_TEXT_ACTION_MENU_FLOATING_OPTIONS } from "./nfm-text-action-menu-floating";

type NfmFormattingToolbarFloatingMode = "text-action" | "legacy";

function textAlignmentToPlacement(textAlignment: DefaultProps["textAlignment"]) {
  if (textAlignment === "center") return "top";
  if (textAlignment === "right") return "top-end";
  return "top-start";
}

function resolveTextActionMenuEligibility(editor: {
  isEditable: boolean;
  prosemirrorState: {
    selection: {
      from: number;
      to: number;
    };
  };
  getSelection: () => { blocks: Array<{ content?: unknown }> } | undefined;
  getTextCursorPosition: () => { block: { content?: unknown; props?: { textAlignment?: DefaultProps["textAlignment"] } } };
}): TextActionMenuEligibilityInput {
  const selection = editor.prosemirrorState.selection;
  const selectedBlocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block];

  return {
    isEditable: editor.isEditable,
    isTableCellSelection: isTableCellSelection(selection as Parameters<typeof isTableCellSelection>[0]),
    isBlockSelection: isBlockLevelSelection(selection),
    hasInlineContent: selectedBlocks.some((block) => block.content !== undefined),
    selectionFrom: selection.from,
    selectionTo: selection.to,
  };
}

export function resolveNfmFormattingToolbarFloatingMode(
  input: TextActionMenuEligibilityInput,
): NfmFormattingToolbarFloatingMode {
  return shouldUseTextActionMenu(input) ? "text-action" : "legacy";
}

export function resolveNfmFormattingToolbarEffectiveFloatingMode(input: {
  show: boolean;
  currentMode: NfmFormattingToolbarFloatingMode;
  lastVisibleMode: NfmFormattingToolbarFloatingMode;
}): NfmFormattingToolbarFloatingMode {
  return input.show ? input.currentMode : input.lastVisibleMode;
}

export function NfmFormattingToolbarController(props: {
  formattingToolbar?: FC<FormattingToolbarProps>;
  floatingUIOptions?: FloatingUIOptions;
  portalElement?: HTMLElement | null;
}) {
  const editor = useBlockNoteEditor();
  const formattingToolbar = useExtension(FormattingToolbarExtension, {
    editor,
  });
  const show = useExtensionState(FormattingToolbarExtension, {
    editor,
  });

  const position = useEditorState({
    editor,
    selector: ({ editor }) =>
      formattingToolbar.store.state
        ? {
            from: editor.prosemirrorState.selection.from,
            to: editor.prosemirrorState.selection.to,
          }
        : undefined,
  });

  const placement = useEditorState({
    editor,
    selector: ({ editor }) => {
      const block = editor.getTextCursorPosition().block as {
        props?: { textAlignment?: DefaultProps["textAlignment"] };
      };
      return textAlignmentToPlacement(block.props?.textAlignment ?? defaultProps.textAlignment.default);
    },
  });

  const floatingMode = useEditorState({
    editor,
    selector: ({ editor }) => resolveNfmFormattingToolbarFloatingMode(resolveTextActionMenuEligibility(editor)),
  });
  const lastVisibleFloatingModeRef = useRef<NfmFormattingToolbarFloatingMode>(floatingMode);

  if (show) {
    lastVisibleFloatingModeRef.current = floatingMode;
  }

  const effectiveFloatingMode = resolveNfmFormattingToolbarEffectiveFloatingMode({
    show,
    currentMode: floatingMode,
    lastVisibleMode: lastVisibleFloatingModeRef.current,
  });
  const textActionFloatingOptions = effectiveFloatingMode === "text-action"
    ? NFM_TEXT_ACTION_MENU_FLOATING_OPTIONS
    : undefined;

  const floatingUIOptions = useMemo<FloatingUIOptions>(() => ({
    ...props.floatingUIOptions,
    ...textActionFloatingOptions,
    useFloatingOptions: {
      open: show,
      onOpenChange: (open, _event, reason) => {
        formattingToolbar.store.setState(open);

        if (reason === "escape-key") {
          editor.focus();
        }
      },
      placement,
      middleware: [offset(10), shift(), flip()],
      ...props.floatingUIOptions?.useFloatingOptions,
      ...textActionFloatingOptions?.useFloatingOptions,
    },
    focusManagerProps: {
      disabled: true,
      ...props.floatingUIOptions?.focusManagerProps,
      ...textActionFloatingOptions?.focusManagerProps,
    },
    elementProps: {
      ...props.floatingUIOptions?.elementProps,
      ...textActionFloatingOptions?.elementProps,
      style: {
        zIndex: 40,
        ...props.floatingUIOptions?.elementProps?.style,
        ...textActionFloatingOptions?.elementProps?.style,
      },
    },
  }), [
    editor,
    formattingToolbar.store,
    placement,
    props.floatingUIOptions,
    show,
    textActionFloatingOptions,
  ]);

  const Component = props.formattingToolbar ?? FormattingToolbar;

  return (
    <PositionPopover
      position={position}
      portalElement={props.portalElement}
      {...floatingUIOptions}
    >
      {show ? <Component /> : null}
    </PositionPopover>
  );
}
