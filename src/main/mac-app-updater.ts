export type MacAppUpdaterCheckKind = "background" | "user";
export type AppUpdateChannel = "stable" | "nightly";

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

/** Synchronous capability exposed by one Scope-owned native Sparkle lease. */
export interface MacAppUpdaterSession {
  readonly check: (kind: MacAppUpdaterCheckKind) => void;
  readonly installDownloadedUpdate: () => void;
  readonly setChannel: (channel: AppUpdateChannel) => void;
}

/**
 * Stateless packaged-runtime descriptor. Acquiring it creates the only native
 * updater lease; the caller must register `release` in its owning Scope.
 */
export interface MacAppUpdaterPlatform {
  readonly buildDefaultChannel: AppUpdateChannel;
  readonly acquire: (
    channel: AppUpdateChannel,
    onEvent: (event: MacAppUpdaterEvent) => void,
  ) => {
    readonly release: () => void;
    readonly session: MacAppUpdaterSession;
  };
}
