
import type OpenAI from 'openai';

import { OpenAIResponsesUsageAdapter } from '../src/openai-responses-usage-adapter.js';

describe('OpenAIResponsesUsageAdapter', () => {
  const adapter = new OpenAIResponsesUsageAdapter();

  const usage: OpenAI.Responses.ResponseUsage = {
    input_tokens: 200,
    output_tokens: 80,
    total_tokens: 280,
    input_tokens_details: {
      cached_tokens: 50,
      cache_write_tokens: 30,
    },
    output_tokens_details: {
      reasoning_tokens: 20,
    },
  };

  it('identifies OpenAI as the provider', () => {
    expect(adapter.provider).toBe('openai');
  });

  it('normalizes input, output, and total tokens', () => {
    const result = adapter.normalizeUsage(usage);

    expect(result.inputTokens).toBe(200);
    expect(result.outputTokens).toBe(80);
    expect(result.totalTokens).toBe(280);
  });

  it('normalizes cached and cache-write tokens', () => {
    const result = adapter.normalizeUsage(usage);

    expect(result.inputTokenDetails).toEqual({
      cachedTokens: 50,
      cacheWriteTokens: 30,
    });
  });

  it('normalizes reasoning tokens', () => {
    const result = adapter.normalizeUsage(usage);

    expect(result.outputTokenDetails).toEqual({
      reasoningTokens: 20,
    });
  });

  it('preserves zero token counts', () => {
    const zeroUsage: OpenAI.Responses.ResponseUsage = {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      input_tokens_details: {
        cached_tokens: 0,
        cache_write_tokens: 0,
      },
      output_tokens_details: {
        reasoning_tokens: 0,
      },
    };

    expect(adapter.normalizeUsage(zeroUsage)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      inputTokenDetails: {
        cachedTokens: 0,
        cacheWriteTokens: 0,
      },
      outputTokenDetails: {
        reasoningTokens: 0,
      },
    });
  });
});
