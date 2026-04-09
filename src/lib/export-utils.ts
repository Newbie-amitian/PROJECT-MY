// ============================================================
// Export Utilities - PDF and PBIX
// ============================================================

import type { DashboardConfig, RawDataRow } from "./dashboard-types";
import { sanitizeDatasetForExport } from "./emoji-sanitizer";

/**
 * Export dashboard as PDF using html2canvas + jsPDF
 */
export async function exportAsPDF(
  dashboardTitle: string,
  canvasId: string = "dashboard-canvas"
): Promise<void> {
  const html2canvas = (await import("html2canvas-pro")).default;
  const { jsPDF } = await import("jspdf");

  const element = document.getElementById(canvasId);
  if (!element) {
    throw new Error("Dashboard canvas element not found");
  }

  // Show a brief "capturing" state
  const originalOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";

  try {
    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: "#f5f5f5",
      windowWidth: element.scrollWidth,
      windowHeight: element.scrollHeight,
    });

    const imgData = canvas.toDataURL("image/png");
    const imgWidth = canvas.width;
    const imgHeight = canvas.height;

    // Use landscape orientation for dashboards
    const pdfWidth = 297; // A4 landscape width in mm
    const pdfHeight = 210; // A4 landscape height in mm
    const margin = 10;

    const contentWidth = pdfWidth - margin * 2;
    const contentHeight = pdfHeight - margin * 2;

    const ratio = contentWidth / imgWidth;
    const scaledHeight = imgHeight * ratio;

    const pdf = new jsPDF({
      orientation: scaledHeight > contentHeight ? "portrait" : "landscape",
      unit: "mm",
      format: "a4",
    });

    // Title page
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    pdf.setFillColor(43, 43, 43); // #2b2b2b
    pdf.rect(0, 0, pageWidth, 60, "F");

    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(24);
    pdf.text(dashboardTitle || "Data Dashboard", margin + 5, 30);

    pdf.setFontSize(10);
    pdf.setTextColor(180, 180, 180);
    pdf.text(`Generated on ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}`, margin + 5, 45);
    pdf.text("Powered by AI Data Dashboard", margin + 5, 52);

    pdf.addPage();

    // Dashboard content - handle multi-page
    const usableWidth = pageWidth - margin * 2;
    const usableHeight = pageHeight - margin * 2;
    const imgRatio = usableWidth / imgWidth;
    const totalImgHeight = imgHeight * imgRatio;

    if (totalImgHeight <= usableHeight) {
      // Fits on one page
      pdf.addImage(imgData, "PNG", margin, margin, usableWidth, totalImgHeight);
    } else {
      // Multi-page
      let remainingHeight = totalImgHeight;
      let currentPosition = 0;

      while (remainingHeight > 0) {
        const pageImgHeight = Math.min(remainingHeight, usableHeight);

        pdf.addImage(
          imgData,
          "PNG",
          margin,
          margin - currentPosition,
          usableWidth,
          totalImgHeight
        );

        remainingHeight -= usableHeight;
        currentPosition += usableHeight;

        if (remainingHeight > 0) {
          pdf.addPage();
        }
      }
    }

    // Footer on last page
    const lastPageHeight = pdf.internal.pageSize.getHeight();
    pdf.setFontSize(8);
    pdf.setTextColor(150, 150, 150);
    pdf.text(`${dashboardTitle} — AI Data Dashboard`, pageWidth / 2, lastPageHeight - 5, { align: "center" });

    pdf.save(`${(dashboardTitle || "dashboard").replace(/\s+/g, "_")}.pdf`);
  } finally {
    document.body.style.overflow = originalOverflow;
  }
}

/**
 * Export dashboard as PBIX (Power BI) compatible package
 * Creates a .pbix file which is a ZIP containing data + dashboard config
 */
export async function exportAsPBIX(
  dashboardConfig: DashboardConfig,
  rawData: RawDataRow[],
  cleanedData: RawDataRow[]
): Promise<void> {
  const JSZip = (await import("jszip")).default;

  const zip = new JSZip();

  // ---- Content Types ----
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="xml" ContentType="application/xml" />
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Override PartName="/Report/Layout" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml" />
</Types>`
  );

  // ---- Rels ----
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="utf-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="R1" Type="http://schemas.microsoft.com/office/2019/09/relationships/report" Target="/Report" />
  <Relationship Id="R2" Type="http://schemas.microsoft.com/office/2019/09/relationships/datamodel" Target="/DataModelSchema" />
</Relationships>`
  );

  // ---- Metadata ----
  zip.file(
    "Metadata.json",
    JSON.stringify({
      version: "1.0",
      created: new Date().toISOString(),
      creator: "AI Data Dashboard",
      title: dashboardConfig.title,
      description: `Dashboard with ${dashboardConfig.kpis.length} KPIs and ${dashboardConfig.charts.length} charts`,
    }, null, 2)
  );

  // ---- Data (CSV format) ----
  const sourceExportData = cleanedData.length > 0 ? cleanedData : rawData;
  // AI Semantic Emoji Sanitization: convert emojis → text BEFORE embedding in PBIX
  const { sanitizedData: exportData } = sanitizeDatasetForExport(sourceExportData, { mode: "semantic" });
  const headers = Object.keys(exportData[0] || {});

  const csvContent = [
    headers.join(","),
    ...exportData.map((row) =>
      headers.map((h) => {
        const val = row[h];
        if (val == null) return "";
        const str = String(val);
        return str.includes(",") || str.includes('"') || str.includes("\n")
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      }).join(",")
    ),
  ].join("\n");

  zip.file("Data/data.csv", csvContent);

  // ---- Dashboard Config (Report.json) ----
  const reportConfig = {
    version: "1.0",
    dataSource: "data.csv",
    dashboard: {
      title: dashboardConfig.title,
      layout: dashboardConfig.layout,
      style: dashboardConfig.style,
      kpis: dashboardConfig.kpis.map((kpi) => ({
        id: kpi.id,
        title: kpi.title,
        column: kpi.column,
        aggregation: kpi.aggregation,
        format: kpi.format,
      })),
      charts: dashboardConfig.charts.map((chart) => ({
        id: chart.id,
        type: chart.type,
        title: chart.title,
        x: chart.x,
        y: chart.y,
        config: chart.config,
      })),
      filters: dashboardConfig.filters.map((filter) => ({
        column: filter.column,
        label: filter.label,
        type: filter.type,
        options: filter.options,
      })),
    },
    interactions: dashboardConfig.interactions,
    exportDate: new Date().toISOString(),
  };

  zip.file("Report/Report.json", JSON.stringify(reportConfig, null, 2));

  // ---- Data Model Schema (simplified Tabular Object Model) ----
  const numericColumns = headers.filter((h) => {
    const val = exportData[0]?.[h];
    return typeof val === "number";
  });

  zip.file(
    "DataModelSchema",
    JSON.stringify({
      name: "Model",
      compatibilityLevel: 1550,
      tables: [
        {
          name: "Data",
          columns: headers.map((h) => ({
            name: h,
            dataType: numericColumns.includes(h) ? "int64" : "string",
            sourceColumn: h,
          })),
          partitions: [
            {
              name: "Data",
              source: {
                type: "m",
                expression: `let\n    Source = Csv.Document([Content="{data.csv}"]){[Name="data.csv"]}[Content]),\n    #"Promoted Headers" = Table.PromoteHeaders(Source, [PromoteAllScalars=true])\nin\n    #"Promoted Headers"`,
              },
            },
          ],
        },
      ],
    }, null, 2)
  );

  // ---- Settings ----
  zip.file(
    "Settings",
    JSON.stringify({
      theme: dashboardConfig.style.colors,
      layout: dashboardConfig.layout,
      fontFamily: dashboardConfig.style.font_family,
      borderRadius: dashboardConfig.style.border_radius,
    }, null, 2)
  );

  // ---- Report Layout placeholder ----
  zip.file(
    "Report/Layout",
    `<?xml version="1.0" encoding="utf-8"?>
<Section Name="Section1" Width="1280" Height="720" xmlns="http://schemas.microsoft.com/office/2019/09/reportdefinition">
  <Tablix Name="DashboardTablix">
    <TablixBody>
      <TablixRows>
        <TablixRow>
          <Height>0.5in</Height>
          <TablixCells>
            <TablixCell>
              <TextRuns>
                <TextRun Value="${dashboardConfig.title}" />
              </TextRuns>
            </TablixCell>
          </TablixCells>
        </TablixRow>
      </TablixRows>
    </TablixBody>
  </Tablix>
</Section>`
  );

  // ---- README for context ----
  zip.file(
    "README.txt",
    `AI Data Dashboard Export
========================

Title: ${dashboardConfig.title}
Exported: ${new Date().toLocaleString()}
Layout: ${dashboardConfig.layout}

Contents:
- Data/data.csv: Your dataset (cleaned if cleaning was applied)
- Report/Report.json: Dashboard configuration (KPIs, charts, filters)
- DataModelSchema: Tabular data model schema
- Settings: Visual settings and theme
- Metadata.json: Export metadata

This file was generated by AI Data Dashboard.
The Report.json contains the full dashboard configuration that can be
used to recreate the dashboard in other tools.

Data Summary:
- Rows: ${exportData.length}
- Columns: ${headers.length}
- KPIs: ${dashboardConfig.kpis.length}
- Charts: ${dashboardConfig.charts.length}
- Filters: ${dashboardConfig.filters.length}
`
  );

  // Generate and download
  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${(dashboardConfig.title || "dashboard").replace(/\s+/g, "_")}.pbix`;
  link.click();
  URL.revokeObjectURL(link.href);
}
