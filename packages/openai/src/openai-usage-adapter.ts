import type { ProviderAdapter, TokenUsage } from '@tokentrack/core';
import { validTokenCount } from '@tokentrack/core';

export interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
}

/**
 * Converts OpenAI usage data into TokenTrack's common usage format.
 */
export class OpenAIUsageAdapter implements ProviderAdapter<OpenAIUsage> {
  readonly provider = 'openai' as const;

  normalizeUsage(usage: OpenAIUsage): TokenUsage {
    const cachedTokens = validTokenCount(usage.prompt_tokens_details?.cached_tokens);
    const reasoningTokens = validTokenCount(usage.completion_tokens_details?.reasoning_tokens);
    return {
      inputTokens: validTokenCount(usage.prompt_tokens),
      outputTokens: validTokenCount(usage.completion_tokens),
      totalTokens: validTokenCount(usage.total_tokens),

      inputTokenDetails: cachedTokens === undefined ? undefined : { cachedTokens },

      outputTokenDetails: reasoningTokens === undefined ? undefined : { reasoningTokens },
    };
  }
}
