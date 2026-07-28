/**
 * Mock-tier tests for the shared `continuationNudge` mechanism (VoxAgent + overrides).
 *
 * The base `VoxAgent.continuationNudge` derives a default finalize-reminder from an agent's
 * `completionTools`, so any agent that declares them (the negotiator, and every live envoy since
 * the completion set moved onto the shared field) is nudged for free. The strategist overrides it
 * for mode-aware wording; Oracle overrides it to `undefined` so a replayed turn is never perturbed
 * by an unrecorded message.
 *
 * Each expectation composes the wording through `buildCompletionToolsNudge` rather than repeating
 * it, so the reminder's prose can be edited in one place.
 *
 * Loaded through the agent-registry (the canonical entry) to avoid the circular-import hazard of
 * importing agent modules in isolation.
 */

import { describe, expect, it } from 'vitest';
import '../../../src/infra/agent-registry.js';
import { agentRegistry } from '../../../src/infra/agent-registry.js';
import { buildCompletionToolsNudge } from '../../../src/utils/tools/tool-names.js';

describe('continuationNudge', () => {
  it('derives the default nudge from completionTools (negotiator, inherited)', () => {
    const negotiator = agentRegistry.get('negotiator') as any;
    expect(negotiator.continuationNudge({})).toBe(
      buildCompletionToolsNudge(['accept-deal', 'propose-deal', 'reject-deal'])
    );
  });

  it('keeps the strategist wording mode-aware after the shared-formatter refactor', () => {
    const strategist = agentRegistry.get('simple-strategist') as any;
    expect(strategist.continuationNudge({ mode: 'Strategy' })).toBe(
      buildCompletionToolsNudge(['set-strategy', 'keep-status-quo'])
    );
    expect(strategist.continuationNudge({ mode: 'Flavor' })).toBe(
      buildCompletionToolsNudge(['set-flavors', 'keep-status-quo'])
    );
  });

  it('disables the nudge for Oracle so a replayed prompt is never perturbed', () => {
    const oracle = agentRegistry.get('oracle') as any;
    expect(oracle.continuationNudge({})).toBeUndefined();
  });

  it('nudges a live envoy toward its own completion tools in normal mode (diplomat)', () => {
    const diplomat = agentRegistry.get('diplomat') as any;
    expect(diplomat.continuationNudge({}, { messages: [] })).toBe(
      buildCompletionToolsNudge(['send-message', 'call-negotiator', 'close-conversation'])
    );
  });

  it('nudges a live envoy only toward send-message when special mode restricts the tool set', () => {
    const diplomat = agentRegistry.get('diplomat') as any;
    const input = {
      messages: [{
        message: { role: 'user', content: '{{{Greeting}}}' },
        metadata: { datetime: new Date(0), turn: 5 },
      }],
    };

    const nudge = diplomat.continuationNudge({}, input);
    expect(nudge).toBe(buildCompletionToolsNudge(['send-message']));
    expect(nudge).not.toContain('call-negotiator');
    expect(nudge).not.toContain('close-conversation');
  });
});
