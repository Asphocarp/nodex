import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const EDITOR_NOTICE_DISMISS_MS = 2800;

export interface EditorNoticeState {
  type: "info" | "error";
  message: string;
}

export type ShowEditorNotice = (
  type: EditorNoticeState["type"],
  message: string,
) => void;

export function useTransientEditorNotice() {
  const [notice, setNotice] = useState<EditorNoticeState | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const showNotice = useCallback<ShowEditorNotice>((type, message) => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }

    setNotice({ type, message });
    timeoutRef.current = window.setTimeout(() => {
      setNotice(null);
      timeoutRef.current = null;
    }, EDITOR_NOTICE_DISMISS_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return {
    notice,
    showNotice,
  };
}

export function EditorNoticeSurface({ notice }: { notice: EditorNoticeState | null }) {
  if (!notice) return null;

  return (
    <div className="pointer-events-none absolute right-3 bottom-3 z-30">
      <div
        className={cn(
          "max-w-80 rounded-lg border px-3 py-2 text-xs shadow-card-md",
          notice.type === "error"
            ? "border-(--red-border) bg-(--red-bg) text-(--red-text)"
            : "border-(--border) bg-(--background) text-(--foreground-secondary)",
        )}
      >
        {notice.message}
      </div>
    </div>
  );
}
