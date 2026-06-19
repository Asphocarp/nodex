import { blockHasType, editorHasBlockWithType } from "@blocknote/core";
import { SideMenuExtension } from "@blocknote/core/extensions";
import {
  DragHandleMenu,
  useBlockNoteEditor,
  useComponentsContext,
  useDictionary,
  useExtensionState,
} from "@blocknote/react";
import type { ReactNode } from "react";
import type { SendBlocksMode } from "./nfm-side-menu-model";

export type { SendBlocksMode } from "./nfm-side-menu-model";

export interface NfmDragHandleMenuComponentProps {
  releaseSideMenuFreeze?: () => void;
}

interface NfmDragHandleMenuProps extends NfmDragHandleMenuComponentProps {
  canSendBlocks: boolean;
  onSendBlocks: (mode: SendBlocksMode, fallbackBlockId: string) => void;
  onConvertDividerToThreadSection: (blockId: string) => void;
}

const BLOCK_COLOR_OPTIONS = [
  "default",
  "gray",
  "brown",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
] as const;

function NfmRemoveBlockItem({
  children,
  releaseSideMenuFreeze,
}: {
  children: ReactNode;
  releaseSideMenuFreeze?: () => void;
}) {
  const components = useComponentsContext();
  const editor = useBlockNoteEditor();
  const block = useExtensionState(SideMenuExtension, {
    selector: (state) => state?.block,
  });

  if (!components || block === undefined) return null;

  return (
    <components.Generic.Menu.Item
      className="bn-menu-item"
      onClick={() => {
        const selectedBlocks = editor.getSelection()?.blocks;
        const blocksToDelete =
          selectedBlocks && selectedBlocks.length > 0 ? selectedBlocks : [block];

        releaseSideMenuFreeze?.();
        editor.removeBlocks(blocksToDelete);
      }}
    >
      {children}
    </components.Generic.Menu.Item>
  );
}

function NfmBlockColorsItem({
  children,
  releaseSideMenuFreeze,
}: {
  children: ReactNode;
  releaseSideMenuFreeze?: () => void;
}) {
  const components = useComponentsContext();
  const dict = useDictionary();
  const editor = useBlockNoteEditor();
  const block = useExtensionState(SideMenuExtension, {
    selector: (state) => state?.block,
  });

  if (!components || block === undefined) return null;

  const supportsTextColor =
    blockHasType(block, editor, block.type, {
      textColor: "string",
    }) &&
    editorHasBlockWithType(editor, block.type, {
      textColor: "string",
    });

  const supportsBackgroundColor =
    blockHasType(block, editor, block.type, {
      backgroundColor: "string",
    }) &&
    editorHasBlockWithType(editor, block.type, {
      backgroundColor: "string",
    });

  if (!supportsTextColor && !supportsBackgroundColor) return null;

  return (
    <components.Generic.Menu.Root position="right" sub={true}>
      <components.Generic.Menu.Trigger sub={true}>
        <components.Generic.Menu.Item
          className="bn-menu-item"
          subTrigger={true}
        >
          {children}
        </components.Generic.Menu.Item>
      </components.Generic.Menu.Trigger>
      <components.Generic.Menu.Dropdown
        sub={true}
        className="bn-menu-dropdown bn-color-picker-dropdown"
      >
        {supportsTextColor && (
          <>
            <components.Generic.Menu.Label>
              {dict.color_picker.text_title}
            </components.Generic.Menu.Label>
            {BLOCK_COLOR_OPTIONS.map((color) => (
              <components.Generic.Menu.Item
                key={`text-color-${color}`}
                checked={block.props.textColor === color}
                onClick={() => {
                  releaseSideMenuFreeze?.();
                  editor.updateBlock(block, {
                    type: block.type,
                    props: { textColor: color },
                  });
                }}
              >
                {dict.color_picker.colors[color]}
              </components.Generic.Menu.Item>
            ))}
          </>
        )}
        {supportsBackgroundColor && (
          <>
            <components.Generic.Menu.Label>
              {dict.color_picker.background_title}
            </components.Generic.Menu.Label>
            {BLOCK_COLOR_OPTIONS.map((color) => (
              <components.Generic.Menu.Item
                key={`background-color-${color}`}
                checked={block.props.backgroundColor === color}
                onClick={() => {
                  releaseSideMenuFreeze?.();
                  editor.updateBlock(block, {
                    props: { backgroundColor: color },
                  });
                }}
              >
                {dict.color_picker.colors[color]}
              </components.Generic.Menu.Item>
            ))}
          </>
        )}
      </components.Generic.Menu.Dropdown>
    </components.Generic.Menu.Root>
  );
}

function NfmTableRowHeaderItem({
  children,
  releaseSideMenuFreeze,
}: {
  children: ReactNode;
  releaseSideMenuFreeze?: () => void;
}) {
  const components = useComponentsContext();
  const editor = useBlockNoteEditor();
  const block = useExtensionState(SideMenuExtension, {
    selector: (state) => state?.block,
  });

  if (
    !components ||
    block === undefined ||
    block.type !== "table" ||
    !editor.settings.tables.headers
  ) {
    return null;
  }

  const tableContent = block.content as {
    headerRows?: number;
    headerCols?: number;
  };
  const isHeaderRow = Boolean(tableContent.headerRows);

  return (
    <components.Generic.Menu.Item
      className="bn-menu-item"
      checked={isHeaderRow}
      onClick={() => {
        releaseSideMenuFreeze?.();
        (editor as { updateBlock: (block: unknown, update: unknown) => void })
          .updateBlock(block, {
            content: {
              ...tableContent,
              headerRows: isHeaderRow ? undefined : 1,
            },
          });
      }}
    >
      {children}
    </components.Generic.Menu.Item>
  );
}

function NfmTableColumnHeaderItem({
  children,
  releaseSideMenuFreeze,
}: {
  children: ReactNode;
  releaseSideMenuFreeze?: () => void;
}) {
  const components = useComponentsContext();
  const editor = useBlockNoteEditor();
  const block = useExtensionState(SideMenuExtension, {
    selector: (state) => state?.block,
  });

  if (
    !components ||
    block === undefined ||
    block.type !== "table" ||
    !editor.settings.tables.headers
  ) {
    return null;
  }

  const tableContent = block.content as {
    headerRows?: number;
    headerCols?: number;
  };
  const isHeaderColumn = Boolean(tableContent.headerCols);

  return (
    <components.Generic.Menu.Item
      className="bn-menu-item"
      checked={isHeaderColumn}
      onClick={() => {
        releaseSideMenuFreeze?.();
        (editor as { updateBlock: (block: unknown, update: unknown) => void })
          .updateBlock(block, {
            content: {
              ...tableContent,
              headerCols: isHeaderColumn ? undefined : 1,
            },
          });
      }}
    >
      {children}
    </components.Generic.Menu.Item>
  );
}

function NfmDefaultDragHandleMenuItems({
  releaseSideMenuFreeze,
}: NfmDragHandleMenuComponentProps) {
  const dict = useDictionary();

  return (
    <>
      <NfmRemoveBlockItem releaseSideMenuFreeze={releaseSideMenuFreeze}>
        {dict.drag_handle.delete_menuitem}
      </NfmRemoveBlockItem>
      <NfmBlockColorsItem releaseSideMenuFreeze={releaseSideMenuFreeze}>
        {dict.drag_handle.colors_menuitem}
      </NfmBlockColorsItem>
      <NfmTableRowHeaderItem releaseSideMenuFreeze={releaseSideMenuFreeze}>
        {dict.drag_handle.header_row_menuitem}
      </NfmTableRowHeaderItem>
      <NfmTableColumnHeaderItem releaseSideMenuFreeze={releaseSideMenuFreeze}>
        {dict.drag_handle.header_column_menuitem}
      </NfmTableColumnHeaderItem>
    </>
  );
}

export function NfmDefaultDragHandleMenu(
  props: NfmDragHandleMenuComponentProps,
) {
  return (
    <DragHandleMenu>
      <NfmDefaultDragHandleMenuItems {...props} />
    </DragHandleMenu>
  );
}

export function NfmDragHandleMenu({
  canSendBlocks,
  onSendBlocks,
  onConvertDividerToThreadSection,
  releaseSideMenuFreeze,
}: NfmDragHandleMenuProps) {
  const components = useComponentsContext();
  const block = useExtensionState(SideMenuExtension, {
    selector: (state) => state?.block,
  });

  const currentBlockId = block?.id;
  const showSendBlocks = canSendBlocks && typeof currentBlockId === "string" && currentBlockId.length > 0;
  const showConvertDivider = block?.type === "divider" && typeof currentBlockId === "string" && currentBlockId.length > 0;

  return (
    <DragHandleMenu>
      {showConvertDivider && components && (
        <>
          <components.Generic.Menu.Item
            className="bn-menu-item"
            onClick={() => {
              releaseSideMenuFreeze?.();
              onConvertDividerToThreadSection(currentBlockId);
            }}
          >
            Convert to thread section
          </components.Generic.Menu.Item>
          <components.Generic.Menu.Divider />
        </>
      )}
      {showSendBlocks && components && (
        <>
          <components.Generic.Menu.Root position="right" sub={true}>
            <components.Generic.Menu.Trigger sub={true}>
              <components.Generic.Menu.Item
                className="bn-menu-item"
                subTrigger={true}
              >
                Send blocks
              </components.Generic.Menu.Item>
            </components.Generic.Menu.Trigger>
            <components.Generic.Menu.Dropdown
              sub={true}
              className="bn-menu-dropdown"
            >
              <components.Generic.Menu.Item
                className="bn-menu-item"
                onClick={() => {
                  releaseSideMenuFreeze?.();
                  onSendBlocks("card", currentBlockId);
                }}
              >
                Append to card...
              </components.Generic.Menu.Item>
              <components.Generic.Menu.Item
                className="bn-menu-item"
                onClick={() => {
                  releaseSideMenuFreeze?.();
                  onSendBlocks("project", currentBlockId);
                }}
              >
                Turn into cards...
              </components.Generic.Menu.Item>
            </components.Generic.Menu.Dropdown>
          </components.Generic.Menu.Root>
          <components.Generic.Menu.Divider />
        </>
      )}
      <NfmDefaultDragHandleMenuItems
        releaseSideMenuFreeze={releaseSideMenuFreeze}
      />
    </DragHandleMenu>
  );
}
