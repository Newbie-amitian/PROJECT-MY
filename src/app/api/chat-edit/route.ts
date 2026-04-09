import { NextRequest, NextResponse } from "next/server";
import ZAI from "@/lib/ai-provider";
import type { RawDataRow, ColumnMeta } from "@/lib/dashboard-types";

// ============================================================
// AI Chat Editor API — Manual Review Mode
// ============================================================
// This endpoint is ONLY used in Manual Review Mode.
// AI parses user intent → shows preview → user confirms → applies.
//
// AI MUST NOT silently overwrite data.
// AI MUST always show preview before applying.
// AI MUST maintain history of all user actions.

interface ChatEditRequest {
  message: string;
  data: RawDataRow[];
  columns: ColumnMeta[];
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
}

interface PreviewAction {
  type: "rename_column" | "replace_values" | "merge_categories" | "delete_rows" | "create_column" | "fill_values" | "general";
  description: string;
  preview: {
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }[];
  affectedRows: number;
  affectedColumns: string[];
  confidence: number;
  label: "HIGH" | "MEDIUM" | "LOW";
  executionPlan: string; // What will happen if user confirms
}

interface ChatEditResponse {
  aiMessage: string;
  preview: PreviewAction | null;
  executedDirectly: boolean;
}

function buildSchemaContext(columns: ColumnMeta[], data: RawDataRow[]): string {
  return columns.map((col) => {
    const values = data.slice(0, 8).map((r) => r[col.name]).filter((v) => v != null);
    const unique = [...new Set(values.map(String))];
    return `${col.name} | type=${col.type} | unique=${col.uniqueCount} | missing=${col.missingCount} | samples=[${unique.slice(0, 5).join(", ")}]`;
  }).join("\n");
}

function parseResponse(text: string): Record<string, unknown> {
  let cleaned = text.trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) cleaned = jsonMatch[0];
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
  try { return JSON.parse(cleaned); } catch { return {}; }
}

const SYSTEM_PROMPT = `You are an AI Data Cleaning Assistant in MANUAL REVIEW MODE. Your job is to understand what the user wants to do, generate a PREVIEW of changes, and NEVER apply anything without user confirmation.

BEHAVIOR RULES:
1. Parse the user's intent from their natural language command
2. Generate a preview showing exactly what will change (before → after)
3. Return a structured JSON response with the preview
4. NEVER silently overwrite data
5. ALWAYS show preview before applying
6. If the command is ambiguous, ask for clarification instead of guessing

SUPPORTED COMMANDS:
1. Rename column: "Rename Salary_Range to Salary"
2. Fix values: "Replace all 'fiv' with 5 in Rating" or "Replace 'Male' and 'M' with 'Male'"
3. Merge categories: "Convert M and Male to Male" or "Convert yes/YES to Yes"
4. Remove rows: "Delete rows where Rating is NULL"
5. Create columns: "Create Salary_Monthly = Salary / 12"
6. Fill values: "Fill missing Age with mean" or "Set all empty Phone to 'N/A'"

RESPONSE FORMAT (JSON):
{
  "aiMessage": "Brief description of what you'll do",
  "preview": {
    "type": "replace_values|rename_column|merge_categories|delete_rows|create_column|fill_values|general",
    "description": "What this operation does in one sentence",
    "preview": [
      {"before": {"col": "old_value"}, "after": {"col": "new_value"}},
      ...up to 5 examples
    ],
    "affectedRows": N,
    "affectedColumns": ["col1"],
    "confidence": 0.95,
    "label": "HIGH|MEDIUM|LOW",
    "executionPlan": "Step-by-step what will happen when user confirms"
  },
  "executedDirectly": false
}

IF YOU CANNOT UNDERSTAND THE COMMAND:
{
  "aiMessage": "I couldn't understand that command. Try: 'Rename column X to Y', 'Replace value A with B in column C', etc.",
  "preview": null,
  "executedDirectly": false
}

IMPORTANT: "executedDirectly" MUST ALWAYS be false. The frontend handles execution after user confirmation.`;

export async function POST(request: NextRequest) {
  try {
    const body: ChatEditRequest = await request.json();
    const { message, data, columns, conversationHistory } = body;

    if (!message || !data || !columns) {
      return NextResponse.json(
        { aiMessage: "Missing required parameters.", preview: null, executedDirectly: false },
        { status: 400 }
      );
    }

    if (data.length === 0) {
      return NextResponse.json(
        { aiMessage: "No data available. Upload a dataset first.", preview: null, executedDirectly: false },
        { status: 400 }
      );
    }

    // Try local pattern matching first for common commands (deterministic, no AI needed)
    const localMatch = tryLocalPatternMatch(message, data, columns);
    if (localMatch) {
      return NextResponse.json(localMatch);
    }

    // Fall back to AI for complex/ambiguous commands
    const zai = await ZAI.create();

    const schemaContext = buildSchemaContext(columns, data);
    const sampleData = JSON.stringify(data.slice(0, 5));

    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: SYSTEM_PROMPT },
    ];

    // Add conversation history (last 6 messages for context)
    if (conversationHistory && conversationHistory.length > 0) {
      const recentHistory = conversationHistory.slice(-6);
      messages.push(...recentHistory.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })));
    }

    messages.push({
      role: "user",
      content: `User command: "${message}"

SCHEMA:
${schemaContext}

SAMPLE DATA (first 5 rows):
${sampleData}

Total rows: ${data.length}
Columns: ${columns.map((c) => c.name).join(", ")}

Generate a preview for this command. Return JSON only.`,
    });

    const completion = await zai.chat.completions.create({
      messages,
      temperature: 0.1,
    });

    const rawContent = completion.choices?.[0]?.message?.content;
    if (!rawContent) {
      return NextResponse.json({
        aiMessage: "I couldn't process that command. Please try rephrasing it.",
        preview: null,
        executedDirectly: false,
      });
    }

    const parsed = parseResponse(rawContent);
    const aiMessage = typeof parsed.aiMessage === "string"
      ? parsed.aiMessage
      : "I've analyzed your command. See the preview below.";

    const preview = parsed.preview && typeof parsed.preview === "object" && parsed.preview.type
      ? {
          type: String(parsed.preview.type || "general"),
          description: String(parsed.preview.description || ""),
          preview: Array.isArray(parsed.preview.preview) ? parsed.preview.preview.slice(0, 5) : [],
          affectedRows: Number(parsed.preview.affectedRows || 0),
          affectedColumns: Array.isArray(parsed.preview.affectedColumns) ? parsed.preview.affectedColumns.map(String) : [],
          confidence: typeof parsed.preview.confidence === "number" ? Math.min(1, Math.max(0, parsed.preview.confidence)) : 0.8,
          label: ["HIGH", "MEDIUM", "LOW"].includes(String(parsed.preview.label)) ? String(parsed.preview.label) : "MEDIUM",
          executionPlan: String(parsed.preview.executionPlan || ""),
        } satisfies PreviewAction
      : null;

    return NextResponse.json({
      aiMessage,
      preview,
      executedDirectly: false,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[chat-edit] Error:", message);
    return NextResponse.json({
      aiMessage: `Error processing command: ${message}`,
      preview: null,
      executedDirectly: false,
    });
  }
}

// ── Deterministic pattern matching for common commands ──

function tryLocalPatternMatch(
  message: string,
  data: RawDataRow[],
  columns: ColumnMeta[]
): ChatEditResponse | null {
  const headers = Object.keys(data[0] || {});
  const msg = message.trim();

  // 1. Rename column
  const renameMatch = msg.match(/^(?:rename|change)\s+(?:column\s+)?["']?(\w+)["']?\s+to\s+["']?(\w+)["']?/i);
  if (renameMatch) {
    const [, oldName, newName] = renameMatch;
    if (!headers.includes(oldName)) {
      return {
        aiMessage: `Column "${oldName}" not found. Available columns: ${headers.join(", ")}`,
        preview: null,
        executedDirectly: false,
      };
    }
    return {
      aiMessage: `I'll rename column "${oldName}" to "${newName}". This affects all ${data.length} rows.`,
      preview: {
        type: "rename_column",
        description: `Rename column "${oldName}" to "${newName}"`,
        preview: [{ before: { [oldName]: data[0]?.[oldName] ?? "null" }, after: { [newName]: data[0]?.[oldName] ?? "null" } }],
        affectedRows: data.length,
        affectedColumns: [oldName],
        confidence: 1.0,
        label: "HIGH",
        executionPlan: `Rename "${oldName}" → "${newName}" across all ${data.length} rows`,
      },
      executedDirectly: false,
    };
  }

  // 2. Delete rows where column is null
  const deleteMatch = msg.match(/^(?:delete|drop|remove)\s+(?:rows?\s+)?where\s+["']?(\w+)["']?\s+(?:is\s+)?(?:null|NULL|empty|missing)/i);
  if (deleteMatch) {
    const [, col] = deleteMatch;
    if (!headers.includes(col)) {
      return {
        aiMessage: `Column "${col}" not found. Available columns: ${headers.join(", ")}`,
        preview: null,
        executedDirectly: false,
      };
    }
    const nullCount = data.filter((r) => r[col] == null || String(r[col]).trim() === "").length;
    if (nullCount === 0) {
      return {
        aiMessage: `No null/empty values found in "${col}". Nothing to delete.`,
        preview: null,
        executedDirectly: false,
      };
    }
    return {
      aiMessage: `Found ${nullCount} rows where "${col}" is null/empty. This is a risky operation — review the preview carefully.`,
      preview: {
        type: "delete_rows",
        description: `Delete ${nullCount} rows where "${col}" is null/empty`,
        preview: data.slice(0, 3).filter((r) => r[col] == null || String(r[col]).trim() === "").map((r) => ({
          before: { [col]: r[col] ?? "NULL" },
          after: { [col]: "[DELETED]" },
        })),
        affectedRows: nullCount,
        affectedColumns: [col],
        confidence: 1.0,
        label: "HIGH",
        executionPlan: `Remove ${nullCount} of ${data.length} rows where "${col}" is null/empty. Remaining: ${data.length - nullCount} rows.`,
      },
      executedDirectly: false,
    };
  }

  // 3. Replace values
  const replaceMatch = msg.match(/^(?:replace|fix|set)\s+(?:all\s+)?["']([^"']+)["'](?:\s+(?:with|to)\s+["']([^"']+)["'])?/i);
  if (replaceMatch) {
    const fullMatch = msg.match(/^(?:replace|fix|set)\s+(?:all\s+)?["']([^"']+)["'](?:\s+(?:with|to)\s+["']([^"']+)["'](?:\s+(?:in)\s+["']?(\w+)["']?)?)?/i);
    if (fullMatch) {
      const [, searchVal, replaceVal, colName] = fullMatch;
      const targetCols = colName && headers.includes(colName) ? [colName] : headers;
      let totalAffected = 0;
      const previewExamples: Array<{ before: Record<string, unknown>; after: Record<string, unknown> }> = [];

      for (const col of targetCols) {
        for (const row of data) {
          if (String(row[col]).trim() === searchVal) {
            totalAffected++;
            if (previewExamples.length < 3) {
              previewExamples.push({ before: { [col]: searchVal }, after: { [col]: replaceVal || "NULL" } });
            }
          }
        }
      }

      if (totalAffected === 0) {
        return {
          aiMessage: `No values matching "${searchVal}" found${colName ? ` in column "${colName}"` : ""}.`,
          preview: null,
          executedDirectly: false,
        };
      }

      return {
        aiMessage: `Found ${totalAffected} occurrences of "${searchVal}"${colName ? ` in "${colName}"` : " across all columns"}. Preview:`,
        preview: {
          type: "replace_values",
          description: `Replace "${searchVal}" with "${replaceVal || "NULL"}"${colName ? ` in column "${colName}"` : ""}`,
          preview: previewExamples,
          affectedRows: totalAffected,
          affectedColumns: targetCols,
          confidence: 0.95,
          label: "HIGH",
          executionPlan: `Replace all "${searchVal}" → "${replaceVal || "NULL"}" in ${targetCols.length > 1 ? `${targetCols.length} columns` : `"${targetCols[0]}"`}`,
        },
        executedDirectly: false,
      };
    }
  }

  // 4. Merge categories
  const mergeMatch = msg.match(/^(?:merge|convert|combine)\s+(?:values?\s+)?["']?([^"']+)["']?\s+(?:and|&|with|,)\s+["']?([^"']+)["']?\s+(?:to|→|into)\s+["']?([^"']+)["']?/i);
  if (mergeMatch) {
    const [, val1, val2, targetVal] = mergeMatch;
    let totalAffected = 0;
    const previewExamples: Array<{ before: Record<string, unknown>; after: Record<string, unknown> }> = [];

    // Find the column that contains both values
    for (const col of headers) {
      const colValues = new Set(data.map((r) => String(r[col]).trim().toLowerCase()));
      if (colValues.has(val1.toLowerCase()) || colValues.has(val2.toLowerCase())) {
        for (const row of data) {
          const rv = String(row[col]).trim();
          if (rv === val1 || rv === val2) {
            totalAffected++;
            if (previewExamples.length < 3) {
              previewExamples.push({ before: { [col]: rv }, after: { [col]: targetVal } });
            }
          }
        }
      }
    }

    if (totalAffected === 0) {
      return {
        aiMessage: `No values matching "${val1}" or "${val2}" found in any column.`,
        preview: null,
        executedDirectly: false,
      };
    }

    return {
      aiMessage: `Found ${totalAffected} cells that will be merged from "${val1}" and "${val2}" to "${targetVal}".`,
      preview: {
        type: "merge_categories",
        description: `Merge "${val1}" and "${val2}" to "${targetVal}"`,
        preview: previewExamples,
        affectedRows: totalAffected,
        affectedColumns: [],
        confidence: 0.95,
        label: "HIGH",
        executionPlan: `Replace all occurrences of "${val1}" and "${val2}" with "${targetVal}" in matching columns`,
      },
      executedDirectly: false,
    };
  }

  return null; // No local match — let AI handle it
}
