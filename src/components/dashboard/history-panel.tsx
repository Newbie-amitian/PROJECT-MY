"use client";

import React, { useState } from "react";
import {
  RotateCcw,
  Clock,
  ChevronDown,
  ChevronRight,
  Zap,
  Edit,
  Code,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDashboardStore, type HistoryEntry } from "@/lib/dashboard-store";
import { cn } from "@/lib/utils";

// ── Relative time helper ──
function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  const minutes = Math.floor(diff / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Type icon & config ──
const TYPE_CONFIG: Record<
  HistoryEntry["type"],
  { icon: typeof Zap; label: string; emoji: string; color: string }
> = {
  rule: {
    icon: Zap,
    label: "Rule",
    emoji: "🔧",
    color: "text-amber-600 dark:text-amber-400",
  },
  grel: {
    icon: Code,
    label: "GREL",
    emoji: "🔧",
    color: "text-violet-600 dark:text-violet-400",
  },
  manual_edit: {
    icon: Edit,
    label: "Manual Edit",
    emoji: "✏️",
    color: "text-blue-600 dark:text-blue-400",
  },
  initial: {
    icon: RotateCcw,
    label: "Initial",
    emoji: "📄",
    color: "text-slate-500",
  },
};

interface HistoryPanelProps {
  onGoToHistory: (index: number) => void;
}

export function HistoryPanel({
  onGoToHistory,
}: HistoryPanelProps) {
  const { historyStack, historyIndex } = useDashboardStore();
  const [expanded, setExpanded] = useState(true);

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border bg-card overflow-hidden"
    >
      {/* Header with Undo/Redo buttons */}
      <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b">
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            History
          </span>
          {historyStack.length > 0 && (
            <Badge variant="secondary" className="text-[9px] h-4">
              {historyIndex + 1}/{historyStack.length}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {historyStack.length > 0 && (
            <button
              onClick={() => setExpanded((e) => !e)}
              className="ml-auto p-1 hover:bg-muted rounded transition-colors"
            >
              {expanded ? (
                <ChevronDown className="w-3 h-3 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-3 h-3 text-muted-foreground" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* History entries */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            {historyStack.length === 0 ? (
              <div className="px-3 py-4 text-center">
                <p className="text-[11px] text-muted-foreground">
                  No history yet. Apply cleaning rules to start tracking changes.
                </p>
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto">
                {historyStack.map((entry, index) => {
                  const config = TYPE_CONFIG[entry.type] || TYPE_CONFIG.initial;
                  const isActive = index === historyIndex;
                  const isFuture = index > historyIndex;

                  return (
                    <button
                      key={entry.id}
                      onClick={() => onGoToHistory(index)}
                      disabled={isActive}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors border-b border-border/30 last:border-b-0",
                        isActive
                          ? "bg-violet-50 dark:bg-violet-950/20 border-l-2 border-l-violet-500"
                          : "hover:bg-muted/50 border-l-2 border-l-transparent",
                        isFuture && "opacity-40",
                      )}
                    >
                      {/* Type indicator */}
                      <span className="text-xs shrink-0">{config.emoji}</span>

                      {/* Description */}
                      <div className="flex-1 min-w-0">
                        <p className={cn(
                          "text-[11px] truncate",
                          isActive ? "font-semibold text-foreground" : "text-muted-foreground"
                        )}>
                          {entry.description}
                        </p>
                      </div>

                      {/* Type badge */}
                      <span className={cn("text-[8px] font-bold uppercase tracking-wider", config.color)}>
                        {config.label}
                      </span>

                      {/* Time */}
                      <span className="text-[9px] text-muted-foreground whitespace-nowrap shrink-0">
                        {relativeTime(entry.timestamp)}
                      </span>

                      {/* Active indicator */}
                      {isActive && (
                        <span className="w-1.5 h-1.5 rounded-full bg-violet-500 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
