import { GeminiUsageAdapter } from '../src/index.js';

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
      outputTokens: 40,
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
      inputTokens: 12,
      outputTokens: 4,
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
  [{ candidatesTokenCount: -1, totalTokenCount: NaN }, {}],
  [{}, {}],
])('normalizes %j', (metadata, expected) => {
  expect(adapter.normalizeUsage(Object.freeze(metadata))).toEqual(expected);
});
