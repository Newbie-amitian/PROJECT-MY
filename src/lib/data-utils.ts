// ============================================================
// Data Processing Utilities
// ============================================================
import type {
  RawDataRow,
  ColumnMeta,
  DataCleaningResult,
  TransformationResult,
  KPIConfig,
  ChartConfig,
  FilterConfig,
  StyleConfig,
  DashboardConfig,
} from "./dashboard-types";

// ---- CSV Parsing (Header-Aware Context-Smart Merge) ----
//
// When a row has MORE comma-separated values than the header count,
// it means a comma is embedded inside a cell value (e.g., "Py, Java").
// Instead of breaking the data, we use the header as a blueprint:
//
// 1. CLASSIFY each column: numeric | identity | list | text
//    - Can be done via AI (dynamic, any column name) or regex (fallback)
// 2. Anchor numeric columns from the RIGHT
// 3. Anchor identity columns from the LEFT
// 4. Text columns after last list → smart right-scan (location heuristic)
// 5. Remaining columns → left-to-right distribution (list absorbs extras)

// Column classification for smart merge
export type ColClass = "numeric" | "identity" | "list" | "text";

const IDENTITY_PATTERNS = /^(\#|sno|sr_no|s_no|serial|sl_no|row|no\.?|num|emp_id|employee_id|empid|id|user_id|userid|uid|first_name|last_name|full_name|name|email|phone|mobile|pan|aadhar|passport|account)/;

const LIST_PATTERNS = /^(skills|skill|tags|tag|categories|category|languages|language|hobbies|hobby|courses|course|subjects|subject|interests|tools|technologies|tech|stack|qualifications|qualif|certifications|cert|specializations|spec|languages_known|known_langs|proficiencies|competencies|domains|projects|project|roles|role|responsibilities|duties|achievements|awards|publications|patents)/;

const NUMERIC_PATTERNS = /^(salary|pay|wage|income|ctc|amount|price|cost|revenue|expense|age|experience|exp|year|rating|score|percent|pct|gpa|cgpa|marks|grade_num|quantity|qty|count|total|sum|average|avg|number|num|height|weight|length|width|distance|duration|hours|minutes|seconds)/;

export function classifyColumnRegex(header: string, colIdx: number): ColClass {
  const lower = header.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (IDENTITY_PATTERNS.test(lower)) return "identity";
  if (LIST_PATTERNS.test(lower)) return "list";
  if (NUMERIC_PATTERNS.test(lower)) return "numeric";
  // Single char like "#" or "S" at index 0 → likely a serial number
  if (colIdx === 0 && /^[\#sS]$/.test(header.trim())) return "numeric";
  return "text";
}

/**
 * Parse CSV text into raw headers + string[][] rows (no smart merge).
 * Used by frontend to detect embedded commas before calling AI classification.
 */
export function parseCSVRaw(text: string): { headers: string[]; rawRows: string[][]; hasEmbeddedCommas: boolean } {
  // Strip UTF-8 BOM if present
  let cleaned = text.replace(/^\uFEFF/, "");
  cleaned = cleaned.replace(/\r\n/g, "\n").replace(/\r/g, "");

  const lines = cleaned.trim().split("\n");
  if (lines.length < 2) return { headers: [], rawRows: [], hasEmbeddedCommas: false };

  let headers = parseCSVLine(lines[0]);
  headers = headers.map((h) => h.trim().replace(/^\uFEFF/, ""));
  while (headers.length > 0 && headers[headers.length - 1] === "") {
    headers.pop();
  }

  // Deduplicate column names
  const seen = new Map<string, number>();
  headers = headers.map((h) => {
    if (!h) return h;
    const lower = h.toLowerCase();
    const count = seen.get(lower) ?? 0;
    seen.set(lower, count + 1);
    return count === 0 ? h : `${h}_${count + 1}`;
  });

  const N = headers.length;

  const rawRows: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;
    const values = parseCSVLine(line);
    while (values.length > 0 && values[values.length - 1].trim() === "") {
      values.pop();
    }
    if (values.length > 0) rawRows.push(values);
  }

  const hasEmbeddedCommas = rawRows.some((r) => r.length > N);
  return { headers, rawRows, hasEmbeddedCommas };
}

export function parseCSV(text: string, aiColClasses?: ColClass[]): RawDataRow[] {
  const { headers, rawRows } = parseCSVRaw(text);
  if (headers.length === 0 || rawRows.length === 0) return [];

  const N = headers.length;

  // ---- PASS 2: Detect if embedded commas exist ----
  const hasExtraCols = rawRows.some((r) => r.length > N);

  if (!hasExtraCols) {
    // No embedded commas — standard parsing (fast path)
    return buildRows(rawRows, headers);
  }

  // ---- PASS 3: Classify all columns ----
  // Use AI classifications if provided, otherwise fall back to regex
  const colClasses: ColClass[] = aiColClasses && aiColClasses.length === N
    ? aiColClasses
    : headers.map((h, i) => classifyColumnRegex(h, i));

  // Validate: if well-formed rows exist, check if data matches header classification
  const wellFormed = rawRows.filter((r) => r.length === N);
  if (wellFormed.length > 0) {
    for (let colIdx = 0; colIdx < N; colIdx++) {
      if (colClasses[colIdx] === "numeric") continue; // already classified
      let numericCount = 0;
      let totalNonNull = 0;
      for (const row of wellFormed) {
        const val = row[colIdx]?.trim();
        if (val === "" || val === "null" || val === "N/A" || val === "-") continue;
        totalNonNull++;
        if (!isNaN(Number(val))) numericCount++;
      }
      // Data overrides header if >80% numeric and header said non-numeric
      if (totalNonNull > 0 && numericCount / totalNonNull > 0.8) {
        colClasses[colIdx] = "numeric";
      }
    }
  }

  // ---- PASS 4: Context-aware smart merge ----
  // Strategy: values flow LEFT-TO-RIGHT across remaining columns.
  // Numeric columns anchor from RIGHT, identity from LEFT.
  // Then all remaining columns (text + list) are filled left-to-right:
  //   - Text columns get exactly 1 value each
  //   - List columns absorb the extras (proportionally)
  // This ensures "SQL, Python, Dashboard Project, Mumbai, Migrator 2.0"
  // with headers [Skills(list), Projects(list), Location(text)] maps to:
  //   Skills="SQL, Python", Projects="Dashboard Project, Migrator 2.0", Location="Mumbai"

  const mergedRows = rawRows.map((values) => {
    if (values.length <= N) return values; // Already correct count

    // M > N — embedded commas detected
    const result = new Array<string>(N).fill("");
    const usedCols = new Set<number>();
    const consumedValIndices = new Set<number>();

    const consume = (valIdx: number): string => {
      consumedValIndices.add(valIdx);
      return values[valIdx].trim();
    };

    const isNumericValue = (s: string) => {
      const v = s.trim();
      return v !== "" && !isNaN(Number(v)) && !/^[A-Za-z]/.test(v);
    };

    // Step 1: Grab numeric-looking values from RIGHT, assign to numeric columns (right-to-left)
    const numericIndices = colClasses
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c === "numeric")
      .map(({ i }) => i);

    let numColIdx = numericIndices.length - 1;
    for (let vi = values.length - 1; vi >= 0 && numColIdx >= 0; vi--) {
      if (consumedValIndices.has(vi)) continue;
      if (!isNumericValue(values[vi])) continue;
      result[numericIndices[numColIdx]] = consume(vi);
      usedCols.add(numericIndices[numColIdx]);
      numColIdx--;
    }

    // Build array of remaining (unconsumed) value indices
    const remaining: number[] = [];
    for (let vi = 0; vi < values.length; vi++) {
      if (!consumedValIndices.has(vi)) remaining.push(vi);
    }
    let rLeft = 0;
    let rRight = remaining.length - 1;

    // Step 2: Identity columns from the LEFT (Name, Emp Id — single values)
    for (let colIdx = 0; colIdx < N; colIdx++) {
      if (usedCols.has(colIdx)) continue;
      if (colClasses[colIdx] !== "identity") continue;
      if (rLeft <= rRight) {
        result[colIdx] = values[remaining[rLeft]].trim();
        rLeft++;
        usedCols.add(colIdx);
      }
    }

    // Heuristic: is a value likely a location (not a skill or project name)?
    // Skip values with digits (versions like "2.0", "2024") or multi-word values
    // containing project-related keywords (Suite, Engine, Launch, etc.)
    const PROJECT_KEYWORDS = /\b(project|suite|engine|launch|initiative|program|platform|system|redesign|migration|mod|audit|portal|hub|tracker|manager|dashboard|app|web|game|physics|api|serv(ice|er))\b/i;
    const isLocationLike = (val: string): boolean => {
      const v = val.trim();
      if (!v) return false;
      if (/\d/.test(v)) return false; // "Migrator 2.0", "Audit 2024"
      if (/\s/.test(v) && PROJECT_KEYWORDS.test(v)) return false; // "API Suite", "Dashboard Project"
      return true;
    };

    // Step 3: Text columns AFTER the last list column → smart right-scan
    // Instead of blindly anchoring from right, scan from right and skip values
    // that look like project/skill names (digits, project keywords).
    // This ensures "Mumbai" is picked over "Migrator 2.0" for Location.
    const lastListIdx = remaining.length > 0
      ? (() => {
          let last = -1;
          for (let ci = 0; ci < N; ci++) {
            if (usedCols.has(ci)) continue;
            if (colClasses[ci] === "list") last = ci;
          }
          return last;
        })()
      : -1;

    // Process text columns after the last list (from right to left in column order)
    for (let ci = N - 1; ci > lastListIdx; ci--) {
      if (usedCols.has(ci)) continue;
      if (colClasses[ci] !== "text") continue;
      if (rLeft > rRight) break;

      // Scan from RIGHT, pick first location-like value
      let found = -1;
      for (let ri = rRight; ri >= rLeft; ri--) {
        if (isLocationLike(values[remaining[ri]])) {
          found = ri;
          break;
        }
      }

      if (found >= 0) {
        result[ci] = values[remaining[found]].trim();
        // Remove from remaining by shifting
        remaining.splice(found, 1);
        rRight--;
        usedCols.add(ci);
      } else {
        // Fallback: take rightmost value
        result[ci] = values[remaining[rRight]].trim();
        rRight--;
        usedCols.add(ci);
      }
    }

    // Step 4: Left-to-right distribution for remaining columns (text + list)
    // Collect remaining column indices in order, track which are list columns
    const remainingColSlots: { colIdx: number; isList: boolean }[] = [];
    for (let colIdx = 0; colIdx < N; colIdx++) {
      if (usedCols.has(colIdx)) continue;
      if (colClasses[colIdx] === "text" || colClasses[colIdx] === "list") {
        remainingColSlots.push({ colIdx, isList: colClasses[colIdx] === "list" });
      }
    }

    const totalVals = rRight - rLeft + 1;
    const totalCols = remainingColSlots.length;
    const numLists = remainingColSlots.filter((s) => s.isList).length;
    const extras = totalVals - totalCols; // values beyond the 1-per-column minimum

    // Build allocation: each column gets at least 1 value, list columns absorb extras
    const allocation = new Array(totalCols).fill(1);
    if (numLists > 0 && extras > 0) {
      let extrasLeft = extras;
      let listsRemaining = numLists;
      for (let si = 0; si < totalCols; si++) {
        if (!remainingColSlots[si].isList) continue;
        const give = Math.ceil(extrasLeft / listsRemaining);
        allocation[si] += give;
        extrasLeft -= give;
        listsRemaining--;
      }
    }

    // Assign values left-to-right according to allocation
    let vi = rLeft;
    for (let si = 0; si < totalCols; si++) {
      const { colIdx } = remainingColSlots[si];
      const count = allocation[si];
      const parts: string[] = [];
      for (let k = 0; k < count && vi <= rRight; k++) {
        parts.push(values[remaining[vi]].trim());
        vi++;
      }
      result[colIdx] = parts.join(", ");
      usedCols.add(colIdx);
    }

    // Step 5: Fallback — assign any remaining to unassigned columns
    for (let colIdx = 0; colIdx < N && vi <= rRight; colIdx++) {
      if (usedCols.has(colIdx)) continue;
      result[colIdx] = values[remaining[vi]].trim();
      vi++;
      usedCols.add(colIdx);
    }

    return result;
  });

  return buildRows(mergedRows, headers);
}

/**
 * Parse a single CSV line respecting quoted values.
 */
export function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// ── Version-Aware Value Detection ──────────────────────────
//
// Detects values that LOOK numeric (e.g. "2.0", "v1.3", "beta 2")
// but are actually TEXT — version numbers, identifiers, codes embedded
// within words or mixed content.  The logic is fully dynamic (no
// hardcoded column names) and works on the VALUE itself.

/**
 * Returns true when `raw` is a version-like or word-embedded numeric
 * token that must NOT be converted to a Number.
 *
 * Rules applied (in priority order):
 *  1. Values starting with 'v'/'V' prefix  → version identifiers (v1, V2.0, v1.3.4)
 *  2. Values surrounded by letters          → embedded versions (abc2.0, tool-v3, rel1)
 *  3. Values that are pure version patterns → multi-segment (1.2.3, 10.0.1)
 *  4. Numeric values with leading zeros      → identifiers (007, 01, 002)
 */
export function isVersionLikeOrEmbeddedNumeric(raw: string): boolean {
  const s = raw.trim();
  if (!s || s.length === 0) return false;

  // 1. Version prefix: v1, V2.0, v1.3.4-beta
  if (/^[vV]\d/.test(s)) return true;

  // 2. Alphabetic characters adjacent to numeric portion
  //    e.g. "Migrator 2.0", "SQL v3", "rel1", "phase-2", "build1234"
  //    We strip the numeric-like core and check if letters remain.
  const hasLetters = /[a-zA-Z]/.test(s);
  const hasDigits = /\d/.test(s);
  if (hasLetters && hasDigits) {
    // Something like "2.0" inside "Migrator 2.0" → has surrounding letters/spaces
    // Quick check: if a numeric-parseable token is bounded by letters or hyphens
    const numericTokenMatch = s.match(/(?<![a-zA-Z])\d+(\.\d+)+(?![a-zA-Z])/);
    if (numericTokenMatch) {
      const token = numericTokenMatch[0];
      const tokenIdx = s.indexOf(token);
      const before = s.slice(Math.max(0, tokenIdx - 1), tokenIdx);
      const after = s.slice(tokenIdx + token.length, tokenIdx + token.length + 1);
      // If preceded or followed by a letter (not just whitespace/separator), it's embedded
      if (/[a-zA-Z-]/.test(before) || /[a-zA-Z-]/.test(after)) return true;
    }
    // Pure mixed: "abc123", "build1234", "rel1"
    if (/\d/.test(s.replace(/[^a-zA-Z0-9]/g, ""))) {
      const stripped = s.replace(/[^a-zA-Z0-9]/g, "");
      // Has intermixed letters+numbers (not just separate tokens)
      if (/[a-zA-Z]\d/.test(stripped) || /\d[a-zA-Z]/.test(stripped)) return true;
    }
  }

  // 3. Multi-segment version pattern: 1.2.3, 10.0.1, 2.0.0-beta
  //    More than one dot in a numeric structure indicates a version, not a float
  if (/^\d+(\.\d+){2,}(-[a-zA-Z\d]+)?$/.test(s)) return true;

  // 4. Leading zeros on a pure number (excluding "0" itself): 007, 01, 002
  if (/^0\d+$/.test(s) && s.length > 1) return true;

  return false;
}

/**
 * Build a per-column "force text" map based on RAW string values
 * before type coercion.  If a column has a significant proportion
 * (>15 %) of version-like / embedded-numeric values, we force the
 * entire column to remain as Text — even values that look purely
 * numeric in that column will stay as strings.
 *
 * This is dynamic: it analyses actual DATA, not column names.
 */
function buildForceTextMap(
  rows: string[][],
  headers: string[]
): Map<number, boolean> {
  const map = new Map<number, boolean>();
  const N = headers.length;

  for (let ci = 0; ci < N; ci++) {
    let total = 0;
    let versionLike = 0;
    for (const row of rows) {
      const raw = row[ci];
      if (raw == null || raw.trim() === "") continue;
      total++;
      if (isVersionLikeOrEmbeddedNumeric(raw)) versionLike++;
    }
    // If >15 % of non-empty values are version-like → force text
    map.set(ci, total > 0 && (versionLike / total) > 0.15);
  }

  return map;
}

/**
 * Convert parsed string[][] rows into typed RawDataRow objects.
 *
 * Refinements applied:
 *  • Version-number-aware: values like "2.0", "v1", "abc2" are
 *    kept as strings, never coerced to numbers.
 *  • Null handling: empty cells (after split / trimming) become `null`,
 *    never `0` or any numeric fallback.
 */
function buildRows(rows: string[][], headers: string[]): RawDataRow[] {
  const forceTextMap = buildForceTextMap(rows, headers);

  return rows.map((values) => {
    const row: RawDataRow = {};
    headers.forEach((header, idx) => {
      const raw = values[idx];
      // Null handling: missing / empty after split → null (NOT 0)
      if (raw == null) {
        row[header] = null;
        return;
      }
      let val: string = raw.trim();
      if (val === "" || val === "null" || val === "NULL" || val === "undefined" || val === "N/A" || val === "NaN" || val === "nan" || val === "-") {
        row[header] = null;
        return;
      }

      // ── Version-aware check ──
      // If the value itself looks version-like OR the column is
      // force-text, keep as string.
      if (forceTextMap.get(idx) || isVersionLikeOrEmbeddedNumeric(val)) {
        row[header] = val;
        return;
      }

      // Standard type coercion
      if (!isNaN(Number(val)) && val !== "") {
        row[header] = Number(val);
      } else if (val.toLowerCase() === "true") {
        row[header] = true;
      } else if (val.toLowerCase() === "false") {
        row[header] = false;
      } else {
        row[header] = val;
      }
    });
    return row;
  });
}

// ---- Excel (.xlsx / .xls) Parsing ----

/**
 * Parse an Excel file (ArrayBuffer) into RawDataRow[].
 * Uses the `xlsx` (SheetJS) package which is already a dependency.
 *
 * Features:
 *  - Reads the FIRST sheet (by name order)
 *  - Converts date serial numbers to ISO strings
 *  - Strips BOM and trims whitespace from values
 *  - Passes through existing `buildRows` for version-aware type coercion
 */
export function parseExcel(buffer: ArrayBuffer): RawDataRow[] {
  // Dynamic import is handled at the call site; here we use the global XLSX
  // that the caller passes in (to keep this function pure and testable).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require("xlsx");

  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  if (!wb.SheetNames || wb.SheetNames.length === 0) return [];

  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];

  // Convert to array of arrays (header row + data rows)
  const aoa: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
  if (aoa.length < 2) return [];

  // Extract headers — skip completely empty header cells
  let headers: string[] = (aoa[0] as unknown[]).map((v) => String(v ?? "").trim().replace(/^\uFEFF/, ""));
  while (headers.length > 0 && headers[headers.length - 1] === "") headers.pop();
  if (headers.length === 0) return [];

  // Deduplicate column names (same logic as parseCSVRaw)
  const seen = new Map<string, number>();
  headers = headers.map((h) => {
    if (!h) return h;
    const lower = h.toLowerCase();
    const count = seen.get(lower) ?? 0;
    seen.set(lower, count + 1);
    return count === 0 ? h : `${h}_${count + 1}`;
  });

  const N = headers.length;
  const rawRows: string[][] = [];

  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i] as unknown[];
    const values: string[] = [];
    for (let ci = 0; ci < N; ci++) {
      const v = row[ci];
      if (v == null) {
        values.push("");
      } else if (v instanceof Date) {
        // Convert Excel date to ISO string (YYYY-MM-DD)
        values.push(v.toISOString().split("T")[0]);
      } else {
        values.push(String(v).trim());
      }
    }
    // Skip entirely empty rows
    if (values.some((v) => v !== "")) rawRows.push(values);
  }

  if (rawRows.length === 0) return [];

  return buildRows(rawRows, headers);
}

export function detectColumnTypes(rows: RawDataRow[]): ColumnMeta[] {
  if (rows.length === 0) return [];
  const columns = Object.keys(rows[0]);
  return columns.map((name) => {
    const values = rows.map((r) => r[name]).filter((v) => v !== null && v !== undefined);
    const uniqueSet = new Set(values.map(String));
    const missingCount = rows.length - values.length;
    const sampleValues = values.slice(0, 5);

    // ── Dynamic version-pattern heuristic ──
    // If >15 % of non-empty string representations in this column are
    // version-like (v1, 2.0, abc2, etc.) → force the whole column to "string".
    const allStrings = values.map(String);
    const nonEmpty = allStrings.filter((s) => s.trim() !== "");
    const versionCount = nonEmpty.filter(isVersionLikeOrEmbeddedNumeric).length;
    const isVersionColumn = nonEmpty.length > 0 && (versionCount / nonEmpty.length) > 0.15;

    let type: ColumnMeta["type"] = "unknown";
    if (values.length === 0) {
      type = "unknown";
    } else if (values.every((v) => typeof v === "boolean")) {
      type = "boolean";
    } else if (isVersionColumn) {
      // Force text: column contains version numbers, identifiers, codes
      type = "string";
    } else if (values.every((v) => typeof v === "number" || !isNaN(Number(v)))) {
      type = "number";
    } else if (values.every((v) => !isNaN(Date.parse(String(v))) && String(v).length > 4)) {
      type = "date";
    } else {
      type = "string";
    }

    return { name, type, nullable: missingCount > 0, uniqueCount: uniqueSet.size, sampleValues, missingCount };
  });
}

// ---- Data Cleaning ----
export function cleanData(rows: RawDataRow[]): { data: RawDataRow[]; report: DataCleaningResult } {
  const originalLength = rows.length;
  const columns = Object.keys(rows[0] || {});
  const missingValues: DataCleaningResult["missingValues"] = [];
  const typeCorrections: DataCleaningResult["typeCorrections"] = [];
  const outliers: DataCleaningResult["outliers"] = [];

  // Remove duplicates
  const seen = new Set<string>();
  let deduped = rows.filter((row) => {
    const key = JSON.stringify(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const duplicatesRemoved = rows.length - deduped.length;

  // Handle missing values and type corrections
  const numericColumns = new Map<string, { sum: number; count: number; values: number[] }>();

  deduped.forEach((row) => {
    columns.forEach((col) => {
      const val = row[col];
      if (val !== null && val !== undefined) {
        const num = Number(val);
        if (!isNaN(num) && val !== "" && val !== true && val !== false) {
          if (!numericColumns.has(col)) numericColumns.set(col, { sum: 0, count: 0, values: [] });
          const stats = numericColumns.get(col)!;
          stats.sum += num;
          stats.count++;
          stats.values.push(num);
        }
      }
    });
  });

  // Fill missing numeric values with column mean
  deduped = deduped.map((row) => {
    const newRow = { ...row };
    columns.forEach((col) => {
      if ((newRow[col] === null || newRow[col] === undefined) && numericColumns.has(col)) {
        const stats = numericColumns.get(col)!;
        newRow[col] = Math.round((stats.sum / stats.count) * 100) / 100;
        missingValues.push({ column: col, count: missingValues.filter((m) => m.column === col).length + 1, strategy: "filled_with_mean" });
      }
    });
    return newRow;
  });

  // Detect outliers using IQR method for numeric columns
  numericColumns.forEach((stats, col) => {
    const sorted = [...stats.values].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    const lower = q1 - 1.5 * iqr;
    const upper = q3 + 1.5 * iqr;
    const outlierCount = stats.values.filter((v) => v < lower || v > upper).length;
    if (outlierCount > 0) {
      outliers.push({ column: col, count: outlierCount, strategy: "iqr_detected" });
    }
  });

  // Remove rows with all-null values
  deduped = deduped.filter((row) => columns.some((col) => row[col] !== null && row[col] !== undefined));

  return {
    data: deduped,
    report: {
      missingValues: deduplicateMissing(missingValues),
      duplicatesRemoved,
      typeCorrections,
      outliers,
      cleanedRowCount: deduped.length,
      originalRowCount: originalLength,
    },
  };
}

function deduplicateMissing(items: { column: string; count: number; strategy: string }[]) {
  const map = new Map<string, { column: string; count: number; strategy: string }>();
  items.forEach((item) => {
    const existing = map.get(item.column);
    if (existing) {
      existing.count = item.count;
    } else {
      map.set(item.column, { ...item });
    }
  });
  return Array.from(map.values());
}

// ---- Transformation ----
export function analyzeData(rows: RawDataRow[], columns: ColumnMeta[]): TransformationResult {
  const numericCols = columns.filter((c) => c.type === "number").map((c) => c.name);
  const categoricalCols = columns.filter((c) => c.type === "string" && c.uniqueCount < 30).map((c) => c.name);
  const dateCols = columns.filter((c) => c.type === "date").map((c) => c.name);

  const summary: TransformationResult["summary"] = numericCols.map((col) => {
    const values = rows.map((r) => Number(r[col])).filter((v) => !isNaN(v));
    const sum = values.reduce((a, b) => a + b, 0);
    return {
      column: col,
      total: Math.round(sum * 100) / 100,
      avg: values.length > 0 ? Math.round((sum / values.length) * 100) / 100 : 0,
      min: values.length > 0 ? Math.min(...values) : 0,
      max: values.length > 0 ? Math.max(...values) : 0,
      count: values.length,
    };
  });

  // Auto-aggregation suggestions
  const aggregations: TransformationResult["aggregations"] = [];
  const groupByCandidates = [...categoricalCols, ...dateCols].slice(0, 3);
  groupByCandidates.forEach((gb) => {
    numericCols.slice(0, 2).forEach((measure) => {
      const grouped = new Map<string, number[]>();
      rows.forEach((r) => {
        const key = String(r[gb] ?? "Unknown");
        const val = Number(r[measure]);
        if (!isNaN(val)) {
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key)!.push(val);
        }
      });
      grouped.forEach((vals, key) => {
        aggregations.push({
          groupBy: [gb],
          measure,
          function: "sum",
          result: Math.round(vals.reduce((a, b) => a + b, 0) * 100) / 100,
        });
      });
    });
  });

  return { aggregations, pivotTables: [], summary };
}

// ---- Auto-generate Dashboard Config ----
export function autoGenerateDashboard(
  rows: RawDataRow[],
  columns: ColumnMeta[],
  cleaning: DataCleaningResult,
  transformation: TransformationResult
): DashboardConfig {
  const numericCols = columns.filter((c) => c.type === "number").map((c) => c.name);
  const categoricalCols = columns.filter((c) => c.type === "string" && c.uniqueCount < 30 && c.uniqueCount > 1).map((c) => c.name);
  const dateCols = columns.filter((c) => c.type === "date").map((c) => c.name);

  // KPIs: sum for top 4 numeric columns
  const kpis: KPIConfig[] = numericCols.slice(0, 4).map((col, i) => ({
    id: `kpi-${i}`,
    title: formatColumnTitle(col),
    column: col,
    aggregation: "sum",
    format: "compact",
  }));

  // Charts
  const charts: ChartConfig[] = [];
  let chartId = 0;

  // Time series if date column exists
  if (dateCols.length > 0 && numericCols.length > 0) {
    const dateCol = dateCols[0];
    // Aggregate by date
    const aggregated = aggregateByColumn(rows, dateCol, numericCols.slice(0, 2));
    charts.push({
      id: `chart-${chartId++}`,
      type: "area",
      title: "Trend Over Time",
      x: dateCol,
      y: numericCols.slice(0, 2),
      config: { stacked: false, curveType: "monotone", showLegend: true, showTooltip: true, stroke_width: 2 },
      width: 8,
      data: aggregated,
    });
  }

  // Bar chart: categorical x numeric
  if (categoricalCols.length > 0 && numericCols.length > 0) {
    const catCol = categoricalCols[0];
    const aggregated = aggregateByColumn(rows, catCol, [numericCols[0]]).slice(0, 10);
    charts.push({
      id: `chart-${chartId++}`,
      type: "bar",
      title: `${formatColumnTitle(numericCols[0])} by ${formatColumnTitle(catCol)}`,
      x: catCol,
      y: [numericCols[0]],
      config: { barThickness: 28, showLegend: false, showTooltip: true },
      width: 6,
      data: aggregated,
    });

    // Donut chart if few categories
    if (categoricalCols[0] && columns.find((c) => c.name === categoricalCols[0])!.uniqueCount <= 8) {
      const donutData = aggregateByColumn(rows, categoricalCols[0], [numericCols[0]]).slice(0, 8);
      charts.push({
        id: `chart-${chartId++}`,
        type: "donut",
        title: `${formatColumnTitle(numericCols[0])} Distribution`,
        x: categoricalCols[0],
        y: [numericCols[0]],
        config: { innerRadius: 60, outerRadius: 100, showLegend: true, showTooltip: true },
        width: 4,
        data: donutData,
      });
    }
  }

  // Scatter if 2+ numeric cols
  if (numericCols.length >= 2) {
    charts.push({
      id: `chart-${chartId++}`,
      type: "scatter",
      title: `${formatColumnTitle(numericCols[0])} vs ${formatColumnTitle(numericCols[1])}`,
      x: numericCols[0],
      y: [numericCols[1]],
      config: { showTooltip: true },
      width: 6,
      data: rows.slice(0, 200),
    });
  }

  // Second category chart if available
  if (categoricalCols.length > 1 && numericCols.length > 0) {
    const catCol2 = categoricalCols[1];
    const agg = aggregateByColumn(rows, catCol2, [numericCols[0]]).slice(0, 10);
    charts.push({
      id: `chart-${chartId++}`,
      type: "horizontal_bar",
      title: `${formatColumnTitle(numericCols[0])} by ${formatColumnTitle(catCol2)}`,
      x: catCol2,
      y: [numericCols[0]],
      config: { barThickness: 24, showLegend: false, showTooltip: true, orient: "horizontal" },
      width: 6,
      data: agg,
    });
  }

  // Combo chart if 2+ numeric cols
  if (numericCols.length >= 2 && dateCols.length > 0) {
    const aggregated = aggregateByColumn(rows, dateCols[0], numericCols.slice(0, 2));
    charts.push({
      id: `chart-${chartId++}`,
      type: "combo_chart",
      title: "Comparison Chart",
      x: dateCols[0],
      y: [numericCols[0]],
      additionalSeries: [{ key: numericCols[1], label: formatColumnTitle(numericCols[1]), type: "line" }],
      config: { stacked: false, showLegend: true, showTooltip: true, curveType: "monotone" },
      width: 6,
      data: aggregated,
    });
  }

  // Filters
  const filters: FilterConfig[] = [];
  categoricalCols.slice(0, 4).forEach((col, i) => {
    const uniqueValues = [...new Set(rows.map((r) => String(r[col] ?? "Unknown")))].filter(Boolean);
    filters.push({
      id: `filter-${i}`,
      column: col,
      label: formatColumnTitle(col),
      type: uniqueValues.length > 10 ? "multi-select" : "select",
      options: uniqueValues,
      selectedValues: [],
    });
  });

  const style: StyleConfig = {
    font_family: "Inter, sans-serif",
    font_sizes: { title: 20, subtitle: 14, axis: 12, label: 11, kpi_value: 28, kpi_label: 12 },
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

  return {
    title: "Data Dashboard",
    layout: "analytical",
    kpis,
    charts,
    filters,
    interactions: { cross_filtering: true, drill_down: true, hover: true },
    style,
  };
}

// ---- Helpers ----
export function aggregateByColumn(rows: RawDataRow[], groupCol: string, measureCols: string[]): RawDataRow[] {
  const groups = new Map<string, { count: number; sums: Record<string, number> }>();
  rows.forEach((row) => {
    const key = String(row[groupCol] ?? "Unknown");
    if (!groups.has(key)) groups.set(key, { count: 0, sums: {} });
    const group = groups.get(key)!;
    group.count++;
    measureCols.forEach((col) => {
      const val = Number(row[col]);
      if (!isNaN(val)) {
        group.sums[col] = (group.sums[col] || 0) + val;
      }
    });
  });

  return Array.from(groups.entries())
    .sort((a, b) => {
      const sumA = Object.values(a[1].sums).reduce((s, v) => s + v, 0);
      const sumB = Object.values(b[1].sums).reduce((s, v) => s + v, 0);
      return sumB - sumA;
    })
    .map(([key, group]) => {
      const row: RawDataRow = { [groupCol]: key };
      measureCols.forEach((col) => {
        row[col] = Math.round((group.sums[col] || 0) * 100) / 100;
      });
      return row;
    });
}

export function formatColumnTitle(col: string): string {
  return col
    .replace(/[_-]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatNumber(value: number, format: KPIConfig["format"]): string {
  switch (format) {
    case "currency":
      return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
    case "percent":
      return `${(value * 100).toFixed(1)}%`;
    case "compact":
      if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
      if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
      if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
      return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
    default:
      return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
}

export function computeKPI(rows: RawDataRow[], config: KPIConfig): number {
  const values = rows.map((r) => Number(r[config.column])).filter((v) => !isNaN(v));
  if (values.length === 0) return 0;

  switch (config.aggregation) {
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "avg":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "count":
      return values.length;
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
    case "median": {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }
    case "ratio":
      if (config.ratioDenominator) {
        const denom = rows.map((r) => Number(r[config.ratioDenominator!])).filter((v) => !isNaN(v) && v !== 0);
        const denomSum = denom.reduce((a, b) => a + b, 0);
        return denomSum !== 0 ? values.reduce((a, b) => a + b, 0) / denomSum : 0;
      }
      return 0;
    default:
      return 0;
  }
}

export function applyFilters(rows: RawDataRow[], filters: FilterConfig[]): RawDataRow[] {
  return rows.filter((row) => {
    return filters.every((filter) => {
      if (!filter.selectedValues || filter.selectedValues.length === 0) return true;
      const rowVal = String(row[filter.column] ?? "");
      return filter.selectedValues.includes(rowVal);
    });
  });
}
