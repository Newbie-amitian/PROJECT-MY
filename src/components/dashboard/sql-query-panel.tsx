"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Terminal,
  Send,
  Loader2,
  Copy,
  Check,
  Clock,
  Database,
  ChevronDown,
  ChevronUp,
  Trash2,
  AlertCircle,
  Sparkles,
  Play,
  Wrench,
  Zap,
  TrendingUp,
  BarChart3,
  Filter,
  Shield,
  Lightbulb,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { cn } from "@/lib/utils";

interface QueryResult {
  id: string;
  query: string;
  sql: string;
  columns: string[];
  rows: (string | number | null)[][];
  rowCount: number;
  executionTimeMs: number;
  aiMessage: string;
  error?: string;
  repaired?: boolean;
  timestamp: number;
}

interface SmartSuggestion {
  title: string;
  intent: string;
  sql: string;
  why_this_query_is_useful: string;
}

const INTENT_ICONS: Record<string, typeof TrendingUp> = {
  aggregation: TrendingUp,
  group_by: BarChart3,
  ranking: BarChart3,
  distribution: Filter,
  data_quality: Shield,
  outlier: AlertCircle,
};

const INTENT_COLORS: Record<string, string> = {
  aggregation: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
  group_by: "bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400 border-blue-200 dark:border-blue-800",
  ranking: "bg-violet-100 text-violet-700 dark:bg-violet-950/30 dark:text-violet-400 border-violet-200 dark:border-violet-800",
  distribution: "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 border-amber-200 dark:border-amber-800",
  data_quality: "bg-rose-100 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400 border-rose-200 dark:border-rose-800",
  outlier: "bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400 border-orange-200 dark:border-orange-800",
};

export function SQLQueryPanel() {
  const { rawData, columns, userInstructions } = useDashboardStore();
  const [query, setQuery] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [results, setResults] = useState<QueryResult[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [smartSuggestions, setSmartSuggestions] = useState<SmartSuggestion[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const dataKeyRef = useRef<string>("");
  const suggestionsLoadedRef = useRef(false);

  // Fetch smart suggestions when data changes
  useEffect(() => {
    const newKey = columns.map((c) => c.name).join(",");
    if (newKey !== dataKeyRef.current && rawData.length > 0) {
      dataKeyRef.current = newKey;
      suggestionsLoadedRef.current = false;
      setSmartSuggestions([]);
      setSuggestionsError(false);
    }
  }, [columns, rawData.length]);

  useEffect(() => {
    if (!suggestionsLoadedRef.current && rawData.length > 0 && columns.length > 0 && smartSuggestions.length === 0 && !isLoadingSuggestions && !suggestionsError) {
      fetchSmartSuggestions();
    }
  }, [rawData.length, columns.length, smartSuggestions.length, isLoadingSuggestions, suggestionsError]);

  const fetchSmartSuggestions = useCallback(async () => {
    if (rawData.length === 0 || columns.length === 0) return;
    setIsLoadingSuggestions(true);
    setSuggestionsError(false);

    try {
      const res = await fetch("/api/sql-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: rawData.slice(0, 200),
          columns,
          userInstructions: userInstructions || undefined,
        }),
      });

      if (!res.ok) throw new Error("Failed to fetch suggestions");
      const data = await res.json();

      if (Array.isArray(data.suggestions) && data.suggestions.length > 0) {
        setSmartSuggestions(data.suggestions);
        suggestionsLoadedRef.current = true;
      } else {
        setSuggestionsError(true);
      }
    } catch {
      setSuggestionsError(true);
    } finally {
      setIsLoadingSuggestions(false);
    }
  }, [rawData, columns, userInstructions]);

  const runQuery = useCallback(async (queryText?: string) => {
    const q = (queryText || query).trim();
    if (!q || isRunning || rawData.length === 0) return;

    setIsRunning(true);
    const startTime = Date.now();

    try {
      const fetchWithRetry = async (attempt: number): Promise<Response> => {
        const res = await fetch("/api/sql-query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            data: rawData.slice(0, 2000),
            columns,
            naturalLanguageQuery: q,
            userInstructions: userInstructions || undefined,
          }),
        });
        if ((res.status === 502 || res.status === 504) && attempt < 2) {
          console.log(`[sql-query] Gateway timeout (${res.status}), retrying... attempt ${attempt + 1}`);
          await new Promise((r) => setTimeout(r, 2000));
          return fetchWithRetry(attempt + 1);
        }
        return res;
      };

      const res = await fetchWithRetry(0);

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }

      let data: Record<string, unknown>;
      try {
        data = await res.json();
      } catch {
        throw new Error("Invalid response from server");
      }
      const result: QueryResult = {
        id: `q-${Date.now()}`,
        query: q,
        sql: data.sql || "",
        columns: data.columns || [],
        rows: data.rows || [],
        rowCount: data.rowCount || 0,
        executionTimeMs: data.executionTimeMs || (Date.now() - startTime),
        aiMessage: data.aiMessage || "",
        error: data.error,
        repaired: !!data.repaired,
        timestamp: Date.now(),
      };

      setResults((prev) => [result, ...prev]);
      setExpandedId(result.id);
      setQuery("");
    } catch {
      setResults((prev) => [
        {
          id: `q-${Date.now()}`,
          query: q,
          sql: "",
          columns: [],
          rows: [],
          rowCount: 0,
          executionTimeMs: Date.now() - startTime,
          aiMessage: "",
          error: "Network error. Please try again.",
          timestamp: Date.now(),
        },
        ...prev,
      ]);
    } finally {
      setIsRunning(false);
    }
  }, [query, isRunning, rawData, columns, userInstructions]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        runQuery();
      }
    },
    [runQuery]
  );

  const handleCopy = useCallback((text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const handleClearAll = useCallback(() => {
    setResults([]);
    setExpandedId(null);
  }, []);

  const handleSuggestionClick = useCallback((s: SmartSuggestion) => {
    setQuery(s.title);
    runQuery(s.title);
  }, [runQuery]);

  // Scroll to latest result
  useEffect(() => {
    if (expandedId && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [expandedId]);

  const hasSuggestions = smartSuggestions.length > 0;

  return (
    <Card className="overflow-hidden border-2 border-slate-200 dark:border-slate-700">
      {/* Terminal-style header */}
      <div className="bg-[#1e1e2e] px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Terminal className="w-4 h-4 text-[#f0c040]" />
          <span className="text-sm font-medium text-white">SQL Query Engine</span>
          <Badge variant="outline" className="text-[10px] border-[#555] text-[#999] bg-transparent">
            {rawData.length} rows
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {results.length > 0 && (
            <Badge variant="outline" className="text-[10px] border-[#555] text-[#999] bg-transparent">
              {results.length} queries
            </Badge>
          )}
          {results.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-[#999] hover:text-white hover:bg-[#3a3a4a]"
              onClick={handleClearAll}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          )}
        </div>
      </div>

      <CardContent className="p-0">
        {/* Query Input */}
        <div className="p-4 border-b bg-slate-50 dark:bg-slate-900/50">
          <div className="flex items-end gap-2">
            <div className="flex-1 relative">
              <Textarea
                ref={textareaRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything about your data... (Ctrl+Enter to run)"
                className="min-h-[52px] max-h-[80px] resize-none text-sm font-mono bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 focus-visible:ring-[#f0c040]/30 focus-visible:border-[#f0c040]"
                rows={2}
              />
              <span className="absolute bottom-2 right-12 text-[10px] text-muted-foreground pointer-events-none">
                Ctrl+Enter
              </span>
            </div>
            <Button
              onClick={() => runQuery()}
              disabled={!query.trim() || isRunning || rawData.length === 0}
              className="shrink-0 h-[52px] px-5 gap-2 bg-[#f0c040] hover:bg-[#e5b030] text-[#2b2b2b] font-medium"
            >
              {isRunning ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              Run
            </Button>
          </div>
        </div>

        {/* Smart AI Suggestions */}
        {(isLoadingSuggestions || hasSuggestions || suggestionsError) && (
          <div className="px-4 py-3 border-b bg-gradient-to-r from-amber-50/50 to-transparent dark:from-amber-950/10">
            <div className="flex items-center gap-2 mb-2.5">
              <Zap className="w-3.5 h-3.5 text-[#f0c040]" />
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                AI-Powered Suggestions
              </span>
              {hasSuggestions && (
                <Badge variant="secondary" className="text-[9px] h-4">
                  {smartSuggestions.length}
                </Badge>
              )}
              {suggestionsError && !isLoadingSuggestions && (
                <button
                  onClick={fetchSmartSuggestions}
                  className="text-[10px] text-rose-500 hover:text-rose-600 ml-1"
                >
                  Retry
                </button>
              )}
            </div>

            {isLoadingSuggestions && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Analyzing your dataset...</span>
              </div>
            )}

            {!isLoadingSuggestions && hasSuggestions && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[200px] overflow-y-auto">
                {smartSuggestions.map((s, i) => {
                  const Icon = INTENT_ICONS[s.intent] || Lightbulb;
                  const colorClass = INTENT_COLORS[s.intent] || INTENT_COLORS.aggregation;
                  return (
                    <button
                      key={i}
                      onClick={() => handleSuggestionClick(s)}
                      className="group text-left p-2.5 rounded-lg border bg-card hover:bg-muted/50 hover:border-muted-foreground/30 transition-all duration-150"
                    >
                      <div className="flex items-start gap-2">
                        <div className={cn("mt-0.5 shrink-0 w-5 h-5 rounded flex items-center justify-center", colorClass)}>
                          <Icon className="w-3 h-3" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-medium leading-snug group-hover:text-foreground text-foreground/80">
                            {s.title}
                          </p>
                          <p className="text-[9px] text-muted-foreground mt-0.5 line-clamp-1">
                            {s.why_this_query_is_useful}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Results */}
        <div ref={resultsRef} className="max-h-[500px] overflow-y-auto">
          {results.length === 0 && !isLoadingSuggestions && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <Database className="w-10 h-10 opacity-20" />
              <p className="text-sm">Run a query to see results here</p>
              <p className="text-[11px] opacity-60">
                Type a question or click a suggestion above
              </p>
            </div>
          )}

          <AnimatePresence initial={false}>
            {results.map((result) => {
              const isExpanded = expandedId === result.id;
              const hasRows = result.rows.length > 0;
              const isError = !!result.error;

              return (
                <motion.div
                  key={result.id}
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className="border-b last:border-b-0"
                >
                  {/* Query row */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : result.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left"
                  >
                    <div className="flex items-center gap-2 shrink-0">
                      {isError ? (
                        <AlertCircle className="w-4 h-4 text-rose-500" />
                      ) : (
                        <Sparkles className="w-4 h-4 text-emerald-500" />
                      )}
                    </div>
                    <span className="text-sm font-medium truncate flex-1">
                      {result.query}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      {isError ? (
                        <Badge variant="destructive" className="text-[10px]">Error</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px]">
                          {result.rowCount} rows
                        </Badge>
                      )}
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {result.executionTimeMs}ms
                      </span>
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      )}
                    </div>
                  </button>

                  {/* Expanded content */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        {/* AI Message */}
                        {result.aiMessage && !isError && (
                          <div className="px-4 pb-2">
                            <p className="text-xs text-muted-foreground italic">
                              💡 {result.aiMessage}
                            </p>
                          </div>
                        )}

                        {/* SQL Block */}
                        {result.sql && (
                          <div className="mx-4 mb-3">
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">SQL</span>
                              {result.repaired && (
                                <Badge variant="outline" className="text-[9px] gap-1 border-amber-500/40 text-amber-600 bg-amber-50 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-500/30 px-1.5 py-0">
                                  <Wrench className="w-2.5 h-2.5" />
                                  auto-repaired
                                </Badge>
                              )}
                            </div>
                            <div className="relative">
                              <pre className="bg-[#1e1e2e] text-[#cdd6f4] rounded-lg p-3 text-xs font-mono overflow-x-auto leading-relaxed max-h-[120px]">
                                <code>{result.sql}</code>
                              </pre>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="absolute top-2 right-2 h-6 w-6 text-[#999] hover:text-white hover:bg-[#3a3a4a]"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCopy(result.sql, result.id);
                                }}
                              >
                                {copiedId === result.id ? (
                                  <Check className="w-3 h-3 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </Button>
                            </div>
                          </div>
                        )}

                        {/* Error */}
                        {isError && result.error && (
                          <div className="mx-4 mb-3 p-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800 rounded-lg">
                            <p className="text-xs text-rose-600 dark:text-rose-400 font-mono">
                              ⚠ {result.error}
                            </p>
                          </div>
                        )}

                        {/* Results Table */}
                        {hasRows && (
                          <div className="px-4 pb-3">
                            <div className="rounded-lg border overflow-hidden">
                              <TableUI>
                                <TableHeader>
                                  <TableRow className="bg-muted/80">
                                    <TableHead className="w-10 text-[10px] font-bold text-muted-foreground">
                                      #
                                    </TableHead>
                                    {result.columns.map((col) => (
                                      <TableHead
                                        key={col}
                                        className="text-[10px] font-bold text-muted-foreground whitespace-nowrap"
                                      >
                                        {col}
                                      </TableHead>
                                    ))}
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {result.rows.slice(0, 100).map((row, i) => (
                                    <TableRow
                                      key={i}
                                      className={cn(
                                        "hover:bg-muted/30",
                                        i % 2 === 1 && "bg-muted/20"
                                      )}
                                    >
                                      <TableCell className="text-[10px] text-muted-foreground font-mono">
                                        {i + 1}
                                      </TableCell>
                                      {row.map((val, j) => (
                                        <TableCell
                                          key={j}
                                          className={cn(
                                            "text-xs whitespace-nowrap",
                                            typeof val === "number"
                                              ? "font-mono tabular-nums text-right text-slate-700 dark:text-slate-300"
                                              : "text-slate-600 dark:text-slate-400"
                                          )}
                                        >
                                          {val === null ? (
                                            <span className="text-slate-300 italic">NULL</span>
                                          ) : (
                                            String(val)
                                          )}
                                        </TableCell>
                                      ))}
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </TableUI>
                            </div>
                            {result.rows.length > 100 && (
                              <p className="text-[10px] text-muted-foreground text-center mt-1.5">
                                Showing 100 of {result.rowCount.toLocaleString()} rows
                              </p>
                            )}
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </CardContent>
    </Card>
  );
}
