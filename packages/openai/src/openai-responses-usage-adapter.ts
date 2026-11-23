
import type OpenAI from 'openai';
import type { ProviderAdapter, TokenUsage } from '@tokentrack/core';

/**
 * Normalizes OpenAI Responses API usage into TokenTrack's
 * provider-independent token usage format.
 */
export class OpenAIResponsesUsageAdapter
  implements ProviderAdapter<OpenAI.Responses.ResponseUsage>
{
  readonly provider = 'openai' as const;

  normalizeUsage(
    usage: OpenAI.Responses.ResponseUsage,
  ): TokenUsage {
    return {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      totalTokens: usage.total_tokens,

      inputTokenDetails: {
        cachedTokens: usage.input_tokens_details.cached_tokens,
        cacheWriteTokens:
          usage.input_tokens_details.cache_write_tokens,
      },

      outputTokenDetails: {
        reasoningTokens:
          usage.output_tokens_details.reasoning_tokens,
      },
    };
  }
}
