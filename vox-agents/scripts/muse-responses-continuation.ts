/**
 * Reproduce a two-step Muse Responses tool continuation outside Civilization V.
 *
 * This is an opt-in live diagnostic. It uses the production model construction path and makes no
 * game, MCP, transcript, or diplomacy changes.
 */

import { streamText, tool, type ModelMessage } from 'ai';
import { z } from 'zod';
import { getModel, getStrictModelConfig } from '../src/utils/models/models.js';

const modelReference = 'opencode-go/muse-spark-1.2-contributor';

/** Return the small tool set used by the continuation reproduction. */
function createTools() {
  return {
    get_dummy_fact: tool({
      description: 'Read-only support tool. Return the dummy fact before finishing.',
      inputSchema: z.object({}),
      execute: async () => ({ fact: 'Rome has 100 gold' }),
    }),
    finish: tool({
      description: 'Terminal tool. Finish the test after the support result.',
      inputSchema: z.object({ answer: z.string() }),
      execute: async ({ answer }) => ({ answer }),
    }),
  };
}

/** Run exactly one provider step through the same AI SDK path used by VoxContext. */
async function runStep(
  model: ReturnType<typeof getModel>,
  messages: ModelMessage[],
  tools: ReturnType<typeof createTools>,
) {
  const result = streamText({
    model,
    messages,
    tools,
    toolChoice: 'auto',
    stopWhen: () => true,
    maxRetries: 0,
  });
  const steps = await result.steps;
  if (steps.length !== 1) throw new Error(`Expected one provider step, received ${steps.length}.`);
  return steps[0];
}

/** Run the support-tool to terminal-tool continuation and print only sanitized diagnostics. */
async function main(): Promise<void> {
  const model = getModel(getStrictModelConfig(modelReference));
  const tools = createTools();
  const initialMessages: ModelMessage[] = [
    {
      role: 'system',
      content: 'First call get_dummy_fact. After its result, call finish with a short answer. Do not finish before using get_dummy_fact.',
    },
    { role: 'user', content: 'Run the two-step test.' },
  ];

  const first = await runStep(model, initialMessages, tools);
  const firstCall = first.toolCalls.find((call) => call.toolName === 'get_dummy_fact');
  if (!firstCall) throw new Error('Muse did not call get_dummy_fact in step 1.');

  const second = await runStep(model, [...initialMessages, ...first.response.messages], tools);
  const secondCall = second.toolCalls.find((call) => call.toolName === 'finish');
  if (!secondCall) throw new Error('Muse did not call finish in step 2.');

  process.stdout.write(`${JSON.stringify({
    model: modelReference,
    transport: 'responses',
    continuation: 'native',
    step1: { tool: firstCall.toolName, callId: firstCall.toolCallId },
    step2: { tool: secondCall.toolName, callId: secondCall.toolCallId },
    result: 'success',
  })}\n`);
}

main().catch((error: unknown) => {
  const details = error as { name?: string; statusCode?: number; message?: string; data?: { error?: { type?: string; message?: string } } };
  process.stderr.write(`${JSON.stringify({
    model: modelReference,
    transport: 'responses',
    continuation: 'native',
    result: 'failure',
    errorType: details.data?.error?.type ?? details.name,
    statusCode: details.statusCode,
    message: details.data?.error?.message ?? details.message ?? String(error),
  })}\n`);
  process.exitCode = 1;
});
