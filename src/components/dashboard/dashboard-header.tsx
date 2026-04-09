"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Palette, Database, Pencil, Check, FileDown, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useDashboardStore } from "@/lib/dashboard-store";
import { FilterBar } from "./filter-panel";
import { ExportDialog } from "./export-dialog";
import { cn } from "@/lib/utils";

export function DashboardHeader() {
  const { config, setConfig, filteredData, columns, setIsStylePanelOpen } =
    useDashboardStore();
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(config?.title ?? "Dashboard");
  const inputRef = useRef<HTMLInputElement>(null);

  const title = config?.title ?? "Dashboard";
  const rowCount = filteredData.length;
  const colCount = columns.length;

  const startEditing = useCallback(() => {
    setEditTitle(config?.title ?? "Dashboard");
    setIsEditing(true);
  }, [config?.title]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleTitleSave = useCallback(() => {
    if (config && editTitle.trim()) {
      setConfig({ ...config, title: editTitle.trim() });
    }
    setIsEditing(false);
  }, [config, editTitle, setConfig]);

  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleTitleSave();
      if (e.key === "Escape") {
        setEditTitle(title);
        setIsEditing(false);
      }
    },
    [handleTitleSave, title]
  );

  const [isExportOpen, setIsExportOpen] = useState(false);

  const handleExport = useCallback(() => {
    setIsExportOpen(true);
  }, []);

  const style = config?.style;

  return (
    <>
      {/* Power BI-style Ribbon */}
      <header className="sticky top-0 z-40 w-full">
        {/* Title bar */}
        <div className="bg-[#2b2b2b] border-b border-[#1a1a1a]">
          <div className="flex items-center justify-between h-12 px-4 lg:px-6 gap-4">
            {/* Left: Title */}
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {isEditing ? (
                <div className="flex items-center gap-2">
                  <Input
                    ref={inputRef}
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={handleTitleSave}
                    onKeyDown={handleTitleKeyDown}
                    className="h-7 w-64 text-sm font-bold bg-[#3a3a3a] border-[#555] text-white focus-visible:ring-[#f0c040]/30 focus-visible:border-[#f0c040]"
                    style={{ fontFamily: style?.font_family }}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-[#999] hover:text-[#f0c040]"
                    onClick={handleTitleSave}
                  >
                    <Check className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <button
                  onClick={startEditing}
                  className="group flex items-center gap-2 min-w-0 hover:bg-[#3a3a3a] rounded-md px-2 py-1 -ml-2 transition-colors"
                >
                  <h1
                    className="text-sm font-semibold text-white truncate"
                    style={{ fontFamily: style?.font_family }}
                  >
                    {title}
                  </h1>
                  <Pencil className="w-3 h-3 text-[#666] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </button>
              )}

              {/* Data Summary */}
              {config && rowCount > 0 && (
                <div className="hidden sm:flex items-center gap-1.5 text-xs text-[#999] bg-[#3a3a3a] rounded-full px-2.5 py-1">
                  <Database className="w-3 h-3" />
                  <span className="font-medium text-white">{rowCount.toLocaleString()}</span>
                  <span className="hidden md:inline">rows</span>
                  <span className="text-[#555] mx-0.5">&times;</span>
                  <span className="font-medium text-white">{colCount}</span>
                  <span className="hidden md:inline">cols</span>
                </div>
              )}
            </div>

            {/* Right: Actions */}
            {config && (
              <div className="flex items-center gap-1.5 shrink-0">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-[#999] hover:text-white hover:bg-[#3a3a3a]"
                      onClick={() => setIsStylePanelOpen(true)}
                    >
                      <Palette className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Style Settings</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-[#999] hover:text-white hover:bg-[#3a3a3a]"
                      onClick={handleExport}
                    >
                      <FileDown className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Export PDF / PBIX</TooltipContent>
                </Tooltip>
              </div>
            )}
          </div>
        </div>

        {/* Filter ribbon bar */}
        {config && (
          <div className="bg-[#323232] border-b border-[#1a1a1a]">
            <div className="flex items-center gap-3 h-10 px-4 lg:px-6 overflow-hidden">
              <Filter className="w-3.5 h-3.5 text-[#999] shrink-0" />
              <FilterBar />
            </div>
          </div>
        )}
      </header>

      {/* Print-specific CSS */}
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #dashboard-canvas,
          #dashboard-canvas * {
            visibility: visible;
          }
          #dashboard-canvas {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            padding: 20px;
          }
          .no-print {
            display: none !important;
          }
          @page {
            margin: 1cm;
            size: landscape;
          }
        }
      `}</style>

      {/* Export Dialog */}
      <ExportDialog open={isExportOpen} onOpenChange={setIsExportOpen} />
    </>
  );
}
