"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  ScatterChart,
  Scatter,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { BarChart3, MoreVertical, Pencil, Trash2, Palette, Settings2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent } from "@/components/ui/chart";
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
import { useDashboardStore } from "@/lib/dashboard-store";
import type { ChartConfig as DashboardChartConfig, ChartType, RawDataRow } from "@/lib/dashboard-types";
import { DEFAULT_STYLE, CHART_COLORS } from "@/lib/dashboard-types";
import { cn } from "@/lib/utils";

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

interface ChartEngineProps {
  chartConfig: DashboardChartConfig;
  data?: RawDataRow[];
  className?: string;
}

export function ChartEngine({ chartConfig, data, className }: ChartEngineProps) {
  const config = useDashboardStore((s) => s.config);
  const { updateChart, deleteChart, setSelectedChartId } = useDashboardStore();
  const style = config?.style ?? DEFAULT_STYLE;
  const colors = style.colors.chart;

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState(chartConfig.title);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  const handleTitleSave = useCallback(() => {
    if (editTitle.trim()) {
      updateChart(chartConfig.id, { title: editTitle.trim() });
    }
    setIsEditingTitle(false);
  }, [editTitle, chartConfig.id, updateChart]);

  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleTitleSave();
      if (e.key === "Escape") {
        setEditTitle(chartConfig.title);
        setIsEditingTitle(false);
      }
    },
    [handleTitleSave, chartConfig.title]
  );

  const handleStartEditingTitle = useCallback(() => {
    setEditTitle(chartConfig.title);
    setIsEditingTitle(true);
  }, [chartConfig.title]);

  const handleOpenEditor = useCallback(() => {
    setSelectedChartId(chartConfig.id);
  }, [chartConfig.id, setSelectedChartId]);

  const chartData = useMemo(() => {
    if (data && data.length > 0) return data;
    if (chartConfig.data && chartConfig.data.length > 0) return chartConfig.data;
    return [];
  }, [data, chartConfig.data]);

  const processedData = useMemo(() => {
    if (chartConfig.type !== "histogram") return chartData;

    const col = chartConfig.x;
    const values = chartData.map((r) => Number(r[col])).filter((v) => !isNaN(v));
    if (values.length === 0) return chartData;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const bucketCount = chartConfig.config.buckets ?? 10;
    const binWidth = (max - min) / bucketCount || 1;

    const bins: { range: string; count: number }[] = [];
    for (let i = 0; i < bucketCount; i++) {
      const low = min + i * binWidth;
      const high = low + binWidth;
      const count = values.filter((v) => (i === bucketCount - 1 ? v >= low && v <= high : v >= low && v < high)).length;
      bins.push({
        range: `${Math.round(low * 10) / 10}-${Math.round(high * 10) / 10}`,
        count,
      });
    }
    return bins as unknown as RawDataRow[];
  }, [chartConfig, chartData]);

  if (processedData.length === 0) {
    return (
      <Card className={className} style={{ borderRadius: style.border_radius }}>
        <CardContent className="flex items-center justify-center h-48 text-muted-foreground">
          <div className="flex flex-col items-center gap-2">
            <BarChart3 className="w-8 h-8 opacity-40" />
            <p className="text-sm">No data available</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const allKeys = chartConfig.type === "histogram"
    ? ["count"]
    : [...chartConfig.y, ...(chartConfig.additionalSeries?.map((s) => s.key) ?? [])];

  const shadcnChartConfig = allKeys.reduce(
    (acc, key, i) => {
      acc[key] = { label: key, color: colors[i % colors.length] };
      return acc;
    },
    {} as Record<string, { label: string; color: string }>
  );

  const isHorizontal = chartConfig.type === "horizontal_bar";
  const tickFontSize = style.font_sizes.axis;
  const strokeWidth = chartConfig.config.stroke_width ?? style.chart_stroke_width ?? 2;
  const curveType = chartConfig.config.curveType ?? "monotone";

  const renderCartesianAxes = () => (
    <>
      <XAxis
        dataKey={isHorizontal ? undefined : chartConfig.x}
        type={isHorizontal ? "number" : "category"}
        tick={{ fontSize: tickFontSize, fill: style.colors.textSecondary }}
        axisLine={{ stroke: style.colors.textSecondary, strokeWidth: 0.5 }}
        tickLine={false}
        tickMargin={8}
      />
      <YAxis
        dataKey={isHorizontal ? chartConfig.x : undefined}
        type={isHorizontal ? "category" : "number"}
        tick={{ fontSize: tickFontSize, fill: style.colors.textSecondary }}
        axisLine={false}
        tickLine={false}
        tickMargin={8}
        width={isHorizontal ? 100 : 50}
      />
    </>
  );

  const renderTooltip = () =>
    chartConfig.config.showTooltip !== false ? (
      <ChartTooltip content={<ChartTooltipContent />} />
    ) : null;

  const renderLegend = () =>
    chartConfig.config.showLegend && allKeys.length > 1 ? (
      <ChartLegend content={<ChartLegendContent />} />
    ) : null;

  const renderGrid = () =>
    style.gridlines ? (
      <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} />
    ) : null;

  const renderBars = (stacked = false) =>
    chartConfig.y.map((yKey, i) => (
      <Bar
        key={yKey}
        dataKey={yKey}
        fill={colors[i % colors.length]}
        radius={[4, 4, 0, 0]}
        stackId={stacked ? "stack" : undefined}
        maxBarSize={chartConfig.config.barThickness ?? style.bar_thickness}
        fillOpacity={chartConfig.config.fillOpacity ?? 0.85}
      />
    ));

  const renderChart = () => {
    switch (chartConfig.type) {
      case "line":
        return (
          <ChartContainer config={shadcnChartConfig} className="w-full h-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={processedData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                {renderGrid()}
                {renderCartesianAxes()}
                {renderTooltip()}
                {renderLegend()}
                {chartConfig.y.map((yKey, i) => (
                  <Line
                    key={yKey}
                    type={curveType}
                    dataKey={yKey}
                    stroke={colors[i % colors.length]}
                    strokeWidth={strokeWidth}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </ChartContainer>
        );

      case "bar":
        return (
          <ChartContainer config={shadcnChartConfig} className="w-full h-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={processedData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                {renderGrid()}
                {renderCartesianAxes()}
                {renderTooltip()}
                {renderLegend()}
                {renderBars()}
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        );

      case "horizontal_bar":
        return (
          <ChartContainer config={shadcnChartConfig} className="w-full h-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={processedData}
                layout="vertical"
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                {renderGrid()}
                {renderCartesianAxes()}
                {renderTooltip()}
                {renderLegend()}
                {renderBars()}
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        );

      case "stacked_bar":
        return (
          <ChartContainer config={shadcnChartConfig} className="w-full h-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={processedData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                {renderGrid()}
                {renderCartesianAxes()}
                {renderTooltip()}
                {renderLegend()}
                {renderBars(true)}
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        );

      case "area":
      case "stacked_area":
        return (
          <ChartContainer config={shadcnChartConfig} className="w-full h-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={processedData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                {renderGrid()}
                {renderCartesianAxes()}
                {renderTooltip()}
                {renderLegend()}
                {chartConfig.y.map((yKey, i) => (
                  <Area
                    key={yKey}
                    type={curveType}
                    dataKey={yKey}
                    stroke={colors[i % colors.length]}
                    fill={colors[i % colors.length]}
                    fillOpacity={0.15}
                    strokeWidth={strokeWidth}
                    stackId={chartConfig.type === "stacked_area" ? "area" : undefined}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </ChartContainer>
        );

      case "pie":
        return (
          <ChartContainer config={shadcnChartConfig} className="w-full h-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                {renderTooltip()}
                <Pie
                  data={processedData}
                  dataKey={chartConfig.y[0]}
                  nameKey={chartConfig.x}
                  cx="50%"
                  cy="50%"
                  outerRadius={chartConfig.config.outerRadius ?? 100}
                  strokeWidth={2}
                  stroke="#fff"
                >
                  {processedData.map((_, i) => (
                    <Cell key={i} fill={colors[i % colors.length]} />
                  ))}
                </Pie>
                {renderLegend()}
              </PieChart>
            </ResponsiveContainer>
          </ChartContainer>
        );

      case "donut":
        return (
          <ChartContainer config={shadcnChartConfig} className="w-full h-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                {renderTooltip()}
                <Pie
                  data={processedData}
                  dataKey={chartConfig.y[0]}
                  nameKey={chartConfig.x}
                  cx="50%"
                  cy="50%"
                  innerRadius={chartConfig.config.innerRadius ?? style.donut_inner_radius ?? 60}
                  outerRadius={chartConfig.config.outerRadius ?? 100}
                  strokeWidth={2}
                  stroke="#fff"
                >
                  {processedData.map((_, i) => (
                    <Cell key={i} fill={colors[i % colors.length]} />
                  ))}
                </Pie>
                {renderLegend()}
              </PieChart>
            </ResponsiveContainer>
          </ChartContainer>
        );

      case "scatter":
        return (
          <ChartContainer config={shadcnChartConfig} className="w-full h-full">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                {renderGrid()}
                <XAxis
                  dataKey={chartConfig.x}
                  tick={{ fontSize: tickFontSize, fill: style.colors.textSecondary }}
                  axisLine={{ stroke: style.colors.textSecondary, strokeWidth: 0.5 }}
                  tickLine={false}
                  tickMargin={8}
                />
                <YAxis
                  dataKey={chartConfig.y[0]}
                  tick={{ fontSize: tickFontSize, fill: style.colors.textSecondary }}
                  axisLine={false}
                  tickLine={false}
                  tickMargin={8}
                />
                {renderTooltip()}
                <Scatter
                  data={processedData}
                  fill={colors[0]}
                  fillOpacity={0.7}
                />
              </ScatterChart>
            </ResponsiveContainer>
          </ChartContainer>
        );

      case "combo_chart": {
        const additional = chartConfig.additionalSeries ?? [];
        return (
          <ChartContainer config={shadcnChartConfig} className="w-full h-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={processedData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                {renderGrid()}
                {renderCartesianAxes()}
                {renderTooltip()}
                {renderLegend()}
                {chartConfig.y.map((yKey, i) => (
                  <Bar
                    key={yKey}
                    dataKey={yKey}
                    fill={colors[i % colors.length]}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={chartConfig.config.barThickness ?? style.bar_thickness}
                    fillOpacity={0.85}
                  />
                ))}
                {additional.map((series, i) => (
                  <Line
                    key={series.key}
                    type={curveType}
                    dataKey={series.key}
                    stroke={colors[(chartConfig.y.length + i) % colors.length]}
                    strokeWidth={strokeWidth}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }}
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </ChartContainer>
        );
      }

      case "histogram":
        return (
          <ChartContainer config={shadcnChartConfig} className="w-full h-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={processedData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                {renderGrid()}
                <XAxis
                  dataKey="range"
                  tick={{ fontSize: tickFontSize, fill: style.colors.textSecondary }}
                  axisLine={{ stroke: style.colors.textSecondary, strokeWidth: 0.5 }}
                  tickLine={false}
                  tickMargin={8}
                />
                <YAxis
                  tick={{ fontSize: tickFontSize, fill: style.colors.textSecondary }}
                  axisLine={false}
                  tickLine={false}
                  tickMargin={8}
                />
                {renderTooltip()}
                <Bar
                  dataKey="count"
                  fill={colors[0]}
                  radius={[4, 4, 0, 0]}
                  fillOpacity={0.85}
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        );

      default:
        return (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p className="text-sm">Chart type &quot;{chartConfig.type}&quot; not yet supported</p>
          </div>
        );
    }
  };

  return (
    <Card
      className={cn("overflow-hidden group/card relative", className)}
      style={{
        borderRadius: style.border_radius,
        boxShadow: style.card_shadow !== false ? undefined : "none",
        backgroundColor: chartConfig.bgColor ?? undefined,
        border: chartConfig.borderColor ? `2px solid ${chartConfig.borderColor}` : undefined,
      }}
    >
      {/* Header with editable title and context menu */}
      {(chartConfig.title || chartConfig.description) && (
        <CardHeader className="pb-2 pt-5 px-5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              {chartConfig.title && (
                isEditingTitle ? (
                  <Input
                    ref={titleInputRef}
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={handleTitleSave}
                    onKeyDown={handleTitleKeyDown}
                    className="h-7 text-sm border-dashed"
                    style={{ fontSize: `${style.font_sizes.title}px` }}
                  />
                ) : (
                  <button
                    onClick={handleStartEditingTitle}
                    className="group/title flex items-center gap-1.5 w-full text-left"
                  >
                    <CardTitle
                      className="truncate flex-1"
                      style={{ fontSize: `${style.font_sizes.title}px` }}
                    >
                      {chartConfig.title}
                    </CardTitle>
                    <Pencil className="w-3 h-3 text-muted-foreground opacity-0 group-hover/title:opacity-100 transition-opacity shrink-0" />
                  </button>
                )
              )}
              {chartConfig.description && (
                <CardDescription style={{ fontSize: `${style.font_sizes.subtitle}px` }}>
                  {chartConfig.description}
                </CardDescription>
              )}
            </div>

            {/* Context menu button */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 opacity-0 group-hover/card:opacity-100 transition-opacity shrink-0"
                >
                  <MoreVertical className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={handleStartEditingTitle}>
                  <Pencil className="w-4 h-4 mr-2" />
                  Edit Title
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleOpenEditor}>
                  <Settings2 className="w-4 h-4 mr-2" />
                  Edit Chart
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
                            value={chartConfig.bgColor ?? "#ffffff"}
                            onChange={(e) => updateChart(chartConfig.id, { bgColor: e.target.value })}
                            className="w-8 h-8 rounded border cursor-pointer"
                          />
                          <Input
                            value={chartConfig.bgColor ?? ""}
                            onChange={(e) => updateChart(chartConfig.id, { bgColor: e.target.value || undefined })}
                            placeholder="default"
                            className="h-8 text-xs"
                          />
                          {(chartConfig.bgColor) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => updateChart(chartConfig.id, { bgColor: undefined })}
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
                            value={chartConfig.borderColor ?? "#e5e7eb"}
                            onChange={(e) => updateChart(chartConfig.id, { borderColor: e.target.value })}
                            className="w-8 h-8 rounded border cursor-pointer"
                          />
                          <Input
                            value={chartConfig.borderColor ?? ""}
                            onChange={(e) => updateChart(chartConfig.id, { borderColor: e.target.value || undefined })}
                            placeholder="default"
                            className="h-8 text-xs"
                          />
                          {(chartConfig.borderColor) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => updateChart(chartConfig.id, { borderColor: undefined })}
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

                {/* Chart type submenu */}
                <DropdownMenuItem asChild>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="flex items-center w-full text-sm px-2 py-1.5 cursor-pointer hover:bg-accent rounded-sm">
                        <BarChart3 className="w-4 h-4 mr-2" />
                        Change Chart Type
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-48 p-2">
                      <div className="max-h-64 overflow-y-auto space-y-1">
                        {CHART_TYPE_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            className={cn(
                              "block w-full text-left px-2 py-1.5 text-sm rounded-md hover:bg-accent transition-colors",
                              chartConfig.type === opt.value && "bg-accent font-medium"
                            )}
                            onClick={() => updateChart(chartConfig.id, { type: opt.value })}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => deleteChart(chartConfig.id)}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Chart
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>
      )}
      <CardContent className="px-2 pb-2" style={{ height: 300 }}>
        {renderChart()}
      </CardContent>
    </Card>
  );
}
