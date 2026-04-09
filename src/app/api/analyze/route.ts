import { NextRequest, NextResponse } from "next/server";
import ZAI from "@/lib/ai-provider";
import type {
  RawDataRow,
  ColumnMeta,
  KPIConfig,
  ChartConfig,
  FilterConfig,
  LayoutType,
  ChartType,
} from "@/lib/dashboard-types";

// ---- Types ----

interface AnalyzeRequest {
  data: RawDataRow[];
  columns: ColumnMeta[];
  userMessage?: string;
  userInstructions?: string;
  currentConfig?: {
    kpis: KPIConfig[];
    charts: ChartConfig[];
    filters: FilterConfig[];
    selected_layout: LayoutType;
  };
}

interface AnalyzeResponse {
  kpis: KPIConfig[];
  charts: ChartConfig[];
  filters: FilterConfig[];
  selected_layout: LayoutType;
  ai_message: string;
}

// ---- Constants ----

const VALID_CHART_TYPES: ChartType[] = [
  "line", "bar", "horizontal_bar", "stacked_bar", "area", "pie",
  "donut", "stacked_area", "scatter", "bubble", "histogram",
  "combo_chart", "waterfall_chart", "funnel_chart", "treemap",
];

const VALID_LAYOUTS: LayoutType[] = ["analytical", "exclusive"];

const VALID_AGGREGATIONS = ["sum", "avg", "count", "min", "max", "median", "ratio"] as const;
const VALID_FORMATS = ["number", "currency", "percent", "compact"] as const;
const VALID_FILTER_TYPES = ["select", "multi-select", "date-range", "number-range"] as const;

// ---- Helpers ----

function buildDataSummary(data: RawDataRow[], columns: ColumnMeta[]) {
  const numericColumns = columns.filter((c) => c.type === "number");
  const categoricalColumns = columns.filter((c) => c.type === "string" && c.uniqueCount < 50);
  const dateColumns = columns.filter((c) => c.type === "date");

  const numericStats: Record<string, { min: number; max: number; avg: number; sum: number; count: number }> = {};

  for (const col of numericColumns) {
    const values = data
      .map((r) => Number(r[col.name]))
      .filter((v) => !isNaN(v));
    if (values.length > 0) {
      const sum = values.reduce((a, b) => a + b, 0);
      numericStats[col.name] = {
        min: Math.min(...values),
        max: Math.max(...values),
        avg: Math.round((sum / values.length) * 100) / 100,
        sum: Math.round(sum * 100) / 100,
        count: values.length,
      };
    }
  }

  const categoricalCardinality: Record<string, { unique: number; samples: string[] }> = {};
  for (const col of categoricalColumns) {
    const unique = new Set(data.map((r) => String(r[col.name] ?? "")).filter(Boolean));
    categoricalCardinality[col.name] = {
      unique: unique.size,
      samples: Array.from(unique).slice(0, 10),
    };
  }

  return { numericStats, categoricalCardinality, dateColumns: dateColumns.map((c) => c.name) };
}

function stripMarkdownCodeBlocks(text: string): string {
  // Remove ```json ... ``` or ``` ... ``` wrappers
  return text
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
}

function parseAIResponse(raw: string): Partial<AnalyzeResponse> {
  let text = raw.trim();

  // Try to extract JSON from the response - it might be embedded in text
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    text = jsonMatch[0];
  }

  text = stripMarkdownCodeBlocks(text);

  try {
    return JSON.parse(text) as Partial<AnalyzeResponse>;
  } catch {
    return {};
  }
}

function validateAndNormalizeKPI(kpi: Record<string, unknown>, index: number): KPIConfig {
  return {
    id: (kpi.id as string) || `kpi-${index}`,
    title: String(kpi.title || `KPI ${index + 1}`),
    column: String(kpi.column || ""),
    aggregation: (VALID_AGGREGATIONS as readonly string[]).includes(String(kpi.aggregation))
      ? (kpi.aggregation as KPIConfig["aggregation"])
      : "sum",
    format: (VALID_FORMATS as readonly string[]).includes(String(kpi.format))
      ? (kpi.format as KPIConfig["format"])
      : "compact",
    ...(kpi.ratioDenominator ? { ratioDenominator: String(kpi.ratioDenominator) } : {}),
    ...(kpi.prefix ? { prefix: String(kpi.prefix) } : {}),
    ...(kpi.suffix ? { suffix: String(kpi.suffix) } : {}),
  };
}

function validateAndNormalizeChart(chart: Record<string, unknown>, index: number): ChartConfig {
  const chartType = (VALID_CHART_TYPES as readonly string[]).includes(String(chart.type))
    ? (chart.type as ChartType)
    : "bar";

  const yValues = Array.isArray(chart.y) ? chart.y.map(String) : [];
  const rawConfig = (chart.config as Record<string, unknown>) || {};

  return {
    id: (chart.id as string) || `chart-${index}`,
    type: chartType,
    title: String(chart.title || `Chart ${index + 1}`),
    description: chart.description ? String(chart.description) : undefined,
    x: String(chart.x || ""),
    y: yValues,
    ...(chart.colorBy ? { colorBy: String(chart.colorBy) } : {}),
    ...(chart.size ? { size: String(chart.size) } : {}),
    config: {
      stacked: typeof rawConfig.stacked === "boolean" ? rawConfig.stacked : undefined,
      innerRadius: typeof rawConfig.innerRadius === "number" ? rawConfig.innerRadius : undefined,
      outerRadius: typeof rawConfig.outerRadius === "number" ? rawConfig.outerRadius : undefined,
      barThickness: typeof rawConfig.barThickness === "number" ? rawConfig.barThickness : undefined,
      fillOpacity: typeof rawConfig.fillOpacity === "number" ? rawConfig.fillOpacity : undefined,
      stroke_width: typeof rawConfig.stroke_width === "number" ? rawConfig.stroke_width : undefined,
      showLegend: typeof rawConfig.showLegend === "boolean" ? rawConfig.showLegend : undefined,
      showTooltip: typeof rawConfig.showTooltip === "boolean" ? rawConfig.showTooltip : undefined,
      curveType: ["monotone", "linear", "step", "natural"].includes(String(rawConfig.curveType))
        ? (rawConfig.curveType as ChartConfig["config"]["curveType"])
        : undefined,
      orient: ["horizontal", "vertical"].includes(String(rawConfig.orient))
        ? (rawConfig.orient as ChartConfig["config"]["orient"])
        : undefined,
      buckets: typeof rawConfig.buckets === "number" ? rawConfig.buckets : undefined,
    },
  };
}

function validateAndNormalizeFilter(filter: Record<string, unknown>, index: number): FilterConfig {
  return {
    id: (filter.id as string) || `filter-${index}`,
    column: String(filter.column || ""),
    label: String(filter.label || String(filter.column || `Filter ${index + 1}`)),
    type: (VALID_FILTER_TYPES as readonly string[]).includes(String(filter.type))
      ? (filter.type as FilterConfig["type"])
      : "select",
    ...(filter.options && Array.isArray(filter.options)
      ? { options: filter.options.map(String) }
      : {}),
  };
}

function buildFallbackConfig(columns: ColumnMeta[]): AnalyzeResponse {
  const numericCols = columns.filter((c) => c.type === "number");
  const categoricalCols = columns.filter((c) => c.type === "string" && c.uniqueCount < 30 && c.uniqueCount > 1);

  const kpis: KPIConfig[] = numericCols.slice(0, 4).map((col, i) => ({
    id: `kpi-${i}`,
    title: col.name.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    column: col.name,
    aggregation: "sum" as const,
    format: "compact" as const,
  }));

  const charts: ChartConfig[] = [];
  let chartIdx = 0;

  if (categoricalCols.length > 0 && numericCols.length > 0) {
    charts.push({
      id: `chart-${chartIdx++}`,
      type: "bar",
      title: `${numericCols[0].name} by ${categoricalCols[0].name}`,
      x: categoricalCols[0].name,
      y: [numericCols[0].name],
      config: { showTooltip: true },
    });
  }
  if (numericCols.length >= 2) {
    charts.push({
      id: `chart-${chartIdx++}`,
      type: "scatter",
      title: `${numericCols[0].name} vs ${numericCols[1].name}`,
      x: numericCols[0].name,
      y: [numericCols[1].name],
      config: { showTooltip: true },
    });
  }

  const filters: FilterConfig[] = categoricalCols.slice(0, 3).map((col, i) => ({
    id: `filter-${i}`,
    column: col.name,
    label: col.name.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    type: "select" as const,
    options: col.sampleValues.map(String).filter(Boolean),
  }));

  return {
    kpis,
    charts,
    filters,
    selected_layout: "analytical",
    ai_message: "I was unable to generate AI-powered recommendations. Here is a basic dashboard configuration based on your data columns.",
  };
}

// ---- System Prompt Builder ----

function buildSystemPrompt(): string {
  return `You are an expert data analyst and dashboard designer. Your job is to analyze uploaded CSV data and recommend the best possible dashboard configuration.

You MUST respond with ONLY valid JSON — no markdown, no explanation outside the JSON. The JSON must have this exact structure:

{
  "kpis": [
    {
      "id": "kpi-0",
      "title": "Human-readable title",
      "column": "exact_column_name",
      "aggregation": "sum|avg|count|min|max|median|ratio",
      "format": "number|currency|percent|compact",
      "prefix": "optional prefix like $",
      "suffix": "optional suffix like %"
    }
  ],
  "charts": [
    {
      "id": "chart-0",
      "type": "line|bar|horizontal_bar|stacked_bar|area|pie|donut|stacked_area|scatter|combo_chart",
      "title": "Chart title",
      "x": "column_name_for_x_axis",
      "y": ["column_name_for_y_axis"],
      "config": {
        "stacked": false,
        "showLegend": true,
        "showTooltip": true,
        "curveType": "monotone|linear|step",
        "barThickness": 32
      }
    }
  ],
  "filters": [
    {
      "id": "filter-0",
      "column": "column_name",
      "label": "Display Label",
      "type": "select|multi-select|date-range|number-range",
      "options": ["option1", "option2"]
    }
  ],
  "selected_layout": "analytical|exclusive",
  "ai_message": "A friendly 2-3 sentence summary of what the dashboard shows and why these charts were chosen."
}

IMPORTANT RULES:
1. Include up to 4 KPIs focusing on the most important numeric metrics
2. Include up to 6 charts with diverse chart types
3. For "format" on KPIs: use "currency" for money columns, "percent" for rate/ratio columns, "compact" for large numbers, "number" for small numbers
4. Choose "selected_layout" based on data complexity: "analytical" for detailed exploration with multiple charts and filters, "exclusive" for a premium focused view with fewer but more impactful visualizations
5. All column names must EXACTLY match the provided column names
6. For pie/donut charts, ensure the x-axis column has <= 10 unique values
7. For scatter plots, x and y should both be numeric columns
8. Always include filters for categorical columns with reasonable unique values (2-20)
9. Provide actual options arrays for select/multi-select filters based on the data`;
}

function buildAnalysisPrompt(
  data: RawDataRow[],
  columns: ColumnMeta[],
  summary: ReturnType<typeof buildDataSummary>,
  userInstructions?: string
): string {
  const sampleData = data.slice(0, 5);
  const columnInfo = columns
    .map((c) => `  - ${c.name} (${c.type}, ${c.uniqueCount} unique values, ${c.missingCount} missing)`)
    .join("\n");

  let numericStatsStr = "";
  for (const [col, stats] of Object.entries(summary.numericStats)) {
    numericStatsStr += `  - ${col}: min=${stats.min}, max=${stats.max}, avg=${stats.avg}, sum=${stats.sum} (n=${stats.count})\n`;
  }

  let categoricalStr = "";
  for (const [col, info] of Object.entries(summary.categoricalCardinality)) {
    categoricalStr += `  - ${col}: ${info.unique} unique values, samples: [${info.samples.join(", ")}]\n`;
  }

  return `Analyze this dataset and create an optimal dashboard configuration.

DATASET OVERVIEW:
- Total rows: ${data.length}
- Total columns: ${columns.length}

${userInstructions ? `USER INSTRUCTIONS / CONTEXT:
${userInstructions}

` : ""}COLUMNS:
${columnInfo}

NUMERIC COLUMN STATISTICS:
${numericStatsStr || "  (none)"}

CATEGORICAL COLUMN DETAILS:
${categoricalStr || "  (none)"}

DATE COLUMNS: ${summary.dateColumns.length > 0 ? summary.dateColumns.join(", ") : "(none)"}

SAMPLE DATA (first 5 rows):
${JSON.stringify(sampleData, null, 2)}

Based on this data, generate the best dashboard configuration. Consider:
- What are the most important metrics to highlight?
- What chart types best represent the relationships in the data?
- What filters would be most useful for exploration?
- What layout best suits the data complexity?`;
}

function buildChatPrompt(
  userMessage: string,
  currentConfig: AnalyzeRequest["currentConfig"],
  columns: ColumnMeta[],
  summary: ReturnType<typeof buildDataSummary>,
  userInstructions?: string
): string {
  return `The user wants to modify their current dashboard. Here is their request:

USER REQUEST: "${userMessage}"

CURRENT DASHBOARD CONFIGURATION:
${JSON.stringify(currentConfig, null, 2)}

AVAILABLE COLUMNS:
${columns.map((c) => `${c.name} (${c.type}, ${c.uniqueCount} unique)`).join("\n")}

Modify the dashboard configuration based on the user's request. Return the COMPLETE updated configuration (not just the changes) in the same JSON format. Keep any existing items that are not being changed, and only modify/add/remove what the user requests.${userInstructions ? `\n\nUSER CONTEXT: ${userInstructions}` : ""}`;
}

// ---- Main Route Handler ----

export async function POST(request: NextRequest) {
  let body: AnalyzeRequest | undefined;

  try {
    body = await request.json();

    const { data, columns, userMessage, currentConfig } = body;

    // Validate required fields
    if (!data || !Array.isArray(data) || data.length === 0) {
      return NextResponse.json(
        { error: "Invalid or empty data array provided" },
        { status: 400 }
      );
    }

    if (!columns || !Array.isArray(columns) || columns.length === 0) {
      return NextResponse.json(
        { error: "Invalid or empty columns array provided" },
        { status: 400 }
      );
    }

    // Build data summary
    const summary = buildDataSummary(data, columns);

    // Initialize LLM
    const zai = await ZAI.create();

    // Determine if this is an initial analysis or a chat modification
    const isChatModification = !!userMessage && !!currentConfig;

    let prompt: string;
    if (isChatModification) {
      prompt = buildChatPrompt(userMessage, currentConfig, columns, summary, body.userInstructions);
    } else {
      prompt = buildAnalysisPrompt(data, columns, summary, body.userInstructions);
    }

    // Add user message as context if present but no current config
    let messages: { role: string; content: string }[];
    if (userMessage && !isChatModification) {
      messages = [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: prompt },
        { role: "user", content: `Additional user preference: "${userMessage}"` },
      ];
    } else {
      messages = [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: prompt },
      ];
    }

    // Call the LLM
    const completion = await zai.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: messages as { role: "system" | "user" | "assistant"; content: string }[],
      temperature: 0.3,
    });

    const rawContent = completion.choices?.[0]?.message?.content;

    if (!rawContent) {
      console.error("[analyze] Empty response from LLM");
      const fallback = buildFallbackConfig(columns);
      return NextResponse.json(fallback);
    }

    // Parse the AI response
    const parsed = parseAIResponse(rawContent);

    // Validate and normalize the response
    const kpis: KPIConfig[] = Array.isArray(parsed.kpis)
      ? parsed.kpis.slice(0, 4).map((k, i) => validateAndNormalizeKPI(k as Record<string, unknown>, i))
      : [];

    const charts: ChartConfig[] = Array.isArray(parsed.charts)
      ? parsed.charts.slice(0, 6).map((c, i) => validateAndNormalizeChart(c as Record<string, unknown>, i))
      : [];

    const filters: FilterConfig[] = Array.isArray(parsed.filters)
      ? parsed.filters.slice(0, 8).map((f, i) => validateAndNormalizeFilter(f as Record<string, unknown>, i))
      : [];

    const selected_layout: LayoutType = VALID_LAYOUTS.includes(parsed.selected_layout as LayoutType)
      ? (parsed.selected_layout as LayoutType)
      : "analytical";

    const ai_message: string = typeof parsed.ai_message === "string"
      ? parsed.ai_message
      : "Dashboard generated based on your data analysis.";

    // Validate that KPI and chart columns actually exist in the data
    const validColumnNames = new Set(columns.map((c) => c.name));
    const filteredKpis = kpis.filter((k) => validColumnNames.has(k.column));
    const filteredCharts = charts.filter(
      (c) => validColumnNames.has(c.x) && c.y.every((y) => validColumnNames.has(y))
    );
    const filteredFilters = filters.filter((f) => validColumnNames.has(f.column));

    const response: AnalyzeResponse = {
      kpis: filteredKpis,
      charts: filteredCharts,
      filters: filteredFilters,
      selected_layout,
      ai_message,
    };

    // If AI returned nothing useful, fall back
    if (filteredKpis.length === 0 && filteredCharts.length === 0) {
      console.warn("[analyze] AI returned no valid KPIs or charts, using fallback");
      return NextResponse.json(buildFallbackConfig(columns));
    }

    return NextResponse.json(response);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    console.error("[analyze] Error:", message);

    // Try to return a fallback if we managed to parse the body
    const hasColumns = body?.columns && Array.isArray(body.columns) && body.columns.length > 0;
    if (hasColumns) {
      return NextResponse.json(buildFallbackConfig(body!.columns));
    }

    return NextResponse.json(
      {
        kpis: [],
        charts: [],
        filters: [],
        selected_layout: "analytical" as LayoutType,
        ai_message: `An error occurred during analysis: ${message}. Please try again.`,
      },
      { status: 500 }
    );
  }
}
