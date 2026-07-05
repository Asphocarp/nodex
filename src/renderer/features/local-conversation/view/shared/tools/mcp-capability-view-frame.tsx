import { useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { NodexTooltip } from "../../../../../components/ui/tooltip";
import { cn } from "../../../../../lib/utils";
import { resolveMcpAppFrameHeight, type McpRenderableResource } from "./mcp-tool-call-resource-utils";

interface McpCapabilityViewFrameProps {
  resource: McpRenderableResource;
  mode?: "inline" | "side-panel";
}

function buildSrcDoc(resource: McpRenderableResource): string {
  return resource.html;
}

export function McpCapabilityViewFrame({ resource, mode = "inline" }: McpCapabilityViewFrameProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const isSidePanel = mode === "side-panel";

  return (
    <div
      className={cn(
        "relative overflow-hidden bg-token-input-background",
        resource.metadata.prefersBorder ? "rounded-lg border border-token-border" : "rounded-md",
        isSidePanel && "h-full rounded-none border-0",
        isExpanded && "fixed inset-3 z-50 rounded-xl border border-token-border shadow-2xl",
      )}
      data-mcp-app-frame-mode={mode}
      data-mcp-app-loading={isLoading ? "true" : "false"}
      data-mcp-app-expanded={isExpanded ? "true" : "false"}
      style={{
        height: isSidePanel || isExpanded ? undefined : resolveMcpAppFrameHeight(resource.metadata),
      }}
    >
      <div className="absolute right-1.5 top-1.5 z-10 flex items-center gap-1">
        <NodexTooltip tooltipContent={isExpanded ? "Exit fullscreen" : "Open fullscreen"} side="top" delayDuration={0}>
          <button
            type="button"
            className="inline-flex size-6 items-center justify-center rounded-md bg-token-dropdown-background/80 text-token-description-foreground shadow-sm ring-1 ring-token-border backdrop-blur enabled:hover:text-token-foreground"
            aria-label={isExpanded ? "Exit fullscreen" : "Open fullscreen"}
            onClick={() => {
              setIsExpanded((value) => !value);
            }}
          >
            {isExpanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </button>
        </NodexTooltip>
      </div>
      {isLoading ? (
        <div className="absolute inset-0 grid place-items-center text-size-chat text-token-description-foreground">
          Loading app
        </div>
      ) : null}
      <iframe
        title={resource.uri}
        className="h-full w-full bg-transparent"
        sandbox="allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-scripts"
        srcDoc={buildSrcDoc(resource)}
        referrerPolicy="no-referrer"
        onLoad={() => {
          setIsLoading(false);
        }}
      />
    </div>
  );
}
