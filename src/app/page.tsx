"use client";

import React, { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useDashboardStore } from "@/lib/dashboard-store";
import { DataUploadV2 } from "@/components/dashboard/data-upload-v2";
import { WorkflowStepper } from "@/components/dashboard/workflow-stepper";
import { CleaningPhase } from "@/components/dashboard/cleaning-phase";
import { PivotPhase } from "@/components/dashboard/pivot-phase";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { KPICards } from "@/components/dashboard/kpi-cards";
import { ChartEngine } from "@/components/dashboard/chart-engine";
import { ChartEditor } from "@/components/dashboard/chart-editor";
import { AIChat } from "@/components/dashboard/ai-chat";
import { StyleConfig } from "@/components/dashboard/style-config";
import { DataTable } from "@/components/dashboard/data-table";
import { DashboardLoader } from "@/components/dashboard/dashboard-loader";
import { aggregateByColumn } from "@/lib/data-utils";
import type { RawDataRow, ChartConfig } from "@/lib/dashboard-types";
import { cn } from "@/lib/utils";

function processChartData(
  chart: ChartConfig,
  filteredData: RawDataRow[]
): RawDataRow[] {
  if (chart.data && chart.data.length > 0) return chart.data;

  const { x, y, type } = chart;

  if (type === "pie" || type === "donut") {
    return aggregateByColumn(filteredData, x, y).slice(0, 10);
  }

  if (
    (type === "bar" || type === "horizontal_bar" || type === "stacked_bar") &&
    y.length > 0
  ) {
    const firstVal = filteredData[0]?.[x];
    const isNumericX = typeof firstVal === "number";
    if (!isNumericX) {
      return aggregateByColumn(filteredData, x, y).slice(0, 15);
    }
  }

  if ((type === "line" || type === "area" || type === "stacked_area" || type === "combo_chart") && y.length > 0) {
    const firstVal = filteredData[0]?.[x];
    const isNumericX = typeof firstVal === "number";
    if (!isNumericX) {
      return aggregateByColumn(filteredData, x, y);
    }
  }

  if (type === "scatter") {
    return filteredData.slice(0, 200);
  }

  return filteredData;
}

function AnalyticalLayout() {
  const { config, filteredData } = useDashboardStore();
  const charts = config?.charts ?? [];

  const processedCharts = useMemo(
    () => charts.map((c) => ({ chart: c, data: processChartData(c, filteredData) })),
    [charts, filteredData]
  );

  return (
    <div className="space-y-6">
      <KPICards />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {processedCharts.map((item, index) => (
          <motion.div
            key={item.chart.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.08 * index }}
            className={cn(
              item.chart.width === 8 && "lg:col-span-2"
            )}
          >
            <ChartEngine chartConfig={item.chart} data={item.data} />
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.2 }}
      >
        <DataTable />
      </motion.div>
    </div>
  );
}

function ExclusiveLayout() {
  const { config, filteredData } = useDashboardStore();
  const charts = config?.charts ?? [];

  const processedCharts = useMemo(
    () => charts.map((c) => ({ chart: c, data: processChartData(c, filteredData) })),
    [charts, filteredData]
  );

  // Exclusive: One hero chart + KPIs row, premium feel
  const heroChart = processedCharts[0];
  const otherCharts = processedCharts.slice(1);

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <KPICards />

      {/* Hero Chart - Full Width */}
      {heroChart && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <ChartEngine chartConfig={heroChart.chart} data={heroChart.data} />
        </motion.div>
      )}

      {/* Remaining Charts - Smaller grid */}
      {otherCharts.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {otherCharts.map((item, index) => (
            <motion.div
              key={item.chart.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.08 * index }}
              className={cn(
                item.chart.width === 8 && "lg:col-span-2"
              )}
            >
              <ChartEngine chartConfig={item.chart} data={item.data} />
            </motion.div>
          ))}
        </div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.3 }}
      >
        <DataTable />
      </motion.div>
    </div>
  );
}

function DashboardView() {
  const { config } = useDashboardStore();
  const layout = config?.layout ?? "analytical";

  if (layout === "exclusive") return <ExclusiveLayout />;
  return <AnalyticalLayout />;
}

export default function Home() {
  const { workflowPhase, config } = useDashboardStore();
  const hasDashboard = !!config && config.kpis.length > 0;
  const isDashboardPhase = workflowPhase === "dashboard";
  const isDashboardReady = isDashboardPhase && hasDashboard;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Workflow Stepper - shown during all phases after upload */}
      {workflowPhase !== "upload" && <WorkflowStepper />}

      {/* Dashboard Header - shown only when dashboard is ready */}
      {isDashboardReady && <DashboardHeader />}

      <main
        className={cn(
          "flex-1 w-full overflow-y-auto",
          isDashboardReady
            ? "bg-[#f5f5f5] p-4 lg:p-6"
            : isDashboardPhase
              ? "bg-white"
              : "flex items-center justify-center p-4 bg-white"
        )}
      >
        <AnimatePresence mode="wait">
          {workflowPhase === "upload" && (
            <motion.div
              key="upload"
              className="w-full flex items-center justify-center min-h-[70vh]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <DataUploadV2 />
            </motion.div>
          )}

          {workflowPhase === "cleaning" && (
            <motion.div
              key="cleaning"
              className="w-full py-8"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <CleaningPhase />
            </motion.div>
          )}

          {workflowPhase === "pivot" && (
            <motion.div
              key="pivot"
              className="w-full py-8"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <PivotPhase />
            </motion.div>
          )}

          {workflowPhase === "dashboard" && !hasDashboard && (
            <motion.div
              key="dashboard-loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <DashboardLoader />
            </motion.div>
          )}

          {workflowPhase === "dashboard" && hasDashboard && (
            <motion.div
              key="dashboard-ready"
              id="dashboard-canvas"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="w-full max-w-[1600px] mx-auto"
            >
              <DashboardView />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t py-4 px-4 text-center bg-white">
        <p className="text-xs text-muted-foreground">
          AI Data Dashboard &middot; Powered by Z.ai &middot; Built with Next.js, Recharts & shadcn/ui
        </p>
      </footer>

      {/* Floating components - only when dashboard is ready */}
      {isDashboardReady && (
        <>
          <AIChat />
          <StyleConfig />
          <ChartEditor />
        </>
      )}
    </div>
  );
}

