import { forwardRef } from "react";
import {
  AlertCircle as LucideAlertCircle,
  AlertTriangle as LucideAlertTriangle,
  ArrowDown as LucideArrowDown,
  ArrowLeft as LucideArrowLeft,
  ArrowRight as LucideArrowRight,
  ArrowUp as LucideArrowUp,
  ArrowUpDown as LucideArrowUpDown,
  ArrowUpRight as LucideArrowUpRight,
  Bot as LucideBot,
  BoxSelect as LucideBoxSelect,
  CalendarClock as LucideCalendarClock,
  Check as LucideCheck,
  CheckCircle2 as LucideCheckCircle2,
  CheckIcon as LucideCheckIcon,
  CheckSquare2 as LucideCheckSquare2,
  ChevronDown as LucideChevronDown,
  ChevronLeft as LucideChevronLeft,
  ChevronLeftIcon as LucideChevronLeftIcon,
  ChevronRightIcon as LucideChevronRightIcon,
  ChevronUp as LucideChevronUp,
  ChevronsLeftRight as LucideChevronsLeftRight,
  ChevronsRightLeft as LucideChevronsRightLeft,
  Circle as LucideCircle,
  CircleAlert as LucideCircleAlert,
  CircleDotIcon as LucideCircleDotIcon,
  CircleX as LucideCircleX,
  ClipboardListIcon as LucideClipboardListIcon,
  CloudOff as LucideCloudOff,
  Columns3 as LucideColumns3,
  ContactRound as LucideContactRound,
  Copy as LucideCopy,
  CornerDownLeft as LucideCornerDownLeft,
  Ellipsis as LucideEllipsis,
  ExternalLink as LucideExternalLink,
  Eye as LucideEye,
  EyeOff as LucideEyeOff,
  Filter as LucideFilter,
  FileImage as LucideFileImage,
  FolderGit2 as LucideFolderGit2,
  Gauge as LucideGauge,
  GitBranch as LucideGitBranch,
  GitBranchPlus as LucideGitBranchPlus,
  GitCommitHorizontal as LucideGitCommitHorizontal,
  GitPullRequest as LucideGitPullRequest,
  GripVertical as LucideGripVertical,
  Hash as LucideHash,
  History as LucideHistory,
  ImageIcon as LucideImageIcon,
  ImagePlus as LucideImagePlus,
  ImagesIcon as LucideImagesIcon,
  Info as LucideInfo,
  KeyRound as LucideKeyRound,
  Layers3 as LucideLayers3,
  LayoutGrid as LucideLayoutGrid,
  LayoutTemplate as LucideLayoutTemplate,
  Link2 as LucideLink2,
  List as LucideList,
  ListFilter as LucideListFilter,
  ListTree as LucideListTree,
  Loader2 as LucideLoader2,
  LoaderCircleIcon as LucideLoaderCircleIcon,
  LockKeyhole as LucideLockKeyhole,
  Maximize2 as LucideMaximize2,
  MessageCirclePlusIcon as LucideMessageCirclePlusIcon,
  MessageSquare as LucideMessageSquare,
  MessageSquareIcon as LucideMessageSquareIcon,
  MessagesSquareIcon as LucideMessagesSquareIcon,
  Minimize2 as LucideMinimize2,
  Minus as LucideMinus,
  Monitor as LucideMonitor,
  MonitorCog as LucideMonitorCog,
  Moon as LucideMoon,
  PanelRightClose as LucidePanelRightClose,
  PanelRightOpen as LucidePanelRightOpen,
  PanelTopOpen as LucidePanelTopOpen,
  Pause as LucidePause,
  PencilLine as LucidePencilLine,
  PictureInPicture2 as LucidePictureInPicture2,
  Play as LucidePlay,
  Plug as LucidePlug,
  Printer as LucidePrinter,
  Puzzle as LucidePuzzle,
  RefreshCw as LucideRefreshCw,
  Repeat2Icon as LucideRepeat2Icon,
  RotateCcw as LucideRotateCcw,
  RotateCw as LucideRotateCw,
  Route as LucideRoute,
  Rows3 as LucideRows3,
  Scissors as LucideScissors,
  SendHorizontal as LucideSendHorizontal,
  SendIcon as LucideSendIcon,
  Settings as LucideSettings,
  Settings2 as LucideSettings2,
  Shield as LucideShield,
  ShieldCheck as LucideShieldCheck,
  Slash as LucideSlash,
  SlidersHorizontal as LucideSlidersHorizontal,
  Smartphone as LucideSmartphone,
  Sparkles as LucideSparkles,
  SparklesIcon as LucideSparklesIcon,
  SplitIcon as LucideSplitIcon,
  SquareTerminal as LucideSquareTerminal,
  Star as LucideStar,
  StopCircle as LucideStopCircle,
  Sun as LucideSun,
  Tags as LucideTags,
  TextCursorInput as LucideTextCursorInput,
  TriangleAlert as LucideTriangleAlert,
  UploadCloud as LucideUploadCloud,
  UserRound as LucideUserRound,
  Volume2 as LucideVolume2,
  WandSparkles as LucideWandSparkles,
  WifiOff as LucideWifiOff,
  X as LucideX,
  XCircle as LucideXCircle,
  XIcon as LucideXIcon,
  type LucideIcon as LucideIconType,
  type LucideProps,
} from "lucide-react";

import { cn } from "@/lib/utils";

export type LucideIcon = LucideIconType;

const DEFAULT_GENERIC_ICON_SIZE = 16;
const DEFAULT_GENERIC_ICON_STROKE_WIDTH = 1.75;

function createGenericIcon(Icon: LucideIconType, displayName: string): LucideIconType {
  const GenericIcon = forwardRef<SVGSVGElement, LucideProps>(function GenericIcon(
    {
      "aria-hidden": ariaHidden,
      "aria-label": ariaLabel,
      "aria-labelledby": ariaLabelledBy,
      children,
      className,
      focusable = false,
      size = DEFAULT_GENERIC_ICON_SIZE,
      strokeWidth = DEFAULT_GENERIC_ICON_STROKE_WIDTH,
      ...props
    },
    ref,
  ) {
    const hasAccessibleName =
      ariaLabel !== undefined || ariaLabelledBy !== undefined || children !== undefined;

    return (
      <Icon
        {...props}
        ref={ref}
        aria-hidden={hasAccessibleName ? ariaHidden : (ariaHidden ?? true)}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className={cn("shrink-0", className)}
        focusable={focusable}
        size={size}
        strokeWidth={strokeWidth}
      >
        {children}
      </Icon>
    );
  });
  GenericIcon.displayName = displayName;
  return GenericIcon as LucideIconType;
}

export const AlertCircle: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideAlertCircle,
  "AlertCircle",
);
export const AlertTriangle: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideAlertTriangle,
  "AlertTriangle",
);
export const ArrowDown: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideArrowDown,
  "ArrowDown",
);
export const ArrowLeft: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideArrowLeft,
  "ArrowLeft",
);
export const ArrowRight: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideArrowRight,
  "ArrowRight",
);
export const ArrowUp: LucideIconType = /* @__PURE__ */ createGenericIcon(LucideArrowUp, "ArrowUp");
export const ArrowUpDown: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideArrowUpDown,
  "ArrowUpDown",
);
export const ArrowUpRight: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideArrowUpRight,
  "ArrowUpRight",
);
export const Bot: LucideIconType = /* @__PURE__ */ createGenericIcon(LucideBot, "Bot");
export const BoxSelect: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideBoxSelect,
  "BoxSelect",
);
export const CalendarClock: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideCalendarClock,
  "CalendarClock",
);
export const Check: LucideIconType = /* @__PURE__ */ createGenericIcon(LucideCheck, "Check");
export const CheckCircle2: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideCheckCircle2,
  "CheckCircle2",
);
export const CheckIcon: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideCheckIcon,
  "CheckIcon",
);
export const CheckSquare2: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideCheckSquare2,
  "CheckSquare2",
);
export const ChevronDown: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideChevronDown,
  "ChevronDown",
);
export const ChevronLeft: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideChevronLeft,
  "ChevronLeft",
);
export const ChevronLeftIcon: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideChevronLeftIcon,
  "ChevronLeftIcon",
);
export const ChevronRightIcon: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideChevronRightIcon,
  "ChevronRightIcon",
);
export const ChevronUp: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideChevronUp,
  "ChevronUp",
);
export const ChevronsLeftRight: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideChevronsLeftRight,
  "ChevronsLeftRight",
);
export const ChevronsRightLeft: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideChevronsRightLeft,
  "ChevronsRightLeft",
);
export const Circle: LucideIconType = /* @__PURE__ */ createGenericIcon(LucideCircle, "Circle");
export const CircleAlert: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideCircleAlert,
  "CircleAlert",
);
export const CircleDotIcon: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideCircleDotIcon,
  "CircleDotIcon",
);
export const CircleX: LucideIconType = /* @__PURE__ */ createGenericIcon(LucideCircleX, "CircleX");
export const ClipboardListIcon: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideClipboardListIcon,
  "ClipboardListIcon",
);
export const CloudOff: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideCloudOff,
  "CloudOff",
);
export const Columns3: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideColumns3,
  "Columns3",
);
export const ContactRound: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideContactRound,
  "ContactRound",
);
export const Copy: LucideIconType = /* @__PURE__ */ createGenericIcon(LucideCopy, "Copy");
export const CornerDownLeft: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideCornerDownLeft,
  "CornerDownLeft",
);
export const Ellipsis: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideEllipsis,
  "Ellipsis",
);
export const ExternalLink: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideExternalLink,
  "ExternalLink",
);
export const Eye: LucideIconType = /* @__PURE__ */ createGenericIcon(LucideEye, "Eye");
export const EyeOff: LucideIconType = /* @__PURE__ */ createGenericIcon(LucideEyeOff, "EyeOff");
export const Filter: LucideIconType = /* @__PURE__ */ createGenericIcon(LucideFilter, "Filter");
export const FileImage: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideFileImage,
  "FileImage",
);
export const FolderGit2: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideFolderGit2,
  "FolderGit2",
);
export const Gauge: LucideIconType = /* @__PURE__ */ createGenericIcon(LucideGauge, "Gauge");
export const GitBranch: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideGitBranch,
  "GitBranch",
);
export const GitBranchPlus: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideGitBranchPlus,
  "GitBranchPlus",
);
export const GitCommitHorizontal: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideGitCommitHorizontal,
  "GitCommitHorizontal",
);
export const GitPullRequest: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideGitPullRequest,
  "GitPullRequest",
);
export const GripVertical: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideGripVertical,
  "GripVertical",
);
export const Hash: LucideIconType = /* @__PURE__ */ createGenericIcon(LucideHash, "Hash");
export const History: LucideIconType = /* @__PURE__ */ createGenericIcon(LucideHistory, "History");
export const ImageIcon: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideImageIcon,
  "ImageIcon",
);
export const ImagePlus: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideImagePlus,
  "ImagePlus",
);
export const ImagesIcon: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideImagesIcon,
  "ImagesIcon",
);
export const Info: LucideIconType = /* @__PURE__ */ createGenericIcon(LucideInfo, "Info");
export const KeyRound: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideKeyRound,
  "KeyRound",
);
export const Layers3: LucideIconType = /* @__PURE__ */ createGenericIcon(LucideLayers3, "Layers3");
export const LayoutGrid: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideLayoutGrid,
  "LayoutGrid",
);
export const LayoutTemplate: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideLayoutTemplate,
  "LayoutTemplate",
);
export const Link2: LucideIconType = /* @__PURE__ */ createGenericIcon(LucideLink2, "Link2");
export const List: LucideIconType = /* @__PURE__ */ createGenericIcon(LucideList, "List");
export const ListFilter: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideListFilter,
  "ListFilter",
);
export const ListTree: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideListTree,
  "ListTree",
);
export const Loader2: LucideIconType = /* @__PURE__ */ createGenericIcon(LucideLoader2, "Loader2");
export const LoaderCircleIcon: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideLoaderCircleIcon,
  "LoaderCircleIcon",
);
export const LockKeyhole: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideLockKeyhole,
  "LockKeyhole",
);
export const Maximize2: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideMaximize2,
  "Maximize2",
);
export const MessageCirclePlusIcon: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideMessageCirclePlusIcon,
  "MessageCirclePlusIcon",
);
export const MessageSquare: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideMessageSquare,
  "MessageSquare",
);
export const MessageSquareIcon: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideMessageSquareIcon,
  "MessageSquareIcon",
);
export const MessagesSquareIcon: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideMessagesSquareIcon,
  "MessagesSquareIcon",
);
export const Minimize2: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideMinimize2,
  "Minimize2",
);
export const Minus: LucideIconType = /* @__PURE__ */ createGenericIcon(LucideMinus, "Minus");
export const Monitor: LucideIconType = /* @__PURE__ */ createGenericIcon(LucideMonitor, "Monitor");
export const MonitorCog: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideMonitorCog,
  "MonitorCog",
);
export const Moon: LucideIconType = /* @__PURE__ */ createGenericIcon(LucideMoon, "Moon");
export const PanelRightClose: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucidePanelRightClose,
  "PanelRightClose",
);
export const PanelRightOpen: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucidePanelRightOpen,
  "PanelRightOpen",
);
export const PanelTopOpen: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucidePanelTopOpen,
  "PanelTopOpen",
);
export const Pause: LucideIconType = /* @__PURE__ */ createGenericIcon(LucidePause, "Pause");
export const PencilLine: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucidePencilLine,
  "PencilLine",
);
export const PictureInPicture2: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucidePictureInPicture2,
  "PictureInPicture2",
);
export const Play: LucideIconType = /* @__PURE__ */ createGenericIcon(LucidePlay, "Play");
export const Plug: LucideIconType = /* @__PURE__ */ createGenericIcon(LucidePlug, "Plug");
export const Printer: LucideIconType = /* @__PURE__ */ createGenericIcon(LucidePrinter, "Printer");
export const Puzzle: LucideIconType = /* @__PURE__ */ createGenericIcon(LucidePuzzle, "Puzzle");
export const RefreshCw: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideRefreshCw,
  "RefreshCw",
);
export const Repeat2Icon: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideRepeat2Icon,
  "Repeat2Icon",
);
export const RotateCcw: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideRotateCcw,
  "RotateCcw",
);
export const RotateCw: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideRotateCw,
  "RotateCw",
);
export const Route: LucideIconType = /* @__PURE__ */ createGenericIcon(LucideRoute, "Route");
export const Rows3: LucideIconType = /* @__PURE__ */ createGenericIcon(LucideRows3, "Rows3");
export const Scissors: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideScissors,
  "Scissors",
);
export const SendHorizontal: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideSendHorizontal,
  "SendHorizontal",
);
export const SendIcon: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideSendIcon,
  "SendIcon",
);
export const Settings: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideSettings,
  "Settings",
);
export const Settings2: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideSettings2,
  "Settings2",
);
export const Shield: LucideIconType = /* @__PURE__ */ createGenericIcon(LucideShield, "Shield");
export const ShieldCheck: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideShieldCheck,
  "ShieldCheck",
);
export const Slash: LucideIconType = /* @__PURE__ */ createGenericIcon(LucideSlash, "Slash");
export const SlidersHorizontal: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideSlidersHorizontal,
  "SlidersHorizontal",
);
export const Smartphone: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideSmartphone,
  "Smartphone",
);
export const Sparkles: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideSparkles,
  "Sparkles",
);
export const SparklesIcon: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideSparklesIcon,
  "SparklesIcon",
);
export const SplitIcon: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideSplitIcon,
  "SplitIcon",
);
export const SquareTerminal: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideSquareTerminal,
  "SquareTerminal",
);
export const Star: LucideIconType = /* @__PURE__ */ createGenericIcon(LucideStar, "Star");
export const StopCircle: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideStopCircle,
  "StopCircle",
);
export const Sun: LucideIconType = /* @__PURE__ */ createGenericIcon(LucideSun, "Sun");
export const Tags: LucideIconType = /* @__PURE__ */ createGenericIcon(LucideTags, "Tags");
export const TextCursorInput: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideTextCursorInput,
  "TextCursorInput",
);
export const TriangleAlert: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideTriangleAlert,
  "TriangleAlert",
);
export const UploadCloud: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideUploadCloud,
  "UploadCloud",
);
export const UserRound: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideUserRound,
  "UserRound",
);
export const Volume2: LucideIconType = /* @__PURE__ */ createGenericIcon(LucideVolume2, "Volume2");
export const WandSparkles: LucideIconType = /* @__PURE__ */ createGenericIcon(
  LucideWandSparkles,
  "WandSparkles",
);
export const WifiOff: LucideIconType = /* @__PURE__ */ createGenericIcon(LucideWifiOff, "WifiOff");
export const X: LucideIconType = /* @__PURE__ */ createGenericIcon(LucideX, "X");
export const XCircle: LucideIconType = /* @__PURE__ */ createGenericIcon(LucideXCircle, "XCircle");
export const XIcon: LucideIconType = /* @__PURE__ */ createGenericIcon(LucideXIcon, "XIcon");
