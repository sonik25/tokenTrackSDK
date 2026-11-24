import type { GenerateContentResponseUsageMetadata } from '@google/genai';
import type { ProviderAdapter, TokenUsage } from '@tokentrack/core';

import { validTokenCount as tokenCount } from '@tokentrack/core';

function inclusiveCount(base: number | undefined, extra: number | undefined): number | undefined {
  const count = tokenCount(base);
  if (count === undefined || (extra != null && tokenCount(extra) === undefined)) return undefined;
  return tokenCount(count + (extra ?? 0));
}

/** Normalizes the counts reported by Gemini's Generate Content API. */
export class GeminiUsageAdapter implements ProviderAdapter<GenerateContentResponseUsageMetadata> {
  readonly provider = 'gemini' as const;

  normalizeUsage(metadata: GenerateContentResponseUsageMetadata): TokenUsage {
    const inputTokens = inclusiveCount(metadata.promptTokenCount, metadata.toolUsePromptTokenCount);
    const outputTokens = inclusiveCount(metadata.candidatesTokenCount, metadata.thoughtsTokenCount);
    const cachedTokens = tokenCount(metadata.cachedContentTokenCount);
    const reasoningTokens = tokenCount(metadata.thoughtsTokenCount);
    const toolPromptTokens = tokenCount(metadata.toolUsePromptTokenCount);
    let totalTokens = tokenCount(metadata.totalTokenCount);

    // Prompt tokens already include the cache. A fallback total needs all four categories.
    if (
      totalTokens === undefined &&
      inputTokens !== undefined &&
      outputTokens !== undefined &&
      reasoningTokens !== undefined &&
      toolPromptTokens !== undefined
    ) {
      totalTokens = tokenCount(inputTokens + outputTokens);
    }

    return {
      inputTokens,
      outputTokens,
      totalTokens,
      inputTokenDetails: cachedTokens === undefined ? undefined : { cachedTokens },
      outputTokenDetails: reasoningTokens === undefined ? undefined : { reasoningTokens },
    };
  }
}
