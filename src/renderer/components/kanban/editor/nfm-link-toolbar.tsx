import {
  formatKeyboardShortcut,
  isTableCellSelection,
} from "@blocknote/core";
import {
  FormattingToolbarExtension,
  ShowSelectionExtension,
} from "@blocknote/core/extensions";
import type { LinkToolbarProps } from "@blocknote/react";
import {
  DeleteLinkButton,
  LinkToolbar,
  useBlockNoteEditor,
  useComponentsContext,
  useDictionary,
  useEditorState,
  useExtension,
} from "@blocknote/react";
import { useEffect, useState } from "react";
import { ExternalLink, Link } from "lucide-react";
import {
  openNfmResolvedLinkAction,
  resolveNfmLinkAction,
  resolveNfmLinkTooltipLabel,
} from "@/lib/nfm-link-actions";
import { useFileLinkOpener } from "@/lib/use-file-link-opener";
import { NfmEditLinkMenuItems } from "./nfm-edit-link-menu-items";

function hasLinkInSchema(editor: { schema: { inlineContentSchema: Record<string, unknown> } }): boolean {
  return (
    "link" in editor.schema.inlineContentSchema
    && editor.schema.inlineContentSchema["link"] === "link"
  );
}

function NfmCreateLinkButton() {
  const editor = useBlockNoteEditor();
  const Components = useComponentsContext()!;
  const dict = useDictionary();
  const formattingToolbar = useExtension(FormattingToolbarExtension);
  const { showSelection } = useExtension(ShowSelectionExtension);
  const [showPopover, setShowPopover] = useState(false);

  useEffect(() => {
    showSelection(showPopover, "createLinkButton");
    return () => showSelection(false, "createLinkButton");
  }, [showPopover, showSelection]);

  const state = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => {
      if (
        !currentEditor.isEditable
        || !hasLinkInSchema(currentEditor)
        || isTableCellSelection(currentEditor.prosemirrorState.selection)
        || !(
          currentEditor.getSelection()?.blocks
          || [currentEditor.getTextCursorPosition().block]
        ).find((block) => block.content !== undefined)
      ) {
        return undefined;
      }

      return {
        url: currentEditor.getSelectedLinkUrl(),
        text: currentEditor.getSelectedText(),
        range: {
          from: currentEditor.prosemirrorState.selection.from,
          to: currentEditor.prosemirrorState.selection.to,
        },
      };
    },
  });

  useEffect(() => {
    setShowPopover(false);
  }, [state]);

  useEffect(() => {
    const callback = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "k") {
        setShowPopover(true);
        event.preventDefault();
      }
    };

    const domElement = editor.domElement;
    domElement?.addEventListener("keydown", callback);

    return () => {
      domElement?.removeEventListener("keydown", callback);
    };
  }, [editor.domElement]);

  if (state === undefined) {
    return null;
  }

  return (
    <Components.Generic.Popover.Root
      open={showPopover}
      onOpenChange={setShowPopover}
    >
      <Components.Generic.Popover.Trigger>
        <Components.FormattingToolbar.Button
          className={"bn-button"}
          data-test="createLink"
          label={dict.formatting_toolbar.link.tooltip}
          mainTooltip={dict.formatting_toolbar.link.tooltip}
          secondaryTooltip={formatKeyboardShortcut(
            dict.formatting_toolbar.link.secondary_tooltip,
            dict.generic.ctrl_shortcut,
          )}
          icon={<Link />}
          onClick={() => setShowPopover((open) => !open)}
        />
      </Components.Generic.Popover.Trigger>
      <Components.Generic.Popover.Content
        className={"bn-popover-content bn-form-popover"}
        variant={"form-popover"}
      >
        <NfmEditLinkMenuItems
          url={state.url || ""}
          text={state.text}
          range={state.range}
          showTextField={false}
          setToolbarOpen={(open) => formattingToolbar.store.setState(open)}
        />
      </Components.Generic.Popover.Content>
    </Components.Generic.Popover.Root>
  );
}

export interface NfmLinkToolbarProps extends LinkToolbarProps {
  projectWorkspacePath?: string | null;
}

function NfmOpenLinkButton({
  url,
  projectWorkspacePath,
}: {
  url: string;
  projectWorkspacePath?: string | null;
}) {
  const Components = useComponentsContext()!;
  const dict = useDictionary();
  const { opener } = useFileLinkOpener();
  const action = resolveNfmLinkAction(url, projectWorkspacePath);
  const tooltip = resolveNfmLinkTooltipLabel(action, false)
    ?? dict.link_toolbar.open.tooltip;

  if (!action) return null;

  return (
    <Components.LinkToolbar.Button
      className={"bn-button"}
      mainTooltip={tooltip}
      isSelected={false}
      onClick={() => {
        if (action.kind === "blocked" || action.kind === "unresolved-file-like") {
          return;
        }

        void openNfmResolvedLinkAction(action, opener);
      }}
    >
      <span className="inline-flex items-center gap-1">
        <ExternalLink className="size-3.5" />
        {dict.link_toolbar.open.tooltip}
      </span>
    </Components.LinkToolbar.Button>
  );
}

export function NfmLinkToolbar(props: NfmLinkToolbarProps) {
  const Components = useComponentsContext()!;
  const dict = useDictionary();

  return (
    <LinkToolbar {...props}>
      <>
        <Components.Generic.Popover.Root
          onOpenChange={props.setToolbarPositionFrozen}
        >
          <Components.Generic.Popover.Trigger>
            <Components.LinkToolbar.Button
              className={"bn-button"}
              mainTooltip={dict.link_toolbar.edit.tooltip}
              isSelected={false}
            >
              {dict.link_toolbar.edit.text}
            </Components.LinkToolbar.Button>
          </Components.Generic.Popover.Trigger>
          <Components.Generic.Popover.Content
            className={"bn-popover-content bn-form-popover"}
            variant={"form-popover"}
          >
            <NfmEditLinkMenuItems
              url={props.url}
              text={props.text}
              range={props.range}
              setToolbarOpen={props.setToolbarOpen}
              setToolbarPositionFrozen={props.setToolbarPositionFrozen}
            />
          </Components.Generic.Popover.Content>
        </Components.Generic.Popover.Root>
        <NfmOpenLinkButton
          url={props.url}
          projectWorkspacePath={props.projectWorkspacePath}
        />
        <DeleteLinkButton
          range={props.range}
          setToolbarOpen={props.setToolbarOpen}
        />
      </>
    </LinkToolbar>
  );
}

export { NfmCreateLinkButton };
