// ============================================================
// AI-Powered Salary / Monetary Value Parser API
// ============================================================
// Uses LLM to normalize ALL salary formats into clean integers.
// Handles: symbols, words, multipliers, noise, ranges, edge cases.
//
// POST body: { values: string[] } or { value: string }
// Returns: { results: SalaryParseResult[] }
//
// z-ai-web-dev-sdk used in backend only — never on client side.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import ZAI, { type ZAIInstance } from "@/lib/ai-provider";

// ── Shared salary parser (deterministic fallback) ──────────────
import { parseSalaryValue, type SalaryParseResult } from "@/lib/salary-parser";

// ── EXACT USER PROMPT for LLM salary parsing ──────────────

const SALARY_PARSE_SYSTEM_PROMPT = `You are an expert data cleaning engine specialized in SALARY normalization.

Your task is to take a salary column (list of values) and return ONLY cleaned numeric values (integers), handling ALL possible real-world edge cases.

---

## INPUT

A list of salary values with possible inconsistencies.

---

## OUTPUT (STRICT)

* Return a list of integers in the SAME ORDER
* No explanations
* No symbols
* No text
* Invalid/unrecoverable values → NULL

---

## CORE OBJECTIVE

Convert ALL salary values into BASE NUMERIC FORMAT (integer), handling:

* symbols
* words
* multipliers
* noise
* malformed values
* edge cases

---

## FULL NORMALIZATION LOGIC

### 1. TEXT NORMALIZATION

* Convert to lowercase
* Trim spaces
* Remove:
  ₹, $, €, £, commas
  INR, rs, rupees, usd
  approx, ~, +, /month, per month, pa, yearly

---

### 2. WORD → NUMBER CONVERSION (MANDATORY)

Support BOTH:

* separated words → "forty five"
* merged words → "fortyfive", "thirtyfivek"

Mapping:
zero=0, one=1, two=2, three=3, four=4, five=5, six=6, seven=7, eight=8, nine=9
ten=10, twenty=20, thirty=30, forty=40, fifty=50, sixty=60, seventy=70, eighty=80, ninety=90

Rules:

* "forty five" → 45
* "fortyfive" → 45
* "thirtyfivek" → 35K

---

### 3. HANDLE WORD + MULTIPLIER COMBINATIONS

Must correctly interpret:

* fortyK
* fortyk
* forty k
* fortyfivek
* fiftym
* sixtyk approx

---

### 4. MULTIPLIER HANDLING

Detect:

* K / k / thousand → × 1,000
* M / m / million → × 1,000,000
* B / billion → × 1,000,000,000

---

### 5. NUMERIC EXTRACTION

Extract decimal or integer:

Example:

* 1.2M → 1.2
* 50K → 50

---

### 6. RANGE HANDLING

If value is a range:

* "50K-60K"
* "50K to 60K"

→ return AVERAGE

Example:
50K-60K → 55000

---

### 7. EDGE CASE HANDLING

Handle:

* embedded text → "40K salary", "salary 50K"
* mixed formats → "₹50K INR"
* extra spaces
* duplicated symbols

---

### 8. VALIDATION

* Final output must be numeric
* If no valid number found → NULL

---

## EXAMPLES

Input:
50K, ₹60000, 1.2M, fortyK, fortyk, thirtyfivek, 50K-60K, approx 40k, salary 70K, null

Output:
50000
60000
1200000
40000
40000
35000
55000
40000
70000
NULL

---

## STRICT RULES

* DO NOT skip any value
* DO NOT output text
* DO NOT change order
* ALWAYS try to recover value before marking NULL

---

Now process the provided salary column and return ONLY numeric outputs.`;

// ── ZAI instance (reuse across requests) ──────────────

let zaiInstance: ZAIInstance | null = null;

async function getZAI() {
  if (!zaiInstance) {
    zaiInstance = await ZAI.create();
  }
  return zaiInstance;
}

// ── LLM call for batch salary parsing ─────────────────

async function parseWithAI(values: string[]): Promise<
  { value: number | null; confidence: number; reason: string }[]
> {
  const zai = await getZAI();

  // Build the user prompt with indexed values
  const valuesList = values
    .map((v, i) => `[${i}]: "${v}"`)
    .join("\n");

  const userPrompt = `Now process the provided salary column and return ONLY numeric outputs.\n\n${valuesList}\n\nReturn JSON: {"results": [{"value": <integer or null>, "confidence": 0.0-1.0, "reason": "brief explanation"}]}\n\nThe results array MUST have the same length as the input, in the same order.`;

  try {
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: SALARY_PARSE_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      thinking: { type: "disabled" },
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      return values.map(() => ({
        value: null,
        confidence: 0,
        reason: "Empty AI response",
      }));
    }

    // Extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return values.map(() => ({
        value: null,
        confidence: 0,
        reason: "AI response not valid JSON",
      }));
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const results = parsed.results || [];

    while (results.length < values.length) {
      results.push({ value: null, confidence: 0, reason: "Missing result" });
    }

    return results.slice(0, values.length).map(
      (r: { value: number | null; confidence: number; reason: string }) => ({
        value: r.value,
        confidence: typeof r.confidence === "number" ? r.confidence : 0.7,
        reason: typeof r.reason === "string" ? r.reason : "AI parsed",
      })
    );
  } catch (error) {
    console.error("AI salary parse error:", error);
    return values.map(() => ({
      value: null,
      confidence: 0,
      reason: `AI error: ${error instanceof Error ? error.message : "unknown"}`,
    }));
  }
}

// ── POST handler ──────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { values, value, skipDeterministic } = body as {
      values?: string[];
      value?: string;
      skipDeterministic?: boolean;
    };

    const inputValues: string[] = Array.isArray(values)
      ? values.map(String)
      : value !== undefined
        ? [String(value)]
        : [];

    if (inputValues.length === 0) {
      return NextResponse.json(
        { error: "Provide 'values' (array) or 'value' (string)" },
        { status: 400 }
      );
    }

    if (inputValues.length > 50) {
      return NextResponse.json(
        { error: "Maximum 50 values per request" },
        { status: 400 }
      );
    }

    // When skipDeterministic is true (per-column AI button), send ALL to AI directly
    // When false (batch processing), try deterministic first, AI fallback
    const results: SalaryParseResult[] = [];
    const needsAIIndices: number[] = [];
    const needsAIValues: string[] = [];

    if (!skipDeterministic) {
      for (let i = 0; i < inputValues.length; i++) {
        const det = parseSalaryValue(inputValues[i]);
        results[i] = det;
        const trimmed = inputValues[i].trim();
        if (
          trimmed !== "" &&
          !/^(na|n\/a|null|none|-|nan|nil|tbd|undefined)$/i.test(trimmed) &&
          (det.needsAI || det.value === null)
        ) {
          needsAIIndices.push(i);
          needsAIValues.push(trimmed);
        }
      }
    } else {
      // Skip deterministic — send everything to AI
      for (let i = 0; i < inputValues.length; i++) {
        needsAIIndices.push(i);
        needsAIValues.push(inputValues[i]);
        results[i] = {
          value: null,
          steps: [],
          confidence: 0,
          needsAI: true,
          rawInput: inputValues[i],
        };
      }
    }

    // AI fallback for values that need it
    if (needsAIIndices.length > 0) {
      const aiResults = await parseWithAI(needsAIValues);

      for (let j = 0; j < aiResults.length; j++) {
        const idx = needsAIIndices[j];
        const ai = aiResults[j];

        if (ai.value !== null) {
          results[idx] = {
            value: ai.value,
            steps: [
              ...results[idx].steps,
              `AI: "${inputValues[idx]}" → ${ai.value} (confidence: ${ai.confidence.toFixed(2)})`,
              `AI reason: ${ai.reason}`,
            ],
            confidence: ai.confidence,
            needsAI: false,
            rawInput: inputValues[idx],
          };
        } else {
          results[idx] = {
            value: null,
            steps: [
              ...results[idx].steps,
              `AI: "${inputValues[idx]}" — unparseable`,
              `AI reason: ${ai.reason}`,
            ],
            confidence: 0.1,
            needsAI: true,
            rawInput: inputValues[idx],
          };
        }
      }
    }

    if (value !== undefined && !Array.isArray(values)) {
      return NextResponse.json({ result: results[0] });
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error("AI salary parse API error:", error);
    return NextResponse.json(
      {
        error: "Failed to parse salary values",
        details: error instanceof Error ? error.message : "unknown",
      },
      { status: 500 }
    );
  }
}
