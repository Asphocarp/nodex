import { FileResourceIcon } from "@/components/shared/file-resource-icon";
import { getFileTreeIconColor, resolveFileTreeIconToken } from "@/lib/file-tree-icons";

interface AttachmentResourceIconProps {
  readonly kind: "text" | "file" | "folder";
  readonly name?: string | null;
  readonly mimeType?: string | null;
  readonly className?: string;
}

/** Keeps attachment identity on the same path/MIME projection as every Page File surface. */
export function AttachmentResourceIcon({
  kind,
  name,
  mimeType,
  className,
}: AttachmentResourceIconProps) {
  const resourcePath = kind === "folder" ? `${name || "folder"}/` : name;
  const resourceMimeType = mimeType || (kind === "text" ? "text/plain" : undefined);
  const colorToken = resolveFileTreeIconToken(resourcePath || "");

  return (
    <FileResourceIcon
      path={resourcePath}
      mimeType={resourceMimeType}
      className={className}
      style={{ color: getFileTreeIconColor(colorToken) }}
    />
  );
}
