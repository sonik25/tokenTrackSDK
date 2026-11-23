import type { ProviderAdapter, TokenUsage } from '@tokentrack/core';

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
    const uncachedTokens = usage.input_tokens ?? undefined;
    const cachedTokens = usage.cache_read_input_tokens ?? undefined;
    const cacheWriteTokens = usage.cache_creation_input_tokens ?? undefined;
    // Cache counts can be reported even when the complete input count is unknown.
    const inputTokens =
      uncachedTokens === undefined
        ? undefined
        : uncachedTokens + (cachedTokens ?? 0) + (cacheWriteTokens ?? 0);
    const outputTokens = usage.output_tokens ?? undefined;

    return {
      inputTokens,
      outputTokens,
      totalTokens:
        inputTokens === undefined || outputTokens === undefined
          ? undefined
          : inputTokens + outputTokens,
      inputTokenDetails:
        cachedTokens === undefined && cacheWriteTokens === undefined
          ? undefined
          : { cachedTokens, cacheWriteTokens },
    };
  }
}
