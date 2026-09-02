import { describe, expect, it } from 'vitest'
import { outputItemTypes, outputSummary, reasoningStatus, reasoningSummary } from '../../../src/utils/social-diagnostics'
import type { SocialDecisionDiagnostic } from '../../../src/utils/types'

/** Create the smallest diagnostic fixture needed by the helper tests. */
function diagnostic(overrides: Partial<SocialDecisionDiagnostic> = {}): SocialDecisionDiagnostic {
  return {
    id: 'diagnostic-1', intentionId: 'intention-1', actorId: 'actor-1', actorDisplayName: 'Alice', modelRef: 'provider/model', executionScope: 'channel-reaction', cascadeId: 'cascade-1', selectedKind: 'reply', routingRefsJson: '{}', validationOutcome: 'validated', applicationOutcome: 'send_message', error: null, providerLatencyMs: 10, queueWaitMs: 0, durationMs: 12, inputTokens: null, outputTokens: null, totalTokens: null, cachedTokens: null, reasoningTokens: null, cost: null, retryCount: 0, createdAt: '2026-09-02T00:00:00.000Z', ...overrides,
  }
}

describe('social diagnostic reasoning summaries', () => {
  it('identifies provider reasoning without exposing its content', () => {
    const value = diagnostic({ responseOutputItemTypesJson: '["reasoning","tool-call"]', responseOutputItemSource: 'normalized-content', reasoningTokens: 120 })
    expect(outputItemTypes(value)).toEqual(['reasoning', 'tool-call'])
    expect(reasoningStatus(value)).toBe('present')
    expect(reasoningSummary(value)).toBe('Reasoning: present (SDK-normalized, 120 tokens)')
    expect(outputSummary(value)).toBe('Output: reasoning, tool-call')
  })

  it('distinguishes missing and non-reasoning output metadata', () => {
    expect(reasoningStatus(diagnostic())).toBe('unavailable')
    expect(reasoningSummary(diagnostic())).toBe('Reasoning: unavailable')
    const value = diagnostic({ responseOutputItemTypesJson: '["text","tool-call"]', responseOutputItemSource: 'provider-body' })
    expect(reasoningStatus(value)).toBe('not-reported')
    expect(reasoningSummary(value)).toBe('Reasoning: not returned')
  })

  it('handles malformed sanitized metadata safely', () => {
    const value = diagnostic({ responseOutputItemTypesJson: '{not-json}' })
    expect(outputItemTypes(value)).toEqual([])
    expect(reasoningStatus(value)).toBe('not-reported')
    expect(outputSummary(value)).toBe('Output: unavailable')
  })
})
