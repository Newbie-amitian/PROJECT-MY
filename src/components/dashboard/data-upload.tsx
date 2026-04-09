"use client";

import React, { useCallback, useRef, useState } from "react";
import {
  Upload,
  FileSpreadsheet,
  Trash2,
  Sparkles,
  Table,
  ClipboardPaste,
  ChevronRight,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table as TableUI,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDashboardStore } from "@/lib/dashboard-store";
import { parseCSV, parseExcel, detectColumnTypes } from "@/lib/data-utils";
import type { RawDataRow } from "@/lib/dashboard-types";
import { cn } from "@/lib/utils";

// ---- Sample Data ----
function generateSampleData(): RawDataRow[] {
  const regions = ["North", "South", "East", "West", "Central"];
  const categories = ["Electronics", "Furniture", "Office Supplies", "Technology", "Accessories"];
  const products: Record<string, string[]> = {
    Electronics: ["Laptop", "Phone", "Tablet", "Monitor", "Headphones"],
    Furniture: ["Desk", "Chair", "Bookshelf", "Filing Cabinet", "Lamp"],
    "Office Supplies": ["Paper", "Pens", "Stapler", "Binder", "Notebook"],
    Technology: ["Router", "SSD Drive", "Webcam", "Keyboard", "Mouse"],
    Accessories: ["Bag", "Phone Case", "Screen Protector", "Charger", "Cable"],
  };

  const rows: RawDataRow[] = [];
  const baseDate = new Date("2024-01-01");

  for (let i = 0; i < 100; i++) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + Math.floor(i * 3.65));
    const region = regions[Math.floor(Math.random() * regions.length)];
    const category = categories[Math.floor(Math.random() * categories.length)];
    const prodList = products[category];
    const product = prodList[Math.floor(Math.random() * prodList.length)];
    const quantity = Math.floor(Math.random() * 50) + 1;
    const sales = Math.round((quantity * (Math.random() * 200 + 20)) * 100) / 100;
    const profit = Math.round((sales * (Math.random() * 0.3 + 0.05)) * 100) / 100;
    const discount = Math.random() > 0.6 ? Math.round(Math.random() * 30) / 100 : 0;

    rows.push({
      Date: date.toISOString().split("T")[0],
      Region: region,
      Category: category,
      Product: product,
      Sales: sales,
      Profit: profit,
      Quantity: quantity,
      Discount: discount,
    });
  }

  return rows;
}

export function DataUpload() {
  const { rawData, columns, setRawData, setColumns, resetDashboard, isAnalyzing, setIsAnalyzing, setConfig, addChatMessage } =
    useDashboardStore();
  const [isDragOver, setIsDragOver] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      // Excel path
      if (/\.xlsx?$/i.test(file.name)) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const buffer = e.target?.result as ArrayBuffer;
          const rows = parseExcel(buffer);
          if (rows.length > 0) {
            const cols = detectColumnTypes(rows);
            setRawData(rows);
            setColumns(cols);
          }
        };
        reader.readAsArrayBuffer(file);
        return;
      }

      // CSV path
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        const rows = parseCSV(text);
        if (rows.length > 0) {
          const cols = detectColumnTypes(rows);
          setRawData(rows);
          setColumns(cols);
        }
      };
      reader.readAsText(file);
    },
    [setRawData, setColumns]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file && (file.name.endsWith(".csv") || file.type === "text/csv" || /\.xlsx?$/i.test(file.name))) {
        handleFile(file);
      }
    },
    [handleFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleBrowse = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handlePasteSubmit = useCallback(() => {
    if (!pasteText.trim()) return;
    const rows = parseCSV(pasteText);
    if (rows.length > 0) {
      const cols = detectColumnTypes(rows);
      setRawData(rows);
      setColumns(cols);
      setPasteMode(false);
      setPasteText("");
    }
  }, [pasteText, setRawData, setColumns]);

  const handleSampleData = useCallback(() => {
    const rows = generateSampleData();
    const cols = detectColumnTypes(rows);
    setRawData(rows);
    setColumns(cols);
  }, [setRawData, setColumns]);

  const handleAnalyze = useCallback(async () => {
    if (rawData.length === 0) return;
    setIsAnalyzing(true);
    try {
      const cols = columns.length > 0 ? columns : detectColumnTypes(rawData);
      if (columns.length === 0) setColumns(cols);

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: rawData, columns: cols }),
      });
      const result = await res.json();
      if (result.kpis || result.charts) {
        const { cleanData, analyzeData, autoGenerateDashboard } = await import("@/lib/data-utils");
        const { data, report } = cleanData(rawData);
        const transformation = analyzeData(data, cols);
        const autoConfig = autoGenerateDashboard(data, cols, report, transformation);

        // Merge AI suggestions with auto-generated config
        const dashboardConfig = {
          ...autoConfig,
          title: result.title || autoConfig.title,
          layout: result.selected_layout || autoConfig.layout,
          kpis: (result.kpis && result.kpis.length > 0 ? result.kpis : autoConfig.kpis).map((k: Record<string, unknown>, i: number) => ({
            ...k,
            id: k.id || `kpi-${i}`,
          })),
          charts: (result.charts && result.charts.length > 0 ? result.charts : autoConfig.charts).map((c: Record<string, unknown>, i: number) => ({
            ...c,
            id: c.id || `chart-${i}`,
          })),
          filters: (result.filters && result.filters.length > 0 ? result.filters : autoConfig.filters).map((f: Record<string, unknown>, i: number) => ({
            ...f,
            id: f.id || `filter-${i}`,
          })),
          interactions: autoConfig.interactions,
          style: autoConfig.style,
        };

        setConfig(dashboardConfig);
        addChatMessage({
          id: `msg-ai-${Date.now()}`,
          role: "assistant",
          content: result.ai_message || "Dashboard generated successfully. You can ask me to modify any chart or layout!",
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      console.error("Analysis failed:", err);
      // Fallback: auto-generate
      const { cleanData, analyzeData, autoGenerateDashboard } = await import("@/lib/data-utils");
      const cols = columns.length > 0 ? columns : detectColumnTypes(rawData);
      const { data, report } = cleanData(rawData);
      const transformation = analyzeData(data, cols);
      const config = autoGenerateDashboard(data, cols, report, transformation);
      setConfig(config);
    } finally {
      setIsAnalyzing(false);
    }
  }, [rawData, columns, setConfig, setIsAnalyzing, setColumns]);

  const handleReset = useCallback(() => {
    resetDashboard();
    setPasteMode(false);
    setPasteText("");
  }, [resetDashboard]);

  const previewRows = rawData.slice(0, 10);
  const headers = rawData.length > 0 ? Object.keys(rawData[0]) : [];

  return (
    <div className="w-full max-w-4xl mx-auto">
      <AnimatePresence mode="wait">
        {rawData.length === 0 ? (
          <motion.div
            key="upload"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
          >
            <Card className="border-2 border-dashed border-muted-foreground/20 bg-card/50 hover:border-muted-foreground/40 transition-colors">
              <CardContent className="p-8">
                <div className="flex flex-col items-center gap-6">
                  {/* Upload Icon */}
                  <motion.div
                    className="w-16 h-16 rounded-2xl bg-orange-100 dark:bg-orange-950/30 flex items-center justify-center"
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <Upload className="w-8 h-8 text-orange-600 dark:text-orange-400" />
                  </motion.div>

                  <div className="text-center space-y-2">
                    <h2 className="text-xl font-semibold">Upload Your Data</h2>
                    <p className="text-muted-foreground text-sm max-w-md">
                      Drag and drop a CSV or Excel file, paste tabular data, or try with sample data to get started.
                    </p>
                  </div>

                  {/* Drop Zone */}
                  <div
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onClick={handleBrowse}
                    className={cn(
                      "w-full max-w-lg p-8 rounded-xl border-2 border-dashed cursor-pointer transition-all duration-200",
                      "hover:border-orange-400 hover:bg-orange-50/50 dark:hover:bg-orange-950/10",
                      isDragOver
                        ? "border-orange-500 bg-orange-50 dark:bg-orange-950/20 scale-[1.02]"
                        : "border-muted-foreground/25"
                    )}
                  >
                    <div className="flex flex-col items-center gap-3">
                      <FileSpreadsheet
                        className={cn(
                          "w-10 h-10 transition-colors",
                          isDragOver
                            ? "text-orange-500"
                            : "text-muted-foreground/50"
                        )}
                      />
                      <div className="text-center">
                        <p className="text-sm font-medium">
                          {isDragOver ? "Drop your file here" : "Click to browse or drag a CSV / Excel file"}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          CSV or Excel (.xlsx, .xls) files up to 10MB
                        </p>
                      </div>
                    </div>
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={handleFileInput}
                    className="hidden"
                  />

                  {/* Divider */}
                  <div className="flex items-center gap-3 w-full max-w-lg">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-xs text-muted-foreground">or</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <Button
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPasteMode(true);
                      }}
                    >
                      <ClipboardPaste className="w-4 h-4 mr-2" />
                      Paste Data
                    </Button>
                    <Button
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSampleData();
                      }}
                    >
                      <Sparkles className="w-4 h-4 mr-2" />
                      Try Sample Data
                    </Button>
                  </div>

                  {/* Paste Area */}
                  <AnimatePresence>
                    {pasteMode && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="w-full max-w-lg"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="space-y-3">
                          <Textarea
                            value={pasteText}
                            onChange={(e) => setPasteText(e.target.value)}
                            placeholder="Paste your tabular data here (CSV format with headers)..."
                            className="min-h-[150px] font-mono text-xs"
                          />
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setPasteMode(false);
                                setPasteText("");
                              }}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              onClick={handlePasteSubmit}
                              disabled={!pasteText.trim()}
                            >
                              <Table className="w-4 h-4 mr-1" />
                              Parse Data
                            </Button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ) : (
          <motion.div
            key="preview"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
            className="space-y-4"
          >
            {/* Data Summary */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950/30 flex items-center justify-center">
                      <FileSpreadsheet className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div>
                      <CardTitle className="text-base">Data Preview</CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Showing first {previewRows.length} of {rawData.length} rows
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="font-mono">
                      {rawData.length} rows
                    </Badge>
                    <Badge variant="secondary" className="font-mono">
                      {headers.length} cols
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="max-h-96 overflow-y-auto rounded-lg border">
                  <TableUI>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="w-12 text-xs font-medium text-muted-foreground">
                          #
                        </TableHead>
                        {headers.map((h) => (
                          <TableHead
                            key={h}
                            className="text-xs font-medium text-muted-foreground"
                          >
                            {h}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewRows.map((row, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-xs text-muted-foreground font-mono">
                            {i + 1}
                          </TableCell>
                          {headers.map((h) => (
                            <TableCell key={h} className="text-xs font-mono max-w-[150px] truncate">
                              {row[h] == null ? (
                                <span className="text-muted-foreground/50 italic">null</span>
                              ) : (
                                String(row[h])
                              )}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </TableUI>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between mt-4">
                  <Button variant="ghost" size="sm" onClick={handleReset}>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Reset Data
                  </Button>
                  <Button
                    onClick={handleAnalyze}
                    disabled={isAnalyzing}
                    className="min-w-[160px]"
                  >
                    {isAnalyzing ? (
                      <>
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                          className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full"
                        />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        Analyze Data
                        <ChevronRight className="w-4 h-4 ml-1" />
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
