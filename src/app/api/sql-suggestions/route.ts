import { NextRequest, NextResponse } from "next/server";
import ZAI from "@/lib/ai-provider";
import type { RawDataRow, ColumnMeta } from "@/lib/dashboard-types";

interface SQLSuggestion {
  title: string;
  intent: string;
  sql: string;
  why_this_query_is_useful: string;
}

interface SuggestRequest {
  data: RawDataRow[];
  columns: ColumnMeta[];
  userInstructions?: string;
}

function buildSystemPrompt(): string {
  return `You are a SQL query suggestion engine for a data analytics platform.

You are given:
- Dataset schema (column names + inferred data types)
- Optional sample rows

Your task:
Generate intelligent, dataset-specific SQL query suggestions that help users explore insights.

────────────────────────────
RULES
────────────────────────────
1. DO NOT use hardcoded templates
2. ALL queries must depend on actual dataset columns
3. Only generate queries that make sense for detected data types
4. Prioritize business insights over generic queries
5. Table name is ALWAYS "dataset"
6. Do NOT use backticks or double quotes around column names
7. Do NOT use window functions (ROW_NUMBER, RANK, OVER, PARTITION BY)
8. Do NOT use CAST — the engine auto-detects types
9. Do NOT use semicolons at the end
10. Use LIMIT for top N results
11. Always specify ASC or DESC in ORDER BY
12. Wrap arithmetic inside aggregate functions in parentheses: SUM((col1 * col2))

────────────────────────────
QUERY TYPES TO GENERATE
────────────────────────────

Generate 5–10 SQL queries in categories:

### 1. Aggregation Insights
- SUM / AVG / COUNT based on numeric columns

### 2. Group By Analysis
- Group categorical columns with numeric aggregation

### 3. Ranking Queries
- TOP N / BOTTOM N based on numeric metrics

### 4. Distribution Queries
- Count distribution of categorical columns

### 5. Data Quality Queries
- NULL counts per column
- Invalid data detection

### 6. Outlier Detection
- Detect extreme values in numeric columns

────────────────────────────
CONTEXT RULES
────────────────────────────
- If dataset has NO dates → do not generate time-series queries
- If dataset has NO categorical columns → skip grouping queries
- Always prefer most meaningful business insight queries
- Include at least one "data quality" query

────────────────────────────
OUTPUT FORMAT
────────────────────────────
Return ONLY valid JSON array:

[
  {
    "title": "Short descriptive title",
    "intent": "aggregation|group_by|ranking|distribution|data_quality|outlier",
    "sql": "SELECT ... FROM dataset ...",
    "why_this_query_is_useful": "Brief explanation of business value"
  }
]`;
}

function buildUserPrompt(columns: ColumnMeta[], data: RawDataRow[], userInstructions?: string): string {
  const numericCols = columns.filter((c) => c.type === "number").map((c) => c.name);
  const categoricalCols = columns.filter((c) => c.type === "string" && c.uniqueCount < 50).map((c) => c.name);
  const dateCols = columns.filter((c) => c.type === "date").map((c) => c.name);
  const textCols = columns.filter((c) => c.type === "string" && c.uniqueCount >= 50).map((c) => c.name);

  const sampleRows = data.slice(0, 5).map((row) => {
    const clean: Record<string, string> = {};
    columns.forEach((c) => { clean[c.name] = row[c.name] == null ? "null" : String(row[c.name]); });
    return clean;
  });

  return `Generate SQL query suggestions for this dataset:

DATASET SUMMARY:
- Total rows: ${data.length}
- Total columns: ${columns.length}
- Numeric columns: ${numericCols.length > 0 ? numericCols.join(", ") : "none"}
- Categorical columns: ${categoricalCols.length > 0 ? categoricalCols.join(", ") : "none"}
- Date columns: ${dateCols.length > 0 ? dateCols.join(", ") : "none"}
- Text columns: ${textCols.length > 0 ? textCols.slice(0, 5).join(", ") : "none"}

COLUMNS:
${columns.map((c) => `  - ${c.name} (${c.type}, ${c.uniqueCount} unique, ${c.missingCount} missing)`).join("\n")}

SAMPLE DATA:
${JSON.stringify(sampleRows, null, 2)}

${userInstructions ? `USER CONTEXT: ${userInstructions}\n\n` : ""}Generate 5-10 diverse, meaningful SQL queries based on this dataset's actual structure. Every query must use ONLY columns that exist in this dataset.`;
}

export async function POST(request: NextRequest) {
  try {
    const body: SuggestRequest = await request.json();
    const { data, columns, userInstructions } = body;

    if (!data || !Array.isArray(data) || data.length === 0) {
      return NextResponse.json({ error: "No data provided" }, { status: 400 });
    }
    if (!columns || columns.length === 0) {
      return NextResponse.json({ error: "No columns provided" }, { status: 400 });
    }

    const zai = await ZAI.create();

    const completion = await zai.chat.completions.create({
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildUserPrompt(columns, data, userInstructions) },
      ],
      temperature: 0.3,
    });

    const rawContent = completion.choices?.[0]?.message?.content;
    if (!rawContent) {
      return NextResponse.json({ suggestions: [] });
    }

    // Parse the JSON array
    let suggestions: SQLSuggestion[] = [];
    try {
      let cleaned = rawContent.trim();
      const arrMatch = cleaned.match(/\[[\s\S]*\]/);
      if (arrMatch) cleaned = arrMatch[0];
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        suggestions = parsed.slice(0, 10).map((item: Record<string, unknown>, i: number) => ({
          title: String(item.title || `Query ${i + 1}`),
          intent: String(item.intent || "aggregation"),
          sql: String(item.sql || ""),
          why_this_query_is_useful: String(item.why_this_query_is_useful || ""),
        })).filter((s) => s.sql.trim().length > 0);
      }
    } catch {
      // Try to extract SQL blocks as fallback
      const sqlBlocks = rawContent.match(/SELECT[\s\S]+?(?=SELECT|```|$)/gi) || [];
      suggestions = sqlBlocks.slice(0, 10).map((sql, i) => ({
        title: `Query ${i + 1}`,
        intent: "aggregation",
        sql: sql.trim().replace(/;$/, ""),
        why_this_query_is_useful: "AI-generated query",
      }));
    }

    return NextResponse.json({ suggestions });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[sql-suggestions] Error:", message);
    return NextResponse.json({ suggestions: [] }, { status: 500 });
  }
}
