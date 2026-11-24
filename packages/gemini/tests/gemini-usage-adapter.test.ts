import { GeminiUsageAdapter } from '../src/index.js';
import { calculateEstimatedCost } from '@tokentrack/core';

const adapter = new GeminiUsageAdapter();

it.each([
  [
    { promptTokenCount: 12, candidatesTokenCount: 4, totalTokenCount: 16 },
    { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
  ],
  [
    {
      promptTokenCount: 120,
      candidatesTokenCount: 40,
      cachedContentTokenCount: 20,
      thoughtsTokenCount: 10,
      totalTokenCount: 170,
    },
    {
      inputTokens: 120,
      outputTokens: 50,
      totalTokens: 170,
      inputTokenDetails: { cachedTokens: 20 },
      outputTokenDetails: { reasoningTokens: 10 },
    },
  ],
  [
    {
      promptTokenCount: 12,
      candidatesTokenCount: 4,
      thoughtsTokenCount: 2,
      toolUsePromptTokenCount: 3,
    },
    {
      inputTokens: 15,
      outputTokens: 6,
      totalTokens: 21,
      outputTokenDetails: { reasoningTokens: 2 },
    },
  ],
  [
    {
      promptTokenCount: 0,
      candidatesTokenCount: 0,
      totalTokenCount: 0,
      cachedContentTokenCount: 0,
      thoughtsTokenCount: 0,
    },
    {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      inputTokenDetails: { cachedTokens: 0 },
      outputTokenDetails: { reasoningTokens: 0 },
    },
  ],
  [
    { promptTokenCount: 12, candidatesTokenCount: 4 },
    { inputTokens: 12, outputTokens: 4 },
  ],
  [{ thoughtsTokenCount: 4 }, { outputTokenDetails: { reasoningTokens: 4 } }],
  [
    { candidatesTokenCount: 0, thoughtsTokenCount: 4, totalTokenCount: 99 },
    { outputTokens: 4, totalTokens: 99, outputTokenDetails: { reasoningTokens: 4 } },
  ],
  [
    { candidatesTokenCount: Number.MAX_SAFE_INTEGER, thoughtsTokenCount: 1 },
    { outputTokenDetails: { reasoningTokens: 1 } },
  ],
  [{ candidatesTokenCount: -1, totalTokenCount: NaN }, {}],
  [{}, {}],
])('normalizes %j', (metadata, expected) => {
  expect(adapter.normalizeUsage(Object.freeze(metadata))).toEqual(expected);
});

it('prices tool prompts and reasoning exactly once', () => {
  const usage = adapter.normalizeUsage({
    promptTokenCount: 12,
    toolUsePromptTokenCount: 3,
    candidatesTokenCount: 4,
    thoughtsTokenCount: 2,
  });
  expect(
    calculateEstimatedCost(usage, {
      provider: 'gemini',
      model: 'mock',
      currency: 'USD',
      pricingVersion: 'test',
      rates: { inputPerMillion: '1', outputPerMillion: '2', reasoningOutputPerMillion: '3' },
    })?.amount,
  ).toBe('0.000029');
});
