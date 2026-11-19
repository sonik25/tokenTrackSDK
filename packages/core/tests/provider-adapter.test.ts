import type { ProviderAdapter } from '../src/providers/provider-adapter.js';
import type { TokenUsage } from '../src/types/usage.js';

interface MockProviderUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

describe('ProviderAdapter', () => {
  it('should normalize provider-specific usage', () => {
    const adapter: ProviderAdapter<MockProviderUsage> = {
      provider: 'openai',

      normalizeUsage(usage): TokenUsage {
        return {
          inputTokens: usage.prompt_tokens,
          outputTokens: usage.completion_tokens,
          totalTokens: usage.prompt_tokens + usage.completion_tokens,
        };
      },
    };

    const result = adapter.normalizeUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
    });

    expect(adapter.provider).toBe('openai');
    expect(result).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    });
  });
});
