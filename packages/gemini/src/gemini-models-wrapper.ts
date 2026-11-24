import type {
  GenerateContentParameters,
  GenerateContentResponse,
  GenerateContentResponseUsageMetadata,
  GoogleGenAI,
} from '@google/genai';
import type { TokenUsage, TrackUsageInput, UsageTracker } from '@tokentrack/core';
import { validTokenCount } from '@tokentrack/core';

import { GeminiUsageAdapter } from './gemini-usage-adapter.js';

export interface GeminiModelsWrapperOptions {
  client: GoogleGenAI;
  usageTracker: UsageTracker;
}

/** Wraps Gemini content generation with best-effort usage tracking. */
export class GeminiModelsWrapper {
  private readonly adapter = new GeminiUsageAdapter();

  constructor(private readonly options: GeminiModelsWrapperOptions) {}

  async generateContent(params: GenerateContentParameters): Promise<GenerateContentResponse> {
    const startedAt = performance.now();
    const response = await this.options.client.models.generateContent(params);
    const usage = this.getUsage(response.usageMetadata);
    if (usage) {
      await this.record({
        usage,
        model: response.modelVersion || params.model,
        requestId: response.responseId,
        durationMs: Math.round(performance.now() - startedAt),
        streaming: false,
      });
    }
    return response;
  }

  async generateContentStream(
    params: GenerateContentParameters,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const startedAt = performance.now();
    const stream = await this.options.client.models.generateContentStream(params);
    return this.trackStream(stream, params.model, params.config?.abortSignal, startedAt);
  }

  private async *trackStream(
    stream: AsyncGenerator<GenerateContentResponse>,
    requestedModel: string,
    signal: AbortSignal | undefined,
    startedAt: number,
  ): AsyncGenerator<GenerateContentResponse> {
    const metadata: GenerateContentResponseUsageMetadata = {};
    let model = requestedModel;
    let requestId: string | undefined;

    for await (const chunk of stream) {
      for (const field of [
        'promptTokenCount',
        'candidatesTokenCount',
        'cachedContentTokenCount',
        'thoughtsTokenCount',
        'toolUsePromptTokenCount',
        'totalTokenCount',
      ] as const) {
        const count = validTokenCount(chunk.usageMetadata?.[field]);
        if (count !== undefined) metadata[field] = count;
      }
      model = chunk.modelVersion || model;
      requestId = chunk.responseId || requestId;
      yield chunk;
    }

    const usage = this.getUsage(metadata);
    if (usage && !signal?.aborted) {
      await this.record({
        usage,
        model,
        requestId,
        durationMs: Math.round(performance.now() - startedAt),
        streaming: true,
      });
    }
  }

  private getUsage(
    metadata: GenerateContentResponseUsageMetadata | undefined,
  ): TokenUsage | undefined {
    if (!metadata) return undefined;
    const usage = this.adapter.normalizeUsage(metadata);
    return Object.values(usage).some((value) => value !== undefined) ? usage : undefined;
  }

  private async record(event: Omit<TrackUsageInput, 'provider'>): Promise<void> {
    try {
      await this.options.usageTracker.track({ ...event, provider: this.adapter.provider });
    } catch {
      // Tracking failures must not interrupt successful provider calls.
    }
  }
}
