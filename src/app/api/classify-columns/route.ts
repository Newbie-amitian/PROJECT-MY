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
// AI-Powered Column Type Classification
// ============================================================
// Takes ALL column headers + sample values, sends to AI in one batch,
// and returns the semantic type for each column.
//
// Supported types: FULL_NAME, LAST_NAME, FIRST_NAME, USERNAME,
//   EMAIL, PHONE, SALARY, LOCATION, REGION, COUNTRY, COUNTRY_CODE,
//   FEEDBACK, PERCENTAGE, DATE, EXPERIENCE, RATING, AGE, BOOLEAN,
//   CATEGORICAL, IDENTIFIER, DEPARTMENT, FIELD, TEXT, UNKNOWN

interface ColumnInfo {
  name: string;
  sampleValues: string[];
}

interface ClassificationRequest {
  columns: ColumnInfo[];
}

interface ClassificationResult {
  columnName: string;
  semanticType: string;
  confidence: number; // 0-1
  reasoning: string;
}

// Valid semantic types — AI must return one of these
const VALID_TYPES = [
  "FULL_NAME", "LAST_NAME", "FIRST_NAME", "USERNAME",
  "EMAIL", "PHONE", "SALARY", "LOCATION", "REGION", "COUNTRY", "COUNTRY_CODE",
  "FEEDBACK",
  "PERCENTAGE", "DATE", "EXPERIENCE", "RATING", "AGE",
  "BOOLEAN", "CATEGORICAL", "IDENTIFIER",
  "DEPARTMENT", "FIELD",
  "TEXT", "UNKNOWN",
] as const;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as ClassificationRequest;
    const { columns } = body;

    if (!columns || columns.length === 0) {
      return NextResponse.json({ error: "No columns provided" }, { status: 400 });
    }

    // Build the prompt with column headers + sample values
    const columnDescriptions = columns.map((col, i) => {
      const samples = (col.sampleValues || []).slice(0, 8).join(", ");
      return `  ${i + 1}. Column: "${col.name}" — Sample values: [${samples || "(empty)"}]`;
    }).join("\n");

    const prompt = `You are a data classification expert. Analyze the following dataset columns and classify each column's semantic type.

COLUMN LIST:
${columnDescriptions}

VALID TYPES (choose exactly one per column):
- FULL_NAME: Person's full name (e.g., "John Smith", "Jane Doe") — 2+ word names
- LAST_NAME: Person's last/family name (e.g., "Smith", "Johnson") — single word
- FIRST_NAME: Person's first/given name (e.g., "John", "Jane")
- USERNAME: User handle/login ID (e.g., "john_doe123", "j.smith", "user@#$%", "any!thing") — can contain ANY characters
- EMAIL: Email address (e.g., "john@example.com")
- PHONE: Phone number (e.g., "+91 98765 43210", "555-1234")
- SALARY: Salary/compensation/pay (e.g., "50000", "50K", "$60,000", "5 LPA")
- LOCATION: Geographic location/city (e.g., "New York", "Mumbai, India", "Bangalore", "Chennai", "Hyderabad")
- REGION: Geographic region/business area (e.g., "APAC", "EMEA", "LATAM", "North America", "Asia", "Europe")
- COUNTRY: Country name (e.g., "India", "United States", "Germany", "Brazil", "UK")
- COUNTRY_CODE: ISO 3166-1 alpha-2 country code (e.g., "IN", "US", "DE", "BR", "GB", "AU") — MUST be exactly 2 letters
- FEEDBACK: User feedback/review/survey response (e.g., "Great service 👍", "Needs improvement", "Love it! ❤️") — may contain sentiment-appropriate emojis
- PERCENTAGE: Percentage value (e.g., "85%", "92 percent", "45")
- DATE: Date value (e.g., "2024-01-15", "15/03/2021", "Jan 2020")
- EXPERIENCE: Years of experience/work tenure (e.g., "5", "3 years", "twenty years")
- RATING: Rating/score (e.g., "4.5", "3★", "8/10")
- AGE: Person's age (e.g., "25", "30 years")
- BOOLEAN: True/false values (e.g., "Yes/No", "Active/Inactive")
- CATEGORICAL: Limited set of categories (e.g., status values, gender)
- IDENTIFIER: Unique ID/code (e.g., "EMP001", "A102")
- DEPARTMENT: Department/team/division name (e.g., "Engineering", "HR", "Marketing", "Sales", "Finance", "Operations")
- FIELD: Field of study/specialization/academic domain (e.g., "Computer Science", "Data Science", "Mechanical Engineering", "Civil")
- TEXT: Free-form text that doesn't fit other categories
- UNKNOWN: Cannot determine

CRITICAL DISTINCTION RULES (MUST follow):
1. DEPARTMENT vs FIELD: 
   - DEPARTMENT = organizational team/unit (Engineering, HR, Marketing, Finance, Sales, Operations, Design, QA)
   - FIELD = academic/technical specialization (Computer Science, Data Science, Mechanical, Civil, Electronics, Biotechnology)
   - If column header says "dept", "department", "team", "division" → DEPARTMENT
   - If column header says "field", "specialization", "major", "domain", "stream" → FIELD

2. LOCATION vs REGION vs COUNTRY (NEVER classify as FIELD or DEPARTMENT):
   - LOCATION = specific city/place names: "New York", "Mumbai", "Bangalore", "Chennai", "Hyderabad", "Pune", "Delhi", "Kolkata", "Noida", "Gurgaon", "Mysore", "Coimbatore", "Jaipur", "Lucknow", "Bhopal"
   - REGION = geographic region/business area: "APAC", "EMEA", "LATAM", "North America", "South America", "Asia", "Europe", "Africa", "Middle East", "Central Asia", "Southeast Asia", "Oceania"
   - COUNTRY = country names: "India", "United States", "Germany", "Brazil", "UK", "China", "Japan", "Australia", "Canada", "France"
   - Column headers with "location", "city", "place", "loc" → LOCATION
   - Column headers with "region", "area", "zone", "territory", "business area" → REGION
   - Column headers with "country", "nation", "countries" → COUNTRY
   - IMPORTANT: Country names are ALWAYS COUNTRY — never LOCATION or FIELD or DEPARTMENT
   - IMPORTANT: Region abbreviations like APAC, EMEA, LATAM, NA, SA → REGION (not CATEGORICAL)
   - Even if only 2-3 unique values, if they are place/country/region names → correct geographic type (not CATEGORICAL)

3. USERNAME detection:
   - Column headers with "username", "user_name", "usr", "login", "handle" → USERNAME
   - Values can contain ANY characters (letters, numbers, special chars, symbols) — do NOT reject based on character patterns
   - DO NOT classify as CATEGORICAL or TEXT if header clearly says username/login

4. EXPERIENCE detection:
   - Column headers with "experience", "exp", "years_exp", "yrs_exp" → EXPERIENCE
   - Values like "5", "3 years", "twenty", "4.5 yrs" → EXPERIENCE (not TEXT, not CATEGORICAL)
   - If header says "years" or "yrs" and values are numbers → EXPERIENCE

5. COUNTRY_CODE detection:
   - Column headers with "country_code", "iso_code", "iso_alpha", "ccode", "nat_code", "country_iso" → COUNTRY_CODE
   - Values that are exactly 2 uppercase letters (IN, US, DE, GB, AU, etc.) → COUNTRY_CODE
   - DO NOT convert 2-letter country codes to full country names — keep as ISO 3166-1 alpha-2
   - IMPORTANT: If values are full country names like "India", "United States" → COUNTRY (not COUNTRY_CODE)

6. FEEDBACK detection:
   - Column headers with "feedback", "review", "comment", "response", "remark", "opinion", "survey_response", "sentiment" → FEEDBACK
   - Values that are free-form text with sentiment emojis (👍❤️⭐🔥🎉) → FEEDBACK
   - DO NOT strip emojis from feedback columns — sentiment emojis are expected and valid

7. Value-based override (header can be wrong):
   - If >70% of values match email pattern → EMAIL regardless of header name
   - If >70% of values are phone digits → PHONE regardless of header name
   - If values are city names → LOCATION regardless of header name
   - If values are country names → COUNTRY regardless of header name
   - If values are region abbreviations (APAC, EMEA, LATAM) → REGION regardless of header name
   - If values are 2-letter country codes (IN, US, DE) → COUNTRY_CODE regardless of header name

Return ONLY a valid JSON array with NO markdown, NO code blocks, NO explanation:
[
  {"columnName": "...", "semanticType": "ONE_OF_VALID_TYPES", "confidence": 0.95, "reasoning": "brief reason"},
  ...
]`;

    const zai = await getZAI();
    const completion = await zai.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      max_tokens: 4096,
      messages: [
        {
          role: "system",
          content: "You are a data classification API. Return ONLY valid JSON arrays. No markdown, no explanation, no code blocks.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.1, // Low temperature for consistent classification
    });

    const raw = completion.choices?.[0]?.message?.content || "";
    // Strip markdown code blocks if present
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let results: ClassificationResult[];
    try {
      results = JSON.parse(cleaned);
    } catch {
      // Retry parse — sometimes AI adds extra text
      const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        results = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error(`Failed to parse AI response: ${cleaned.slice(0, 200)}`);
      }
    }

    // Validate and normalize results
    const validTypeSet = new Set(VALID_TYPES);
    const normalized: ClassificationResult[] = results.map((r) => ({
      columnName: r.columnName || "",
      semanticType: validTypeSet.has(r.semanticType as typeof VALID_TYPES[number])
        ? r.semanticType
        : "UNKNOWN",
      confidence: typeof r.confidence === "number" ? Math.min(1, Math.max(0, r.confidence)) : 0.5,
      reasoning: r.reasoning || "",
    }));

    // Map SALARY → MONEY for internal engine compatibility
    normalized.forEach((r) => {
      if (r.semanticType === "SALARY") r.semanticType = "MONEY";
    });

    return NextResponse.json({ results: normalized });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Classification failed";
    console.error("[classify-columns] Error:", msg);
    return NextResponse.json(
      { error: msg },
      { status: 500 }
    );
  }
}
