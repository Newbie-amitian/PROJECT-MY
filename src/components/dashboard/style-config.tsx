"use client";

import React, { useCallback } from "react";
import {
  Palette,
  Type,
  Grid3x3,
  CircleDot,
  Square,
  Sparkles,
  Sun,
  Moon,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDashboardStore } from "@/lib/dashboard-store";
import { DEFAULT_STYLE } from "@/lib/dashboard-types";
import type { StyleConfig } from "@/lib/dashboard-types";
import { cn } from "@/lib/utils";

const FONT_OPTIONS = [
  "Inter, sans-serif",
  "system-ui, sans-serif",
  "'Segoe UI', sans-serif",
  "Georgia, serif",
  "'IBM Plex Sans', sans-serif",
  "'DM Sans', sans-serif",
];

const COLOR_PALETTES: { name: string; colors: string[] }[] = [
  {
    name: "Warm",
    colors: [
      "hsl(24, 95%, 53%)",
      "hsl(45, 93%, 47%)",
      "hsl(0, 84%, 60%)",
      "hsl(347, 77%, 50%)",
      "hsl(30, 80%, 55%)",
      "hsl(15, 90%, 50%)",
      "hsl(50, 95%, 55%)",
      "hsl(340, 75%, 55%)",
    ],
  },
  {
    name: "Earth",
    colors: [
      "hsl(160, 84%, 39%)",
      "hsl(142, 71%, 45%)",
      "hsl(80, 61%, 50%)",
      "hsl(45, 93%, 47%)",
      "hsl(24, 95%, 53%)",
      "hsl(199, 89%, 48%)",
      "hsl(170, 60%, 45%)",
      "hsl(30, 70%, 50%)",
    ],
  },
  {
    name: "Vibrant",
    colors: [
      "hsl(24, 95%, 53%)",
      "hsl(160, 84%, 39%)",
      "hsl(252, 47%, 51%)",
      "hsl(199, 89%, 48%)",
      "hsl(347, 77%, 50%)",
      "hsl(45, 93%, 47%)",
      "hsl(142, 71%, 45%)",
      "hsl(271, 91%, 65%)",
    ],
  },
  {
    name: "Sunset",
    colors: [
      "hsl(347, 77%, 50%)",
      "hsl(24, 95%, 53%)",
      "hsl(45, 93%, 47%)",
      "hsl(0, 84%, 60%)",
      "hsl(320, 70%, 50%)",
      "hsl(15, 90%, 55%)",
      "hsl(340, 75%, 55%)",
      "hsl(30, 80%, 55%)",
    ],
  },
];

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        <Label className="text-sm font-medium">{label}</Label>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function PalettePicker({
  colors,
  activePalette,
  onSelect,
}: {
  colors: string[];
  activePalette: string[];
  onSelect: (colors: string[]) => void;
}) {
  const isActive =
    colors.length === activePalette.length &&
    colors.every((c, i) => c === activePalette[i]);

  return (
    <button
      onClick={() => onSelect(colors)}
      className={cn(
        "flex gap-1 p-2 rounded-lg border-2 transition-all hover:scale-105",
        isActive
          ? "border-orange-500 bg-orange-50 dark:bg-orange-950/20"
          : "border-transparent hover:border-muted-foreground/30"
      )}
    >
      {colors.slice(0, 8).map((color, i) => (
        <div
          key={i}
          className="w-4 h-4 rounded-full shrink-0"
          style={{ backgroundColor: color }}
        />
      ))}
    </button>
  );
}

export function StyleConfig() {
  const { config, setStyle, isStylePanelOpen, setIsStylePanelOpen } = useDashboardStore();
  const style = config?.style ?? DEFAULT_STYLE;

  const updateStyle = useCallback(
    (updates: Partial<StyleConfig>) => {
      setStyle(updates);
    },
    [setStyle]
  );

  return (
    <Sheet open={isStylePanelOpen} onOpenChange={setIsStylePanelOpen}>
      <SheetContent side="right" className="w-[340px] sm:w-[380px] p-0">
        <SheetHeader className="p-5 pb-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-orange-100 dark:bg-orange-950/30 flex items-center justify-center">
              <Palette className="w-4 h-4 text-orange-600 dark:text-orange-400" />
            </div>
            <div>
              <SheetTitle className="text-base">Style Settings</SheetTitle>
              <SheetDescription className="text-xs">
                Customize the look and feel of your dashboard
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-100px)] px-5 pb-8">
          <div className="pt-6 space-y-6">
            {/* Typography */}
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <Type className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Typography</h3>
              </div>
              <SettingRow label="Font Family" description="Choose a typeface for the dashboard">
                <Select
                  value={style.font_family}
                  onValueChange={(val) => updateStyle({ font_family: val })}
                >
                  <SelectTrigger className="w-44" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FONT_OPTIONS.map((font) => (
                      <SelectItem key={font} value={font} style={{ fontFamily: font }}>
                        {font.split(",")[0].replace(/'/g, "")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>
            </section>

            <Separator />

            {/* Colors */}
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Chart Colors</h3>
              </div>
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">Choose a palette preset</p>
                <div className="grid grid-cols-2 gap-2">
                  {COLOR_PALETTES.map((palette) => (
                    <div key={palette.name} className="space-y-1">
                      <PalettePicker
                        colors={palette.colors}
                        activePalette={style.colors.chart}
                        onSelect={(colors) =>
                          updateStyle({
                            colors: { ...style.colors, chart: colors },
                          })
                        }
                      />
                      <p className="text-[10px] text-muted-foreground text-center">
                        {palette.name}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <Separator />

            {/* Spacing & Shape */}
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <Square className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Shape & Size</h3>
              </div>

              <SettingRow label="Border Radius" description={`${style.border_radius}px`}>
                <Slider
                  value={[style.border_radius]}
                  onValueChange={([v]) => updateStyle({ border_radius: v })}
                  min={0}
                  max={24}
                  step={1}
                  className="w-32"
                />
              </SettingRow>

              <SettingRow label="Bar Thickness" description={`${style.bar_thickness}px`}>
                <Slider
                  value={[style.bar_thickness]}
                  onValueChange={([v]) => updateStyle({ bar_thickness: v })}
                  min={4}
                  max={64}
                  step={2}
                  className="w-32"
                />
              </SettingRow>

              <SettingRow label="Donut Inner Radius" description={`${style.donut_inner_radius}px`}>
                <Slider
                  value={[style.donut_inner_radius]}
                  onValueChange={([v]) => updateStyle({ donut_inner_radius: v })}
                  min={20}
                  max={120}
                  step={5}
                  className="w-32"
                />
              </SettingRow>

              <SettingRow label="Chart Stroke Width" description={`${style.chart_stroke_width}px`}>
                <Slider
                  value={[style.chart_stroke_width]}
                  onValueChange={([v]) => updateStyle({ chart_stroke_width: v })}
                  min={1}
                  max={6}
                  step={0.5}
                  className="w-32"
                />
              </SettingRow>
            </section>

            <Separator />

            {/* Toggles */}
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <Grid3x3 className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Options</h3>
              </div>

              <SettingRow label="Show Gridlines" description="Display grid lines on charts">
                <Switch
                  checked={style.gridlines}
                  onCheckedChange={(checked) => updateStyle({ gridlines: checked })}
                />
              </SettingRow>

              <SettingRow label="Animations" description="Enable chart animations">
                <Switch
                  checked={style.animations}
                  onCheckedChange={(checked) => updateStyle({ animations: checked })}
                />
              </SettingRow>

              <SettingRow label="Card Shadow" description="Add shadow to cards">
                <Switch
                  checked={style.card_shadow}
                  onCheckedChange={(checked) => updateStyle({ card_shadow: checked })}
                />
              </SettingRow>
            </section>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
