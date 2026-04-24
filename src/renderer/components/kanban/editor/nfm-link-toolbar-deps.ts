import {
  useBlockNoteEditor,
  useDictionary,
  useEditorState,
  useExtension,
} from "@blocknote/react";
import { writeTextToClipboard } from "@/lib/clipboard";
import {
  openNfmResolvedLinkAction,
  resolveNfmLinkAction,
  resolveNfmLinkTooltipLabel,
} from "@/lib/nfm-link-actions";
import { useFileLinkOpener } from "@/lib/use-file-link-opener";
import {
  NfmCompactLinkToolbar,
  NfmCreateLinkDialogSurface,
  NfmLinkEditDialogSurface,
} from "./nfm-link-toolbar-surface";
import type { LinkToolbarProps } from "@blocknote/react";
import type { NfmResolvedLinkAction } from "@/lib/nfm-link-actions";

export {
  NfmCompactLinkToolbar,
  NfmCreateLinkDialogSurface,
  NfmLinkEditDialogSurface,
  openNfmResolvedLinkAction,
  resolveNfmLinkAction,
  resolveNfmLinkTooltipLabel,
  useBlockNoteEditor,
  useDictionary,
  useEditorState,
  useExtension,
  useFileLinkOpener,
  writeTextToClipboard,
};
export type { LinkToolbarProps, NfmResolvedLinkAction };
