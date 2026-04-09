"use client";

import React, { useCallback, useState } from "react";
import { X, Save } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useDashboardStore } from "@/lib/dashboard-store";
import type { ChartType, ChartConfig, ColumnMeta } from "@/lib/dashboard-types";
import { CHART_COLORS } from "@/lib/dashboard-types";

const CHART_TYPE_OPTIONS: { value: ChartType; label: string }[] = [
  { value: "line", label: "Line" },
  { value: "bar", label: "Bar" },
  { value: "horizontal_bar", label: "Horizontal Bar" },
  { value: "stacked_bar", label: "Stacked Bar" },
  { value: "area", label: "Area" },
  { value: "pie", label: "Pie" },
  { value: "donut", label: "Donut" },
  { value: "stacked_area", label: "Stacked Area" },
  { value: "scatter", label: "Scatter" },
  { value: "combo_chart", label: "Combo" },
  { value: "histogram", label: "Histogram" },
];

interface EditState {
  title: string;
  type: ChartType;
  x: string;
  y: string[];
  bgColor: string;
  borderColor: string;
}

function ChartEditorContent({
  chart,
  columns,
  onClose,
}: {
  chart: ChartConfig;
  columns: ColumnMeta[];
  onClose: () => void;
}) {
  const { updateChart } = useDashboardStore();

  // Initialize state from chart props (component remounts via key when chart changes)
  const [editState, setEditState] = useState<EditState>({
    title: chart.title,
    type: chart.type,
    x: chart.x,
    y: [...chart.y],
    bgColor: chart.bgColor ?? "",
    borderColor: chart.borderColor ?? "",
  });

  const handleSave = useCallback(() => {
    updateChart(chart.id, {
      title: editState.title,
      type: editState.type,
      x: editState.x,
      y: editState.y,
      bgColor: editState.bgColor || undefined,
      borderColor: editState.borderColor || undefined,
    });
    onClose();
  }, [chart.id, editState, updateChart, onClose]);

  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") handleCancel();
      if (e.key === "Enter" && e.metaKey) handleSave();
    },
    [handleCancel, handleSave]
  );

  const toggleYColumn = useCallback((colName: string) => {
    setEditState((prev) => {
      const newY = prev.y.includes(colName)
        ? prev.y.filter((y) => y !== colName)
        : [...prev.y, colName];
      return { ...prev, y: newY };
    });
  }, []);

  const numericColumns = columns.filter((c) => c.type === "number" || c.type === "boolean");
  const allColumns = columns.map((c) => c.name);

  return (
    <SheetContent
      side="right"
      className="w-[380px] sm:w-[420px] p-0"
      onKeyDown={handleKeyDown}
    >
      <SheetHeader className="p-5 pb-0">
        <div className="flex items-center justify-between">
          <div>
            <SheetTitle className="text-base">Edit Chart</SheetTitle>
            <SheetDescription className="text-xs">
              Configure chart properties and data mapping
            </SheetDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </SheetHeader>

      <ScrollArea className="h-[calc(100vh-160px)] px-5 pb-8">
        <div className="pt-6 space-y-6">
          {/* Title */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Chart Title</Label>
            <Input
              value={editState.title}
              onChange={(e) => setEditState((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="Enter chart title"
            />
          </div>

          <Separator />

          {/* Chart Type */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Chart Type</Label>
            <Select
              value={editState.type}
              onValueChange={(val) => setEditState((prev) => ({ ...prev, type: val as ChartType }))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHART_TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* X Axis */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">X-Axis Column</Label>
            <Select
              value={editState.x}
              onValueChange={(val) => setEditState((prev) => ({ ...prev, x: val }))}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select column" />
              </SelectTrigger>
              <SelectContent>
                {allColumns.map((col) => (
                  <SelectItem key={col} value={col}>
                    {col}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* Y Axis */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Y-Axis Columns</Label>
            <p className="text-xs text-muted-foreground">
              Click to toggle columns on/off
            </p>
            <div className="max-h-48 overflow-y-auto space-y-1 border rounded-md p-2">
              {numericColumns.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  No numeric columns available
                </p>
              )}
              {numericColumns.map((col) => {
                const isSelected = editState.y.includes(col.name);
                return (
                  <button
                    key={col.name}
                    className={`block w-full text-left px-3 py-2 text-sm rounded-md transition-colors ${
                      isSelected
                        ? "bg-accent font-medium"
                        : "hover:bg-accent/50"
                    }`}
                    onClick={() => toggleYColumn(col.name)}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-4 h-4 rounded border-2 flex items-center justify-center ${
                          isSelected ? "bg-primary border-primary" : "border-muted-foreground/30"
                        }`}
                      >
                        {isSelected && (
                          <svg className="w-3 h-3 text-primary-foreground" viewBox="0 0 12 12" fill="none">
                            <path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                      <span>{col.name}</span>
                      <span className="text-xs text-muted-foreground ml-auto">
                        {col.type}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <Separator />

          {/* Colors */}
          <div className="space-y-4">
            <Label className="text-sm font-medium">Colors</Label>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Background Color</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={editState.bgColor || "#ffffff"}
                    onChange={(e) => setEditState((prev) => ({ ...prev, bgColor: e.target.value }))}
                    className="w-10 h-8 rounded border cursor-pointer"
                  />
                  <Input
                    value={editState.bgColor}
                    onChange={(e) => setEditState((prev) => ({ ...prev, bgColor: e.target.value }))}
                    placeholder="default (white)"
                    className="h-8 text-xs flex-1"
                  />
                  {editState.bgColor && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => setEditState((prev) => ({ ...prev, bgColor: "" }))}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Border Color</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={editState.borderColor || "#e5e7eb"}
                    onChange={(e) => setEditState((prev) => ({ ...prev, borderColor: e.target.value }))}
                    className="w-10 h-8 rounded border cursor-pointer"
                  />
                  <Input
                    value={editState.borderColor}
                    onChange={(e) => setEditState((prev) => ({ ...prev, borderColor: e.target.value }))}
                    placeholder="default (none)"
                    className="h-8 text-xs flex-1"
                  />
                  {editState.borderColor && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => setEditState((prev) => ({ ...prev, borderColor: "" }))}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Chart Color Palette */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Chart Color Palette</Label>
              <div className="flex gap-1.5 flex-wrap">
                {CHART_COLORS.map((color, i) => (
                  <div
                    key={i}
                    className="w-7 h-7 rounded-md border cursor-pointer hover:scale-110 transition-transform"
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>

      {/* Footer with Save/Cancel */}
      <div className="absolute bottom-0 left-0 right-0 border-t p-4 bg-background">
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave} className="gap-2">
            <Save className="w-4 h-4" />
            Save Changes
          </Button>
        </div>
      </div>
    </SheetContent>
  );
}

export function ChartEditor() {
  const { config, selectedChartId, setSelectedChartId, columns } = useDashboardStore();

  const chart = config?.charts.find((c) => c.id === selectedChartId);
  const isOpen = !!selectedChartId && !!chart;

  const handleClose = useCallback(() => {
    setSelectedChartId(null);
  }, [setSelectedChartId]);

  if (!chart || !isOpen) return null;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      {/* Use key to force remount when chart changes, resetting edit state */}
      <ChartEditorContent
        key={chart.id}
        chart={chart}
        columns={columns}
        onClose={handleClose}
      />
    </Sheet>
  );
}
