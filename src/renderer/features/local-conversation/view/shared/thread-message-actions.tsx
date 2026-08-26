import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";
import { NodexTooltip } from "./thread-message-actions-deps";
import { CheckmarkIcon } from "../../../../components/shared/icons";
import { cn } from "../../../../lib/utils";
import { writeTextToClipboard } from "../../../../lib/clipboard";
import { formatThreadMessageTimestamp } from "./thread-message-timestamp";

const USER_COPY_FEEDBACK_MS = 1500;
const ASSISTANT_COPY_FEEDBACK_MS = 2000;
const electronMessageActionSvgSizeClassName = "electron:[&>svg]:icon-sm";

export const threadMessageActionButtonClassName = `
  border-token-border no-drag cursor-interaction flex items-center
  gap-1 border whitespace-nowrap focus:outline-none disabled:cursor-not-allowed
  disabled:opacity-40 rounded-full electron:rounded-md text-token-text-tertiary
  enabled:hover:bg-token-list-hover-background data-[state=open]:bg-token-list-hover-background
  border-transparent electron:p-1 ${electronMessageActionSvgSizeClassName}
  flex items-center justify-center p-0.5 select-none
`;

const threadMessageActionButtonActiveClassName = `
  text-token-foreground enabled:hover:bg-token-list-hover-background
  data-[state=open]:bg-token-list-hover-background border-transparent
`;

interface ThreadActionIconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type"
> {
  label: string;
  children: ReactNode;
  active?: boolean;
  state?: "open" | "closed";
  tooltip?: ReactNode;
}

export function ThreadActionIconButton({
  label,
  children,
  active = false,
  className,
  state = "closed",
  tooltip,
  ...props
}: ThreadActionIconButtonProps) {
  const button = (
    <button
      type="button"
      className={cn(
        threadMessageActionButtonClassName,
        active && threadMessageActionButtonActiveClassName,
        className,
      )}
      aria-label={label}
      data-state={state}
      {...props}
    >
      {children}
    </button>
  );

  if (!tooltip) return button;

  return (
    <NodexTooltip tooltipContent={tooltip} side="top" delay={0}>
      {button}
    </NodexTooltip>
  );
}

export function ThreadMessageActionRow({
  align,
  className,
  children,
}: {
  align: "start" | "end";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        align === "end"
          ? "mr-1 ms-1 flex items-center gap-2 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
          : "extension:-translate-x-1.5 electron:-translate-x-2 mt-1.5 flex h-5 items-center justify-start gap-0.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function MessageTimestamp({
  sentAtMs,
  nowMs,
}: {
  sentAtMs: number | null | undefined;
  nowMs?: number;
}) {
  const timestampText = formatThreadMessageTimestamp(sentAtMs, nowMs);
  if (timestampText === null) return null;

  return (
    <span className="ml-1.5 flex h-full shrink-0 items-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
      <span className="whitespace-nowrap text-xs leading-5 text-token-text-tertiary">
        {timestampText}
      </span>
    </span>
  );
}

export function CopyMessageIcon({ className }: { className?: string }) {
  return (
    <svg
      width="21"
      height="21"
      viewBox="0 0 21 21"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("icon-xs", className)}
      aria-hidden="true"
    >
      <path
        d="M13.468 11.1216C13.468 10.4107 13.468 9.91717 13.4367 9.53369C13.4137 9.25191 13.3758 9.0622 13.3244 8.91846L13.2687 8.78858C13.1148 8.48652 12.8803 8.23344 12.593 8.05713L12.466 7.98584C12.308 7.90546 12.0963 7.84854 11.7209 7.81787C11.3374 7.78656 10.8439 7.78662 10.133 7.78662H7.29999C6.58895 7.78662 6.09562 7.78654 5.7121 7.81787C5.43015 7.84091 5.24064 7.87872 5.09686 7.93018L4.96698 7.98584C4.66487 8.13977 4.41184 8.37419 4.23554 8.66162L4.16522 8.78858C4.08477 8.94657 4.02794 9.15811 3.99725 9.53369C3.96594 9.91718 3.96503 10.4107 3.96503 11.1216V13.9546C3.96503 14.6656 3.96592 15.159 3.99725 15.5425C4.02796 15.9182 4.08471 16.1296 4.16522 16.2876L4.23554 16.4136C4.41185 16.7012 4.66472 16.9353 4.96698 17.0894L5.09686 17.146C5.24061 17.1974 5.43024 17.2343 5.7121 17.2573C6.09562 17.2887 6.58895 17.2896 7.29999 17.2896H10.133C10.8439 17.2896 11.3374 17.2886 11.7209 17.2573C12.0965 17.2266 12.308 17.1698 12.466 17.0894L12.593 17.019C12.8804 16.8427 13.1148 16.5897 13.2687 16.2876L13.3244 16.1577C13.3759 16.0139 13.4137 15.8244 13.4367 15.5425C13.468 15.159 13.468 14.6656 13.468 13.9546V11.1216ZM14.798 13.1196C15.2528 13.118 15.6011 13.1147 15.8879 13.0913C16.2634 13.0606 16.475 13.0038 16.633 12.9233L16.759 12.8521C17.0466 12.6757 17.2808 12.4228 17.4348 12.1206L17.4914 11.9907C17.5428 11.847 17.5797 11.6572 17.6027 11.3755C17.634 10.992 17.6349 10.4985 17.6349 9.7876V6.95459C17.6349 6.24355 17.6341 5.75022 17.6027 5.3667C17.5797 5.08484 17.5428 4.89522 17.4914 4.75147L17.4348 4.62158C17.2807 4.31933 17.0466 4.06645 16.759 3.89014L16.633 3.81982C16.475 3.73932 16.2636 3.68256 15.8879 3.65186C15.5044 3.62052 15.011 3.61963 14.3 3.61963H11.467C10.7561 3.61963 10.2626 3.62054 9.87909 3.65186C9.59738 3.67487 9.40759 3.71179 9.26386 3.76318L9.13397 3.81982C8.83175 3.97382 8.57885 4.20802 8.40253 4.49561L8.33124 4.62158C8.25079 4.77957 8.19396 4.99114 8.16327 5.3667C8.13984 5.65352 8.13561 6.00178 8.13397 6.45654H10.133C10.822 6.45654 11.3791 6.4559 11.8293 6.49268C12.2873 6.5301 12.6937 6.6093 13.0705 6.80127L13.2883 6.92334C13.7839 7.22739 14.1878 7.66313 14.4533 8.18408L14.5197 8.32666C14.6642 8.66318 14.7291 9.02433 14.7619 9.42529C14.7987 9.8755 14.798 10.4326 14.798 11.1216V13.1196ZM18.965 9.7876C18.965 10.4766 18.9657 11.0337 18.9289 11.4839C18.8961 11.8848 18.8311 12.246 18.6867 12.5825L18.6203 12.7251C18.3548 13.246 17.9509 13.6818 17.4553 13.9858L17.2365 14.1079C16.8599 14.2998 16.4541 14.3791 15.9963 14.4165C15.6592 14.444 15.2624 14.4481 14.7951 14.4497C14.7935 14.917 14.7894 15.3138 14.7619 15.6509C14.7292 16.0516 14.664 16.4122 14.5197 16.7485L14.4533 16.8911C14.1878 17.4122 13.7841 17.8487 13.2883 18.1528L13.0705 18.2749C12.6937 18.4669 12.2873 18.5461 11.8293 18.5835C11.3791 18.6203 10.822 18.6196 10.133 18.6196H7.29999C6.6109 18.6196 6.05394 18.6203 5.6037 18.5835C5.20305 18.5508 4.84233 18.4855 4.50604 18.3413L4.36347 18.2749C3.84243 18.0094 3.40584 17.6056 3.10175 17.1099L2.97968 16.8911C2.78787 16.5145 2.70849 16.1087 2.67108 15.6509C2.6343 15.2006 2.63495 14.6437 2.63495 13.9546V11.1216C2.63495 10.4326 2.63431 9.8755 2.67108 9.42529C2.7085 8.96729 2.78771 8.56084 2.97968 8.18408L3.10175 7.96631C3.40585 7.47049 3.84235 7.06679 4.36347 6.80127L4.50604 6.73486C4.84236 6.59059 5.20302 6.52542 5.6037 6.49268C5.9405 6.46516 6.33707 6.4601 6.80389 6.4585C6.8055 5.99167 6.81056 5.5951 6.83807 5.2583C6.87549 4.80047 6.95482 4.39471 7.14667 4.01807L7.26874 3.79932C7.5728 3.30371 8.00855 2.89973 8.52948 2.63428L8.67206 2.56787C9.00854 2.42345 9.36978 2.35844 9.77069 2.32568C10.2209 2.28891 10.778 2.28955 11.467 2.28955H14.3C14.9891 2.28955 15.546 2.2889 15.9963 2.32568C16.4541 2.3631 16.8599 2.44247 17.2365 2.63428L17.4553 2.75635C17.951 3.06044 18.3548 3.49703 18.6203 4.01807L18.6867 4.16065C18.8309 4.49694 18.8962 4.85765 18.9289 5.2583C18.9657 5.70854 18.965 6.2655 18.965 6.95459V9.7876Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function CopyMessageActionButton({
  text,
  getText,
  label = "Copy message",
  copiedLabel = "Copied",
  tooltipLabel = "Copy",
  copiedTooltipLabel = "Copied",
  feedbackMs = ASSISTANT_COPY_FEEDBACK_MS,
  disabledWhenCopied = false,
  stopPropagation = false,
  className,
}: {
  text?: string;
  getText?: () => string;
  label?: string;
  copiedLabel?: string;
  tooltipLabel?: string;
  copiedTooltipLabel?: string;
  feedbackMs?: number;
  disabledWhenCopied?: boolean;
  stopPropagation?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    const didCopy = await writeTextToClipboard(getText?.() ?? text ?? "");
    if (!didCopy) return;

    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }

    setCopied(true);
    resetTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      resetTimerRef.current = null;
    }, feedbackMs);
  };

  return (
    <ThreadActionIconButton
      label={copied ? copiedLabel : label}
      tooltip={copied ? copiedTooltipLabel : tooltipLabel}
      className={cn(copied && "bg-token-foreground/10 text-token-foreground", className)}
      disabled={disabledWhenCopied && copied}
      state={copied ? "open" : "closed"}
      onClick={(event) => {
        if (stopPropagation) {
          event.stopPropagation();
        }
        void handleCopy();
      }}
    >
      {copied ? <CheckmarkIcon className="icon-xs" /> : <CopyMessageIcon />}
    </ThreadActionIconButton>
  );
}

export function EditMessageIcon({ className }: { className?: string }) {
  return (
    <svg
      width="21"
      height="21"
      viewBox="0 0 21 21"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("icon-xs", className)}
      aria-hidden="true"
    >
      <path
        d="M11.7313 4.20472C13.1489 2.92391 15.3377 2.96644 16.7039 4.33265L16.8318 4.46742C18.0713 5.8393 18.0713 7.93343 16.8318 9.30531L16.7039 9.44007L10.4119 15.7311C10.0884 16.0546 9.85387 16.2917 9.62188 16.4821L9.3875 16.6588C9.18236 16.799 8.96432 16.9196 8.73711 17.0192L8.50762 17.1119C8.32585 17.1785 8.13845 17.2266 7.92168 17.2711L7.15703 17.4069L4.76348 17.8053C4.62062 17.8291 4.46916 17.8552 4.34063 17.8649C4.24185 17.8723 4.10835 17.875 3.9627 17.8395L3.81426 17.7907C3.59124 17.695 3.40749 17.5271 3.2918 17.316L3.2459 17.2223C3.1596 17.0209 3.16176 16.8276 3.17168 16.6959C3.18138 16.5674 3.20744 16.4159 3.23125 16.2731L3.62969 13.8795L3.76445 13.1149C3.80902 12.898 3.85797 12.7108 3.92461 12.5289L4.01738 12.2985C4.11693 12.0715 4.23774 11.854 4.37774 11.6491L4.55352 11.4147C4.74395 11.1825 4.98173 10.9484 5.30547 10.6246L11.5965 4.33265L11.7313 4.20472ZM6.2459 11.5651C5.89673 11.9142 5.71261 12.0998 5.58672 12.2526L5.47539 12.3991C5.38197 12.5358 5.30159 12.6812 5.23516 12.8327L5.17363 12.9869C5.1333 13.0971 5.1025 13.2125 5.06817 13.3815L4.94121 14.0983L4.54277 16.4918L4.5418 16.4938H4.54473L6.93828 16.0944L7.65508 15.9684C7.82408 15.9341 7.93949 15.9033 8.04961 15.8629L8.20293 15.8014C8.35464 15.7349 8.49956 15.6538 8.63652 15.5602L8.78399 15.4498C8.93677 15.3239 9.12233 15.1398 9.47149 14.7907L14.4588 9.80238L11.2332 6.57679L6.2459 11.5651ZM15.7635 5.27308C14.9282 4.43776 13.6058 4.38573 12.7098 5.11683L12.5369 5.27308L12.1736 5.63636L15.4002 8.86195L15.7635 8.49964L15.9197 8.32581C16.6016 7.48961 16.6016 6.28311 15.9197 5.44691L15.7635 5.27308Z"
        fill="currentColor"
      />
    </svg>
  );
}

export type AssistantMessageRating = "thumbs_up" | "thumbs_down";

export function ThumbRatingIcon({ className }: { className?: string }) {
  return (
    <svg
      width={20}
      height={21}
      viewBox="0 0 20 21"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("icon-xs", className)}
      aria-hidden="true"
    >
      <path
        d="M10.9153 2.11274L11.2942 2.16059L11.4749 2.18794C13.2633 2.51488 14.4107 4.29005 13.9749 6.05513L13.9261 6.23188L13.3987 7.94477C13.7708 7.94862 14.0961 7.95676 14.3792 7.97895C14.8737 8.01773 15.3109 8.10046 15.7015 8.3061L15.8528 8.39106C16.5966 8.8364 17.1278 9.56913 17.3167 10.4204L17.347 10.5825C17.403 10.9628 17.3647 11.3561 17.2835 11.7827C17.2375 12.0246 17.1735 12.2941 17.096 12.5961L16.8255 13.6049L16.4456 15.0004C16.2076 15.873 16.0438 16.5085 15.7366 17.0034L15.595 17.2075C15.2989 17.5908 14.9197 17.9009 14.4866 18.1137L14.2982 18.1987C13.6885 18.4502 12.9785 18.4379 11.9446 18.4379H7.33331C6.64422 18.4379 6.08726 18.4386 5.63702 18.4018C5.23638 18.3691 4.87565 18.3039 4.53936 18.1596L4.39679 18.0932C3.87576 17.8277 3.43916 17.4239 3.13507 16.9282L3.013 16.7094C2.82119 16.3328 2.74182 15.927 2.7044 15.4692C2.66762 15.019 2.66827 14.462 2.66827 13.7729V11.9399C2.66827 11.2077 2.66214 10.7104 2.77569 10.2866L2.83722 10.0854C3.17599 9.09055 3.99001 8.32371 5.01397 8.04927L5.17706 8.01216C5.56592 7.93723 6.02595 7.94087 6.66632 7.94087C6.9429 7.94087 7.19894 7.79325 7.33624 7.55317L10.2562 2.44282L10.3118 2.36079C10.4544 2.18027 10.6824 2.08379 10.9153 2.11274ZM7.33136 14.4399C7.33136 15.257 7.33714 15.5356 7.39386 15.7475L7.42999 15.8647C7.62644 16.4415 8.09802 16.8863 8.69171 17.0454L8.87042 17.0795C9.07652 17.1051 9.38687 17.1079 10.0003 17.1079H11.9446C13.099 17.1079 13.4838 17.0956 13.7903 16.9692L13.8997 16.9194C14.1508 16.796 14.3716 16.6172 14.5433 16.395L14.6155 16.2895C14.7769 16.0281 14.8968 15.6246 15.1624 14.6508L15.5433 13.2553L15.8079 12.2651C15.8804 11.9831 15.9368 11.744 15.9769 11.5336C16.0364 11.2209 16.0517 11.0104 16.0394 10.852L16.0179 10.7084C15.9156 10.2478 15.641 9.84669 15.2542 9.5854L15.0814 9.48286C14.9253 9.40072 14.6982 9.33832 14.2747 9.30513C13.8477 9.27168 13.2923 9.27095 12.5003 9.27095C12.2893 9.27095 12.0905 9.17109 11.9651 9.00141C11.8398 8.83166 11.8025 8.6123 11.8646 8.41059L12.6556 5.84028L12.7054 5.63618C12.8941 4.6324 12.216 3.65244 11.1878 3.49067L8.49054 8.21235C8.23033 8.66771 7.81431 9.00136 7.33136 9.16255V14.4399ZM3.99835 13.7729C3.99835 14.4839 3.99924 14.9773 4.03058 15.3608C4.06128 15.7365 4.11804 15.9479 4.19854 16.1059L4.26886 16.2319C4.44517 16.5195 4.69805 16.7537 5.0003 16.9077L5.13019 16.9633C5.27397 17.0148 5.46337 17.0526 5.74542 17.0756C5.97772 17.0946 6.25037 17.1009 6.58722 17.104C6.41249 16.8579 6.27075 16.5864 6.1712 16.2944L6.10968 16.0922C5.99614 15.6685 6.00128 15.1719 6.00128 14.4399V9.27583C5.79386 9.27957 5.65011 9.28627 5.53741 9.30024L5.3587 9.33345C4.76502 9.49252 4.29247 9.93735 4.09601 10.5141L4.06085 10.6313C4.00404 10.8433 3.99835 11.1221 3.99835 11.9399V13.7729Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function AssistantRatingButton({
  rating,
  selectedRating,
  onSelect,
}: {
  rating: AssistantMessageRating;
  selectedRating: AssistantMessageRating | null;
  onSelect: (rating: AssistantMessageRating) => void;
}) {
  const selected = selectedRating === rating;
  const label = rating === "thumbs_up" ? "Good response" : "Bad response";

  return (
    <NodexTooltip tooltipContent={label} side="top" delay={0}>
      <ThreadActionIconButton
        label={label}
        active={selected}
        aria-pressed={selected}
        onClick={(event: MouseEvent<HTMLButtonElement>) => {
          event.stopPropagation();
          if (selected) return;
          onSelect(rating);
        }}
      >
        <ThumbRatingIcon className={rating === "thumbs_down" ? "rotate-180" : undefined} />
      </ThreadActionIconButton>
    </NodexTooltip>
  );
}

export function ForkMessageIcon({ className }: { className?: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("icon-xs", className)}
      aria-hidden="true"
    >
      <path
        d="M15.8 11.535c.367 0 .665.298.665.665v5a.665.665 0 0 1-.665.665h-5a.665.665 0 1 1 0-1.33h3.394l-3.565-3.564a.666.666 0 0 1 .942-.942l3.564 3.565V12.2c0-.367.298-.665.665-.665Zm0-9.4c.367 0 .665.298.665.665v5a.665.665 0 0 1-1.33 0V4.405l-5.128 5.128c-.323.324-.558.565-.842.74a2.668 2.668 0 0 1-.771.319c-.324.078-.662.073-1.12.073H1.93a.665.665 0 1 1 0-1.33h5.345c.52 0 .673-.005.809-.037.136-.033.266-.086.385-.16.12-.072.23-.177.598-.545l5.128-5.128H10.8a.665.665 0 0 1 0-1.33h5Z"
        fill="currentColor"
      />
    </svg>
  );
}

export { ASSISTANT_COPY_FEEDBACK_MS, USER_COPY_FEEDBACK_MS };
