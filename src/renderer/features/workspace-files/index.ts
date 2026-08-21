export { WorkspaceFilesPanel } from "./workspace-files-panel";
export { decideWorkspaceFileTabOpen, type WorkspaceFileOpenMode } from "./workspace-file-tab-model";
export {
  getWorkspaceFileDomTabId,
  getWorkspaceFileName,
  isWorkspacePathInsideRoot,
  resolveWorkspaceFilePresentation,
  resolveWorkspaceSourceLanguage,
  WORKSPACE_TEXT_EDITABLE_MAX_BYTES,
  WORKSPACE_TEXT_LOAD_MAX_BYTES,
} from "./workspace-file-model";
export {
  resolveWorkspaceFileTabIcon,
  resolveWorkspaceFileTabIconKey,
  type WorkspaceFileTabIconKey,
} from "./workspace-file-tab-icons";
export type {
  WorkspaceFilesDraftState,
  WorkspaceFilesTab,
  WorkspaceFilesTabState,
} from "./workspace-file-types";
