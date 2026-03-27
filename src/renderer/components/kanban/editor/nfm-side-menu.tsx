import { SideMenuExtension, SuggestionMenu } from "@blocknote/core/extensions";
import {
  useBlockNoteEditor,
  useComponentsContext,
  useDictionary,
  useExtension,
  useExtensionState,
} from "@blocknote/react";
import { GripVertical, Plus } from "lucide-react";
import {
  useCallback,
  useMemo,
  useRef,
  type ComponentType,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  NfmDefaultDragHandleMenu,
  type NfmDragHandleMenuComponentProps,
} from "./nfm-drag-handle-menu";
import { resolveCardRefOwnerDragBlock } from "./side-menu-drag-target";

interface SideMenuBlock {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
}

interface SideMenuEditorRuntime {
  getBlock: (blockId: string) => unknown;
  getParentBlock: (blockId: string) => unknown;
  schema: {
    blockSpecs: Record<string, { implementation: { meta?: { fileBlockAccept?: boolean } } }>;
  };
}

interface NfmSideMenuProps {
  dragHandleMenu?: ComponentType<NfmDragHandleMenuComponentProps>;
}

function toStringProp(props: Record<string, unknown> | undefined, key: string): string {
  const value = props?.[key];
  return typeof value === "string" ? value : "";
}

function toNumberProp(props: Record<string, unknown> | undefined, key: string): number | null {
  const value = props?.[key];
  return typeof value === "number" ? value : null;
}

interface SideMenuButtonProps {
  label: string;
  className?: string;
  icon?: ReactNode;
  onClick?: () => void;
  onPointerUp?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onDragStart?: (event: { dataTransfer: DataTransfer | null; clientY: number }) => void;
  onDragEnd?: () => void;
  draggable?: boolean;
}

function NfmAddBlockButton() {
  const Components = useComponentsContext()!;
  const dict = useDictionary();
  const editor = useBlockNoteEditor();
  const suggestionMenu = useExtension(SuggestionMenu);
  const SideMenuButton = Components.SideMenu.Button as unknown as (props: SideMenuButtonProps) => ReactNode;
  type CursorTarget = Parameters<typeof editor.setTextCursorPosition>[0];
  const lastPointerActivationAtRef = useRef<number | null>(null);
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  }) as (CursorTarget & { content?: unknown[] }) | undefined;

  const activateAddBlock = useCallback(() => {
    if (!block) return;

    const blockContent = Array.isArray(block.content) ? block.content : [];
    if (blockContent.length === 0) {
      editor.setTextCursorPosition(block);
      suggestionMenu.openSuggestionMenu("/");
      return;
    }

    const insertedBlock = editor.insertBlocks([{ type: "paragraph" }], block, "after")[0];
    if (!insertedBlock) return;

    editor.setTextCursorPosition(insertedBlock);
    suggestionMenu.openSuggestionMenu("/");
  }, [block, editor, suggestionMenu]);

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;

    lastPointerActivationAtRef.current = performance.now();
    activateAddBlock();
  }, [activateAddBlock]);

  const handleClick = useCallback(() => {
    const lastPointerActivationAt = lastPointerActivationAtRef.current;
    if (lastPointerActivationAt !== null && performance.now() - lastPointerActivationAt < 500) {
      lastPointerActivationAtRef.current = null;
      return;
    }

    activateAddBlock();
  }, [activateAddBlock]);

  if (!block) return null;

  return (
    <SideMenuButton
      className="bn-button"
      label={dict.side_menu.add_block_label}
      onClick={handleClick}
      onPointerUp={handlePointerUp}
      icon={
        <span className="pointer-events-none" data-test="dragHandleAdd">
          <Plus size={18} />
        </span>
      }
    />
  );
}

export function NfmSideMenu(props: NfmSideMenuProps) {
  const Components = useComponentsContext()!;
  const dict = useDictionary();
  const sideMenu = useExtension(SideMenuExtension);
  const editor = useBlockNoteEditor();
  const SideMenuButton = Components.SideMenu.Button as unknown as (props: SideMenuButtonProps) => ReactNode;
  const block = useExtensionState(SideMenuExtension, {
    selector: (state) => state?.block,
  }) as unknown as SideMenuBlock | undefined;

  const runtimeEditor = editor as unknown as SideMenuEditorRuntime;
  const dragTargetBlock = useMemo(
    () => (block ? resolveCardRefOwnerDragBlock(runtimeEditor, block) : block),
    [block, runtimeEditor],
  ) as SideMenuBlock | undefined;

  const dataAttributes = useMemo(() => {
    if (!block) return {};

    const attrs: Record<string, string> = {
      "data-block-type": block.type ?? "",
    };

    if (block.type === "heading") {
      const level = toNumberProp(block.props, "level");
      if (level !== null) attrs["data-level"] = level.toString();
    }

    if (
      block.type
      && runtimeEditor.schema.blockSpecs[block.type]?.implementation?.meta?.fileBlockAccept
    ) {
      attrs["data-url"] = toStringProp(block.props, "url").length > 0 ? "true" : "false";
    }

    return attrs;
  }, [block, runtimeEditor.schema.blockSpecs]);

  if (!block || !dragTargetBlock) return null;

  const DragHandleMenuComponent = props.dragHandleMenu ?? NfmDefaultDragHandleMenu;

  return (
    <Components.SideMenu.Root className="bn-side-menu" {...dataAttributes}>
      <NfmAddBlockButton />
      <Components.Generic.Menu.Root
        onOpenChange={(open: boolean) => {
          if (open) {
            sideMenu.freezeMenu();
            return;
          }
          sideMenu.unfreezeMenu();
        }}
        position="left"
      >
        <Components.Generic.Menu.Trigger>
          <SideMenuButton
            label={dict.side_menu.drag_handle_label}
            draggable={true}
            onDragStart={(event: { dataTransfer: DataTransfer | null; clientY: number }) =>
              sideMenu.blockDragStart(event, dragTargetBlock as never)
            }
            onDragEnd={sideMenu.blockDragEnd}
            className="bn-button"
            icon={<GripVertical size={24} data-test="dragHandle" />}
          />
        </Components.Generic.Menu.Trigger>
        <DragHandleMenuComponent
          releaseSideMenuFreeze={() => {
            sideMenu.unfreezeMenu();
          }}
        />
      </Components.Generic.Menu.Root>
    </Components.SideMenu.Root>
  );
}
