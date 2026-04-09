import { NextRequest, NextResponse } from "next/server";
import ZAI, { type ZAIInstance } from "@/lib/ai-provider";
import { executeSQL } from "@/lib/sql-executor";
import type { RawDataRow, ColumnMeta } from "@/lib/dashboard-types";

interface SQLQueryRequest {
  data: RawDataRow[];
  columns: ColumnMeta[];
  naturalLanguageQuery: string;
  userInstructions?: string;
}

function buildSQLSystemPrompt(): string {
  return `You are an expert SQL query writer. Given a dataset schema and a natural language request, generate the most appropriate SQL query.

You MUST respond with ONLY valid JSON:
{
  "sql": "SELECT ... FROM dataset WHERE ...",
  "aiMessage": "Brief 1-sentence explanation of what the query does"
}

RULES:
1. Table name is ALWAYS "dataset"
2. Use EXACT column names from the schema
3. Use standard SQL syntax
4. For aggregations, use descriptive aliases: SUM(col) AS TotalCol
5. Use LIMIT for top N results
6. Always specify ASC or DESC in ORDER BY
7. Support: SELECT, WHERE, GROUP BY, HAVING, ORDER BY, LIMIT, CASE WHEN, COALESCE, LIKE, IN, BETWEEN, DISTINCT
8. For percentages: ROUND((col / SUM(col) * 100), 2) AS Percent
9. Do NOT use backticks around column names
10. Do NOT use window functions (ROW_NUMBER, RANK, etc.) — use subqueries or LIMIT instead
11. Do NOT use double quotes around column names — use them plain
12. Do NOT use semicolons at the end
13. Wrap arithmetic inside aggregate functions in parentheses: SUM((col1 * col2))
14. Keep queries simple — avoid deeply nested subqueries, prefer flat GROUP BY + ORDER BY
15. Do NOT use CAST — the engine auto-detects types from the data`;
}

function buildRepairPrompt(failedSql: string, errorMessage: string, columns: ColumnMeta[]): string {
  const colNames = columns.map((c) => c.name).join(", ");
  return `You are an expert SQL repair engine.

Your task is to take a user-provided SQL query and fix any syntax errors while preserving the original intent.

RULES:
1. Do NOT change the meaning of the query.
2. Fix all syntax issues (parentheses, operators, casting, commas, aliasing).
3. Ensure all function calls have correct parentheses balance.
4. If arithmetic is inside aggregate functions (SUM, AVG, etc.), wrap full expressions safely in parentheses.
5. Remove any CAST expressions — the engine auto-detects column types.
6. Ensure multiplication/division operations inside aggregates are properly grouped.
7. Do NOT remove or simplify logic unless required for correctness.
8. Output ONLY the corrected SQL query, nothing else.
9. Do NOT use backticks or double quotes around column names.
10. Do NOT use window functions (ROW_NUMBER, RANK, OVER, PARTITION BY).
11. Do NOT use semicolons at the end.
12. Table name is ALWAYS "dataset".
13. Available columns: ${colNames}

ERROR HANDLING PRIORITY:
- Missing/extra parentheses → fix grouping
- Misplaced operators (*, +, -, /) → adjust expression structure
- Ambiguous function parsing → enforce full expression wrapping
- CAST expressions → remove them entirely
- Window functions → rewrite using GROUP BY + ORDER BY + LIMIT

FAILED SQL:
${failedSql}

ERROR MESSAGE:
${errorMessage}

OUTPUT ONLY THE FIXED SQL QUERY:`;
}

function buildSQLPrompt(
  columns: ColumnMeta[],
  data: RawDataRow[],
  query: string,
  userInstructions?: string
): string {
  const columnSchema = columns
    .map((c) => {
      let typeStr = c.type;
      if (c.type === "number") {
        const vals = data.slice(0, 20).map((r) => r[c.name]).filter((v) => typeof v === "number") as number[];
        if (vals.length > 0) {
          const hasDecimal = vals.some((v) => v !== Math.floor(v));
          typeStr = hasDecimal ? "decimal" : "integer";
        }
      }
      return `  - ${c.name} (${typeStr}, ${c.uniqueCount} unique, ${c.missingCount} missing)`;
    })
    .join("\n");

  const sampleData = data.slice(0, 3).map((row) => {
    const clean: Record<string, string> = {};
    columns.forEach((c) => {
      const val = row[c.name];
      clean[c.name] = val == null ? "NULL" : String(val);
    });
    return clean;
  });

  return `Generate an SQL query for this request:

"${query}"

${userInstructions ? `USER CONTEXT: ${userInstructions}\n\n` : ""}TABLE: dataset
ROWS: ${data.length}

COLUMNS:
${columnSchema}

SAMPLE DATA:
${JSON.stringify(sampleData, null, 2)}

Generate the best SQL query. Remember: no backticks, no double quotes, no window functions, no semicolons, no CAST.`;
}

function cleanSQL(sql: string): string {
  // Remove backticks
  sql = sql.replace(/`([^`]+)`/g, "$1");
  // Remove double quotes around identifiers (but keep string literals context-safe)
  sql = sql.replace(/"([^"]+)"/g, (match, p1) => {
    if (match.startsWith('"') && match.endsWith('"') && !match.includes(" ")) {
      return p1;
    }
    return match;
  });
  // Remove CAST() wrappers — engine auto-detects types
  sql = sql.replace(/\bCAST\s*\(\s*([^)]+?)\s+AS\s+(?:INTEGER|INT|FLOAT|DOUBLE|DECIMAL|NUMERIC|VARCHAR|TEXT|BOOLEAN|DATE|DATETIME)\s*\)/gi, "$1");
  // Remove trailing semicolons
  sql = sql.replace(/;\s*$/, "").trim();
  return sql;
}

async function tryRepairSQL(
  zai: ZAIInstance,
  failedSql: string,
  errorMessage: string,
  columns: ColumnMeta[],
  data: RawDataRow[]
): Promise<{ sql: string; result: ReturnType<typeof executeSQL> } | null> {
  const repairCompletion = await zai.chat.completions.create({
    messages: [
      { role: "system", content: buildRepairPrompt(failedSql, errorMessage, columns) },
      { role: "user", content: `Fix this SQL:\n\n${failedSql}` },
    ],
    temperature: 0.1,
  });

  let repairedSQL = repairCompletion.choices?.[0]?.message?.content?.trim() || "";

  // Strip markdown fencing
  repairedSQL = repairedSQL.replace(/^```(?:sql)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
  repairedSQL = cleanSQL(repairedSQL);

  if (!repairedSQL || !repairedSQL.toUpperCase().startsWith("SELECT")) return null;

  // Make sure it references 'dataset' table
  if (!repairedSQL.toUpperCase().includes("FROM")) {
    repairedSQL = repairedSQL.replace(/SELECT\s/i, "SELECT * FROM dataset WHERE ");
    if (!repairedSQL.includes("WHERE")) repairedSQL = repairedSQL + " LIMIT 10";
  }

  const result = executeSQL(data, repairedSQL);
  const isError = result.columns.length === 1 && result.columns[0] === "Error";

  if (isError) return null;

  return { sql: repairedSQL, result };
}

export async function POST(request: NextRequest) {
  try {
    const body: SQLQueryRequest = await request.json();
    const { data, columns, naturalLanguageQuery, userInstructions } = body;

    if (!data || !Array.isArray(data) || data.length === 0) {
      return NextResponse.json({ error: "No data provided" }, { status: 400 });
    }
    if (!naturalLanguageQuery) {
      return NextResponse.json({ error: "No query provided" }, { status: 400 });
    }
    if (!columns || columns.length === 0) {
      return NextResponse.json({ error: "No column schema provided" }, { status: 400 });
    }

    // Generate SQL via AI
    const zai = await ZAI.create();
    const totalStart = Date.now();

    const completion = await zai.chat.completions.create({
      messages: [
        { role: "system", content: buildSQLSystemPrompt() },
        { role: "user", content: buildSQLPrompt(columns, data, naturalLanguageQuery, userInstructions) },
      ],
      temperature: 0.2,
    });

    const rawContent = completion.choices?.[0]?.message?.content;
    if (!rawContent) {
      return NextResponse.json({
        sql: "", columns: [], rows: [], rowCount: 0, executionTimeMs: 0,
        aiMessage: "Failed to generate SQL.", error: "Empty AI response",
      }, { status: 500 });
    }

    // Parse AI response
    let sql = "";
    let aiMessage = "";
    try {
      let cleaned = rawContent.trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) cleaned = jsonMatch[0];
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
      const parsed = JSON.parse(cleaned);
      sql = typeof parsed.sql === "string" ? parsed.sql.trim() : "";
      aiMessage = typeof parsed.aiMessage === "string" ? parsed.aiMessage : "";
    } catch {
      const sqlMatch = rawContent.match(/```sql\s*([\s\S]*?)```/i) || rawContent.match(/SELECT[\s\S]+/i);
      sql = sqlMatch ? sqlMatch[1].trim() : "";
      aiMessage = "Query generated.";
    }

    if (!sql) {
      return NextResponse.json({
        sql: "", columns: [], rows: [], rowCount: 0, executionTimeMs: 0,
        aiMessage: "Could not generate SQL. Please rephrase.", error: "No SQL generated",
      }, { status: 500 });
    }

    // Clean SQL
    sql = cleanSQL(sql);

    // First execution attempt
    let sqlResult = executeSQL(data, sql);
    let finalSQL = sql;
    let repaired = false;

    const isError = sqlResult.columns.length === 1 && sqlResult.columns[0] === "Error";

    if (isError) {
      const errorMsg = (sqlResult.rows[0]?.[0] as string) || "Unknown error";
      console.log(`[sql-query] First attempt failed: ${errorMsg}. Attempting repair...`);

      // Attempt 1: AI repair
      const repairResult = await tryRepairSQL(zai, sql, errorMsg, columns, data);
      if (repairResult) {
        console.log("[sql-query] Repair attempt 1 succeeded");
        sqlResult = repairResult.result;
        finalSQL = repairResult.sql;
        repaired = true;
      } else {
        console.log("[sql-query] Repair attempt 1 failed, trying attempt 2...");

        // Attempt 2: Re-generate entirely with stricter prompt
        const regenCompletion = await zai.chat.completions.create({
          messages: [
            { role: "system", content: buildSQLSystemPrompt() + "\n\nIMPORTANT: The previous query you generated FAILED with this error: " + errorMsg + ". Write a SIMPLER query. Avoid CAST, window functions, complex nested subqueries. Use basic SELECT ... FROM dataset ... GROUP BY ... ORDER BY ... LIMIT." },
            { role: "user", content: buildSQLPrompt(columns, data, naturalLanguageQuery, userInstructions) },
          ],
          temperature: 0.1,
        });

        let regenSQL = "";
        try {
          const regenContent = regenCompletion.choices?.[0]?.message?.content?.trim() || "";
          let cleaned = regenContent.trim();
          const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
          if (jsonMatch) cleaned = jsonMatch[0];
          cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
          const parsed = JSON.parse(cleaned);
          regenSQL = typeof parsed.sql === "string" ? parsed.sql.trim() : "";
        } catch {
          // Ignore parse errors on retry
        }

        if (regenSQL) {
          regenSQL = cleanSQL(regenSQL);
          const regenResult = executeSQL(data, regenSQL);
          const regenError = regenResult.columns.length === 1 && regenResult.columns[0] === "Error";

          if (!regenError) {
            console.log("[sql-query] Regeneration succeeded");
            sqlResult = regenResult;
            finalSQL = regenSQL;
            repaired = true;
          } else {
            // Attempt 3: Repair the regenerated query
            console.log("[sql-query] Regeneration failed, attempting repair on regenerated SQL...");
            const repair2 = await tryRepairSQL(zai, regenSQL, (regenResult.rows[0]?.[0] as string) || "Unknown", columns, data);
            if (repair2) {
              console.log("[sql-query] Repair attempt 2 succeeded");
              sqlResult = repair2.result;
              finalSQL = repair2.sql;
              repaired = true;
            }
          }
        }
      }
    }

    const totalExecutionTime = Date.now() - totalStart;
    const finalIsError = sqlResult.columns.length === 1 && sqlResult.columns[0] === "Error";

    return NextResponse.json({
      sql: finalSQL,
      columns: sqlResult.columns,
      rows: sqlResult.rows,
      rowCount: sqlResult.rowCount,
      executionTimeMs: totalExecutionTime,
      repaired,
      aiMessage: finalIsError
        ? "Query failed after multiple repair attempts."
        : (repaired
          ? `${aiMessage} (auto-repaired)`
          : (aiMessage || `Query returned ${sqlResult.rowCount} rows in ${totalExecutionTime}ms.`)),
      error: finalIsError ? (sqlResult.rows[0]?.[0] as string) : undefined,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[sql-query] Error:", message);
    return NextResponse.json({
      sql: "", columns: [], rows: [], rowCount: 0, executionTimeMs: 0,
      aiMessage: "", error: message,
    }, { status: 500 });
  }
}
