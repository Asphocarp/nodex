import { dataSourcePropertyIcon } from "@/components/database/data-source-property-presentation";
import type { PageStagePropertyControls } from "./use-page-stage-properties";
import { PageStageDataSourcePropertyControl } from "./data-source-property-control";

export function PageStageInlinePropertyStrip({
  controls,
}: {
  readonly controls: PageStagePropertyControls;
}) {
  if (controls.primaryProperties.length === 0) return null;
  return (
    <div className="mb-3 overflow-x-auto">
      <div
        className="grid w-max gap-x-4"
        style={{
          gridTemplateColumns: `repeat(${controls.primaryProperties.length}, minmax(7rem, auto))`,
        }}
      >
        {controls.primaryProperties.map((item) => {
          const Icon = dataSourcePropertyIcon(item.property);
          return (
            <div
              key={`label:${item.property.propertyId}`}
              className="flex h-6 min-w-0 items-center gap-0.5 rounded-sm px-1.5"
            >
              <Icon className="size-4 shrink-0 text-(--foreground-secondary)" />
              <span className="truncate text-sm/4.5 font-medium text-(--foreground-secondary)">
                {item.property.name}
              </span>
            </div>
          );
        })}
        {controls.primaryProperties.map((item) => (
          <PageStageDataSourcePropertyControl
            key={`value:${item.property.propertyId}`}
            item={item}
            controls={controls}
            className="flex min-h-7.5 items-center px-1.5"
          />
        ))}
      </div>
    </div>
  );
}
