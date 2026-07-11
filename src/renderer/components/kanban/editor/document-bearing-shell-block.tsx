import { lazy, Suspense } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { Braces, FileText, LayoutTemplate, type LucideIcon } from "lucide-react";
import {
  isInlineDocumentOwnerCycle,
  useBlockReferenceHostRuntime,
} from "@/components/block-documents/block-reference-runtime-context";
import {
  OwnedDocumentReferenceSurface,
  type OwnedDocumentReferenceStateDependencies,
  type OwnedDocumentReferenceRenderer,
} from "@/components/block-documents/owned-document-reference-surface";
import {
  largeCodeBlockConfig,
  largeDocumentBlockConfig,
  reusableTemplateRefBlockConfig,
} from "../../../../shared/block-documents/blocknote-schema-config";

const EmbeddedOwnedBlockDocument = lazy(() =>
  import("./embedded-owned-block-document").then((module) => ({
    default: module.EmbeddedOwnedBlockDocument,
  })),
);

export interface DocumentBearingShellVisualProps
  extends OwnedDocumentReferenceStateDependencies {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly detail: string;
  readonly identity?: string;
  readonly referenceKey?: string;
  readonly disabledReason?: string;
  readonly renderDocument?: OwnedDocumentReferenceRenderer;
}

/** Host-Document shell. Its optional body renderer always targets another Y.Doc. */
export function DocumentBearingShellVisual({
  icon: Icon,
  label,
  detail,
  identity,
  referenceKey = `document-bearing:${identity ?? "unscoped"}`,
  disabledReason,
  renderDocument,
  expansionStore,
  activationBudget,
  visibilityOverride,
}: DocumentBearingShellVisualProps) {
  return (
    <OwnedDocumentReferenceSurface
      referenceKey={referenceKey}
      ownerBlockId={identity ?? ""}
      icon={<Icon className="icon-2xs shrink-0" />}
      label={label}
      detail={detail}
      disabledReason={disabledReason}
      renderDocument={renderDocument}
      expansionStore={expansionStore}
      activationBudget={activationBudget}
      visibilityOverride={visibilityOverride}
    />
  );
}

export interface DocumentBearingShellBlockProps
  extends Omit<
    DocumentBearingShellVisualProps,
    "referenceKey" | "disabledReason" | "renderDocument"
  > {
  readonly shellBlockId: string;
}

const resolveShellDisabledReason = (input: {
  readonly hasOwner: boolean;
  readonly hasHost: boolean;
  readonly cycle: boolean;
}): string | undefined => {
  if (!input.hasOwner) return "Missing source";
  if (!input.hasHost) return "Unavailable";
  if (input.cycle) return "Cycle";
  return undefined;
};

export function DocumentBearingShellBlock({
  shellBlockId,
  identity = "",
  ...visual
}: DocumentBearingShellBlockProps) {
  const host = useBlockReferenceHostRuntime();
  const ownerBlockId = identity.trim();
  const cycle =
    ownerBlockId.length > 0 &&
    isInlineDocumentOwnerCycle(
      host?.ancestorDocumentOwnerBlockIds ?? [],
      ownerBlockId,
    );
  const disabledReason = resolveShellDisabledReason({
    hasOwner: ownerBlockId.length > 0,
    hasHost: host !== null,
    cycle,
  });
  const renderDocument: OwnedDocumentReferenceRenderer | undefined =
    host && !disabledReason
      ? ({ isActive }) => (
          <Suspense
            fallback={
              <div className="py-2 text-sm text-token-description-foreground">
                Opening collaborative content…
              </div>
            }
          >
            <EmbeddedOwnedBlockDocument
              projectId={host.projectId}
              ownerBlockId={ownerBlockId}
              isActive={isActive && host.isActiveSurface}
              hostRuntime={host}
            />
          </Suspense>
        )
      : undefined;

  return (
    <DocumentBearingShellVisual
      {...visual}
      identity={ownerBlockId}
      referenceKey={`owned-document:${shellBlockId}:${ownerBlockId || "missing"}`}
      disabledReason={disabledReason}
      renderDocument={renderDocument}
    />
  );
}

export const createReusableTemplateRefBlockSpec = createReactBlockSpec(
  reusableTemplateRefBlockConfig,
  {
    render: ({ block }) => (
      <DocumentBearingShellBlock
        icon={LayoutTemplate}
        label="Template"
        detail={block.props.displayHint || "Reusable content"}
        identity={block.props.sourceBlockId}
        shellBlockId={block.id}
      />
    ),
  },
);

export const createLargeDocumentBlockSpec = createReactBlockSpec(
  largeDocumentBlockConfig,
  {
    render: ({ block }) => (
      <DocumentBearingShellBlock
        icon={FileText}
        label="Document"
        detail={block.props.displayName}
        identity={block.id}
        shellBlockId={block.id}
      />
    ),
  },
);

export const createLargeCodeBlockSpec = createReactBlockSpec(
  largeCodeBlockConfig,
  {
    render: ({ block }) => (
      <DocumentBearingShellBlock
        icon={Braces}
        label="Code"
        detail={`${block.props.displayName} · ${block.props.language}`}
        identity={block.id}
        shellBlockId={block.id}
      />
    ),
  },
);
