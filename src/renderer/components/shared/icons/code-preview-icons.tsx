import type { ComponentPropsWithoutRef } from "react";

type CodePreviewIconProps = ComponentPropsWithoutRef<"svg">;

function CodePreviewIcon({
  viewBox,
  path,
  ...props
}: CodePreviewIconProps & { readonly viewBox: string; readonly path: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox={viewBox}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <path d={path} />
    </svg>
  );
}

export function CodeOnlyPreviewIcon(props: CodePreviewIconProps) {
  return (
    <CodePreviewIcon
      viewBox="0.89 0 14.22 16"
      path="M9.611 2.36c.332.094.524.44.429.772l-2.88 10.08a.625.625 0 0 1-1.201-.344l2.88-10.08a.625.625 0 0 1 .772-.428M4.246 4.39a.626.626 0 0 1 .885.885L2.404 8l2.727 2.727a.626.626 0 0 1-.885.884L1.078 8.443a.627.627 0 0 1 0-.885zm6.624 0a.626.626 0 0 1 .885 0l3.168 3.168a.627.627 0 0 1 0 .885l-3.168 3.168a.625.625 0 0 1-.885-.884L13.596 8 10.87 5.275a.626.626 0 0 1 0-.885"
      {...props}
    />
  );
}

export function PreviewOnlyIcon(props: CodePreviewIconProps) {
  return (
    <CodePreviewIcon
      viewBox="2.37 0 11.25 16"
      path="M3.8 2.575c-.787 0-1.425.638-1.425 1.425v.8c0 .787.638 1.425 1.425 1.425h3.575v.95H3.8c-.787 0-1.425.638-1.425 1.425v.8c0 .787.638 1.425 1.425 1.425h3.575v2.046l-.913-.913a.625.625 0 1 0-.884.884l2 2c.244.244.64.244.884 0l2-2a.625.625 0 1 0-.884-.884l-.953.953v-2.086H12.2c.787 0 1.425-.638 1.425-1.425v-.8c0-.787-.638-1.425-1.425-1.425H8.625v-.95H12.2c.787 0 1.425-.638 1.425-1.425V4c0-.787-.638-1.425-1.425-1.425zM3.625 4c0-.097.078-.175.175-.175h8.4c.097 0 .175.078.175.175v.8a.175.175 0 0 1-.175.175H3.8a.175.175 0 0 1-.175-.175zm0 4.6c0-.097.078-.175.175-.175h8.4c.097 0 .175.078.175.175v.8a.175.175 0 0 1-.175.175H3.8a.175.175 0 0 1-.175-.175z"
      {...props}
    />
  );
}

export function CodeAndPreviewIcon(props: CodePreviewIconProps) {
  return (
    <CodePreviewIcon
      viewBox="3.37 0 9.25 16"
      path="M5.25 2.125c-1.036 0-1.875.84-1.875 1.875v8c0 1.036.84 1.875 1.875 1.875h5.5c1.036 0 1.875-.84 1.875-1.875V4c0-1.036-.84-1.875-1.875-1.875zM4.625 4c0-.345.28-.625.625-.625h5.5c.345 0 .625.28.625.625v3.375h-6.75zm0 8V8.625h6.75V12c0 .345-.28.625-.625.625h-5.5A.625.625 0 0 1 4.625 12"
      {...props}
    />
  );
}
