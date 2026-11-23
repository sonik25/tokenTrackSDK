import { AnthropicUsageAdapter } from '../src/index.js';

const adapter = new AnthropicUsageAdapter();

it.each([
  [
    { input_tokens: 10, output_tokens: 5 },
    { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  ],
  [
    {
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 20,
      cache_creation_input_tokens: 30,
    },
    {
      inputTokens: 60,
      outputTokens: 5,
      totalTokens: 65,
      inputTokenDetails: { cachedTokens: 20, cacheWriteTokens: 30 },
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
  [{ output_tokens: 5 }, { outputTokens: 5 }],
])('normalizes %j', (usage, expected) => {
  expect(adapter.normalizeUsage(Object.freeze(usage))).toEqual(expected);
});
