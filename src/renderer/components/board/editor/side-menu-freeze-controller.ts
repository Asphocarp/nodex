interface SideMenuFreezeRuntime {
  freezeMenu: () => void;
  unfreezeMenu: () => void;
}

interface SideMenuBlockRemovingEditor<Block> {
  removeBlocks: (blocks: Block[]) => unknown;
}

export interface SideMenuFreezeController {
  /** Acquires one idempotently releasable interaction lease. */
  acquire: () => () => void;
  handleMenuOpenChange: (open: boolean) => void;
  release: () => void;
  releaseAll: () => void;
}

export function createSideMenuFreezeController(
  sideMenu: SideMenuFreezeRuntime,
): SideMenuFreezeController {
  let menuOpen = false;
  const leases = new Set<symbol>();
  let runtimeFrozen = false;

  const syncRuntime = () => {
    const shouldFreeze = menuOpen || leases.size > 0;
    if (shouldFreeze === runtimeFrozen) return;
    runtimeFrozen = shouldFreeze;
    if (shouldFreeze) {
      sideMenu.freezeMenu();
      return;
    }
    sideMenu.unfreezeMenu();
  };

  return {
    acquire() {
      const lease = Symbol("side-menu-freeze");
      leases.add(lease);
      syncRuntime();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        leases.delete(lease);
        syncRuntime();
      };
    },
    handleMenuOpenChange(open) {
      menuOpen = open;
      syncRuntime();
    },
    release() {
      menuOpen = false;
      syncRuntime();
    },
    releaseAll() {
      menuOpen = false;
      leases.clear();
      syncRuntime();
    },
  };
}

export function deleteSideMenuBlock<Block>(options: {
  block: Block;
  editor: SideMenuBlockRemovingEditor<Block>;
  releaseSideMenuFreeze: () => void;
}): void {
  options.releaseSideMenuFreeze();
  options.editor.removeBlocks([options.block]);
}
