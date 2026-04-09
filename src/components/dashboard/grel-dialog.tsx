"use client";

import React, { useState, useCallback, useMemo } from "react";
import {
  Code2,
  Play,
  Check,
  X,
  ChevronDown,
  FunctionSquare,
  HelpCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  validateGREL,
  grelTransform,
  GREL_REFERENCE,
  type GRELFuncRef,
} from "@/lib/grel-engine";
import type { RawDataRow } from "@/lib/dashboard-types";

// ── Category icon map ──
const CATEGORY_ICONS: Record<string, string> = {
  String: "🔤",
  Number: "#️⃣",
  Control: "🔀",
  Check: "✅",
  "Cross-cell": "🔗",
  Operator: "⚙️",
};

interface GRELDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: RawDataRow[];
  columns: string[];
  onApply: (columnName: string, expression: string, transformedData: RawDataRow[]) => void;
}

export function GRELDialog({
  open,
  onOpenChange,
  data,
  columns,
  onApply,
}: GRELDialogProps) {
  const [selectedColumn, setSelectedColumn] = useState<string>("");
  const [expression, setExpression] = useState<string>("");
  const [previewResults, setPreviewResults] = useState<
    { original: unknown; transformed: unknown; error?: string }[] | null
  >(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState<string | null>(null);
  const [previewCount, setPreviewCount] = useState(0);

  // Group functions by category
  const groupedRef = useMemo(() => {
    const groups: Record<string, GRELFuncRef[]> = {};
    for (const ref of GREL_REFERENCE) {
      if (!groups[ref.category]) groups[ref.category] = [];
      groups[ref.category].push(ref);
    }
    return groups;
  }, []);

  // Live validation
  const validationErrorLive = useMemo(() => {
    if (!expression.trim()) return null;
    return validateGREL(expression);
  }, [expression]);

  const handlePreview = useCallback(() => {
    if (!selectedColumn || !expression.trim()) return;
    const err = validateGREL(expression);
    if (err) {
      setValidationError(err);
      setPreviewResults(null);
      return;
    }
    setValidationError(null);
    const result = grelTransform(expression, data, selectedColumn, 8);
    const preview = result.results.slice(0, 8).map((r) => ({
      original: r.originalValue,
      transformed: r.transformedValue,
      error: r.error,
    }));
    setPreviewResults(preview);
    setPreviewCount(result.results.length);
  }, [selectedColumn, expression, data]);

  const handleApply = useCallback(() => {
    if (!selectedColumn || !expression.trim()) return;
    const err = validateGREL(expression);
    if (err) {
      setValidationError(err);
      return;
    }
    const result = grelTransform(expression, data, selectedColumn);
    onApply(selectedColumn, expression, result.transformedData);
    setExpression("");
    setPreviewResults(null);
    setValidationError(null);
    setSelectedColumn("");
    onOpenChange(false);
  }, [selectedColumn, expression, data, onApply, onOpenChange]);

  const insertFunction = useCallback((syntax: string) => {
    const textarea = document.getElementById("grel-expression") as HTMLTextAreaElement | null;
    if (textarea) {
      const start = textarea.selectionStart ?? expression.length;
      const before = expression.slice(0, start);
      const after = expression.slice(textarea.selectionEnd ?? start);
      const newExpr = before + syntax + after;
      setExpression(newExpr);
      // Restore focus
      setTimeout(() => {
        textarea.focus();
        const newPos = start + syntax.length;
        textarea.setSelectionRange(newPos, newPos);
      }, 10);
    } else {
      setExpression((prev) => prev + syntax);
    }
  }, [expression]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-0">
        {/* Header */}
        <DialogHeader className="p-5 pb-3 border-b">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-violet-100 dark:bg-violet-950/30 flex items-center justify-center">
              <Code2 className="w-5 h-5 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <DialogTitle className="text-base">GREL Transform</DialogTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Google Refine Expression Language — apply custom transforms to any column
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="p-5 pt-3 space-y-4">
          {/* Column Selector */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Target Column
            </label>
            <Select value={selectedColumn} onValueChange={setSelectedColumn}>
              <SelectTrigger className="h-9 text-xs font-mono">
                <SelectValue placeholder="Select a column..." />
              </SelectTrigger>
              <SelectContent>
                {columns.map((col) => (
                  <SelectItem key={col} value={col} className="text-xs font-mono">
                    {col}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Expression Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Expression
              </label>
              <div className="flex items-center gap-1.5">
                {validationErrorLive === null && expression.trim() && (
                  <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                    <Check className="w-3 h-3" /> valid
                  </span>
                )}
                {validationErrorLive && (
                  <span className="flex items-center gap-1 text-[10px] text-rose-600 dark:text-rose-400 max-w-[200px] truncate" title={validationErrorLive}>
                    <X className="w-3 h-3 shrink-0" /> {validationErrorLive}
                  </span>
                )}
              </div>
            </div>
            <textarea
              id="grel-expression"
              value={expression}
              onChange={(e) => {
                setExpression(e.target.value);
                setValidationError(null);
              }}
              placeholder='e.g. value.trim().toUppercase()  or  value + " years"  or  if(isBlank(value), "N/A", value)'
              className={cn(
                "w-full h-24 px-4 py-3 rounded-lg border text-sm font-mono resize-none outline-none transition-colors",
                "bg-[#1e1e2e] text-zinc-100 border-zinc-700 placeholder:text-zinc-500",
                "focus:border-violet-500 focus:ring-1 focus:ring-violet-500/50",
                validationError && "border-rose-500 focus:border-rose-500 focus:ring-rose-500/50",
              )}
              spellCheck={false}
            />
          </div>

          {/* Validation error */}
          {validationError && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-start gap-2 p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800"
            >
              <X className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <p className="text-xs text-rose-700 dark:text-rose-400">{validationError}</p>
            </motion.div>
          )}

          {/* Preview */}
          <AnimatePresence>
            {previewResults && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Preview
                    </span>
                    <Badge variant="outline" className="text-[9px] font-mono">
                      {previewCount} rows
                    </Badge>
                  </div>
                  <div className="rounded-lg border overflow-hidden">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="bg-muted/50">
                          <th className="text-left px-3 py-1.5 font-medium text-muted-foreground w-8">#</th>
                          <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Original</th>
                          <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Transformed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewResults.map((row, i) => (
                          <tr key={i} className="border-t border-border/50">
                            <td className="px-3 py-1.5 text-muted-foreground font-mono">{i + 1}</td>
                            <td className="px-3 py-1.5 font-mono text-rose-600 dark:text-rose-400 max-w-[180px] truncate" title={String(row.original)}>
                              {row.original == null ? "null" : String(row.original)}
                            </td>
                            <td className={cn("px-3 py-1.5 font-mono max-w-[180px] truncate", row.error ? "text-rose-500" : "text-emerald-600 dark:text-emerald-400")} title={String(row.transformed)}>
                              {row.error ? `❌ ${row.error}` : row.transformed == null ? "null" : String(row.transformed)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePreview}
              disabled={!selectedColumn || !expression.trim()}
              className="gap-1.5 text-xs"
            >
              <Play className="w-3.5 h-3.5" />
              Preview
            </Button>
            <Button
              size="sm"
              onClick={handleApply}
              disabled={!selectedColumn || !expression.trim() || !!validationErrorLive}
              className="gap-1.5 text-xs bg-violet-600 hover:bg-violet-700 text-white"
            >
              <Check className="w-3.5 h-3.5" />
              Apply Transform
            </Button>
          </div>

          {/* Function Reference Help Panel */}
          <div className="border rounded-lg overflow-hidden">
            <button
              onClick={() => setHelpOpen(helpOpen === "__root__" ? null : "__root__")}
              className="w-full flex items-center gap-2 px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
            >
              <HelpCircle className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Function Reference
              </span>
              <span className="text-[10px] text-muted-foreground">
                ({GREL_REFERENCE.length} functions)
              </span>
              <ChevronDown
                className={cn(
                  "w-3 h-3 text-muted-foreground ml-auto transition-transform",
                  helpOpen === "__root__" ? "rotate-0" : "-rotate-90"
                )}
              />
            </button>
            <AnimatePresence>
              {helpOpen === "__root__" && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="max-h-64 overflow-y-auto">
                    {Object.entries(groupedRef).map(([category, refs]) => (
                      <div key={category}>
                        <button
                          onClick={() => setHelpOpen(helpOpen === category ? "__root__" : category)}
                          className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-muted/30 transition-colors text-left"
                        >
                          <span className="text-xs">{CATEGORY_ICONS[category] || "📦"}</span>
                          <span className="text-[11px] font-semibold">{category}</span>
                          <Badge variant="outline" className="text-[9px] ml-1">{refs.length}</Badge>
                          <ChevronDown
                            className={cn(
                              "w-3 h-3 text-muted-foreground ml-auto transition-transform",
                              helpOpen === category ? "rotate-0" : "-rotate-90"
                            )}
                          />
                        </button>
                        <AnimatePresence>
                          {helpOpen === category && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.15 }}
                              className="overflow-hidden"
                            >
                              <div className="pb-1 px-1">
                                {refs.map((ref, idx) => (
                                  <button
                                    key={`${category}-${idx}`}
                                    onClick={() => insertFunction(ref.syntax)}
                                    className="w-full flex items-start gap-2 px-2 py-1 rounded hover:bg-violet-50 dark:hover:bg-violet-950/20 transition-colors text-left group"
                                    title={`Click to insert: ${ref.syntax}`}
                                  >
                                    <FunctionSquare className="w-3 h-3 text-violet-400 shrink-0 mt-0.5" />
                                    <div className="flex-1 min-w-0">
                                      <code className="text-[10px] font-mono text-violet-700 dark:text-violet-300 group-hover:text-violet-600">
                                        {ref.syntax}
                                      </code>
                                      <p className="text-[9px] text-muted-foreground truncate">
                                        {ref.description}
                                      </p>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
