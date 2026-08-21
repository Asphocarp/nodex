import { useState, type ReactElement, type SVGProps, type TransitionEvent } from "react";
import { useResolvedReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/utils";
import "./browser-tab-favicon.css";

export type BrowserTabFaviconPhase =
  | "spinner-only"
  | "loading-favicon"
  | "settled"
  | "completion-start-frame"
  | "completion-midpoint-frame";

export interface BrowserTabFaviconProps {
  faviconUrl?: string;
  isLoading: boolean;
  isWaitingForResponse: boolean;
  className?: string;
}

export interface BrowserTabFaviconState {
  failedFaviconUrl: string | null;
  faviconUrl?: string;
  isLoading: boolean;
  isWaitingForResponse: boolean;
  pinnedCompletionFaviconUrl: string | null;
  reduceMotion: boolean;
  skipCompletionTransition: boolean;
}

export interface BrowserTabFaviconStateInput extends Omit<BrowserTabFaviconProps, "className"> {
  reduceMotion: boolean;
}

export function createBrowserTabFaviconState(
  input: BrowserTabFaviconStateInput,
): BrowserTabFaviconState {
  return {
    failedFaviconUrl: null,
    faviconUrl: input.faviconUrl,
    isLoading: input.isLoading,
    isWaitingForResponse: input.isWaitingForResponse,
    pinnedCompletionFaviconUrl: null,
    reduceMotion: input.reduceMotion,
    skipCompletionTransition: false,
  };
}

/** Reconciles live Browser state while retaining the favicon needed for the settle transition. */
export function reconcileBrowserTabFaviconState(
  previous: BrowserTabFaviconState,
  input: BrowserTabFaviconStateInput,
): BrowserTabFaviconState {
  if (
    previous.faviconUrl === input.faviconUrl &&
    previous.isLoading === input.isLoading &&
    previous.isWaitingForResponse === input.isWaitingForResponse &&
    previous.reduceMotion === input.reduceMotion
  ) {
    return previous;
  }

  const didFinishLoading = previous.isLoading && !input.isLoading;
  const failedFaviconUrl =
    previous.faviconUrl === input.faviconUrl ? previous.failedFaviconUrl : null;
  const completionFaviconUrl =
    !previous.isWaitingForResponse &&
    previous.faviconUrl != null &&
    previous.failedFaviconUrl !== previous.faviconUrl
      ? previous.faviconUrl
      : input.faviconUrl;
  const hasViableCompletionFavicon =
    completionFaviconUrl != null && failedFaviconUrl !== completionFaviconUrl;

  return {
    failedFaviconUrl,
    faviconUrl: input.faviconUrl,
    isLoading: input.isLoading,
    isWaitingForResponse: input.isWaitingForResponse,
    pinnedCompletionFaviconUrl:
      didFinishLoading && hasViableCompletionFavicon && !input.reduceMotion
        ? completionFaviconUrl
        : input.isLoading || input.reduceMotion
          ? null
          : previous.pinnedCompletionFaviconUrl,
    reduceMotion: input.reduceMotion,
    skipCompletionTransition: didFinishLoading
      ? !hasViableCompletionFavicon || input.reduceMotion
      : input.isLoading
        ? false
        : input.reduceMotion
          ? true
          : previous.skipCompletionTransition,
  };
}

export function resolveBrowserTabFaviconPhase(
  isLoading: boolean,
  isWaitingForResponse: boolean,
): BrowserTabFaviconPhase {
  if (!isLoading) return "settled";
  return isWaitingForResponse ? "spinner-only" : "loading-favicon";
}

export function BrowserTabFavicon({
  className,
  faviconUrl,
  isLoading,
  isWaitingForResponse,
}: BrowserTabFaviconProps): ReactElement {
  const reduceMotion = useResolvedReducedMotion();
  const input = {
    faviconUrl,
    isLoading,
    isWaitingForResponse,
    reduceMotion,
  };
  const [state, setState] = useState(() => createBrowserTabFaviconState(input));
  const reconciledState = reconcileBrowserTabFaviconState(state, input);
  if (reconciledState !== state) setState(reconciledState);

  const phase = resolveBrowserTabFaviconPhase(isLoading, isWaitingForResponse);
  const displayedFaviconUrl =
    reconciledState.pinnedCompletionFaviconUrl ?? reconciledState.faviconUrl;
  const handleCompletionTransitionFinish =
    reconciledState.pinnedCompletionFaviconUrl == null
      ? undefined
      : () =>
          setState((current) => ({
            ...current,
            pinnedCompletionFaviconUrl: null,
          }));
  const handleFaviconLoadError = (failedUrl: string) => {
    setState((current) => {
      if (current.faviconUrl !== failedUrl && current.pinnedCompletionFaviconUrl !== failedUrl) {
        return current;
      }
      const failedPinnedFavicon = current.pinnedCompletionFaviconUrl === failedUrl;
      return {
        ...current,
        failedFaviconUrl: failedUrl,
        pinnedCompletionFaviconUrl: failedPinnedFavicon ? null : current.pinnedCompletionFaviconUrl,
        skipCompletionTransition:
          failedPinnedFavicon || (!current.isLoading && current.faviconUrl === failedUrl)
            ? true
            : current.skipCompletionTransition,
      };
    });
  };

  return (
    <BrowserTabFaviconFrame
      className={className}
      faviconUrl={displayedFaviconUrl}
      phase={phase}
      reduceMotion={reduceMotion}
      skipCompletionTransition={reconciledState.skipCompletionTransition}
      onCompletionTransitionFinish={handleCompletionTransitionFinish}
      onFaviconLoadError={handleFaviconLoadError}
    />
  );
}

interface BrowserTabFaviconFrameProps {
  className?: string;
  faviconUrl?: string;
  phase: BrowserTabFaviconPhase;
  reduceMotion?: boolean;
  skipCompletionTransition?: boolean;
  onCompletionTransitionFinish?: () => void;
  onFaviconLoadError?: (faviconUrl: string) => void;
}

export function BrowserTabFaviconFrame({
  className,
  faviconUrl,
  phase,
  reduceMotion = false,
  skipCompletionTransition = false,
  onCompletionTransitionFinish,
  onFaviconLoadError,
}: BrowserTabFaviconFrameProps): ReactElement {
  const [failedFaviconUrl, setFailedFaviconUrl] = useState<string | null>(null);
  const currentFailedFaviconUrl = failedFaviconUrl === faviconUrl ? failedFaviconUrl : null;

  const isLoadingPhase = phase === "spinner-only" || phase === "loading-favicon";
  const faviconCanLoad = faviconUrl != null && currentFailedFaviconUrl !== faviconUrl;
  const showFavicon = phase !== "spinner-only" && (phase !== "loading-favicon" || faviconCanLoad);
  const disableTransition =
    skipCompletionTransition || reduceMotion || (phase === "settled" && !faviconCanLoad);
  const handleCompletionTransition = (event: TransitionEvent<HTMLSpanElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.propertyName !== "clip-path") return;
    onCompletionTransitionFinish?.();
  };
  const handleImageError = () => {
    if (faviconUrl == null) return;
    setFailedFaviconUrl(faviconUrl);
    onFaviconLoadError?.(faviconUrl);
  };

  return (
    <span
      className={cn(
        "relative flex size-full items-center justify-center",
        reduceMotion && "nodex-browser-tab-favicon-reduce-motion",
        className,
      )}
      data-browser-tab-icon-phase={phase}
    >
      <span
        className={cn(
          "nodex-browser-tab-favicon-clip absolute inset-0",
          showFavicon ? "visible" : "invisible",
          isLoadingPhase && "nodex-browser-tab-favicon-clip-loading",
          phase === "settled" && "nodex-browser-tab-favicon-clip-settled",
          disableTransition && "nodex-browser-tab-favicon-disable-transition",
          phase === "completion-start-frame" && "nodex-browser-tab-favicon-clip-completion-start",
          phase === "completion-midpoint-frame" &&
            "nodex-browser-tab-favicon-clip-completion-midpoint",
        )}
        data-browser-tab-favicon-clip="true"
        onTransitionCancel={
          onCompletionTransitionFinish == null ? undefined : handleCompletionTransition
        }
        onTransitionEnd={
          onCompletionTransitionFinish == null ? undefined : handleCompletionTransition
        }
      >
        <span
          className={cn(
            "nodex-browser-tab-favicon-image absolute inset-0 flex items-center justify-center",
            isLoadingPhase && "nodex-browser-tab-favicon-image-loading",
            phase === "settled" && "nodex-browser-tab-favicon-image-settled",
            disableTransition && "nodex-browser-tab-favicon-disable-transition",
            phase === "completion-start-frame" &&
              "nodex-browser-tab-favicon-image-completion-start",
            phase === "completion-midpoint-frame" &&
              "nodex-browser-tab-favicon-image-completion-midpoint",
          )}
        >
          <BrowserTabFaviconImage
            didFailToLoad={!faviconCanLoad && faviconUrl != null}
            faviconUrl={faviconUrl}
            onLoadError={handleImageError}
          />
        </span>
      </span>
      {isLoadingPhase ? (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-token-text-link-foreground">
          <BrowserTabThrobber />
        </span>
      ) : null}
    </span>
  );
}

function BrowserTabFaviconImage({
  didFailToLoad,
  faviconUrl,
  onLoadError,
}: {
  didFailToLoad: boolean;
  faviconUrl?: string;
  onLoadError: () => void;
}) {
  if (faviconUrl == null || didFailToLoad) {
    return <BrowserFallbackIcon aria-hidden="true" className="size-full" />;
  }

  return (
    <img
      alt=""
      className="size-full object-contain"
      data-browser-tab-favicon-url={faviconUrl}
      key={faviconUrl}
      src={faviconUrl}
      onError={onLoadError}
    />
  );
}

const BROWSER_FALLBACK_PATH =
  "M10 2.125C14.3492 2.125 17.875 5.65076 17.875 10C17.875 14.3492 14.3492 17.875 10 17.875C5.65076 17.875 2.125 14.3492 2.125 10C2.125 5.65076 5.65076 2.125 10 2.125ZM7.88672 10.625C7.94334 12.3161 8.22547 13.8134 8.63965 14.9053C8.87263 15.5194 9.1351 15.9733 9.39453 16.2627C9.65437 16.5524 9.86039 16.625 10 16.625C10.1396 16.625 10.3456 16.5524 10.6055 16.2627C10.8649 15.9733 11.1274 15.5194 11.3604 14.9053C11.7745 13.8134 12.0567 12.3161 12.1133 10.625H7.88672ZM3.40527 10.625C3.65313 13.2734 5.45957 15.4667 7.89844 16.2822C7.7409 15.997 7.5977 15.6834 7.4707 15.3486C6.99415 14.0923 6.69362 12.439 6.63672 10.625H3.40527ZM13.3633 10.625C13.3064 12.439 13.0059 14.0923 12.5293 15.3486C12.4022 15.6836 12.2582 15.9969 12.1006 16.2822C14.5399 15.467 16.3468 13.2737 16.5947 10.625H13.3633ZM12.1006 3.7168C12.2584 4.00235 12.4021 4.31613 12.5293 4.65137C13.0059 5.90775 13.3064 7.56102 13.3633 9.375H16.5947C16.3468 6.72615 14.54 4.53199 12.1006 3.7168ZM10 3.375C9.86039 3.375 9.65437 3.44756 9.39453 3.7373C9.1351 4.02672 8.87263 4.48057 8.63965 5.09473C8.22547 6.18664 7.94334 7.68388 7.88672 9.375H12.1133C12.0567 7.68388 11.7745 6.18664 11.3604 5.09473C11.1274 4.48057 10.8649 4.02672 10.6055 3.7373C10.3456 3.44756 10.1396 3.375 10 3.375ZM7.89844 3.7168C5.45942 4.53222 3.65314 6.72647 3.40527 9.375H6.63672C6.69362 7.56102 6.99415 5.90775 7.4707 4.65137C7.59781 4.31629 7.74073 4.00224 7.89844 3.7168Z";

function BrowserFallbackIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d={BROWSER_FALLBACK_PATH} />
    </svg>
  );
}

function BrowserTabThrobber() {
  return (
    <svg
      aria-hidden="true"
      className="nodex-browser-tab-throbber"
      data-browser-tab-throbber="true"
      height="16"
      viewBox="0 0 16 16"
      width="16"
    >
      <circle
        className="nodex-browser-tab-throbber-arc nodex-browser-tab-throbber-arc-growing"
        cx="8"
        cy="8"
        pathLength="360"
        r="7"
      />
      <circle
        className="nodex-browser-tab-throbber-arc nodex-browser-tab-throbber-arc-shrinking"
        cx="8"
        cy="8"
        pathLength="360"
        r="7"
      />
    </svg>
  );
}
