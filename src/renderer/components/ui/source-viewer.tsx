import type { SupportedLanguages } from "@pierre/diffs";
import { CodeView } from "@pierre/diffs/react";
import { useMemo } from "react";
import {
  NODEX_SOURCE_HOST_CLASS,
  getNodexDiffHostStyle,
  getNodexSourceOptions,
} from "@/lib/diff-presentation";
import { useTheme } from "@/lib/use-theme";
import { cn } from "@/lib/utils";
import { getSourceContentVersion } from "@/lib/source-content-version";

export interface SourceViewerProps {
  readonly value: string;
  readonly ariaLabel: string;
  readonly filename?: string;
  readonly language?: SupportedLanguages | null;
  readonly lineNumbers?: boolean;
  readonly wrap?: boolean;
  readonly sourceIdentity?: string;
  readonly className?: string;
}

export function SourceViewer({
  value,
  ariaLabel,
  filename = "source.txt",
  language,
  lineNumbers = false,
  wrap = false,
  sourceIdentity,
  className,
}: SourceViewerProps) {
  const { resolved } = useTheme();
  const contentVersion = useMemo(() => getSourceContentVersion(value), [value]);
  const file = useMemo(() => ({
    name: filename,
    contents: value,
    cacheKey: `${sourceIdentity ?? filename}:${contentVersion}`,
    lang: language ?? undefined,
  }), [contentVersion, filename, language, sourceIdentity, value]);
  const items = useMemo(() => [{
    id: sourceIdentity ?? filename,
    type: "file" as const,
    version: contentVersion,
    file,
  }], [contentVersion, file, filename, sourceIdentity]);
  const options = useMemo(
    () => getNodexSourceOptions(resolved, true, {
      disableLineNumbers: !lineNumbers,
      wrap,
    }),
    [lineNumbers, resolved, wrap],
  );
  const style = useMemo(() => getNodexDiffHostStyle(resolved), [resolved]);

  return (
    <section
      role="region"
      aria-label={ariaLabel}
      className={cn("h-full min-h-0 overflow-hidden", className)}
      data-source-viewer="true"
      data-source-identity={sourceIdentity}
    >
      <CodeView
        items={items}
        options={options}
        disableWorkerPool
        className={cn(
          NODEX_SOURCE_HOST_CLASS,
          "h-full min-h-0 overflow-auto",
        )}
        style={style}
      />
    </section>
  );
}
