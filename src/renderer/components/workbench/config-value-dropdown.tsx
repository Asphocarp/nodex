import {
  NodexDropdownItem,
  NodexDropdownMenu,
  NodexDropdownSelectedIcon,
  NodexSettingsDropdownTrigger,
} from "@/components/ui/dropdown";

export function ConfigValueDropdown({
  value,
  options,
  onSelect,
  disabled = false,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onSelect: (value: string) => void;
  disabled?: boolean;
}) {
  const selectedLabel = options.find((option) => option.value === value)?.label ?? value;
  return (
    <NodexDropdownMenu
      disabled={disabled}
      triggerButton={
        <NodexSettingsDropdownTrigger className="min-w-36">
          <span className="truncate">{selectedLabel}</span>
        </NodexSettingsDropdownTrigger>
      }
      align="end"
      contentWidth="sm"
    >
      {options.map((option) => (
        <NodexDropdownItem
          key={option.value}
          onSelect={() => onSelect(option.value)}
          rightSlot={option.value === value ? <NodexDropdownSelectedIcon /> : null}
        >
          {option.label}
        </NodexDropdownItem>
      ))}
    </NodexDropdownMenu>
  );
}
