// ============================================================
// Memory Engine v3 — Self-Learning Data Quality System
// ============================================================
// Layer 3 of the cleaning pipeline: persistent memory across sessions.
//
// Storage: localStorage (client-side, survives page refresh)
// 
// Five subsystems:
//   1. Mapping Memory — learned canonical dictionaries per column
//   2. Rule Memory — accumulated rule patterns + confidence scores
//   3. User Correction Memory — learns from manual user edits
//   4. Promotion System — OBSERVED → CONFIRMED → ACTIVE lifecycle
//   5. Drift Detection — NEW_VARIANT discovery + protection
//
// Architecture:
//   🧱 Layer 1: Raw Engine (cleaning-engine.ts) — deterministic rules
//   🧠 Layer 2: Learning Engine (cleaning-engine.ts) — pattern mining
//   💾 Layer 3: Memory Engine (this file) — persistence + reuse + drift + promotion

// ── Promotion State ──────────────────────────────────

export type PromotionState = "OBSERVED" | "CONFIRMED" | "ACTIVE";

/** Thresholds for promotion lifecycle */
const PROMOTION_THRESHOLDS = {
  /** OBSERVED → CONFIRMED: seen in 2+ batches OR 3+ engine confirms OR any user confirm */
  observedToConfirmed: {
    minBatches: 2,
    minEngineConfirms: 3,
    anyUserConfirm: true,
  },
  /** CONFIRMED → ACTIVE: stable across 3+ batches AND 5+ confirms AND confidence ≥ 0.85 */
  confirmedToActive: {
    minBatches: 3,
    minTotalConfirms: 5,
    minConfidence: 0.85,
  },
} as const;

// ── Drift Types ──────────────────────────────────────

export type DriftSeverity = "low" | "medium" | "high";

export interface DriftAlert {
  /** Unique alert ID */
  id: string;
  /** Column where drift was detected */
  column: string;
  /** The new/unknown value that triggered drift */
  newValue: string;
  /** Frequency of the new value in current batch */
  frequency: number;
  /** How similar is the new value to existing known values (0–1) */
  similarityScore: number;
  /** Most similar existing canonical value (if any) */
  similarTo: string | null;
  /** Drift severity */
  severity: DriftSeverity;
  /** Timestamp when drift was detected */
  detectedAt: number;
  /** Whether user has acknowledged this alert */
  acknowledged: boolean;
  /** User's decision: null=pending, "accept"=add to mapping, "reject"=ignore, "replace"=overwrite canonical */
  resolution: "accept" | "reject" | "replace" | null;
  /** Batch ID when detected */
  batchId: string;
}

// ── Core Types ───────────────────────────────────────

export interface CanonicalMapping {
  /** The canonical/anchor form (e.g. "Present") */
  anchor: string;
  /** All known variants that map to this anchor (lowercase) */
  variants: Set<string>;
  /** How many times this mapping has been confirmed by the engine */
  engineConfirms: number;
  /** How many times a user manually applied/kept this mapping */
  userConfirms: number;
  /** How many times a user rejected/reversed this mapping */
  userRejects: number;
  /** First seen timestamp */
  firstSeen: number;
  /** Last used timestamp */
  lastUsed: number;
  /** Column names where this mapping was observed */
  observedInColumns: string[];
  /** Current promotion state */
  promotionState: PromotionState;
  /** Set of batch IDs where this mapping was seen/confirmed */
  batchHistory: string[];
  /** Computed confidence score (0–1) */
  confidence: number;
  /** Whether this mapping is protected (ACTIVE state prevents overwriting) */
  readonly protected: boolean;
}

export interface ColumnMappingMemory {
  /** Column name (lowercase) */
  columnKey: string;
  /** Map of variant (lowercase) → canonical form */
  variantToCanonical: Record<string, string>;
  /** Map of canonical form → CanonicalMapping entry */
  canonicalEntries: Record<string, CanonicalMapping>;
  /** Total number of values processed for this column */
  totalProcessed: number;
  /** Last updated timestamp */
  lastUpdated: number;
}

export interface RuleMemoryEntry {
  /** Unique rule fingerprint */
  id: string;
  /** Rule method (e.g. "numeric_normalize", "trim_titlecase") */
  method: string;
  /** Rule section */
  section: string;
  /** Column name pattern (lowercase, for matching similar columns) */
  columnPattern: string;
  /** Detected column type */
  columnType: string;
  /** How many times this rule was applied and kept */
  successCount: number;
  /** How many times this rule was applied then undone */
  failureCount: number;
  /** Computed confidence from success/failure ratio */
  confidence: number;
  /** First seen timestamp */
  firstSeen: number;
  /** Last used timestamp */
  lastUsed: number;
  /** Number of distinct datasets this was used in */
  datasetCount: number;
  /** Current promotion state */
  promotionState: PromotionState;
  /** Set of batch IDs where this rule was applied */
  batchHistory: string[];
}

export interface UserCorrection {
  /** Column name */
  column: string;
  /** Original value (lowercase) */
  fromValue: string;
  /** Corrected value */
  toValue: string;
  /** Timestamp */
  timestamp: number;
  /** How many times this correction was seen */
  count: number;
}

export interface MemoryStats {
  totalMappingsLearned: number;
  totalColumnsMapped: number;
  totalRulesLearned: number;
  totalUserCorrections: number;
  totalDatasetsProcessed: number;
  memoryAgeDays: number;
  /** New in v3: promotion breakdown */
  observedMappings: number;
  confirmedMappings: number;
  activeMappings: number;
  /** New in v3: drift stats */
  activeDriftAlerts: number;
  resolvedDriftAlerts: number;
  totalDriftDetected: number;
}

export interface PromotionSummary {
  state: PromotionState;
  count: number;
  labels: { variant: string; canonical: string; confidence: number }[];
}

// ── Storage Keys ─────────────────────────────────────

const STORAGE_KEYS = {
  mappings: "dq-memory-mappings",
  rules: "dq-memory-rules",
  corrections: "dq-memory-corrections",
  stats: "dq-memory-stats",
  datasetsProcessed: "dq-memory-datasets-processed",
  driftAlerts: "dq-memory-drift-alerts",
} as const;

// ── Safe localStorage wrapper ───────────────────────

function safeGetItem<T>(key: string, fallback: T): T {
  try {
    if (typeof window === "undefined") return fallback;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function safeSetItem(key: string, value: unknown): void {
  try {
    if (typeof window === "undefined") return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    console.warn("[Memory Engine] localStorage full, cannot persist");
  }
}

// ── Utility: simple hash for IDs ─────────────────────

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

// ── Memory Engine Singleton ──────────────────────────

class MemoryEngine {
  // In-memory cache (loaded from localStorage on first access)
  private mappingsCache: Map<string, ColumnMappingMemory> | null = null;
  private rulesCache: Map<string, RuleMemoryEntry> | null = null;
  private correctionsCache: UserCorrection[] | null = null;
  private statsCache: MemoryStats | null = null;
  private datasetIdsProcessed: Set<string> | null = null;
  private driftAlertsCache: DriftAlert[] | null = null;
  private currentBatchId: string | null = null;

  // ── INITIALIZATION ─────────────────────────────────

  /** Load all memory from localStorage (lazy, called once) */
  private load(): void {
    if (this.mappingsCache !== null) return;

    // Load mappings
    const mappingsRaw: Record<string, unknown> = safeGetItem(STORAGE_KEYS.mappings, {});
    this.mappingsCache = new Map();
    for (const [key, val] of Object.entries(mappingsRaw)) {
      const entry = val as ColumnMappingMemory;
      // Reconstruct Sets from JSON (which serializes as arrays)
      for (const [canonKey, canonVal] of Object.entries(entry.canonicalEntries)) {
        const canon = canonVal as CanonicalMapping;
        const rawCanon = (val as Record<string, Record<string, unknown>>).canonicalEntries?.[canonKey];
        canon.variants = new Set(rawCanon?.variants ? (rawCanon.variants as string[]) : []);
        canon.batchHistory = rawCanon?.batchHistory ? (rawCanon.batchHistory as string[]) : [];
        // Backfill missing fields from older versions
        if (!canon.promotionState) canon.promotionState = "OBSERVED";
        if (!canon.batchHistory) canon.batchHistory = [];
        if (canon.confidence === undefined) {
          canon.confidence = canon.engineConfirms + canon.userConfirms > 0
            ? (canon.engineConfirms + canon.userConfirms * 2) / (canon.engineConfirms + canon.userConfirms + canon.userRejects)
            : 0;
        }
      }
      this.mappingsCache.set(key, entry);
    }

    // Load rules
    const rulesRaw: Record<string, unknown> = safeGetItem(STORAGE_KEYS.rules, {});
    this.rulesCache = new Map();
    for (const [id, val] of Object.entries(rulesRaw)) {
      const entry = val as RuleMemoryEntry;
      // Backfill missing fields
      if (!entry.promotionState) entry.promotionState = "OBSERVED";
      if (!entry.batchHistory) entry.batchHistory = [];
      this.rulesCache.set(id, entry);
    }

    // Load corrections
    this.correctionsCache = safeGetItem<UserCorrection[]>(STORAGE_KEYS.corrections, []);

    // Load stats
    const loadedStats = safeGetItem<Partial<MemoryStats>>(STORAGE_KEYS.stats, {});
    this.statsCache = {
      totalMappingsLearned: loadedStats.totalMappingsLearned ?? 0,
      totalColumnsMapped: loadedStats.totalColumnsMapped ?? 0,
      totalRulesLearned: loadedStats.totalRulesLearned ?? 0,
      totalUserCorrections: loadedStats.totalUserCorrections ?? 0,
      totalDatasetsProcessed: loadedStats.totalDatasetsProcessed ?? 0,
      memoryAgeDays: loadedStats.memoryAgeDays ?? 0,
      observedMappings: loadedStats.observedMappings ?? 0,
      confirmedMappings: loadedStats.confirmedMappings ?? 0,
      activeMappings: loadedStats.activeMappings ?? 0,
      activeDriftAlerts: loadedStats.activeDriftAlerts ?? 0,
      resolvedDriftAlerts: loadedStats.resolvedDriftAlerts ?? 0,
      totalDriftDetected: loadedStats.totalDriftDetected ?? 0,
    };

    // Load processed dataset IDs
    const processedRaw: string[] = safeGetItem(STORAGE_KEYS.datasetsProcessed, []);
    this.datasetIdsProcessed = new Set(processedRaw);

    // Load drift alerts
    this.driftAlertsCache = safeGetItem<DriftAlert[]>(STORAGE_KEYS.driftAlerts, []);
  }

  /** Persist current cache to localStorage */
  private persist(): void {
    // Serialize mappings (convert Sets to arrays for JSON)
    const mappingsObj: Record<string, unknown> = {};
    if (this.mappingsCache) {
      for (const [key, entry] of this.mappingsCache) {
        const serialized = {
          ...entry,
          canonicalEntries: {} as Record<string, unknown>,
        };
        for (const [canon, canonEntry] of Object.entries(entry.canonicalEntries)) {
          serialized.canonicalEntries[canon] = {
            ...canonEntry,
            variants: [...canonEntry.variants],
            batchHistory: canonEntry.batchHistory,
            // Don't serialize the readonly 'protected' getter
          };
        }
        mappingsObj[key] = serialized;
      }
    }
    safeSetItem(STORAGE_KEYS.mappings, mappingsObj);

    // Serialize rules
    const rulesObj: Record<string, unknown> = {};
    if (this.rulesCache) {
      for (const [id, entry] of this.rulesCache) {
        rulesObj[id] = entry;
      }
    }
    safeSetItem(STORAGE_KEYS.rules, rulesObj);

    // Serialize corrections
    safeSetItem(STORAGE_KEYS.corrections, this.correctionsCache);

    // Serialize stats
    safeSetItem(STORAGE_KEYS.stats, this.statsCache);

    // Serialize processed datasets
    safeSetItem(STORAGE_KEYS.datasetsProcessed, [...(this.datasetIdsProcessed ?? [])]);

    // Serialize drift alerts
    safeSetItem(STORAGE_KEYS.driftAlerts, this.driftAlertsCache);
  }

  // ── BATCH TRACKING ─────────────────────────────────

  /**
   * Start a new batch. All subsequent operations are tagged with this batch ID.
   * Call this at the beginning of each dataset cleaning session.
   */
  startBatch(batchId?: string): string {
    this.load();
    const id = batchId ?? `batch-${Date.now()}-${simpleHash(String(Math.random()))}`;
    this.currentBatchId = id;
    return id;
  }

  /** Get the current batch ID */
  getCurrentBatchId(): string | null {
    return this.currentBatchId;
  }

  // ── MAPPING MEMORY ─────────────────────────────────

  /**
   * Get a learned mapping for a column.
   * Returns the variant→canonical map if the column has been seen before.
   */
  getLearnedMappings(columnName: string): Record<string, string> {
    this.load();
    const key = columnName.toLowerCase();
    const entry = this.mappingsCache?.get(key);
    if (!entry) return {};
    entry.lastUsed = Date.now();
    this.persist();
    return { ...entry.variantToCanonical };
  }

  /**
   * Get ACTIVE-only mappings for a column.
   * These are high-confidence mappings that won't be overwritten by new observations.
   */
  getActiveMappings(columnName: string): Record<string, string> {
    this.load();
    const key = columnName.toLowerCase();
    const entry = this.mappingsCache?.get(key);
    if (!entry) return {};

    const activeMap: Record<string, string> = {};
    for (const [variant, canonical] of Object.entries(entry.variantToCanonical)) {
      const canonKey = canonical.toLowerCase();
      const canonEntry = entry.canonicalEntries[canonKey];
      if (canonEntry && canonEntry.promotionState === "ACTIVE") {
        activeMap[variant] = canonical;
      }
    }
    return activeMap;
  }

  /**
   * Get all canonical entries for a column (for UI display).
   */
  getCanonicalEntries(columnName: string): CanonicalMapping[] {
    this.load();
    const key = columnName.toLowerCase();
    const entry = this.mappingsCache?.get(key);
    if (!entry) return [];
    return Object.values(entry.canonicalEntries);
  }

  /**
   * Store learned mappings from the cleaning engine's category clustering.
   * Called after the engine discovers canonical forms.
   * 
   * v3 enhancement: Now respects ACTIVE protection and tracks batch history.
   */
  storeLearnedMappings(
    columnName: string,
    discoveredMap: Record<string, string>
  ): { newCount: number; skipped: number; protected: number; driftDetected: number } {
    this.load();
    const key = columnName.toLowerCase();
    let entry = this.mappingsCache?.get(key);

    if (!entry) {
      entry = {
        columnKey: key,
        variantToCanonical: {},
        canonicalEntries: {},
        totalProcessed: 0,
        lastUpdated: Date.now(),
      };
      this.mappingsCache?.set(key, entry);
    }

    let newMappingsCount = 0;
    let skippedCount = 0;
    let protectedCount = 0;

    for (const [variant, canonical] of Object.entries(discoveredMap)) {
      const variantKey = variant.toLowerCase().trim();

      // Skip if this exact mapping already exists
      if (entry.variantToCanonical[variantKey] === canonical) {
        // Still increment engine confirms
        const canonKey = canonical.toLowerCase();
        const canonEntry = entry.canonicalEntries[canonKey];
        if (canonEntry) {
          canonEntry.engineConfirms++;
          this.recordBatchForMapping(canonEntry);
        }
        continue;
      }

      // ── DRIFT PROTECTION: Check if existing mapping is ACTIVE ──
      const existingCanonical = entry.variantToCanonical[variantKey];
      if (existingCanonical) {
        const existingCanonKey = existingCanonical.toLowerCase();
        const existingCanon = entry.canonicalEntries[existingCanonKey];
        if (existingCanon && existingCanon.promotionState === "ACTIVE") {
          // PROTECTED — do NOT overwrite ACTIVE mappings with new observations
          protectedCount++;
          continue;
        }
        // Not ACTIVE — allow overwrite (OBSERVED or CONFIRMED can be superseded)
      }

      const isNew = !entry.variantToCanonical[variantKey];
      entry.variantToCanonical[variantKey] = canonical;

      // Update canonical entry
      const canonKey = canonical.toLowerCase();
      if (!entry.canonicalEntries[canonKey]) {
        entry.canonicalEntries[canonKey] = {
          anchor: canonical,
          variants: new Set(),
          engineConfirms: 0,
          userConfirms: 0,
          userRejects: 0,
          firstSeen: Date.now(),
          lastUsed: Date.now(),
          observedInColumns: [columnName],
          promotionState: "OBSERVED",
          batchHistory: [],
          confidence: 0,
        };
      }
      const canonEntry = entry.canonicalEntries[canonKey];
      canonEntry.variants.add(variantKey);
      canonEntry.engineConfirms++;
      canonEntry.lastUsed = Date.now();
      this.recordBatchForMapping(canonEntry);
      if (!canonEntry.observedInColumns.includes(columnName)) {
        canonEntry.observedInColumns.push(columnName);
      }

      if (isNew) newMappingsCount++;
      else skippedCount++; // Was mapped differently before
    }

    entry.totalProcessed++;
    entry.lastUpdated = Date.now();
    this.statsCache!.totalMappingsLearned += newMappingsCount;
    this.statsCache!.totalColumnsMapped = this.mappingsCache?.size ?? 0;

    // Run promotion after storing
    this.promoteMappingsForColumn(key);

    this.persist();

    return { newCount: newMappingsCount, skipped: skippedCount, protected: protectedCount, driftDetected: 0 };
  }

  /**
   * Check if memory has seen a column with similar name pattern.
   * Used for cross-dataset reuse (e.g. "Dept" learns from "department").
   */
  findSimilarColumnMappings(columnName: string): Record<string, string> {
    this.load();
    const key = columnName.toLowerCase();
    // Exact match
    const exact = this.mappingsCache?.get(key);
    if (exact) return { ...exact.variantToCanonical };

    // Fuzzy match: check if column name is a substring or vice-versa
    let bestMatch: Record<string, string> = {};
    let bestScore = 0;
    for (const [storedKey, stored] of this.mappingsCache ?? []) {
      if (key.includes(storedKey) || storedKey.includes(key)) {
        const score = Math.min(key.length, storedKey.length) / Math.max(key.length, storedKey.length);
        if (score > bestScore && score > 0.5) {
          bestScore = score;
          bestMatch = { ...stored.variantToCanonical };
        }
      }
    }
    return bestMatch;
  }

  // ── PROMOTION SYSTEM ───────────────────────────────

  /**
   * Record that a mapping was seen in the current batch.
   */
  private recordBatchForMapping(mapping: CanonicalMapping): void {
    const batchId = this.currentBatchId;
    if (!batchId) return;
    if (!mapping.batchHistory.includes(batchId)) {
      mapping.batchHistory.push(batchId);
    }
  }

  /**
   * Compute confidence for a canonical mapping.
   * User confirms are weighted 2x (they're the strongest signal).
   */
  private computeMappingConfidence(mapping: CanonicalMapping): number {
    const totalSignals = mapping.engineConfirms + mapping.userConfirms * 2 + mapping.userRejects;
    if (totalSignals === 0) return 0;
    return (mapping.engineConfirms + mapping.userConfirms * 2) / totalSignals;
  }

  /**
   * Evaluate and promote a single mapping.
   * Returns the new promotion state.
   */
  private evaluatePromotion(mapping: CanonicalMapping): PromotionState {
    mapping.confidence = this.computeMappingConfidence(mapping);
    const currentState = mapping.promotionState;
    const uniqueBatches = new Set(mapping.batchHistory).size;

    // OBSERVED → CONFIRMED
    if (currentState === "OBSERVED") {
      const { minBatches, minEngineConfirms, anyUserConfirm } = PROMOTION_THRESHOLDS.observedToConfirmed;
      if (uniqueBatches >= minBatches || mapping.engineConfirms >= minEngineConfirms || (anyUserConfirm && mapping.userConfirms > 0)) {
        mapping.promotionState = "CONFIRMED";
        return "CONFIRMED";
      }
    }

    // CONFIRMED → ACTIVE
    if (currentState === "CONFIRMED") {
      const { minBatches, minTotalConfirms, minConfidence } = PROMOTION_THRESHOLDS.confirmedToActive;
      const totalConfirms = mapping.engineConfirms + mapping.userConfirms;
      if (uniqueBatches >= minBatches && totalConfirms >= minTotalConfirms && mapping.confidence >= minConfidence) {
        mapping.promotionState = "ACTIVE";
        return "ACTIVE";
      }
    }

    // Demotion: if confidence drops significantly, demote
    if (currentState === "ACTIVE" && mapping.confidence < 0.5) {
      mapping.promotionState = "CONFIRMED";
      return "CONFIRMED";
    }
    if (currentState === "CONFIRMED" && mapping.confidence < 0.3) {
      mapping.promotionState = "OBSERVED";
      return "OBSERVED";
    }

    return currentState;
  }

  /**
   * Run promotion evaluation for all mappings in a column.
   */
  private promoteMappingsForColumn(columnKey: string): void {
    const entry = this.mappingsCache?.get(columnKey);
    if (!entry) return;

    for (const mapping of Object.values(entry.canonicalEntries)) {
      this.evaluatePromotion(mapping);
    }

    // Update stats
    this.recomputePromotionStats();
  }

  /**
   * Run promotion evaluation for ALL columns. Expensive — call sparingly.
   */
  promoteAllMappings(): { promoted: number; demoted: number } {
    this.load();
    let promoted = 0;
    let demoted = 0;

    for (const [, entry] of this.mappingsCache ?? []) {
      for (const mapping of Object.values(entry.canonicalEntries)) {
        const oldState = mapping.promotionState;
        const newState = this.evaluatePromotion(mapping);
        if (newState > oldState) promoted++; // OBSERVED < CONFIRMED < ACTIVE
        if (newState < oldState) demoted++;
      }
    }

    // Also promote rules
    for (const rule of this.rulesCache?.values() ?? []) {
      const oldState = rule.promotionState;
      this.evaluateRulePromotion(rule);
      const newState = rule.promotionState;
      if (newState > oldState) promoted++;
      if (newState < oldState) demoted++;
    }

    this.recomputePromotionStats();
    this.persist();
    return { promoted, demoted };
  }

  /**
   * Evaluate and promote a single rule entry.
   */
  private evaluateRulePromotion(rule: RuleMemoryEntry): PromotionState {
    const totalApplications = rule.successCount + rule.failureCount;
    const uniqueBatches = new Set(rule.batchHistory).size;

    if (rule.promotionState === "OBSERVED") {
      if (uniqueBatches >= 2 || totalApplications >= 3) {
        rule.promotionState = "CONFIRMED";
      }
    }

    if (rule.promotionState === "CONFIRMED") {
      if (uniqueBatches >= 3 && rule.confidence >= 0.8 && rule.datasetCount >= 2) {
        rule.promotionState = "ACTIVE";
      }
    }

    // Demotion
    if (rule.promotionState === "ACTIVE" && rule.confidence < 0.4) {
      rule.promotionState = "CONFIRMED";
    }
    if (rule.promotionState === "CONFIRMED" && rule.confidence < 0.3) {
      rule.promotionState = "OBSERVED";
    }

    return rule.promotionState;
  }

  /**
   * Recompute promotion statistics for the stats cache.
   */
  private recomputePromotionStats(): void {
    let observed = 0, confirmed = 0, active = 0;
    for (const [, entry] of this.mappingsCache ?? []) {
      for (const mapping of Object.values(entry.canonicalEntries)) {
        switch (mapping.promotionState) {
          case "OBSERVED": observed++; break;
          case "CONFIRMED": confirmed++; break;
          case "ACTIVE": active++; break;
        }
      }
    }
    this.statsCache!.observedMappings = observed;
    this.statsCache!.confirmedMappings = confirmed;
    this.statsCache!.activeMappings = active;
  }

  /**
   * Get promotion summary for a specific column.
   */
  getPromotionSummary(columnName: string): PromotionSummary[] {
    this.load();
    const key = columnName.toLowerCase();
    const entry = this.mappingsCache?.get(key);
    if (!entry) return [];

    const summaries: Map<PromotionState, PromotionSummary> = new Map();
    for (const [, canon] of Object.entries(entry.canonicalEntries)) {
      if (!summaries.has(canon.promotionState)) {
        summaries.set(canon.promotionState, { state: canon.promotionState, count: 0, labels: [] });
      }
      const summary = summaries.get(canon.promotionState)!;
      summary.count++;
      summary.labels.push({
        variant: [...canon.variants].slice(0, 3).join(", "),
        canonical: canon.anchor,
        confidence: canon.confidence,
      });
    }
    return [...summaries.values()];
  }

  // ── DRIFT DETECTION ────────────────────────────────

  /**
   * Detect drift in incoming data for a column.
   * Compares current values against known mappings and identifies NEW_VARIANTs.
   * 
   * @param columnName - Column being analyzed
   * @param currentValues - Unique values in the current batch (lowercase)
   * @param valueFrequencies - Frequency map for current values
   * @returns Array of drift alerts (new ones only, not previously detected)
   */
  detectDrift(
    columnName: string,
    currentValues: string[],
    valueFrequencies?: Record<string, number>
  ): DriftAlert[] {
    this.load();
    const key = columnName.toLowerCase();
    const entry = this.mappingsCache?.get(key);
    const freq = valueFrequencies ?? {};

    // If column has never been seen, no drift to detect (everything is new)
    if (!entry || Object.keys(entry.variantToCanonical).length === 0) return [];

    const knownVariants = new Set(Object.keys(entry.variantToCanonical));
    const knownCanonicals = new Set(Object.keys(entry.canonicalEntries));
    const newVariants: string[] = [];

    for (const val of currentValues) {
      const normalized = val.toLowerCase().trim();
      if (!knownVariants.has(normalized) && !knownCanonicals.has(normalized)) {
        newVariants.push(normalized);
      }
    }

    if (newVariants.length === 0) return [];

    // For each new variant, compute similarity to existing known values
    const alerts: DriftAlert[] = [];
    const existingValues = [...knownVariants, ...knownCanonicals];

    for (const newVar of newVariants) {
      // Find best similarity match
      let bestSimilarity = 0;
      let mostSimilarTo: string | null = null;

      for (const existing of existingValues) {
        const sim = computeSimilarity(newVar, existing);
        if (sim > bestSimilarity) {
          bestSimilarity = sim;
          mostSimilarTo = existing;
          // Resolve to canonical if the existing value has a mapping
          if (entry.variantToCanonical[existing]) {
            mostSimilarTo = entry.variantToCanonical[existing];
          }
        }
      }

      // Determine severity
      const frequency = freq[newVar] ?? 1;
      let severity: DriftSeverity = "low";
      if (frequency >= 5 || bestSimilarity >= 0.7) severity = "high";
      else if (frequency >= 2 || bestSimilarity >= 0.4) severity = "medium";

      // Check if we already have an unresolved alert for this exact column+value
      const existingAlert = this.driftAlertsCache?.find(
        (a) => a.column.toLowerCase() === key && a.newValue === newVar && a.resolution === null
      );
      if (existingAlert) continue; // Already alerted

      const alert: DriftAlert = {
        id: `drift-${Date.now()}-${simpleHash(`${key}-${newVar}`)}`,
        column: columnName,
        newValue: newVar,
        frequency,
        similarityScore: Math.round(bestSimilarity * 100) / 100,
        similarTo: mostSimilarTo,
        severity,
        detectedAt: Date.now(),
        acknowledged: false,
        resolution: null,
        batchId: this.currentBatchId ?? "unknown",
      };

      alerts.push(alert);
      this.driftAlertsCache?.push(alert);
    }

    // Update stats
    if (alerts.length > 0) {
      this.statsCache!.totalDriftDetected = (this.statsCache!.totalDriftDetected ?? 0) + alerts.length;
      this.statsCache!.activeDriftAlerts = (this.driftAlertsCache ?? []).filter((a) => a.resolution === null).length;
    }

    this.persist();
    return alerts;
  }

  /**
   * Get all drift alerts, optionally filtered.
   */
  getDriftAlerts(options?: { unresolvedOnly?: boolean; column?: string; limit?: number }): DriftAlert[] {
    this.load();
    let alerts = [...(this.driftAlertsCache ?? [])];

    if (options?.unresolvedOnly) alerts = alerts.filter((a) => a.resolution === null);
    if (options?.column) alerts = alerts.filter((a) => a.column.toLowerCase() === options.column!.toLowerCase());
    if (options?.limit) alerts = alerts.slice(0, options.limit);

    // Sort by severity (high first), then by recency
    const severityOrder: Record<DriftSeverity, number> = { high: 3, medium: 2, low: 1 };
    alerts.sort((a, b) => (severityOrder[b.severity] - severityOrder[a.severity]) || b.detectedAt - a.detectedAt);

    return alerts;
  }

  /**
   * Resolve a drift alert.
   */
  resolveDrift(alertId: string, resolution: "accept" | "reject" | "replace"): boolean {
    this.load();
    const alert = this.driftAlertsCache?.find((a) => a.id === alertId);
    if (!alert) return false;

    alert.resolution = resolution;
    alert.acknowledged = true;

    // Apply the resolution to mapping memory
    if (resolution === "accept") {
      // Add as new variant → map to the similar canonical (or keep as-is if no similar)
      const target = alert.similarTo ?? alert.newValue;
      this.storeLearnedMappings(alert.column, { [alert.newValue]: target });
    } else if (resolution === "replace") {
      // The new value becomes the new canonical — replace existing mappings
      const key = alert.column.toLowerCase();
      const entry = this.mappingsCache?.get(key);
      if (entry && alert.similarTo) {
        // Find all variants that map to the old canonical and remap them
        const oldCanonical = alert.similarTo;
        for (const [variant, canonical] of Object.entries(entry.variantToCanonical)) {
          if (canonical.toLowerCase() === oldCanonical.toLowerCase()) {
            entry.variantToCanonical[variant] = alert.newValue;
          }
        }
        // Update canonical entry
        const oldCanonKey = oldCanonical.toLowerCase();
        const oldCanon = entry.canonicalEntries[oldCanonKey];
        if (oldCanon) {
          oldCanon.anchor = alert.newValue;
          oldCanon.promotionState = "OBSERVED"; // Reset promotion since canonical changed
          oldCanon.batchHistory = [];
        }
        // Also add the new value itself
        entry.variantToCanonical[alert.newValue.toLowerCase()] = alert.newValue;
      }
    }
    // "reject" = do nothing, just mark as resolved

    // Update stats
    this.statsCache!.activeDriftAlerts = (this.driftAlertsCache ?? []).filter((a) => a.resolution === null).length;
    this.statsCache!.resolvedDriftAlerts = (this.driftAlertsCache ?? []).filter((a) => a.resolution !== null).length;

    this.persist();
    return true;
  }

  /**
   * Clear all resolved drift alerts (cleanup).
   */
  clearResolvedDriftAlerts(): number {
    this.load();
    const before = this.driftAlertsCache?.length ?? 0;
    this.driftAlertsCache = (this.driftAlertsCache ?? []).filter((a) => a.resolution === null);
    const cleared = before - this.driftAlertsCache.length;
    this.statsCache!.resolvedDriftAlerts = 0;
    this.persist();
    return cleared;
  }

  // ── RULE MEMORY ────────────────────────────────────

  /**
   * Record that a rule was applied.
   */
  recordRuleApplied(ruleId: string, method: string, section: string, columnName: string, columnType: string): void {
    this.load();
    const entry = this.rulesCache?.get(ruleId);
    const batchId = this.currentBatchId;

    if (entry) {
      entry.successCount++;
      entry.lastUsed = Date.now();
      entry.confidence = entry.successCount / Math.max(entry.successCount + entry.failureCount, 1);
      if (batchId && !entry.batchHistory.includes(batchId)) {
        entry.batchHistory.push(batchId);
      }
    } else {
      this.rulesCache?.set(ruleId, {
        id: ruleId,
        method,
        section,
        columnPattern: columnName.toLowerCase(),
        columnType,
        successCount: 1,
        failureCount: 0,
        confidence: 1.0,
        firstSeen: Date.now(),
        lastUsed: Date.now(),
        datasetCount: 1,
        promotionState: "OBSERVED",
        batchHistory: batchId ? [batchId] : [],
      });
      this.statsCache!.totalRulesLearned++;
    }
    this.persist();
  }

  /**
   * Record that a rule was undone/rejected by the user.
   */
  recordRuleRejected(ruleId: string): void {
    this.load();
    const entry = this.rulesCache?.get(ruleId);
    if (entry) {
      entry.failureCount++;
      entry.confidence = entry.successCount / Math.max(entry.successCount + entry.failureCount, 1);
      this.evaluateRulePromotion(entry);
    }
    this.persist();
  }

  /**
   * Get rules that match a given column type/pattern.
   * Used to suggest previously-successful rules for new columns.
   */
  getMatchingRules(columnType: string, columnName: string): RuleMemoryEntry[] {
    this.load();
    const results: RuleMemoryEntry[] = [];
    const colKey = columnName.toLowerCase();
    for (const entry of this.rulesCache?.values() ?? []) {
      if (entry.columnType === columnType || colKey.includes(entry.columnPattern) || entry.columnPattern.includes(colKey)) {
        results.push(entry);
      }
    }
    return results.sort((a, b) => b.confidence - a.confidence || b.lastUsed - a.lastUsed);
  }

  // ── USER CORRECTION MEMORY ─────────────────────────

  /**
   * Record a manual user correction (e.g. user changed "p" to "Present").
   * This is the KEY learning signal — user corrections are the highest-confidence mappings.
   * v3: Also auto-promotes the mapping if conditions are met.
   */
  recordUserCorrection(column: string, fromValue: string, toValue: string): void {
    this.load();
    const fromKey = fromValue.toLowerCase().trim();

    // Skip if from === to (no actual correction)
    if (fromKey === toValue.toLowerCase().trim()) return;

    // Find existing correction
    const existing = this.correctionsCache?.find(
      (c) => c.column.toLowerCase() === column.toLowerCase() && c.fromValue === fromKey && c.toValue === toValue
    );

    if (existing) {
      existing.count++;
      existing.timestamp = Date.now();
    } else {
      this.correctionsCache?.push({
        column,
        fromValue: fromKey,
        toValue,
        timestamp: Date.now(),
        count: 1,
      });
      this.statsCache!.totalUserCorrections++;
    }

    // Also update mapping memory with this high-confidence correction
    const key = column.toLowerCase();
    let mappingEntry = this.mappingsCache?.get(key);
    if (!mappingEntry) {
      mappingEntry = {
        columnKey: key,
        variantToCanonical: {},
        canonicalEntries: {},
        totalProcessed: 0,
        lastUpdated: Date.now(),
      };
      this.mappingsCache?.set(key, mappingEntry);
    }

    mappingEntry.variantToCanonical[fromKey] = toValue;

    const canonKey = toValue.toLowerCase();
    if (!mappingEntry.canonicalEntries[canonKey]) {
      mappingEntry.canonicalEntries[canonKey] = {
        anchor: toValue,
        variants: new Set(),
        engineConfirms: 0,
        userConfirms: 0,
        userRejects: 0,
        firstSeen: Date.now(),
        lastUsed: Date.now(),
        observedInColumns: [column],
        promotionState: "OBSERVED",
        batchHistory: [],
        confidence: 0,
      };
    }
    const canonEntry = mappingEntry.canonicalEntries[canonKey];
    canonEntry.variants.add(fromKey);
    canonEntry.userConfirms++;
    canonEntry.lastUsed = Date.now();
    this.recordBatchForMapping(canonEntry);

    // User corrections are strong signals — auto-evaluate promotion
    this.evaluatePromotion(canonEntry);
    this.recomputePromotionStats();

    this.persist();
  }

  /**
   * Record that a user REJECTED a mapping (reverted an AI change).
   * This adds a reject signal and may trigger demotion.
   */
  recordMappingRejected(column: string, variant: string, canonical: string): void {
    this.load();
    const key = column.toLowerCase();
    const entry = this.mappingsCache?.get(key);
    if (!entry) return;

    const canonKey = canonical.toLowerCase();
    const canonEntry = entry.canonicalEntries[canonKey];
    if (canonEntry) {
      canonEntry.userRejects++;
      this.evaluatePromotion(canonEntry); // May demote
      this.recomputePromotionStats();
      this.persist();
    }
  }

  /**
   * Get user corrections for a column (for auto-applying learned corrections).
   */
  getUserCorrections(column: string): UserCorrection[] {
    this.load();
    return (this.correctionsCache ?? [])
      .filter((c) => c.column.toLowerCase() === column.toLowerCase())
      .sort((a, b) => b.count - a.count);
  }

  // ── DATASET TRACKING ───────────────────────────────

  /**
   * Record that a dataset was processed.
   */
  recordDatasetProcessed(datasetFingerprint: string): boolean {
    this.load();
    if (this.datasetIdsProcessed?.has(datasetFingerprint)) return false;
    this.datasetIdsProcessed?.add(datasetFingerprint);
    this.statsCache!.totalDatasetsProcessed++;
    if (this.statsCache!.totalDatasetsProcessed > 0) {
      const firstRule = this.rulesCache?.values().next().value;
      if (firstRule) {
        this.statsCache!.memoryAgeDays = Math.floor((Date.now() - firstRule.firstSeen) / 86400000);
      }
    }
    this.persist();
    return true;
  }

  // ── STATS & ADMIN ──────────────────────────────────

  /**
   * Get overall memory statistics.
   */
  getStats(): MemoryStats {
    this.load();
    return { ...this.statsCache! };
  }

  /**
   * Get all memory data (for UI display).
   */
  getAllData(): {
    mappings: Map<string, ColumnMappingMemory>;
    rules: Map<string, RuleMemoryEntry>;
    corrections: UserCorrection[];
    stats: MemoryStats;
    driftAlerts: DriftAlert[];
  } {
    this.load();
    return {
      mappings: this.mappingsCache!,
      rules: this.rulesCache!,
      corrections: this.correctionsCache!,
      stats: this.statsCache!,
      driftAlerts: this.driftAlertsCache ?? [],
    };
  }

  /**
   * Clear all memory data.
   */
  clearAll(): void {
    this.mappingsCache = new Map();
    this.rulesCache = new Map();
    this.correctionsCache = [];
    this.driftAlertsCache = [];
    this.statsCache = {
      totalMappingsLearned: 0,
      totalColumnsMapped: 0,
      totalRulesLearned: 0,
      totalUserCorrections: 0,
      totalDatasetsProcessed: 0,
      memoryAgeDays: 0,
      observedMappings: 0,
      confirmedMappings: 0,
      activeMappings: 0,
      activeDriftAlerts: 0,
      resolvedDriftAlerts: 0,
      totalDriftDetected: 0,
    };
    this.datasetIdsProcessed = new Set();
    this.currentBatchId = null;
    for (const key of Object.values(STORAGE_KEYS)) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    }
  }

  /**
   * Get storage usage in bytes.
   */
  getStorageSize(): { used: number; total: number } {
    try {
      if (typeof window === "undefined") return { used: 0, total: 0 };
      let used = 0;
      for (const key of Object.values(STORAGE_KEYS)) {
        const item = localStorage.getItem(key);
        if (item) used += item.length * 2;
      }
      const total = 5 * 1024 * 1024;
      return { used, total };
    } catch {
      return { used: 0, total: 5 * 1024 * 1024 };
    }
  }
}

// ── Singleton Export ─────────────────────────────────

export const memoryEngine = new MemoryEngine();

// ── Utility: Similarity computation ──────────────────

/**
 * Compute similarity between two strings (0–1).
 * Uses a combination of:
 *   - Longest Common Subsequence ratio
 *   - Shared character ratio
 *   - Length similarity bonus
 */
function computeSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;

  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();

  // Quick substring check
  if (aLower.includes(bLower) || bLower.includes(aLower)) {
    return Math.min(aLower.length, bLower.length) / Math.max(aLower.length, bLower.length);
  }

  // Longest Common Subsequence
  const lcsLen = lcsLength(aLower, bLower);
  const lcsRatio = (lcsLen * 2) / (aLower.length + bLower.length);

  // Shared character set ratio
  const aChars = new Set(aLower);
  const bChars = new Set(bLower);
  let sharedCount = 0;
  for (const c of aChars) {
    if (bChars.has(c)) sharedCount++;
  }
  const sharedRatio = (sharedCount * 2) / (aChars.size + bChars.size);

  // Weighted combination
  return lcsRatio * 0.7 + sharedRatio * 0.3;
}

function lcsLength(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  // Use 1D DP for memory efficiency
  let prev = new Array(n + 1).fill(0) as number[];
  let curr = new Array(n + 1).fill(0) as number[];

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

// ── Utility: Generate a simple dataset fingerprint ──

export function generateDatasetFingerprint(rawData: Record<string, unknown>[]): string {
  if (rawData.length === 0) return `empty-${Date.now()}`;
  const cols = Object.keys(rawData[0]).sort().join(",");
  const rows = Math.min(rawData.length, 3);
  const sample = rawData.slice(0, rows).map((r) =>
    Object.values(r).map((v) => String(v ?? "").slice(0, 20)).join("|")
  ).join(";");
  let hash = 0;
  const str = `${cols}::${sample}::${rawData.length}`;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return `ds-${Math.abs(hash).toString(36)}`;
}
