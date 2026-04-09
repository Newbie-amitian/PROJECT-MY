import { NextRequest, NextResponse } from "next/server";
import type { RawDataRow, ColumnMeta } from "@/lib/dashboard-types";
import { detectColumnProfile, generateCleaningPlan, generateSummary } from "@/lib/cleaning-engine";

// ============================================================
// Deterministic Data Cleaning API
// ============================================================
// NO AI is used here. The system operates as a pure rule engine.
// AI must NEVER decide transformations — only predefined rules are executed.
//
// This endpoint performs:
// 1. Schema Detection (column type, missing values, unique count)
// 2. Rule Set Generation (10-step deterministic pipeline)
// 3. Summary Generation
//
// The actual rule application happens client-side in cleaning-engine.ts

interface CleanRequest {
  data: RawDataRow[];
  columns: ColumnMeta[];
  userInstructions?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: CleanRequest = await request.json();
    const { data, columns } = body;

    if (!data || !Array.isArray(data) || data.length === 0) {
      return NextResponse.json({ error: "No data provided" }, { status: 400 });
    }

    if (!columns || !Array.isArray(columns) || columns.length === 0) {
      return NextResponse.json({ error: "No column metadata provided" }, { status: 400 });
    }

    // STEP 1: Schema Detection — pure deterministic, no AI
    const profiles = columns.map((col) => detectColumnProfile(col, data));

    // STEP 2: Generate cleaning plan — pure deterministic rules
    const cleaningPlan = generateCleaningPlan(columns, data);

    // STEP 3: Generate summary
    const summary = generateSummary(profiles, cleaningPlan.length, data.length, data.length);

    // Build column profiles for response
    const columnProfiles = profiles.map((p) => ({
      name: p.name,
      detectedType: p.detectedType,
      missingCount: p.missingCount,
      missingPct: Math.round(p.missingPct * 10) / 10,
      uniqueCount: p.uniqueCount,
      totalCount: p.totalCount,
      hasRanges: p.hasRanges,
      hasWordNumbers: p.hasWordNumbers,
      hasMixedUnits: p.hasMixedUnits,
      numericPct: Math.round(p.numericPct * 10) / 10,
      isIdColumn: p.isIdColumn,
      isBooleanColumn: p.isBooleanColumn,
      isDateColumn: p.isDateColumn,
      isConsistentCase: p.isConsistentCase,
    }));

    return NextResponse.json({
      mode: "deterministic_rule_engine",
      summary,
      isAlreadyClean: cleaningPlan.length === 0,
      originalRows: data.length,
      cleanedRows: data.length,
      columnProfiles,
      cleaningPlan: cleaningPlan.map((rule) => ({
        id: rule.id,
        step: rule.step,
        stepName: rule.stepName,
        section: rule.section,
        column: rule.column,
        columnClass: rule.columnClass,
        expectedType: rule.expectedType,
        method: rule.method,
        transformation: rule.transformation,
        condition: rule.condition,
        severity: rule.severity,
        riskLevel: rule.riskLevel,
        confidence_score: rule.confidence_score,
        confidence_label: rule.confidence_label,
        exampleConversions: rule.exampleConversions,
        reason: rule.reason,
        applied: false,
        issueType: rule.issueType,
      })),
      stats: {
        total: cleaningPlan.length,
        critical: cleaningPlan.filter((r) => r.severity === "critical").length,
        warning: cleaningPlan.filter((r) => r.severity === "warning").length,
        info: cleaningPlan.filter((r) => r.severity === "info").length,
        highRisk: cleaningPlan.filter((r) => r.riskLevel === "high").length,
        mediumRisk: cleaningPlan.filter((r) => r.riskLevel === "medium").length,
        highConfidence: cleaningPlan.filter((r) => r.confidence_label === "HIGH").length,
        mediumConfidence: cleaningPlan.filter((r) => r.confidence_label === "MEDIUM").length,
        lowConfidence: cleaningPlan.filter((r) => r.confidence_label === "LOW").length,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[clean] Error:", message);
    return NextResponse.json({
      error: `Rule engine error: ${message}`,
      mode: "deterministic_rule_engine",
      summary: `Error during analysis: ${message}`,
      isAlreadyClean: false,
      originalRows: 0,
      cleanedRows: 0,
      columnProfiles: [],
      cleaningPlan: [],
      stats: { total: 0, critical: 0, warning: 0, info: 0, highRisk: 0, mediumRisk: 0, highConfidence: 0, mediumConfidence: 0, lowConfidence: 0 },
    }, { status: 500 });
  }
}
