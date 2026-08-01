/**
 * @module utils/models/resolution
 *
 * Verifies unregistered model IDs against provider catalogs before long-running work starts.
 */

import { config } from '../config.js';
import type { Model } from '../../types/index.js';
import { isSynthesizableModelId } from '../../types/constants.js';
import { createLogger } from '../logger.js';
import { DiscoveryError, discoverModels, isStaticCatalogProvider } from './discovery.js';
import { parseModelReference } from './model-reference.js';
import type { DiscoveredModel } from '../../types/api.js';

/** In-memory, process-lifetime configurations verified by provider discovery. */
const runtimeModels = new Map<string, Model>();

/** One in-flight or completed provider catalog fetch for each process lifetime. */
const catalogCache = new Map<string, Promise<DiscoveredModel[]>>();

/** Runtime-resolution diagnostics without configuration values or credentials. */
const resolutionLogger = createLogger('model-resolution');

/** Returns a configuration verified during this process, if one exists. */
export function getRuntimeModel(name: string): Model | undefined {
  return runtimeModels.get(name);
}

/** Clears process-lifetime resolver state for isolated tests. */
export function resetRuntimeModels(): void {
  runtimeModels.clear();
  catalogCache.clear();
}

/** Gets a provider catalog once, allowing later calls to retry a failed discovery. */
function getCatalog(provider: string): Promise<DiscoveredModel[]> {
  const existing = catalogCache.get(provider);
  if (existing) return existing;

  const catalog = discoverModels(provider, {}).catch((error: unknown) => {
    catalogCache.delete(provider);
    throw error;
  });
  catalogCache.set(provider, catalog);
  return catalog;
}

/**
 * Returns the model reference an agent name resolves to.
 *
 * An agent name is not itself a model reference: agents resolve through their own
 * name (see `VoxAgent.getModel`), and an agent with no `llms` assignment runs on
 * `default`. Preflight must therefore verify the assignment when one exists and
 * `default` when it does not, rather than treating the bare agent name as a model.
 */
export function agentModelReference(name: string, overrides?: Record<string, Model | string>): string {
  return (overrides?.[name] ?? config.llms[name]) === undefined ? 'default' : name;
}

/** Follows configured aliases until reaching a model, a missing key, or a cycle. */
function resolveAlias(name: string, overrides?: Record<string, Model | string>): string | undefined {
  const visited = new Set<string>();
  let current = name;
  while (!visited.has(current)) {
    visited.add(current);
    const definition = overrides?.[current] ?? config.llms[current];
    if (definition === undefined) return current;
    if (typeof definition !== 'string') return undefined;
    current = definition;
  }
  return undefined;
}

/** Ranks likely catalog IDs without an edit-distance dependency. */
function closestIds(catalogIds: string[], id: string, limit = 3): string[] {
  const target = id.toLowerCase();
  /** Counts the case-insensitive prefix shared with the requested ID. */
  const prefixLength = (candidate: string): number => {
    const normalized = candidate.toLowerCase();
    let length = 0;
    while (length < target.length && length < normalized.length && target[length] === normalized[length]) length++;
    return length;
  };
  return catalogIds
    .map((candidate) => ({
      candidate,
      score: (candidate.toLowerCase().includes(target) || target.includes(candidate.toLowerCase()) ? 10_000 : 0) + prefixLength(candidate),
    }))
    .sort((left, right) => right.score - left.score || left.candidate.localeCompare(right.candidate))
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}

/** Verifies missing synthesizable model IDs and registers catalog-backed configurations in memory. */
export async function ensureModelsResolved(
  ids: Iterable<string | Model | undefined>,
  overrides?: Record<string, Model | string>,
): Promise<void> {
  for (const id of ids) {
    if (typeof id !== 'string') continue;
    const resolvedAlias = resolveAlias(id, overrides);
    if (resolvedAlias === undefined) continue;

    const parsed = parseModelReference(resolvedAlias);
    const name = parsed.fullKey;
    if (runtimeModels.has(name) || config.llms[name] !== undefined || overrides?.[name] !== undefined) continue;
    // A reference that names no known provider cannot be verified or synthesized. Failing here
    // keeps a typo from reaching getModelConfig, which would quietly substitute `default`.
    if (!isSynthesizableModelId(name)) {
      const detail = name.includes('/')
        ? `'${parsed.provider}' is not a supported provider`
        : 'it is not a registered llms alias and names no provider';
      throw new Error(`Cannot resolve model '${name}': ${detail}. Use a 'provider/model' reference or register it under llms in config.json.`);
    }

    try {
      const catalog = await getCatalog(parsed.provider);
      // Exact first, then the first case-insensitive hit: catalogs may differ from the
      // configured reference only in casing, and any such hit names the same model.
      const matched = catalog.find((candidate) => candidate.id === name)
        ?? catalog.find((candidate) => candidate.id.toLowerCase() === name.toLowerCase());

      if (matched) {
        runtimeModels.set(name, {
          provider: parsed.provider,
          name: matched.name,
          ...(matched.recommendedOptions === undefined ? {} : { options: matched.recommendedOptions }),
        });
        resolutionLogger.info(`Verified '${name}' against the ${parsed.provider} model catalog; auto-configured it for this run.`);
        continue;
      }

      if (isStaticCatalogProvider(parsed.provider)) {
        resolutionLogger.warn(`Model '${name}' is not in the bundled ${parsed.provider} model list; synthesizing its configuration.`);
        continue;
      }

      const suggestions = closestIds(catalog.map(({ id: catalogId }) => catalogId), name);
      const suggestionText = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(', ')}?` : '';
      throw new Error(`Model '${name}' is not in the ${parsed.provider} provider's model list.${suggestionText} Register it in config.json (llms) to bypass discovery.`);
    } catch (error) {
      if (error instanceof DiscoveryError) {
        resolutionLogger.warn(`Could not verify '${name}' against the ${parsed.provider} model catalog (${error.message}); synthesizing its configuration.`);
        continue;
      }
      throw error;
    }
  }
}
