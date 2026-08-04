import { AlertCircle } from "@/components/shared/icons/generic-icons";
import { cn } from "@/lib/utils";

export function PropertyEditorFeedback({
  message,
  className,
}: {
  readonly message: string;
  readonly className?: string;
}) {
  return (
    <p
      role="alert"
      aria-atomic="true"
      className={cn(
        "mt-0.5 flex min-w-0 items-center gap-1 text-xs text-token-error-foreground",
        className,
      )}
    >
      <AlertCircle className="size-3 shrink-0" />
      <span className="min-w-0 truncate">{message}</span>
    </p>
  );
}
