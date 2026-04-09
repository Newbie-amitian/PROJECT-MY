// ============================================================
// AI Salary Verification API — User's Exact Prompt
// ============================================================
// Uses LLM to normalize salary values by extracting:
//   - Number names (forty → 40, thirtyfive → 35, sixty six → 66)
//   - Scale abbreviations (K=1000, L=100000, M=1000000, B=1000000000)
//   - Multiplies extracted number × scale abbreviation
//   - Trims anything that's NOT a number name or scale abbreviation
//
// POST body: { values: string[], columnName: string }
// Returns: { results: Array<{ original: string, value: number | null, reason: string }> }
//
// z-ai-web-dev-sdk used in backend only — never on client side.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import ZAI, { type ZAIInstance } from "@/lib/ai-provider";

// ── EXACT USER PROMPT — no modifications ──────────────

const SALARY_VERIFY_SYSTEM_PROMPT = `You are an expert data cleaning engine for SALARY normalization.

These are values of my salary column, if it contains, number names and any of the K, L, M, B, Number suffixes / scale abbreviations..... then extract the number names as well as the scale abbreviations and if something doesnt match the number name or scale abbreviation then trim it...

For example if it is "fortyfiveK INR"... fortyfive = 45, K = 1000, but INR?? it aint a number name neither a scale... so no need of that..... and give output as 45000, inshort multiplying the numeric extracted from number name with the value of the Scale abbreviation...... and get me the output.

RULES:
- Number names: zero, one, two, three, four, five, six, seven, eight, nine, ten, eleven, twelve, thirteen, fourteen, fifteen, sixteen, seventeen, eighteen, nineteen, twenty, thirty, forty, fifty, sixty, seventy, eighty, ninety, hundred
- Also handle MERGED word numbers: fortyfive = 45, thirtyfive = 35, sixtyfive = 65, fiftyfive = 55, etc.
- Also handle SPACE-SEPARATED word numbers: "forty five" = 45, "thirty five" = 35
- Scale abbreviations: K = 1000, k = 1000, L = 100000, l = 100000, M = 1000000, m = 1000000, B = 1000000000, b = 1000000000
- Also handle: thousand = 1000, lakh = 100000, million = 1000000, crore = 10000000, billion = 1000000000
- Currency symbols (₹, $, €, £, Rs, INR, USD, EUR, GBP) are NOT number names or scales — trim them
- Words like "approx", "salary", "per annum", "PA", "per month" are NOT number names or scales — trim them
- The final output = extracted number × scale abbreviation (if no scale, just the extracted number as integer)
- If the value is null, empty, "null", "N/A", "none", "NA", "—" — output NULL
- If no number can be extracted at all — output NULL
- Ranges like "50K-60K" or "50K to 60K" — return the AVERAGE
- Output must be INTEGER only (no decimals, no text, no symbols)

EXAMPLES:
"50K" → 50000
"fortyK" → 40000
"fortyk" → 40000
"thirtyfivek" → 35000
"fortyfiveK INR" → 45000
"₹60000" → 60000
"1.2M" → 1200000
"50K-60K" → 55000
"approx 40k" → 40000
"salary 70K" → 70000
"40K INR" → 40000
"five lakh" → 500000
"2.5 Cr" → 25000000
"Rs 45000" → 45000
"null" → NULL
"—" → NULL
"sixty grand" → 60000
"3.5L" → 350000
"twenty five thousand" → 25000`;

// ── ZAI instance (reuse across requests) ──────────────

let zaiInstance: ZAIInstance | null = null;

async function getZAI() {
  if (!zaiInstance) {
    zaiInstance = await ZAI.create();
  }
  return zaiInstance;
}

// ── POST handler ──────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { values, columnName } = body as {
      values: string[];
      columnName?: string;
    };

    if (!Array.isArray(values) || values.length === 0) {
      return NextResponse.json(
        { error: "Provide 'values' as a non-empty string array" },
        { status: 400 }
      );
    }

    if (values.length > 100) {
      return NextResponse.json(
        { error: "Maximum 100 values per request" },
        { status: 400 }
      );
    }

    const zai = await getZAI();

    // Build the user prompt with all values
    const valuesList = values
      .map((v, i) => `[${i}]: "${v}"`)
      .join("\n");

    const userPrompt = `Here are the salary values from my "${columnName ?? "salary"}" column:\n\n${valuesList}\n\nReturn JSON: {"results": [{"value": <integer or null>, "reason": "brief explanation of what was extracted"}]}\n\nThe results array MUST have the same length as the input (${values.length}), in the same order. Each value must be an integer or null.`;

    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: SALARY_VERIFY_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      thinking: { type: "disabled" },
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      return NextResponse.json({
        results: values.map((v) => ({
          original: v,
          value: null,
          reason: "Empty AI response",
        })),
      });
    }

    // Extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({
        results: values.map((v) => ({
          original: v,
          value: null,
          reason: "AI response not valid JSON",
        })),
      });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const results = parsed.results || [];

    // Pad if AI returned fewer results
    while (results.length < values.length) {
      results.push({ value: null, reason: "Missing result" });
    }

    // Map back to original values
    const mapped = results.slice(0, values.length).map(
      (r: { value: number | null; reason: string }, i: number) => ({
        original: values[i],
        value: typeof r.value === "number" ? Math.round(r.value) : null,
        reason: typeof r.reason === "string" ? r.reason : "AI parsed",
      })
    );

    return NextResponse.json({ results: mapped });
  } catch (error) {
    console.error("[AI Salary Verify] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to verify salary values",
        details: error instanceof Error ? error.message : "unknown",
      },
      { status: 500 }
    );
  }
}
