"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  MessageCircle,
  X,
  Send,
  Loader2,
  Bot,
  User,
  CheckCircle2,
  XCircle,
  Eye,
  ArrowRightLeft,
  AlertTriangle,
  Sparkles,
  Wrench,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useDashboardStore } from "@/lib/dashboard-store";
import type { RawDataRow, ChatMessage } from "@/lib/dashboard-types";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────

interface PreviewAction {
  type: string;
  description: string;
  preview: Array<{ before: Record<string, unknown>; after: Record<string, unknown> }>;
  affectedRows: number;
  affectedColumns: string[];
  confidence: number;
  label: "HIGH" | "MEDIUM" | "LOW";
  executionPlan: string;
}

interface ChatEditMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  preview?: PreviewAction | null;
  isApplied?: boolean;
  isSkipped?: boolean;
}

// ── Component ──────────────────────────────────────────

interface ManualReviewChatProps {
  onClose: () => void;
}

const SUGGESTION_COMMANDS = [
  "Rename column X to Y",
  "Replace 'old_val' with 'new_val' in Column",
  "Convert M and Male to Male",
  "Delete rows where Column is NULL",
  "Create NewCol = Col1 / Col2",
];

export function ManualReviewChat({ onClose }: ManualReviewChatProps) {
  const { rawData, cleanedData, setCleanedData, columns, addTransformationLog } = useDashboardStore();

  const [messages, setMessages] = useState<ChatEditMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [pendingPreview, setPendingPreview] = useState<ChatEditMessage | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeData = cleanedData.length > 0 ? cleanedData : rawData;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, pendingPreview]);

  // Welcome message
  useEffect(() => {
    setMessages([{
      id: "welcome",
      role: "assistant",
      content: "Welcome to **Manual Review Mode**. I'm your AI Data Editor.\n\nI can help you:\n• Rename columns\n• Replace specific values\n• Merge categories\n• Delete rows with null values\n• Create computed columns\n\nType a command below, and I'll show you a preview before applying anything.",
      timestamp: Date.now(),
      preview: null,
    }]);
  }, []);

  const sendCommand = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMsg: ChatEditMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: text.trim(),
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      // Build conversation history for API
      const history = messages
        .filter((m) => m.id !== "welcome")
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch("/api/chat-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text.trim(),
          data: activeData.slice(0, 200), // Limit rows for performance
          columns,
          conversationHistory: history,
        }),
      });

      if (!res.ok) {
        throw new Error(`API error: ${res.status}`);
      }

      const result = await res.json();

      const assistantMsg: ChatEditMessage = {
        id: `msg-${Date.now()}-resp`,
        role: "assistant",
        content: result.aiMessage || "Command processed.",
        timestamp: Date.now(),
        preview: result.preview || null,
      };

      setMessages((prev) => [...prev, assistantMsg]);

      // If there's a preview, set it as pending for user confirmation
      if (result.preview) {
        setPendingPreview(assistantMsg);
      }
    } catch {
      const errorMsg: ChatEditMessage = {
        id: `msg-${Date.now()}-error`,
        role: "assistant",
        content: "Sorry, I couldn't process that command. Please try again.",
        timestamp: Date.now(),
        preview: null,
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, messages, activeData, columns]);

  // Execute a confirmed preview
  const executePreview = useCallback((preview: PreviewAction) => {
    const data = [...activeData];
    let modified = false;

    switch (preview.type) {
      case "rename_column": {
        if (preview.affectedColumns.length > 0) {
          const oldName = preview.affectedColumns[0];
          // Get new name from preview
          const afterKeys = preview.preview[0]?.after ? Object.keys(preview.preview[0].after) : [];
          const newName = afterKeys[0] || oldName;

          for (const row of data) {
            row[newName] = row[oldName];
            delete row[oldName];
          }
          modified = true;

          addTransformationLog({
            id: `log-${Date.now()}-rename`,
            timestamp: Date.now(),
            column: oldName,
            cleanedValue: newName,
            originalValue: oldName,
            rule: "chat: rename_column",
            confidence: preview.confidence,
            status: "manual_edit",
            severity: "clean",
          });
        }
        break;
      }

      case "replace_values":
      case "merge_categories": {
        const previewPairs = preview.preview.map((p) => ({
          beforeVal: String(Object.values(p.before)[0]),
          afterVal: String(Object.values(p.after)[0]),
        }));

        for (const row of data) {
          for (const col of Object.keys(row)) {
            const rv = String(row[col]).trim();
            for (const { beforeVal, afterVal } of previewPairs) {
              if (rv === beforeVal) {
                row[col] = afterVal;
                modified = true;
              }
            }
          }
        }

        addTransformationLog({
          id: `log-${Date.now()}-${preview.type}`,
          timestamp: Date.now(),
          column: preview.affectedColumns.join(", ") || "multiple",
          originalValue: previewPairs.map((p) => p.beforeVal).join(", "),
          cleanedValue: previewPairs.map((p) => p.afterVal).join(", "),
          rule: `chat: ${preview.type}`,
          confidence: preview.confidence,
          status: "manual_edit",
          severity: "clean",
        });
        break;
      }

      case "delete_rows": {
        const col = preview.affectedColumns[0];
        if (col) {
          const before = data.length;
          const kept = data.filter((r) => r[col] != null && String(r[col]).trim() !== "");
          data.length = 0;
          data.push(...kept);
          modified = true;

          addTransformationLog({
            id: `log-${Date.now()}-delete`,
            timestamp: Date.now(),
            column: col,
            originalValue: `deleted ${before - kept.length} rows`,
            cleanedValue: `${kept.length} rows remaining`,
            rule: "chat: delete_rows",
            confidence: preview.confidence,
            status: "manual_edit",
            severity: "warning",
          });
        }
        break;
      }

      case "create_column": {
        // Execute create column from preview data
        if (preview.preview.length > 0) {
          const afterSample = preview.preview[0]?.after;
          if (afterSample) {
            const newColName = Object.keys(afterSample)[0];
            const expression = preview.executionPlan;
            if (newColName) {
              // Try to evaluate simple expressions from executionPlan
              for (let i = 0; i < data.length; i++) {
                try {
                  // Simple expression evaluation: "NewCol = Col1 / 12"
                  const exprMatch = expression.match(/=\s*(.+)/);
                  if (exprMatch) {
                    const expr = exprMatch[1].trim();
                    // Replace column references with actual values
                    let evaluated = expr;
                    for (const col of Object.keys(data[i])) {
                      const val = data[i][col];
                      if (typeof val === "number") {
                        evaluated = evaluated.replace(new RegExp(`\\b${col}\\b`, "g"), String(val));
                      }
                    }
                    // Safely evaluate simple arithmetic
                    if (/^[\d\s+\-*/().]+$/.test(evaluated)) {
                      const result = Function(`"use strict"; return (${evaluated})`)();
                      data[i][newColName] = typeof result === "number" ? Math.round(result * 100) / 100 : result;
                    } else {
                      data[i][newColName] = null;
                    }
                  } else {
                    data[i][newColName] = null;
                  }
                } catch {
                  data[i][newColName] = null;
                }
              }
              modified = true;

              addTransformationLog({
                id: `log-${Date.now()}-create`,
                timestamp: Date.now(),
                column: newColName,
                originalValue: null,
                cleanedValue: `Created column from: ${expression}`,
                rule: "chat: create_column",
                confidence: preview.confidence,
                status: "manual_edit",
                severity: "clean",
              });
            }
          }
        }
        break;
      }

      case "fill_values": {
        const col = preview.affectedColumns[0];
        if (col && preview.preview.length > 0) {
          const fillValue = Object.values(preview.preview[0].after)[0];
          let filledCount = 0;
          for (const row of data) {
            if (row[col] == null || String(row[col]).trim() === "") {
              row[col] = fillValue;
              filledCount++;
              modified = true;
            }
          }
          addTransformationLog({
            id: `log-${Date.now()}-fill`,
            timestamp: Date.now(),
            column: col,
            originalValue: `filled ${filledCount} null values`,
            cleanedValue: String(fillValue),
            rule: "chat: fill_values",
            confidence: preview.confidence,
            status: "manual_edit",
            severity: "warning",
          });
        }
        break;
      }

      default:
        break;
    }

    if (modified) {
      setCleanedData(data);
    }

    // Mark message as applied
    setMessages((prev) =>
      prev.map((m) =>
        m === pendingPreview ? { ...m, isApplied: true, isSkipped: false } : m
      )
    );
    setPendingPreview(null);
  }, [activeData, pendingPreview, setCleanedData, addTransformationLog]);

  const skipPreview = useCallback(() => {
    if (pendingPreview) {
      setMessages((prev) =>
        prev.map((m) =>
          m === pendingPreview ? { ...m, isSkipped: true } : m
        )
      );
    }
    setPendingPreview(null);
  }, [pendingPreview]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendCommand(input);
      }
    },
    [sendCommand, input]
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="w-full max-w-3xl mx-auto"
    >
      <Card className="border-2 border-[#f0c040]/30 bg-gradient-to-br from-amber-50/30 to-orange-50/20 dark:from-amber-950/10 dark:to-orange-950/10">
        <CardContent className="p-0">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-gradient-to-r from-[#2b2b2b] to-[#3a3a3a] rounded-t-xl">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-[#f0c040]/20 flex items-center justify-center">
                <Wrench className="w-4 h-4 text-[#f0c040]" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">AI Chat Editor</h3>
                <p className="text-[10px] text-[#999]">Manual Review Mode — Preview before apply</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[9px] font-mono border-[#f0c040]/30 text-[#f0c040]">
                <Eye className="w-2.5 h-2.5 mr-1" />
                PREVIEW MODE
              </Badge>
              <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7 text-white/60 hover:text-white hover:bg-white/10">
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="h-[360px] overflow-y-auto px-4 py-3 space-y-3">
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn("flex gap-2.5", msg.role === "user" ? "flex-row-reverse" : "flex-row")}
              >
                <div
                  className={cn(
                    "w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                    msg.role === "user" ? "bg-[#f0c040]/20" : "bg-muted"
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
                    "max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                    msg.role === "user"
                      ? "bg-[#f0c040] text-[#2b2b2b] rounded-tr-md font-medium"
                      : "bg-card border rounded-tl-md"
                  )}
                >
                  {/* Render markdown-lite content */}
                  <div className="whitespace-pre-wrap">
                    {msg.content.split("\n").map((line, i) => {
                      if (line.startsWith("**") && line.endsWith("**")) {
                        return <p key={i} className="font-semibold">{line.replace(/\*\*/g, "")}</p>;
                      }
                      if (line.startsWith("• ")) {
                        return <p key={i} className="flex gap-1.5 ml-2"><span className="text-[#f0c040]">•</span>{line.slice(2)}</p>;
                      }
                      return <p key={i}>{line}</p>;
                    })}
                  </div>

                  {/* Status badge for applied/skipped */}
                  {msg.isApplied && (
                    <div className="flex items-center gap-1 mt-2 text-[10px] text-emerald-600 font-medium">
                      <CheckCircle2 className="w-3 h-3" />
                      Applied successfully
                    </div>
                  )}
                  {msg.isSkipped && (
                    <div className="flex items-center gap-1 mt-2 text-[10px] text-muted-foreground">
                      <XCircle className="w-3 h-3" />
                      Skipped
                    </div>
                  )}

                  <p className={cn(
                    "text-[10px] mt-1",
                    msg.role === "user" ? "text-[#2b2b2b]/50" : "text-muted-foreground"
                  )}>
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </motion.div>
            ))}

            {isLoading && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-2.5">
                <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <Bot className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
                <div className="bg-card border rounded-2xl rounded-tl-md px-4 py-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Analyzing command...
                  </div>
                </div>
              </motion.div>
            )}
          </div>

          {/* Pending Preview Card */}
          <AnimatePresence>
            {pendingPreview?.preview && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="border-t bg-amber-50/50 dark:bg-amber-950/10"
              >
                <div className="px-4 py-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <Eye className="w-4 h-4 text-[#f0c040]" />
                    <span className="text-xs font-semibold text-foreground">Preview — Review before applying</span>
                    <Badge variant="outline" className="text-[9px] font-mono">
                      {pendingPreview.preview.label} ({(pendingPreview.preview.confidence * 100).toFixed(0)}%)
                    </Badge>
                    <Badge variant="secondary" className="text-[9px]">
                      {pendingPreview.preview.affectedRows} row{pendingPreview.preview.affectedRows !== 1 ? "s" : ""}
                    </Badge>
                  </div>

                  <p className="text-xs text-muted-foreground">{pendingPreview.preview.description}</p>

                  {/* Before → After table */}
                  {pendingPreview.preview.preview.length > 0 && (
                    <div className="rounded-lg border bg-[#1e1e2e] p-3 space-y-1.5">
                      <div className="flex items-center gap-1.5 mb-2">
                        <ArrowRightLeft className="w-3 h-3 text-[#f0c040]" />
                        <span className="text-[10px] font-semibold text-[#f0c040] uppercase tracking-wider">
                          Preview Changes
                        </span>
                      </div>
                      {pendingPreview.preview.preview.map((item, i) => {
                        const beforeKey = Object.keys(item.before)[0] || "value";
                        const afterKey = Object.keys(item.after)[0] || "value";
                        return (
                          <div key={i} className="flex items-center gap-2 text-xs font-mono">
                            <span className="text-rose-400 bg-rose-950/30 px-2 py-0.5 rounded truncate max-w-[180px]" title={JSON.stringify(item.before)}>
                              {beforeKey}: {String(Object.values(item.before)[0])}
                            </span>
                            <span className="text-[#666] shrink-0">→</span>
                            <span className="text-emerald-400 bg-emerald-950/30 px-2 py-0.5 rounded truncate max-w-[180px]" title={JSON.stringify(item.after)}>
                              {afterKey}: {String(Object.values(item.after)[0])}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Execution plan */}
                  {pendingPreview.preview.executionPlan && (
                    <p className="text-[11px] text-muted-foreground italic flex items-start gap-1.5">
                      <Sparkles className="w-3 h-3 text-[#f0c040] shrink-0 mt-0.5" />
                      {pendingPreview.preview.executionPlan}
                    </p>
                  )}

                  {/* Apply / Skip buttons */}
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={skipPreview}
                      className="text-xs h-7 gap-1.5 text-muted-foreground"
                    >
                      <XCircle className="w-3 h-3" />
                      Skip
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => executePreview(pendingPreview.preview!)}
                      className="text-xs h-7 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      <CheckCircle2 className="w-3 h-3" />
                      Apply Changes
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Input Area */}
          <div className="border-t px-3 py-3">
            {/* Suggestion chips */}
            {messages.length <= 2 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {SUGGESTION_COMMANDS.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => setInput(suggestion)}
                    className="text-[10px] bg-muted hover:bg-muted/80 rounded-lg px-2.5 py-1.5 transition-colors text-left flex items-center gap-1.5"
                  >
                    <Wrench className="w-2.5 h-2.5 text-[#f0c040]" />
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder='Type a command: "Rename column X to Y", "Replace old with new"...'
                className="min-h-[36px] max-h-[80px] resize-none text-sm rounded-xl border-muted-foreground/20 focus-visible:ring-[#f0c040]/30 focus-visible:border-[#f0c040]"
                rows={1}
              />
              <Button
                size="icon"
                onClick={() => sendCommand(input)}
                disabled={!input.trim() || isLoading}
                className="w-9 h-9 rounded-xl shrink-0 bg-[#f0c040] hover:bg-[#e5b030] text-[#2b2b2b]"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
