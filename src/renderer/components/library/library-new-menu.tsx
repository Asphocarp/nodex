import type { ReactElement } from "react";

import { CodexDatabaseIcon, CodexPageIcon } from "@/components/shared/icons";
import {
  NodexDropdownItem,
  NodexDropdownMenu,
} from "@/components/ui/dropdown";
import { toast } from "@/components/ui/toast";
import { useApplyLibraryOperation } from "@/lib/use-library-navigation";
import {
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
} from "../../../shared/database-identities";
import type {
  LibraryRouteTarget,
  LibraryWriteParent,
} from "../../../shared/library-module";
import { createUuidV7 } from "../../../shared/uuid-v7";

export function LibraryNewMenu({
  triggerButton,
  parent = { kind: "library" },
  onCreated,
}: {
  readonly triggerButton: ReactElement;
  readonly parent?: LibraryWriteParent;
  readonly onCreated: (target: LibraryRouteTarget) => void;
}) {
  const { mutation } = useApplyLibraryOperation();

  const createPage = async () => {
    try {
      const receipt = await mutation.mutateAsync({
        kind: "create_page",
        pageId: createUuidV7(),
        documentId: createUuidV7(),
        title: "Untitled",
        parent,
      });
      if (receipt.createdTarget) onCreated(receipt.createdTarget);
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : "Could not create Page");
    }
  };

  const createDatabase = async () => {
    try {
      const receipt = await mutation.mutateAsync({
        kind: "create_database",
        databaseId: parseDatabaseId(createUuidV7()),
        dataSourceId: parseDataSourceId(createUuidV7()),
        viewId: parseDatabaseViewId(createUuidV7()),
        name: "Untitled",
        parent,
      });
      if (receipt.createdTarget) onCreated(receipt.createdTarget);
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : "Could not create Database");
    }
  };

  return (
    <NodexDropdownMenu
      triggerButton={triggerButton}
      disabled={mutation.isPending}
      align="end"
      contentWidth="sm"
    >
      <NodexDropdownItem
        leftSlot={<CodexPageIcon />}
        onSelect={() => void createPage()}
      >
        Page
      </NodexDropdownItem>
      <NodexDropdownItem
        leftSlot={<CodexDatabaseIcon />}
        onSelect={() => void createDatabase()}
      >
        Database
      </NodexDropdownItem>
    </NodexDropdownMenu>
  );
}
