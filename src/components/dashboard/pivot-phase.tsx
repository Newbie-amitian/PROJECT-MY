"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  TableProperties,
  Send,
  Download,
  Trash2,
  ChevronRight,
  Loader2,
  MessageSquare,
  LayoutGrid,
  Columns3,
  Filter,
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
import type { PivotTableConfig } from "@/lib/dashboard-types";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { sanitizeEmojis } from "@/lib/emoji-sanitizer";

function PivotTableView({ pivot, onDelete, onExport }: {
  pivot: PivotTableConfig;
  onDelete: () => void;
  onExport: (format: "csv" | "xlsx") => void;
}) {
  const { headers, rows, grandTotal } = pivot.tableData;
  const isDynamic = pivot.pivotMode === "dynamic";
  const allRows = grandTotal ? [...rows, grandTotal] : rows;
  const totalColumns = headers.length;

  // Filter metadata
  const hasFilters = pivot.filters && pivot.filters.length > 0;
  const isFiltered = hasFilters && pivot.totalRecordsBeforeFilter !== undefined
    && pivot.totalRecordsAfterFilter !== undefined
    && pivot.totalRecordsAfterFilter < pivot.totalRecordsBeforeFilter;
  const filterRatio = isFiltered && pivot.totalRecordsBeforeFilter
    ? Math.round((pivot.totalRecordsAfterFilter! / pivot.totalRecordsBeforeFilter!) * 100)
    : null;

  // Dynamic mode subtitle
  const subtitle = isDynamic
    ? `Dynamic Pivot: ${pivot.rowField} → ${pivot.measures?.map((m) => m.field).join(", ") || "all measures"}`
    : `Crosstab: ${pivot.rowField} × ${pivot.columnField} → ${pivot.aggregation}(${pivot.valueField})`;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className={cn(
              "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
              isDynamic
                ? "bg-emerald-100 dark:bg-emerald-950/30"
                : "bg-violet-100 dark:bg-violet-950/30",
            )}>
              {isDynamic
                ? <LayoutGrid className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                : <Columns3 className="w-4 h-4 text-violet-600 dark:text-violet-400" />
              }
            </div>
            <div className="min-w-0">
              <CardTitle className="text-sm truncate">{pivot.title}</CardTitle>
              <p className="text-[11px] text-muted-foreground truncate">{subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {/* Filter badge */}
            {isFiltered && (
              <Badge
                variant="outline"
                className="text-[10px] gap-1 border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400"
              >
                <Filter className="w-3 h-3" />
                {pivot.totalRecordsAfterFilter?.toLocaleString("en-IN")}
                <span className="text-muted-foreground">/ {pivot.totalRecordsBeforeFilter?.toLocaleString("en-IN")}</span>
                {filterRatio !== null && (
                  <span className="font-semibold">({filterRatio}%)</span>
                )}
              </Badge>
            )}
            <Badge variant="outline" className={cn(
              "text-[10px]",
              isDynamic
                ? "border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400"
                : "border-violet-300 text-violet-700 dark:border-violet-700 dark:text-violet-400",
            )}>
              {isDynamic ? "Dynamic" : "Cross-Tab"}
            </Badge>
            <Badge variant="outline" className="text-[10px]">{rows.length} rows</Badge>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onExport("csv")} title="Export CSV">
              <Download className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onExport("xlsx")} title="Export Excel">
              <Download className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={onDelete}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>

      {/* Filter description banner */}
      {hasFilters && pivot.filters && pivot.filters.length > 0 && (
        <div className="px-4 pb-2">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40">
            <Filter className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
              <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300 shrink-0">Filtered:</span>
              {pivot.filters.map((f, i) => (
                <React.Fragment key={i}>
                  {i > 0 && (
                    <span className="text-[10px] text-amber-500 dark:text-amber-500 font-medium">AND</span>
                  )}
                  <Badge
                    variant="secondary"
                    className="text-[10px] bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 border-0 font-mono px-1.5 py-0"
                  >
                    {f.field} {f.operator} {Array.isArray(f.value)
                      ? `(${f.value.map(String).join(", ")})`
                      : String(f.value)}
                  </Badge>
                </React.Fragment>
              ))}
              {isFiltered && (
                <span className="text-[10px] text-muted-foreground ml-1">
                  — {pivot.totalRecordsAfterFilter?.toLocaleString("en-IN")} of {pivot.totalRecordsBeforeFilter?.toLocaleString("en-IN")} records
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      <CardContent className={cn(!hasFilters && "pt-0", hasFilters && "pt-0")}>
        <div className="max-h-72 overflow-y-auto rounded-lg border">
          <TableUI>
            <TableHeader>
              <TableRow className="bg-muted/50">
                {headers.map((h, i) => (
                  <TableHead key={i} className={cn(
                    "text-xs font-medium whitespace-nowrap",
                    i === 0
                      ? "sticky left-0 bg-muted/50 z-10 min-w-[120px]"
                      : "text-right",
                  )}>
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {allRows.map((row, i) => {
                const isGrandTotalRow = grandTotal && i === allRows.length - 1;
                return (
                  <TableRow key={i} className={cn(
                    isGrandTotalRow && "bg-muted/40 font-semibold",
                  )}>
                    {row.values.map((val, j) => (
                      <TableCell key={j} className={cn(
                        "text-xs whitespace-nowrap",
                        j === 0
                          ? cn(
                              "sticky left-0 z-10 min-w-[120px]",
                              isGrandTotalRow ? "bg-muted/40 font-semibold" : "bg-background font-medium",
                            )
                          : "font-mono tabular-nums text-right",
                      )}>
                        {val === "" ? "\u00A0" : val}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </TableUI>
        </div>
      </CardContent>
    </Card>
  );
}

export function PivotPhase() {
  const {
    cleanedData, rawData, columns,
    pivotTables, addPivotTable, removePivotTable,
    setWorkflowPhase, isAnalyzing, setIsAnalyzing,
  } = useDashboardStore();

  const [query, setQuery] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);

  const workingData = cleanedData.length > 0 ? cleanedData : rawData;

  useEffect(() => {
    if (columns.length === 0 || workingData.length === 0) return;

    let cancelled = false;
    const controller = new AbortController();

    async function fetchSuggestions() {
      setIsLoadingSuggestions(true);
      try {
        const res = await fetch("/api/pivot-suggestions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            columns,
            sampleData: workingData.slice(0, 5),
          }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = await res.json();
        if (!cancelled && Array.isArray(result.suggestions)) {
          setSuggestions(result.suggestions);
        }
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) return;
        console.error("Failed to load pivot suggestions:", err);
        setSuggestions([]);
      } finally {
        if (!cancelled) setIsLoadingSuggestions(false);
      }
    }

    fetchSuggestions();
    return () => { cancelled = true; controller.abort(); };
  }, [columns, workingData]);

  const handleCreate = useCallback(async () => {
    const message = query.trim();
    if (!message || isAnalyzing) return;

    setIsAnalyzing(true);
    try {
      const res = await fetch("/api/pivot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: workingData,
          columns,
          userMessage: message,
        }),
      });

      const result = await res.json();
      if (result.error) {
        console.error("Pivot error:", result.error);
        return;
      }

      const newPivot: PivotTableConfig = {
        id: `pivot-${Date.now()}`,
        title: result.title,
        pivotMode: result.pivotMode || "dynamic",
        rowField: result.rowField,
        measures: result.measures,
        headcountField: result.headcountField,
        columnField: result.columnField,
        valueField: result.valueField,
        aggregation: result.aggregation,
        // Pre-Aggregation Filter metadata
        filters: result.filters || undefined,
        totalRecordsBeforeFilter: result.totalRecordsBeforeFilter || undefined,
        totalRecordsAfterFilter: result.totalRecordsAfterFilter || undefined,
        data: workingData,
        tableData: result.tableData,
      };

      addPivotTable(newPivot);
      setQuery("");
    } catch (err) {
      console.error("Pivot creation failed:", err);
    } finally {
      setIsAnalyzing(false);
    }
  }, [query, isAnalyzing, workingData, columns, addPivotTable, setIsAnalyzing]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleCreate();
    }
  }, [handleCreate]);

  const exportPivot = useCallback((pivot: PivotTableConfig, format: "csv" | "xlsx") => {
    const { headers, rows, grandTotal } = pivot.tableData;
    const allRows = grandTotal ? [...rows, grandTotal] : rows;

    // Add filter info row at top of export if filters were applied
    const filterRows: (string | number)[][] = [];
    if (pivot.filters && pivot.filters.length > 0) {
      const filterLabels = pivot.filters.map(
        (f) => `${f.field} ${f.operator} ${Array.isArray(f.value) ? `(${f.value.join(",")})` : f.value}`
      );
      filterRows.push([`Filtered: ${filterLabels.join(" AND ")} (${pivot.totalRecordsAfterFilter} of ${pivot.totalRecordsBeforeFilter} records)`, ""]);
    }

    const sanitizedHeaders = headers.map(h => sanitizeEmojis(h, { mode: "semantic" }).text);
    const sanitizedRows = allRows.map(row => ({
      ...row,
      values: row.values.map(v => typeof v === "string" ? sanitizeEmojis(v, { mode: "semantic" }).text : v),
    }));

    if (format === "csv") {
      const csvRow = (vals: (string | number)[]) =>
        vals.map((v) => {
          const s = String(v);
          if (s.includes(",") || s.includes('"') || s.includes("\n")) {
            return `"${s.replace(/"/g, '""')}"`;
          }
          return s;
        }).join(",");

      const csvContent = [
        ...filterRows.map(csvRow),
        csvRow(sanitizedHeaders),
        ...sanitizedRows.map((row) => csvRow(row.values)),
      ].join("\n");

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${pivot.title.replace(/\s+/g, "_")}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    } else {
      import("xlsx").then((XLSX) => {
        const wsData = [
          ...filterRows,
          sanitizedHeaders,
          ...sanitizedRows.map((r) => r.values),
        ];
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        ws["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 2, 12) }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, pivot.title.slice(0, 31));
        XLSX.writeFile(wb, `${pivot.title.replace(/\s+/g, "_")}.xlsx`);
      }).catch(console.error);
    }
  }, []);

  const handleNext = useCallback(() => setWorkflowPhase("dashboard"), [setWorkflowPhase]);
  const handleSkip = useCallback(() => setWorkflowPhase("dashboard"), [setWorkflowPhase]);

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* Query Input */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-violet-100 dark:bg-violet-950/30 flex items-center justify-center shrink-0">
              <MessageSquare className="w-4 h-4 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Create Pivot Table</h2>
              <p className="text-xs text-muted-foreground">
                Name a dimension to group by. Add filters like &quot;Rating &gt; 4.5&quot; or &quot;Salary over 50k&quot; to pre-filter data.
              </p>
            </div>
          </div>

          <div className="flex items-end gap-2">
            <Textarea
              ref={textareaRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder='e.g., "Top performers by Dept", "Salary over 50k by Location", "Rating > 4.5" ...'
              className="min-h-[60px] max-h-[100px] resize-none text-sm"
              rows={2}
            />
            <Button
              onClick={handleCreate}
              disabled={!query.trim() || isAnalyzing}
              className="shrink-0 h-[60px] px-4"
            >
              {isAnalyzing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>

          {/* Suggestion chips */}
          <div className="flex flex-wrap gap-2 mt-3">
            {isLoadingSuggestions ? (
              Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-7 w-44 rounded-full" />
              ))
            ) : suggestions.length > 0 ? (
              suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => setQuery(s)}
                  className="text-xs bg-muted hover:bg-muted/80 rounded-full px-3 py-1.5 transition-colors"
                >
                  {s}
                </button>
              ))
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Pivot Tables */}
      <AnimatePresence>
        {pivotTables.map((pivot, index) => (
          <motion.div
            key={pivot.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ delay: 0.05 * index }}
          >
            <PivotTableView
              pivot={pivot}
              onDelete={() => removePivotTable(pivot.id)}
              onExport={(fmt) => exportPivot(pivot, fmt)}
            />
          </motion.div>
        ))}
      </AnimatePresence>

      {pivotTables.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <TableProperties className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No pivot tables yet. Name a dimension above to get started.</p>
          <p className="text-xs mt-1 text-muted-foreground/70">
            Pro tip: Add conditions like &quot;Rating &gt; 4.5&quot; or &quot;Salary over 50k&quot; to filter data before pivoting.
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-2">
        <div />
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleSkip}>
            Skip to Dashboard
          </Button>
          <Button onClick={handleNext} className="gap-1">
            Next: Dashboard
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
