"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle, X, Send, Loader2, Bot, User, Wrench, BarChart3, Plus, Trash2, Sparkles, Filter, PieChart, LineChart, TrendingUp, LayoutGrid, LayoutDashboard } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { useDashboardStore } from "@/lib/dashboard-store";
import type { ChatMessage, DashboardConfig, FilterConfig, KPIConfig, ChartConfig } from "@/lib/dashboard-types";
import type { RawDataRow } from "@/lib/dashboard-types";
import { cn } from "@/lib/utils";

// ── Data Command Patterns (Section 6: Chatbot Integration) ──
const DATA_COMMANDS = [
  { pattern: /^(?:rename|change)\s+column\s+["']?(\w+)["']?\s+to\s+["']?(\w+)["']?/i, type: "rename_column" as const },
  { pattern: /^(?:convert|cast)\s+(?:column\s+)?["']?(\w+)["']?\s+to\s+(integer|float|string|date|text)/i, type: "convert_type" as const },
  { pattern: /^(?:fix|set|update)\s+(?:all\s+)?["']?(\w+)["']?\s+(?:values?\s+)?(?:below|less than|<)\s+([\d.]+)/i, type: "fix_threshold" as const },
  { pattern: /^(?:drop|remove|delete)\s+(?:rows?\s+)?where\s+["']?(\w+)["']?\s+(?:is\s+)?(?:null|NULL|empty|missing)/i, type: "drop_null_rows" as const },
  { pattern: /^(?:mark|set)\s+(?:missing\s+)?["']?(\w+)["']?\s+(?:values?\s+)?(?:as\s+)?["']?(\w+)["']?/i, type: "mark_values" as const },
];

function parseDataCommand(message: string): { type: string; args: string[] } | null {
  for (const cmd of DATA_COMMANDS) {
    const match = message.match(cmd.pattern);
    if (match) return { type: cmd.type, args: match.slice(1) };
  }
  return null;
}

// ── Chart type icons map ──
const CHART_TYPE_OPTIONS = [
  { type: "bar", label: "Bar Chart", icon: BarChart3 },
  { type: "line", label: "Line Chart", icon: LineChart },
  { type: "pie", label: "Pie Chart", icon: PieChart },
  { type: "donut", label: "Donut Chart", icon: PieChart },
  { type: "area", label: "Area Chart", icon: TrendingUp },
  { type: "scatter", label: "Scatter Plot", icon: TrendingUp },
] as const;

// ── Config Diff Helper ──
function computeConfigDiff(oldConfig: DashboardConfig, newKpis: KPIConfig[], newCharts: ChartConfig[], newFilters: FilterConfig[], newLayout: DashboardConfig["layout"]): string {
  const parts: string[] = [];

  // KPI diff
  const oldKpiIds = new Set(oldConfig.kpis.map(k => k.id));
  const newKpiIds = new Set(newKpis.map(k => k.id));
  const addedKpis = newKpis.filter(k => !oldKpiIds.has(k.id)).length;
  const removedKpis = oldConfig.kpis.filter(k => !newKpiIds.has(k.id)).length;
  const modifiedKpis = newKpis.filter(nk => {
    const ok = oldConfig.kpis.find(ok => ok.id === nk.id);
    if (!ok) return false;
    return ok.column !== nk.column || ok.aggregation !== nk.aggregation || ok.title !== nk.title;
  }).length;

  if (addedKpis > 0) parts.push(`added ${addedKpis} KPI${addedKpis > 1 ? "s" : ""}`);
  if (removedKpis > 0) parts.push(`removed ${removedKpis} KPI${removedKpis > 1 ? "s" : ""}`);
  if (modifiedKpis > 0) parts.push(`modified ${modifiedKpis} KPI${modifiedKpis > 1 ? "s" : ""}`);

  // Chart diff
  const oldChartIds = new Set(oldConfig.charts.map(c => c.id));
  const newChartIds = new Set(newCharts.map(c => c.id));
  const addedCharts = newCharts.filter(c => !oldChartIds.has(c.id)).length;
  const removedCharts = oldConfig.charts.filter(c => !newChartIds.has(c.id)).length;
  const modifiedCharts = newCharts.filter(nc => {
    const oc = oldConfig.charts.find(oc => oc.id === nc.id);
    if (!oc) return false;
    return oc.type !== nc.type || oc.x !== nc.x || JSON.stringify(oc.y) !== JSON.stringify(nc.y) || oc.title !== nc.title;
  }).length;

  if (addedCharts > 0) parts.push(`added ${addedCharts} chart${addedCharts > 1 ? "s" : ""}`);
  if (removedCharts > 0) parts.push(`removed ${removedCharts} chart${removedCharts > 1 ? "s" : ""}`);
  if (modifiedCharts > 0) parts.push(`modified ${modifiedCharts} chart${modifiedCharts > 1 ? "s" : ""}`);

  // Filter diff
  const oldFilterCols = new Set(oldConfig.filters.map(f => f.column));
  const newFilterCols = new Set(newFilters.map(f => f.column));
  const addedFilters = newFilters.filter(f => !oldFilterCols.has(f.column)).length;
  const removedFilters = oldConfig.filters.filter(f => !newFilterCols.has(f.column)).length;

  if (addedFilters > 0) parts.push(`added ${addedFilters} filter${addedFilters > 1 ? "s" : ""}`);
  if (removedFilters > 0) parts.push(`removed ${removedFilters} filter${removedFilters > 1 ? "s" : ""}`);

  // Layout change
  if (oldConfig.layout !== newLayout) {
    parts.push(`switched layout to ${newLayout}`);
  }

  if (parts.length === 0) return "No changes detected in the dashboard configuration.";

  return `Updated dashboard: ${parts.join(", ")}.`;
}

export function AIChat() {
  const {
    chatMessages,
    addChatMessage,
    isChatOpen,
    setIsChatOpen,
    isAnalyzing,
    setIsAnalyzing,
    rawData,
    columns,
    config,
    setConfig,
    cleanedData,
    setCleanedData,
    workflowPhase,
    addTransformationLog,
    setAiCellValue,
    userEditLayer,
    setLayout,
  } = useDashboardStore();

  const [input, setInput] = useState("");
  const [pendingCommand, setPendingCommand] = useState<{ type: string; args: string[]; message: string } | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Smart Column Suggestions (context-aware) ──
  const { bestCategorical, bestNumeric, firstFilterable } = useMemo(() => {
    const categoricalCols = columns.filter(c => c.type === "string" && c.uniqueCount > 1 && c.uniqueCount < 50);
    const numericCols = columns.filter(c => c.type === "number");
    const filterableCols = columns.filter(c => (c.type === "string" && c.uniqueCount >= 2 && c.uniqueCount <= 30) || c.type === "date");

    return {
      bestCategorical: categoricalCols[0] ?? null,
      bestNumeric: numericCols[0] ?? null,
      firstFilterable: filterableCols[0] ?? null,
    };
  }, [columns]);

  // ── Dynamic suggestion chips ──
  const dashboardSuggestions = useMemo(() => {
    if (!config) return [];
    const suggestions: string[] = [];

    if (bestCategorical && bestNumeric) {
      suggestions.push(`Add a bar chart for ${bestCategorical.name} by ${bestNumeric.name}`);
    }

    if (config.kpis.length > 0) {
      const lastKpi = config.kpis[config.kpis.length - 1];
      suggestions.push(`Remove the "${lastKpi.title}" KPI`);
    }

    if (config.layout === "analytical") {
      suggestions.push("Switch layout to exclusive");
    } else {
      suggestions.push("Switch layout to analytical");
    }

    if (firstFilterable) {
      const existingFilterCols = new Set(config.filters.map(f => f.column));
      if (!existingFilterCols.has(firstFilterable.name)) {
        suggestions.push(`Add a filter for ${firstFilterable.name}`);
      }
    }

    suggestions.push("Show me summary of this data");

    return suggestions;
  }, [config, bestCategorical, bestNumeric, firstFilterable]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  // ── Execute Data Commands ──
  const executeDataCommand = useCallback((cmd: { type: string; args: string[] }, userMessage: string) => {
    const data = cleanedData.length > 0 ? cleanedData : rawData;
    if (data.length === 0) return;
    const headers = Object.keys(data[0]);

    let modifiedData: RawDataRow[] | null = null;
    let description = "";
    const logEntries: Array<{ column: string; originalValue: unknown; cleanedValue: unknown; rule: string; confidence: number; status: "applied" | "flagged"; severity: "clean" | "warning" | "high_risk" | "blocked" }> = [];
    // Track per-cell edits for 3-layer state engine
    const cellEdits: Array<{ cellKey: string; aiValue: unknown; originalValue: unknown }> = [];

    switch (cmd.type) {
      case "rename_column": {
        const oldName = cmd.args[0];
        const newName = cmd.args[1];
        if (!headers.includes(oldName)) {
          const msg: ChatMessage = { id: `msg-${Date.now()}-err`, role: "assistant", content: `Column "${oldName}" not found. Available: ${headers.join(", ")}`, timestamp: Date.now() };
          addChatMessage(msg);
          return;
        }
        modifiedData = data.map(row => {
          const newRow = { ...row };
          newRow[newName] = newRow[oldName];
          delete newRow[oldName];
          return newRow;
        });
        description = `Renamed column "${oldName}" to "${newName}"`;
        break;
      }
      case "convert_type": {
        const col = cmd.args[0];
        const targetType = cmd.args[1];
        if (!headers.includes(col)) {
          const msg: ChatMessage = { id: `msg-${Date.now()}-err`, role: "assistant", content: `Column "${col}" not found.`, timestamp: Date.now() };
          addChatMessage(msg);
          return;
        }
        modifiedData = data.map((row, rowIdx) => {
          const newRow = { ...row };
          const val = row[col];
          if (val == null) { newRow[col] = null; return newRow; }
          const str = String(val).trim();
          let converted: unknown = null;
          if (targetType === "integer" || targetType === "float") {
            const num = Number(str.replace(/,/g, ""));
            converted = !isNaN(num) ? (targetType === "integer" ? Math.round(num) : num) : null;
          } else if (targetType === "string" || targetType === "text") {
            converted = str;
          } else if (targetType === "date") {
            const d = new Date(str);
            converted = !isNaN(d.getTime()) ? d.toISOString().split("T")[0] : null;
          }
          if (converted !== row[col] && converted !== null) {
            cellEdits.push({ cellKey: `${rowIdx}-${col}`, aiValue: converted, originalValue: val });
          }
          newRow[col] = converted;
          return newRow;
        });
        description = `Converted column "${col}" to ${targetType}`;
        break;
      }
      case "fix_threshold": {
        const col = cmd.args[0];
        const threshold = parseFloat(cmd.args[1]);
        if (!headers.includes(col) || isNaN(threshold)) break;
        modifiedData = data.map(row => {
          const newRow = { ...row };
          const val = Number(row[col]);
          if (!isNaN(val) && val < threshold) {
            logEntries.push({ column: col, originalValue: row[col], cleanedValue: threshold, rule: `fix_below_${threshold}`, confidence: 0.90, status: "applied", severity: "warning" });
            newRow[col] = threshold;
          }
          return newRow;
        });
        const fixCount = logEntries.length;
        description = `Fixed ${fixCount} values in "${col}" below ${threshold} to ${threshold}`;
        break;
      }
      case "drop_null_rows": {
        const col = cmd.args[0];
        if (!headers.includes(col)) break;
        modifiedData = data.filter(row => row[col] != null && row[col] !== "");
        const dropped = data.length - modifiedData.length;
        description = `Dropped ${dropped} rows where "${col}" is null`;
        break;
      }
      case "mark_values": {
        const col = cmd.args[0];
        const markValue = cmd.args[1];
        if (!headers.includes(col)) {
          const msg: ChatMessage = { id: `msg-${Date.now()}-err`, role: "assistant", content: `Column "${col}" not found.`, timestamp: Date.now() };
          addChatMessage(msg);
          return;
        }
        modifiedData = data.map(row => {
          const newRow = { ...row };
          if (row[col] == null || String(row[col]).trim() === "") {
            logEntries.push({ column: col, originalValue: row[col], cleanedValue: markValue, rule: "mark_missing", confidence: 0.70, status: "applied", severity: "warning" });
            newRow[col] = markValue;
          }
          return newRow;
        });
        const markCount = logEntries.length;
        description = `Marked ${markCount} missing values in "${col}" as "${markValue}"`;
        break;
      }
      default:
        return;
    }

    if (modifiedData) {
      setCleanedData(modifiedData);
      // Log transformations and populate 3-layer cell edits
      logEntries.forEach(entry => {
        addTransformationLog({
          id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: Date.now(),
          column: entry.column,
          originalValue: entry.originalValue,
          cleanedValue: entry.cleanedValue,
          rule: entry.rule,
          confidence: entry.confidence,
          status: entry.status,
          severity: entry.severity,
        });
      });
      // Populate 3-layer state engine for Chatbot ↔ Excel sync
      cellEdits.forEach(({ cellKey, aiValue, originalValue }) => {
        // Check if USER has already edited this cell — if so, log conflict
        const existing = userEditLayer[cellKey];
        if (existing && existing.source === "USER") {
          // Log conflict but do NOT overwrite — USER wins
          addTransformationLog({
            id: `log-conflict-${Date.now()}-${cellKey}`,
            timestamp: Date.now(),
            column: cellKey.split("-").slice(1).join("-"),
            originalValue: aiValue,
            cleanedValue: existing.userValue,
            rule: "conflict_resolved",
            confidence: 0.0,
            status: "skipped",
            severity: "warning",
          });
        } else {
          setAiCellValue(cellKey, aiValue);
        }
      });
      const successMsg: ChatMessage = {
        id: `msg-${Date.now()}-cmd`,
        role: "assistant",
        content: `Applied: ${description}\n\nRows affected: ${modifiedData.length} (from ${data.length})${cellEdits.length > 0 ? ` | ${cellEdits.length} cells tracked` : ""}`,
        timestamp: Date.now(),
      };
      addChatMessage(successMsg);
    }
  }, [cleanedData, rawData, columns, setCleanedData, addChatMessage, addTransformationLog, setAiCellValue, userEditLayer]);

  // ── Clear All Charts Handler ──
  const handleClearAllCharts = useCallback(() => {
    if (!config) return;
    setConfig({ ...config, charts: [] });
    setClearConfirmOpen(false);
    const msg: ChatMessage = {
      id: `msg-${Date.now()}-clear`,
      role: "assistant",
      content: `Cleared all ${config.charts.length} charts from the dashboard.`,
      timestamp: Date.now(),
    };
    addChatMessage(msg);
  }, [config, setConfig, addChatMessage]);

  // ── Toggle Layout Handler ──
  const handleToggleLayout = useCallback(() => {
    if (!config) return;
    const newLayout = config.layout === "analytical" ? "exclusive" : "analytical";
    setLayout(newLayout);
    const msg: ChatMessage = {
      id: `msg-${Date.now()}-layout`,
      role: "assistant",
      content: `Switched dashboard layout to ${newLayout}.`,
      timestamp: Date.now(),
    };
    addChatMessage(msg);
  }, [config, setLayout, addChatMessage]);

  // ── Quick Add Chart Handler ──
  const handleQuickAddChart = useCallback((chartType: string) => {
    if (!config || !bestCategorical || !bestNumeric) {
      setInput(`Add a ${chartType} chart`);
      return;
    }
    setInput(`Add a ${chartType} chart for ${bestCategorical.name} by ${bestNumeric.name}`);
  }, [config, bestCategorical, bestNumeric, setInput]);

  // ── Quick Add KPI Handler ──
  const handleQuickAddKPI = useCallback(() => {
    if (bestNumeric) {
      setInput(`Add a KPI for ${bestNumeric.name}`);
    } else {
      setInput("Which metric do you want to track as a KPI?");
    }
  }, [bestNumeric, setInput]);

  const handleSend = useCallback(async () => {
    const message = input.trim();
    if (!message || isAnalyzing) return;
    if (!rawData.length || !columns.length) {
      const errorMsg: ChatMessage = {
        id: `msg-${Date.now()}-error`,
        role: "assistant",
        content: "Please upload data first before using the AI assistant.",
        timestamp: Date.now(),
      };
      addChatMessage(errorMsg);
      return;
    }

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: message,
      timestamp: Date.now(),
    };

    addChatMessage(userMsg);
    setInput("");

    // ── Check for data commands (cleaning phase) ──
    const dataCmd = parseDataCommand(message);
    if (dataCmd && (workflowPhase === "cleaning" || workflowPhase === "pivot" || workflowPhase === "dashboard")) {
      // For risky operations (drop rows), ask confirmation first
      const isRisky = dataCmd.type === "drop_null_rows";
      if (isRisky) {
        setPendingCommand({ ...dataCmd, message });
        const confirmMsg: ChatMessage = {
          id: `msg-${Date.now()}-confirm`,
          role: "assistant",
          content: `This is a risky operation. It will modify your dataset.\n\nType "confirm" to proceed, or "cancel" to abort.`,
          timestamp: Date.now(),
        };
        addChatMessage(confirmMsg);
        return;
      }
      executeDataCommand(dataCmd, message);
      return;
    }

    // Check for confirmation/cancellation of pending risky command
    if (pendingCommand) {
      if (/^(?:yes|confirm|proceed|do it)$/i.test(message)) {
        executeDataCommand(pendingCommand, pendingCommand.message);
        setPendingCommand(null);
        return;
      }
      if (/^(?:no|cancel|abort|stop)$/i.test(message)) {
        const cancelMsg: ChatMessage = {
          id: `msg-${Date.now()}-cancel`,
          role: "assistant",
          content: "Operation cancelled.",
          timestamp: Date.now(),
        };
        addChatMessage(cancelMsg);
        setPendingCommand(null);
        return;
      }
    }

    setIsAnalyzing(true);

    try {
      // Send all necessary data to the API for real AI analysis
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: rawData.slice(0, 500), // Limit data to prevent payload too large
          columns: columns,
          userMessage: message,
          currentConfig: {
            kpis: config.kpis,
            charts: config.charts,
            filters: config.filters,
            selected_layout: config.layout,
          },
        }),
      });

      if (!res.ok) {
        throw new Error(`API error: ${res.status}`);
      }

      let result: Record<string, unknown>;
      try {
        result = await res.json();
      } catch {
        throw new Error("Invalid response from server");
      }

      const aiMessage = result.ai_message ?? "I've processed your request.";

      // Apply AI changes to the dashboard config and compute diff
      const newKpis = (result.kpis && Array.isArray(result.kpis) && result.kpis.length > 0)
        ? result.kpis as KPIConfig[]
        : config.kpis;
      const newCharts = (result.charts && Array.isArray(result.charts) && result.charts.length > 0)
        ? result.charts as ChartConfig[]
        : config.charts;
      const newFilters = (result.filters && result.filters.length > 0)
        ? (result.filters as FilterConfig[]).map((f) => ({
            ...f,
            selectedValues: [],
          }))
        : config.filters;
      const newLayout = result.selected_layout ?? config.layout;

      const hasConfigChanges = config
        && (JSON.stringify(newKpis) !== JSON.stringify(config.kpis) ||
            JSON.stringify(newCharts) !== JSON.stringify(config.charts) ||
            JSON.stringify(newFilters.map(f => ({ column: f.column, type: f.type }))) !== JSON.stringify(config.filters.map(f => ({ column: f.column, type: f.type }))) ||
            newLayout !== config.layout);

      // Build the confirmation message with config diff
      let finalAssistantContent = aiMessage;
      if (hasConfigChanges) {
        const diffSummary = computeConfigDiff(config, newKpis, newCharts, newFilters, newLayout as DashboardConfig["layout"]);
        finalAssistantContent = `${aiMessage}\n\n✅ ${diffSummary}`;
      }

      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now()}-resp`,
        role: "assistant",
        content: finalAssistantContent,
        timestamp: Date.now(),
      };

      addChatMessage(assistantMsg);

      // Apply the new config
      if (config) {
        setConfig({
          ...config,
          kpis: newKpis,
          charts: newCharts,
          filters: newFilters,
          layout: newLayout as DashboardConfig["layout"],
        });
      }
    } catch {
      const errorMsg: ChatMessage = {
        id: `msg-${Date.now()}-error`,
        role: "assistant",
        content:
          "Sorry, I encountered an error processing your request. Please try again.",
        timestamp: Date.now(),
      };
      addChatMessage(errorMsg);
    } finally {
      setIsAnalyzing(false);
    }
  }, [input, isAnalyzing, addChatMessage, setIsAnalyzing, rawData, columns, config, setConfig, cleanedData, setCleanedData, workflowPhase, addTransformationLog, executeDataCommand, pendingCommand]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const isDashboardReady = !!config && workflowPhase === "dashboard";

  return (
    <>
      {/* Floating Action Button */}
      <motion.div
        className="fixed bottom-5 right-5 z-50 no-print"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        <Button
          onClick={() => setIsChatOpen(!isChatOpen)}
          size="icon"
          className={cn(
            "w-12 h-12 rounded-full shadow-lg transition-all",
            isChatOpen
              ? "bg-muted-foreground hover:bg-muted-foreground/90"
              : "bg-[#f0c040] hover:bg-[#e5b030] text-[#2b2b2b]"
          )}
        >
          <AnimatePresence mode="wait">
            {isChatOpen ? (
              <motion.div
                key="close"
                initial={{ rotate: -90, opacity: 0 }}
                animate={{ rotate: 0, opacity: 1 }}
                exit={{ rotate: 90, opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <X className="w-5 h-5" />
              </motion.div>
            ) : (
              <motion.div
                key="open"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <MessageCircle className="w-5 h-5" />
              </motion.div>
            )}
          </AnimatePresence>
        </Button>
      </motion.div>

      {/* Chat Panel */}
      <AnimatePresence>
        {isChatOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="fixed bottom-20 right-5 z-50 w-[400px] max-w-[calc(100vw-40px)] bg-card border rounded-2xl shadow-2xl overflow-hidden no-print"
          >
            {/* Header */}
            <div className="px-4 py-3 border-b bg-gradient-to-r from-[#2b2b2b] to-[#3a3a3a]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-[#f0c040]/20 flex items-center justify-center">
                    <Bot className="w-4 h-4 text-[#f0c040]" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">AI Assistant</h3>
                    <p className="text-[10px] text-[#999]">Smart Excel + AI Data Engineer + ETL Dashboard</p>
                  </div>
                </div>
                {isDashboardReady && (
                  <Badge variant="secondary" className="bg-[#f0c040]/15 text-[#f0c040] border-[#f0c040]/30 text-[10px]">
                    <Sparkles className="w-3 h-3 mr-1" />
                    Dashboard Mode
                  </Badge>
                )}
              </div>
            </div>

            {/* Messages */}
            <div
              ref={scrollRef}
              className="h-[340px] overflow-y-auto px-4 py-3 space-y-3"
            >
              {chatMessages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground gap-2">
                  <Bot className="w-10 h-10 opacity-30" />
                  <p className="text-sm font-medium">Ask me to modify your dashboard</p>
                  <p className="text-xs text-muted-foreground/60">
                    Changes are applied automatically
                  </p>
                  <div className="space-y-1.5 mt-2 w-full">
                    {/* Context-aware dashboard suggestions */}
                    {dashboardSuggestions.length > 0 ? (
                      <>
                        <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider text-left px-1">Quick suggestions</p>
                        {dashboardSuggestions.map((suggestion) => (
                          <button
                            key={suggestion}
                            onClick={() => setInput(suggestion)}
                            className="block w-full text-xs bg-muted hover:bg-muted/80 rounded-lg px-3 py-2 transition-colors text-left text-foreground/80"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </>
                    ) : columns.length > 0 ? [
                      `Rename column ${columns[0]?.name || "Col"} to NewName`,
                      `Convert ${columns[0]?.name || "Col"} to integer`,
                      `Drop rows where ${columns[0]?.name || "Col"} is null`,
                    ].map((suggestion) => (
                      <button
                        key={suggestion}
                        onClick={() => setInput(suggestion)}
                        className="block w-full text-xs bg-muted hover:bg-muted/80 rounded-lg px-3 py-2 transition-colors text-left"
                      >
                        <Wrench className="w-3 h-3 inline mr-1.5 text-[#f0c040]" />
                        {suggestion}
                      </button>
                    )) : []}
                  </div>
                </div>
              )}

              {chatMessages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "flex gap-2.5",
                    msg.role === "user" ? "flex-row-reverse" : "flex-row"
                  )}
                >
                  <div
                    className={cn(
                      "w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                      msg.role === "user"
                        ? "bg-[#f0c040]/20"
                        : "bg-muted"
                    )}
                  >
                    {msg.role === "user" ? (
                      <User className="w-3.5 h-3.5 text-[#f0c040]" />
                    ) : (
                      <Bot className="w-3.5 h-3.5 text-muted-foreground" />
                    )}
                  </div>
                  <div
                    className={cn(
                      "max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                      msg.role === "user"
                        ? "bg-[#f0c040] text-[#2b2b2b] rounded-tr-md font-medium"
                        : "bg-muted rounded-tl-md"
                    )}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    <p
                      className={cn(
                        "text-[10px] mt-1",
                        msg.role === "user"
                          ? "text-[#2b2b2b]/50"
                          : "text-muted-foreground"
                      )}
                    >
                      {formatTime(msg.timestamp)}
                    </p>
                  </div>
                </motion.div>
              ))}

              {isAnalyzing && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex gap-2.5"
                >
                  <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <Bot className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                  <div className="bg-muted rounded-2xl rounded-tl-md px-4 py-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Updating dashboard...
                    </div>
                  </div>
                </motion.div>
              )}
            </div>

            {/* Quick Action Buttons (dashboard mode only) */}
            {isDashboardReady && (
              <div className="px-3 py-1.5 border-t bg-muted/30">
                <div className="flex items-center gap-1 overflow-x-auto">
                  {/* Add Chart */}
                  <DropdownMenu>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs gap-1.5 shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted"
                          >
                            <BarChart3 className="w-3.5 h-3.5 text-[#f0c040]" />
                            Add Chart
                          </Button>
                        </DropdownMenuTrigger>
                      </TooltipTrigger>
                      <TooltipContent side="top">Add a new chart</TooltipContent>
                    </Tooltip>
                    <DropdownMenuContent side="top" align="start" className="w-44">
                      <DropdownMenuLabel className="text-xs">Chart Type</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {CHART_TYPE_OPTIONS.map(({ type, label, icon: Icon }) => (
                        <DropdownMenuItem
                          key={type}
                          onClick={() => handleQuickAddChart(type)}
                          className="text-xs cursor-pointer"
                        >
                          <Icon className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                          {label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* Add KPI */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleQuickAddKPI}
                        className="h-7 px-2 text-xs gap-1.5 shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted"
                      >
                        <Plus className="w-3.5 h-3.5 text-emerald-500" />
                        Add KPI
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Add a new KPI</TooltipContent>
                  </Tooltip>

                  {/* Clear All Charts */}
                  <AlertDialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!config || config.charts.length === 0}
                            className="h-7 px-2 text-xs gap-1.5 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-40"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Clear Charts
                          </Button>
                        </AlertDialogTrigger>
                      </TooltipTrigger>
                      <TooltipContent side="top">Remove all charts</TooltipContent>
                    </Tooltip>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Clear all charts?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will remove all {config?.charts.length ?? 0} charts from your dashboard. KPIs and filters will be preserved. This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleClearAllCharts}
                          className="bg-destructive text-white hover:bg-destructive/90"
                        >
                          Clear All Charts
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>

                  {/* Change Layout */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleToggleLayout}
                        className="h-7 px-2 text-xs gap-1.5 shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted"
                      >
                        {config?.layout === "analytical" ? (
                          <LayoutDashboard className="w-3.5 h-3.5 text-violet-500" />
                        ) : (
                          <LayoutGrid className="w-3.5 h-3.5 text-violet-500" />
                        )}
                        <span className="hidden sm:inline">Layout</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      Switch to {config?.layout === "analytical" ? "exclusive" : "analytical"} layout
                    </TooltipContent>
                  </Tooltip>

                  {/* Add Filter */}
                  {firstFilterable && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setInput(`Add a filter for ${firstFilterable.name}`)}
                          className="h-7 px-2 text-xs gap-1.5 shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted"
                        >
                          <Filter className="w-3.5 h-3.5 text-sky-500" />
                          <span className="hidden sm:inline">Filter</span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Add filter for {firstFilterable.name}</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>
            )}

            {/* Input */}
            <div className="border-t px-3 py-3">
              <div className="flex items-end gap-2">
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={isDashboardReady ? "Ask to modify your dashboard..." : "Ask me anything about your data..."}
                  className="min-h-[36px] max-h-[100px] resize-none text-sm rounded-xl border-muted-foreground/20 focus-visible:ring-[#f0c040]/30 focus-visible:border-[#f0c040]"
                  rows={1}
                />
                <Button
                  size="icon"
                  onClick={handleSend}
                  disabled={!input.trim() || isAnalyzing}
                  className="w-9 h-9 rounded-xl shrink-0 bg-[#f0c040] hover:bg-[#e5b030] text-[#2b2b2b]"
                >
                  {isAnalyzing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
