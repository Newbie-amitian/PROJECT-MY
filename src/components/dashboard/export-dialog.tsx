"use client";

import React, { useCallback, useState } from "react";
import {
  Download,
  FileText,
  FileSpreadsheet,
  Loader2,
  CheckCircle2,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useDashboardStore } from "@/lib/dashboard-store";
import { exportAsPDF, exportAsPBIX } from "@/lib/export-utils";
import { cn } from "@/lib/utils";

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function ExportButton({
  icon: Icon,
  title,
  description,
  format,
  onExport,
  isExporting,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  format: string;
  onExport: () => void;
  isExporting: boolean;
}) {
  return (
    <button
      onClick={onExport}
      disabled={isExporting}
      className={cn(
        "flex items-start gap-4 p-4 rounded-xl border-2 transition-all w-full text-left",
        "hover:border-[#f0c040]/40 hover:bg-[#f0c040]/5",
        "active:scale-[0.98]",
        isExporting && "opacity-70 pointer-events-none"
      )}
    >
      <div
        className={cn(
          "w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-colors",
          format === "PDF"
            ? "bg-rose-100 dark:bg-rose-950/30"
            : "bg-blue-100 dark:bg-blue-950/30"
        )}
      >
        {isExporting ? (
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        ) : (
          <Icon className={cn(
            "w-6 h-6",
            format === "PDF" ? "text-rose-600 dark:text-rose-400" : "text-blue-600 dark:text-blue-400"
          )} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-semibold mb-0.5">{title}</h3>
        <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
      </div>
      <div className="shrink-0 mt-1">
        <span
          className={cn(
            "text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded",
            format === "PDF"
              ? "bg-rose-100 text-rose-600 dark:bg-rose-950/30 dark:text-rose-400"
              : "bg-blue-100 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400"
          )}
        >
          {format}
        </span>
      </div>
    </button>
  );
}

export function ExportDialog({ open, onOpenChange }: ExportDialogProps) {
  const { config, rawData, cleanedData } = useDashboardStore();
  const [exportingFormat, setExportingFormat] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  const title = config?.title ?? "Dashboard";

  const handleExportPDF = useCallback(async () => {
    setExportingFormat("PDF");
    setExportSuccess(null);
    try {
      await exportAsPDF(title);
      setExportSuccess("PDF");
    } catch (err) {
      console.error("PDF export failed:", err);
    } finally {
      setTimeout(() => setExportingFormat(null), 1000);
    }
  }, [title]);

  const handleExportPBIX = useCallback(async () => {
    if (!config) return;
    setExportingFormat("PBIX");
    setExportSuccess(null);
    try {
      await exportAsPBIX(config, rawData, cleanedData);
      setExportSuccess("PBIX");
    } catch (err) {
      console.error("PBIX export failed:", err);
    } finally {
      setTimeout(() => setExportingFormat(null), 1000);
    }
  }, [config, rawData, cleanedData]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] p-0 gap-0 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#2b2b2b] to-[#3a3a3a] px-6 py-5">
          <DialogHeader>
            <DialogTitle className="text-white text-lg flex items-center gap-2">
              <Download className="w-5 h-5 text-[#f0c040]" />
              Export Dashboard
            </DialogTitle>
            <DialogDescription className="text-[#999] text-xs mt-1">
              Download your dashboard as a PDF report or PBIX file
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="p-6 space-y-4">
          {/* Export Options */}
          <ExportButton
            icon={FileText}
            title="Export as PDF"
            description="High-quality PDF report with dashboard title page, all charts, KPIs, and data table. Optimized for landscape A4 printing."
            format="PDF"
            onExport={handleExportPDF}
            isExporting={exportingFormat === "PDF"}
          />

          <ExportButton
            icon={FileSpreadsheet}
            title="Export as PBIX"
            description="Power BI-compatible package containing your data (CSV), dashboard configuration, data model schema, and visual settings."
            format="PBIX"
            onExport={handleExportPBIX}
            isExporting={exportingFormat === "PBIX"}
          />

          {/* Success indicators */}
          <AnimatePresence>
            {exportSuccess && (
              <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{exportSuccess} exported successfully!</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Info note */}
          <div className="rounded-lg bg-muted/50 p-3 text-[11px] text-muted-foreground leading-relaxed">
            <strong>PDF</strong> captures the dashboard as a visual report. <strong>PBIX</strong> exports the data and configuration in a structured format compatible with Power BI workflows.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
