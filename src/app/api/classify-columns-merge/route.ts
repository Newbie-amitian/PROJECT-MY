import { NextRequest, NextResponse } from "next/server";
import ZAI, { type ZAIInstance } from "@/lib/ai-provider";

// ── ZAI instance (reuse across requests) ──────────────
let zaiInstance: ZAIInstance | null = null;

async function getZAI() {
  if (!zaiInstance) {
    zaiInstance = await ZAI.create();
  }
  return zaiInstance;
}

// ============================================================
// AI-Powered Column Classification for CSV Smart Merge
// ============================================================
// When CSV data has embedded commas (more values than headers),
// we need to know which columns can hold MULTIPLE values (list)
// vs SINGLE values (text, identity, numeric).
//
// This API uses AI to dynamically classify columns — no hardcoded
// column name patterns. Works with ANY column name in any language.
//
// Returns: mergeClass per column — "list" | "text" | "identity" | "numeric"

interface MergeClassifyRequest {
  headers: string[];
  sampleRows: string[][];  // up to 5 raw rows (comma-split values)
}

interface MergeClassifyResult {
  header: string;
  mergeClass: "list" | "text" | "identity" | "numeric";
  reasoning: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as MergeClassifyRequest;
    const { headers, sampleRows } = body;

    if (!headers || headers.length === 0) {
      return NextResponse.json({ error: "No headers provided" }, { status: 400 });
    }

    // Build sample data description
    const colCount = headers.length;
    const overflowRows = sampleRows.filter(r => r.length > colCount);
    const hasOverflow = overflowRows.length > 0;

    const headerList = headers.map((h, i) => `${i + 1}. "${h}"`).join("\n");

    // Show a few sample rows to give AI context
    const sampleDisplay = sampleRows.slice(0, 3).map((row, ri) => {
      const vals = row.map(v => `"${v}"`).join(", ");
      return `  Row ${ri + 1}: [${vals}] (${row.length} values for ${colCount} columns${row.length > colCount ? " — HAS EXTRA!" : ""})`;
    }).join("\n");

    const prompt = `You are a CSV data parsing expert. I have comma-separated data where some cell values contain commas inside them (e.g., a Skills column might have "Python, Java, SQL"). This causes rows to have MORE comma-separated values than the number of column headers.

HEADERS (${colCount} columns):
${headerList}

SAMPLE ROWS:
${sampleDisplay}

${hasOverflow ? `EMBEDDED COMMAS DETECTED: ${overflowRows.length} of ${sampleRows.length} rows have MORE values than headers. Some values in those rows contain commas that are NOT column separators — they are part of the cell value.` : "No embedded commas detected in sample rows."}

YOUR TASK: Classify each column so I know how to redistribute the extra values correctly.

CLASSIFICATION TYPES:
- "list" — Column that can contain MULTIPLE comma-separated values. Examples: Skills ("Python, Java, SQL"), Projects ("Dashboard Project, API Suite"), Tags ("urgent, backend"), Competencies, Tools, Technologies, Languages, Hobbies, Responsibilities, Qualifications. These columns ABSORB the extra values when merging.

- "identity" — Unique identifier or name column — always a SINGLE value. Examples: Employee ID, Name, Emp Id, User ID, Email, Serial No, Roll No. These get 1 value anchored from the LEFT.

- "numeric" — Column that holds numbers — always a SINGLE value. Examples: Salary, Age, Experience, Rating, Score, Quantity, Price. These get 1 value anchored from the RIGHT (since numbers appear at the end of comma-separated data).

- "text" — Column that holds a single text value — always 1 value. Examples: Location, City, Department, Status, Designation, Company. Gets 1 value.

RULES:
1. Look at BOTH the header name AND the sample data to classify.
2. If a header name is ambiguous, let the DATA decide. E.g., if header is "Info" but values look like skills/codes then "list". If values look like cities then "text".
3. Most datasets have at most 1-2 "list" columns. Do not over-classify as "list".
4. Columns at the END of the row (rightmost) that contain clean single-word values like city names are likely "text" (e.g., Location, City).
5. Columns with values containing tech terms, tool names, skill names, version numbers are likely "list".
6. If unsure between "list" and "text": if the column typically holds multiple items comma-separated in real data then "list". If it is always a single entity then "text".

Return ONLY a valid JSON array. No markdown, no explanation:
[
  {"header": "...", "mergeClass": "list|text|identity|numeric", "reasoning": "brief reason"},
  ...
]`;

    const zai = await getZAI();
    const completion = await zai.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      max_tokens: 2048,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: "You are a data classification API. Return ONLY valid JSON arrays. No markdown, no explanation, no code blocks. Be decisive.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content || "";
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let results: MergeClassifyResult[];
    try {
      results = JSON.parse(cleaned);
    } catch {
      const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        results = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error(`Failed to parse AI response: ${cleaned.slice(0, 200)}`);
      }
    }

    // Validate: each result must have header + valid mergeClass
    const validClasses = new Set(["list", "text", "identity", "numeric"]);

    const normalized: MergeClassifyResult[] = results.map((r) => {
      const cls = validClasses.has(r.mergeClass) ? r.mergeClass : "text";
      return {
        header: r.header || "",
        mergeClass: cls as MergeClassifyResult["mergeClass"],
        reasoning: r.reasoning || "",
      };
    });

    // Ensure every header has a classification (AI might skip some)
    const classified = new Set(normalized.map(r => r.header.toLowerCase()));
    for (const h of headers) {
      if (!classified.has(h.toLowerCase())) {
        normalized.push({
          header: h,
          mergeClass: "text",
          reasoning: "Not classified by AI, defaulting to text",
        });
      }
    }

    // Sort by header order
    const headerOrder = new Map(headers.map((h, i) => [h.toLowerCase(), i]));
    normalized.sort((a, b) => (headerOrder.get(a.header.toLowerCase()) ?? 99) - (headerOrder.get(b.header.toLowerCase()) ?? 99));

    return NextResponse.json({ results: normalized });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Classification failed";
    console.error("[classify-columns-merge] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
