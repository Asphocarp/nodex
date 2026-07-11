import { createReactBlockSpec } from "@blocknote/react";
import { Braces, FileText, LayoutTemplate, type LucideIcon } from "lucide-react";
import {
  largeCodeBlockConfig,
  largeDocumentBlockConfig,
  reusableTemplateRefBlockConfig,
} from "../../../../shared/block-documents/blocknote-schema-config";

export interface DocumentBearingShellVisualProps {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly detail: string;
  readonly identity?: string;
}

/**
 * Presentation-only shell. It deliberately renders no owned body: callers
 * open that body through the registered owned-Document boundary.
 */
export function DocumentBearingShellVisual({
  icon: Icon,
  label,
  detail,
  identity,
}: DocumentBearingShellVisualProps) {
  return (
    <div
      contentEditable={false}
      data-document-bearing-owner-id={identity}
      className="group inline-flex max-w-full items-center gap-1.5 rounded-md bg-token-foreground/5 px-2 py-1 text-xs text-token-text-secondary hover:bg-token-foreground/10"
    >
      <Icon className="icon-2xs shrink-0 text-token-description-foreground" />
      <span className="shrink-0 font-medium">{label}</span>
      <span className="min-w-0 truncate text-token-description-foreground">
        {detail}
      </span>
    </div>
  );
}

export const createReusableTemplateRefBlockSpec = createReactBlockSpec(
  reusableTemplateRefBlockConfig,
  {
    render: ({ block }) => (
      <DocumentBearingShellVisual
        icon={LayoutTemplate}
        label="Template"
        detail={block.props.displayHint || "Reusable content"}
        identity={block.props.sourceBlockId}
      />
    ),
  },
);

export const createLargeDocumentBlockSpec = createReactBlockSpec(
  largeDocumentBlockConfig,
  {
    render: ({ block }) => (
      <DocumentBearingShellVisual
        icon={FileText}
        label="Document"
        detail={block.props.displayName}
        identity={block.id}
      />
    ),
  },
);

export const createLargeCodeBlockSpec = createReactBlockSpec(
  largeCodeBlockConfig,
  {
    render: ({ block }) => (
      <DocumentBearingShellVisual
        icon={Braces}
        label="Code"
        detail={`${block.props.displayName} · ${block.props.language}`}
        identity={block.id}
      />
    ),
  },
);
