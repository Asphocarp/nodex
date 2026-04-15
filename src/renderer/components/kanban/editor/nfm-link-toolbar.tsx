import {
  formatKeyboardShortcut,
  isTableCellSelection,
} from "@blocknote/core";
import {
  FormattingToolbarExtension,
  LinkToolbarExtension,
  ShowSelectionExtension,
} from "@blocknote/core/extensions";
import type { LinkToolbarProps } from "@blocknote/react";
import {
  useBlockNoteEditor,
  useDictionary,
  useEditorState,
  useExtension,
} from "@blocknote/react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link } from "lucide-react";
import {
  NodexPopover,
  NodexPopoverContent,
  NodexPopoverTrigger,
} from "@/components/ui/popover";
import { NodexTooltip } from "@/components/ui/tooltip";
import { writeTextToClipboard } from "@/lib/clipboard";
import {
  openNfmResolvedLinkAction,
  resolveNfmLinkAction,
  resolveNfmLinkTooltipLabel,
  type NfmResolvedLinkAction,
} from "@/lib/nfm-link-actions";
import { useFileLinkOpener } from "@/lib/use-file-link-opener";
import {
  useNfmLinkEditorState,
} from "./nfm-edit-link-menu-items";
import {
  NfmCompactLinkToolbar,
  NfmCreateLinkDialogSurface,
  NfmLinkEditDialogSurface,
} from "./nfm-link-toolbar-surface";
import { applyNfmLinkEditAtRange } from "./nfm-link-editing";
import { normalizeNfmEditorLinkUrl } from "./nfm-link-url";

function hasLinkInSchema(editor: { schema: { inlineContentSchema: Record<string, unknown> } }): boolean {
  return (
    "link" in editor.schema.inlineContentSchema
    && editor.schema.inlineContentSchema["link"] === "link"
  );
}

function NfmCreateLinkButton() {
  const editor = useBlockNoteEditor();
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

  const {
    currentUrl,
    setCurrentUrl,
    submit,
  } = useNfmLinkEditorState({
    ...state,
    url: state.url || "",
    setToolbarOpen: (open: boolean) => {
      formattingToolbar.store.setState(open);
      if (!open) {
        setShowPopover(false);
      }
    },
  });

  const handleSubmit = () => {
    submit();
    setShowPopover(false);
  };

  const handleUrlKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setShowPopover(false);
      return;
    }

    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    handleSubmit();
  };

  return (
    <NodexPopover
      open={showPopover}
      onOpenChange={setShowPopover}
    >
      <NodexTooltip
        tooltipContent={formatKeyboardShortcut(
          dict.formatting_toolbar.link.secondary_tooltip,
          dict.generic.ctrl_shortcut,
        )}
        side="top"
        delayDuration={0}
      >
        <NodexPopoverTrigger asChild>
          <button
            type="button"
            className="bn-button"
          data-test="createLink"
          onClick={() => setShowPopover((open) => !open)}
          aria-label={dict.formatting_toolbar.link.tooltip}
          title={dict.formatting_toolbar.link.tooltip}
        >
          <Link className="size-4" />
        </button>
        </NodexPopoverTrigger>
      </NodexTooltip>
      <NodexPopoverContent
        sideOffset={6}
        collisionPadding={8}
        className="w-[16.5rem] gap-0 p-0 overflow-hidden"
      >
        <NfmCreateLinkDialogSurface
          urlLabel={"Page or URL"}
          urlPlaceholder={dict.link_toolbar.form.url_placeholder}
          urlValue={currentUrl}
          submitLabel={dict.formatting_toolbar.link.tooltip}
          onUrlChange={setCurrentUrl}
          onUrlKeyDown={handleUrlKeyDown}
          onSubmit={handleSubmit}
        />
      </NodexPopoverContent>
    </NodexPopover>
  );
}

export interface NfmLinkToolbarProps extends LinkToolbarProps {
  projectWorkspacePath?: string | null;
}

const COPY_FEEDBACK_MS = 1600;

function isOpenableLinkAction(
  action: NfmResolvedLinkAction | null,
): action is Exclude<NfmResolvedLinkAction, { kind: "blocked" | "unresolved-file-like" }> {
  return action !== null
    && action.kind !== "blocked"
    && action.kind !== "unresolved-file-like";
}

export function NfmLinkToolbar(props: NfmLinkToolbarProps) {
  const editor = useBlockNoteEditor();
  const dict = useDictionary();
  const { opener } = useFileLinkOpener();
  const { deleteLink } = useExtension(LinkToolbarExtension);
  const [isEditing, setIsEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const editDialogRef = useRef<HTMLDivElement | null>(null);
  const copyResetTimerRef = useRef<number | null>(null);
  const liveRangeRef = useRef(props.range);
  const action = resolveNfmLinkAction(props.url, props.projectWorkspacePath);
  const tooltip = resolveNfmLinkTooltipLabel(action, false)
    ?? dict.link_toolbar.open.tooltip;
  const canOpen = isOpenableLinkAction(action);
  const {
    currentUrl,
    currentText,
    setCurrentUrl,
    setCurrentText,
  } = useNfmLinkEditorState(props);

  useEffect(() => {
    if (isEditing) return;
    liveRangeRef.current = props.range;
  }, [isEditing, props.range]);

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
    };
  }, []);

  const applyLiveLinkEdit = useCallback((nextUrl: string, nextText: string) => {
    const normalizedUrl = normalizeNfmEditorLinkUrl(nextUrl);
    if (!normalizedUrl) return false;

    liveRangeRef.current = applyNfmLinkEditAtRange(
      editor,
      liveRangeRef.current,
      normalizedUrl,
      nextText,
    );
    return true;
  }, [editor]);

  const closeEditDialog = useCallback((closeToolbar: boolean) => {
    setIsEditing(false);
    props.setToolbarPositionFrozen?.(false);
    if (closeToolbar) props.setToolbarOpen?.(false);
  }, [props]);

  useEffect(() => {
    if (!isEditing) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (editDialogRef.current?.contains(target)) return;
      closeEditDialog(true);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeEditDialog(true);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [closeEditDialog, isEditing]);

  const handleFieldKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeEditDialog(true);
      return;
    }

    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!applyLiveLinkEdit(currentUrl, currentText)) return;
    closeEditDialog(true);
  }, [applyLiveLinkEdit, closeEditDialog, currentText, currentUrl]);

  const handleCopyLink = useCallback(async () => {
    const didCopy = await writeTextToClipboard(props.url);
    if (!didCopy) return;

    if (copyResetTimerRef.current !== null) {
      window.clearTimeout(copyResetTimerRef.current);
    }

    setCopied(true);
    copyResetTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      copyResetTimerRef.current = null;
    }, COPY_FEEDBACK_MS);
  }, [props.url]);

  if (isEditing) {
    return (
      <NfmLinkEditDialogSurface
        ref={editDialogRef}
        urlLabel={"Page or URL"}
        titleLabel={"Link title"}
        urlPlaceholder={dict.link_toolbar.form.url_placeholder}
        titlePlaceholder={dict.link_toolbar.form.title_placeholder}
        urlValue={currentUrl}
        titleValue={currentText}
        removeLabel={dict.link_toolbar.delete.tooltip}
        onUrlChange={(value) => {
          setCurrentUrl(value);
          applyLiveLinkEdit(value, currentText);
        }}
        onTitleChange={(value) => {
          setCurrentText(value);
          applyLiveLinkEdit(currentUrl, value);
        }}
        onUrlKeyDown={handleFieldKeyDown}
        onTitleKeyDown={handleFieldKeyDown}
        onRemoveLink={() => {
          deleteLink(props.range.from);
          closeEditDialog(true);
        }}
      />
    );
  }

  return (
    <NfmCompactLinkToolbar
      href={props.url}
      canOpen={canOpen}
      openTooltip={tooltip}
      copyLabel={"Copy link"}
      copyTooltip={"Copy link"}
      copiedLabel={"Copied"}
      copiedTooltip={"Copied"}
      copyState={copied ? "copied" : "idle"}
      editTooltip={dict.link_toolbar.edit.tooltip}
      editLabel={dict.link_toolbar.edit.tooltip}
      disabledReason={!canOpen ? tooltip : undefined}
      onOpenLink={() => {
        if (!canOpen) return;
        void openNfmResolvedLinkAction(action, opener);
      }}
      onCopyLink={() => {
        void handleCopyLink();
      }}
      onEditLink={() => {
        setIsEditing(true);
        props.setToolbarPositionFrozen?.(true);
      }}
    />
  );
}

export { NfmCreateLinkButton };
