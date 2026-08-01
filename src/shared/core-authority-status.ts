export type CoreAuthorityStatus =
  | { readonly kind: "ready" }
  | {
    readonly attempt: number;
    readonly kind: "recovering";
  }
  | {
    readonly circuitOpen: boolean;
    readonly kind: "unavailable";
    readonly message: string;
  };

export const CORE_AUTHORITY_STATUS_CHANNEL = "app:core-authority-status";
export const GET_CORE_AUTHORITY_STATUS_CHANNEL = "app:get-core-authority-status";
export const RETRY_CORE_AUTHORITY_CHANNEL = "app:retry-core-authority";
export const RELAUNCH_FOR_CORE_AUTHORITY_CHANNEL = "app:relaunch-for-core-authority";
