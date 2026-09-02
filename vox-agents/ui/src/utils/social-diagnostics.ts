import type { SocialDecisionDiagnostic } from './types'

export type SocialReasoningStatus = 'present' | 'not-reported' | 'unavailable'

/** Parse the sanitized output-item list from one social decision diagnostic. */
export function outputItemTypes(diagnostic: SocialDecisionDiagnostic): string[] {
  if (!diagnostic.responseOutputItemTypesJson) return []
  try {
    const value: unknown = JSON.parse(diagnostic.responseOutputItemTypesJson)
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

/** Report reasoning availability without exposing provider reasoning content. */
export function reasoningStatus(diagnostic: SocialDecisionDiagnostic): SocialReasoningStatus {
  if (!diagnostic.responseOutputItemTypesJson) return 'unavailable'
  return outputItemTypes(diagnostic).includes('reasoning') ? 'present' : 'not-reported'
}

/** Format the sanitized reasoning metadata for the compact developer panel. */
export function reasoningSummary(diagnostic: SocialDecisionDiagnostic): string {
  const status = reasoningStatus(diagnostic)
  if (status === 'unavailable') return 'Reasoning: unavailable'
  if (status === 'not-reported') return 'Reasoning: not returned'
  const source = diagnostic.responseOutputItemSource === 'provider-body' ? 'provider' : 'SDK-normalized'
  const tokens = diagnostic.reasoningTokens === null || diagnostic.reasoningTokens === undefined ? 'token count unavailable' : `${diagnostic.reasoningTokens} tokens`
  return `Reasoning: present (${source}, ${tokens})`
}

/** Format only the safe structural output metadata for developer inspection. */
export function outputSummary(diagnostic: SocialDecisionDiagnostic): string {
  const types = outputItemTypes(diagnostic)
  return types.length ? `Output: ${types.join(', ')}` : 'Output: unavailable'
}
