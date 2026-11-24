import type { ProviderAdapter, TokenUsage } from '@tokentrack/core';
import { validTokenCount } from '@tokentrack/core';

export interface AnthropicUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** Converts Anthropic's disjoint input counts to TokenTrack's inclusive input count. */
export class AnthropicUsageAdapter implements ProviderAdapter<AnthropicUsage> {
  readonly provider = 'anthropic' as const;

  normalizeUsage(usage: AnthropicUsage): TokenUsage {
    const uncachedTokens = validTokenCount(usage.input_tokens);
    const cachedTokens = validTokenCount(usage.cache_read_input_tokens);
    const cacheWriteTokens = validTokenCount(usage.cache_creation_input_tokens);
    // Cache counts can be reported even when the complete input count is unknown.
    const inputTokens =
      uncachedTokens === undefined ||
      (usage.cache_read_input_tokens != null && cachedTokens === undefined) ||
      (usage.cache_creation_input_tokens != null && cacheWriteTokens === undefined)
        ? undefined
        : validTokenCount(uncachedTokens + (cachedTokens ?? 0) + (cacheWriteTokens ?? 0));
    const outputTokens = validTokenCount(usage.output_tokens);

    return {
      inputTokens,
      outputTokens,
      totalTokens:
        inputTokens === undefined || outputTokens === undefined
          ? undefined
          : validTokenCount(inputTokens + outputTokens),
      inputTokenDetails:
        cachedTokens === undefined && cacheWriteTokens === undefined
          ? undefined
          : { cachedTokens, cacheWriteTokens },
    };
  }
}
