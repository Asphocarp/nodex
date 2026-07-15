export function SidebarDropIndicator({
  compensateLayout = true,
}: {
  compensateLayout?: boolean;
}) {
  const indicator = (
    <div
      aria-hidden
      className="relative h-0 before:absolute before:top-[-1px] before:right-2 before:left-2 before:h-0.5 before:rounded-full before:bg-token-text-link-foreground before:content-[''] after:absolute after:top-[-4px] after:left-1 after:size-2 after:rounded-full after:border-2 after:border-token-text-link-foreground after:bg-token-side-bar-background after:content-['']"
      role="presentation"
    />
  );
  if (!compensateLayout) return indicator;

  return <div className="-mb-px">{indicator}</div>;
}
