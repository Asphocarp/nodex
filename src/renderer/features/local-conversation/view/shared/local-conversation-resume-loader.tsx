import { cn } from "../../../../lib/utils";
import { NodexLogoShimmer } from "../../../../components/ui/nodex-logo-shimmer";

interface LocalConversationResumeLoaderProps {
  title: string;
  description: string;
  fillParent?: boolean;
}

export function LocalConversationResumeLoader({
  title,
  description,
  fillParent = false,
}: LocalConversationResumeLoaderProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${title}. ${description}`}
      className={cn(
        "flex items-center justify-center",
        fillParent ? "absolute inset-0" : "flex-1",
      )}
    >
      <NodexLogoShimmer />
    </div>
  );
}
