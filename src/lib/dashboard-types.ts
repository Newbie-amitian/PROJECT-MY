// ============================================================
// Dashboard Types & Interfaces
// ============================================================

export interface RawDataRow {
  [key: string]: string | number | boolean | null | undefined;
}

export interface ColumnMeta {
  name: string;
  type: "string" | "number" | "boolean" | "date" | "unknown";
  nullable: boolean;
  uniqueCount: number;
  sampleValues: (string | number | boolean | null)[];
  missingCount: number;
}

export interface DataCleaningResult {
  missingValues: { column: string; count: number; strategy: string }[];
  duplicatesRemoved: number;
  typeCorrections: { column: string; from: string; to: string }[];
  outliers: { column: string; count: number; strategy: string }[];
  cleanedRowCount: number;
  originalRowCount: number;
}

export interface TransformationResult {
  aggregations: { groupBy: string[]; measure: string; function: string; result: number }[];
  pivotTables: PivotTableData[];
  summary: { column: string; total: number; avg: number; min: number; max: number; count: number }[];
}

export type ChartType =
  | "line"
  | "bar"
  | "horizontal_bar"
  | "stacked_bar"
  | "area"
  | "pie"
  | "donut"
  | "stacked_area"
  | "scatter"
  | "bubble"
  | "histogram"
  | "box_plot"
  | "combo_chart"
  | "dual_axis_chart"
  | "waterfall_chart"
  | "funnel_chart"
  | "treemap"
  | "heatmap"
  | "table"
  | "pivot_table";

export type LayoutType = "analytical" | "exclusive";

export type WorkflowPhase = "upload" | "cleaning" | "pivot" | "dashboard";

export interface KPIConfig {
  id: string;
  title: string;
  column: string;
  aggregation: "sum" | "avg" | "count" | "min" | "max" | "median" | "ratio";
  ratioDenominator?: string;
  format: "number" | "currency" | "percent" | "compact";
  prefix?: string;
  suffix?: string;
  trendColumn?: string;
  trendDirection?: "up" | "down" | "neutral";
  trendValue?: number;
  icon?: string;
  bgColor?: string;
  borderColor?: string;
}

export interface ChartConfig {
  id: string;
  type: ChartType;
  title: string;
  description?: string;
  x: string;
  y: string[];
  additionalSeries?: { key: string; label: string; type?: "bar" | "line" | "area" }[];
  colorBy?: string;
  size?: string;
  config: {
    stacked?: boolean;
    innerRadius?: number;
    outerRadius?: number;
    barThickness?: number;
    fillOpacity?: number;
    stroke_width?: number;
    showLegend?: boolean;
    showTooltip?: boolean;
    curveType?: "monotone" | "linear" | "step" | "natural";
    orient?: "horizontal" | "vertical";
    buckets?: number;
  };
  width?: number;
  height?: number;
  data?: RawDataRow[];
  bgColor?: string;
  borderColor?: string;
}

export interface FilterConfig {
  id: string;
  column: string;
  label: string;
  type: "select" | "multi-select" | "date-range" | "number-range";
  options?: string[];
  selectedValues?: string[];
  dateRange?: { start: string; end: string };
  numberRange?: { min: number; max: number };
}

export interface StyleConfig {
  font_family: string;
  font_sizes: {
    title: number;
    subtitle: number;
    axis: number;
    label: number;
    kpi_value: number;
    kpi_label: number;
  };
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
    textSecondary: string;
    chart: string[];
  };
  border_radius: number;
  padding: number;
  chart_stroke_width: number;
  donut_inner_radius: number;
  bar_thickness: number;
  gridlines: boolean;
  card_shadow: boolean;
  animations: boolean;
}

export interface DashboardConfig {
  title: string;
  layout: LayoutType;
  kpis: KPIConfig[];
  charts: ChartConfig[];
  filters: FilterConfig[];
  interactions: {
    cross_filtering: boolean;
    drill_down: boolean;
    hover: boolean;
  };
  style: StyleConfig;
}

// Pre-Aggregation Filter specification
export interface FilterSpec {
  field: string;
  operator: ">" | ">=" | "<" | "<=" | "=" | "!=" | "contains" | "not_contains" | "in" | "not_in";
  value: string | number | string[] | number[];
  label?: string; // Human-readable description for UI display
}

// Pivot Table types
export interface PivotTableData {
  rows: string[];
  columns: string[];
  values: { row: string; col: string; value: number }[];
}

export interface PivotTableConfig {
  id: string;
  title: string;
  pivotMode: "dynamic" | "crosstab";
  // Dynamic mode: one row dimension, multiple measures (sum+avg each), headcount
  rowField: string;
  measures?: { field: string; aggregations: string[] }[];
  headcountField?: string;
  // Crosstab mode: row × column → single measure
  columnField?: string;
  valueField?: string;
  aggregation?: "sum" | "avg" | "count" | "min" | "max";
  // Pre-Aggregation Filtering
  filters?: FilterSpec[];
  totalRecordsBeforeFilter?: number;
  totalRecordsAfterFilter?: number;
  // Shared
  data: RawDataRow[];
  tableData: {
    headers: string[];
    rows: { label: string; values: (string | number)[] }[];
    grandTotal?: { label: string; values: (string | number)[] };
  };
}

// Cleaning types
export interface CleaningSuggestion {
  id: string;
  type: "remove_duplicates" | "fill_missing" | "fix_types" | "handle_outliers" | "rename_columns" | "drop_columns";
  column?: string;
  description: string;
  severity: "info" | "warning" | "critical";
  applied: boolean;
  details: Record<string, unknown>;
}

export interface CleaningReport {
  summary: string;
  suggestions: CleaningSuggestion[];
  originalRows: number;
  cleanedRows: number;
  isAlreadyClean: boolean;
}

// Flag types for inline uncertainty
export type FlagType =
  | "fuzzy_match"
  | "fuzzy_number"
  | "mixed_unit"
  | "non_numeric"
  | "ambiguous_number"
  | "low_confidence"
  | "reversed_range"
  | "partial_range"
  | "typo_uncertain"
  | "missing_value"
  | "invalid_numeric"
  | "invalid_date"
  | "invalid_negative"
  | "outlier"
  | "critical_missing_id"
  | "invalid_range"
  | "invalid_rating"
  | "unknown_category"
  | "duplicate_id"
  | "malformed_id"
  | "type_inconsistent"
  | "word_number"
  | "non_numeric_category"
  | "possible_typo"
  | "frequency_inferred"
  | "similarity_inferred"
  | "single_value_range"
  | "range_average"
  | "canonical_mapped"
  | "text_trimmed"
  | "text_normalized"
  | "date_standardized"
  | "emoji_detected"
  | "garbage_token"
  | "banned_word"
  | "ai_anomaly_blocked"
  | "ai_anomaly_fix"
  | "ai_anomaly_flagged"
  | "invalid_email"
  | "invalid_phone"
  | "email_fixed"
  | "phone_fixed"
  | "money_normalize"
  | "non_monetary"
  | "salary_normalized"
  | "salary_parsed"
  | "salary_needs_ai"
  | "invalid_salary"
  | "invalid_name"
  | "partial_full_name"
  | "special_char_name"
  | "name_standardized"
  | "location_standardized"
  | "phone_formatted"
  | "null_detected"
  | "unrecoverable_location";

// Flag severity levels (from spec Section 8)
export type FlagSeverity = "clean" | "warning" | "high_risk" | "blocked";

// Execution modes (from spec Section 4)
export type CleaningMode = "auto" | "manual";

// Transformation log entry (from spec Section 9)
export interface TransformationLogEntry {
  id: string;
  timestamp: number;
  column: string;
  row?: number;
  originalValue: unknown;
  cleanedValue: unknown;
  rule: string;
  confidence: number;
  status: "applied" | "flagged" | "skipped" | "manual_edit";
  severity: FlagSeverity;
}

export interface CellFlag {
  raw: string;
  flag: FlagType;
  confidence: number;
  severity: FlagSeverity;
  reason: string;
  suggestedValue?: unknown;
}

// ── Data State Engine (3-Layer) ──────────────────

export type CellSource = "RAW" | "AI" | "USER";

export type DataViewMode = "raw" | "ai" | "merged";

export interface CellMetadata {
  source: CellSource;
  lastModifiedBy: CellSource;
  timestamp: number;
  originalRawValue: unknown;   // immutable from rawData
  aiValue: unknown | null;     // AI cleaned value
  userValue: unknown | null;   // user override
  hasConflict: boolean;        // AI != USER
  conflictResolvedBy: CellSource | null;
}

// Key format: "rowIdx-colName"
export type UserEditLayer = Record<string, CellMetadata>;

// Chat messages for AI assistant
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export const DEFAULT_STYLE: StyleConfig = {
  font_family: "Inter, sans-serif",
  font_sizes: {
    title: 20,
    subtitle: 14,
    axis: 12,
    label: 11,
    kpi_value: 28,
    kpi_label: 12,
  },
  colors: {
    primary: "hsl(220, 13%, 13%)",
    secondary: "hsl(220, 9%, 46%)",
    accent: "hsl(24, 95%, 53%)",
    background: "hsl(0, 0%, 100%)",
    surface: "hsl(0, 0%, 98%)",
    text: "hsl(240, 10%, 4%)",
    textSecondary: "hsl(240, 5%, 65%)",
    chart: [
      "hsl(24, 95%, 53%)",
      "hsl(160, 84%, 39%)",
      "hsl(252, 47%, 51%)",
      "hsl(199, 89%, 48%)",
      "hsl(347, 77%, 50%)",
      "hsl(45, 93%, 47%)",
      "hsl(142, 71%, 45%)",
      "hsl(271, 91%, 65%)",
    ],
  },
  border_radius: 12,
  padding: 24,
  chart_stroke_width: 2,
  donut_inner_radius: 60,
  bar_thickness: 32,
  gridlines: false,
  card_shadow: true,
  animations: true,
};

export const CHART_COLORS = [
  "hsl(24, 95%, 53%)",
  "hsl(160, 84%, 39%)",
  "hsl(252, 47%, 51%)",
  "hsl(199, 89%, 48%)",
  "hsl(347, 77%, 50%)",
  "hsl(45, 93%, 47%)",
  "hsl(142, 71%, 45%)",
  "hsl(271, 91%, 65%)",
];
