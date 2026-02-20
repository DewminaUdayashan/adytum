/**
 * @file packages/gateway/src/infrastructure/llm/model-selection.ts
 * @description Model selection engine: aliases, per-agent overrides,
 *              allowlist/denylist, and capability-based filtering.
 *
 * This module sits between the caller and ModelCatalog to provide a
 * higher-level model selection API with rich filtering capabilities.
 *
 * Inspired by OpenClaw's model-selection.ts (aliases, allowlists, per-agent config).
 */

import type { ModelApi, ModelInputType } from '@adytum/shared';
import type { ModelEntry } from '../../domain/interfaces/model-repository.interface.js';

// ─── Types ────────────────────────────────────────────────────

export interface ModelSelectionConfig {
  /** User-defined aliases: "sonnet" → "anthropic/claude-sonnet-4-20250514" */
  aliases: Record<string, string>;
  /** Per-agent model overrides: agentId → { thinking, fast, local } model refs */
  agentOverrides: Record<string, Record<string, string>>;
  /** Allowlist: only these model IDs can be used (empty = no restriction) */
  allowlist: string[];
  /** Denylist: these model IDs are blocked from use */
  denylist: string[];
}

export interface ModelCapabilityQuery {
  /** Required input modality (e.g. "image" for vision) */
  input?: ModelInputType;
  /** Requires reasoning/thinking capability */
  reasoning?: boolean;
  /** Minimum context window in tokens */
  minContextWindow?: number;
  /** Required API type */
  api?: ModelApi;
  /** Maximum cost per 1M input tokens */
  maxInputCost?: number;
  /** Maximum cost per 1M output tokens */
  maxOutputCost?: number;
}

export interface SelectionResult {
  /** The selected model entry */
  model: ModelEntry;
  /** How the model was resolved */
  resolvedVia: 'direct' | 'alias' | 'agent-override' | 'capability-match' | 'fallback';
  /** Original reference that was resolved */
  originalRef: string;
}

// ─── Model Selection Engine ───────────────────────────────────

export class ModelSelector {
  private aliases: Map<string, string>;
  private agentOverrides: Map<string, Record<string, string>>;
  private allowSet: Set<string>;
  private denySet: Set<string>;

  constructor(config: Partial<ModelSelectionConfig> = {}) {
    this.aliases = new Map(
      Object.entries(config.aliases ?? {}).map(([k, v]) => [k.toLowerCase().trim(), v]),
    );
    this.agentOverrides = new Map(Object.entries(config.agentOverrides ?? {}));
    this.allowSet = new Set((config.allowlist ?? []).map((s) => s.toLowerCase().trim()));
    this.denySet = new Set((config.denylist ?? []).map((s) => s.toLowerCase().trim()));
  }

  // ── Alias Resolution ──────────────────────────────────────

  /**
   * Resolve a model reference through alias chain (max 5 deep to prevent cycles).
   */
  resolveAlias(ref: string): { resolved: string; wasAlias: boolean } {
    let current = ref;
    let depth = 0;
    let wasAlias = false;

    while (depth < 5) {
      const target = this.aliases.get(current.toLowerCase().trim());
      if (!target || target.toLowerCase().trim() === current.toLowerCase().trim()) break;
      current = target;
      wasAlias = true;
      depth++;
    }

    return { resolved: current, wasAlias };
  }

  /**
   * Register a new alias at runtime.
   */
  setAlias(alias: string, target: string): void {
    this.aliases.set(alias.toLowerCase().trim(), target);
  }

  /**
   * Remove an alias.
   */
  removeAlias(alias: string): boolean {
    return this.aliases.delete(alias.toLowerCase().trim());
  }

  /**
   * Get all registered aliases.
   */
  getAliases(): Record<string, string> {
    return Object.fromEntries(this.aliases);
  }

  // ── Per-Agent Overrides ───────────────────────────────────

  /**
   * Resolve a model for a specific agent and role.
   * Returns the overridden model ref, or null if no override exists.
   */
  resolveAgentOverride(agentId: string, role: string): string | null {
    const overrides = this.agentOverrides.get(agentId);
    if (!overrides) return null;
    return overrides[role] ?? null;
  }

  /**
   * Set a per-agent model override.
   */
  setAgentOverride(agentId: string, role: string, modelRef: string): void {
    let overrides = this.agentOverrides.get(agentId);
    if (!overrides) {
      overrides = {};
      this.agentOverrides.set(agentId, overrides);
    }
    overrides[role] = modelRef;
  }

  // ── Allowlist / Denylist ──────────────────────────────────

  /**
   * Check if a model ID is allowed (passes allowlist and denylist).
   */
  isAllowed(modelId: string): boolean {
    const lower = modelId.toLowerCase().trim();

    // Denylist always takes priority
    if (this.denySet.has(lower)) return false;

    // If allowlist is empty, everything is allowed
    if (this.allowSet.size === 0) return true;

    // Check allowlist (also check provider-level patterns like "anthropic/*")
    if (this.allowSet.has(lower)) return true;

    // Check provider-level wildcard
    const slashIdx = lower.indexOf('/');
    if (slashIdx > 0) {
      const providerWildcard = lower.slice(0, slashIdx) + '/*';
      if (this.allowSet.has(providerWildcard)) return true;
    }

    return false;
  }

  /**
   * Add entries to the denylist.
   */
  deny(modelIds: string[]): void {
    for (const id of modelIds) {
      this.denySet.add(id.toLowerCase().trim());
    }
  }

  /**
   * Remove entries from the denylist.
   */
  undeny(modelIds: string[]): void {
    for (const id of modelIds) {
      this.denySet.delete(id.toLowerCase().trim());
    }
  }

  // ── Capability Filtering ──────────────────────────────────

  /**
   * Filter a list of models by required capabilities.
   */
  filterByCapability(models: ModelEntry[], query: ModelCapabilityQuery): ModelEntry[] {
    return models.filter((m) => this.matchesCapability(m, query));
  }

  /**
   * Check if a single model matches a capability query.
   */
  matchesCapability(model: ModelEntry, query: ModelCapabilityQuery): boolean {
    if (query.input && !model.input?.includes(query.input)) return false;
    if (query.reasoning && !model.reasoning) return false;
    if (query.minContextWindow && (model.contextWindow ?? 0) < query.minContextWindow) return false;
    if (query.api && model.api !== query.api) return false;
    if (query.maxInputCost != null && (model.cost?.input ?? Infinity) > query.maxInputCost)
      return false;
    if (query.maxOutputCost != null && (model.cost?.output ?? Infinity) > query.maxOutputCost)
      return false;
    return true;
  }

  // ── Full Selection Pipeline ───────────────────────────────

  /**
   * Full model selection: agent override → alias resolution → allowlist check.
   *
   * Returns the resolved model ref string (caller resolves to ModelEntry via catalog).
   */
  select(
    ref: string,
    options?: { agentId?: string; role?: string },
  ): {
    modelRef: string;
    resolvedVia: SelectionResult['resolvedVia'];
    blocked: boolean;
    blockReason?: string;
  } {
    // 1. Check per-agent override
    if (options?.agentId && options?.role) {
      const override = this.resolveAgentOverride(options.agentId, options.role);
      if (override) {
        const allowed = this.isAllowed(override);
        return {
          modelRef: override,
          resolvedVia: 'agent-override',
          blocked: !allowed,
          blockReason: allowed ? undefined : `Model ${override} is blocked by allowlist/denylist`,
        };
      }
    }

    // 2. Resolve aliases
    const { resolved, wasAlias } = this.resolveAlias(ref);

    // 3. Check allowlist/denylist
    const allowed = this.isAllowed(resolved);

    return {
      modelRef: resolved,
      resolvedVia: wasAlias ? 'alias' : 'direct',
      blocked: !allowed,
      blockReason: allowed ? undefined : `Model ${resolved} is blocked by allowlist/denylist`,
    };
  }
}
