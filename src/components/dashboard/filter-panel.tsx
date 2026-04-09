"use client";

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Filter,
  X,
  Check,
  ChevronsUpDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { useDashboardStore } from "@/lib/dashboard-store";
import { applyFilters } from "@/lib/data-utils";
import type { FilterConfig } from "@/lib/dashboard-types";
import { cn } from "@/lib/utils";

function FilterChip({
  filter,
  onUpdate,
}: {
  filter: FilterConfig;
  onUpdate: (id: string, updates: Partial<FilterConfig>) => void;
}) {
  const options = filter.options ?? [];
  const selected = filter.selectedValues ?? [];
  const isSingle = filter.type === "select";

  const toggleValue = useCallback(
    (value: string) => {
      if (isSingle) {
        onUpdate(filter.id, {
          selectedValues: selected.includes(value) ? [] : [value],
        });
      } else {
        const newSelected = selected.includes(value)
          ? selected.filter((v) => v !== value)
          : [...selected, value];
        onUpdate(filter.id, { selectedValues: newSelected });
      }
    },
    [filter.id, isSingle, onUpdate, selected]
  );

  const displayLabel =
    selected.length === 0
      ? filter.label
      : selected.length === 1
        ? selected[0]
        : `${selected.length} selected`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={selected.length > 0 ? "default" : "outline"}
          size="sm"
          className={cn(
            "shrink-0 text-xs h-8 gap-1.5 rounded-full px-3",
            selected.length > 0
              ? "bg-[#f0c040] hover:bg-[#e5b030] text-[#2b2b2b] font-medium shadow-sm"
              : "border-[#555] text-[#ccc] hover:bg-[#404040] hover:text-white"
          )}
        >
          <Filter className="w-3 h-3" />
          <span className="truncate max-w-[100px]">{filter.label}</span>
          {selected.length > 0 && (
            <Badge
              variant="secondary"
              className="ml-0.5 bg-[#2b2b2b] text-white text-[10px] px-1.5 py-0 h-4 min-w-[18px] rounded-full"
            >
              {selected.length}
            </Badge>
          )}
          <ChevronsUpDown className="w-3 h-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <div className="max-h-64 overflow-y-auto space-y-1">
          {options.map((option) => {
            const isChecked = selected.includes(option);
            return (
              <label
                key={option}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer hover:bg-accent transition-colors text-sm",
                  isChecked && "bg-[#f0c040]/10"
                )}
              >
                <Checkbox
                  checked={isChecked}
                  onCheckedChange={() => toggleValue(option)}
                  className="data-[state=checked]:bg-[#f0c040] data-[state=checked]:border-[#f0c040] data-[state=checked]:text-[#2b2b2b]"
                />
                <span className="truncate flex-1">{option}</span>
              </label>
            );
          })}
        </div>
        {selected.length > 0 && (
          <>
            <Separator className="my-2" />
            <Button
              variant="ghost"
              size="sm"
              className="w-full h-7 text-xs"
              onClick={() => onUpdate(filter.id, { selectedValues: [] })}
            >
              <X className="w-3 h-3 mr-1" />
              Clear &quot;{filter.label}&quot;
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function FilterBar() {
  const { config, rawData, filters: storeFilters, updateFilter, setFilteredData } = useDashboardStore();

  const filters = config?.filters ?? [];
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeFilterCount = useMemo(
    () => filters.filter((f) => (f.selectedValues?.length ?? 0) > 0).length,
    [filters]
  );

  const handleUpdateFilter = useCallback(
    (id: string, updates: Partial<FilterConfig>) => {
      updateFilter(id, updates);
    },
    [updateFilter]
  );

  // Auto-apply filters when they change (Power BI style - no Apply button)
  useEffect(() => {
    if (!config) return;
    const filtered = applyFilters(rawData, filters);
    setFilteredData(filtered);
  }, [config, rawData, filters, setFilteredData]);

  const handleClearAll = useCallback(() => {
    filters.forEach((f) => {
      if ((f.selectedValues?.length ?? 0) > 0) {
        updateFilter(f.id, { selectedValues: [] });
      }
    });
  }, [filters, updateFilter]);

  if (filters.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      {/* Filter chips - horizontal scrollable */}
      <div
        ref={scrollRef}
        className="flex items-center gap-2 overflow-x-auto flex-1 scrollbar-none py-1"
      >
        {filters.map((filter) => (
          <FilterChip
            key={filter.id}
            filter={filter}
            onUpdate={handleUpdateFilter}
          />
        ))}
      </div>

      {/* Active count badge + Clear all */}
      {activeFilterCount > 0 && (
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge
            variant="outline"
            className="bg-[#f0c040]/10 text-[#f0c040] border-[#f0c040]/30 text-xs px-2 h-6 rounded-full font-medium"
          >
            {activeFilterCount} active
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-[#999] hover:text-[#f0c040] hover:bg-[#f0c040]/10"
            onClick={handleClearAll}
            title="Clear all filters"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
