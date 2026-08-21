import type { NfmSendToThreadMode } from "./nfm-send-to-thread-menu-model";

export const NFM_SEND_TO_THREAD_MODE_STORAGE_KEY = "nodex-nfm-send-to-thread-mode-v1";
export const DEFAULT_NFM_SEND_TO_THREAD_MODE: NfmSendToThreadMode = "send";

export function normalizeNfmSendToThreadMode(value: unknown): NfmSendToThreadMode {
  return value === "send" || value === "wrap-toggle" ? value : DEFAULT_NFM_SEND_TO_THREAD_MODE;
}

export function readNfmSendToThreadMode(): NfmSendToThreadMode {
  if (typeof localStorage === "undefined") {
    return DEFAULT_NFM_SEND_TO_THREAD_MODE;
  }

  try {
    return normalizeNfmSendToThreadMode(localStorage.getItem(NFM_SEND_TO_THREAD_MODE_STORAGE_KEY));
  } catch {
    return DEFAULT_NFM_SEND_TO_THREAD_MODE;
  }
}

export function writeNfmSendToThreadMode(value: unknown): NfmSendToThreadMode {
  const normalized = normalizeNfmSendToThreadMode(value);
  if (typeof localStorage === "undefined") {
    return normalized;
  }

  try {
    localStorage.setItem(NFM_SEND_TO_THREAD_MODE_STORAGE_KEY, normalized);
  } catch {
    // localStorage may be unavailable.
  }

  return normalized;
}
