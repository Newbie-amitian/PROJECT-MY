"use client";

import React from "react";
import {
  Upload,
  Sparkles,
  TableProperties,
  LayoutDashboard,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDashboardStore } from "@/lib/dashboard-store";
import type { WorkflowPhase } from "@/lib/dashboard-types";
import { motion } from "framer-motion";

const STEPS: { key: WorkflowPhase; label: string; icon: React.ElementType }[] = [
  { key: "upload", label: "Upload", icon: Upload },
  { key: "cleaning", label: "Cleaning", icon: Sparkles },
  { key: "pivot", label: "Pivot Tables", icon: TableProperties },
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
];

const PHASE_ORDER: WorkflowPhase[] = ["upload", "cleaning", "pivot", "dashboard"];

export function WorkflowStepper() {
  const { workflowPhase, setWorkflowPhase, rawData } = useDashboardStore();
  const currentIndex = PHASE_ORDER.indexOf(workflowPhase);

  return (
    <div className="w-full bg-white border-b py-3 px-4">
      <div className="max-w-3xl mx-auto flex items-center justify-between gap-2">
        {STEPS.map((step, index) => {
          const isActive = workflowPhase === step.key;
          const isCompleted = currentIndex > index;
          const isAccessible = index <= currentIndex || (index === currentIndex + 1);

          const Icon = step.icon;

          return (
            <React.Fragment key={step.key}>
              <button
                onClick={() => {
                  if (step.key === "upload") {
                    // Allow going back to upload to upload a new dataset
                    setWorkflowPhase("upload");
                  } else if (isAccessible) {
                    setWorkflowPhase(step.key);
                  }
                }}
                disabled={!isAccessible && step.key !== "upload"}
                className={cn(
                  "flex flex-col items-center gap-1.5 transition-all min-w-[60px]",
                  (isAccessible || step.key === "upload") ? "cursor-pointer" : "cursor-not-allowed opacity-50",
                  isActive && "scale-105"
                )}
              >
                <motion.div
                  className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center transition-all",
                    isActive
                      ? "bg-[#f0c040] text-[#2b2b2b] shadow-md shadow-[#f0c040]/20"
                      : isCompleted
                        ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400"
                        : "bg-muted text-muted-foreground"
                  )}
                  whileHover={isAccessible || step.key === "upload" ? { scale: 1.08 } : {}}
                  whileTap={isAccessible || step.key === "upload" ? { scale: 0.95 } : {}}
                >
                  {isCompleted ? (
                    <Check className="w-5 h-5" />
                  ) : (
                    <Icon className="w-5 h-5" />
                  )}
                </motion.div>
                <span
                  className={cn(
                    "text-[11px] font-medium transition-colors",
                    isActive
                      ? "text-[#f0c040]"
                      : isCompleted
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-muted-foreground"
                  )}
                >
                  {step.label}
                </span>
              </button>

              {index < STEPS.length - 1 && (
                <div className="flex-1 h-px mt-[-16px]">
                  <div
                    className={cn(
                      "h-full transition-colors",
                      currentIndex > index
                        ? "bg-emerald-300 dark:bg-emerald-700"
                        : "bg-border"
                    )}
                  />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
