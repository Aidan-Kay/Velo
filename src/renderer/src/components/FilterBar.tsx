import { ChevronDownIcon, MagnifyingGlassIcon } from "@heroicons/react/20/solid";
import React from "react";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Input } from "./ui/input";

export interface FilterOption {
  value: string;
  label: string;
}

interface FilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  /** Multi-select status filter */
  statusOptions?: FilterOption[];
  statusValue?: string[];
  onStatusChange?: (value: string[]) => void;
  statusAllLabel?: string;
  actions?: React.ReactNode;
}

const FilterBar: React.FC<FilterBarProps> = ({
  search,
  onSearchChange,
  statusOptions,
  statusValue,
  onStatusChange,
  statusAllLabel = "All statuses",
  actions,
}) => {
  const allSelected = !statusValue || statusValue.length === 0 || (statusOptions != null && statusValue.length === statusOptions.length);

  const toggleStatusValue = (v: string) => {
    if (!onStatusChange || !statusValue) return;
    if (statusValue.includes(v)) {
      const next = statusValue.filter((x) => x !== v);
      onStatusChange(next);
    } else {
      const next = [...statusValue, v];
      // If all options are now selected, clear to [] (meaning "show all")
      if (statusOptions && next.length === statusOptions.length) {
        onStatusChange([]);
      } else {
        onStatusChange(next);
      }
    }
  };

  const displayLabel = allSelected
    ? statusAllLabel
    : statusValue!.length === 1
      ? (statusOptions?.find((o) => o.value === statusValue![0])?.label ?? statusValue![0])
      : `${statusValue!.length} selected`;

  return (
    <div className="flex items-center gap-3">
      {/* Search */}
      <div className="relative flex-1 min-w-[180px]">
        <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input type="text" value={search} onChange={(e) => onSearchChange(e.target.value)} placeholder="Search…" className="pl-9" />
      </div>

      {/* Status filter (multi-select via dropdown menu with checkboxes) */}
      {statusOptions && onStatusChange && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="w-44 justify-between">
              <span className="truncate">{displayLabel}</span>
              <ChevronDownIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-44">
            <DropdownMenuCheckboxItem checked={allSelected} onCheckedChange={() => onStatusChange([])}>
              {statusAllLabel}
            </DropdownMenuCheckboxItem>
            {statusOptions.map((opt) => (
              <DropdownMenuCheckboxItem
                key={opt.value}
                checked={allSelected || (statusValue?.includes(opt.value) ?? false)}
                onCheckedChange={() => toggleStatusValue(opt.value)}
              >
                {opt.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Extra action buttons */}
      {actions}
    </div>
  );
};

export default FilterBar;
