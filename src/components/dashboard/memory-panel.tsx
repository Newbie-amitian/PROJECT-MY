"use client";

import React, { useState } from "react";
import {
  Database, Brain, RotateCcw, Sparkles, TrendingUp, Trash2, ChevronRight,
  Shield, Eye, Zap, AlertTriangle, ArrowRight, Check, X, RefreshCw, BarChart3
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AnimatePresence, motion } from "framer-motion";
import { memoryEngine, type ColumnMappingMemory, type RuleMemoryEntry, type DriftAlert, type MemoryStats, type PromotionState } from "@/lib/memory-engine";

interface MemoryPanelProps {
  memoryStats: MemoryStats | null;
  driftAlerts?: DriftAlert[];
  onRefresh: () => void;
  onClear: () => void;
  onResolveDrift?: (alertId: string, resolution: "accept" | "reject" | "replace") => void;
}

// ── Promotion State Badge ────────────────────────────

function PromotionBadge({ state }: { state: PromotionState }) {
  const config = {
    OBSERVED: {
      icon: Eye,
      label: "OBSERVED",
      color: "text-slate-500 dark:text-slate-400",
      bg: "bg-slate-100 dark:bg-slate-800/50",
      border: "border-slate-200 dark:border-slate-700",
    },
    CONFIRMED: {
      icon: Zap,
      label: "CONFIRMED",
      color: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-50 dark:bg-amber-950/30",
      border: "border-amber-200 dark:border-amber-800",
    },
    ACTIVE: {
      icon: Shield,
      label: "ACTIVE",
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-50 dark:bg-emerald-950/30",
      border: "border-emerald-200 dark:border-emerald-800",
    },
  };
  const { icon: Icon, label, color, bg, border } = config[state];
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-bold ${bg} ${color} border ${border}`}>
      <Icon className="w-2.5 h-2.5" />
      {label}
    </span>
  );
}

// ── Drift Severity Badge ─────────────────────────────

function DriftSeverityBadge({ severity }: { severity: DriftAlert["severity"] }) {
  const config = {
    low: { color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-950/30", label: "LOW" },
    medium: { color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/30", label: "MED" },
    high: { color: "text-rose-600 dark:text-rose-400", bg: "bg-rose-50 dark:bg-rose-950/30", label: "HIGH" },
  };
  const { color, bg, label } = config[severity];
  return (
    <span className={`inline-flex items-center px-1 py-0 rounded text-[8px] font-bold ${bg} ${color}`}>
      {label}
    </span>
  );
}

// ── Confidence Bar ───────────────────────────────────

function ConfidenceBar({ value, size = "sm" }: { value: number; size?: "sm" | "md" }) {
  const pct = Math.round(value * 100);
  const color = pct >= 85 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-rose-500";
  const h = size === "sm" ? "h-1" : "h-1.5";
  return (
    <div className="flex items-center gap-1">
      <div className={`flex-1 ${h} bg-muted rounded-full overflow-hidden`}>
        <div className={`h-full ${color} rounded-full transition-all duration-300`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[8px] text-muted-foreground font-mono min-w-[24px] text-right">{pct}%</span>
    </div>
  );
}

// ── Main Memory Panel ────────────────────────────────

export function MemoryPanel({ memoryStats, driftAlerts, onRefresh, onClear, onResolveDrift }: MemoryPanelProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [expandedColumn, setExpandedColumn] = useState<string | null>(null);
  const [showDriftDetails, setShowDriftDetails] = useState(false);
  const [showPromotionView, setShowPromotionView] = useState(false);

  let allData: {
    mappings: Map<string, ColumnMappingMemory>;
    rules: Map<string, RuleMemoryEntry>;
    corrections: ReturnType<typeof memoryEngine.getUserCorrections>;
    driftAlerts: DriftAlert[];
  } = { mappings: new Map(), rules: new Map(), corrections: [], driftAlerts: [] };

  try {
    const data = memoryEngine.getAllData();
    allData = {
      mappings: data.mappings,
      rules: data.rules,
      corrections: data.corrections.slice(0, 20),
      driftAlerts: data.driftAlerts.slice(0, 20),
    };
  } catch { /* SSR */ }

  const columnEntries = [...allData.mappings.entries()].sort((a, b) => b[1].lastUpdated - a[1].lastUpdated);
  const totalStorageKB = memoryEngine.getStorageSize();
  const unresolvedDrift = driftAlerts ?? allData.driftAlerts.filter((a) => a.resolution === null).slice(0, 10);

  const stats = memoryStats ?? {
    totalMappingsLearned: 0,
    totalColumnsMapped: 0,
    totalRulesLearned: 0,
    totalUserCorrections: 0,
    totalDatasetsProcessed: 0,
    memoryAgeDays: 0,
    observedMappings: 0,
    confirmedMappings: 0,
    activeMappings: 0,
    activeDriftAlerts: 0,
    resolvedDriftAlerts: 0,
    totalDriftDetected: 0,
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
            <Brain className="w-3.5 h-3.5 text-white" />
          </div>
          <div>
            <h4 className="text-[11px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider">
              Self-Learning Memory v3
            </h4>
            <p className="text-[9px] text-muted-foreground">
              Promotion + Drift Detection + Persistence
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => { memoryEngine.promoteAllMappings(); onRefresh(); }} className="h-6 px-1.5 text-[9px] gap-1 text-emerald-600 hover:text-emerald-700" title="Run promotion evaluation">
            <BarChart3 className="w-2.5 h-2.5" /> Promote
          </Button>
          <Button variant="ghost" size="sm" onClick={onRefresh} className="h-6 px-1.5 text-[9px] gap-1">
            <RotateCcw className="w-2.5 h-2.5" /> Refresh
          </Button>
          <Button variant="ghost" size="sm" onClick={onClear} className="h-6 px-1.5 text-[9px] gap-1 text-rose-500 hover:text-rose-600">
            <Trash2 className="w-2.5 h-2.5" /> Clear
          </Button>
        </div>
      </div>

      {/* ── Stats Grid (5 items) ── */}
      <div className="grid grid-cols-5 gap-1.5">
        {[
          { icon: Database, label: "Columns", value: stats.totalColumnsMapped, color: "text-blue-500" },
          { icon: Sparkles, label: "Mappings", value: stats.totalMappingsLearned, color: "text-emerald-500" },
          { icon: Shield, label: "Active", value: stats.activeMappings ?? 0, color: "text-emerald-600" },
          { icon: TrendingUp, label: "Corrections", value: stats.totalUserCorrections, color: "text-violet-500" },
          { icon: RotateCcw, label: "Datasets", value: stats.totalDatasetsProcessed, color: "text-amber-500" },
        ].map(({ icon: Icon, label, value, color }) => (
          <div key={label} className="rounded-lg border bg-muted/20 px-1.5 py-1 text-center">
            <Icon className={`w-3 h-3 ${color} mx-auto mb-0.5`} />
            <div className="text-sm font-bold">{value}</div>
            <div className="text-[7px] text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>

      {/* ── Promotion Lifecycle Bar ── */}
      {(stats.observedMappings ?? 0) + (stats.confirmedMappings ?? 0) + (stats.activeMappings ?? 0) > 0 && (
        <div className="rounded-lg border bg-muted/20 p-2">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Promotion Pipeline</span>
            <button onClick={() => setShowPromotionView(!showPromotionView)} className="text-[8px] text-amber-600 hover:text-amber-700">
              {showPromotionView ? "Hide" : "Details"}
            </button>
          </div>
          <div className="flex items-center gap-1">
            {/* OBSERVED */}
            <div className="flex-1">
              <div className="flex items-center justify-between mb-0.5">
                <PromotionBadge state="OBSERVED" />
                <span className="text-[9px] font-bold text-slate-500">{stats.observedMappings ?? 0}</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-slate-400 rounded-full" style={{ width: `${stats.totalMappingsLearned > 0 ? ((stats.observedMappings ?? 0) / stats.totalMappingsLearned) * 100 : 0}%` }} />
              </div>
            </div>
            <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
            {/* CONFIRMED */}
            <div className="flex-1">
              <div className="flex items-center justify-between mb-0.5">
                <PromotionBadge state="CONFIRMED" />
                <span className="text-[9px] font-bold text-amber-600">{stats.confirmedMappings ?? 0}</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-amber-400 rounded-full" style={{ width: `${stats.totalMappingsLearned > 0 ? ((stats.confirmedMappings ?? 0) / stats.totalMappingsLearned) * 100 : 0}%` }} />
              </div>
            </div>
            <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
            {/* ACTIVE */}
            <div className="flex-1">
              <div className="flex items-center justify-between mb-0.5">
                <PromotionBadge state="ACTIVE" />
                <span className="text-[9px] font-bold text-emerald-600">{stats.activeMappings ?? 0}</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${stats.totalMappingsLearned > 0 ? ((stats.activeMappings ?? 0) / stats.totalMappingsLearned) * 100 : 0}%` }} />
              </div>
            </div>
          </div>
          {/* Promotion Thresholds hint */}
          <p className="text-[7px] text-muted-foreground mt-1.5 leading-tight">
            <Eye className="w-2 h-2 inline mr-0.5" />→<Zap className="w-2 h-2 inline mx-0.5" />: 2+ batches OR 3+ confirms OR user confirm
            &nbsp;|&nbsp;
            <Zap className="w-2 h-2 inline mr-0.5" />→<Shield className="w-2 h-2 inline mx-0.5" />: 3+ batches AND 5+ confirms AND ≥85% confidence
          </p>
        </div>
      )}

      {/* ── Drift Alerts ── */}
      {unresolvedDrift.length > 0 && (
        <div className="rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-950/10">
          <button
            onClick={() => setShowDriftDetails(!showDriftDetails)}
            className="w-full flex items-center justify-between px-2.5 py-2 text-left"
          >
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-500 animate-pulse" />
              <span className="text-[10px] font-bold text-rose-700 dark:text-rose-400">
                {unresolvedDrift.length} Drift Alert{unresolvedDrift.length !== 1 ? "s" : ""}
              </span>
              <span className="text-[8px] text-rose-500/70">NEW_VARIANT detected</span>
            </div>
            <ChevronRight className={`w-3 h-3 text-rose-400 transition-transform ${showDriftDetails ? "rotate-90" : ""}`} />
          </button>
          <AnimatePresence>
            {showDriftDetails && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="px-2.5 pb-2 space-y-1.5 max-h-48 overflow-y-auto">
                  {unresolvedDrift.map((alert) => (
                    <div key={alert.id} className="rounded border bg-background p-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <DriftSeverityBadge severity={alert.severity} />
                            <span className="text-[8px] text-muted-foreground font-mono">{alert.column}</span>
                            {alert.frequency > 1 && (
                              <Badge variant="secondary" className="text-[7px] h-3 px-1">{alert.frequency}×</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1 text-[10px] font-mono">
                            <span className="text-rose-600 dark:text-rose-400 font-semibold">{alert.newValue}</span>
                            {alert.similarTo && (
                              <>
                                <ArrowRight className="w-2.5 h-2.5 text-muted-foreground" />
                                <span className="text-muted-foreground">~</span>
                                <span className="text-amber-600 dark:text-amber-400">{alert.similarTo}</span>
                              </>
                            )}
                            {alert.similarityScore > 0 && (
                              <span className="text-[7px] text-muted-foreground ml-1">
                                ({Math.round(alert.similarityScore * 100)}% similar)
                              </span>
                            )}
                          </div>
                        </div>
                        {onResolveDrift && (
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button
                              onClick={() => onResolveDrift(alert.id, "accept")}
                              className="p-0.5 rounded hover:bg-emerald-100 dark:hover:bg-emerald-900/30 text-emerald-600"
                              title="Accept: Add to mapping"
                            >
                              <Check className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => onResolveDrift(alert.id, "replace")}
                              className="p-0.5 rounded hover:bg-amber-100 dark:hover:bg-amber-900/30 text-amber-600"
                              title="Replace: This becomes the new canonical"
                            >
                              <RefreshCw className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => onResolveDrift(alert.id, "reject")}
                              className="p-0.5 rounded hover:bg-rose-100 dark:hover:bg-rose-900/30 text-rose-500"
                              title="Reject: Ignore this drift"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Storage indicator */}
      <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
        <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-amber-400 rounded-full transition-all"
            style={{ width: `${Math.min((totalStorageKB.used / totalStorageKB.total) * 100, 100)}%` }}
          />
        </div>
        <span>{(totalStorageKB.used / 1024).toFixed(1)} KB / {(totalStorageKB.total / 1024).toFixed(0)} MB</span>
      </div>

      {/* ── Column Mappings Detail ── */}
      {columnEntries.length > 0 && (
        <div>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="w-full flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
          >
            <ChevronRight className={`w-3 h-3 transition-transform ${showDetails ? "rotate-90" : ""}`} />
            Learned Column Mappings ({columnEntries.length})
          </button>
          <AnimatePresence>
            {showDetails && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-1.5 space-y-1 max-h-52 overflow-y-auto">
                  {columnEntries.slice(0, 10).map(([colKey, mem]) => {
                    const isExpanded = expandedColumn === colKey;
                    const mappingCount = Object.keys(mem.variantToCanonical).length;
                    // Count promotion states for this column
                    const promoCounts = { OBSERVED: 0, CONFIRMED: 0, ACTIVE: 0 };
                    for (const canon of Object.values(mem.canonicalEntries)) {
                      promoCounts[canon.promotionState]++;
                    }
                    return (
                      <div key={colKey} className="rounded border bg-background">
                        <button
                          onClick={() => setExpandedColumn(isExpanded ? null : colKey)}
                          className="w-full flex items-center justify-between px-2 py-1 text-[10px] hover:bg-muted/30 transition-colors"
                        >
                          <span className="flex items-center gap-1.5">
                            <ChevronRight className={`w-2.5 h-2.5 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                            <span className="font-semibold font-mono">{colKey}</span>
                            {/* Mini promotion indicators */}
                            {promoCounts.ACTIVE > 0 && (
                              <span className="text-[7px] bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 rounded px-1">{promoCounts.ACTIVE}🛡️</span>
                            )}
                            {promoCounts.CONFIRMED > 0 && (
                              <span className="text-[7px] bg-amber-100 dark:bg-amber-900/30 text-amber-600 rounded px-1">{promoCounts.CONFIRMED}⚡</span>
                            )}
                          </span>
                          <span className="text-muted-foreground">{mappingCount} mapping{mappingCount !== 1 ? "s" : ""}</span>
                        </button>
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="px-2 pb-1.5 space-y-0.5">
                                {Object.entries(mem.variantToCanonical).slice(0, 15).map(([variant, canonical]) => {
                                  // Find the canonical entry for promotion state
                                  const canonEntry = mem.canonicalEntries[canonical.toLowerCase()];
                                  const promoState = canonEntry?.promotionState ?? "OBSERVED";
                                  const conf = canonEntry?.confidence ?? 0;
                                  return (
                                    <div key={variant} className="flex items-center gap-1.5 text-[9px] font-mono">
                                      <PromotionBadge state={promoState} />
                                      <span className="text-rose-500 dark:text-rose-400 truncate max-w-[70px]" title={variant}>{variant}</span>
                                      <span className="text-muted-foreground">→</span>
                                      <span className="text-emerald-600 dark:text-emerald-400 truncate max-w-[90px]" title={canonical}>{canonical}</span>
                                      <div className="w-12">
                                        <ConfidenceBar value={conf} />
                                      </div>
                                    </div>
                                  );
                                })}
                                {mappingCount > 15 && (
                                  <div className="text-[8px] text-muted-foreground text-center pt-0.5">
                                    +{mappingCount - 15} more...
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* How it works hint */}
      <div className="rounded-lg border border-dashed border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/10 p-2.5">
        <div className="flex items-start gap-2">
          <Brain className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
          <div className="text-[9px] text-amber-700 dark:text-amber-400 space-y-0.5">
            <p className="font-semibold">How it learns (v3):</p>
            <ul className="list-disc list-inside space-y-0.5 text-amber-600/80 dark:text-amber-400/80">
              <li>Engine discovers canonical forms → stored to memory</li>
              <li>Your manual edits are the <strong>highest confidence</strong> signal</li>
              <li><strong>Promotion:</strong> OBSERVED → CONFIRMED → ACTIVE (auto-escalates)</li>
              <li><strong>Drift:</strong> New unseen patterns → flagged as NEW_VARIANT 🚨</li>
              <li><strong>Protection:</strong> ACTIVE mappings cannot be overwritten by new data 🛡️</li>
              <li>Memory persists in browser — survives page refresh</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
