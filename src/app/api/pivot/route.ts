import { NextRequest, NextResponse } from "next/server";
import ZAI from "@/lib/ai-provider";
import type { RawDataRow, ColumnMeta, FilterSpec } from "@/lib/dashboard-types";

// ════════════════════════════════════════════════════════════
// REQUEST / RESPONSE TYPES
// ════════════════════════════════════════════════════════════

interface PivotRequest {
  data: RawDataRow[];
  columns: ColumnMeta[];
  userMessage: string;
}

interface PivotResponse {
  title: string;
  pivotMode: "dynamic" | "crosstab";
  // Dynamic mode fields
  rowField?: string;
  measures?: { field: string; aggregations: string[] }[];
  headcountField?: string;
  // Crosstab mode fields
  columnField?: string;
  valueField?: string;
  aggregation?: "sum" | "avg" | "count" | "min" | "max";
  // Pre-Aggregation Filtering
  filters?: FilterSpec[];
  totalRecordsBeforeFilter?: number;
  totalRecordsAfterFilter?: number;
  filterDescription?: string;
  // Shared
  tableData: {
    headers: string[];
    rows: { label: string; values: (string | number)[] }[];
    grandTotal?: { label: string; values: (string | number)[] };
  };
  aiMessage: string;
}

// ════════════════════════════════════════════════════════════
// SHARED UTILITIES
// ════════════════════════════════════════════════════════════

function cleanHeader(header: string): string {
  return String(header).trim().replace(/\s+/g, " ");
}

const NULL_SENTINEL_VALUES = new Set([
  "unknown", "unk", "n/a", "na", "none", "nil", "null",
  "undefined", "tbd", "-", "--", "—", "–",
  "not available", "not_a_value", "not applicable",
]);

function isNullCategoryValue(val: unknown): boolean {
  if (val == null) return true;
  const s = String(val).trim();
  if (s === "") return true;
  return NULL_SENTINEL_VALUES.has(s.toLowerCase());
}

function forceNumeric(val: unknown): number | null {
  if (val == null) return null;
  let s = String(val).trim();
  s = s.replace(/[$\u20B9\u20AC\u00A3\u00A5\u00A4\u20A9]/g, "");
  s = s.replace(/,/g, "");
  s = s.replace(/\s/g, "");
  if (/^\(.*\)$/.test(s)) s = "-" + s.slice(1, -1);
  if (s.endsWith("%")) {
    const num = Number(s.slice(0, -1));
    if (!isNaN(num)) return num / 100;
  }
  const num = Number(s);
  return isNaN(num) ? null : num;
}

function formatNumDynamic(n: number): string {
  if (n === 0) return "0";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function formatNumCrosstab(n: number, agg: string): string {
  if (n === 0) return "";
  if (agg === "count") return n.toLocaleString("en-IN");
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function isLikelyIdentifier(column: ColumnMeta): boolean {
  const name = column.name.toLowerCase();
  const idPatterns = [
    "full_name", "first_name", "last_name",
    "email", "phone", "mobile", "tel",
    "id", "uuid", "uid", "guid",
    "address", "street", "zip", "postal",
    "ssn", "passport", "account",
  ];
  if (idPatterns.some((p) => name.includes(p))) return true;
  if (column.uniqueCount > 30) return true;
  return false;
}

function findHeadcountColumn(columns: ColumnMeta[]): string | null {
  const idPatterns = [
    "emp_id", "employee_id", "empid", "employeeid",
    "id", "user_id", "userid", "uid",
    "record_id", "recordid", "sno", "sr_no", "srno",
  ];
  for (const pattern of idPatterns) {
    const match = columns.find((c) => c.name.toLowerCase() === pattern);
    if (match) return match.name;
  }
  for (const pattern of idPatterns) {
    const match = columns.find(
      (c) => c.name.toLowerCase().includes(pattern) && c.uniqueCount > 5
    );
    if (match) return match.name;
  }
  const idCol = columns.find((c) => c.name.toLowerCase().includes("id") && c.uniqueCount > 5);
  if (idCol) return idCol.name;
  return null;
}

// ════════════════════════════════════════════════════════════
// PRE-AGGREGATION FILTER ENGINE
//
// The Filter-First Rule: Apply all filters to the raw dataset
// BEFORE any grouping or calculation occurs.
// ════════════════════════════════════════════════════════════

function applyFilters(
  data: RawDataRow[],
  filters: FilterSpec[],
  columns: ColumnMeta[],
): { filteredData: RawDataRow[]; appliedFilters: FilterSpec[]; errors: string[] } {
  const validColumns = new Set(columns.map((c) => c.name));
  const appliedFilters: FilterSpec[] = [];
  const errors: string[] = [];

  // Validate filters first
  for (const f of filters) {
    if (!validColumns.has(f.field)) {
      errors.push(`Filter field "${f.field}" not found in dataset — skipped.`);
      continue;
    }
    appliedFilters.push(f);
  }

  if (appliedFilters.length === 0) {
    return { filteredData: data, appliedFilters: [], errors };
  }

  const filteredData = data.filter((row) => {
    return appliedFilters.every((filter) => {
      const cellValue = row[filter.field];
      return evaluateFilter(cellValue, filter);
    });
  });

  return { filteredData, appliedFilters, errors };
}

function evaluateFilter(
  cellValue: unknown,
  filter: FilterSpec,
): boolean {
  // Null/missing cells — treat as not matching any positive filter
  if (cellValue == null || isNullCategoryValue(cellValue)) {
    // For "not equals" and "not_in", null/missing should pass (they're not the specified value)
    if (filter.operator === "!=" || filter.operator === "not_contains" || filter.operator === "not_in") {
      return true;
    }
    return false;
  }

  const cellStr = String(cellValue).trim().toLowerCase();
  const cellNum = forceNumeric(cellValue);

  switch (filter.operator) {
    case ">": {
      if (cellNum === null) return false;
      const threshold = typeof filter.value === "number" ? filter.value : forceNumeric(filter.value);
      return threshold !== null && cellNum > threshold;
    }
    case ">=": {
      if (cellNum === null) return false;
      const threshold = typeof filter.value === "number" ? filter.value : forceNumeric(filter.value);
      return threshold !== null && cellNum >= threshold;
    }
    case "<": {
      if (cellNum === null) return false;
      const threshold = typeof filter.value === "number" ? filter.value : forceNumeric(filter.value);
      return threshold !== null && cellNum < threshold;
    }
    case "<=": {
      if (cellNum === null) return false;
      const threshold = typeof filter.value === "number" ? filter.value : forceNumeric(filter.value);
      return threshold !== null && cellNum <= threshold;
    }
    case "=": {
      if (typeof filter.value === "number") {
        if (cellNum === null) return false;
        return cellNum === filter.value;
      }
      return cellStr === String(filter.value).trim().toLowerCase();
    }
    case "!=": {
      if (typeof filter.value === "number") {
        if (cellNum === null) return true;
        return cellNum !== filter.value;
      }
      return cellStr !== String(filter.value).trim().toLowerCase();
    }
    case "contains": {
      return cellStr.includes(String(filter.value).trim().toLowerCase());
    }
    case "not_contains": {
      return !cellStr.includes(String(filter.value).trim().toLowerCase());
    }
    case "in": {
      const set = Array.isArray(filter.value) ? filter.value : [filter.value];
      return set.some((v) => {
        if (typeof v === "number") {
          return cellNum !== null && cellNum === v;
        }
        return cellStr === String(v).trim().toLowerCase();
      });
    }
    case "not_in": {
      const set = Array.isArray(filter.value) ? filter.value : [filter.value];
      return !set.some((v) => {
        if (typeof v === "number") {
          return cellNum !== null && cellNum === v;
        }
        return cellStr === String(v).trim().toLowerCase();
      });
    }
    default:
      return true;
  }
}

// ════════════════════════════════════════════════════════════
// DYNAMIC PIVOT ENGINE — Fully metadata-driven
//
// Accepts per-measure aggregation specs from the AI.
// NO hardcoded defaults — everything comes from the AI decision.
// DYNAMIC EXCLUSION: Categories with zero records are auto-excluded
//   because they never appear in the grouped Map.
// MATHEMATICAL INTEGRITY: All measures recalculated on filtered data.
// ════════════════════════════════════════════════════════════
interface MeasureSpec {
  field: string;
  aggregations: ("sum" | "avg")[];
}

function generateDynamicPivot(
  data: RawDataRow[],
  rowField: string,
  measureSpecs: MeasureSpec[],
  includeHeadcount: boolean,
  headcountField: string | null,
): {
  headers: string[];
  rows: { label: string; values: (string | number)[] }[];
  grandTotal: { label: string; values: (string | number)[] };
} {
  // ── Step 1: Group data by row dimension ──
  // DYNAMIC EXCLUSION: Only categories present in data appear in the Map.
  // If a filter eliminates all records for a category, it simply won't exist here.
  const groups = new Map<string, RawDataRow[]>();
  const rowCaseFreq = new Map<string, Map<string, number>>();
  const rowLabelMap = new Map<string, string>();

  data.forEach((row) => {
    const rawVal = row[rowField];
    let key: string;
    let original: string;
    if (isNullCategoryValue(rawVal)) {
      key = "__blank__";
      original = "(blank)";
    } else {
      const s = String(rawVal).trim().replace(/\s+/g, " ");
      key = s.toLowerCase();
      original = s;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);

    if (!rowCaseFreq.has(key)) rowCaseFreq.set(key, new Map());
    const freq = rowCaseFreq.get(key)!;
    freq.set(original, (freq.get(original) || 0) + 1);
    let maxCount = 0;
    for (const [val, count] of freq) {
      if (count > maxCount) { maxCount = count; rowLabelMap.set(key, val); }
    }
  });

  const rowKeys = [...rowLabelMap.keys()];

  // ── Step 2: Build column headers from measure specs (NOT hardcoded) ──
  type HeaderCol = { header: string; field: string; agg: "sum" | "avg" | "count" };
  const headerCols: HeaderCol[] = [];

  for (const spec of measureSpecs) {
    for (const agg of spec.aggregations) {
      headerCols.push({
        header: `${agg === "sum" ? "Sum" : "Avg"} of ${cleanHeader(spec.field)}`,
        field: spec.field,
        agg,
      });
    }
  }

  // Headcount only if AI decided to include it
  if (includeHeadcount && headcountField) {
    headerCols.push({ header: "Headcount", field: headcountField, agg: "count" });
  }

  const headers = [cleanHeader(rowField), ...headerCols.map((c) => c.header)];

  // ── Step 3: Aggregate each group ──
  // MATHEMATICAL INTEGRITY: All values come from the (already filtered) `data` passed in.
  const rows: { label: string; values: (string | number)[] }[] = [];

  rowKeys.forEach((rowKey) => {
    const groupRows = groups.get(rowKey) || [];
    const displayLabel = rowLabelMap.get(rowKey) || "(blank)";
    const rowValues: (string | number)[] = [displayLabel];

    headerCols.forEach((col) => {
      if (col.agg === "count") {
        const count = groupRows.filter((r) => {
          const v = r[col.field];
          return v != null && !isNullCategoryValue(v);
        }).length;
        rowValues.push(count > 0 ? formatNumDynamic(count) : "0");
      } else {
        const numericValues: number[] = [];
        groupRows.forEach((r) => {
          const num = forceNumeric(r[col.field]);
          if (num !== null) numericValues.push(num);
        });

        if (numericValues.length === 0) {
          rowValues.push("0");
        } else if (col.agg === "sum") {
          const sum = Math.round(numericValues.reduce((a, b) => a + b, 0) * 100) / 100;
          rowValues.push(formatNumDynamic(sum));
        } else {
          const avg = Math.round((numericValues.reduce((a, b) => a + b, 0) / numericValues.length) * 100) / 100;
          rowValues.push(formatNumDynamic(avg));
        }
      }
    });

    rows.push({ label: displayLabel, values: rowValues });
  });

  // ── Step 4: Sort by first numeric column descending — (blank) always last ──
  if (headerCols.length > 0) {
    rows.sort((a, b) => {
      const aBlank = a.label === "(blank)";
      const bBlank = b.label === "(blank)";
      if (aBlank && !bBlank) return 1;
      if (!aBlank && bBlank) return -1;
      const getNum = (vals: (string | number)[]) => {
        const v = vals[1];
        if (v === "" || v === null || v === undefined) return 0;
        return typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, "")) || 0;
      };
      return getNum(b.values) - getNum(a.values);
    });
  }

  // ── Step 5: Grand Total row ──
  // MATHEMATICAL INTEGRITY: Computed from the filtered data ONLY.
  const grandTotalValues: (string | number)[] = ["Grand Total"];

  headerCols.forEach((col) => {
    if (col.agg === "count") {
      const count = data.filter((r) => {
        const v = r[col.field];
        return v != null && !isNullCategoryValue(v);
      }).length;
      grandTotalValues.push(count > 0 ? formatNumDynamic(count) : "0");
    } else {
      const allValues: number[] = [];
      data.forEach((r) => {
        const num = forceNumeric(r[col.field]);
        if (num !== null) allValues.push(num);
      });
      if (allValues.length === 0) {
        grandTotalValues.push("0");
      } else if (col.agg === "sum") {
        const sum = Math.round(allValues.reduce((a, b) => a + b, 0) * 100) / 100;
        grandTotalValues.push(formatNumDynamic(sum));
      } else {
        const avg = Math.round((allValues.reduce((a, b) => a + b, 0) / allValues.length) * 100) / 100;
        grandTotalValues.push(formatNumDynamic(avg));
      }
    }
  });

  return {
    headers,
    rows,
    grandTotal: { label: "Grand Total", values: grandTotalValues },
  };
}

// ════════════════════════════════════════════════════════════
// CROSSTAB PIVOT ENGINE — Traditional 2D Pivot (Excel-style)
// ════════════════════════════════════════════════════════════
function generateCrosstabPivot(
  data: RawDataRow[],
  rowField: string,
  columnField: string,
  valueField: string,
  aggregation: "sum" | "avg" | "count" | "min" | "max"
): {
  headers: string[];
  rows: { label: string; values: (string | number)[] }[];
  grandTotal: { label: string; values: (string | number)[] };
} {
  const validAgg = ["sum", "avg", "count", "min", "max"].includes(aggregation) ? aggregation : "sum";

  const pivot = new Map<string, Map<string, number[]>>();
  const rowCaseFreq = new Map<string, Map<string, number>>();
  const colCaseFreq = new Map<string, Map<string, number>>();
  const rowLabelMap = new Map<string, string>();
  const colLabelMap = new Map<string, string>();

  data.forEach((row) => {
    const rawRowVal = row[rowField];
    let rowKey: string;
    let rowOriginal: string;
    if (isNullCategoryValue(rawRowVal)) {
      rowKey = "__blank__";
      rowOriginal = "(blank)";
    } else {
      const s = String(rawRowVal).trim().replace(/\s+/g, " ");
      rowKey = s.toLowerCase();
      rowOriginal = s;
    }
    if (!rowCaseFreq.has(rowKey)) rowCaseFreq.set(rowKey, new Map());
    const freq = rowCaseFreq.get(rowKey)!;
    freq.set(rowOriginal, (freq.get(rowOriginal) || 0) + 1);
    let maxCount = 0;
    for (const [val, count] of freq) {
      if (count > maxCount) { maxCount = count; rowLabelMap.set(rowKey, val); }
    }

    const rawColVal = row[columnField];
    let colKey: string;
    let colOriginal: string;
    if (isNullCategoryValue(rawColVal)) {
      colKey = "__blank__";
      colOriginal = "(blank)";
    } else {
      const s = String(rawColVal).trim().replace(/\s+/g, " ");
      colKey = s.toLowerCase();
      colOriginal = s;
    }
    if (!colCaseFreq.has(colKey)) colCaseFreq.set(colKey, new Map());
    const cFreq = colCaseFreq.get(colKey)!;
    cFreq.set(colOriginal, (cFreq.get(colOriginal) || 0) + 1);
    let cMaxCount = 0;
    for (const [val, count] of cFreq) {
      if (count > cMaxCount) { cMaxCount = count; colLabelMap.set(colKey, val); }
    }

    const numericVal = forceNumeric(row[valueField]);

    if (!pivot.has(rowKey)) pivot.set(rowKey, new Map());
    const colMap = pivot.get(rowKey)!;
    if (!colMap.has(colKey)) colMap.set(colKey, []);
    if (numericVal !== null) {
      colMap.get(colKey)!.push(numericVal);
    }
  });

  // DYNAMIC EXCLUSION: Only row keys that exist in the pivot Map are included.
  // Categories with zero records after filtering won't be in the Map.
  const rowKeys = [...pivot.keys()];
  const colKeys = [...colLabelMap.keys()].sort((a, b) => {
    if (a === "__blank__" && b !== "__blank__") return 1;
    if (a !== "__blank__" && b === "__blank__") return -1;
    return (colLabelMap.get(a) || a).toLowerCase().localeCompare((colLabelMap.get(b) || b).toLowerCase());
  });

  const aggregate = (values: number[]): number | null => {
    if (values.length === 0) return null;
    switch (validAgg) {
      case "sum": return Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100;
      case "avg": return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
      case "count": return values.length;
      case "min": return Math.min(...values);
      case "max": return Math.max(...values);
      default: return null;
    }
  };

  const headers = [
    cleanHeader(rowField),
    ...colKeys.map((k) => colLabelMap.get(k) || "(blank)"),
    "Grand Total",
  ];

  const rows: { label: string; values: (string | number)[] }[] = [];

  rowKeys.forEach((rowKey) => {
    const colMap = pivot.get(rowKey);
    const displayLabel = rowLabelMap.get(rowKey) || "(blank)";
    const rowValues: (string | number)[] = [displayLabel];
    const allRowValues: number[] = [];

    colKeys.forEach((colKey) => {
      const values = colMap?.get(colKey) ?? [];
      allRowValues.push(...values);
      const agg = aggregate(values);
      rowValues.push(agg === null ? "" : formatNumCrosstab(agg, validAgg));
    });
    const rowTotal = aggregate(allRowValues);
    rowValues.push(rowTotal === null ? "" : formatNumCrosstab(rowTotal, validAgg));

    rows.push({ label: displayLabel, values: rowValues });
  });

  rows.sort((a, b) => {
    const aBlank = a.label === "(blank)";
    const bBlank = b.label === "(blank)";
    if (aBlank && !bBlank) return 1;
    if (!aBlank && bBlank) return -1;
    const getNum = (vals: (string | number)[]) => {
      const v = vals[vals.length - 1];
      if (v === "" || v === null || v === undefined) return 0;
      return typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, "")) || 0;
    };
    return getNum(b.values) - getNum(a.values);
  });

  // Grand Total row — computed from filtered data only (MATHEMATICAL INTEGRITY)
  const grandTotalValues: (string | number)[] = ["Grand Total"];
  const allValues: number[] = [];
  colKeys.forEach((colKey) => {
    const colValues: number[] = [];
    rowKeys.forEach((rk) => {
      const colMap = pivot.get(rk);
      if (colMap?.has(colKey)) colValues.push(...(colMap.get(colKey) ?? []));
    });
    allValues.push(...colValues);
    const agg = aggregate(colValues);
    grandTotalValues.push(agg === null ? "" : formatNumCrosstab(agg, validAgg));
  });
  const gt = aggregate(allValues);
  grandTotalValues.push(gt === null ? "" : formatNumCrosstab(gt, validAgg));

  return { headers, rows, grandTotal: { label: "Grand Total", values: grandTotalValues } };
}

// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════
function buildColumnSummary(columns: ColumnMeta[]) {
  return columns.map((col) => {
    let extra = "";
    if (col.type === "number" && col.sampleValues.length > 0) {
      const nums = col.sampleValues
        .map((v) => (typeof v === "number" ? v : forceNumeric(v)))
        .filter((v): v is number => v !== null);
      if (nums.length > 0) {
        const min = Math.min(...nums);
        const max = Math.max(...nums);
        extra = ` (min=${min}, max=${max})`;
      }
    }
    if (col.type === "string" && col.uniqueCount <= 20 && col.sampleValues.length > 0) {
      const vals = col.sampleValues.slice(0, 10).map(String).join(", ");
      extra = ` (examples: ${vals})`;
    }
    return `  - ${col.name}: type=${col.type}, unique=${col.uniqueCount}, missing=${col.missingCount}${extra}`;
  }).join("\n");
}

function parseResponse(text: string): Record<string, unknown> {
  let cleaned = text.trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) cleaned = jsonMatch[0];
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function smartAggregationDefault(valueField: string, columns: ColumnMeta[]): "sum" | "avg" | "count" | "min" | "max" {
  const col = columns.find((c) => c.name === valueField);
  if (!col || col.type !== "number") return "count";
  const name = valueField.toLowerCase();
  if (/rate|ratio|percentage|score|avg|average|index|pct/.test(name)) return "avg";
  if (/count|quantity|qty|num|number|total/.test(name)) return "sum";
  return "sum";
}

// ════════════════════════════════════════════════════════════
// API ROUTE
// ════════════════════════════════════════════════════════════
export async function POST(request: NextRequest) {
  try {
    const body: PivotRequest = await request.json();
    const { data, columns, userMessage } = body;

    if (!data || !Array.isArray(data) || data.length === 0) {
      return NextResponse.json({ error: "No data provided" }, { status: 400 });
    }
    if (!userMessage || typeof userMessage !== "string") {
      return NextResponse.json({ error: "No pivot description provided" }, { status: 400 });
    }

    const validColumns = new Set(columns.map((c) => c.name));
    const numericCols = columns.filter((c) => c.type === "number").map((c) => c.name);
    const dimensionCols = columns
      .filter((c) => c.type === "string" && !isLikelyIdentifier(c))
      .map((c) => c.name);
    const allCategoricalCols = columns
      .filter((c) => c.type === "string" && c.uniqueCount < 50)
      .map((c) => c.name);
    const safeColumnFieldCols = allCategoricalCols.filter(
      (name) => !isLikelyIdentifier(columns.find((c) => c.name === name)!)
    );
    const headcountField = findHeadcountColumn(columns);

    const zai = await ZAI.create();
    const columnSummary = buildColumnSummary(columns);

    // ══════════════════════════════════════════════════════
    // AI SYSTEM PROMPT — Pre-Aggregation Filter-First Pivot
    // ══════════════════════════════════════════════════════
    const systemPrompt = `Act as a Data Architect. You build pivot tables with THREE phases of reasoning:

═══ PHASE 1: FILTER (HIGHEST PRIORITY) ═══
ALWAYS scan the user's message FIRST for conditional constraints. These are phrases that limit WHICH records to include:
- Direct comparisons: "Rating > 4.5", "Salary over 50k", "Age > 30"
- Semantic filters: "Top performers" → implies high rating/score filter, "High earners" → implies high salary filter
- Range filters: "Experience between 5 and 10 years", "Salary from 30k to 60k"
- Categorical filters: "Only HR and Engineering", "Dept = IT", "Location contains Delhi"
- Inclusion/exclusion: "Exclude unpaid", "Only active employees"

When a filter is detected, extract it into the "filters" array. Use semantic reasoning to map natural language to column names and numeric thresholds from the dataset.

═══ PHASE 2: DIMENSION (Grouping) ═══
After identifying filters, determine HOW to group the remaining records:
- Dimensions: Categorical fields used for ROWS grouping
- Map user's requested category to the appropriate Dimension
- Do NOT place Dimensions in Columns unless user explicitly asks for cross-tab

═══ PHASE 3: MEASURE (Calculation) ═══
Finally, determine WHAT to calculate:
- Measures: Numerical fields for aggregation (Sum, Avg)
- Default: SUM and AVERAGE for all Measures unless user specifies otherwise
- Include Headcount unless user wants minimal output

═══ ANTI-HARDCODING PROTOCOL ═══
- Do NOT assume or persist any field names from previous sessions
- Dynamically scan the CURRENT dataset headers to match user intent
- Resolve naming variations (e.g., 'City' vs 'Location') by matching to available columns
- Each request is completely INDEPENDENT — no memory of previous pivots

═══ FILTER OPERATORS ═══
Use these operators in the filters array:
- Numeric: ">", ">=", "<", "<=", "=", "!="
- Text: "contains", "not_contains", "=", "!="
- Lists: "in", "not_in" (value must be an array)

═══ RESPONSE FORMAT ═══
Respond with ONLY valid JSON. No markdown, no explanation outside JSON.

FOR DYNAMIC MODE (default):
{
  "pivotMode": "dynamic",
  "title": "Descriptive title",
  "filters": [
    {"field": "Column_Name", "operator": ">", "value": 4.5, "label": "Rating > 4.5"}
  ],
  "rowField": "exact_column_name",
  "measures": [
    {"field": "exact_numeric_column", "aggregations": ["sum", "avg"]}
  ],
  "includeHeadcount": true,
  "aiMessage": "1-2 sentence explanation of what was filtered and shown"
}

FOR CROSS-TAB MODE (ONLY when user explicitly asks for two dimensions):
{
  "pivotMode": "crosstab",
  "title": "Descriptive title",
  "filters": [],
  "rowField": "exact_row_dimension",
  "columnField": "exact_column_dimension",
  "valueField": "exact_measure_column",
  "aggregation": "sum|avg|count|min|max",
  "aiMessage": "1-2 sentence explanation"
}

CRITICAL RULES:
- If no filter is needed, set "filters": []
- The "label" field in each filter is a human-readable description (e.g., "Rating > 4.5")
- filter.field MUST exactly match a column name from the dataset
- filter.value for "in"/"not_in" must be an array
- rowField MUST exactly match a column name from the dataset
- measures[].field MUST exactly match a numeric column name from the dataset
- COLUMN NAMES must come from the provided metadata. Never invent column names.`;

    const userPrompt = `USER REQUEST:
"${userMessage}"

CURRENT DATASET METADATA:
${columnSummary}

AVAILABLE DIMENSIONS (for rows): ${dimensionCols.length > 0 ? dimensionCols.join(", ") : "(none)"}
AVAILABLE MEASURES (for values): ${numericCols.length > 0 ? numericCols.join(", ") : "(none)"}
DETECTED HEADCOUNT FIELD: ${headcountField || "(none found)"}
SAFE CROSS-TAB COLUMNS: ${safeColumnFieldCols.length > 0 ? safeColumnFieldCols.join(", ") : "(none)"}

SAMPLE DATA (first 5 rows):
${JSON.stringify(data.slice(0, 5), null, 2)}

STEP 1: Identify any filters in the user's request. Extract them into the filters array.
STEP 2: Determine the dimension (row grouping).
STEP 3: Determine the measures and aggregations.
Respond with ONLY valid JSON.`;

    const completion = await zai.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.5,
    });

    const rawContent = completion.choices?.[0]?.message?.content;
    if (!rawContent) {
      return NextResponse.json({ error: "No response from AI" }, { status: 500 });
    }

    const parsed = parseResponse(rawContent);
    const pivotMode = parsed.pivotMode === "crosstab" ? "crosstab" : "dynamic";

    // ══════════════════════════════════════════════════════
    // PRE-AGGREGATION FILTERING — The Filter-First Rule
    //
    // Before ANY grouping or calculation, apply filters.
    // All subsequent pivot results derived ONLY from filtered subset.
    // ══════════════════════════════════════════════════════
    const totalRecordsBeforeFilter = data.length;
    let workingData = data;
    let appliedFilters: FilterSpec[] = [];
    let filterDescription = "";
    let filterErrors: string[] = [];

    if (Array.isArray(parsed.filters) && parsed.filters.length > 0) {
      const rawFilters: FilterSpec[] = parsed.filters
        .filter((f: unknown) => f != null && typeof f === "object" && "field" in f && "operator" in f)
        .map((f: unknown) => {
          const obj = f as Record<string, unknown>;
          return {
            field: String(obj.field),
            operator: String(obj.operator),
            value: obj.value,
            label: obj.label ? String(obj.label) : undefined,
          } as FilterSpec;
        });

      const validOperators = new Set([
        ">", ">=", "<", "<=", "=", "!=",
        "contains", "not_contains", "in", "not_in",
      ]);

      const validFilterSpecs = rawFilters.filter((f) => validOperators.has(f.operator));

      if (validFilterSpecs.length > 0) {
        const result = applyFilters(data, validFilterSpecs, columns);
        workingData = result.filteredData;
        appliedFilters = result.appliedFilters;
        filterErrors = result.errors;

        // Build human-readable filter description
        const filterLabels = appliedFilters.map((f) => f.label || `${f.field} ${f.operator} ${JSON.stringify(f.value)}`);
        filterDescription = filterLabels.join(" AND ");

        // If filter eliminated ALL records, return an error
        if (workingData.length === 0) {
          return NextResponse.json({
            error: `Filter "${filterDescription}" excluded all ${totalRecordsBeforeFilter} records. Try a less restrictive filter.`,
            filters: appliedFilters,
            filterDescription,
            totalRecordsBeforeFilter,
            totalRecordsAfterFilter: 0,
          }, { status: 200 });
        }
      }
    }

    const totalRecordsAfterFilter = workingData.length;

    // ── DYNAMIC MODE ──
    if (pivotMode === "dynamic") {
      const rowField = validColumns.has(String(parsed.rowField))
        ? String(parsed.rowField)
        : dimensionCols[0] || allCategoricalCols[0];

      const measureSpecs: MeasureSpec[] = [];
      if (Array.isArray(parsed.measures) && parsed.measures.length > 0) {
        for (const m of parsed.measures) {
          const field = String(m?.field);
          const aggs = Array.isArray(m?.aggregations) ? m.aggregations.map(String) : [];
          if (validColumns.has(field) && columns.find((c) => c.name === field)?.type === "number") {
            const validAggs = aggs.filter((a) => ["sum", "avg"].includes(a)) as ("sum" | "avg")[];
            if (validAggs.length > 0) {
              measureSpecs.push({ field, aggregations: validAggs });
            }
          }
        }
      }

      // Fallback: if AI returned NO valid measure specs, use all numeric with sum+avg
      if (measureSpecs.length === 0 && numericCols.length > 0) {
        for (const col of numericCols) {
          measureSpecs.push({ field: col, aggregations: ["sum", "avg"] });
        }
      }

      if (!rowField || measureSpecs.length === 0) {
        return NextResponse.json({ error: "Could not determine valid dimensions/measures for dynamic pivot" }, { status: 400 });
      }

      const includeHeadcount = parsed.includeHeadcount !== false && headcountField !== null;

      // ══════════════════════════════════════════════════════
      // DYNAMIC EXCLUSION + MATHEMATICAL INTEGRITY
      //
      // workingData is already filtered.
      // The engine only groups records that exist → zero-record categories excluded.
      // All measures and Grand Total computed from workingData only.
      // ══════════════════════════════════════════════════════
      const tableData = generateDynamicPivot(workingData, rowField, measureSpecs, includeHeadcount, headcountField);

      const response: PivotResponse = {
        title: typeof parsed.title === "string" && parsed.title.trim()
          ? parsed.title
          : `Dynamic Summary by ${rowField}`,
        pivotMode: "dynamic",
        rowField,
        measures: measureSpecs,
        headcountField: includeHeadcount ? (headcountField || undefined) : undefined,
        tableData,
        aiMessage: typeof parsed.aiMessage === "string"
          ? parsed.aiMessage
          : `Multi-measure summary grouped by ${rowField}.`,
      };

      // Add filter metadata if filters were applied
      if (appliedFilters.length > 0) {
        response.filters = appliedFilters;
        response.totalRecordsBeforeFilter = totalRecordsBeforeFilter;
        response.totalRecordsAfterFilter = totalRecordsAfterFilter;
        response.filterDescription = filterDescription;
        // Append filter info to aiMessage if AI didn't mention it
        if (!response.aiMessage.toLowerCase().includes("filter") && !response.aiMessage.toLowerCase().includes(totalRecordsAfterFilter.toString())) {
          response.aiMessage += ` (Filtered: ${totalRecordsAfterFilter.toLocaleString("en-IN")} of ${totalRecordsBeforeFilter.toLocaleString("en-IN")} records where ${filterDescription})`;
        }
      }

      return NextResponse.json(response satisfies PivotResponse);
    }

    // ── CROSS-TAB MODE ──
    const rowField = validColumns.has(String(parsed.rowField))
      ? String(parsed.rowField)
      : allCategoricalCols[0];

    let columnField: string;
    if (validColumns.has(String(parsed.columnField))) {
      columnField = String(parsed.columnField);
    } else {
      columnField = safeColumnFieldCols[0] || allCategoricalCols[1] || allCategoricalCols[0];
    }

    const valueField = validColumns.has(String(parsed.valueField))
      ? String(parsed.valueField)
      : numericCols[0];

    let aggregation: "sum" | "avg" | "count" | "min" | "max";
    const valueCol = columns.find((c) => c.name === valueField);
    if (valueCol && valueCol.type !== "number") {
      aggregation = "count";
    } else if (["sum", "avg", "count", "min", "max"].includes(String(parsed.aggregation))) {
      aggregation = parsed.aggregation as "sum" | "avg" | "count" | "min" | "max";
    } else {
      aggregation = smartAggregationDefault(valueField, columns);
    }

    if (!rowField || !columnField || !valueField) {
      return NextResponse.json({ error: "Could not determine valid columns for crosstab pivot" }, { status: 400 });
    }

    // ══════════════════════════════════════════════════════
    // Same Filter-First + Dynamic Exclusion + Math Integrity
    // applies to crosstab mode too.
    // ══════════════════════════════════════════════════════
    const tableData = generateCrosstabPivot(workingData, rowField, columnField, valueField, aggregation);

    const response: PivotResponse = {
      title: typeof parsed.title === "string" && parsed.title.trim()
        ? parsed.title
        : `${aggregation} of ${valueField} by ${rowField} and ${columnField}`,
      pivotMode: "crosstab",
      rowField,
      columnField,
      valueField,
      aggregation,
      tableData,
      aiMessage: typeof parsed.aiMessage === "string"
        ? parsed.aiMessage
        : "Crosstab pivot table created.",
    };

    if (appliedFilters.length > 0) {
      response.filters = appliedFilters;
      response.totalRecordsBeforeFilter = totalRecordsBeforeFilter;
      response.totalRecordsAfterFilter = totalRecordsAfterFilter;
      response.filterDescription = filterDescription;
      if (!response.aiMessage.toLowerCase().includes("filter")) {
        response.aiMessage += ` (Filtered: ${totalRecordsAfterFilter.toLocaleString("en-IN")} of ${totalRecordsBeforeFilter.toLocaleString("en-IN")} records)`;
      }
    }

    return NextResponse.json(response satisfies PivotResponse);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[pivot] Error:", message);
    return NextResponse.json({ error: `Failed to create pivot table: ${message}` }, { status: 500 });
  }
}
