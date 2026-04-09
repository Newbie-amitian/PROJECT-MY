"use client";

import React, { useMemo, useState, useCallback } from "react";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Database,
  Hash,
  Type,
  Calendar,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table as TableUI,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDashboardStore } from "@/lib/dashboard-store";
import type { ColumnMeta } from "@/lib/dashboard-types";
import { cn } from "@/lib/utils";

type SortDirection = "asc" | "desc" | null;

function TypeBadge({ type }: { type: ColumnMeta["type"] }) {
  const config: Record<
    string,
    { icon: React.ReactNode; className: string; label: string }
  > = {
    number: {
      icon: <Hash className="w-2.5 h-2.5" />,
      className: "bg-sky-100 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400",
      label: "num",
    },
    string: {
      icon: <Type className="w-2.5 h-2.5" />,
      className: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
      label: "str",
    },
    date: {
      icon: <Calendar className="w-2.5 h-2.5" />,
      className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
      label: "date",
    },
    boolean: {
      icon: <Type className="w-2.5 h-2.5" />,
      className: "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
      label: "bool",
    },
    unknown: {
      icon: <Type className="w-2.5 h-2.5" />,
      className: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",
      label: "?",
    },
  };

  const cfg = config[type] ?? config.unknown;

  return (
    <Badge
      variant="secondary"
      className={cn("text-[9px] font-mono px-1.5 py-0 gap-0.5 h-4", cfg.className)}
    >
      {cfg.icon}
      {cfg.label}
    </Badge>
  );
}

export function DataTable() {
  const { filteredData, columns, config } = useDashboardStore();
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>(null);
  const style = config?.style;

  const headers = useMemo(() => {
    if (columns.length > 0) return columns.map((c) => c.name);
    if (filteredData.length > 0) return Object.keys(filteredData[0]);
    return [];
  }, [columns, filteredData]);

  const columnMetaMap = useMemo(() => {
    const map = new Map<string, ColumnMeta>();
    columns.forEach((c) => map.set(c.name, c));
    return map;
  }, [columns]);

  const sortedData = useMemo(() => {
    if (!sortColumn || !sortDir) return filteredData;

    return [...filteredData].sort((a, b) => {
      const aVal = a[sortColumn];
      const bVal = b[sortColumn];

      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return sortDir === "asc" ? -1 : 1;
      if (bVal == null) return sortDir === "asc" ? 1 : -1;

      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }

      const aStr = String(aVal);
      const bStr = String(bVal);
      return sortDir === "asc"
        ? aStr.localeCompare(bStr)
        : bStr.localeCompare(aStr);
    });
  }, [filteredData, sortColumn, sortDir]);

  const handleSort = useCallback(
    (column: string) => {
      if (sortColumn === column) {
        if (sortDir === "asc") setSortDir("desc");
        else if (sortDir === "desc") {
          setSortColumn(null);
          setSortDir(null);
        }
      } else {
        setSortColumn(column);
        setSortDir("asc");
      }
    },
    [sortColumn, sortDir]
  );

  if (filteredData.length === 0) return null;

  return (
    <Card
      style={{
        borderRadius: style?.border_radius,
        boxShadow: style?.card_shadow !== false ? undefined : "none",
      }}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-950/30 flex items-center justify-center">
              <Database className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <CardTitle className="text-base">Data Table</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {filteredData.length} records
              </p>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-1.5">
            {columns.slice(0, 6).map((col) => (
              <TypeBadge key={col.name} type={col.type} />
            ))}
            {columns.length > 6 && (
              <Badge variant="secondary" className="text-[9px] font-mono px-1.5 py-0 h-4">
                +{columns.length - 6}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="max-h-96 overflow-y-auto rounded-lg border">
          <TableUI>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="w-12 text-xs font-medium text-muted-foreground sticky left-0 bg-muted/50 z-10">
                  #
                </TableHead>
                {headers.map((h) => {
                  const meta = columnMetaMap.get(h);
                  const isSorted = sortColumn === h;
                  return (
                    <TableHead
                      key={h}
                      className="text-xs font-medium cursor-pointer select-none hover:bg-muted/80 transition-colors"
                      onClick={() => handleSort(h)}
                    >
                      <div className="flex items-center gap-1.5">
                        <span>{h}</span>
                        {meta && (
                          <span className="hidden lg:inline-flex">
                            <TypeBadge type={meta.type} />
                          </span>
                        )}
                        <span className="ml-auto inline-flex">
                          {isSorted ? (
                            sortDir === "asc" ? (
                              <ArrowUp className="w-3 h-3 text-orange-500" />
                            ) : (
                              <ArrowDown className="w-3 h-3 text-orange-500" />
                            )
                          ) : (
                            <ArrowUpDown className="w-3 h-3 text-muted-foreground/40" />
                          )}
                        </span>
                      </div>
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedData.slice(0, 100).map((row, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs text-muted-foreground font-mono sticky left-0 bg-background z-10">
                    {i + 1}
                  </TableCell>
                  {headers.map((h) => {
                    const val = row[h];
                    const meta = columnMetaMap.get(h);
                    const isNumber = meta?.type === "number";
                    return (
                      <TableCell
                        key={h}
                        className={cn(
                          "text-xs max-w-[180px] truncate",
                          isNumber ? "font-mono tabular-nums text-right" : ""
                        )}
                      >
                        {val == null ? (
                          <span className="text-muted-foreground/40 italic">null</span>
                        ) : isNumber ? (
                          Number(val).toLocaleString("en-US", {
                            maximumFractionDigits: 2,
                          })
                        ) : (
                          String(val)
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </TableUI>
        </div>
        {filteredData.length > 100 && (
          <p className="text-xs text-muted-foreground text-center mt-2">
            Showing 100 of {filteredData.length.toLocaleString()} records
          </p>
        )}
      </CardContent>
    </Card>
  );
}
