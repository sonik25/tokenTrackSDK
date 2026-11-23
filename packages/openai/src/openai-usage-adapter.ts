
import type { ProviderAdapter, TokenUsage } from '@tokentrack/core';

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
    return {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,

      inputTokenDetails:
        usage.prompt_tokens_details?.cached_tokens !== undefined
          ? {
              cachedTokens: usage.prompt_tokens_details.cached_tokens,
            }
          : undefined,

      outputTokenDetails:
        usage.completion_tokens_details?.reasoning_tokens !== undefined
          ? {
              reasoningTokens: usage.completion_tokens_details.reasoning_tokens,
            }
          : undefined,
    };
  }
}
