
import type OpenAI from 'openai';
import type { UsageTracker } from '@tokentrack/core';

import { OpenAIUsageAdapter } from './openai-usage-adapter.js';

/**
 * Dependencies required to track OpenAI Chat Completions.
 */
export interface OpenAIChatWrapperOptions {
  client: OpenAI;
  usageTracker: UsageTracker;
}

/**
 * Wraps OpenAI Chat Completions while preserving
 * the official SDK response.
 */
export class OpenAIChatWrapper {
  private readonly client: OpenAI;
  private readonly usageTracker: UsageTracker;
  private readonly adapter = new OpenAIUsageAdapter();

  constructor(options: OpenAIChatWrapperOptions) {
    this.client = options.client;
    this.usageTracker = options.usageTracker;
  }


  /**
   * Creates a non-streaming Chat Completion and records its usage.
   */
  async create(
    params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
  ): Promise<OpenAI.Chat.ChatCompletion> {
    const startedAt = performance.now();  

    // Preserve OpenAI errors: failed API requests must still reject.
    const response = await this.client.chat.completions.create(params);
    console.log("OpenAIChatWrapper response:", response);

    const durationMs = Math.round(performance.now() - startedAt); 

    if (response.usage) {
      try {
        await this.usageTracker.track({
          provider: this.adapter.provider,
          model: response.model,
          usage: this.adapter.normalizeUsage(response.usage),
          durationMs,
          streaming: false,
        });
      } catch {
        // Best-effort tracking: storage errors must not break
        // an otherwise successful OpenAI request.
      }
    }

    return response;
  }

}

