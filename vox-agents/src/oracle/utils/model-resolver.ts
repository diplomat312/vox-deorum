/**
 * @module oracle/utils/model-resolver
 *
 * Resolves model configurations from strings or Model objects.
 * Parses the model format ({provider}/{name}@{reasoningEffort})
 * and looks up full configurations from config.llms.
 */

import { config } from '../../utils/config.js';
import { getModelConfig } from '../../utils/models/models.js';
import { createLogger } from '../../utils/logger.js';
import type { Model } from '../../types/index.js';
import { formatModelReference, parseModelReference } from '../../utils/models/model-reference.js';
import { synthesizeModelConfig } from '../../utils/models/rules.js';
import { getRuntimeModel } from '../../utils/models/resolution.js';

const logger = createLogger('OracleModelResolver');

/**
 * Render a resolved Model back into the telemetry model string
 * (`{provider}/{name}@{reasoningEffort}`), the same shape {@link resolveModel} parses.
 *
 * The effort recorded is the one the replay actually ran with — an explicit `@effort` from
 * the experiment's model override, or the default carried by the config.llms entry. It is
 * omitted entirely when the model has none, so the provider's own default is not misreported
 * as a chosen effort.
 *
 * @param model - Resolved model configuration
 * @returns Model string, e.g. `google/gemini-3.5-flash@high`
 */
export function formatModelString(model: Model): string {
  return formatModelReference(model);
}

/**
 * Resolve a model input into a full Model configuration.
 * If given a Model object, returns it directly.
 * If given a string, parses it and looks up in config.llms.
 *
 * @param input - Model object or string (e.g. "openai-compatible/Kimi-K2.5@Medium")
 * @returns Resolved Model configuration
 */
export function resolveModel(input: string | Model): Model {
  if (typeof input !== 'string') {
    return input;
  }

  // Preserve an intentionally registered native name before parsing a suffix.
  const literalEntry = config.llms[input];
  if (literalEntry) {
    return typeof literalEntry === 'string' ? getModelConfig(literalEntry) : literalEntry;
  }

  const parsed = parseModelReference(input);

  // Try direct lookup in config.llms
  const llmEntry = config.llms[parsed.fullKey];

  if (llmEntry) {
    if (typeof llmEntry === 'string') {
      // It's an alias -- resolve through getModelConfig
      return getModelConfig(llmEntry, parsed.reasoningEffort);
    }

    // Apply reasoning effort if present
    if (parsed.reasoningEffort) {
      return {
        ...llmEntry,
        options: { ...llmEntry.options, reasoningEffort: parsed.reasoningEffort },
      };
    }
    return llmEntry;
  }

  const runtimeModel = getRuntimeModel(parsed.fullKey);
  if (runtimeModel) {
    return parsed.reasoningEffort
      ? { ...runtimeModel, options: { ...runtimeModel.options, reasoningEffort: parsed.reasoningEffort } }
      : runtimeModel;
  }

  // Preserve the same provider rules as normal model resolution for replayed models.
  const synthesized = synthesizeModelConfig(parsed.fullKey);
  if (synthesized) {
    return parsed.reasoningEffort
      ? { ...synthesized, options: { ...synthesized.options, reasoningEffort: parsed.reasoningEffort } }
      : synthesized;
  }

  // Unknown providers retain telemetry's verbatim provider/name construction.
  logger.warn(`Model "${parsed.fullKey}" not found in config.llms, constructing from telemetry string`);
  return {
    provider: parsed.provider,
    name: parsed.name,
    options: parsed.reasoningEffort ? { reasoningEffort: parsed.reasoningEffort } : undefined,
  };
}
