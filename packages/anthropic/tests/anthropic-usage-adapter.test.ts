import { AnthropicUsageAdapter, type AnthropicUsage } from '../src/index.js';

const adapter = new AnthropicUsageAdapter();

it.each([
  [
    { input_tokens: 10, output_tokens: 5 },
    { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  ],
  [
    {
      input_tokens: 100,
      output_tokens: 5,
      cache_read_input_tokens: 20,
      cache_creation_input_tokens: 10,
    },
    {
      inputTokens: 130,
      outputTokens: 5,
      totalTokens: 135,
      inputTokenDetails: { cachedTokens: 20, cacheWriteTokens: 10 },
    },
  ],
  [
    {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: null,
    },
    { inputTokens: 0, outputTokens: 0, totalTokens: 0, inputTokenDetails: { cachedTokens: 0 } },
  ],
  [
    {
      input_tokens: 0,
      output_tokens: 5,
      cache_read_input_tokens: 20,
      cache_creation_input_tokens: 10,
    },
    {
      inputTokens: 30,
      outputTokens: 5,
      totalTokens: 35,
      inputTokenDetails: { cachedTokens: 20, cacheWriteTokens: 10 },
    },
  ],
])('normalizes %j', (usage, expected) => {
  expect(adapter.normalizeUsage(Object.freeze(usage))).toEqual(expected);
});

it.each([
  [{ cache_read_input_tokens: 20 }, { cachedTokens: 20 }],
  [{ cache_creation_input_tokens: 10 }, { cacheWriteTokens: 10 }],
  [
    { cache_read_input_tokens: 20, cache_creation_input_tokens: 10 },
    { cachedTokens: 20, cacheWriteTokens: 10 },
  ],
  [
    { input_tokens: null, cache_read_input_tokens: null, cache_creation_input_tokens: 0 },
    { cacheWriteTokens: 0 },
  ],
  [{ output_tokens: 5 }, undefined],
  [{}, undefined],
  [
    {
      input_tokens: null,
      output_tokens: null,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: null,
    },
    undefined,
  ],
])('preserves partial usage from %j', (usage: AnthropicUsage, expectedDetails) => {
  const normalized = adapter.normalizeUsage(Object.freeze(usage));

  expect(normalized.inputTokens).toBeUndefined();
  expect(normalized.totalTokens).toBeUndefined();
  expect(normalized.inputTokenDetails).toEqual(expectedDetails);
  expect(normalized.outputTokens).toBe(usage.output_tokens ?? undefined);
});
it('omits overflowing totals and malformed Anthropic counts', () => {
  expect(
    adapter.normalizeUsage({
      input_tokens: Number.MAX_SAFE_INTEGER,
      cache_read_input_tokens: 1,
      cache_creation_input_tokens: 0,
      output_tokens: 0,
    }),
  ).toMatchObject({ inputTokens: undefined, totalTokens: undefined, outputTokens: 0 });
  expect(
    adapter.normalizeUsage({
      input_tokens: 4,
      cache_read_input_tokens: Infinity,
      output_tokens: 1.5,
    }),
  ).toEqual({ inputTokens: undefined, totalTokens: undefined, outputTokens: undefined });
});
