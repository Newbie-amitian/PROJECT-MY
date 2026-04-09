import { NextRequest, NextResponse } from "next/server";
import ZAI from "@/lib/ai-provider";
import { detectSemanticType, analyzeAllColumns } from "@/lib/semantic-analyzer";

// ============================================================
// AI Column Intelligence API — Semantic Understanding
// ============================================================
// Combines deterministic multi-signal analysis (instant) with
// Groq AI for deep semantic understanding.
//
// Flow:
//   1. Deterministic signals run FIRST (header, tokens, range, structure)
//   2. AI refines understanding + adds validation/normalization plans
//   3. Returns merged analysis that the cleaning engine can execute
//
// The AI DEFINES how to clean. The rules EXECUTE the cleaning.

interface ColumnAnalyzeRequest {
  columns: { name: string }[];
  data: Record<string, unknown>[];
  useAI?: boolean; // default true
}

export async function POST(request: NextRequest) {
  try {
    const body: ColumnAnalyzeRequest = await request.json();
    const { columns, data, useAI = true } = body;

    if (!columns || !Array.isArray(columns) || columns.length === 0) {
      return NextResponse.json({ error: "No columns provided" }, { status: 400 });
    }

    if (!data || !Array.isArray(data) || data.length === 0) {
      return NextResponse.json({ error: "No data provided" }, { status: 400 });
    }

    // ── STEP 1: Deterministic multi-signal analysis (instant) ──
    const deterministicReports = analyzeAllColumns(columns, data);

    // ── STEP 2: AI-enhanced analysis for columns with low confidence ──
    if (useAI) {
      const lowConfidenceCols = deterministicReports.filter((r) => r.confidence < 70);

      if (lowConfidenceCols.length > 0 && lowConfidenceCols.length <= 10) {
        // Batch AI analysis for low-confidence columns
        const aiResults = await analyzeWithAI(lowConfidenceCols, data);
        
        // Merge AI results into deterministic reports
        for (const aiResult of aiResults) {
          const report = deterministicReports.find((r) => r.columnName === aiResult.column_name);
          if (report && aiResult.confidence > report.confidence) {
            // AI has higher confidence — adopt its analysis
            report.semanticType = aiResult.semantic_type as typeof report.semanticType;
            report.confidence = aiResult.confidence;
            report.understanding = aiResult.understanding?.description || report.understanding;
            if (aiResult.validation_rules) {
              report.validationRules = {
                allowedPattern: aiResult.validation_rules.allowed_pattern || report.validationRules.allowedPattern,
                constraints: aiResult.validation_rules.constraints || report.validationRules.constraints,
                disallowedExamples: aiResult.validation_rules.disallowed_examples || report.validationRules.disallowedExamples,
              };
            }
            if (aiResult.normalization_plan) {
              report.normalizationPlan = {
                targetDatatype: aiResult.normalization_plan.target_datatype || report.normalizationPlan.targetDatatype,
                steps: aiResult.normalization_plan.steps || report.normalizationPlan.steps,
                unitHandling: aiResult.normalization_plan.unit_handling || report.normalizationPlan.unitHandling,
              };
            }
            report.signals.push("ai_enhanced");
          }
        }
      }
    }

    return NextResponse.json({ reports: deterministicReports });
  } catch (error) {
    console.error("[column-analyze] Error:", error);
    return NextResponse.json(
      { error: "Column analysis failed", reports: [] },
      { status: 500 }
    );
  }
}

// ── AI Analysis (Groq) ──────────────────────────────

async function analyzeWithAI(
  columns: { columnName: string; semanticType: string; confidence: number; signals: string[] }[],
  data: Record<string, unknown>[]
): Promise<AIAnalysisResult[]> {
  try {
    const columnDescriptions = columns.map((col) => {
      const values = data
        .map((r) => r[col.columnName])
        .filter((v) => v !== null && v !== undefined)
        .map((v) => String(v))
        .slice(0, 15);

      return `Column: "${col.columnName}"
Current guess: ${col.semanticType} (${col.confidence}% confidence)
Signals: ${col.signals.join(", ") || "none"}
Sample values: ${values.join(", ")}`;
    }).join("\n\n---\n\n");

    const systemPrompt = `You are an advanced Data Understanding Intelligence Engine. Analyze each column and determine its REAL-WORLD semantic meaning.

SEMANTIC TYPES: FULL_NAME, FIRST_NAME, LAST_NAME, MONEY, RATING, AGE, EXPERIENCE, DATE, EMAIL, PHONE, LOCATION, CATEGORICAL, TEXT, IDENTIFIER, BOOLEAN, PERCENTAGE, UNKNOWN

RULES:
1. DO NOT just say "TEXT" — infer the REAL meaning
2. Use MULTIPLE signals: header name + value patterns + range behavior
3. MONEY: large numbers, ₹/$ symbols, K/M/B suffixes, LPA, Cr
4. RATING: 0-5 or 0-10 range, decimals like 4.5, ★ symbols, "5/5"
5. EXPERIENCE: small range 0-40, "yrs" suffix, word numbers
6. FULL_NAME: alphabetic strings with spaces, 2-4 parts
7. DATE: date-like patterns, year/month references

Return ONLY a valid JSON array. No markdown, no explanation outside JSON.
Each element:
{
  "column_name": "the column name",
  "semantic_type": "MONEY|RATING|AGE|EXPERIENCE|FULL_NAME|DATE|EMAIL|PHONE|LOCATION|CATEGORICAL|TEXT|IDENTIFIER|BOOLEAN|PERCENTAGE|UNKNOWN",
  "detected_datatype": "STRING|INTEGER|FLOAT|BOOLEAN|DATE",
  "confidence": 0-100,
  "understanding": {
    "description": "What this column represents",
    "expected_meaning": "Real-world meaning"
  },
  "validation_rules": {
    "allowed_pattern": "what valid data looks like",
    "allowed_examples": ["example1", "example2"],
    "disallowed_examples": ["bad1", "bad2"],
    "constraints": ["rule1", "rule2"]
  },
  "signals_used": {
    "header_analysis": ["signal1"],
    "value_patterns": ["pattern1"],
    "range_analysis": "description",
    "keywords_detected": ["keyword1"]
  },
  "normalization_plan": {
    "target_datatype": "STRING|INTEGER|FLOAT|BOOLEAN|DATE",
    "steps": ["step1", "step2"],
    "standardization_rules": {},
    "unit_handling": "describe unit handling",
    "format_rules": "describe format rules",
    "invalid_handling": "NULL or flag"
  }
}`;

    const userMessage = `Analyze these columns:\n\n${columnDescriptions}\n\nReturn JSON array with analysis for each column.`;

    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "assistant", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      thinking: { type: "disabled" },
    });

    const raw = completion.choices[0]?.message?.content || "";
    let results: AIAnalysisResult[];

    try {
      results = JSON.parse(raw);
    } catch {
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        results = JSON.parse(jsonMatch[1].trim());
      } else {
        const arrayMatch = raw.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          results = JSON.parse(arrayMatch[0]);
        } else {
          return [];
        }
      }
    }

    return Array.isArray(results) ? results : [];
  } catch (error) {
    console.error("[column-analyze] AI analysis failed:", error);
    return [];
  }
}

interface AIAnalysisResult {
  column_name?: string;
  semantic_type?: string;
  detected_datatype?: string;
  confidence?: number;
  understanding?: {
    description?: string;
    expected_meaning?: string;
  };
  validation_rules?: {
    allowed_pattern?: string;
    allowed_examples?: string[];
    disallowed_examples?: string[];
    constraints?: string[];
  };
  signals_used?: {
    header_analysis?: string[];
    value_patterns?: string[];
    range_analysis?: string;
    keywords_detected?: string[];
  };
  normalization_plan?: {
    target_datatype?: string;
    steps?: string[];
    unit_handling?: string;
  };
}
