import { OpenAIUsageAdapter } from '../src/openai-usage-adapter.js';

describe('OpenAIUsageAdapter', () => {
  const adapter = new OpenAIUsageAdapter();

  it('should identify the provider as openai', () => {
    expect(adapter.provider).toBe('openai');
  });

  it('should normalize basic token usage', () => {
    const result = adapter.normalizeUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    });

    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
    expect(result.totalTokens).toBe(150);
  });

  it('should normalize cached input tokens', () => {
    const result = adapter.normalizeUsage({
      prompt_tokens: 100,
      prompt_tokens_details: {
        cached_tokens: 40,
      },
    });

    expect(result.inputTokenDetails?.cachedTokens).toBe(40);
  });

  it('should normalize reasoning output tokens', () => {
    const result = adapter.normalizeUsage({
      completion_tokens: 80,
      completion_tokens_details: {
        reasoning_tokens: 30,
      },
    });

    expect(result.outputTokenDetails?.reasoningTokens).toBe(30);
  });

  it('should preserve missing token counts as undefined', () => {
    const result = adapter.normalizeUsage({});

    expect(result.inputTokens).toBeUndefined();
    expect(result.outputTokens).toBeUndefined();
    expect(result.totalTokens).toBeUndefined();
    expect(result.inputTokenDetails).toBeUndefined();
    expect(result.outputTokenDetails).toBeUndefined();
  });
});
it('preserves zero and omits invalid Chat counters', () => {
  const usage = new OpenAIUsageAdapter().normalizeUsage({
    prompt_tokens: -1,
    completion_tokens: 0,
    total_tokens: Number.MAX_SAFE_INTEGER + 1,
    completion_tokens_details: { reasoning_tokens: NaN },
  });
  expect(usage).toMatchObject({
    inputTokens: undefined,
    outputTokens: 0,
    totalTokens: undefined,
    outputTokenDetails: undefined,
  });
});
