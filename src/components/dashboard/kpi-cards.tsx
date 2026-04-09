"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  DollarSign,
  BarChart3,
  Hash,
  Percent,
  MoreVertical,
  Pencil,
  Trash2,
  Palette,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDashboardStore } from "@/lib/dashboard-store";
import { computeKPI, formatNumber } from "@/lib/data-utils";
import type { KPIConfig } from "@/lib/dashboard-types";
import { cn } from "@/lib/utils";

const cardVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      delay: i * 0.08,
      duration: 0.4,
      ease: [0.25, 0.46, 0.45, 0.94],
    },
  }),
};

const AGGREGATION_OPTIONS: KPIConfig["aggregation"][] = [
  "sum", "avg", "count", "min", "max", "median",
];

function getKPIIcon(aggregation: string) {
  switch (aggregation) {
    case "sum":
      return DollarSign;
    case "avg":
      return BarChart3;
    case "count":
      return Hash;
    case "ratio":
      return Percent;
    default:
      return BarChart3;
  }
}

function TrendIndicator({
  direction,
  value,
}: {
  direction: "up" | "down" | "neutral";
  value?: number;
}) {
  if (!value || direction === "neutral") {
    return (
      <div className="flex items-center gap-1 text-muted-foreground">
        <Minus className="w-3.5 h-3.5" />
        <span className="text-xs">0%</span>
      </div>
    );
  }

  const isUp = direction === "up";
  return (
    <div
      className={cn(
        "flex items-center gap-1",
        isUp ? "text-emerald-600" : "text-rose-600"
      )}
    >
      {isUp ? (
        <TrendingUp className="w-3.5 h-3.5" />
      ) : (
        <TrendingDown className="w-3.5 h-3.5" />
      )}
      <span className="text-xs font-medium">{Math.abs(value).toFixed(1)}%</span>
    </div>
  );
}

function KPICard({
  kpi,
  value,
  accentColor,
  style,
}: {
  kpi: KPIConfig;
  value: number;
  accentColor: string;
  style: { border_radius: number; font_sizes: { kpi_value: number; kpi_label: number }; card_shadow?: boolean };
}) {
  const { updateKPI, deleteKPI } = useDashboardStore();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState(kpi.title);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Render icon based on aggregation type (avoid creating component during render)
  const renderIcon = (className: string, style: React.CSSProperties) => {
    const agg = kpi.aggregation;
    if (agg === "sum") return <DollarSign className={className} style={style} />;
    if (agg === "count") return <Hash className={className} style={style} />;
    if (agg === "ratio") return <Percent className={className} style={style} />;
    return <BarChart3 className={className} style={style} />;
  };

  // BUG FIX: formatNumber already includes $ for currency and % for percent,
  // so we should NOT add prefix/suffix when format is currency or percent
  const formattedValue = formatNumber(value, kpi.format);
  const isCurrencyOrPercent = kpi.format === "currency" || kpi.format === "percent";
  const displayValue = isCurrencyOrPercent
    ? formattedValue
    : `${kpi.prefix ?? ""}${formattedValue}${kpi.suffix ?? ""}`;

  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  const handleTitleSave = useCallback(() => {
    if (editTitle.trim()) {
      updateKPI(kpi.id, { title: editTitle.trim() });
    }
    setIsEditingTitle(false);
  }, [editTitle, kpi.id, updateKPI]);

  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleTitleSave();
      if (e.key === "Escape") {
        setEditTitle(kpi.title);
        setIsEditingTitle(false);
      }
    },
    [handleTitleSave, kpi.title]
  );

  const handleStartEditing = useCallback(() => {
    setEditTitle(kpi.title);
    setIsEditingTitle(true);
  }, [kpi.title]);

  return (
    <Card
      className={cn(
        "relative overflow-hidden transition-all hover:shadow-md",
        style.card_shadow !== false ? "shadow-sm" : "shadow-none"
      )}
      style={{
        borderRadius: style.border_radius ?? 12,
        backgroundColor: kpi.bgColor ?? undefined,
        border: kpi.borderColor ? `2px solid ${kpi.borderColor}` : undefined,
      }}
    >
      {/* Accent bar */}
      <div
        className="absolute top-0 left-0 w-full h-1"
        style={{ backgroundColor: accentColor }}
      />
      <CardContent className="p-5 pt-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1.5 flex-1 min-w-0">
            {/* Editable title */}
            {isEditingTitle ? (
              <Input
                ref={titleInputRef}
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={handleTitleSave}
                onKeyDown={handleTitleKeyDown}
                className="h-6 text-xs border-dashed"
                style={{
                  fontSize: `${style.font_sizes.kpi_label ?? 12}px`,
                }}
              />
            ) : (
              <button
                onClick={handleStartEditing}
                className="group flex items-center gap-1 w-full text-left"
              >
                <p
                  className="text-muted-foreground font-medium truncate flex-1"
                  style={{
                    fontSize: `${style.font_sizes.kpi_label ?? 12}px`,
                  }}
                >
                  {kpi.title}
                </p>
                <Pencil className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </button>
            )}

            <p
              className="font-bold tracking-tight text-foreground"
              style={{
                fontSize: `${style.font_sizes.kpi_value ?? 28}px`,
              }}
            >
              {displayValue}
            </p>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{
                backgroundColor: `${accentColor}15`,
              }}
            >
              {renderIcon("w-5 h-5", { color: accentColor })}
            </div>

            {/* 3-dot menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 opacity-0 group-hover/card:opacity-100 hover:opacity-100 transition-opacity"
                  style={{ opacity: undefined }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={handleStartEditing}>
                  <Pencil className="w-4 h-4 mr-2" />
                  Edit Title
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="flex items-center w-full text-sm px-2 py-1.5 cursor-pointer hover:bg-accent rounded-sm">
                        <Palette className="w-4 h-4 mr-2" />
                        Edit Colors
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-4 space-y-4">
                      <div className="space-y-2">
                        <Label className="text-xs">Background Color</Label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={kpi.bgColor ?? "#ffffff"}
                            onChange={(e) => updateKPI(kpi.id, { bgColor: e.target.value })}
                            className="w-8 h-8 rounded border cursor-pointer"
                          />
                          <Input
                            value={kpi.bgColor ?? ""}
                            onChange={(e) => updateKPI(kpi.id, { bgColor: e.target.value || undefined })}
                            placeholder="default"
                            className="h-8 text-xs"
                          />
                          {(kpi.bgColor) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => updateKPI(kpi.id, { bgColor: undefined })}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Border Color</Label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={kpi.borderColor ?? "#e5e7eb"}
                            onChange={(e) => updateKPI(kpi.id, { borderColor: e.target.value })}
                            className="w-8 h-8 rounded border cursor-pointer"
                          />
                          <Input
                            value={kpi.borderColor ?? ""}
                            onChange={(e) => updateKPI(kpi.id, { borderColor: e.target.value || undefined })}
                            placeholder="default"
                            className="h-8 text-xs"
                          />
                          {(kpi.borderColor) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => updateKPI(kpi.id, { borderColor: undefined })}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="flex items-center w-full text-sm px-2 py-1.5 cursor-pointer hover:bg-accent rounded-sm">
                        <BarChart3 className="w-4 h-4 mr-2" />
                        Change Aggregation
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-48 p-2">
                      <div className="space-y-1">
                        {AGGREGATION_OPTIONS.map((agg) => (
                          <button
                            key={agg}
                            className={cn(
                              "block w-full text-left px-2 py-1.5 text-sm rounded-md hover:bg-accent transition-colors",
                              kpi.aggregation === agg && "bg-accent font-medium"
                            )}
                            onClick={() => updateKPI(kpi.id, { aggregation: agg })}
                          >
                            {agg.charAt(0).toUpperCase() + agg.slice(1)}
                          </button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => deleteKPI(kpi.id)}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete KPI
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Trend */}
        {(kpi.trendDirection || kpi.trendValue) && (
          <div className="mt-3">
            <TrendIndicator
              direction={kpi.trendDirection ?? "neutral"}
              value={kpi.trendValue}
            />
          </div>
        )}

        {/* Subtitle */}
        <p className="text-xs text-muted-foreground/70 mt-2 truncate">
          {kpi.aggregation} of {kpi.column}
        </p>
      </CardContent>
    </Card>
  );
}

export function KPICards() {
  const { config, filteredData } = useDashboardStore();

  const kpis = config?.kpis ?? [];
  const style = config?.style;

  const kpiValues = useMemo(() => {
    return kpis.map((kpi) => computeKPI(filteredData, kpi));
  }, [kpis, filteredData]);

  if (kpis.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {kpis.map((kpi, index) => {
        const value = kpiValues[index];
        const accentColor =
          style?.colors.chart[index % style.colors.chart.length] ?? "hsl(24, 95%, 53%)";

        return (
          <motion.div
            key={kpi.id}
            custom={index}
            variants={cardVariants}
            initial="hidden"
            animate="visible"
          >
            <KPICard
              kpi={kpi}
              value={value}
              accentColor={accentColor}
              style={{
                border_radius: style?.border_radius ?? 12,
                font_sizes: style?.font_sizes ?? { kpi_value: 28, kpi_label: 12 },
                card_shadow: style?.card_shadow,
              }}
            />
          </motion.div>
        );
      })}
    </div>
  );
}
