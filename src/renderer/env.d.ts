import type {
  AppInitializationStep,
  DatabaseMigrationProgress,
} from "../shared/app-startup";
import type {
  AppUpdateStatus,
  ClipboardPastePayload,
  ClipboardPasteInspectionItem,
  ClipboardPasteInspectionResult,
} from "../shared/types";
import type {
  NativeContextMenuItem,
  NativeContextMenuOptions,
} from "../shared/native-context-menu";

declare module "*.css";

declare global {
  interface ImportMetaEnv {
    readonly MODE: string;
    readonly DEV: boolean;
    readonly PROD: boolean;
    readonly SSR: boolean;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }

  interface Window {
    api?: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      on: (event: string, callback: (...args: unknown[]) => void) => () => void;
      onAppUpdateStatus?: (callback: (status: AppUpdateStatus) => void) => () => void;
      awaitInitialization?: () => Promise<void>;
      onInitializationStep?: (
        callback: (step: AppInitializationStep) => void,
      ) => () => void;
      onDatabaseMigrationProgress?: (
        callback: (progress: DatabaseMigrationProgress) => void,
      ) => () => void;
      onNavigateBack?: (callback: () => void) => () => void;
      onNavigateForward?: (callback: () => void) => () => void;
      onToggleSidebar?: (callback: () => void) => () => void;
      onCyclePanelTabPrevious?: (callback: () => void) => () => void;
      onCyclePanelTabNext?: (callback: () => void) => () => void;
      requestMicrophonePermission?: () => void;
      serverUrl?: string;
      assetPathPrefix?: string;
      inspectPasteClipboard?: () => ClipboardPasteInspectionResult;
      readPasteClipboard?: () => ClipboardPastePayload;
      getPathInfoForFile?: (file: File) => ClipboardPasteInspectionItem | null;
      getPathForFile?: (file: File) => string;
    };
    electronBridge?: {
      showContextMenu: (
        items: NativeContextMenuItem[],
        options?: NativeContextMenuOptions,
      ) => Promise<string | null>;
    };
  }
}

export {};
