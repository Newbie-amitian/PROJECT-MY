import { NextRequest, NextResponse } from "next/server";
import ZAI from "@/lib/ai-provider";
import type { RawDataRow, ColumnMeta } from "@/lib/dashboard-types";

interface SuggestionRequest {
  columns: ColumnMeta[];
  sampleData: RawDataRow[];
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

function buildGenericFallback(columns: ColumnMeta[]): string[] {
  const numericCols = columns.filter((c) => c.type === "number").map((c) => c.name);
  const dimensionCols = columns
    .filter((c) => c.type === "string" && !isLikelyIdentifier(c) && c.uniqueCount < 50 && c.uniqueCount > 1)
    .map((c) => c.name);

  // Identify columns useful for filtering (numeric with ranges, or categorical)
  const filterableNumCols = numericCols.filter((c) => {
    const nums = c.sampleValues
      .map((v) => (typeof v === "number" ? v : Number(v)))
      .filter((v) => !isNaN(v));
    if (nums.length < 2) return false;
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    return max - min > 0; // has a range worth filtering
  });

  const suggestions: string[] = [];

  // Dynamic pivot suggestions (primary)
  if (dimensionCols.length >= 1) {
    suggestions.push(`Pivot by ${dimensionCols[0]}`);
  }
  if (dimensionCols.length >= 2) {
    suggestions.push(`Show summary by ${dimensionCols[1]}`);
  }

  // Filtered pivot suggestions (NEW — demonstrates pre-aggregation filtering)
  if (filterableNumCols.length > 0 && dimensionCols.length >= 1) {
    const filterCol = filterableNumCols[0];
    const dimCol = dimensionCols[0];
    // Use a column name hint to generate a smart filter suggestion
    const colLower = filterCol.toLowerCase();
    if (/salary|pay|wage|income|ctc/.test(colLower)) {
      suggestions.push(`High earners (Salary > 50k) by ${dimCol}`);
    } else if (/rating|score|perf/.test(colLower)) {
      suggestions.push(`Top performers (${filterCol} > 4) by ${dimCol}`);
    } else if (/exp|year|tenure|age/.test(colLower)) {
      suggestions.push(`Senior staff (${filterCol} > 5) by ${dimCol}`);
    } else {
      suggestions.push(`Filtered ${dimCol} where ${filterCol} is above average`);
    }
  }

  // Cross-tab suggestions (secondary — explicit)
  if (numericCols.length > 0 && dimensionCols.length >= 2) {
    suggestions.push(
      `Cross-tab ${numericCols[0]} by ${dimensionCols[0]} and ${dimensionCols[1]}`
    );
  }

  // Ensure minimum
  if (dimensionCols.length >= 1 && suggestions.length < 3) {
    suggestions.push(`Dynamic summary by ${dimensionCols[0]}`);
  }
  if (suggestions.length < 3 && dimensionCols.length >= 2) {
    suggestions.push(`Group by ${dimensionCols[1]}`);
  }
  if (suggestions.length < 3) {
    suggestions.push("Create a summary pivot table");
  }

  return suggestions.slice(0, 5);
}

function parseSuggestionsResponse(text: string): string[] {
  let cleaned = text.trim();
  const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
  if (jsonMatch) cleaned = jsonMatch[0];
  cleaned = cleaned
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item) => typeof item === "string" && item.trim().length > 0)
        .map((item) => String(item).trim())
        .slice(0, 5);
    }
  } catch {
    // Not valid JSON
  }
  const lines = cleaned
    .split(/["\n]/)
    .map((l) => l.trim().replace(/^[-•*]\s*/, ""))
    .filter((l) => l.length > 5 && l.length < 200);
  return lines.slice(0, 5).length > 0 ? lines.slice(0, 5) : [];
}

export async function POST(request: NextRequest) {
  try {
    const body: SuggestionRequest = await request.json();
    const { columns, sampleData } = body;

    if (!columns || !Array.isArray(columns) || columns.length === 0) {
      return NextResponse.json(
        { suggestions: ["Create a summary pivot table"] },
        { status: 200 }
      );
    }

    const columnSummary = columns
      .map((col) => `  - ${col.name}: type=${col.type}, unique=${col.uniqueCount}, missing=${col.missingCount}`)
      .join("\n");

    const numericCols = columns.filter((c) => c.type === "number").map((c) => c.name);
    const dimensionCols = columns
      .filter((c) => c.type === "string" && !isLikelyIdentifier(c) && c.uniqueCount < 50 && c.uniqueCount > 1)
      .map((c) => c.name);

    const zai = await ZAI.create();

    const systemPrompt = `You are a stateless pivot suggestion generator. Each request is INDEPENDENT. Do NOT carry over assumptions from any previous requests.

Generate 4-5 short pivot table query suggestions based ONLY on the column data provided below.

SUGGESTION VARIETY (generate a mix of these — at least one MUST include a filter):
1. Dynamic summaries: "Pivot by X" or "Show summary by X" (most common)
2. FILTERED pivots (NEW): "Top performers (Rating > 4.5) by Dept", "High earners (Salary over 50k) by Location", "Experienced staff (Experience > 5) by Dept"
3. Specific measure queries: "Show avg Salary by Dept" or "Total Experience by Location"
4. Single cross-tab: "Cross-tab Salary by Dept and Location" (at most ONE)

RULES:
1. Each suggestion must be short (max 80 characters)
2. Each MUST reference actual column names from the dataset
3. Do NOT assume any previous user preferences or instructions
4. Mix different dimensions for variety
5. Include at least ONE suggestion with a numeric filter condition (e.g., "> 4.5", "over 50k", "above average")
6. Respond with ONLY a valid JSON array of strings (max 5)
7. Do NOT use markdown or code fences`;

    const sampleRows = Array.isArray(sampleData) ? sampleData.slice(0, 5) : [];

    const userPrompt = `COLUMNS:
${columnSummary}

DIMENSIONS (for grouping): ${dimensionCols.length > 0 ? dimensionCols.join(", ") : "(none)"}
MEASURES (for calculations): ${numericCols.length > 0 ? numericCols.join(", ") : "(none)"}

SAMPLE DATA (first 5 rows):
${JSON.stringify(sampleRows, null, 2)}

Generate 4-5 pivot suggestions. At least one should include a filter condition (e.g., "Top performers (Rating > 4) by Dept"). Respond with ONLY a JSON array of strings.`;

    const completion = await zai.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
    });

    const rawContent = completion.choices?.[0]?.message?.content;

    if (!rawContent) {
      return NextResponse.json({ suggestions: buildGenericFallback(columns) });
    }

    const parsed = parseSuggestionsResponse(rawContent);
    if (parsed.length === 0) {
      return NextResponse.json({ suggestions: buildGenericFallback(columns) });
    }

    const fallback = buildGenericFallback(columns);
    while (parsed.length < 3 && fallback.length > 0) {
      const next = fallback.shift();
      if (next && !parsed.includes(next)) parsed.push(next);
    }

    return NextResponse.json({ suggestions: parsed.slice(0, 5) });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[pivot-suggestions] Error:", message);
    try {
      const body = await request.clone().json();
      const columns: ColumnMeta[] = body?.columns;
      if (columns && Array.isArray(columns) && columns.length > 0) {
        return NextResponse.json({ suggestions: buildGenericFallback(columns) });
      }
    } catch { /* body parse failed */ }
    return NextResponse.json({
      suggestions: ["Create a summary pivot table", "Show totals by category", "Compare values across groups"],
    });
  }
}
