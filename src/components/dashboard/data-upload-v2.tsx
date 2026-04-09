"use client";

import React, { useCallback, useRef, useState } from "react";
import {
  Upload,
  FileSpreadsheet,
  Database,
  Sparkles,
  ClipboardPaste,
  FileText,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Trash2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table as TableUI,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDashboardStore } from "@/lib/dashboard-store";
import { parseCSVRaw, parseCSV, parseExcel, detectColumnTypes, type ColClass } from "@/lib/data-utils";
import { SQLQueryPanel } from "./sql-query-panel";
import type { RawDataRow } from "@/lib/dashboard-types";
import { cn } from "@/lib/utils";

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

export function DataUploadV2() {
  const {
    rawData, columns, userInstructions,
    setRawData, setColumns, setUserInstructions,
    setWorkflowPhase, resetDashboard,
  } = useDashboardStore();

  const [isDragOver, setIsDragOver] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [isSmartParsing, setIsSmartParsing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasData = rawData.length > 0;
  const hasInstructions = userInstructions.trim().length > 0;
  const canProceed = hasData && !isSmartParsing;

  // AI-powered smart merge: when embedded commas detected,
  // classify columns via AI before merging
  const smartParseWithAI = useCallback(async (text: string) => {
    const { headers, rawRows, hasEmbeddedCommas } = parseCSVRaw(text);
    if (!hasEmbeddedCommas || headers.length === 0) {
      // No commas — standard fast path (zero AI overhead)
      return parseCSV(text);
    }

    setIsSmartParsing(true);
    try {
      // Call AI to classify columns for smart merge
      const sampleRows = rawRows.slice(0, 5);
      const res = await fetch("/api/classify-columns-merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ headers, sampleRows }),
      });

      if (!res.ok) {
        console.warn("[smartParse] AI classification failed, falling back to regex");
        return parseCSV(text);
      }

      const data = await res.json();
      const aiClasses: ColClass[] = data.results.map(
        (r: { mergeClass: string }) => r.mergeClass as ColClass
      );

      if (aiClasses.length !== headers.length) {
        console.warn("[smartParse] AI returned wrong number of classes, falling back");
        return parseCSV(text);
      }

      return parseCSV(text, aiClasses);
    } catch (err) {
      console.warn("[smartParse] Error, falling back to regex:", err);
      return parseCSV(text);
    } finally {
      setIsSmartParsing(false);
    }
  }, []);

  const isExcelFile = (name: string) => /\.xlsx?$/i.test(name);

  const handleFile = useCallback(async (file: File) => {
    // Excel path — read as ArrayBuffer, use XLSX parser
    if (isExcelFile(file.name)) {
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

    // CSV path — read as text, use smart AI-assisted merge
    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target?.result as string;
      const rows = await smartParseWithAI(text);
      if (rows.length > 0) {
        const cols = detectColumnTypes(rows);
        setRawData(rows);
        setColumns(cols);
      }
    };
    reader.readAsText(file);
  }, [setRawData, setColumns, smartParseWithAI]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith(".csv") || file.type === "text/csv" || isExcelFile(file.name))) {
      handleFile(file);
    }
  }, [handleFile]);

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

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handlePasteSubmit = useCallback(async () => {
    if (!pasteText.trim()) return;
    const rows = await smartParseWithAI(pasteText);
    if (rows.length > 0) {
      const cols = detectColumnTypes(rows);
      setRawData(rows);
      setColumns(cols);
      setPasteMode(false);
      setPasteText("");
    }
  }, [pasteText, setRawData, setColumns, smartParseWithAI]);

  const handleSampleData = useCallback(() => {
    const rows = generateSampleData();
    const cols = detectColumnTypes(rows);
    setRawData(rows);
    setColumns(cols);
  }, [setRawData, setColumns]);

  const handleProceed = useCallback(() => {
    if (canProceed) {
      setWorkflowPhase("cleaning");
    }
  }, [canProceed, setWorkflowPhase]);

  const handleReset = useCallback(() => {
    resetDashboard();
    setPasteMode(false);
    setPasteText("");
  }, [resetDashboard]);

  const previewRows = rawData.slice(0, 5);
  const headers = rawData.length > 0 ? Object.keys(rawData[0]) : [];

  return (
    <div className="w-full max-w-5xl mx-auto">
      {/* Title */}
      <motion.div
        className="text-center mb-8"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-2">
          <span className="text-[#f0c040]">AI</span> Data Dashboard
        </h1>
        <p className="text-muted-foreground text-sm sm:text-base max-w-lg mx-auto">
          Upload your dataset and optionally provide instructions, then let AI guide you through cleaning, pivot tables, and dashboard creation.
        </p>
      </motion.div>

      <Tabs defaultValue="dataset" className="w-full">
        <TabsList className="grid w-full grid-cols-2 mb-4">
          <TabsTrigger value="dataset" className="gap-2">
            <Database className="w-4 h-4" />
            Upload Your Dataset
          </TabsTrigger>
          <TabsTrigger value="info" className="gap-2">
            <FileText className="w-4 h-4" />
            Upload Your Info
            {hasInstructions && (
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
            )}
          </TabsTrigger>
        </TabsList>

        {/* Dataset Tab */}
        <TabsContent value="dataset">
          <Card className="border-2 border-dashed border-muted-foreground/20 bg-card/50 hover:border-muted-foreground/40 transition-colors">
            <CardContent className="p-6">
              <AnimatePresence mode="wait">
                {!hasData ? (
                  <motion.div
                    key="upload"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="flex flex-col items-center gap-5"
                  >
                    <motion.div
                      className="w-14 h-14 rounded-2xl bg-orange-100 dark:bg-orange-950/30 flex items-center justify-center"
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      <Upload className="w-7 h-7 text-orange-600 dark:text-orange-400" />
                    </motion.div>

                    <div className="text-center space-y-1">
                      <h2 className="text-lg font-semibold">Upload Your Dataset</h2>
                      <p className="text-muted-foreground text-sm">
                        Drag and drop a CSV or Excel file, paste data, or try with sample data.
                      </p>
                    </div>

                    <div
                      onDrop={handleDrop}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onClick={handleBrowse}
                      className={cn(
                        "w-full max-w-lg p-6 rounded-xl border-2 border-dashed cursor-pointer transition-all duration-200",
                        "hover:border-orange-400 hover:bg-orange-50/50 dark:hover:bg-orange-950/10",
                        isDragOver
                          ? "border-orange-500 bg-orange-50 dark:bg-orange-950/20 scale-[1.02]"
                          : "border-muted-foreground/25"
                      )}
                    >
                      <div className="flex flex-col items-center gap-2.5">
                        <FileSpreadsheet
                          className={cn(
                            "w-8 h-8 transition-colors",
                            isDragOver ? "text-orange-500" : "text-muted-foreground/50"
                          )}
                        />
                        <p className="text-sm font-medium">
                          {isDragOver ? "Drop your file here" : "Click to browse or drag a CSV / Excel file"}
                        </p>
                        <p className="text-xs text-muted-foreground">CSV or Excel (.xlsx, .xls) files up to 10MB</p>
                      </div>
                    </div>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      onChange={handleFileInput}
                      className="hidden"
                    />

                    <div className="flex items-center gap-3 w-full max-w-lg">
                      <div className="flex-1 h-px bg-border" />
                      <span className="text-xs text-muted-foreground">or</span>
                      <div className="flex-1 h-px bg-border" />
                    </div>

                    <div className="flex flex-wrap items-center justify-center gap-3">
                      <Button
                        variant="outline"
                        onClick={(e) => { e.stopPropagation(); setPasteMode(true); }}
                      >
                        <ClipboardPaste className="w-4 h-4 mr-2" />
                        Paste Data
                      </Button>
                      <Button
                        variant="outline"
                        onClick={(e) => { e.stopPropagation(); handleSampleData(); }}
                      >
                        <Sparkles className="w-4 h-4 mr-2" />
                        Try Sample Data
                      </Button>
                    </div>

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
                              className="min-h-[120px] font-mono text-xs"
                            />
                            <div className="flex justify-end gap-2">
                              <Button variant="ghost" size="sm" onClick={() => { setPasteMode(false); setPasteText(""); }}>
                                Cancel
                              </Button>
                              <Button size="sm" onClick={handlePasteSubmit} disabled={!pasteText.trim() || isSmartParsing}>
                                {isSmartParsing ? (
                                  <><Sparkles className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Smart Parsing...</>
                                ) : (
                                  "Parse Data"
                                )}
                              </Button>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                ) : (
                  <motion.div
                    key="preview"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-4"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950/30 flex items-center justify-center">
                          <FileSpreadsheet className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div>
                          <CardTitle className="text-base">Data Loaded</CardTitle>
                          <p className="text-xs text-muted-foreground">
                            {rawData.length} rows &times; {headers.length} columns
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="font-mono">{rawData.length} rows</Badge>
                        <Badge variant="secondary" className="font-mono">{headers.length} cols</Badge>
                      </div>
                    </div>

                    <div className="max-h-48 overflow-y-auto rounded-lg border">
                      <TableUI>
                        <TableHeader>
                          <TableRow className="bg-muted/50">
                            <TableHead className="w-12 text-xs">#</TableHead>
                            {headers.map((h) => (
                              <TableHead key={h} className="text-xs">{h}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {previewRows.map((row, i) => (
                            <TableRow key={i}>
                              <TableCell className="text-xs text-muted-foreground font-mono">{i + 1}</TableCell>
                              {headers.map((h) => (
                                <TableCell key={h} className="text-xs font-mono max-w-[120px] truncate">
                                  {row[h] == null ? <span className="text-muted-foreground/50 italic">null</span> : String(row[h])}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </TableUI>
                    </div>

                    <div className="flex items-center justify-between">
                      <Button variant="ghost" size="sm" onClick={handleReset}>
                        <Trash2 className="w-4 h-4 mr-2" />
                        Clear Data
                      </Button>
                    </div>

                    {/* SQL Query Engine - appears after data is loaded */}
                    <div className="mt-5">
                      <SQLQueryPanel />
                    </div>

                    {/* Proceed button below SQL panel */}
                    <div className="flex items-center justify-end mt-5">
                      <Button onClick={handleProceed} className="min-w-[180px]">
                        Proceed to Analysis
                        <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Info Tab */}
        <TabsContent value="info">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-950/30 flex items-center justify-center shrink-0 mt-0.5">
                  <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">Upload Your Info</h2>
                  <p className="text-sm text-muted-foreground">
                    Paste or type instructions about your data. This helps the AI understand your goals, context, and what kind of analysis you need.
                  </p>
                </div>
              </div>

              <Textarea
                value={userInstructions}
                onChange={(e) => setUserInstructions(e.target.value)}
                placeholder={`For example:\n"This is sales data for Q1 2024. I want to understand regional performance, product category trends, and identify top-performing products. Focus on profit margins and discount impact."\n\nOr paste a document excerpt that describes your data and analysis needs...`}
                className="min-h-[200px] text-sm leading-relaxed"
              />

              <div className="flex items-center justify-between mt-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {hasInstructions ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      <span className="text-emerald-600">Instructions saved</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>Optional - AI will work without this</span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {hasInstructions && (
                    <Button variant="ghost" size="sm" onClick={() => setUserInstructions("")}>
                      Clear
                    </Button>
                  )}
                  {hasData && (
                    <Button onClick={handleProceed} size="sm">
                      Start Analysis
                      <ChevronRight className="w-3 h-3 ml-1" />
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Proceed bar when data is loaded */}
      {hasData && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-6 flex items-center justify-center"
        >
          <Button
            onClick={handleProceed}
            size="lg"
            className="min-w-[200px] gap-2 text-base"
          >
            Start Analysis
            <ChevronRight className="w-5 h-5" />
          </Button>
        </motion.div>
      )}
    </div>
  );
}
