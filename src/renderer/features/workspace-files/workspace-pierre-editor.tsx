import type { SupportedLanguages } from "@pierre/diffs";
import { Editor, type EditorOptions } from "@pierre/diffs/edit";
import {
  CodeView,
  EditProvider,
  type CodeViewItem,
  type FileContents,
} from "@pierre/diffs/react";
import { useMemo } from "react";
import {
  NODEX_SOURCE_HOST_CLASS,
  getNodexDiffHostStyle,
  getNodexSourceOptions,
} from "@/lib/diff-presentation";
import { useTheme } from "@/lib/use-theme";
import { cn } from "@/lib/utils";

interface WorkspacePierreEditorProps {
  readonly value: string;
  readonly filename: string;
  readonly language: SupportedLanguages | null;
  readonly sourceIdentity: string;
  readonly documentVersion: number;
  readonly ariaLabel: string;
  readonly wrap?: boolean;
  readonly className?: string;
  readonly onChange: (value: string) => void;
}

function createWorkspaceEditor(
  options: EditorOptions<undefined>,
): Editor<undefined> {
  return new Editor(options);
}

export function WorkspacePierreEditor({
  value,
  filename,
  language,
  sourceIdentity,
  documentVersion,
  ariaLabel,
  wrap = true,
  className,
  onChange,
}: WorkspacePierreEditorProps) {
  const { resolved } = useTheme();
  const items = useMemo<CodeViewItem[]>(() => [{
    id: sourceIdentity,
    type: "file",
    edit: true,
    version: documentVersion,
    file: {
      name: filename,
      contents: value,
      cacheKey: `${sourceIdentity}:${documentVersion}`,
      lang: language ?? undefined,
    },
  }], [documentVersion, filename, language, sourceIdentity, value]);
  const options = useMemo(
    () => getNodexSourceOptions(resolved, true, {
      disableLineNumbers: false,
      wrap,
    }),
    [resolved, wrap],
  );
  const style = useMemo(() => getNodexDiffHostStyle(resolved), [resolved]);
  const handleEditChange = (
    _item: CodeViewItem,
    file: FileContents,
  ) => {
    onChange(file.contents);
  };

  return (
    <section
      role="region"
      aria-label={ariaLabel}
      className={cn("h-full min-h-0 overflow-hidden", className)}
      data-workspace-pierre-editor="true"
    >
      <EditProvider createEditor={createWorkspaceEditor}>
        <CodeView
          items={items}
          options={options}
          editorOptions={{
            persistState: true,
            clipboard: {
              readText: async () => {
                if (typeof navigator.clipboard?.readText !== "function") return "";
                return await navigator.clipboard.readText();
              },
            },
          }}
          disableWorkerPool
          onItemEditChange={handleEditChange}
          className={cn(
            NODEX_SOURCE_HOST_CLASS,
            "h-full min-h-0 overflow-auto",
          )}
          style={style}
        />
      </EditProvider>
    </section>
  );
}
