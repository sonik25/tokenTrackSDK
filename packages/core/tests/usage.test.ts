
import type { TokenUsage } from '../src/types/usage.js';

describe('TokenUsage', () => {
  it('should support input, output and total tokens', () => {
    const usage: TokenUsage = {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    };

    expect(usage.totalTokens).toBe(150);
  });

  it('should allow unknown token counts', () => {
    const usage: TokenUsage = {
      inputTokens: 100,
    };

    expect(usage.outputTokens).toBeUndefined();
    expect(usage.totalTokens).toBeUndefined();
  });

  it('should support cached and reasoning token details', () => {
    const usage: TokenUsage = {
      inputTokens: 100,
      outputTokens: 50,
      inputTokenDetails: {
        cachedTokens: 20,
      },
      outputTokenDetails: {
        reasoningTokens: 10,
      },
    };

    expect(usage.inputTokenDetails?.cachedTokens).toBe(20);
    expect(usage.outputTokenDetails?.reasoningTokens).toBe(10);
  });
});
