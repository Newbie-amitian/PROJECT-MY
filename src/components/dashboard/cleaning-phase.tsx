"use client";

import React, { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Info,
  ChevronRight,
  ChevronDown,
  Download,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  ArrowRightLeft,
  Type,
  Hash,
  Calendar,
  Tag,
  BarChart3,
  FileText,
  Trash2,
  KeyRound,
  Fingerprint,
  AlertTriangle as WarningTriangle,
  RotateCcw,
  Save,
  Pencil,
  X,
  Eye,
  Database,
  Type as TypeIcon2,
  FileSearch,
  Layers,
  ClipboardList,
  TableProperties,
  AlertOctagon,
  CheckCircle,
  XCircle,
  Copy,
  Check,
  Lightbulb,
  Brain,
  Undo2,
  Redo2,
  Banknote,
  Star,
  Clock,
  PieChart,
  Mail,
  Phone,
  Sparkles as SparklesIcon,
  MapPin,
  Wrench,
  Menu,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  Table as TableUI,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDashboardStore } from "@/lib/dashboard-store";
import { cleanData } from "@/lib/data-utils";
import { detectColumnProfile, generateCleaningPlan, applyRules, generateSummary, stripEmojis, isFeedbackColumn, hasNonFeedbackEmoji, containsEmoji, formatPhoneNumber, type CleaningRule, type ColumnProfile } from "@/lib/cleaning-engine";
import { normalizeLocationRules, batchNormalizeLocations, needsSemanticResolution } from "@/lib/location-normalizer";
import { normalizeGeographicRules, batchNormalizeGeographic, needsGeographicSemanticResolution } from "@/lib/geographic-normalizer";
import { postProcessGeographicColumn } from "@/lib/post-process-validator";
import { memoryEngine } from "@/lib/memory-engine";
import { sanitizeDatasetForExport, countEmojisInDataset } from "@/lib/emoji-sanitizer";
import type { RawDataRow, CleaningSuggestion, CellFlag, FlagSeverity, TransformationLogEntry, CellMetadata, DataViewMode, CellSource } from "@/lib/dashboard-types";
import { cn } from "@/lib/utils";
import { HistoryPanel } from "@/components/dashboard/history-panel";
import { MemoryPanel } from "@/components/dashboard/memory-panel";

type PlanSection = "text_cleaning" | "null_standardization" | "numeric_normalization" | "range_parsing" | "date_standardization" | "categorical_normalization" | "category_clustering" | "id_validation" | "anomaly_detection";

// Use CleaningRule from engine directly as CleaningPlanItem
type CleaningPlanItem = CleaningRule;

function SeverityIcon({ severity }: { severity: CleaningSuggestion["severity"] }) {
  switch (severity) {
    case "critical":
      return <AlertCircle className="w-4 h-4 text-rose-500" />;
    case "warning":
      return <AlertTriangle className="w-4 h-4 text-amber-500" />;
    default:
      return <Info className="w-4 h-4 text-blue-500" />;
  }
}

function SeverityBadge({ severity }: { severity: CleaningSuggestion["severity"] }) {
  const styles = {
    critical: "bg-rose-100 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400 border-rose-200 dark:border-rose-800",
    warning: "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 border-amber-200 dark:border-amber-800",
    info: "bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400 border-blue-200 dark:border-blue-800",
  };
  return (
    <Badge variant="outline" className={cn("text-[10px] px-1.5 h-5 font-medium", styles[severity])}>
      {severity}
    </Badge>
  );
}

function TypeIcon({ type }: { type: string }) {
  const t = type.toLowerCase();
  if (t.includes("numeric") || t.includes("number") || t.includes("int") || t.includes("float") || t.includes("decimal")) {
    return <Hash className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />;
  }
  if (t.includes("date") || t.includes("time")) {
    return <Calendar className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />;
  }
  if (t.includes("categ")) {
    return <Tag className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />;
  }
  return <Type className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />;
}

function IssueTypeBadge({ issueType }: { issueType: string }) {
  const labels: Record<string, string> = {
    type_mismatch: "Type Analysis",
    missing_values: "Missing",
    inconsistent_categories: "Normalize",
    text_quality: "Text Fix",
    duplicate_values: "Duplicates",
  };
  const colors: Record<string, string> = {
    type_mismatch: "bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400",
    missing_values: "bg-rose-100 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400",
    inconsistent_categories: "bg-violet-100 text-violet-700 dark:bg-violet-950/30 dark:text-violet-400",
    text_quality: "bg-sky-100 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400",
    duplicate_values: "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400",
  };
  const label = labels[issueType] || issueType;
  const color = colors[issueType] || "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
  return (
    <span className={cn("text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded", color)}>
      {label}
    </span>
  );
}

function MethodBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    convert: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
    normalize: "bg-blue-50 text-blue-700 dark:bg-blue-950/20 dark:text-blue-400 border-blue-200 dark:border-blue-800",
    canonical_map: "bg-violet-50 text-violet-700 dark:bg-violet-950/20 dark:text-violet-400 border-violet-200 dark:border-violet-800",
    trim: "bg-sky-50 text-sky-700 dark:bg-sky-950/20 dark:text-sky-400 border-sky-200 dark:border-sky-800",
    trim_titlecase: "bg-sky-50 text-sky-700 dark:bg-sky-950/20 dark:text-sky-400 border-sky-200 dark:border-sky-800",
    canonical_case: "bg-violet-50 text-violet-700 dark:bg-violet-950/20 dark:text-violet-400 border-violet-200 dark:border-violet-800",
    null_standardize: "bg-rose-50 text-rose-700 dark:bg-rose-950/20 dark:text-rose-400 border-rose-200 dark:border-rose-800",
    numeric_normalize: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
    money_normalize: "bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400 border-amber-200 dark:border-amber-800",
    rating_normalize: "bg-yellow-50 text-yellow-700 dark:bg-yellow-950/20 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800",
    title_case: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/20 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800",
    flag: "bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400 border-amber-200 dark:border-amber-800",
    median_impute: "bg-pink-50 text-pink-700 dark:bg-pink-950/20 dark:text-pink-400 border-pink-200 dark:border-pink-800",
    set_unknown: "bg-slate-50 text-slate-700 dark:bg-slate-950/20 dark:text-slate-400 border-slate-200 dark:border-slate-800",
    null_if_invalid: "bg-gray-50 text-gray-700 dark:bg-gray-950/20 dark:text-gray-400 border-gray-200 dark:border-gray-800",
    range_average: "bg-cyan-50 text-cyan-700 dark:bg-cyan-950/20 dark:text-cyan-400 border-cyan-200 dark:border-cyan-800",
    format_standardize: "bg-teal-50 text-teal-700 dark:bg-teal-950/20 dark:text-teal-400 border-teal-200 dark:border-teal-800",
    categorical_semantic_check: "bg-violet-50 text-violet-700 dark:bg-violet-950/20 dark:text-violet-400 border-violet-200 dark:border-violet-800",
    id_integrity_check: "bg-rose-50 text-rose-700 dark:bg-rose-950/20 dark:text-rose-400 border-rose-200 dark:border-rose-800",
    column_type_confidence: "bg-slate-50 text-slate-700 dark:bg-slate-950/20 dark:text-slate-400 border-slate-200 dark:border-slate-800",
    needs_review_trigger: "bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400 border-amber-200 dark:border-amber-800",
    salary_pre_normalization: "bg-cyan-50 text-cyan-700 dark:bg-cyan-950/20 dark:text-cyan-400 border-cyan-200 dark:border-cyan-800",
    single_value_range: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
    anomaly_detected: "bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400 border-red-200 dark:border-red-800",
    percentage_normalize: "bg-lime-50 text-lime-700 dark:bg-lime-950/20 dark:text-lime-400 border-lime-200 dark:border-lime-800",
    experience_normalize: "bg-orange-50 text-orange-700 dark:bg-orange-950/20 dark:text-orange-400 border-orange-200 dark:border-orange-800",
    email_normalize: "bg-violet-50 text-violet-700 dark:bg-violet-950/20 dark:text-violet-400 border-violet-200 dark:border-violet-800",
    phone_normalize: "bg-sky-50 text-sky-700 dark:bg-sky-950/20 dark:text-sky-400 border-sky-200 dark:border-sky-800",
    ai_email_validate: "bg-fuchsia-50 text-fuchsia-700 dark:bg-fuchsia-950/20 dark:text-fuchsia-400 border-fuchsia-200 dark:border-fuchsia-800",
    ai_phone_validate: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/20 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800",
    e164_phone_format: "bg-teal-50 text-teal-700 dark:bg-teal-950/20 dark:text-teal-400 border-teal-200 dark:border-teal-800",
    name_normalize: "bg-rose-50 text-rose-700 dark:bg-rose-950/20 dark:text-rose-400 border-rose-200 dark:border-rose-800",
    salary_word_normalize: "bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400 border-amber-200 dark:border-amber-800",
    salary_unified_parse: "bg-cyan-50 text-cyan-700 dark:bg-cyan-950/20 dark:text-cyan-400 border-cyan-200 dark:border-cyan-800",
    ai_salary_verify: "bg-fuchsia-50 text-fuchsia-700 dark:bg-fuchsia-950/20 dark:text-fuchsia-400 border-fuchsia-200 dark:border-fuchsia-800",
    date_normalize: "bg-blue-50 text-blue-700 dark:bg-blue-950/20 dark:text-blue-400 border-blue-200 dark:border-blue-800",
    location_normalize: "bg-teal-50 text-teal-700 dark:bg-teal-950/20 dark:text-teal-400 border-teal-200 dark:border-teal-800",
    column_analysis: "bg-slate-50 text-slate-700 dark:bg-slate-950/20 dark:text-slate-400 border-slate-200 dark:border-slate-800",
    location_rules: "bg-teal-50 text-teal-700 dark:bg-teal-950/20 dark:text-teal-400 border-teal-200 dark:border-teal-800",
    location_ai_semantic: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
    geographic_rules: "bg-cyan-50 text-cyan-700 dark:bg-cyan-950/20 dark:text-cyan-400 border-cyan-200 dark:border-cyan-800",
    geographic_ai_semantic: "bg-teal-50 text-teal-700 dark:bg-teal-950/20 dark:text-teal-400 border-teal-200 dark:border-teal-800",
    country_code_validate: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
  };
  const color = colors[method] || "bg-slate-50 text-slate-700 dark:bg-slate-950/20 dark:text-slate-400 border-slate-200 dark:border-slate-800";
  return (
    <span className={cn("text-[9px] font-mono px-1.5 py-0.5 rounded border", color)}>
      {method}
    </span>
  );
}

function ColumnClassBadge({ columnClass }: { columnClass: string }) {
  const config: Record<string, { icon: typeof KeyRound; label: string; color: string }> = {
    id: { icon: KeyRound, label: "ID", color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-300 dark:border-slate-600" },
    numeric: { icon: Hash, label: "Numeric", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800" },
    structured_numeric: { icon: BarChart3, label: "Structured Num", color: "bg-teal-100 text-teal-700 dark:bg-teal-950/30 dark:text-teal-400 border-teal-200 dark:border-teal-800" },
    categorical: { icon: Tag, label: "Categorical", color: "bg-violet-100 text-violet-700 dark:bg-violet-950/30 dark:text-violet-400 border-violet-200 dark:border-violet-800" },
    text: { icon: Type, label: "Text", color: "bg-sky-100 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400 border-sky-200 dark:border-sky-800" },
    name: { icon: FileText, label: "Name", color: "bg-rose-100 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400 border-rose-200 dark:border-rose-800" },
    sensitive: { icon: Fingerprint, label: "Sensitive", color: "bg-rose-100 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400 border-rose-200 dark:border-rose-800" },
    date: { icon: Calendar, label: "Date", color: "bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400 border-blue-200 dark:border-blue-800" },
    money: { icon: Banknote, label: "Money", color: "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 border-amber-200 dark:border-amber-800" },
    rating: { icon: Star, label: "Rating", color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800" },
    experience: { icon: Clock, label: "Experience", color: "bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400 border-orange-200 dark:border-orange-800" },
    percentage: { icon: PieChart, label: "Percentage", color: "bg-lime-100 text-lime-700 dark:bg-lime-950/30 dark:text-lime-400 border-lime-200 dark:border-lime-800" },
    email: { icon: Mail, label: "Email", color: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950/30 dark:text-fuchsia-400 border-fuchsia-200 dark:border-fuchsia-800" },
    phone: { icon: Phone, label: "Phone", color: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800" },
  };
  const c = config[columnClass] || config.text;
  const Icon = c.icon;
  return (
    <span className={cn("text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border flex items-center gap-1", c.color)}>
      <Icon className="w-2.5 h-2.5" />
      {c.label}
    </span>
  );
}

function RiskBadge({ risk }: { risk: "medium" | "high" }) {
  const config = {
    medium: { icon: WarningTriangle, label: "Medium Risk", color: "bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400 border-amber-200 dark:border-amber-800" },
    high: { icon: ShieldAlert, label: "High Risk", color: "bg-rose-50 text-rose-700 dark:bg-rose-950/20 dark:text-rose-400 border-rose-200 dark:border-rose-800" },
  };
  const c = config[risk];
  const Icon = c.icon;
  return (
    <span className={cn("text-[9px] font-semibold px-1.5 py-0.5 rounded border flex items-center gap-1", c.color)}>
      <Icon className="w-2.5 h-2.5" />
      {c.label}
    </span>
  );
}

function ConfidenceBadge({ score, label }: { score: number; label: "HIGH" | "MEDIUM" | "LOW" }) {
  const config = {
    HIGH: { color: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800" },
    MEDIUM: { color: "bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400 border-amber-200 dark:border-amber-800" },
    LOW: { color: "bg-rose-50 text-rose-700 dark:bg-rose-950/20 dark:text-rose-400 border-rose-200 dark:border-rose-800" },
  };
  const c = config[label];
  return (
    <span className={cn("text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded border", c.color)}>
      {label} ({(score * 100).toFixed(0)}%)
    </span>
  );
}

// ── Column Type Badge (for spreadsheet headers) ────────────────────────

const COL_TYPE_CONFIG: Record<string, { label: string; color: string; tooltip: string }> = {
  numeric_integer: { label: "INT", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800", tooltip: "Integer" },
  numeric_float: { label: "FLOAT", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800", tooltip: "Float" },
  categorical: { label: "CAT", color: "bg-violet-100 text-violet-700 dark:bg-violet-950/30 dark:text-violet-400 border-violet-200 dark:border-violet-800", tooltip: "Categorical" },
  text: { label: "TEXT", color: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border-gray-200 dark:border-gray-700", tooltip: "Text" },
  date: { label: "DATE", color: "bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400 border-blue-200 dark:border-blue-800", tooltip: "Date" },
  range: { label: "RANGE", color: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950/30 dark:text-cyan-400 border-cyan-200 dark:border-cyan-800", tooltip: "Range" },
  semi_structured_numeric: { label: "SEMI", color: "bg-teal-100 text-teal-700 dark:bg-teal-950/30 dark:text-teal-400 border-teal-200 dark:border-teal-800", tooltip: "Semi-Structured Numeric" },
  id: { label: "ID", color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700", tooltip: "Identifier" },
  boolean: { label: "BOOL", color: "bg-sky-100 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400 border-sky-200 dark:border-sky-800", tooltip: "Boolean" },
};

// ── Semantic type override labels (user-defined abbreviations) ──
const SEMANTIC_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  MONEY: { label: "Slry", color: "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 border-amber-200 dark:border-amber-800" },
  EXPERIENCE: { label: "Yr", color: "bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400 border-orange-200 dark:border-orange-800" },
  USERNAME: { label: "Usrn", color: "bg-sky-100 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400 border-sky-200 dark:border-sky-800" },
  FULL_NAME: { label: "FName", color: "bg-rose-100 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400 border-rose-200 dark:border-rose-800" },
  LAST_NAME: { label: "LName", color: "bg-rose-100 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400 border-rose-200 dark:border-rose-800" },
  FIRST_NAME: { label: "FName", color: "bg-rose-100 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400 border-rose-200 dark:border-rose-800" },
  EMAIL: { label: "Email", color: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950/30 dark:text-fuchsia-400 border-fuchsia-200 dark:border-fuchsia-800" },
  PHONE: { label: "Ph", color: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800" },
  LOCATION: { label: "Loc", color: "bg-teal-100 text-teal-700 dark:bg-teal-950/30 dark:text-teal-400 border-teal-200 dark:border-teal-800" },
  REGION: { label: "Reg", color: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950/30 dark:text-cyan-400 border-cyan-200 dark:border-cyan-800" },
  COUNTRY: { label: "Ctry", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800" },
  PERCENTAGE: { label: "Pct", color: "bg-lime-100 text-lime-700 dark:bg-lime-950/30 dark:text-lime-400 border-lime-200 dark:border-lime-800" },
  DATE: { label: "Date", color: "bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400 border-blue-200 dark:border-blue-800" },
  RATING: { label: "Rate", color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800" },
  IDENTIFIER: { label: "ID", color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700" },
  DEPARTMENT: { label: "Dept", color: "bg-purple-100 text-purple-700 dark:bg-purple-950/30 dark:text-purple-400 border-purple-200 dark:border-purple-800" },
  FIELD: { label: "Fld", color: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950/30 dark:text-cyan-400 border-cyan-200 dark:border-cyan-800" },
  FEEDBACK: { label: "Suvy", color: "bg-pink-100 text-pink-700 dark:bg-pink-950/30 dark:text-pink-400 border-pink-200 dark:border-pink-800" },
  COUNTRY_CODE: { label: "CC", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800" },
};

function ColumnTypeBadge({ profile }: { profile: ColumnProfile }) {
  // Priority: semantic type label > detected type label
  if (profile.semanticType && SEMANTIC_TYPE_LABELS[profile.semanticType]) {
    const sem = SEMANTIC_TYPE_LABELS[profile.semanticType];
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn("text-[8px] font-bold px-1 py-0 rounded border leading-none whitespace-nowrap", sem.color)}>
            {sem.label}
          </span>
        </TooltipTrigger>
        <TooltipContent className="text-[10px]" side="bottom">
          <div className="font-semibold">{profile.semanticType}</div>
          <div className="text-muted-foreground">{profile.uniqueCount} unique · {profile.totalCount} total · {Math.round((1 - profile.missingPct) * 100)}% filled</div>
        </TooltipContent>
      </Tooltip>
    );
  }
  const cfg = COL_TYPE_CONFIG[profile.detectedType];
  if (!cfg) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("text-[8px] font-bold px-1 py-0 rounded border leading-none whitespace-nowrap", cfg.color)}>
          {cfg.label}
        </span>
      </TooltipTrigger>
      <TooltipContent className="text-[10px]" side="bottom">
        <div className="font-semibold">{cfg.tooltip}</div>
        <div className="text-muted-foreground">{profile.uniqueCount} unique · {profile.totalCount} total · {Math.round((1 - profile.missingPct) * 100)}% filled</div>
      </TooltipContent>
    </Tooltip>
  );
}

// ── Section Header Component ────────────────────────

const SECTION_CONFIG: Record<string, {
  label: string;
  icon: typeof Database;
  color: string;
  border: string;
  bg: string;
  description: string;
}> = {
  text_cleaning: {
    label: "1. Text Cleaning",
    icon: Type,
    color: "text-sky-700 dark:text-sky-400",
    border: "border-sky-200 dark:border-sky-800",
    bg: "bg-sky-50 dark:bg-sky-950/10",
    description: "Trim whitespace, normalize casing",
  },
  null_standardization: {
    label: "2. Null Standardization",
    icon: AlertTriangle,
    color: "text-rose-700 dark:text-rose-400",
    border: "border-rose-200 dark:border-rose-800",
    bg: "bg-rose-50 dark:bg-rose-950/10",
    description: "Convert null-like values to NULL ⚠ missing_value",
  },
  numeric_normalization: {
    label: "3. Numeric Normalization",
    icon: Hash,
    color: "text-emerald-700 dark:text-emerald-400",
    border: "border-emerald-200 dark:border-emerald-800",
    bg: "bg-emerald-50 dark:bg-emerald-950/10",
    description: "Strict: unit-strip, word-to-number, typo detect, domain validate",
  },
  range_parsing: {
    label: "4. Range Parsing",
    icon: Database,
    color: "text-cyan-700 dark:text-cyan-400",
    border: "border-cyan-200 dark:border-cyan-800",
    bg: "bg-cyan-50 dark:bg-cyan-950/10",
    description: "Parse min-max ranges to average",
  },
  date_standardization: {
    label: "5. Date Standardization",
    icon: Calendar,
    color: "text-blue-700 dark:text-blue-400",
    border: "border-blue-200 dark:border-blue-800",
    bg: "bg-blue-50 dark:bg-blue-950/10",
    description: "Convert all date formats to YYYY-MM-DD",
  },
  categorical_normalization: {
    label: "6. Categorical Normalization",
    icon: Tag,
    color: "text-violet-700 dark:text-violet-400",
    border: "border-violet-200 dark:border-violet-800",
    bg: "bg-violet-50 dark:bg-violet-950/10",
    description: "Normalize formatting — no semantic change",
  },
  category_clustering: {
    label: "7. Category Clustering",
    icon: Layers,
    color: "text-amber-700 dark:text-amber-400",
    border: "border-amber-200 dark:border-amber-800",
    bg: "bg-amber-50 dark:bg-amber-950/10",
    description: "Cluster known semantic variants (m→M, yes→Yes)",
  },
  id_validation: {
    label: "8. ID Validation",
    icon: KeyRound,
    color: "text-rose-700 dark:text-rose-400",
    border: "border-rose-200 dark:border-rose-800",
    bg: "bg-rose-50 dark:bg-rose-950/10",
    description: "Ensure non-null IDs",
  },
  anomaly_detection: {
    label: "9. Anomaly Detection",
    icon: AlertOctagon,
    color: "text-red-700 dark:text-red-400",
    border: "border-red-200 dark:border-red-800",
    bg: "bg-red-50 dark:bg-red-950/10",
    description: "Flag emoji, garbage tokens, banned patterns — RED",
  },
};

function CleaningPlanSection({
  section,
  items,
  appliedSuggestions,
  onToggle,
  onApplyAll,
  onClearAll,
  collapsed,
  onToggleCollapsed,
}: {
  section: PlanSection;
  items: CleaningPlanItem[];
  appliedSuggestions: Set<string>;
  onToggle: (id: string) => void;
  onApplyAll: (ids: string[]) => void;
  onClearAll: (ids: string[]) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const config = SECTION_CONFIG[section];
  const Icon = config.icon;
  const appliedCount = items.filter((i) => appliedSuggestions.has(i.id)).length;

  if (items.length === 0) return null;

  return (
    <div className={cn("rounded-xl border-2", config.border, config.bg)}>
      {/* Section Header */}
      <button
        onClick={onToggleCollapsed}
        className="w-full flex items-center gap-3 p-4 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors rounded-t-xl"
      >
        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", config.bg, "border", config.border)}>
          <Icon className={cn("w-4 h-4", config.color)} />
        </div>
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2">
            <h3 className={cn("text-sm font-semibold", config.color)}>{config.label}</h3>
            <Badge variant="outline" className="text-[10px] font-mono">{items.length} rule{items.length !== 1 ? "s" : ""}</Badge>
            {appliedCount > 0 && (
              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 text-[10px] gap-0.5">
                <CheckCircle2 className="w-2.5 h-2.5" />
                {appliedCount}
              </Badge>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">{config.description}</p>
        </div>
        <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", collapsed ? "-rotate-90" : "")} />
      </button>

      {/* Section Content */}
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-2">
              {/* Apply/Clear buttons */}
              <div className="flex items-center gap-2 pt-1 pb-1">
                <Button variant="ghost" size="sm" onClick={() => onApplyAll(items.map((i) => i.id))} className="text-[10px] h-6 px-2">
                  Apply All
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onClearAll(items.map((i) => i.id))} className="text-[10px] h-6 px-2">
                  Clear All
                </Button>
              </div>
              {items.map((item) => (
                <CleaningPlanCard
                  key={item.id}
                  item={item}
                  isApplied={appliedSuggestions.has(item.id)}
                  onToggle={() => onToggle(item.id)}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CleaningPlanCard({ item, isApplied, onToggle }: {
  item: CleaningPlanItem;
  isApplied: boolean;
  onToggle: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasConversions = item.exampleConversions.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "rounded-lg border transition-all duration-200",
        isApplied
          ? "bg-emerald-50/80 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800"
          : "bg-card border-border hover:border-muted-foreground/30"
      )}
    >
      {/* Header */}
      <div className="flex items-start gap-3 p-3.5">
        <div className="mt-0.5 shrink-0">
          <SeverityIcon severity={item.severity} />
        </div>
        <div className="flex-1 min-w-0">
          {/* Top row: badges + column */}
          <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
            <SeverityBadge severity={item.severity} />
            <RiskBadge risk={item.riskLevel} />
            <ConfidenceBadge score={item.confidence_score} label={item.confidence_label} />
            <IssueTypeBadge issueType={item.issueType} />
            <MethodBadge method={item.method} />
            {item.columnClass && <ColumnClassBadge columnClass={item.columnClass} />}
            {item.column && (
              <Badge variant="outline" className="text-[10px] font-mono gap-1">
                <TypeIcon type={item.expectedType} />
                {item.column}
              </Badge>
            )}
            <Badge variant="outline" className="text-[9px] text-muted-foreground gap-0.5">
              <TypeIcon type={item.expectedType} />
              {item.expectedType}
            </Badge>
          </div>

          {/* Transformation description */}
          <p className="text-sm leading-relaxed">{item.transformation}</p>

          {/* Condition */}
          {item.condition && (
            <p className="text-xs text-muted-foreground mt-1.5 flex items-start gap-1.5">
              <span className="shrink-0 mt-0.5 w-3.5 h-3.5 rounded bg-muted flex items-center justify-center">
                <span className="text-[8px] font-bold text-muted-foreground">if</span>
              </span>
              <span className="italic">{item.condition}</span>
            </p>
          )}

          {/* Reason */}
          {item.reason && (
            <p className="text-xs text-muted-foreground mt-1 italic">Why: {item.reason}</p>
          )}

          {/* Suggested Actions */}
          {item.suggestedActions && item.suggestedActions.length > 0 && (
            <div className="mt-2 space-y-1">
              <div className="flex items-center gap-1.5">
                <Lightbulb className="w-3 h-3 text-amber-500 shrink-0" />
                <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                  Suggested Actions
                </span>
              </div>
              {item.suggestedActions.map((action, i) => (
                <div key={i} className="flex items-start gap-1.5 ml-4.5">
                  <span className="text-[10px] text-amber-500 mt-0.5 shrink-0">•</span>
                  <span className="text-[11px] text-muted-foreground leading-snug">{action}</span>
                </div>
              ))}
            </div>
          )}

          {/* Example conversions preview (collapsed) */}
          {hasConversions && !expanded && (
            <button
              onClick={() => setExpanded(true)}
              className="mt-2 flex items-center gap-1.5 text-[11px] text-[#f0c040] hover:text-[#e5b030] font-medium transition-colors"
            >
              <ArrowRightLeft className="w-3 h-3" />
              {item.exampleConversions.length} example conversion{item.exampleConversions.length !== 1 ? "s" : ""}
              <ChevronDown className="w-3 h-3" />
            </button>
          )}
        </div>
        <Switch
          checked={isApplied}
          onCheckedChange={onToggle}
          className="data-[state=checked]:bg-emerald-500 shrink-0 mt-0.5"
        />
      </div>

      {/* Expanded: Example Conversions */}
      <AnimatePresence>
        {expanded && hasConversions && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3.5 pb-3.5">
              <div className="border rounded-lg bg-[#1e1e2e] p-3 space-y-1.5">
                <div className="flex items-center gap-1.5 mb-2">
                  <ArrowRightLeft className="w-3 h-3 text-[#f0c040]" />
                  <span className="text-[10px] font-semibold text-[#f0c040] uppercase tracking-wider">
                    Example Conversions
                  </span>
                </div>
                {item.exampleConversions.map((conv, i) => {
                  const parts = conv.split("→").map((s) => s.trim());
                  const from = parts[0] || conv;
                  const to = parts[1] || "";
                  return (
                    <div key={i} className="flex items-center gap-2 text-xs font-mono">
                      <span className="text-rose-400 bg-rose-950/30 px-2 py-0.5 rounded max-w-[160px] truncate" title={from}>
                        {from}
                      </span>
                      <span className="text-[#666] shrink-0">→</span>
                      <span className="text-emerald-400 bg-emerald-950/30 px-2 py-0.5 rounded max-w-[160px] truncate" title={to}>
                        {to}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function FlagSeverityBadge({ severity }: { severity: FlagSeverity }) {
  const config = {
    clean: { icon: CheckCircle, label: "CLEAN", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800" },
    warning: { icon: AlertTriangle, label: "WARNING", color: "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 border-amber-200 dark:border-amber-800" },
    high_risk: { icon: AlertOctagon, label: "HIGH RISK", color: "bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400 border-orange-200 dark:border-orange-800" },
    blocked: { icon: XCircle, label: "BLOCKED", color: "bg-rose-100 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400 border-rose-200 dark:border-rose-800" },
  };
  const c = config[severity] || config.warning;
  const Icon = c.icon;
  return (
    <span className={cn("text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border flex items-center gap-1", c.color)}>
      <Icon className="w-2.5 h-2.5" />
      {c.label}
    </span>
  );
}

// ── Review Priority Scoring ──────────────────────────
// HIGH: missing critical fields, invalid values, duplicate ID, non-numeric in numeric col
// MEDIUM: fuzzy numeric, word numbers, partial range, unknown category, outlier
// LOW: formatting issues, clean conversions
function getReviewPriority(entry: import("@/lib/dashboard-types").TransformationLogEntry): "HIGH" | "MEDIUM" | "LOW" {
  const rule = entry.rule.toLowerCase();
  const severity = entry.severity;

  // HIGH priority triggers
  if (severity === "high_risk" || severity === "blocked") return "HIGH";
  if (rule.includes("missing") || rule.includes("critical_missing_id") || rule.includes("duplicate_id")) return "HIGH";
  if (rule.includes("invalid_rating") || rule.includes("invalid_numeric")) return "HIGH";
  if (rule.includes("invalid_negative") || rule.includes("non_numeric_category") || rule.includes("possible_typo") || rule.includes("invalid_date")) return "HIGH";
  if (rule.includes("type_inconsistent") || rule.includes("type_mismatch") && entry.confidence < 0.70) return "HIGH";
  if (entry.confidence < 0.50) return "HIGH";

  // MEDIUM priority triggers
  if (severity === "warning") return "MEDIUM";
  if (rule.includes("fuzzy") || rule.includes("partial_range")) return "MEDIUM";
  if (rule.includes("unknown_category") || rule.includes("malformed_id")) return "MEDIUM";
  if (rule.includes("mixed_unit") || rule.includes("reversed_range")) return "MEDIUM";
  if (rule.includes("word_number") || rule.includes("outlier") || rule.includes("frequency_inferred") || rule.includes("similarity_inferred")) return "MEDIUM";

  // LOW priority: clean conversions, formatting
  return "LOW";
}

export function CleaningPhase() {
  const {
    rawData, setRawData, columns, setColumns, replaceRawDataQuiet, userInstructions,
    cleaningReport, setCleaningReport,
    cleanedData, setCleanedData,
    setWorkflowPhase, isAnalyzing, setIsAnalyzing,
    cleaningMode, isManualReviewOpen, setIsManualReviewOpen, setCleaningMode, transformationLog, addTransformationLog, clearTransformationLog,
    userEditLayer, dataViewMode, setDataViewMode, setUserCellEdit, setAiCellValue, clearUserEditLayer, getMergedDataset,
    columnRenames,
    pushToHistory, historyStack, historyIndex,
  } = useDashboardStore();

  const [appliedSuggestions, setAppliedSuggestions] = useState<Set<string>>(new Set());
  const [cleaningPlan, setCleaningPlan] = useState<CleaningPlanItem[]>([]);
  const [stats, setStats] = useState<{ total: number; critical: number; warning: number; info: number; highRisk: number; mediumRisk: number; highConfidence: number; mediumConfidence: number; lowConfidence: number } | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [flagMap, setFlagMap] = useState<Map<string, CellFlag>>(new Map());
  // ── Per-category AI Verify state (user-triggered, NOT automatic) ──
  const [aiBannedStatus, setAiBannedStatus] = useState<"idle" | "scanning" | "done">("idle");
  const [editedCells, setEditedCells] = useState<Map<string, unknown>>(new Map());
  // currentPage removed — free Excel-like scrolling instead of pagination
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<PlanSection>>(new Set());
  const [showManualConfirm, setShowManualConfirm] = useState(false);
  const [columnRenameInput, setColumnRenameInput] = useState<Record<string, string>>({});
  const [editingColumnName, setEditingColumnName] = useState<string | null>(null);
  const [copiedReport, setCopiedReport] = useState(false);
  const [colRuleStatus, setColRuleStatus] = useState<Record<string, "idle" | "cleaning" | "done">>({});
  const [colAIStatus, setColAIStatus] = useState<Record<string, "idle" | "cleaning" | "done">>({});
  const [expandedColSummary, setExpandedColSummary] = useState<Record<string, boolean>>({});

  const [memoryStats, setMemoryStats] = useState<import("@/lib/memory-engine").MemoryStats | null>(null);
  const [showMemoryPanel, setShowMemoryPanel] = useState(false);
  const [driftAlerts, setDriftAlerts] = useState<import("@/lib/memory-engine").DriftAlert[]>([]);
  const [sanitizeEmojiOnExport, setSanitizeEmojiOnExport] = useState(true);
  const [showPlanSidebar, setShowPlanSidebar] = useState(false);

  // ROWS_PER_PAGE removed — free Excel-like scrolling

  // Ref to persist AI classification overrides from analyzeData into columnProfiles useMemo
  const aiOverridesRef = useRef<Map<string, { type: string; confidence: number }>>(new Map());
  
  // ── Virtual Scrolling Ref (must be at top level for hooks rules) ──
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  
  // ── Infinite Virtual Columns State ──
  // Store edits made to virtual columns (Excel-style infinite columns)
  const [virtualColumnEdits, setVirtualColumnEdits] = useState<Map<string, unknown>>(new Map());
  // Track which virtual column is being edited
  const [editingVirtualCell, setEditingVirtualCell] = useState<string | null>(null);
  const [virtualEditValue, setVirtualEditValue] = useState("");
  // Virtual column header renames (custom names for virtual columns)
  const [virtualColumnRenames, setVirtualColumnRenames] = useState<Map<number, string>>(new Map());
  // Track which virtual column header is being edited
  const [editingVirtualHeader, setEditingVirtualHeader] = useState<number | null>(null);
  const [virtualHeaderEditValue, setVirtualHeaderEditValue] = useState("");
  // Track hovered virtual cell for edit button display
  const [hoveredVirtualCell, setHoveredVirtualCell] = useState<string | null>(null);
  
  // Excel-like column name generator: 0=A, 1=B, ..., 25=Z, 26=AA, 27=AB, ...
  const getExcelColumnName = useCallback((index: number): string => {
    let name = "";
    let i = index;
    while (i >= 0) {
      name = String.fromCharCode(65 + (i % 26)) + name;
      i = Math.floor(i / 26) - 1;
    }
    return name;
  }, []);
  
  // Trigger to force columnProfiles useMemo to re-run after AI classification
  const [aiClassified, setAiClassified] = useState(false);
  // ── AI Cell Overlay: persists AI modifications across rule re-applications ──
  // Key: "${rowIdx}-${colName}", Value: the AI-modified value
  // This prevents the useEffect at line ~886 from wiping AI changes when rules are toggled.
  const aiCellOverlay = useRef<Map<string, { value: unknown; col: string; reason: string }>>(new Map());
  // ── AI Cleaning Lock: prevents the rule-application useEffect from overwriting AI changes ──
  // When per-column AI cleaning is in progress, the useEffect MUST NOT regenerate cleanedData.
  const aiCleaningInProgress = useRef<string | null>(null); // null = idle, string = column name being cleaned

  // ── Column profiles (MUST be before callbacks that reference them) ──
  const columnProfiles = React.useMemo(() => {
    if (columns.length === 0 || rawData.length === 0) return {} as Record<string, ColumnProfile>;
    const profiles: Record<string, ColumnProfile> = {};
    columns.forEach((colMeta) => {
      if (colMeta?.name) {
        const override = aiOverridesRef.current.get(colMeta.name);
        profiles[colMeta.name] = detectColumnProfile(colMeta, rawData, override);
      }
    });
    return profiles;
  }, [columns, rawData, aiClassified]);

  // Per-column cleaning summary for collapsible card
  const columnCleaningSummary = React.useMemo(() => {
    const summary: Record<string, { rules: CleaningRule[]; appliedCount: number; totalRules: number }> = {};
    for (const col of columns) {
      const colRules = cleaningPlan.filter((r) => r.column === col.name);
      const applied = colRules.filter((r) => appliedSuggestions.has(r.id));
      if (colRules.length > 0) {
        summary[col.name] = { rules: colRules, appliedCount: applied.length, totalRules: colRules.length };
      }
    }
    return summary;
  }, [columns, cleaningPlan, appliedSuggestions]);

  // ── Data State: resolve display data based on view mode (MUST be before virtualizer) ──
  // Defensive: cleanedData may temporarily be null/undefined during async AI scan transitions
  const displayData = useMemo(() => {
    if (dataViewMode === "raw") return Array.isArray(rawData) ? rawData : [];
    if (Array.isArray(cleanedData) && cleanedData.length > 0) return cleanedData;
    return Array.isArray(rawData) ? rawData : [];
  }, [dataViewMode, rawData, cleanedData]);

  const colKeys = useMemo(() => {
    return displayData.length > 0 ? Object.keys(displayData[0]) : [];
  }, [displayData]);

  // ── Dynamic Column Widths (based on content) ──
  // Calculate optimal width for each column based on header + content
  const columnWidths = useMemo(() => {
    const widths: Record<string, number> = {};
    const MIN_WIDTH = 60;
    const MAX_WIDTH = 300;
    const PADDING = 24; // py-1 px-2 = ~24px padding
    const CHAR_WIDTH = 8; // approximate monospace char width
    
    for (const col of colKeys) {
      // Start with header width (including badges)
      const renamed = columnRenames[col] || col;
      let maxWidth = Math.max(renamed.length * CHAR_WIDTH + 60, MIN_WIDTH); // +60 for badges
      
      // Sample first 100 rows for content width (for performance)
      const sampleSize = Math.min(displayData.length, 100);
      for (let i = 0; i < sampleSize; i++) {
        const value = displayData[i]?.[col];
        if (value != null) {
          const contentWidth = String(value).length * CHAR_WIDTH + PADDING;
          maxWidth = Math.max(maxWidth, contentWidth);
        }
      }
      
      widths[col] = Math.min(maxWidth, MAX_WIDTH);
    }
    return widths;
  }, [colKeys, displayData, columnRenames]);

  // ── Virtual Scrolling Setup ──
  // Estimate row height (matches py-1.5 = ~30px with borders)
  const ESTIMATED_ROW_HEIGHT = 32;
  
  // ── Infinite Virtual Columns (Excel-style) ──
  // 500 columns with horizontal virtualization - renders only visible columns
  const VIRTUAL_COLUMN_COUNT = 500;
  const PLACEHOLDER_COL_WIDTH = 100;
  
  // Column virtualizer for horizontal scrolling - MUST be defined before totalTableWidth
  const columnVirtualizer = useVirtualizer({
    count: VIRTUAL_COLUMN_COUNT,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => PLACEHOLDER_COL_WIDTH,
    overscan: 15, // 15 columns buffer for smooth horizontal scrolling
    horizontal: true,
  });
  
  // Virtualizer for rows - FIXED height like Excel (no gaps)
  const rowVirtualizer = useVirtualizer({
    count: displayData.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 50, // 50 rows buffer above + below viewport for smooth scrolling
    // Use fixed heights like Excel - no dynamic measurement
    measureElement: undefined,
  });
  
  // Get visible virtual columns (only those in viewport + overscan)
  const visibleVirtualColumns = useMemo(() => {
    return columnVirtualizer.getVirtualItems();
  }, [columnVirtualizer]);

  // Width of actual data columns only (for positioning virtual columns after them)
  const dataColumnsWidth = useMemo(() => {
    return colKeys.reduce((sum, col) => sum + (columnWidths[col] || 100), 0);
  }, [colKeys, columnWidths]);
  
  // Calculate total table width for horizontal scroll (dynamic widths + virtual columns)
  const totalTableWidth = useMemo(() => {
    // Row number column (w-10 = 40px) + sum of all dynamic column widths
    const dataColsWidth = colKeys.reduce((sum, col) => sum + (columnWidths[col] || 100), 0);
    // Add virtual columns width from virtualizer
    const virtualColsWidth = columnVirtualizer.getTotalSize();
    return 40 + dataColsWidth + virtualColsWidth;
  }, [colKeys, columnWidths, columnVirtualizer]);

  // Load memory stats on mount
  React.useEffect(() => {
    try {
      const stats = memoryEngine.getStats();
      setMemoryStats(stats);
    } catch { /* SSR */ }
  }, []);

  const analyzeData = useCallback(async () => {
    setIsAnalyzing(true);
    setAnalysisError(null);
    aiCellOverlay.current.clear();
    aiCleaningInProgress.current = null; // 🔓 Reset lock on new analysis
    setAiBannedStatus("idle");

    try {
      // ── Start a new memory batch for this cleaning session ──
      memoryEngine.startBatch();

      // ═══════════════════════════════════════════════════════
      // NOTE: Emoji stripping is NOT done in the initial analysis pass.
      // Emojis are only removed when cleaning a SPECIFIC column via wrench.
      // Exception: FEEDBACK/Fd type columns keep sentiment-appropriate emojis.
      // ═══════════════════════════════════════════════════════

      // Use raw data directly — no emoji stripping
      const workData = rawData;
      const workCols = columns;

      // ═══════════════════════════════════════════════════════
      // STEP 0: AI COLUMN CLASSIFICATION — send ALL headers to AI
      // AI classifies what each column actually represents (department vs field,
      // years_of_experience vs experience, location, etc.)
      // Falls back to heuristic detection if AI fails.
      // ═══════════════════════════════════════════════════════
      const aiOverrides = new Map<string, { type: string; confidence: number }>();
      try {
        const columnInfo = workCols.map((col) => ({
          name: col.name,
          sampleValues: workData
            .slice(0, 20)
            .map((row) => String(row[col.name] ?? "").trim())
            .filter((v) => v !== ""),
        }));
        const res = await fetch("/api/classify-columns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ columns: columnInfo }),
        });
        if (res.ok) {
          const data = await res.json();
          for (const r of data.results || []) {
            if (r.columnName && r.semanticType && r.semanticType !== "UNKNOWN") {
              aiOverrides.set(r.columnName, {
                type: r.semanticType,
                confidence: r.confidence || 0.7,
              });
            }
          }
          console.log("[AI Classification]", Object.fromEntries(aiOverrides));
          // Persist AI overrides to ref so columnProfiles useMemo picks them up
          aiOverridesRef.current = new Map(aiOverrides);
          setAiClassified(true);
        }
      } catch (e) {
        console.warn("[AI Classification] Failed, using heuristic detection:", e);
      }

      // Deterministic rule engine — with AI-boosted column profiles
      const profiles = workCols.map((col) => {
        const override = aiOverrides.get(col.name);
        return detectColumnProfile(col, workData, override);
      });
      const rules = generateCleaningPlan(workCols, workData, profiles);
      const planItems: CleaningPlanItem[] = rules.map((r) => ({ ...r, applied: false }));

      setCleaningPlan(planItems);
      setStats({
        total: planItems.length,
        critical: planItems.filter((p) => p.severity === "critical").length,
        warning: planItems.filter((p) => p.severity === "warning").length,
        info: planItems.filter((p) => p.severity === "info").length,
        highRisk: planItems.filter((p) => p.riskLevel === "high").length,
        mediumRisk: planItems.filter((p) => p.riskLevel === "medium").length,
        highConfidence: planItems.filter((p) => p.confidence_label === "HIGH").length,
        mediumConfidence: planItems.filter((p) => p.confidence_label === "MEDIUM").length,
        lowConfidence: planItems.filter((p) => p.confidence_label === "LOW").length,
      });

      const summary = generateSummary(profiles, planItems.length, workData.length, workData.length);
      setCleaningReport({
        summary,
        suggestions: [],
        originalRows: workData.length,
        cleanedRows: workData.length,
        isAlreadyClean: planItems.length === 0,
      });

      const { data } = cleanData(workData);
      // AUTO-LOWERCASE: For EMAIL columns, always lowercase all values immediately.
      // This ensures emails are always lowercase regardless of rule toggle state.
      const emailCols = profiles.filter((p) => p.semanticType === "EMAIL").map((p) => p.name);
      if (emailCols.length > 0) {
        for (let i = 0; i < data.length; i++) {
          for (const ec of emailCols) {
            const val = data[i][ec];
            if (val != null && typeof val === "string" && val !== val.toLowerCase()) {
              data[i] = { ...data[i], [ec]: val.toLowerCase() };
            }
          }
        }
      }
      setCleanedData(data);

      // ═══════════════════════════════════════════════════════
      // UNIVERSAL "unknown" RED FLAGGING — scan ALL cells
      // Flag "unknown" as RED in ANY column, not just geographic.
      // This runs during initial analysis so flags are visible immediately.
      // ═══════════════════════════════════════════════════════
      const unknownFlags = new Map<string, CellFlag>();
      for (let rowIdx = 0; rowIdx < workData.length; rowIdx++) {
        for (const col of workCols) {
          const val = workData[rowIdx][col.name];
          if (val == null || typeof val !== "string") continue;
          const trimmed = val.trim().toLowerCase();
          if (trimmed === "unknown" || trimmed === "unk" || trimmed === "unknown ") {
            unknownFlags.set(`${rowIdx}-${col.name}`, {
              raw: val,
              flag: "garbage_token" as const,
              confidence: 1.0,
              severity: "high_risk" as const,
              reason: `unknown_value ("${val}" — "unknown" is not a valid value in any column)`,
              suggestedValue: val,
            });
          }
        }
      }
      if (unknownFlags.size > 0) {
        setFlagMap(unknownFlags);
      }

      setAppliedSuggestions(new Set());
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Analysis failed";
      setAnalysisError(msg);
      const { data } = cleanData(workData);
      setCleanedData(data);
      setCleaningReport({
        summary: `Basic cleaning applied. ${msg}`,
        suggestions: [],
        originalRows: workData.length,
        cleanedRows: data.length,
        isAlreadyClean: workData.length === data.length,
      });
    } finally {
      setIsAnalyzing(false);
    }
  }, [rawData, columns, setIsAnalyzing, setCleaningReport, setCleanedData, setRawData, setColumns]);

  useEffect(() => {
    if (rawData.length > 0 && !cleaningReport && !isAnalyzing) {
      analyzeData();
    }
  }, [rawData, cleaningReport, isAnalyzing, analyzeData]);

  const toggleSuggestion = useCallback((id: string) => {
    setAppliedSuggestions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Apply cleaning plan to data whenever toggled items change
  // 🔒 AI LOCK CHECK: If per-column AI cleaning is in progress, DO NOT re-generate cleanedData
  // This prevents cross-column contamination when AI cleaning modifies cleanedData concurrently.
  useEffect(() => {
    if (aiCleaningInProgress.current) return; // 🔒 BLOCKED: AI cleaning running, skip rule re-application
    if (rawData.length > 0 && cleaningPlan.length > 0) {
      const profiles = columns.map((col) => detectColumnProfile(col, rawData));
      const { data, flagMap: flags, transformationLog: engineLog } = applyRules(rawData, appliedSuggestions, cleaningPlan, profiles);

      // ── CRITICAL: Re-apply AI cell overlays on top of rule-cleaned data ──
      // This prevents rule re-application from wiping previous AI modifications.
      // Each column's AI cleaning ONLY affects its own cells (isolated).
      const overlayedData = data.map((row, idx) => {
        let newRow = { ...row };
        for (const col of columns) {
          const cellKey = `${idx}-${col.name}`;
          const overlay = aiCellOverlay.current.get(cellKey);
          if (overlay && overlay.col === col.name) {
            newRow = { ...newRow, [col.name]: overlay.value };
          }
        }
        return newRow;
      });

      // ── Email auto-lowercase: always force lowercase for EMAIL columns ──
      const emailCols = profiles.filter((p) => p.semanticType === "EMAIL").map((p) => p.name);
      if (emailCols.length > 0) {
        for (let i = 0; i < overlayedData.length; i++) {
          for (const ec of emailCols) {
            const val = overlayedData[i][ec];
            if (val != null && typeof val === "string" && val !== val.toLowerCase()) {
              overlayedData[i] = { ...overlayedData[i], [ec]: val.toLowerCase() };
            }
          }
        }
      }

      setCleanedData(overlayedData);

      // ── CRITICAL: Merge AI overlay flags INTO the base rule flags ──
      // The base `flags` from applyRules only contain rule-generated flags.
      // AI/post-processor flags are stored in aiCellOverlay.current.
      // Without this merge, the useEffect would OVERWRITE all AI flags (causing "unknown" to not show RED).
      const mergedFlags = new Map(flags);
      for (const [cellKey, overlay] of aiCellOverlay.current.entries()) {
        if (!overlay.col || !overlay.reason) continue;
        const isHighRisk = overlay.reason.includes("unrecoverable") || overlay.reason.includes("RED") || overlay.reason.includes("invalid");
        const isFlagged = overlay.reason.includes("flagged") || overlay.reason.includes("anomaly");
        const rowIdx = parseInt(cellKey.split("-")[0]);
        const rawVal = rawData[rowIdx]?.[overlay.col];
        mergedFlags.set(cellKey, {
          raw: rawVal != null ? String(rawVal) : "",
          flag: isHighRisk ? "unrecoverable_location" as const : "location_standardized" as const,
          confidence: 1.0,
          severity: (isHighRisk || isFlagged) ? "high_risk" as const : "clean" as const,
          reason: overlay.reason,
        });
      }
      setFlagMap(mergedFlags);
      clearTransformationLog();
      engineLog.forEach((entry) => {
        addTransformationLog({
          id: entry.id,
          timestamp: entry.timestamp,
          column: entry.column,
          row: entry.row,
          originalValue: entry.originalValue,
          cleanedValue: entry.cleanedValue,
          rule: `${entry.stepName}: ${entry.rule}`,
          confidence: entry.confidence,
          status: entry.status,
          severity: entry.severity,
        });
      });
      // Push initial history entry when first applying rules
      if (appliedSuggestions.size > 0) {
        pushToHistory(`Applied ${appliedSuggestions.size} cleaning rule${appliedSuggestions.size !== 1 ? "s" : ""}`, "rule");
        // Record rule applications to memory for confidence tracking
        try {
          cleaningPlan.filter((r) => appliedSuggestions.has(r.id)).forEach((r) => {
            memoryEngine.recordRuleApplied(r.id, r.method, r.section, r.column, r.columnClass);
          });
          // Refresh memory stats and drift alerts
          const s = memoryEngine.getStats();
          setMemoryStats(s);
          // Fetch latest drift alerts
          const latestDrift = memoryEngine.getDriftAlerts({ unresolvedOnly: true, limit: 10 });
          setDriftAlerts(latestDrift);
        } catch { /* SSR */ }
      }
      setEditedCells(new Map());
      // currentPage reset no longer needed
    }
  }, [rawData, cleaningPlan, appliedSuggestions, columns, setCleanedData, addTransformationLog, pushToHistory]);

  // ── AI Verify Handler — banned words scan (global, user-triggered) ──
  const verifyBannedAI = useCallback(async () => {
    if (aiBannedStatus === "scanning") return;
    setAiBannedStatus("scanning");
    try {
      const profiles = columns.map((col) => detectColumnProfile(col, rawData));
      const scanColumns = profiles.filter(
        (p) => (p.detectedType === "categorical" || p.detectedType === "boolean" || p.detectedType === "text") && p.uniqueCount > 0 && p.uniqueCount <= 50
      );
      if (scanColumns.length === 0) { setAiBannedStatus("done"); return; }

      const promises = scanColumns.map(async (profile) => {
        const uniqueValues = [...new Set(
          rawData.map((r) => r[profile.name]).filter((v) => v != null && String(v).trim() !== "").map(String)
        )];
        if (uniqueValues.length === 0) return null;
        try {
          const res = await fetch("/api/anomaly-detect", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ columnName: profile.name, columnType: profile.detectedType, values: uniqueValues }),
          });
          if (!res.ok) return null;
          const json = await res.json();
          const results: Array<{ value: string; flagged: boolean; reason: string }> = json.results || [];
          const flagged = new Map<string, string>();
          for (const r of results) {
            if (r.flagged && r.reason === "banned_word") flagged.set(r.value.toLowerCase(), "banned_word");
          }
          return flagged.size > 0 ? { profile, flaggedValues: flagged } : null;
        } catch { return null; }
      });

      const scanResults = (await Promise.all(promises)).filter(Boolean);
      let totalFlagged = 0;
      for (const result of scanResults!) {
        const { profile, flaggedValues } = result;
        totalFlagged += flaggedValues.size;
        setFlagMap((prev) => {
          const next = new Map(prev);
          rawData.forEach((row, idx) => {
            const val = row[profile.name];
            if (val == null) return;
            const reason = flaggedValues.get(String(val).trim().toLowerCase());
            if (!reason) return;
            next.set(`${idx}-${profile.name}`, {
              raw: String(val), flag: "banned_word", confidence: 1.0, severity: "high_risk",
              reason: `ai_banned_word ("${val}" — AI detected: ${reason} — FLAGGED RED)`,
            });
          });
          return next;
        });
      }
      if (totalFlagged > 0) pushToHistory(`AI banned word scan: ${totalFlagged} value(s) flagged RED`, "ai");
    } catch (err) { console.error("[AI Banned Words] Failed:", err); }
    finally { setAiBannedStatus("done"); }
  }, [aiBannedStatus, columns, rawData, setFlagMap, pushToHistory]);

  // ── Phone Re-processing Helper ──
  // When geographic columns (LOCATION, REGION, COUNTRY) are cleaned via wrench,
  // phone columns should re-evaluate using the now-cleaned geographic data.
  // This reads the latest values (rawData + aiCellOverlay) to build country hints.
  const reprocessPhoneColumns = useCallback((geoColumnName: string) => {
    // Find all PHONE columns
    const phoneCols = columns.filter((c) => {
      const prof = columnProfiles[c.name];
      return prof?.semanticType === "PHONE";
    });

    if (phoneCols.length === 0) return;

    // Find geographic columns for country hints (including the just-cleaned one)
    const geoCols = columns.filter((c) => {
      const prof = columnProfiles[c.name];
      return prof?.semanticType === "LOCATION" || prof?.semanticType === "REGION" || prof?.semanticType === "COUNTRY" || prof?.semanticType === "COUNTRY_CODE";
    });

    if (geoCols.length === 0) return;

    let phoneUpdated = 0;

    for (const phoneCol of phoneCols) {
      rawData.forEach((row, idx) => {
        const phoneVal = row[phoneCol.name];
        if (phoneVal == null || typeof phoneVal !== "string") return;
        const phoneStr = phoneVal.trim();
        if (phoneStr === "" || phoneStr.startsWith("+")) return; // already has country code or empty

        // Build country hint from cleaned geographic data
        // Priority: aiCellOverlay (cleaned) > rawData
        let countryHint: string | null = null;
        for (const gc of geoCols) {
          const overlay = aiCellOverlay.current.get(`${idx}-${gc.name}`);
          const geoVal = overlay ? String(overlay.value) : (row[gc.name] != null ? String(row[gc.name]).trim() : null);
          if (geoVal && geoVal.trim() !== "") {
            countryHint = geoVal.trim();
            break;
          }
        }

        if (!countryHint) return;

        // Re-format phone number with the country hint from cleaned geographic data
        const result = formatPhoneNumber(phoneStr, countryHint);

        if (result.isValid && result.formatted !== phoneStr) {
          aiCellOverlay.current.set(`${idx}-${phoneCol.name}`, {
            value: result.formatted,
            col: phoneCol.name,
            reason: `phone_auto_updated ("${phoneStr}" → "${result.formatted}" — country hint from cleaned "${geoColumnName}": ${countryHint})`,
          });
          // Also set green flag
          setFlagMap((prev) => {
            const next = new Map(prev);
            next.set(`${idx}-${phoneCol.name}`, {
              raw: phoneStr,
              flag: "phone_formatted" as const,
              confidence: 0.92,
              severity: "clean" as const,
              reason: `phone_auto_updated ("${phoneStr}" → "${result.formatted}" — country hint from cleaned "${geoColumnName}": ${countryHint})`,
            });
            return next;
          });
          phoneUpdated++;
        }
      });
    }

    if (phoneUpdated > 0) {
      // Update cleanedData with phone changes
      setCleanedData((prev) => {
        if (!prev || prev.length === 0) return prev;
        return prev.map((row, idx) => {
          for (const phoneCol of phoneCols) {
            const overlay = aiCellOverlay.current.get(`${idx}-${phoneCol.name}`);
            if (overlay) {
              return { ...row, [phoneCol.name]: overlay.value };
            }
          }
          return row;
        });
      });
      pushToHistory(`Phone columns auto-updated: ${phoneUpdated} number(s) re-formatted using cleaned "${geoColumnName}"`, "rule");
    }
  }, [columns, columnProfiles, rawData, setCleanedData, setFlagMap, pushToHistory]);

  const applyColumnRules = useCallback((colName: string) => {
    if (colRuleStatus[colName] === "cleaning") return;

    // ═══════════════════════════════════════════════════════
    // TOGGLE: If rules already applied for this column, REVERT them
    // ═══════════════════════════════════════════════════════
    const colRules = cleaningPlan.filter((r) => r.column === colName);
    const allApplied = colRules.length > 0 && colRules.every((r) => appliedSuggestions.has(r.id));

    if (allApplied) {
      // REVERT: Remove this column's rules from applied set
      const newApplied = new Set(appliedSuggestions);
      colRules.forEach((r) => newApplied.delete(r.id));
      setAppliedSuggestions(newApplied);
      setColRuleStatus((prev) => ({ ...prev, [colName]: "idle" }));
      // Clear AI overlays for this column
      rawData.forEach((_, idx) => {
        const key = `${idx}-${colName}`;
        if (aiCellOverlay.current.has(key)) aiCellOverlay.current.delete(key);
      });
      pushToHistory(`Reverted ${colRules.length} rule(s) for column "${colName}"`, "rule");
      return;
    }

    // ═══════════════════════════════════════════════════════
    // APPLY: Add all rules for this column
    // ═══════════════════════════════════════════════════════
    const newApplied = new Set(appliedSuggestions);
    colRules.forEach((r) => newApplied.add(r.id));
    setAppliedSuggestions(newApplied);
    setColRuleStatus((prev) => ({ ...prev, [colName]: "done" }));
    if (colRules.length > 0) {
      pushToHistory(`Applied ${colRules.length} rule(s) for column "${colName}"`, "rule");
    }

    // ── Fetch column profile ONCE — needed by emoji, location, region, CC, and universal steps ──
    const profile = columnProfiles[colName];

    // ═══════════════════════════════════════════════════════
    // STEP 1.5: EMOJI HANDLING — Per-column wrench action
    // When user clicks wrench on a specific column:
    //   - FEEDBACK columns: keep sentiment-appropriate emojis, flag non-sentiment ones RED
    //   - ALL OTHER columns: strip emojis first, then proceed with other cleaning
    // ═══════════════════════════════════════════════════════
    // Check BOTH column name pattern AND semantic type for feedback detection
    const isFbCol = isFeedbackColumn(colName) || profile?.semanticType === "FEEDBACK";
    const emojiValues = rawData.map((r) => r[colName]).filter((v) => v != null && typeof v === "string" && containsEmoji(String(v))).map(String);
    const uniqueEmojiValues = [...new Set(emojiValues)];

    if (uniqueEmojiValues.length > 0 && !isFbCol) {
      // NON-FEEDBACK: Strip all emojis from values in this column
      let emojiStripped = 0;
      rawData.forEach((row, idx) => {
        const val = row[colName];
        if (val == null || typeof val !== "string") return;
        const str = String(val);
        if (!containsEmoji(str)) return;

        const cleaned = stripEmojis(str).trim();
        if (cleaned === "") return; // emoji-only → keep as-is, flagged RED elsewhere

        if (cleaned !== str) {
          aiCellOverlay.current.set(`${idx}-${colName}`, {
            value: cleaned,
            col: colName,
            reason: `emoji_stripped ("${str}" → "${cleaned}" — emojis removed during column cleaning)`,
          });
          setFlagMap((prev) => {
            const next = new Map(prev);
            next.set(`${idx}-${colName}`, {
              raw: str,
              flag: "emoji_detected" as const,
              confidence: 1.0,
              severity: "high_risk" as const,
              reason: `emoji_stripped ("${str}" → "${cleaned}" — emojis removed during column cleaning)`,
            });
            return next;
          });
          emojiStripped++;
        }
      });

      if (emojiStripped > 0) {
        setCleanedData((prev) => {
          if (!prev || prev.length === 0) return prev;
          return prev.map((row, idx) => {
            const overlay = aiCellOverlay.current.get(`${idx}-${colName}`);
            if (overlay) return { ...row, [colName]: overlay.value };
            return row;
          });
        });
        pushToHistory(`Column "${colName}": stripped emojis from ${emojiStripped} cell(s)`, "rule");
      }
    } else if (uniqueEmojiValues.length > 0 && isFbCol) {
      // FEEDBACK: Flag non-sentiment-appropriate emojis RED, keep good ones
      let badEmojiFlagged = 0;
      rawData.forEach((row, idx) => {
        const val = row[colName];
        if (val == null || typeof val !== "string") return;
        const str = String(val);
        if (!containsEmoji(str)) return;

        if (hasNonFeedbackEmoji(str)) {
          setFlagMap((prev) => {
            const next = new Map(prev);
            next.set(`${idx}-${colName}`, {
              raw: str,
              flag: "emoji_detected" as const,
              confidence: 1.0,
              severity: "high_risk" as const,
              reason: `non_feedback_emoji ("${str}" — contains non-feedback emoji(s) in feedback column)`,
            });
            return next;
          });
          badEmojiFlagged++;
        }
        // Sentiment-appropriate emojis → GREEN flag (valid in feedback)
        else {
          setFlagMap((prev) => {
            const next = new Map(prev);
            // Only set if no existing flag
            if (!prev.has(`${idx}-${colName}`)) {
              next.set(`${idx}-${colName}`, {
                raw: str,
                flag: "text_normalized" as const,
                confidence: 1.0,
                severity: "clean" as const,
                reason: `feedback_emoji_ok ("${str}" — sentiment-appropriate emoji(s) in feedback column)`,
              });
            }
            return next;
          });
        }
      });

      if (badEmojiFlagged > 0) {
        pushToHistory(`Feedback "${colName}": flagged ${badEmojiFlagged} non-sentiment emoji(s) RED`, "rule");
      }
    }

    // ═══════════════════════════════════════════════════════
    // STEP 2: LOCATION — Additional deterministic rules + AI semantic resolution
    // Rules handle: noise removal, suffix stripping, title case (via batchNormalizeLocations)
    // AI handles: abbreviation expansion (blr→Bangalore), fuzzy matching (banglore→Bangalore)
    // Both are supplementary to the standard rules applied above.
    // ═══════════════════════════════════════════════════════
    if (profile?.semanticType === "LOCATION") {
      setColRuleStatus((prev) => ({ ...prev, [colName]: "cleaning" }));
      aiCleaningInProgress.current = colName; // 🔒 BLOCK useEffect during AI call

      const allValues = [...new Set(
        rawData.map((r) => r[colName]).filter((v) => v != null && String(v).trim() !== "").map(String)
      )];

      if (allValues.length === 0) {
        setColRuleStatus((prev) => ({ ...prev, [colName]: "done" }));
        aiCleaningInProgress.current = null; // 🔓
        return;
      }

      // Batch-apply deterministic rules to all unique values
      const ruleResults = batchNormalizeLocations(allValues);

      // Apply rule results immediately to cleanedData + flagMap
      let rulesChanged = 0;
      let rulesFlagged = 0;

      rawData.forEach((row, idx) => {
        const val = row[colName];
        if (val == null) return;
        const strVal = String(val).trim();
        if (strVal === "") return;

        // ── INVALID VALUES (unknown, n/a, none) → RED_FLAG deterministically ──
        const LOCATION_INVALID = /^(?:unknown|unk|n\/a|none|nil|tbd|undefined|not\s*available|not_a_value)$/i;
        // NOTE: "na" removed from LOCATION_INVALID — it can be a legitimate abbreviation (North America)
        if (LOCATION_INVALID.test(strVal)) {
          aiCellOverlay.current.set(`${idx}-${colName}`, {
            value: strVal,
            col: colName,
            reason: `unrecoverable_location ("${strVal}" — not a valid location)`,
          });
          setFlagMap((prev) => {
            const next = new Map(prev);
            next.set(`${idx}-${colName}`, {
              raw: strVal,
              flag: "unrecoverable_location" as const,
              confidence: 1.0,
              severity: "high_risk" as const,
              reason: `unrecoverable_location ("${strVal}" — not a valid location)`,
            });
            return next;
          });
          rulesFlagged++;
          return;
        }

        const result = ruleResults.get(strVal);
        if (!result) return;

        if (result.changed && result.ruleCleaned && !result.isEmpty) {
          aiCellOverlay.current.set(`${idx}-${colName}`, {
            value: result.ruleCleaned,
            col: colName,
            reason: `location_rules ("${strVal}" → "${result.ruleCleaned}" — ${result.flags.join(", ")})`,
          });
          setFlagMap((prev) => {
            const next = new Map(prev);
            next.set(`${idx}-${colName}`, {
              raw: strVal,
              flag: "location_standardized" as const,
              confidence: 1.0,
              severity: "clean" as const,
              reason: `location_rules ("${strVal}" → "${result.ruleCleaned}" — ${result.flags.join(", ")})`,
            });
            return next;
          });
          rulesChanged++;
        }

        if (result.isEmpty) {
          setFlagMap((prev) => {
            const next = new Map(prev);
            next.set(`${idx}-${colName}`, {
              raw: strVal,
              flag: "unrecoverable_location" as const,
              confidence: 1.0,
              severity: "high_risk" as const,
              reason: `unrecoverable_location ("${strVal}" — noise/symbols only after rule cleaning)`,
            });
            return next;
          });
          rulesFlagged++;
        }
      });

      if (rulesChanged > 0 || rulesFlagged > 0) {
        setCleanedData((prev) => {
          if (!prev || prev.length === 0) return prev;
          return prev.map((row, idx) => {
            const overlay = aiCellOverlay.current.get(`${idx}-${colName}`);
            if (overlay) return { ...row, [colName]: overlay.value };
            return row;
          });
        });
      }

      // ── AI SEMANTIC RESOLUTION — ALL values sent for consistency ──
      // AI handles: abbreviation expansion, fuzzy matching (misspellings),
      //   multi-word resolution (hyd india → Hyderabad), RED_FLAG for invalids.
      // Rules already handled: noise removal, suffix stripping, title case.
      // IMPORTANT: Send ALL values, not just filtered candidates.
      //   Misspellings like "delihi", "Madird" look normal after title case
      //   but are wrong — only AI can detect and fix these.
      const aiCandidates = allValues.filter((v) => {
        const result = ruleResults.get(v);
        if (!result || result.isEmpty) return false; // skip empty/noise only
        return true; // send ALL non-empty values to AI
      });

      if (aiCandidates.length === 0) {
        // All values handled by rules alone — no AI needed
        const parts: string[] = [];
        if (rulesChanged > 0) parts.push(`${rulesChanged} rule-cleaned`);
        if (rulesFlagged > 0) parts.push(`${rulesFlagged} noise-flagged`);
        if (parts.length > 0) pushToHistory(`Location "${colName}": ${parts.join(", ")} (rules only, no AI needed)`, "rule");
        aiCleaningInProgress.current = null; // 🔓
        setColRuleStatus((prev) => ({ ...prev, [colName]: "done" }));
        setAppliedSuggestions((prev) => new Set(prev)); // trigger overlay merge
        return;
      }

      // Build pairs: original raw value → rule-cleaned value (for AI context)
      const aiPairs = aiCandidates.map((v) => ({
        original: v,
        ruleCleaned: ruleResults.get(v)?.ruleCleaned ?? v,
      }));

      fetch("/api/standardize-locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          columnName: colName,
          values: aiPairs.map((p) => p.original),
          ruleCleanedValues: aiPairs.map((p) => p.ruleCleaned),
        }),
      })
        .then((res) => res.ok ? res.json() : null)
        .then((json) => {
          if (!json) {
            const parts: string[] = [];
            if (rulesChanged > 0) parts.push(`${rulesChanged} rule-cleaned`);
            if (rulesFlagged > 0) parts.push(`${rulesFlagged} noise-flagged`);
            if (parts.length > 0) pushToHistory(`Location "${colName}": ${parts.join(", ")} (AI unavailable)`, "rule");
            return;
          }

          const results: Array<{
            original: string;
            standardized: string | null;
            wasChanged: boolean;
            confidence: number;
            reason: string;
          }> = json.results || [];

          let aiChanged = 0;
          let aiFlagged = 0;

          for (const r of results) {
            if (!r.wasChanged) continue;

            if (r.standardized === "RED_FLAG") {
              rawData.forEach((row, idx) => {
                const val = row[colName];
                if (val == null) return;
                const strVal = String(val).trim();
                if (strVal.toLowerCase() !== r.original.toLowerCase()) return;
                aiCellOverlay.current.set(`${idx}-${colName}`, {
                  value: strVal,
                  col: colName,
                  reason: `unrecoverable_location ("${strVal}" — AI RED_FLAG)`,
                });
                setFlagMap((prev) => {
                  const next = new Map(prev);
                  next.set(`${idx}-${colName}`, {
                    raw: strVal,
                    flag: "unrecoverable_location" as const,
                    confidence: 1.0,
                    severity: "high_risk" as const,
                    reason: `unrecoverable_location ("${strVal}" — AI RED_FLAG)`,
                  });
                  return next;
                });
                aiFlagged++;
              });
            } else if (r.standardized) {
              rawData.forEach((row, idx) => {
                const val = row[colName];
                if (val == null) return;
                const strVal = String(val).trim();
                if (strVal.toLowerCase() !== r.original.toLowerCase()) return;
                aiCellOverlay.current.set(`${idx}-${colName}`, {
                  value: r.standardized,
                  col: colName,
                  reason: `location_ai_semantic ("${strVal}" → "${r.standardized}" — ${r.reason})`,
                });
                setFlagMap((prev) => {
                  const next = new Map(prev);
                  next.set(`${idx}-${colName}`, {
                    raw: strVal,
                    flag: "location_standardized" as const,
                    confidence: r.confidence,
                    severity: "clean" as const,
                    reason: `location_ai_semantic ("${strVal}" → "${r.standardized}" — ${r.reason})`,
                  });
                  return next;
                });
                aiChanged++;
              });
            }
          }

          if (aiChanged > 0 || aiFlagged > 0) {
            setCleanedData((prev) => {
              if (!prev || prev.length === 0) return prev;
              return prev.map((row, idx) => {
                const overlay = aiCellOverlay.current.get(`${idx}-${colName}`);
                if (overlay) return { ...row, [colName]: overlay.value };
                return row;
              });
            });
          }

          // ═══ POST-PROCESSING — catch remaining unknown, merge duplicates, expand abbreviations ═══
          const ppActions = postProcessGeographicColumn(rawData, colName, aiCellOverlay.current, "LOCATION");
          let ppFlagged = 0;
          let ppMerged = 0;

          for (const action of ppActions) {
            for (const rowIdx of action.rowIndices) {
              if (action.type === "flag_invalid") {
                aiCellOverlay.current.set(`${rowIdx}-${colName}`, {
                  value: action.from, col: colName, reason: action.reason,
                });
                setFlagMap((prev) => {
                  const next = new Map(prev);
                  next.set(`${rowIdx}-${colName}`, {
                    raw: action.from, flag: "unrecoverable_location" as const,
                    confidence: 1.0, severity: "high_risk" as const, reason: action.reason,
                  });
                  return next;
                });
                ppFlagged++;
              } else if (action.to) {
                aiCellOverlay.current.set(`${rowIdx}-${colName}`, {
                  value: action.to, col: colName, reason: action.reason,
                });
                setFlagMap((prev) => {
                  const next = new Map(prev);
                  next.set(`${rowIdx}-${colName}`, {
                    raw: action.from, flag: "location_standardized" as const,
                    confidence: 1.0, severity: "clean" as const, reason: action.reason,
                  });
                  return next;
                });
                ppMerged++;
              }
            }
          }

          if (ppFlagged > 0 || ppMerged > 0) {
            setCleanedData((prev) => {
              if (!prev || prev.length === 0) return prev;
              return prev.map((row, idx) => {
                const overlay = aiCellOverlay.current.get(`${idx}-${colName}`);
                if (overlay) return { ...row, [colName]: overlay.value };
                return row;
              });
            });
          }

          const parts: string[] = [];
          if (rulesChanged > 0) parts.push(`${rulesChanged} rule-cleaned`);
          if (aiChanged > 0) parts.push(`${aiChanged} AI-resolved`);
          if (ppMerged > 0) parts.push(`${ppMerged} post-merged`);
          if (rulesFlagged > 0) parts.push(`${rulesFlagged} noise-flagged`);
          if (aiFlagged > 0) parts.push(`${aiFlagged} RED flagged`);
          if (ppFlagged > 0) parts.push(`${ppFlagged} post-RED`);
          if (parts.length > 0) {
            pushToHistory(`Location "${colName}": ${parts.join(", ")}`, "rule");
          }
        })
        .catch((err) => {
          console.error(`[Location AI] Failed for ${colName}:`, err);
          const parts: string[] = [];
          if (rulesChanged > 0) parts.push(`${rulesChanged} rule-cleaned`);
          if (rulesFlagged > 0) parts.push(`${rulesFlagged} noise-flagged`);
          if (parts.length > 0) pushToHistory(`Location "${colName}": ${parts.join(", ")} (AI failed)`, "rule");
        })
        .finally(() => {
          aiCleaningInProgress.current = null; // 🔓 UNLOCK — useEffect re-runs with rules + overlay
          setColRuleStatus((prev) => ({ ...prev, [colName]: "done" }));
          // Force useEffect to re-apply rules + merge aiCellOverlay
          setAppliedSuggestions((prev) => new Set(prev));
          // Auto-update phone columns using cleaned location data
          reprocessPhoneColumns(colName);
        });
    }

    // ═══════════════════════════════════════════════════════
    // STEP 3: REGION & COUNTRY — Deterministic rules + AI semantic resolution
    // Same pipeline as LOCATION: rules handle noise/suffix/title case,
    // AI handles abbreviation expansion, fuzzy matching, entity type detection.
    // ═══════════════════════════════════════════════════════
    if (profile?.semanticType === "REGION" || profile?.semanticType === "COUNTRY") {
      setColRuleStatus((prev) => ({ ...prev, [colName]: "cleaning" }));
      aiCleaningInProgress.current = colName; // 🔒 BLOCK useEffect during AI call

      const geoType = profile.semanticType; // "REGION" or "COUNTRY"
      const allValues = [...new Set(
        rawData.map((r) => r[colName]).filter((v) => v != null && String(v).trim() !== "").map(String)
      )];

      if (allValues.length === 0) {
        setColRuleStatus((prev) => ({ ...prev, [colName]: "done" }));
        aiCleaningInProgress.current = null; // 🔓
        return;
      }

      // Batch-apply deterministic rules to all unique values
      const ruleResults = batchNormalizeGeographic(allValues);

      // Apply rule results immediately to cleanedData + flagMap
      let rulesChanged = 0;
      let rulesFlagged = 0;

      rawData.forEach((row, idx) => {
        const val = row[colName];
        if (val == null) return;
        const strVal = String(val).trim();
        if (strVal === "") return;

        const result = ruleResults.get(strVal);
        if (!result) return;

        // ── INVALID VALUES (unknown, n/a, none) → RED_FLAG deterministically ──
        if (result.isInvalid) {
          aiCellOverlay.current.set(`${idx}-${colName}`, {
            value: strVal, // Keep original value
            col: colName,
            reason: `unrecoverable_geographic ("${strVal}" — known invalid value, not a valid ${geoType.toLowerCase()})`,
          });
          setFlagMap((prev) => {
            const next = new Map(prev);
            next.set(`${idx}-${colName}`, {
              raw: strVal,
              flag: "unrecoverable_location" as const,
              confidence: 1.0,
              severity: "high_risk" as const,
              reason: `unrecoverable_geographic ("${strVal}" — known invalid value, not a valid ${geoType.toLowerCase()})`,
            });
            return next;
          });
          rulesFlagged++;
          return; // Don't process further
        }

        if (result.changed && result.ruleCleaned && !result.isEmpty) {
          aiCellOverlay.current.set(`${idx}-${colName}`, {
            value: result.ruleCleaned,
            col: colName,
            reason: `geographic_rules ("${strVal}" → "${result.ruleCleaned}" — ${result.flags.join(", ")})`,
          });
          setFlagMap((prev) => {
            const next = new Map(prev);
            next.set(`${idx}-${colName}`, {
              raw: strVal,
              flag: "location_standardized" as const,
              confidence: 1.0,
              severity: "clean" as const,
              reason: `geographic_rules ("${strVal}" → "${result.ruleCleaned}" — ${result.flags.join(", ")})`,
            });
            return next;
          });
          rulesChanged++;
        }

        if (result.isEmpty) {
          setFlagMap((prev) => {
            const next = new Map(prev);
            next.set(`${idx}-${colName}`, {
              raw: strVal,
              flag: "unrecoverable_location" as const,
              confidence: 1.0,
              severity: "high_risk" as const,
              reason: `unrecoverable_geographic ("${strVal}" — noise/symbols only after rule cleaning)`,
            });
            return next;
          });
          rulesFlagged++;
        }
      });

      if (rulesChanged > 0 || rulesFlagged > 0) {
        setCleanedData((prev) => {
          if (!prev || prev.length === 0) return prev;
          return prev.map((row, idx) => {
            const overlay = aiCellOverlay.current.get(`${idx}-${colName}`);
            if (overlay) return { ...row, [colName]: overlay.value };
            return row;
          });
        });
      }

      // ── AI SEMANTIC RESOLUTION — ALL non-invalid values sent for consistency ──
      // AI handles: abbreviation expansion, fuzzy matching (misspellings),
      //   entity type detection, RED_FLAG for invalids.
      // IMPORTANT: Send ALL non-invalid values — misspellings like "Indai", "Japn", "Europ"
      //   look normal after title case but are wrong — only AI can fix these.
      // EXCLUDE: values already flagged as isInvalid (unknown, n/a, etc.) — handled above.
      const aiCandidates = allValues.filter((v) => {
        const result = ruleResults.get(v);
        if (!result || result.isEmpty) return false; // skip empty/noise only
        if (result.isInvalid) return false; // skip known invalid values — already flagged RED
        return true; // send ALL remaining values to AI
      });

      if (aiCandidates.length === 0) {
        const parts: string[] = [];
        if (rulesChanged > 0) parts.push(`${rulesChanged} rule-cleaned`);
        if (rulesFlagged > 0) parts.push(`${rulesFlagged} noise-flagged`);
        if (parts.length > 0) pushToHistory(`${geoType} "${colName}": ${parts.join(", ")} (rules only, no AI needed)`, "rule");
        aiCleaningInProgress.current = null; // 🔓
        setColRuleStatus((prev) => ({ ...prev, [colName]: "done" }));
        setAppliedSuggestions((prev) => new Set(prev));
        return;
      }

      // Build pairs: original raw value → rule-cleaned value
      const aiPairs = aiCandidates.map((v) => ({
        original: v,
        ruleCleaned: ruleResults.get(v)?.ruleCleaned ?? v,
      }));

      fetch("/api/standardize-geographic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          columnName: colName,
          semanticType: geoType,
          values: aiPairs.map((p) => p.original),
          ruleCleanedValues: aiPairs.map((p) => p.ruleCleaned),
        }),
      })
        .then((res) => res.ok ? res.json() : null)
        .then((json) => {
          if (!json) {
            const parts: string[] = [];
            if (rulesChanged > 0) parts.push(`${rulesChanged} rule-cleaned`);
            if (rulesFlagged > 0) parts.push(`${rulesFlagged} noise-flagged`);
            if (parts.length > 0) pushToHistory(`${geoType} "${colName}": ${parts.join(", ")} (AI unavailable)`, "rule");
            return;
          }

          const results: Array<{
            original: string;
            standardized: string | null;
            wasChanged: boolean;
            confidence: number;
            reason: string;
          }> = json.results || [];

          let aiChanged = 0;
          let aiFlagged = 0;

          for (const r of results) {
            if (!r.wasChanged) continue;

            if (r.standardized === "RED_FLAG") {
              rawData.forEach((row, idx) => {
                const val = row[colName];
                if (val == null) return;
                const strVal = String(val).trim();
                if (strVal.toLowerCase() !== r.original.toLowerCase()) return;
                aiCellOverlay.current.set(`${idx}-${colName}`, {
                  value: strVal,
                  col: colName,
                  reason: `unrecoverable_geographic ("${strVal}" — AI RED_FLAG)`,
                });
                setFlagMap((prev) => {
                  const next = new Map(prev);
                  next.set(`${idx}-${colName}`, {
                    raw: strVal,
                    flag: "unrecoverable_location" as const,
                    confidence: 1.0,
                    severity: "high_risk" as const,
                    reason: `unrecoverable_geographic ("${strVal}" — AI RED_FLAG)`,
                  });
                  return next;
                });
                aiFlagged++;
              });
            } else if (r.standardized) {
              rawData.forEach((row, idx) => {
                const val = row[colName];
                if (val == null) return;
                const strVal = String(val).trim();
                if (strVal.toLowerCase() !== r.original.toLowerCase()) return;
                aiCellOverlay.current.set(`${idx}-${colName}`, {
                  value: r.standardized,
                  col: colName,
                  reason: `geographic_ai_semantic ("${strVal}" → "${r.standardized}" — ${r.reason})`,
                });
                setFlagMap((prev) => {
                  const next = new Map(prev);
                  next.set(`${idx}-${colName}`, {
                    raw: strVal,
                    flag: "location_standardized" as const,
                    confidence: r.confidence,
                    severity: "clean" as const,
                    reason: `geographic_ai_semantic ("${strVal}" → "${r.standardized}" — ${r.reason})`,
                  });
                  return next;
                });
                aiChanged++;
              });
            }
          }

          if (aiChanged > 0 || aiFlagged > 0) {
            setCleanedData((prev) => {
              if (!prev || prev.length === 0) return prev;
              return prev.map((row, idx) => {
                const overlay = aiCellOverlay.current.get(`${idx}-${colName}`);
                if (overlay) return { ...row, [colName]: overlay.value };
                return row;
              });
            });
          }

          // ═══════════════════════════════════════════════════════
          // POST-PROCESSING VALIDATION — Second pass safety net
          // After rules + AI, re-scan the column to catch:
          //   - Remaining "unknown" / invalid values → flag RED
          //   - Near-duplicates (Europ + Europe) → merge to canonical
          //   - Abbreviations (NA + North America) → expand
          // ═══════════════════════════════════════════════════════
          const ppActions = postProcessGeographicColumn(rawData, colName, aiCellOverlay.current, geoType as "REGION" | "COUNTRY");
          let ppFlagged = 0;
          let ppMerged = 0;

          for (const action of ppActions) {
            for (const rowIdx of action.rowIndices) {
              if (action.type === "flag_invalid") {
                // Flag remaining invalid values RED
                aiCellOverlay.current.set(`${rowIdx}-${colName}`, {
                  value: action.from,
                  col: colName,
                  reason: action.reason,
                });
                setFlagMap((prev) => {
                  const next = new Map(prev);
                  next.set(`${rowIdx}-${colName}`, {
                    raw: action.from,
                    flag: "unrecoverable_location" as const,
                    confidence: 1.0,
                    severity: "high_risk" as const,
                    reason: action.reason,
                  });
                  return next;
                });
                ppFlagged++;
              } else if (action.to) {
                // Merge duplicate or expand abbreviation
                aiCellOverlay.current.set(`${rowIdx}-${colName}`, {
                  value: action.to,
                  col: colName,
                  reason: action.reason,
                });
                setFlagMap((prev) => {
                  const next = new Map(prev);
                  next.set(`${rowIdx}-${colName}`, {
                    raw: action.from,
                    flag: "location_standardized" as const,
                    confidence: 1.0,
                    severity: "clean" as const,
                    reason: action.reason,
                  });
                  return next;
                });
                ppMerged++;
              }
            }
          }

          if (ppFlagged > 0 || ppMerged > 0) {
            setCleanedData((prev) => {
              if (!prev || prev.length === 0) return prev;
              return prev.map((row, idx) => {
                const overlay = aiCellOverlay.current.get(`${idx}-${colName}`);
                if (overlay) return { ...row, [colName]: overlay.value };
                return row;
              });
            });
          }

          const parts: string[] = [];
          if (rulesChanged > 0) parts.push(`${rulesChanged} rule-cleaned`);
          if (aiChanged > 0) parts.push(`${aiChanged} AI-resolved`);
          if (ppMerged > 0) parts.push(`${ppMerged} post-merged`);
          if (rulesFlagged > 0) parts.push(`${rulesFlagged} noise-flagged`);
          if (aiFlagged > 0) parts.push(`${aiFlagged} RED flagged`);
          if (ppFlagged > 0) parts.push(`${ppFlagged} post-RED`);
          if (parts.length > 0) {
            pushToHistory(`${geoType} "${colName}": ${parts.join(", ")}`, "rule");
          }
        })
        .catch((err) => {
          console.error(`[Geographic AI] Failed for ${colName}:`, err);
          const parts: string[] = [];
          if (rulesChanged > 0) parts.push(`${rulesChanged} rule-cleaned`);
          if (rulesFlagged > 0) parts.push(`${rulesFlagged} noise-flagged`);
          if (parts.length > 0) pushToHistory(`${geoType} "${colName}": ${parts.join(", ")} (AI failed)`, "rule");
        })
        .finally(() => {
          aiCleaningInProgress.current = null; // 🔓 UNLOCK
          setColRuleStatus((prev) => ({ ...prev, [colName]: "done" }));
          setAppliedSuggestions((prev) => new Set(prev));
          // Auto-update phone columns using cleaned region/country data
          reprocessPhoneColumns(colName);
        });
    }

    // ═══════════════════════════════════════════════════════
    // STEP 3.5: COUNTRY_CODE — AI semantic resolution
    // If values are city names, state names, or country names,
    // resolve them to ISO 3166-1 alpha-2 codes (2 uppercase letters).
    // Already-valid ISO codes → unchanged. Unresolvable → RED_FLAG.
    // ═══════════════════════════════════════════════════════
    if (profile?.semanticType === "COUNTRY_CODE") {
      setColRuleStatus((prev) => ({ ...prev, [colName]: "cleaning" }));
      aiCleaningInProgress.current = colName;

      const allValues = [...new Set(
        rawData.map((r) => r[colName]).filter((v) => v != null && String(v).trim() !== "").map(String)
      )];

      if (allValues.length === 0) {
        setColRuleStatus((prev) => ({ ...prev, [colName]: "done" }));
        aiCleaningInProgress.current = null;
        return;
      }

      fetch("/api/resolve-country-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          columnName: colName,
          values: allValues,
        }),
      })
        .then((res) => res.ok ? res.json() : null)
        .then((json) => {
          if (!json || !json.results || json.results.length === 0) {
            setColRuleStatus((prev) => ({ ...prev, [colName]: "done" }));
            aiCleaningInProgress.current = null;
            return;
          }

          const results: Array<{
            original: string;
            resolved: string | null;
            wasChanged: boolean;
            confidence: number;
            reason: string;
          }> = json.results;

          let aiResolved = 0;
          let aiFlagged = 0;

          for (const r of results) {
            if (!r.wasChanged && r.resolved !== "RED_FLAG") continue;

            rawData.forEach((row, idx) => {
              const val = row[colName];
              if (val == null) return;
              const strVal = String(val).trim();
              if (strVal.toLowerCase() !== r.original.toLowerCase()) return;

              if (r.resolved === "RED_FLAG") {
                aiCellOverlay.current.set(`${idx}-${colName}`, {
                  value: strVal, // keep original
                  col: colName,
                  reason: `invalid_country_code ("${strVal}" — cannot resolve to ISO 3166-1 alpha-2)`,
                });
                setFlagMap((prev) => {
                  const next = new Map(prev);
                  next.set(`${idx}-${colName}`, {
                    raw: strVal,
                    flag: "garbage_token" as const,
                    confidence: 1.0,
                    severity: "high_risk" as const,
                    reason: `invalid_country_code ("${strVal}" — cannot resolve to ISO 3166-1 alpha-2)`,
                  });
                  return next;
                });
                aiFlagged++;
              } else if (r.resolved && r.wasChanged) {
                aiCellOverlay.current.set(`${idx}-${colName}`, {
                  value: r.resolved,
                  col: colName,
                  reason: `country_code_resolved ("${strVal}" → "${r.resolved}" — ${r.reason})`,
                });
                setFlagMap((prev) => {
                  const next = new Map(prev);
                  next.set(`${idx}-${colName}`, {
                    raw: strVal,
                    flag: "country_code_validated" as const,
                    confidence: r.confidence,
                    severity: "clean" as const,
                    reason: `country_code_resolved ("${strVal}" → "${r.resolved}" — ${r.reason})`,
                  });
                  return next;
                });
                aiResolved++;
              }
            });
          }

          if (aiResolved > 0 || aiFlagged > 0) {
            setCleanedData((prev) => {
              if (!prev || prev.length === 0) return prev;
              return prev.map((row, idx) => {
                const overlay = aiCellOverlay.current.get(`${idx}-${colName}`);
                if (overlay) return { ...row, [colName]: overlay.value };
                return row;
              });
            });
          }

          if (aiResolved > 0 || aiFlagged > 0) {
            const parts: string[] = [];
            if (aiResolved > 0) parts.push(`${aiResolved} resolved to ISO codes`);
            if (aiFlagged > 0) parts.push(`${aiFlagged} RED flagged`);
            pushToHistory(`Country Code "${colName}": ${parts.join(", ")}`, "rule");
          }
        })
        .catch((err) => {
          console.error(`[Country Code AI] Failed for ${colName}:`, err);
          pushToHistory(`Country Code "${colName}": AI resolution failed`, "rule");
        })
        .finally(() => {
          aiCleaningInProgress.current = null;
          setColRuleStatus((prev) => ({ ...prev, [colName]: "done" }));
          setAppliedSuggestions((prev) => new Set(prev));
          // Auto-update phone columns using resolved country codes
          reprocessPhoneColumns(colName);
        });
    }

    // ═══════════════════════════════════════════════════════
    // STEP 4: UNIVERSAL AI NORMALIZATION — for any text/categorical column
    // Uses the universal normalize-values API with dynamic type detection.
    // Handles: PRODUCT, STATUS, CATEGORY, and any unseen domain.
    // Only runs for columns NOT already handled by dedicated normalizers above.
    // ═══════════════════════════════════════════════════════
    // FEEDBACK: has dedicated emoji-only handling above (STEP 1.5). No text normalization.
    // COUNTRY_CODE: handled above (STEP 3.5).
    const SKIP_TYPES = new Set(["LOCATION", "REGION", "COUNTRY", "EMAIL", "PHONE", "FULL_NAME", "LAST_NAME", "FIRST_NAME", "USERNAME", "MONEY", "PERCENTAGE", "DATE", "RATING", "EXPERIENCE", "AGE", "FEEDBACK", "COUNTRY_CODE"]);
    if (profile?.semanticType && !SKIP_TYPES.has(profile.semanticType)) {
      setColRuleStatus((prev) => ({ ...prev, [colName]: "cleaning" }));
      aiCleaningInProgress.current = colName;

      const allValues = [...new Set(
        rawData.map((r) => r[colName]).filter((v) => v != null && String(v).trim() !== "").map(String)
      )];

      if (allValues.length === 0) {
        setColRuleStatus((prev) => ({ ...prev, [colName]: "done" }));
        aiCleaningInProgress.current = null;
        return;
      }

      fetch("/api/normalize-values", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          columnName: colName,
          values: allValues,
          semanticType: profile.semanticType,
        }),
      })
        .then((res) => res.ok ? res.json() : null)
        .then((json) => {
          if (!json) return;

          const results: Array<{
            original: string;
            normalized: string | null;
            wasChanged: boolean;
            confidence: number;
            reason: string;
          }> = json.results || [];

          let changed = 0;
          let flagged = 0;

          for (const r of results) {
            if (!r.wasChanged) continue;

            if (r.normalized === "RED_FLAG") {
              rawData.forEach((row, idx) => {
                const val = row[colName];
                if (val == null) return;
                const strVal = String(val).trim();
                if (strVal.toLowerCase() !== r.original.toLowerCase()) return;
                aiCellOverlay.current.set(`${idx}-${colName}`, {
                  value: strVal,
                  col: colName,
                  reason: `unrecoverable_value ("${strVal}" — AI RED_FLAG)`,
                });
                setFlagMap((prev) => {
                  const next = new Map(prev);
                  next.set(`${idx}-${colName}`, {
                    raw: strVal,
                    flag: "unrecoverable_location" as const,
                    confidence: 1.0,
                    severity: "high_risk" as const,
                    reason: `unrecoverable_value ("${strVal}" — AI RED_FLAG: ${r.reason})`,
                  });
                  return next;
                });
                flagged++;
              });
            } else if (r.normalized) {
              rawData.forEach((row, idx) => {
                const val = row[colName];
                if (val == null) return;
                const strVal = String(val).trim();
                if (strVal.toLowerCase() !== r.original.toLowerCase()) return;
                aiCellOverlay.current.set(`${idx}-${colName}`, {
                  value: r.normalized,
                  col: colName,
                  reason: `universal_ai_normalized ("${strVal}" → "${r.normalized}" — ${r.reason})`,
                });
                setFlagMap((prev) => {
                  const next = new Map(prev);
                  next.set(`${idx}-${colName}`, {
                    raw: strVal,
                    flag: "text_normalized" as const,
                    confidence: r.confidence,
                    severity: "clean" as const,
                    reason: `universal_ai_normalized ("${strVal}" → "${r.normalized}" — ${r.reason})`,
                  });
                  return next;
                });
                changed++;
              });
            }
          }

          if (changed > 0 || flagged > 0) {
            setCleanedData((prev) => {
              if (!prev || prev.length === 0) return prev;
              return prev.map((row, idx) => {
                const overlay = aiCellOverlay.current.get(`${idx}-${colName}`);
                if (overlay) return { ...row, [colName]: overlay.value };
                return row;
              });
            });
          }

          const parts: string[] = [];
          if (changed > 0) parts.push(`${changed} AI-normalized`);
          if (flagged > 0) parts.push(`${flagged} RED flagged`);
          if (parts.length > 0) {
            pushToHistory(`Universal AI "${colName}": ${parts.join(", ")}`, "ai");
          }
        })
        .catch((err) => {
          console.error(`[Universal AI] Failed for ${colName}:`, err);
        })
        .finally(() => {
          aiCleaningInProgress.current = null;
          setColRuleStatus((prev) => ({ ...prev, [colName]: "done" }));
          setAppliedSuggestions((prev) => new Set(prev));
        });
    }
  }, [cleaningPlan, appliedSuggestions, columnProfiles, rawData, pushToHistory, setCleanedData, setFlagMap]);

  // ════════════════════════════════════════════════════════════════════════
  // PER-COLUMN AI CLEANING — overlay-aware, isolated to ONE column only
  // ════════════════════════════════════════════════════════════════════════
  // Each call:
  //   1. Sets aiCleaningInProgress lock → blocks rule useEffect
  //   2. Reads ONLY this column's values from rawData
  //   3. Sends ONLY this column's values to the AI API
  //   4. Stores results in aiCellOverlay ref (survives rule re-applications)
  //   5. Updates cleanedData for ONLY this column
  //   6. Clears lock → rule useEffect can resume
  //   → ABSOLUTELY NO cross-column contamination possible
  // ════════════════════════════════════════════════════════════════════════

  const applyColumnAI = useCallback(async (colName: string) => {
    if (colAIStatus[colName] === "cleaning") return;
    if (aiCleaningInProgress.current) return; // another column is being cleaned
    const profile = columnProfiles[colName];
    if (!profile) return;
    aiCleaningInProgress.current = colName; // 🔒 LOCK: block rule useEffect
    setColAIStatus((prev) => ({ ...prev, [colName]: "cleaning" }));

    try {
      const semType = profile.semanticType;
      // ── Collect ONLY this column's unique values ──
      const allValues = [...new Set(
        rawData.map((r) => r[colName]).filter((v) => v != null && String(v).trim() !== "").map(String)
      )];
      if (allValues.length === 0) {
        aiCleaningInProgress.current = null; // 🔓 UNLOCK
        setColAIStatus((prev) => ({ ...prev, [colName]: "done" }));
        return;
      }

      // NOTE: LOCATION handled by wrench (applyColumnRules), not brain.
      // NOTE: MONEY/SALARY and PHONE have NO AI — rules only. Brain button hidden for all.
    } catch (err) {
      console.error(`[Column AI Clean] Failed for ${colName}:`, err);
    } finally {
      aiCleaningInProgress.current = null; // 🔓 UNLOCK
      setColAIStatus((prev) => ({ ...prev, [colName]: "done" }));
    }
  }, [columnProfiles, rawData, colAIStatus, setCleanedData, pushToHistory]);

  const applyAll = useCallback(() => {
    const allIds = cleaningPlan.map((item) => item.id);
    setAppliedSuggestions(new Set(allIds));
  }, [cleaningPlan]);

  const clearAll = useCallback(() => {
    setAppliedSuggestions(new Set());
  }, []);

  const applySection = useCallback((ids: string[]) => {
    setAppliedSuggestions((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  const clearSection = useCallback((ids: string[]) => {
    setAppliedSuggestions((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }, []);

  const toggleSectionCollapsed = useCallback((section: PlanSection) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }, []);



  // ── Cell Editing Handlers ──
  const startEditing = useCallback((cellKey: string, currentValue: unknown) => {
    setEditingCell(cellKey);
    setEditValue(currentValue == null ? "" : String(currentValue));
  }, []);

  const confirmEdit = useCallback(() => {
    if (!editingCell) return;
    const [rowStr, col] = editingCell.split("-");
    const rowIdx = parseInt(rowStr, 10);
    const numVal = Number(editValue);
    const finalVal = editValue === "" ? null : (!isNaN(numVal) && editValue.trim() !== "" ? numVal : editValue);

    // Determine AI value and conflict status
    const aiValue = userEditLayer[editingCell]?.aiValue ?? null;
    const hasConflict = aiValue !== null && aiValue !== finalVal;

    // ── LAYER 3: Learn from user correction ──
    // If the user changed a value that the engine also changed, learn from it
    const originalVal = rawData[rowIdx]?.[col];
    if (originalVal != null && finalVal != null && String(originalVal) !== String(finalVal)) {
      try {
        memoryEngine.recordUserCorrection(col, String(originalVal), String(finalVal));
      } catch {
        // Memory engine may fail in SSR
      }
    }

    // ── LAYER 3: Track mapping rejection ──
    // If user reverted an AI change (set value back to original), record rejection
    if (hasConflict && aiValue !== null && String(finalVal) === String(originalVal)) {
      try {
        memoryEngine.recordMappingRejected(col, String(originalVal), String(aiValue));
      } catch { /* SSR */ }
    }

    setUserCellEdit(editingCell, {
      source: "USER",
      lastModifiedBy: "USER",
      timestamp: Date.now(),
      originalRawValue: originalVal ?? null,
      aiValue,
      userValue: finalVal,
      hasConflict,
      conflictResolvedBy: hasConflict ? "USER" : null,
    });

    setEditingCell(null);
    setEditValue("");
  }, [editingCell, editValue, rawData, userEditLayer, setUserCellEdit]);

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
    setEditValue("");
  }, []);

  const saveFinalDataset = useCallback(() => {
    if (cleanedData.length === 0) return;
    // Apply user edits on top of cleaned data
    const finalData = cleanedData.map((row, rowIdx) => {
      const newRow = { ...row };
      Object.keys(row).forEach((col) => {
        const cellKey = `${rowIdx}-${col}`;
        if (editedCells.has(cellKey)) {
          newRow[col] = editedCells.get(cellKey);
        }
      });
      return newRow;
    });
    setCleanedData(finalData);
    // Log user edits to transformation log
    editedCells.forEach((val, key) => {
      const [rowStr, col] = key.split("-");
      const rowIdx = parseInt(rowStr, 10);
      const originalVal = cleanedData[rowIdx]?.[col];
      if (originalVal !== undefined) {
        addTransformationLog({
          id: `log-${Date.now()}-${key}`,
          timestamp: Date.now(),
          column: col,
          row: rowIdx,
          originalValue: originalVal,
          cleanedValue: val,
          rule: "manual_edit",
          confidence: 1.0,
          status: "manual_edit",
          severity: "clean",
        });
      }
    });
    setFlagMap(new Map()); // Clear all flags — user confirmed
    setEditedCells(new Map());
  }, [cleanedData, editedCells, setCleanedData, addTransformationLog]);

  const getCellValue = useCallback((rowIdx: number, col: string, baseValue: unknown) => {
    const cellKey = `${rowIdx}-${col}`;
    return editedCells.has(cellKey) ? editedCells.get(cellKey) : baseValue;
  }, [editedCells]);

  const handleColumnRename = useCallback((oldName: string, newName: string) => {
    if (!newName.trim() || newName === oldName) {
      setEditingColumnName(null);
      return;
    }
    const { renameColumn } = useDashboardStore.getState();
    renameColumn(oldName, newName.trim());
    setEditingColumnName(null);
    setColumnRenameInput((prev) => ({ ...prev, [oldName]: "" }));
    // Log to transformation log
    const { addTransformationLog } = useDashboardStore.getState();
    addTransformationLog({
      id: `log-${Date.now()}-rename-${oldName}`,
      timestamp: Date.now(),
      column: oldName,
      cleanedValue: newName.trim(),
      rule: "rename_column",
      confidence: 1.0,
      status: "manual_edit",
      severity: "clean",
    });
  }, []);

  const exportData = useCallback((format: "csv" | "xlsx", sanitizeEmoji: boolean = true) => {
    const sourceData = cleanedData.length > 0 ? cleanedData : rawData;
    if (sourceData.length === 0) return;

    // AI Semantic Emoji Sanitization: convert emojis → text BEFORE export
    let dataToExport: Record<string, unknown>[];
    let emojiStats = null;

    if (sanitizeEmoji) {
      const emojiCount = countEmojisInDataset(sourceData);
      if (emojiCount.total > 0) {
        const result = sanitizeDatasetForExport(sourceData, { mode: "semantic" });
        dataToExport = result.sanitizedData;
        emojiStats = { total: emojiCount.total, converted: result.totalConversions, columns: result.summary, affectedRows: emojiCount.affectedRows };
      } else {
        dataToExport = sourceData;
      }
    } else {
      dataToExport = sourceData;
    }

    const headers = Object.keys(dataToExport[0]);

    if (format === "csv") {
      const csvContent = [
        headers.join(","),
        ...dataToExport.map((row) =>
          headers.map((h) => {
            const val = row[h];
            if (val == null) return "";
            const str = String(val);
            return str.includes(",") || str.includes('"') || str.includes("\n")
              ? `"${str.replace(/"/g, '""')}"`
              : str;
          }).join(",")
        ),
      ].join("\n");

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "cleaned_data.csv";
      link.click();
      URL.revokeObjectURL(link.href);
    } else {
      import("xlsx").then((XLSX) => {
        const ws = XLSX.utils.json_to_sheet(dataToExport);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Cleaned Data");
        XLSX.writeFile(wb, "cleaned_data.xlsx");
      }).catch(console.error);
    }

    // Show toast notification about emoji sanitization
    if (emojiStats && emojiStats.total > 0) {
      // Brief visual feedback via console (UI toast can be added)
      console.log(`[Export] AI Emoji Sanitization: ${emojiStats.converted} emojis converted across ${emojiStats.affectedRows} rows in columns: ${Object.keys(emojiStats.columns).join(", ")}`);
    }
  }, [cleanedData, rawData]);

  const handleNext = useCallback(() => {
    setWorkflowPhase("pivot");
  }, [setWorkflowPhase]);

  const handleSkip = useCallback(() => {
    if (cleanedData.length === 0) {
      const { data } = cleanData(rawData);
      setCleanedData(data);
    }
    setWorkflowPhase("dashboard");
  }, [cleanedData, rawData, setCleanedData, setWorkflowPhase]);

  const handleManualReview = useCallback(() => {
    if (!cleaningReport || appliedSuggestions.size === 0) {
      setShowManualConfirm(true);
      return;
    }
    setIsManualReviewOpen(true);
    setCleaningMode("manual");
  }, [cleaningReport, appliedSuggestions.size, setIsManualReviewOpen, setCleaningMode]);

  const handleManualConfirmContinue = useCallback(() => {
    setShowManualConfirm(false);
    setIsManualReviewOpen(true);
    setCleaningMode("manual");
  }, [setIsManualReviewOpen, setCleaningMode]);

  // ── Undo / Redo / History Handlers ──
  const handleUndo = useCallback(() => {
    const store = useDashboardStore.getState();
    const result = store.undo();
    if (result) {
      setCleanedData(result.data);
      setFlagMap(result.flagMap);
      useDashboardStore.setState({ historyIndex: store.historyIndex - 1 });
    }
  }, [setCleanedData]);

  const handleRedo = useCallback(() => {
    const store = useDashboardStore.getState();
    const result = store.redo();
    if (result) {
      setCleanedData(result.data);
      setFlagMap(result.flagMap);
      useDashboardStore.setState({ historyIndex: store.historyIndex + 1 });
    }
  }, [setCleanedData]);

  const handleGoToHistory = useCallback((index: number) => {
    const store = useDashboardStore.getState();
    const result = store.goToHistory(index);
    if (result) {
      setCleanedData(result.data);
      setFlagMap(result.flagMap);
      useDashboardStore.setState({ historyIndex: index });
    }
  }, [setCleanedData]);

  // (columnProfiles and columnCleaningSummary moved above — before callbacks that reference them)

    if (isAnalyzing) {
    return (
      <div className="w-full max-w-3xl mx-auto flex flex-col items-center justify-center py-20 gap-4">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
        >
          <Sparkles className="w-12 h-12 text-[#f0c040]" />
        </motion.div>
        <div className="text-center space-y-2">
          <h2 className="text-xl font-semibold">Analyzing Your Data...</h2>
          <p className="text-sm text-muted-foreground">Running deterministic rule engine: schema detection, 10-step cleaning pipeline, and integrity checks.</p>
        </div>
      </div>
    );
  }

  if (!cleaningReport) return null;

  // Engine provides correct sections — no fallback needed
  const classifiedPlan = cleaningPlan;

  const isClean = cleaningReport.isAlreadyClean;
  const hasPlan = cleaningPlan.length > 0;
  const appliedCount = appliedSuggestions.size;
  const isLivePreview = appliedCount > 0 && hasPlan;
  const totalFlags = flagMap.size;
  const hasFlags = totalFlags > 0;
  const hasEdits = editedCells.size > 0;

  // displayData and colKeys are computed above (before early return)
  const totalRows = displayData.length;

  // Flag color by type
  const flagColorMap: Record<string, string> = {
    fuzzy_match: "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800",
    fuzzy_number: "bg-yellow-50 border-yellow-300 dark:bg-yellow-950/30 dark:border-yellow-700",
    mixed_unit: "bg-orange-50 border-orange-200 dark:bg-orange-950/30 dark:border-orange-800",
    non_numeric: "bg-rose-50 border-rose-200 dark:bg-rose-950/30 dark:border-rose-800",
    invalid_numeric: "bg-rose-100 border-rose-300 dark:bg-rose-950/30 dark:border-rose-700",
    ambiguous_number: "bg-amber-50 border-amber-300 dark:bg-amber-950/30 dark:border-amber-700",
    ambiguous_date: "bg-yellow-50 border-yellow-200 dark:bg-yellow-950/30 dark:border-yellow-800",
    low_confidence: "bg-yellow-50 border-yellow-200 dark:bg-yellow-950/30 dark:border-yellow-800",
    reversed_range: "bg-cyan-50 border-cyan-200 dark:bg-cyan-950/30 dark:border-cyan-800",
    partial_range: "bg-rose-50 border-rose-300 dark:bg-rose-950/30 dark:border-rose-700",
    typo_uncertain: "bg-orange-100 border-orange-300 dark:bg-orange-950/30 dark:border-orange-700",
    invalid_rating: "bg-orange-50 border-orange-200 dark:bg-orange-950/30 dark:border-orange-800",
    unknown_category: "bg-violet-50 border-violet-200 dark:bg-violet-950/30 dark:border-violet-800",
    duplicate_id: "bg-rose-50 border-rose-200 dark:bg-rose-950/30 dark:border-rose-800",
    malformed_id: "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800",
    type_inconsistent: "bg-slate-50 border-slate-200 dark:bg-slate-950/30 dark:border-slate-800",
    critical_missing_id: "bg-rose-100 border-rose-300 dark:bg-rose-950/30 dark:border-rose-700",
    missing_value: "bg-rose-50 border-rose-200 dark:bg-rose-950/30 dark:border-rose-800",
    possible_typo: "bg-orange-100 border-orange-300 dark:bg-orange-950/30 dark:border-orange-700",
    word_number: "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800",
    non_numeric_category: "bg-rose-50 border-rose-300 dark:bg-rose-950/30 dark:border-rose-700",
    invalid_negative: "bg-rose-100 border-rose-300 dark:bg-rose-950/30 dark:border-rose-700",
    invalid_date: "bg-rose-100 border-rose-300 dark:bg-rose-950/30 dark:border-rose-700",
    outlier: "bg-orange-50 border-orange-200 dark:bg-orange-950/30 dark:border-orange-800",
    single_value_range: "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800",
    frequency_inferred: "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800",
    similarity_inferred: "bg-purple-50 border-purple-200 dark:bg-purple-950/30 dark:border-purple-800",
    canonical_mapped: "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800",
    text_trimmed: "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800",
    text_normalized: "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800",
    date_standardized: "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800",
    ai_anomaly_fix: "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800",
    ai_anomaly_flagged: "bg-violet-50 border-violet-200 dark:bg-violet-950/30 dark:border-violet-800",
    ai_anomaly_blocked: "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800",
    emoji_detected: "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800",
    garbage_token: "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800",
    banned_word: "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800",
    invalid_email: "bg-fuchsia-50 border-fuchsia-200 dark:bg-fuchsia-950/30 dark:border-fuchsia-800",
    invalid_phone: "bg-indigo-50 border-indigo-200 dark:bg-indigo-950/30 dark:border-indigo-800",
    phone_formatted: "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800",
    salary_parsed: "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800",
    salary_needs_ai: "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800",
    invalid_salary: "bg-rose-50 border-rose-200 dark:bg-rose-950/30 dark:border-rose-800",
    invalid_name: "bg-rose-50 border-rose-200 dark:bg-rose-950/30 dark:border-rose-800",
  };

  // Legacy severity map — kept for reference but NOT used for cell rendering
  // Cell rendering now uses the 3-color system exclusively (green/yellow/red)
  // severityColorMap is only used for the transformation log, not for cell borders

  // ── 3-COLOR FLAG SYSTEM ──
  // 🟢 GREEN ! = value was changed/fixed successfully (AI fixed it)
  // 🟡 YELLOW ! = value was converted to NULL (missing data)
  // 🔴 RED ! = value NOT changed, needs manual attention
  //
  // Decision logic:
  //   1. severity === "clean" → GREEN (engine confirms value was changed)
  //   2. flag === "missing_value" → YELLOW (NULL conversion, neutral)
  //   3. flag in GREEN_FLAGS → GREEN (value was converted even if flagged for review)
  //   4. Everything else → RED (unknown, invalid, needs manual attention)
  const GREEN_FLAGS = new Set(["word_number", "mixed_unit", "reversed_range", "frequency_inferred", "similarity_inferred", "single_value_range", "ambiguous_date", "ambiguous_number", "canonical_mapped", "text_trimmed", "text_normalized", "date_standardized", "ai_anomaly_fix", "phone_formatted", "salary_parsed", "ai_salary_parsed", "location_standardized"]);
  const RED_FLAGS = new Set(["emoji_detected", "garbage_token", "banned_word", "ai_anomaly_blocked", "invalid_rating", "invalid_numeric", "duplicate_id", "invalid_phone", "invalid_salary", "unrecoverable_location"]);
  const YELLOW_FLAGS = new Set(["missing_value", "partial_full_name", "email_fixed", "salary_needs_ai", "ai_salary_null"]);

  function getFlagColor(flag: { flag: string; severity: string }): "green" | "yellow" | "red" {
    // 1. RED flags — always RED regardless of severity (emoji, banned, garbage)
    if (RED_FLAGS.has(flag.flag)) return "red";
    if (flag.severity === "high_risk" || flag.severity === "blocked") return "red";
    // 2. Clean severity = value was successfully changed → GREEN
    if (flag.severity === "clean") return "green";
    // 3. NULL conversion = missing data → YELLOW
    if (YELLOW_FLAGS.has(flag.flag)) return "yellow";
    // 4. Known transformation types = value was changed → GREEN
    if (GREEN_FLAGS.has(flag.flag)) return "green";
    // 5. Everything else (invalid, unknown, needs attention) → RED
    return "red";
  }

  const FLAG_INDICATOR_STYLES = {
    green: "bg-emerald-500 text-white",
    yellow: "bg-yellow-400 text-yellow-900",
    red: "bg-rose-500 text-white",
  };

  const FLAG_BORDER_STYLES = {
    green: "bg-emerald-50/70 dark:bg-emerald-950/20",
    yellow: "bg-yellow-50/70 dark:bg-yellow-950/20",
    red: "bg-rose-50/70 dark:bg-rose-950/20",
  };

  return (
    <div className="w-full flex flex-col h-[calc(100vh-120px)]">
      {/* Error Retry Banner */}
      {analysisError && (
        <Card className="border-2 border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/10">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Analysis Incomplete</p>
              <p className="text-xs text-muted-foreground mt-0.5">{analysisError}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCleaningReport(null);
                setCleaningPlan([]);
                setStats(null);
                analyzeData();
              }}
              className="shrink-0 gap-1.5 text-xs"
            >
              <RotateCcw className="w-3 h-3" />
              Retry Analysis
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Sticky Top Bar ── */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b px-4 py-2 flex items-center gap-3">
        <button
          onClick={() => setShowPlanSidebar(!showPlanSidebar)}
          className="p-1.5 rounded-md hover:bg-muted transition-colors"
          title="Toggle cleaning plan sidebar"
        >
          <Menu className="w-4 h-4" />
        </button>
        <h1 className="text-sm font-semibold whitespace-nowrap">Data Cleaning</h1>
        <div className="flex items-center gap-2 ml-2 flex-wrap">
          {isLivePreview && (
            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 gap-1">
              <CheckCircle2 className="w-3 h-3" />
              {appliedCount} applied
            </Badge>
          )}
          {hasFlags && (
            <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 border-amber-200 dark:border-amber-800 gap-1">
              <AlertTriangle className="w-3 h-3" />
              {totalFlags} flags
            </Badge>
          )}
          {hasEdits && (
            <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400 border-blue-200 dark:border-blue-800 gap-1">
              <Pencil className="w-3 h-3" />
              {editedCells.size} edits
            </Badge>
          )}
          {Object.keys(userEditLayer).length > 0 && (
            <Badge variant="outline" className="text-[9px] bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400 border-blue-200 dark:border-blue-800 gap-0.5">
              <Pencil className="w-2.5 h-2.5" />
              {Object.keys(userEditLayer).length} USER edits
            </Badge>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/* Raw/Cleaned view toggle */}
          <div className="flex items-center bg-muted rounded-lg p-0.5">
            {(["raw", "cleaned"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setDataViewMode(mode)}
                className={cn(
                  "text-[9px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-md transition-colors",
                  dataViewMode === mode
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {mode}
              </button>
            ))}
          </div>
          {/* Memory button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowMemoryPanel(!showMemoryPanel)}
            className={cn("h-7 px-2 text-[10px] gap-1 border-dashed", showMemoryPanel ? "bg-amber-50 dark:bg-amber-950/20 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400" : "text-amber-600 dark:text-amber-400")}
          >
            <Database className="w-3 h-3" />
            Memory
            {memoryStats && memoryStats.totalMappingsLearned > 0 && (
              <span className="ml-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-full px-1.5 py-0 text-[8px] font-bold leading-none">
                {memoryStats.totalMappingsLearned}
              </span>
            )}
            {driftAlerts.length > 0 && (
              <span className="ml-0.5 bg-rose-100 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 rounded-full px-1.5 py-0 text-[8px] font-bold leading-none animate-pulse">
                🚨 {driftAlerts.length}
              </span>
            )}
          </Button>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="sticky top-[45px] z-10 bg-background/95 backdrop-blur-sm border-b px-4 py-1.5 flex items-center gap-2 flex-wrap">
        {displayData.length > 0 && (
          <div className="flex items-center gap-2 mr-2">
            <Badge variant="outline" className="text-[10px] font-mono">
              {cleaningMode === "manual" ? "Manual" : "Auto"} mode
            </Badge>
            <Button
              variant={isManualReviewOpen ? "default" : "outline"}
              size="sm"
              onClick={handleManualReview}
              className={cn(
                "text-xs h-7 gap-1.5",
                isManualReviewOpen
                  ? "bg-[#f0c040] text-[#2b2b2b] hover:bg-[#e5b030] border-[#f0c040]"
                  : "border-dashed"
              )}
            >
              <TableProperties className="w-3.5 h-3.5" />
              {isManualReviewOpen ? "Manual Review Active" : "Manual Review"}
            </Button>
          </div>
        )}
        <div className="w-px h-5 bg-border" />
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => exportData("csv", sanitizeEmojiOnExport)} className="text-xs h-7 gap-1.5">
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportData("xlsx", sanitizeEmojiOnExport)} className="text-xs h-7 gap-1.5">
            <Download className="w-3.5 h-3.5" />
            Export Excel
          </Button>
        </div>
        <div className="w-px h-5 bg-border" />
        <div className="flex items-center gap-2 px-3 py-1 rounded-lg border border-dashed border-[#f0c040]/30 bg-[#f0c040]/5">
          <Sparkles className="w-3.5 h-3.5 text-[#f0c040] shrink-0" />
          <span className="text-[11px] font-medium text-muted-foreground whitespace-nowrap">Emoji → Text</span>
          <Switch
            checked={sanitizeEmojiOnExport}
            onCheckedChange={setSanitizeEmojiOnExport}
            className="data-[state=checked]:bg-[#f0c040] scale-[0.8]"
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleSkip} className="text-xs h-7">
            Skip to Dashboard
          </Button>
          <Button onClick={handleNext} className="gap-1 text-xs h-7">
            Next: Pivot Tables
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Manual Review Confirmation Dialog */}
      <AnimatePresence>
        {showManualConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card border rounded-2xl shadow-2xl max-w-md w-full mx-4 p-6"
            >
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/30 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold mb-1">AI Cleaning Not Done</h3>
                  <p className="text-xs text-muted-foreground mb-4">
                    AI cleaning has not been applied yet. You can continue with manual editing, or run AI cleaning first for better results.
                  </p>
                  <div className="flex items-center gap-2 justify-end">
                    <Button variant="ghost" size="sm" onClick={() => setShowManualConfirm(false)} className="text-xs">
                      Cancel
                    </Button>
                    <Button size="sm" onClick={handleManualConfirmContinue} className="text-xs bg-[#f0c040] text-[#2b2b2b] hover:bg-[#e5b030]">
                      Continue Anyway
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => { setShowManualConfirm(false); analyzeData(); }} className="text-xs">
                      Run AI First
                    </Button>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Content area: sidebar + main ── */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar (AnimatePresence) */}
        <AnimatePresence>
          {showPlanSidebar && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 320, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              className="shrink-0 border-r border-border overflow-hidden bg-card"
            >
              <div className="w-[320px] h-full overflow-y-auto p-3 space-y-3 smooth-scroll-container">
                {/* Sidebar header */}
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-sm font-semibold">Cleaning Plan</h3>
                  <button
                    onClick={() => setShowPlanSidebar(false)}
                    className="p-1 rounded-md hover:bg-muted transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Summary Card */}
                {cleaningReport && (
                <Card className={cn(
                  "border",
                  isClean ? "border-emerald-200 dark:border-emerald-800" : "border-amber-200 dark:border-amber-800"
                )}>
                  <CardContent className="p-3">
                    <div className="flex items-start gap-2">
                      {isClean ? (
                        <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-muted-foreground leading-relaxed">{cleaningReport.summary}</p>
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          <Badge variant="outline" className="text-[9px]">{cleaningReport.originalRows} rows</Badge>
                          {stats && stats.total > 0 && (
                            <Badge variant="outline" className="text-[9px]">{stats.critical + stats.warning} issues</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                )}

                {/* Cleaning Plan */}
                {hasPlan && (
                <Card className="border-slate-200 dark:border-slate-700">
                  <CardHeader className="pb-2 pt-2 px-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <ClipboardList className="w-3 h-3 text-amber-500" />
                        <CardTitle className="text-[11px] font-medium">Plan</CardTitle>
                        <Badge variant="outline" className="text-[8px] font-mono">{cleaningPlan.length} rules</Badge>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" onClick={applyAll} className="text-[9px] h-5 px-1">All</Button>
                        <Button variant="ghost" size="sm" onClick={clearAll} className="text-[9px] h-5 px-1">Clear</Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="px-3 pb-2 pt-0">
                    <div className="space-y-0.5 max-h-48 overflow-y-auto smooth-scroll-container">
                      {Object.entries(columnCleaningSummary).map(([colName, info]) => (
                        <div key={colName} className="rounded border bg-card">
                          <button
                            onClick={() => setExpandedColSummary((prev) => ({ ...prev, [colName]: !prev[colName] }))}
                            className="w-full flex items-center gap-1.5 px-2 py-1 hover:bg-muted/30 transition-colors text-left"
                          >
                            <ChevronDown className={cn("w-2.5 h-2.5 text-muted-foreground transition-transform", !expandedColSummary[colName] && "-rotate-90")} />
                            <span className="text-[10px] font-semibold truncate">{columnRenames[colName] || colName}</span>
                            {columnProfiles[colName] && <ColumnTypeBadge profile={columnProfiles[colName]} />}
                            <Badge variant="outline" className="text-[8px] ml-auto">{info.appliedCount}/{info.totalRules}</Badge>
                          </button>
                          <AnimatePresence>
                            {expandedColSummary[colName] && (
                              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.1 }} className="overflow-hidden">
                                <div className="px-2 pb-1.5 space-y-0.5">
                                  {info.rules.map((rule) => (
                                    <div key={rule.id} className="flex items-center gap-1.5 text-[9px]">
                                      <div className={cn("w-1 h-1 rounded-full mt-1 shrink-0", appliedSuggestions.has(rule.id) ? "bg-emerald-500" : "bg-muted-foreground/30")} />
                                      <span className={cn("truncate", appliedSuggestions.has(rule.id) ? "text-foreground" : "text-muted-foreground")}>{rule.transformation.length > 40 ? rule.transformation.slice(0, 40) + "..." : rule.transformation}</span>
                                      <Switch checked={appliedSuggestions.has(rule.id)} onCheckedChange={() => toggleSuggestion(rule.id)} className="data-[state=checked]:bg-emerald-500 shrink-0 scale-[0.6] ml-auto" />
                                    </div>
                                  ))}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
                )}

                {/* Column Classification */}
                {hasPlan && columns.length > 0 && rawData.length > 0 && (() => {
                  const profs = columns.map((col) => detectColumnProfile(col, rawData));
                  return (
                    <Card className="border-slate-200 dark:border-slate-700">
                      <CardHeader className="pb-1 pt-2 px-3">
                        <div className="flex items-center gap-1.5">
                          <Brain className="w-3 h-3 text-slate-500" />
                          <CardTitle className="text-[10px] font-medium text-slate-600 dark:text-slate-300">Types</CardTitle>
                        </div>
                      </CardHeader>
                      <CardContent className="px-3 pb-2 pt-0">
                        <div className="flex flex-wrap gap-1">
                          {profs.map((p) => (
                            <Tooltip key={p.name}><TooltipTrigger asChild>
                              <div className="flex items-center gap-0.5 px-1 py-0.5 rounded bg-slate-50 dark:bg-slate-800/50 text-[9px] cursor-default">
                                <span className="font-medium truncate max-w-[60px]">{p.name}</span>
                                <Badge className="text-[7px] px-1 py-0 border">
                                  {p.detectedType === "numeric_integer" || p.detectedType === "numeric_float" ? "NUM" : p.detectedType === "date" ? "DATE" : p.detectedType === "categorical" ? "CAT" : p.detectedType === "id" ? "ID" : p.detectedType === "boolean" ? "BOOL" : "TEXT"}
                                </Badge>
                              </div>
                            </TooltipTrigger><TooltipContent>{p.name}: {p.detectedType}</TooltipContent></Tooltip>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })()}

                {/* ── History (Undo/Redo) ── */}
                {cleanedData.length > 0 && (
                  <HistoryPanel onGoToHistory={handleGoToHistory} />
                )}

                {/* ── Edit History ── */}
                {Object.keys(userEditLayer).length > 0 && (
                  <Card>
                    <CardHeader className="pb-2 px-3 pt-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <FileText className="w-3 h-3 text-muted-foreground" />
                          <CardTitle className="text-[11px] font-medium">Edit History</CardTitle>
                          <Badge variant="secondary" className="text-[9px]">{Object.keys(userEditLayer).length}</Badge>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => { clearUserEditLayer(); setCleanedData(cleanedData); }} className="text-[9px] h-5 text-muted-foreground">Revert All</Button>
                      </div>
                    </CardHeader>
                    <CardContent className="px-3 pb-2 pt-0">
                      <div className="max-h-32 overflow-y-auto space-y-0.5 smooth-scroll-container">
                        {Object.entries(userEditLayer).slice(-10).reverse().map(([cellKey, meta]) => {
                          const [rowStr, col] = cellKey.split("-");
                          return (
                            <div key={cellKey} className={cn("flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded", meta.hasConflict ? "bg-orange-50 dark:bg-orange-950/20" : "bg-muted/50")}>
                              <span className="font-mono text-muted-foreground truncate">[{rowStr}]{col}</span>
                              <span className="text-rose-500 line-through truncate max-w-[40px]">{meta.originalRawValue == null ? "NULL" : String(meta.originalRawValue)}</span>
                              <span className="text-muted-foreground">→</span>
                              <span className={cn("font-mono truncate max-w-[40px]", meta.source === "USER" ? "text-blue-600" : "text-emerald-600")}>{meta.userValue ?? meta.aiValue ?? "?"}</span>
                              <span className={cn("ml-auto text-[7px] font-bold uppercase px-0.5 rounded", meta.source === "USER" ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700")}>{meta.source}</span>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* ── Transformation Log ── */}
                {transformationLog.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2 px-3 pt-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <ClipboardList className="w-3 h-3 text-muted-foreground" />
                          <CardTitle className="text-[11px] font-medium">Trans Log</CardTitle>
                          <Badge variant="secondary" className="text-[9px]">{transformationLog.length}</Badge>
                        </div>
                        <div className="flex items-center gap-1">
                          <Badge variant="outline" className="text-[8px] gap-0.5 bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400 border-rose-200 dark:border-rose-800">
                            H:{transformationLog.filter((e) => getReviewPriority(e) === "HIGH").length}
                          </Badge>
                          <Badge variant="outline" className="text-[8px] gap-0.5 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 border-amber-200 dark:border-amber-800">
                            M:{transformationLog.filter((e) => getReviewPriority(e) === "MEDIUM").length}
                          </Badge>
                          <Button variant="ghost" size="sm" onClick={clearTransformationLog} className="text-[9px] h-5 text-muted-foreground">Clear</Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="px-3 pb-2 pt-0">
                      <div className="max-h-48 overflow-y-auto rounded border smooth-scroll-container">
                        <table className="w-full text-[9px]">
                          <thead>
                            <tr className="bg-muted/50 sticky top-0">
                              <th className="text-left px-1 py-1 font-medium text-muted-foreground w-6">⚡</th>
                              <th className="text-left px-1 py-1 font-medium text-muted-foreground">Col</th>
                              <th className="text-left px-1 py-1 font-medium text-muted-foreground">Original</th>
                              <th className="text-left px-1 py-1 font-medium text-muted-foreground">Cleaned</th>
                              <th className="text-left px-1 py-1 font-medium text-muted-foreground">Rule</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...transformationLog]
                              .sort((a, b) => {
                                const prio = { HIGH: 0, MEDIUM: 1, LOW: 2 };
                                const pa = prio[getReviewPriority(a)] ?? 2;
                                const pb = prio[getReviewPriority(b)] ?? 2;
                                if (pa !== pb) return pa - pb;
                                return a.confidence - b.confidence;
                              })
                              .slice(-20)
                              .reverse()
                              .map((entry) => {
                                const priority = getReviewPriority(entry);
                                return (
                                  <tr key={entry.id} className={cn("border-t border-border/50 hover:bg-muted/30", priority === "HIGH" && "bg-rose-50/30 dark:bg-rose-950/10")}>
                                    <td className="px-1 py-0.5 text-center">
                                      <span className={cn("text-[7px] font-bold", priority === "HIGH" ? "text-rose-500" : priority === "MEDIUM" ? "text-amber-500" : "text-sky-400")}>
                                        {priority === "HIGH" ? "🔴" : priority === "MEDIUM" ? "🟡" : "🔵"}
                                      </span>
                                    </td>
                                    <td className="px-1 py-0.5 font-mono truncate max-w-[50px]">{entry.column}</td>
                                    <td className="px-1 py-0.5 font-mono text-rose-600 dark:text-rose-400 truncate max-w-[55px]" title={String(entry.originalValue)}>{entry.originalValue == null ? "NULL" : String(entry.originalValue)}</td>
                                    <td className="px-1 py-0.5 font-mono text-emerald-600 dark:text-emerald-400 truncate max-w-[55px]" title={String(entry.cleanedValue)}>{entry.cleanedValue == null ? "NULL" : String(entry.cleanedValue)}</td>
                                    <td className="px-1 py-0.5 text-muted-foreground truncate max-w-[70px]">{entry.rule}</td>
                                  </tr>
                                );
                              })}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                )}

              </div>{/* close w-[320px] sidebar inner div */}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Main content area ── */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">


          {/* Memory Engine Panel */}
          {showMemoryPanel && (
            <div className="px-4 pb-3">
              <MemoryPanel
                memoryStats={memoryStats}
                driftAlerts={driftAlerts}
                onRefresh={() => {
                  try {
                    const s = memoryEngine.getStats();
                    setMemoryStats(s);
                    const d = memoryEngine.getDriftAlerts({ unresolvedOnly: true, limit: 10 });
                    setDriftAlerts(d);
                  } catch { /* SSR */ }
                }}
                onClear={() => {
                  try {
                    memoryEngine.clearAll();
                    setMemoryStats(null);
                    setDriftAlerts([]);
                  } catch { /* SSR */ }
                }}
                onResolveDrift={(alertId, resolution) => {
                  try {
                    memoryEngine.resolveDrift(alertId, resolution);
                    const s = memoryEngine.getStats();
                    setMemoryStats(s);
                    const d = memoryEngine.getDriftAlerts({ unresolvedOnly: true, limit: 10 });
                    setDriftAlerts(d);
                  } catch { /* SSR */ }
                }}
              />
            </div>
          )}

          {/* Full-width Excel-like spreadsheet with virtualization */}
          {(displayData.length > 0) && (
            <>
            <div 
              ref={tableContainerRef}
              className="flex-1 overflow-auto border border-gray-300 dark:border-gray-600 rounded smooth-scroll-container relative bg-white dark:bg-gray-900"
            >
              {/* Virtualized Table */}
              <div className="relative" style={{ width: `${totalTableWidth}px`, minHeight: `${rowVirtualizer.getTotalSize()}px` }}>
                {/* Sticky Header - Excel style gray header */}
                <div className="sticky top-0 z-[20] bg-gray-100 dark:bg-gray-800" style={{ height: `${ESTIMATED_ROW_HEIGHT}px` }}>
                  <div className="flex relative" style={{ width: `${totalTableWidth}px`, height: `${ESTIMATED_ROW_HEIGHT}px` }}>
                    {/* Row number header */}
                    <div className="w-10 shrink-0 text-[10px] text-gray-600 dark:text-gray-300 font-semibold sticky left-0 bg-gray-200 dark:bg-gray-700 z-[25] border-l border-r border-b border-gray-300 dark:border-gray-600 py-1.5 text-center">
                      #
                    </div>
                    {/* Data column headers - Excel style with edit button */}
                    {colKeys.map((h, colIndex) => {
                      const renamed = columnRenames[h] || h;
                      const isRenaming = editingColumnName === h;
                      const colWidth = columnWidths[h] || 100;
                      return (
                        <div key={h} className={cn(
                          "text-[10px] font-semibold whitespace-nowrap relative group border-r border-b border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 py-1.5 px-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors",
                          colIndex === 0 && "border-l border-gray-300 dark:border-gray-600" // Left border on first column
                        )} style={{ width: `${colWidth}px`, minWidth: `${colWidth}px` }}>
                          {isRenaming ? (
                            <input
                              autoFocus
                              className="w-full bg-white dark:bg-zinc-900 border-2 border-blue-500 outline-none text-[10px] font-semibold px-1 py-0.5 rounded"
                              defaultValue={columnRenameInput[h] || renamed}
                              onBlur={() => handleColumnRename(h, columnRenameInput[h] || renamed)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleColumnRename(h, columnRenameInput[h] || renamed);
                                if (e.key === "Escape") setEditingColumnName(null);
                              }}
                            />
                          ) : (
                            <div className="flex items-center gap-1">
                              <span
                                className="cursor-pointer truncate flex-1"
                                onDoubleClick={() => {
                                  setEditingColumnName(h);
                                  setColumnRenameInput((prev) => ({ ...prev, [h]: renamed }));
                                }}
                                title="Double-click to rename column"
                              >
                                {renamed}
                              </span>
                              {columnProfiles[h] && <ColumnTypeBadge profile={columnProfiles[h]} />}
                              {/* Edit header button */}
                              <button
                                onClick={(e) => { 
                                  e.stopPropagation(); 
                                  setEditingColumnName(h);
                                  setColumnRenameInput((prev) => ({ ...prev, [h]: renamed }));
                                }}
                                className="opacity-0 group-hover:opacity-100 w-4 h-4 rounded bg-gray-300 dark:bg-gray-600 hover:bg-blue-500 hover:text-white flex items-center justify-center transition-all"
                                title="Rename column"
                              >
                                <Pencil className="w-2.5 h-2.5" />
                              </button>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); applyColumnRules(h); }}
                                    disabled={colRuleStatus[h] === "cleaning"}
                                    className={cn(
                                      "w-5 h-5 rounded flex items-center justify-center shrink-0 transition-colors",
                                      colRuleStatus[h] === "done"
                                        ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400 hover:bg-emerald-200"
                                        : "text-gray-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/20"
                                    )}
                                    title="Apply Rules"
                                  >
                                    {colRuleStatus[h] === "cleaning" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wrench className="w-3 h-3" />}
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent className="text-[10px]" side="top">{colRuleStatus[h] === "done" ? "Revert Rules" : "Apply Rules"}</TooltipContent>
                              </Tooltip>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {/* Infinite Virtual Column Headers - Virtualized & Editable */}
                    {/* Positioned after data columns using absolute positioning for virtualization */}
                    {visibleVirtualColumns.map((virtualCol) => {
                      const colIndex = virtualCol.index;
                      const defaultName = getExcelColumnName(colIndex);
                      const customName = virtualColumnRenames.get(colIndex);
                      const displayName = customName || defaultName;
                      const isEditing = editingVirtualHeader === colIndex;
                      const offsetX = 40 + dataColumnsWidth + virtualCol.start;
                      
                      return (
                        <div
                          key={virtualCol.key}
                          data-index={colIndex}
                          className={cn(
                            "text-[10px] font-semibold whitespace-nowrap border-r border-b border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 py-1.5 px-2 bg-gray-50 dark:bg-gray-800 select-none group relative",
                            customName && "text-blue-600 dark:text-blue-400"
                          )}
                          style={{
                            width: `${PLACEHOLDER_COL_WIDTH}px`,
                            position: 'absolute',
                            left: `${offsetX}px`,
                            top: 0,
                          }}
                          title="Click to rename column"
                        >
                          {isEditing ? (
                            <input
                              autoFocus
                              className="w-full bg-white dark:bg-zinc-900 border-2 border-blue-500 outline-none text-[10px] font-semibold px-1 py-0.5 rounded"
                              value={virtualHeaderEditValue}
                              onChange={(e) => setVirtualHeaderEditValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  if (virtualHeaderEditValue.trim()) {
                                    setVirtualColumnRenames(prev => {
                                      const next = new Map(prev);
                                      next.set(colIndex, virtualHeaderEditValue.trim());
                                      return next;
                                    });
                                  } else {
                                    setVirtualColumnRenames(prev => {
                                      const next = new Map(prev);
                                      next.delete(colIndex);
                                      return next;
                                    });
                                  }
                                  setEditingVirtualHeader(null);
                                }
                                if (e.key === "Escape") {
                                  setEditingVirtualHeader(null);
                                }
                              }}
                              onBlur={() => {
                                if (virtualHeaderEditValue.trim()) {
                                  setVirtualColumnRenames(prev => {
                                    const next = new Map(prev);
                                    next.set(colIndex, virtualHeaderEditValue.trim());
                                    return next;
                                  });
                                }
                                setEditingVirtualHeader(null);
                              }}
                            />
                          ) : (
                            <div className="flex items-center gap-1">
                              <span
                                className="cursor-pointer truncate flex-1"
                                onClick={() => {
                                  setEditingVirtualHeader(colIndex);
                                  setVirtualHeaderEditValue(displayName);
                                }}
                              >
                                {displayName}
                              </span>
                              {/* Edit button on hover */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingVirtualHeader(colIndex);
                                  setVirtualHeaderEditValue(displayName);
                                }}
                                className="opacity-0 group-hover:opacity-100 w-4 h-4 rounded bg-gray-300 dark:bg-gray-600 hover:bg-blue-500 hover:text-white flex items-center justify-center transition-all shrink-0"
                                title="Rename column"
                              >
                                <Pencil className="w-2.5 h-2.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Virtualized Rows */}
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const rowIdx = virtualRow.index;
                  const row = displayData[rowIdx];
                  if (!row) return null;
                  
                  return (
                    <div
                      key={rowIdx}
                      data-index={rowIdx}
                      className="flex absolute smooth-row transition-colors duration-150"
                      style={{
                        width: `${totalTableWidth}px`,
                        height: `${ESTIMATED_ROW_HEIGHT}px`,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      {/* Row number cell - Excel style */}
                      <div className="w-10 shrink-0 text-[10px] text-muted-foreground font-mono py-1 sticky left-0 bg-gray-100 dark:bg-gray-800 z-[15] border-l border-r border-b border-gray-300 dark:border-gray-600 text-center">
                        {rowIdx + 1}
                      </div>
                      {/* Data cells - Excel style with edit button on hover */}
                      {colKeys.map((col, colIndex) => {
                        const cellKey = `${rowIdx}-${col}`;
                        const flag = flagMap.get(cellKey);
                        const isEdited = editedCells.has(cellKey);
                        const isEditing = editingCell === cellKey;
                        const isHovered = hoveredCell === cellKey;
                        const baseValue = row[col];
                        const value = getCellValue(rowIdx, col, baseValue);
                        const colWidth = columnWidths[col] || 100;

                        return (
                          <div
                            key={col}
                            className={cn(
                              "text-xs font-mono py-1 px-2 relative border-r border-b border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900",
                              "cursor-cell smooth-cell group",
                              colIndex === 0 && "border-l border-gray-300 dark:border-gray-600", // Left border on first column
                              flag && !isEdited ? FLAG_BORDER_STYLES[getFlagColor(flag)] : "",
                              (() => {
                                const meta = userEditLayer[cellKey];
                                if (meta?.source === "USER") return "bg-blue-50 dark:bg-blue-950/20";
                                if (meta?.source === "AI") return "bg-emerald-50/50 dark:bg-emerald-950/10";
                                if (meta?.hasConflict) return "bg-orange-50 border-orange-200 dark:bg-orange-950/30 dark:border-orange-800";
                                if (isEdited) return "bg-blue-50 dark:bg-blue-950/20";
                                return "";
                              })(),
                              isEdited ? "bg-blue-50 dark:bg-blue-950/20" : "",
                              isHovered && !isEditing ? "bg-blue-100/50 dark:bg-blue-900/30" : "",
                            )}
                            style={{ width: `${colWidth}px`, minWidth: `${colWidth}px`, height: `${ESTIMATED_ROW_HEIGHT - 1}px` }}
                            onClick={() => !isEditing && startEditing(cellKey, value)}
                            onMouseEnter={() => setHoveredCell(cellKey)}
                            onMouseLeave={() => setHoveredCell(null)}
                          >
                            {isEditing ? (
                              <div className="flex items-center gap-1">
                                <input
                                  className="w-full bg-white dark:bg-zinc-900 border-2 border-blue-500 px-1 py-0.5 text-xs font-mono outline-none"
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") confirmEdit();
                                    if (e.key === "Escape") cancelEdit();
                                  }}
                                  autoFocus
                                />
                                <button onClick={confirmEdit} className="shrink-0 w-5 h-5 rounded bg-emerald-500 text-white flex items-center justify-center hover:bg-emerald-600">
                                  <CheckCircle2 className="w-3 h-3" />
                                </button>
                                <button onClick={cancelEdit} className="shrink-0 w-5 h-5 rounded bg-rose-500 text-white flex items-center justify-center hover:bg-rose-600">
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 min-w-0">
                                <span className={cn("truncate flex-1", value == null ? "text-muted-foreground/40 italic" : "")}>
                                  {value == null ? "" : String(value)}
                                </span>
                                {/* Edit button - always visible on hover for ALL cells */}
                                {isHovered && !isEditing && (
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); startEditing(cellKey, value); }}
                                    className="shrink-0 w-5 h-5 rounded bg-gray-200 dark:bg-gray-700 hover:bg-blue-500 hover:text-white flex items-center justify-center transition-colors"
                                    title="Edit cell"
                                  >
                                    <Pencil className="w-2.5 h-2.5" />
                                  </button>
                                )}
                                {flag && (
                                  <span
                                    className={cn(
                                      "shrink-0 w-3.5 h-3.5 rounded-full flex items-center justify-center",
                                      FLAG_INDICATOR_STYLES[getFlagColor(flag)],
                                    )}
                                    title={`${String(value)} ${getFlagColor(flag) === "green" ? "✅ fixed" : getFlagColor(flag) === "yellow" ? "⚠️ null" : "❌ needs attention"} — ${flag.reason}`}
                                  >
                                    <span className="text-[7px] font-bold leading-none">!</span>
                                  </span>
                                )}
                                {isEdited && !flag && !isHovered && (
                                  <Pencil className="w-2.5 h-2.5 text-blue-500 shrink-0" />
                                )}
                                {(() => {
                                  const meta = userEditLayer[cellKey];
                                  if (!meta) return null;
                                  return (
                                    <span className={cn(
                                      "absolute top-0 left-0 text-[6px] font-bold leading-none px-0.5",
                                      meta.source === "USER" ? "text-blue-500" : meta.source === "AI" ? "text-emerald-500" : "text-muted-foreground"
                                    )}>
                                      {meta.source === "USER" ? "●" : meta.source === "AI" ? "▲" : "○"}
                                    </span>
                                  );
                                })()}
                              </div>
                            )}

                            {/* Tooltip on hover */}
                            {(flag || isEdited) && isHovered && !isEditing && (
                              <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1 w-56 p-2 bg-zinc-900 text-zinc-100 rounded-lg shadow-lg text-[10px] space-y-1 pointer-events-none">
                                {flag && (
                                  <>
                                    <div className={cn("flex items-center gap-1 font-semibold", getFlagColor(flag) === "green" ? "text-emerald-400" : getFlagColor(flag) === "yellow" ? "text-yellow-400" : "text-rose-400")}>
                                      <span>{getFlagColor(flag) === "green" ? "✅" : getFlagColor(flag) === "yellow" ? "⚠️" : "❌"}</span>
                                      {getFlagColor(flag) === "green" ? "Fixed" : getFlagColor(flag) === "yellow" ? "Converted to NULL" : "Needs Attention"}
                                    </div>
                                    <div className="text-zinc-300 font-mono">{flag.raw} → {flag.severity === "clean" ? "✓" : flag.severity === "high_risk" ? "✗" : "?"} {flag.reason}</div>
                                    <div className="text-zinc-500">confidence: {(flag.confidence * 100).toFixed(0)}% | {flag.confidence >= 0.90 ? "HIGH" : flag.confidence >= 0.70 ? "MEDIUM" : "LOW"}</div>
                                  </>
                                )}
                                {isEdited && !flag && (
                                  <div className="text-blue-400 font-semibold">Manually edited</div>
                                )}
                                <div className="text-zinc-500 text-[9px]">Click to edit • Enter to save • Esc to cancel</div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {/* Infinite Virtual Cells - Virtualized & Editable */}
                      {/* Positioned after data columns using absolute positioning for virtualization */}
                      {visibleVirtualColumns.map((virtualCol) => {
                        const colIndex = virtualCol.index;
                        const cellKey = `${rowIdx}-virtual-${colIndex}`;
                        const isEditing = editingVirtualCell === cellKey;
                        const isHovered = hoveredVirtualCell === cellKey;
                        const editedValue = virtualColumnEdits.get(cellKey);
                        const offsetX = 40 + dataColumnsWidth + virtualCol.start;
                        
                        return (
                          <div
                            key={virtualCol.key}
                            data-index={colIndex}
                            className={cn(
                              "text-xs font-mono py-1 px-2 border-r border-b border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 cursor-cell smooth-cell group relative",
                              editedValue !== undefined && "bg-blue-50 dark:bg-blue-950/20",
                              isHovered && !isEditing && "bg-blue-100/50 dark:bg-blue-900/30",
                              isEditing && "ring-2 ring-blue-500"
                            )}
                            style={{
                              width: `${PLACEHOLDER_COL_WIDTH}px`,
                              height: `${ESTIMATED_ROW_HEIGHT - 1}px`,
                              position: 'absolute',
                              left: `${offsetX}px`,
                              top: 0,
                            }}
                            onClick={() => {
                              if (!isEditing) {
                                setEditingVirtualCell(cellKey);
                                setVirtualEditValue(editedValue !== undefined ? String(editedValue) : "");
                              }
                            }}
                            onMouseEnter={() => setHoveredVirtualCell(cellKey)}
                            onMouseLeave={() => setHoveredVirtualCell(null)}
                          >
                            {isEditing ? (
                              <div className="flex items-center gap-1">
                                <input
                                  className="w-full bg-white dark:bg-zinc-900 border-2 border-blue-500 px-1 py-0.5 text-xs font-mono outline-none"
                                  value={virtualEditValue}
                                  onChange={(e) => setVirtualEditValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      setVirtualColumnEdits(prev => {
                                        const next = new Map(prev);
                                        if (virtualEditValue.trim() === "") {
                                          next.delete(cellKey);
                                        } else {
                                          next.set(cellKey, virtualEditValue);
                                        }
                                        return next;
                                      });
                                      setEditingVirtualCell(null);
                                    }
                                    if (e.key === "Escape") {
                                      setEditingVirtualCell(null);
                                    }
                                  }}
                                  autoFocus
                                  onClick={(e) => e.stopPropagation()}
                                />
                                <button 
                                  onClick={(e) => { 
                                    e.stopPropagation(); 
                                    setVirtualColumnEdits(prev => {
                                      const next = new Map(prev);
                                      if (virtualEditValue.trim() !== "") {
                                        next.set(cellKey, virtualEditValue);
                                      }
                                      return next;
                                    });
                                    setEditingVirtualCell(null);
                                  }} 
                                  className="shrink-0 w-5 h-5 rounded bg-emerald-500 text-white flex items-center justify-center hover:bg-emerald-600"
                                >
                                  <CheckCircle2 className="w-3 h-3" />
                                </button>
                                <button 
                                  onClick={(e) => { 
                                    e.stopPropagation(); 
                                    setEditingVirtualCell(null);
                                  }} 
                                  className="shrink-0 w-5 h-5 rounded bg-rose-500 text-white flex items-center justify-center hover:bg-rose-600"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 min-w-0">
                                <span className={cn("truncate flex-1", editedValue === undefined && "text-muted-foreground/40 italic")}>
                                  {editedValue !== undefined ? String(editedValue) : ""}
                                </span>
                                {/* Edit button - always visible on hover for ALL virtual cells */}
                                {isHovered && !isEditing && (
                                  <button 
                                    onClick={(e) => { 
                                      e.stopPropagation(); 
                                      setEditingVirtualCell(cellKey);
                                      setVirtualEditValue(editedValue !== undefined ? String(editedValue) : "");
                                    }}
                                    className="shrink-0 w-5 h-5 rounded bg-gray-200 dark:bg-gray-700 hover:bg-blue-500 hover:text-white flex items-center justify-center transition-colors"
                                    title="Edit cell"
                                  >
                                    <Pencil className="w-2.5 h-2.5" />
                                  </button>
                                )}
                                {editedValue !== undefined && !isHovered && (
                                  <Pencil className="w-2.5 h-2.5 text-blue-500 shrink-0" />
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Row count indicator — Excel-style status bar */}
            <div className="flex items-center justify-between mt-2 px-1">
              <span className="text-[10px] text-muted-foreground font-mono">
                {totalRows} row{totalRows !== 1 ? "s" : ""} × {colKeys.length} col{colKeys.length !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Save Banner */}
            {(hasFlags || hasEdits) && (
              <div className="mt-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/10 border border-amber-200 dark:border-amber-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  <span className="text-xs text-amber-700 dark:text-amber-400">
                    {totalFlags} flagged cell{totalFlags !== 1 ? "s" : ""}{hasEdits ? `, ${editedCells.size} edit${editedCells.size !== 1 ? "s" : ""}` : ""} — <span className="text-emerald-600 font-medium">✅ Fixed</span> / <span className="text-yellow-600 font-medium">⚠ Null</span> / <span className="text-rose-600 font-medium">❌ Needs Attention</span>
                  </span>
                </div>
                <Button size="sm" onClick={saveFinalDataset} className="gap-1.5 h-7 text-xs bg-emerald-600 hover:bg-emerald-700">
                  <Save className="w-3 h-3" />
                  Save & Confirm
                </Button>
              </div>
            )}
            </>
          )}

        </div>{/* close main content area */}
      </div>{/* close content flex wrapper */}

    </div>
  );
}
