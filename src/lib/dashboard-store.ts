// ============================================================
// Dashboard Zustand Store
// ============================================================
import { create } from "zustand";
import type {
  RawDataRow,
  ColumnMeta,
  DashboardConfig,
  ChatMessage,
  StyleConfig,
  LayoutType,
  ChartConfig,
  FilterConfig,
  KPIConfig,
  WorkflowPhase,
  PivotTableConfig,
  CleaningReport,
  CleaningSuggestion,
  CleaningMode,
  TransformationLogEntry,
  CellMetadata,
  UserEditLayer,
  DataViewMode,
  CellFlag,
} from "./dashboard-types";

// ── History Entry (Undo/Redo) ────────────────────

export interface HistoryEntry {
  id: string;
  timestamp: number;
  description: string;
  type: "rule" | "grel" | "manual_edit" | "initial";
  data: RawDataRow[];
  flagMapEntries: [string, CellFlag][]; // serialized flagMap
}

interface DashboardState {
  // Raw data
  rawData: RawDataRow[];
  columns: ColumnMeta[];
  isLoading: boolean;

  // User instructions / info
  userInstructions: string;

  // Workflow
  workflowPhase: WorkflowPhase;

  // Cleaning
  cleaningReport: CleaningReport | null;
  cleanedData: RawDataRow[];

  // Cleaning mode (auto vs manual review)
  cleaningMode: CleaningMode;
  isManualReviewOpen: boolean;
  transformationLog: TransformationLogEntry[];
  columnRenames: Record<string, string>;

  // Data State Engine (3-layer)
  userEditLayer: UserEditLayer;
  dataViewMode: DataViewMode;

  // Pivot tables
  pivotTables: PivotTableConfig[];

  // Dashboard config
  config: DashboardConfig | null;

  // Filtered data (after applying filters)
  filteredData: RawDataRow[];

  // Chat
  chatMessages: ChatMessage[];
  isChatOpen: boolean;
  isAnalyzing: boolean;

  // Settings panels
  isStylePanelOpen: boolean;

  // Chart editing
  selectedChartId: string | null;

  // Actions
  setRawData: (data: RawDataRow[]) => void;
  setColumns: (columns: ColumnMeta[]) => void;
  /** Quiet update: replaces rawData + columns WITHOUT resetting any other state */
  replaceRawDataQuiet: (data: RawDataRow[], columns: ColumnMeta[]) => void;
  setConfig: (config: DashboardConfig) => void;
  setFilteredData: (data: RawDataRow[]) => void;
  setLayout: (layout: LayoutType) => void;
  setStyle: (style: Partial<StyleConfig>) => void;
  updateKPI: (id: string, updates: Partial<KPIConfig>) => void;
  updateChart: (id: string, updates: Partial<ChartConfig>) => void;
  updateFilter: (id: string, updates: Partial<FilterConfig>) => void;
  addChatMessage: (message: ChatMessage) => void;
  setIsChatOpen: (open: boolean) => void;
  setIsAnalyzing: (analyzing: boolean) => void;
  setIsStylePanelOpen: (open: boolean) => void;
  setSelectedChartId: (id: string | null) => void;
  deleteChart: (id: string) => void;
  deleteKPI: (id: string) => void;

  // Workflow actions
  setWorkflowPhase: (phase: WorkflowPhase) => void;
  setUserInstructions: (instructions: string) => void;
  setCleaningReport: (report: CleaningReport | null) => void;
  setCleanedData: (data: RawDataRow[]) => void;
  updateCleaningSuggestion: (id: string, updates: Partial<CleaningSuggestion>) => void;

  // Cleaning mode actions
  setCleaningMode: (mode: CleaningMode) => void;
  setIsManualReviewOpen: (open: boolean) => void;
  addTransformationEntry: (entry: TransformationLogEntry) => void;
  addTransformationEntries: (entries: TransformationLogEntry[]) => void;
  addTransformationLog: (entry: TransformationLogEntry) => void;
  clearTransformationLog: () => void;
  renameColumn: (original: string, newName: string) => void;
  resetColumnRenames: () => void;

  // Data State Engine actions
  setDataViewMode: (mode: DataViewMode) => void;
  setUserCellEdit: (cellKey: string, metadata: CellMetadata) => void;
  setAiCellValue: (cellKey: string, value: unknown) => void;
  clearUserEditLayer: () => void;
  getMergedDataset: () => RawDataRow[];

  // Pivot actions
  addPivotTable: (pivot: PivotTableConfig) => void;
  removePivotTable: (id: string) => void;

  // History (Undo/Redo)
  historyStack: HistoryEntry[];
  historyIndex: number;
  pushToHistory: (description: string, type: "rule" | "grel" | "manual_edit" | "initial") => void;
  undo: () => { data: RawDataRow[]; flagMap: Map<string, CellFlag> } | null;
  redo: () => { data: RawDataRow[]; flagMap: Map<string, CellFlag> } | null;
  goToHistory: (index: number) => { data: RawDataRow[]; flagMap: Map<string, CellFlag> } | null;
  clearHistory: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Reset
  resetDashboard: () => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  rawData: [],
  columns: [],
  isLoading: false,
  userInstructions: "",
  workflowPhase: "upload",
  cleaningReport: null,
  cleanedData: [],
  cleaningMode: "auto",
  isManualReviewOpen: false,
  transformationLog: [],
  columnRenames: {},
  userEditLayer: {},
  dataViewMode: "merged" as DataViewMode,
  pivotTables: [],
  config: null,
  filteredData: [],
  chatMessages: [],
  isChatOpen: false,
  isAnalyzing: false,
  isStylePanelOpen: false,
  selectedChartId: null,

  setRawData: (data) => set({
    rawData: data,
    filteredData: data,
    config: null,
    cleaningReport: null,
    cleanedData: [],
    cleaningMode: "auto",
    isManualReviewOpen: false,
    transformationLog: [],
    columnRenames: {},
    userEditLayer: {},
    dataViewMode: "merged" as DataViewMode,
    pivotTables: [],
    chatMessages: [],
    workflowPhase: "upload",
    isChatOpen: false,
    isAnalyzing: false,
    isStylePanelOpen: false,
    selectedChartId: null,
  }),
  replaceRawDataQuiet: (data, columns) => set({
    rawData: data,
    filteredData: data,
    columns,
  }),
  setColumns: (columns) => set({ columns }),
  setConfig: (config) => set({ config, filteredData: [] }),
  setFilteredData: (data) => set({ filteredData: data }),
  setLayout: (layout) =>
    set((state) => ({
      config: state.config ? { ...state.config, layout } : null,
    })),
  setStyle: (style) =>
    set((state) => ({
      config: state.config
        ? { ...state.config, style: { ...state.config.style, ...style } }
        : null,
    })),
  updateKPI: (id, updates) =>
    set((state) => ({
      config: state.config
        ? {
            ...state.config,
            kpis: state.config.kpis.map((k) =>
              k.id === id ? { ...k, ...updates } : k
            ),
          }
        : null,
    })),
  updateChart: (id, updates) =>
    set((state) => ({
      config: state.config
        ? {
            ...state.config,
            charts: state.config.charts.map((c) =>
              c.id === id ? { ...c, ...updates } : c
            ),
          }
        : null,
    })),
  updateFilter: (id, updates) =>
    set((state) => {
      const newConfig = state.config
        ? {
            ...state.config,
            filters: state.config.filters.map((f) =>
              f.id === id ? { ...f, ...updates } : f
            ),
          }
        : null;
      return { config: newConfig };
    }),
  addChatMessage: (message) =>
    set((state) => ({
      chatMessages: [...state.chatMessages, message],
    })),
  setIsChatOpen: (open) => set({ isChatOpen: open }),
  setIsAnalyzing: (analyzing) => set({ isAnalyzing: analyzing }),
  setIsStylePanelOpen: (open) => set({ isStylePanelOpen: open }),
  setSelectedChartId: (id) => set({ selectedChartId: id }),
  deleteChart: (id) =>
    set((state) => ({
      config: state.config
        ? {
            ...state.config,
            charts: state.config.charts.filter((c) => c.id !== id),
          }
        : null,
      selectedChartId: state.selectedChartId === id ? null : state.selectedChartId,
    })),
  deleteKPI: (id) =>
    set((state) => ({
      config: state.config
        ? {
            ...state.config,
            kpis: state.config.kpis.filter((k) => k.id !== id),
          }
        : null,
    })),

  // Workflow actions
  setWorkflowPhase: (phase) => set({ workflowPhase: phase }),
  setUserInstructions: (instructions) => set({ userInstructions: instructions }),
  setCleaningReport: (report) => set({ cleaningReport: report }),
  setCleanedData: (data) => set({ cleanedData: data }),
  updateCleaningSuggestion: (id, updates) =>
    set((state) => {
      if (!state.cleaningReport) return {};
      return {
        cleaningReport: {
          ...state.cleaningReport,
          suggestions: state.cleaningReport.suggestions.map((s) =>
            s.id === id ? { ...s, ...updates } : s
          ),
        },
      };
    }),

  // Cleaning mode actions
  setCleaningMode: (mode) => set({ cleaningMode: mode }),
  setIsManualReviewOpen: (open) => set({ isManualReviewOpen: open }),
  addTransformationEntry: (entry) =>
    set((state) => ({
      transformationLog: [...state.transformationLog, entry],
    })),
  addTransformationEntries: (entries) =>
    set((state) => ({
      transformationLog: [...state.transformationLog, ...entries],
    })),
  addTransformationLog: (entry) =>
    set((state) => ({
      transformationLog: [...state.transformationLog, entry],
    })),
  clearTransformationLog: () => set({ transformationLog: [] }),
  renameColumn: (original, newName) =>
    set((state) => ({
      columnRenames: { ...state.columnRenames, [original]: newName },
    })),
  resetColumnRenames: () => set({ columnRenames: {} }),

  // Data State Engine actions
  setDataViewMode: (mode) => set({ dataViewMode: mode }),
  setUserCellEdit: (cellKey, metadata) =>
    set((state) => ({
      userEditLayer: { ...state.userEditLayer, [cellKey]: metadata },
    })),
  setAiCellValue: (cellKey, value) =>
    set((state) => {
      const existing = state.userEditLayer[cellKey];
      if (existing && existing.source === "USER") return {};
      const updated: CellMetadata = existing
        ? { ...existing, aiValue: value, lastModifiedBy: "AI", source: "AI", hasConflict: existing.userValue !== null && existing.userValue !== value }
        : { source: "AI", lastModifiedBy: "AI", timestamp: Date.now(), originalRawValue: null, aiValue: value, userValue: null, hasConflict: false, conflictResolvedBy: null };
      return { userEditLayer: { ...state.userEditLayer, [cellKey]: updated } };
    }),
  clearUserEditLayer: () => set({ userEditLayer: {} }),
  getMergedDataset: () => {
    const state = useDashboardStore.getState();
    const base = state.cleanedData.length > 0 ? state.cleanedData : state.rawData;
    if (Object.keys(state.userEditLayer).length === 0) return base;
    return base.map((row, rowIdx) => {
      const newRow = { ...row };
      Object.keys(row).forEach((col) => {
        const cellKey = `${rowIdx}-${col}`;
        const meta = state.userEditLayer[cellKey];
        if (meta) {
          newRow[col] = meta.userValue !== null ? meta.userValue : (meta.aiValue !== null ? meta.aiValue : row[col]);
        }
      });
      return newRow;
    });
  },

  // Pivot actions
  addPivotTable: (pivot) =>
    set((state) => ({
      pivotTables: [...state.pivotTables, pivot],
    })),
  removePivotTable: (id) =>
    set((state) => ({
      pivotTables: state.pivotTables.filter((p) => p.id !== id),
    })),

  // History (Undo/Redo)
  historyStack: [],
  historyIndex: -1,
  pushToHistory: (description, type) =>
    set((state) => {
      const truncated = state.historyStack.slice(0, state.historyIndex + 1);
      const entry: HistoryEntry = {
        id: `hist-${Date.now()}-${truncated.length}`,
        timestamp: Date.now(),
        description,
        type,
        data: state.cleanedData,
        flagMapEntries: [],
      };
      const stack = [...truncated, entry].slice(-50);
      return { historyStack: stack, historyIndex: stack.length - 1 };
    }),
  undo: () => {
    const state = useDashboardStore.getState();
    if (state.historyIndex <= 0) return null;
    const entry = state.historyStack[state.historyIndex - 1];
    return { data: entry.data, flagMap: new Map(entry.flagMapEntries) };
  },
  redo: () => {
    const state = useDashboardStore.getState();
    if (state.historyIndex >= state.historyStack.length - 1) return null;
    const entry = state.historyStack[state.historyIndex + 1];
    return { data: entry.data, flagMap: new Map(entry.flagMapEntries) };
  },
  goToHistory: (index) => {
    const state = useDashboardStore.getState();
    if (index < 0 || index >= state.historyStack.length) return null;
    const entry = state.historyStack[index];
    return { data: entry.data, flagMap: new Map(entry.flagMapEntries) };
  },
  clearHistory: () => set({ historyStack: [], historyIndex: -1 }),
  canUndo: () => useDashboardStore.getState().historyIndex > 0,
  canRedo: () => useDashboardStore.getState().historyIndex < useDashboardStore.getState().historyStack.length - 1,

  // Reset everything
  resetDashboard: () =>
    set({
      rawData: [],
      columns: [],
      config: null,
      filteredData: [],
      chatMessages: [],
      isChatOpen: false,
      isAnalyzing: false,
      isStylePanelOpen: false,
      selectedChartId: null,
      userInstructions: "",
      workflowPhase: "upload",
      cleaningReport: null,
      cleanedData: [],
      cleaningMode: "auto",
      isManualReviewOpen: false,
      transformationLog: [],
      columnRenames: {},
      userEditLayer: {},
      dataViewMode: "merged" as DataViewMode,
      pivotTables: [],
      historyStack: [],
      historyIndex: -1,
    }),
}));
