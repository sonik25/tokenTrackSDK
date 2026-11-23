import type { GenerateContentResponseUsageMetadata } from '@google/genai';
import type { ProviderAdapter, TokenUsage } from '@tokentrack/core';

function tokenCount(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Normalizes the counts reported by Gemini's Generate Content API. */
export class GeminiUsageAdapter implements ProviderAdapter<GenerateContentResponseUsageMetadata> {
  readonly provider = 'gemini' as const;

  normalizeUsage(metadata: GenerateContentResponseUsageMetadata): TokenUsage {
    const inputTokens = tokenCount(metadata.promptTokenCount);
    const outputTokens = tokenCount(metadata.candidatesTokenCount);
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
      totalTokens = tokenCount(inputTokens + outputTokens + reasoningTokens + toolPromptTokens);
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
