"use client";

import React from "react";
import { LayoutDashboard, LayoutGrid, LayoutList } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useDashboardStore } from "@/lib/dashboard-store";
import type { LayoutType } from "@/lib/dashboard-types";

const layouts: { value: LayoutType; label: string; icon: React.ReactNode }[] = [
  {
    value: "executive",
    label: "Executive",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="stroke-current">
        <rect x="1" y="1" width="16" height="5" rx="1" strokeWidth="1.5" />
        <rect x="1" y="8" width="7.5" height="9" rx="1" strokeWidth="1.5" />
        <rect x="9.5" y="8" width="7.5" height="9" rx="1" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    value: "analytical",
    label: "Analytical",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="stroke-current">
        <rect x="1" y="1" width="5" height="7" rx="1" strokeWidth="1.5" />
        <rect x="6.5" y="1" width="5" height="7" rx="1" strokeWidth="1.5" />
        <rect x="12" y="1" width="5" height="7" rx="1" strokeWidth="1.5" />
        <rect x="1" y="10" width="10.5" height="7" rx="1" strokeWidth="1.5" />
        <rect x="12" y="10" width="5" height="7" rx="1" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    value: "compact",
    label: "Compact",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="stroke-current">
        <rect x="1" y="1" width="7" height="7" rx="1" strokeWidth="1.5" />
        <rect x="10" y="1" width="7" height="7" rx="1" strokeWidth="1.5" />
        <rect x="1" y="10" width="7" height="7" rx="1" strokeWidth="1.5" />
        <rect x="10" y="10" width="7" height="7" rx="1" strokeWidth="1.5" />
      </svg>
    ),
  },
];

export function LayoutSwitcher() {
  const { config, setLayout } = useDashboardStore();
  const currentLayout = config?.layout ?? "analytical";

  return (
    <ToggleGroup
      type="single"
      value={currentLayout}
      onValueChange={(value) => {
        if (value) setLayout(value as LayoutType);
      }}
      variant="outline"
      className="h-9"
    >
      {layouts.map((layout) => (
        <Tooltip key={layout.value}>
          <TooltipTrigger asChild>
            <ToggleGroupItem
              value={layout.value}
              aria-label={layout.label}
              className="px-2.5 data-[state=on]:bg-orange-500 data-[state=on]:text-white data-[state=on]:border-orange-500"
            >
              {layout.icon}
            </ToggleGroupItem>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            {layout.label}
          </TooltipContent>
        </Tooltip>
      ))}
    </ToggleGroup>
  );
}
