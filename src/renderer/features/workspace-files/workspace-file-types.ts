import type { ProjectSessionTab, WorkspaceFileDirectoryEntry, WorkspaceFileMetadata } from "@/lib/types";

export type WorkspaceFilesTab = ProjectSessionTab & {
  preview?: true;
  config: {
    projectId: string;
    hostId?: "local";
    workspaceRoot?: string;
    path?: string;
  };
};

export interface WorkspaceFileTreeNode {
  entry: WorkspaceFileDirectoryEntry;
  level: number;
}

export interface WorkspaceFilePreviewState {
  status: "idle" | "loading" | "loaded" | "unsupported" | "error";
  path: string | null;
  metadata: WorkspaceFileMetadata | null;
  content: string;
  binaryUrl: string | null;
  message: string | null;
}
