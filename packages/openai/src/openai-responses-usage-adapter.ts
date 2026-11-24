import { validTokenCount } from '@tokentrack/core';
import type OpenAI from 'openai';
import type { ProviderAdapter, TokenUsage } from '@tokentrack/core';

/**
 * Normalizes OpenAI Responses API usage into TokenTrack's
 * provider-independent token usage format.
 */
export class OpenAIResponsesUsageAdapter implements ProviderAdapter<OpenAI.Responses.ResponseUsage> {
  readonly provider = 'openai' as const;

  normalizeUsage(usage: OpenAI.Responses.ResponseUsage): TokenUsage {
    const cachedTokens = validTokenCount(usage.input_tokens_details?.cached_tokens);
    const cacheWriteTokens = validTokenCount(usage.input_tokens_details?.cache_write_tokens);
    const reasoningTokens = validTokenCount(usage.output_tokens_details?.reasoning_tokens);
    return {
      inputTokens: validTokenCount(usage.input_tokens),
      outputTokens: validTokenCount(usage.output_tokens),
      totalTokens: validTokenCount(usage.total_tokens),

      inputTokenDetails:
        cachedTokens === undefined && cacheWriteTokens === undefined
          ? undefined
          : { cachedTokens, cacheWriteTokens },
      outputTokenDetails: reasoningTokens === undefined ? undefined : { reasoningTokens },
    };
  }
}
