import { cn } from "../../../../lib/utils";

const NODEX_LOGO_MASK_IMAGE = `url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20800%20800%22%20fill%3D%22none%22%3E%3Cpath%20d%3D%22M305%20352L411%20438.203L305%20535%22%20fill%3D%22none%22%20stroke%3D%22black%22%20stroke-width%3D%2250%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3Cpath%20d%3D%22M458.035%20565.638L579.966%20558.361%22%20fill%3D%22none%22%20stroke%3D%22black%22%20stroke-width%3D%2250%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3Cpath%20fill-rule%3D%22evenodd%22%20clip-rule%3D%22evenodd%22%20d%3D%22M516.873%2074.1691L118.087%20101.396C94.1999%20103.027%2075.6836%20122.231%2075.6836%20145.374V533.247C75.6836%20554.992%2083.1691%20576.12%2096.9608%20593.302L182.945%20700.417C196.847%20717.735%20218.725%20727.272%20241.359%20725.88L683.965%20698.635C706.65%20697.237%20724.31%20679.047%20724.31%20657.08V216.106C724.31%20202.514%20717.448%20189.778%20705.923%20181.987L565.813%2087.2568C551.533%2077.6028%20534.255%2072.9823%20516.873%2074.1691ZM137.862%20151.425C132.315%20147.318%20134.955%20138.763%20141.923%20138.264L519.555%20111.177C531.588%20110.314%20543.543%20113.628%20553.273%20120.522L629.043%20174.203C631.918%20176.241%20630.57%20180.64%20627.008%20180.834L227.097%20202.584C214.994%20203.242%20203.048%20199.686%20193.425%20192.562L137.862%20151.425ZM208.339%20270.767C208.339%20257.775%20218.835%20247.044%20232.257%20246.313L655.075%20223.286C668.158%20222.574%20679.168%20232.633%20679.168%20245.295V627.132C679.168%20640.1%20668.71%20650.82%20655.315%20651.582L235.172%20675.487C220.615%20676.317%20208.339%20665.13%20208.339%20651.037V270.767Z%22%20fill%3D%22black%22%2F%3E%3C%2Fsvg%3E")`;

const MASK_STYLE = {
  WebkitMaskImage: NODEX_LOGO_MASK_IMAGE,
  maskImage: NODEX_LOGO_MASK_IMAGE,
  WebkitMaskPosition: "center",
  maskPosition: "center",
  WebkitMaskRepeat: "no-repeat",
  maskRepeat: "no-repeat",
  WebkitMaskSize: "contain",
  maskSize: "contain",
} as const;

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
      <div className="flex flex-col items-center gap-2">
        <div className="relative inline-flex size-14 shrink-0 items-center justify-center">
          <div
            aria-hidden="true"
            className="nodex-logo-shimmer-base absolute inset-0"
            style={MASK_STYLE}
          />
          <div
            aria-hidden="true"
            className="nodex-logo-shimmer-overlay pointer-events-none absolute inset-0"
            style={MASK_STYLE}
          />
        </div>
      </div>
    </div>
  );
}
