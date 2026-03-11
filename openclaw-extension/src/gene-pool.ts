/**
 * Extension Gene Pool -- Lightweight file-based Gene Pool for OpenClaw extension.
 *
 * Handles:
 * - Gene loading/saving from stateDir/genes/
 * - Error signal matching and hint generation (T3)
 * - Session trace collection and gene harvesting (T4)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import {
  type Gene,
  type GeneMatch,
  extractSignals,
  rankGenes,
  signalOverlap,
} from "./signal-matcher.js";

// ============================================
// Constants
// ============================================

const MAX_GENE_HINTS = 3;
const MAX_HINT_LENGTH = 2000;
const DUPLICATE_OVERLAP_THRESHOLD = 0.7;
const HARVEST_MIN_CONFIDENCE = 0.4;
const CONFIDENCE_CAP = 0.95;

// ============================================
// Session trace types
// ============================================

export interface SessionToolTrace {
  name: string;
  params: Record<string, unknown>;
  status: "success" | "error";
  result: string;
  durationMs: number;
  order: number;
}

// ============================================
// ExtensionGenePool
// ============================================

export class ExtensionGenePool {
  private genes: Gene[] = [];
  private genesDir: string;
  private pendingHints: string[] = [];
  private sessionTrace: SessionToolTrace[] = [];

  constructor(dataDir: string) {
    this.genesDir = join(dataDir, "genes");
    this.ensureDir(this.genesDir);
    this.loadGenes();
  }

  private ensureDir(dir: string) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  // ============================================
  // Gene persistence
  // ============================================

  loadGenes(): void {
    this.genes = [];
    if (!existsSync(this.genesDir)) return;

    const files = readdirSync(this.genesDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const raw = readFileSync(join(this.genesDir, file), "utf-8");
        const gene: Gene = JSON.parse(raw);
        if (gene.id && gene.signals_match && gene.strategy) {
          this.genes.push(gene);
        }
      } catch {
        // Skip malformed gene files
      }
    }
  }

  private saveGene(gene: Gene): void {
    this.ensureDir(this.genesDir);
    const filePath = join(this.genesDir, `${gene.id}.json`);
    writeFileSync(filePath, JSON.stringify(gene, null, 2), "utf-8");
  }

  getGeneCount(): number {
    return this.genes.length;
  }

  // ============================================
  // T3: Gene matching and hint injection
  // ============================================

  findMatchingGenes(toolName: string, errorMsg: string): GeneMatch[] {
    if (this.genes.length === 0) return [];
    const signals = extractSignals(toolName, errorMsg);
    const matches = rankGenes(signals, this.genes);
    return matches.slice(0, MAX_GENE_HINTS);
  }

  buildGeneHint(matches: GeneMatch[]): string {
    if (matches.length === 0) return "";

    const hints = matches.map((m, i) => {
      const confidence = Math.round(m.gene.metadata.confidence * 100);
      const stepsText = m.gene.strategy
        .map((s, j) => `   ${j + 1}. ${s}`)
        .join("\n");
      return `Fix ${i + 1} (confidence ${confidence}%, signals: ${m.matchedSignals.join(", ")}):\n${stepsText}`;
    });

    let text = `\n[Gene Pool - Historical Repair Experience]\nFound ${matches.length} relevant repair genes:\n${hints.join("\n")}`;
    text += "\nApply these if the error matches; use your judgment if the context differs.";

    // Truncate if too long
    if (text.length > MAX_HINT_LENGTH) {
      text = text.slice(0, MAX_HINT_LENGTH) + "\n...(truncated)";
    }
    return text;
  }

  /**
   * Match error against gene pool and queue hint for next prompt injection.
   */
  matchAndQueue(toolName: string, errorMsg: string): void {
    const matches = this.findMatchingGenes(toolName, errorMsg);
    if (matches.length > 0) {
      const hint = this.buildGeneHint(matches);
      if (hint) {
        this.pendingHints.push(hint);
      }
      // Update use counts
      for (const m of matches) {
        m.gene.metadata.useCount++;
        m.gene.metadata.lastUsedAt = Date.now();
        this.saveGene(m.gene);
      }
    }
  }

  /**
   * Consume and clear pending hints (called from before_prompt_build).
   */
  consumePendingHints(): string | null {
    if (this.pendingHints.length === 0) return null;
    const combined = this.pendingHints.join("\n");
    this.pendingHints = [];
    return combined;
  }

  // ============================================
  // T4: Session trace collection
  // ============================================

  /**
   * Record a tool call from after_tool_call event.
   */
  recordToolCall(event: {
    toolName?: string;
    name?: string;
    params?: Record<string, unknown>;
    result?: unknown;
    error?: string;
    durationMs?: number;
  }): void {
    const name = event.toolName || event.name || "unknown";
    const hasError = !!event.error;
    const resultStr =
      typeof event.result === "string"
        ? event.result
        : JSON.stringify(event.result || "").slice(0, 1000);

    this.sessionTrace.push({
      name,
      params: event.params || {},
      status: hasError ? "error" : "success",
      result: hasError ? (event.error || "") : resultStr,
      durationMs: event.durationMs || 0,
      order: this.sessionTrace.length,
    });
  }

  /**
   * Reset session trace (called from session_start).
   */
  resetSession(): void {
    this.sessionTrace = [];
    this.pendingHints = [];
  }

  /**
   * Get a copy of the current session trace (for SOP fitness computation).
   */
  getSessionTrace(): SessionToolTrace[] {
    return [...this.sessionTrace];
  }

  // ============================================
  // T4: Gene harvesting
  // ============================================

  /**
   * Analyze session trace for error->success patterns and extract new genes.
   */
  harvestGenes(nexusId?: string): Gene[] {
    if (this.sessionTrace.length < 2) return [];

    const sorted = [...this.sessionTrace].sort((a, b) => a.order - b.order);
    const harvested: Gene[] = [];

    for (let i = 0; i < sorted.length; i++) {
      const failedTool = sorted[i];
      if (failedTool.status !== "error") continue;

      // Find same-name success call after this failure
      for (let j = i + 1; j < sorted.length; j++) {
        const recoveryTool = sorted[j];
        if (recoveryTool.name !== failedTool.name) continue;
        if (recoveryTool.status !== "success") continue;

        // Found error->success pair
        const errorMsg = failedTool.result || "";
        const signals = extractSignals(failedTool.name, errorMsg);

        // Check for duplicate genes
        const isDuplicate = this.genes.some((existing) => {
          const overlap = signalOverlap(signals, existing.signals_match);
          if (overlap >= DUPLICATE_OVERLAP_THRESHOLD) {
            // Boost existing gene's confidence
            existing.metadata.confidence = Math.min(
              CONFIDENCE_CAP,
              existing.metadata.confidence + 0.05
            );
            this.saveGene(existing);
            return true;
          }
          return false;
        });

        if (isDuplicate) break;

        // Build repair strategy from the diff
        const strategy = this.buildStrategy(failedTool, recoveryTool, sorted.slice(i + 1, j));
        if (strategy.length === 0) break;

        const gene: Gene = {
          id: `gene-${Date.now()}-${harvested.length}`,
          category: "repair",
          signals_match: signals,
          strategy,
          source: {
            traceId: `trace-${sorted[0].order}`,
            nexusId,
            createdAt: Date.now(),
          },
          metadata: {
            confidence: HARVEST_MIN_CONFIDENCE,
            useCount: 0,
            successCount: 0,
          },
        };

        harvested.push(gene);
        break; // Only pair with first success
      }
    }

    // Persist new genes
    for (const gene of harvested) {
      this.genes.push(gene);
      this.saveGene(gene);
    }

    return harvested;
  }

  /**
   * Build repair strategy by comparing failed and successful tool calls.
   */
  private buildStrategy(
    failed: SessionToolTrace,
    success: SessionToolTrace,
    intermediate: SessionToolTrace[]
  ): string[] {
    const steps: string[] = [];

    // 1. Describe the error
    const errorSnippet = failed.result.slice(0, 200);
    steps.push(`Error encountered: ${errorSnippet}`);

    // 2. Parameter diff
    const paramDiffs = this.diffParams(failed.params, success.params);
    if (paramDiffs.length > 0) {
      steps.push(`Parameter changes: ${paramDiffs.join("; ")}`);
    }

    // 3. Intermediate tool calls (repair actions taken)
    const interToolNames = intermediate
      .filter((t) => t.name !== failed.name)
      .map((t) => t.name);
    if (interToolNames.length > 0) {
      const unique = [...new Set(interToolNames)];
      steps.push(`Intermediate tools used: ${unique.join(", ")}`);
    }

    // 4. Success summary
    const successSnippet = success.result.slice(0, 200);
    if (successSnippet) {
      steps.push(`Recovery result: ${successSnippet}`);
    }

    return steps;
  }

  /**
   * Compare two parameter sets and describe differences.
   */
  private diffParams(
    paramsA: Record<string, unknown>,
    paramsB: Record<string, unknown>
  ): string[] {
    const diffs: string[] = [];
    const allKeys = new Set([...Object.keys(paramsA), ...Object.keys(paramsB)]);

    for (const key of allKeys) {
      const valA = JSON.stringify(paramsA[key] ?? null);
      const valB = JSON.stringify(paramsB[key] ?? null);
      if (valA !== valB) {
        const aShort = valA.length > 60 ? valA.slice(0, 60) + "..." : valA;
        const bShort = valB.length > 60 ? valB.slice(0, 60) + "..." : valB;
        diffs.push(`${key}: ${aShort} -> ${bShort}`);
      }
    }

    return diffs.slice(0, 5); // Limit to 5 diffs
  }
}
