export type MacAppUpdaterCheckKind = "background" | "user";

export type MacAppUpdaterEvent =
  | { readonly type: "check-started"; readonly kind: MacAppUpdaterCheckKind }
  | {
      readonly type: "update-found";
      readonly version: string;
      readonly buildVersion: string;
      readonly releaseName?: string;
      readonly releaseDate?: string;
      readonly releaseNotes?: string;
    }
  | { readonly type: "download-started"; readonly expectedBytes: number | null }
  | {
      readonly type: "download-progress";
      readonly receivedBytes: number;
      readonly expectedBytes: number | null;
    }
  | {
      readonly type: "update-ready";
      readonly version: string;
      readonly buildVersion: string;
      readonly releaseName?: string;
      readonly releaseDate?: string;
      readonly releaseNotes?: string;
    }
  | { readonly type: "installing" }
  | { readonly type: "up-to-date"; readonly version: string }
  | {
      readonly type: "error";
      readonly code: string;
      readonly message: string;
      readonly recoverable: boolean;
    };

export interface MacAppUpdater {
  start(onEvent: (event: MacAppUpdaterEvent) => void): Promise<void>;
  check(kind: MacAppUpdaterCheckKind): Promise<void>;
  installDownloadedUpdate(): Promise<void>;
  dispose(): Promise<void>;
}
