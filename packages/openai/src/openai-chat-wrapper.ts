
import type OpenAI from 'openai';
import type { UsageTracker } from '@tokentrack/core';

import { OpenAIUsageAdapter } from './openai-usage-adapter.js';
import { Stream } from 'openai/core/streaming';

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
   * Creates a Chat Completion and records token usage.
   */
  create(
    params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
  ): Promise<OpenAI.Chat.ChatCompletion>;

  create(
    params: OpenAI.Chat.ChatCompletionCreateParamsStreaming,
  ): Promise<Stream<OpenAI.Chat.ChatCompletionChunk>>;

  create(
    params: OpenAI.Chat.ChatCompletionCreateParams,
  ): Promise<
    OpenAI.Chat.ChatCompletion | Stream<OpenAI.Chat.ChatCompletionChunk>
  >;

  async create(
    params: OpenAI.Chat.ChatCompletionCreateParams,
  ): Promise<
    OpenAI.Chat.ChatCompletion | Stream<OpenAI.Chat.ChatCompletionChunk>
  > {
    const startedAt = performance.now();

    if (params.stream === true) {
      const stream = await this.client.chat.completions.create({
        ...params,
        stream: true,
        stream_options: {
          ...params.stream_options,
          include_usage: true,
        },
      });

      return this.trackStream(stream, startedAt, params.model);
    }

    const response = await this.client.chat.completions.create(params);

    if (response.usage) {
      try {
        await this.usageTracker.track({
          provider: this.adapter.provider,
          model: response.model,
          usage: this.adapter.normalizeUsage(response.usage),
          durationMs: Math.round(performance.now() - startedAt),
          streaming: false,
        });
      } catch {
        // Tracking failures must not break successful requests.
      }
    }

    return response;
  }




private trackStream(
  stream: Stream<OpenAI.Chat.ChatCompletionChunk>,
  startedAt: number,
  requestedModel: string,
): Stream<OpenAI.Chat.ChatCompletionChunk> {
  const tracker = this.usageTracker;
  const adapter = this.adapter;

  async function* iterator(): AsyncGenerator<OpenAI.Chat.ChatCompletionChunk> {
    for await (const chunk of stream) {
      if (chunk.usage) {
        try {
          await tracker.track({
            provider: adapter.provider,
            model: chunk.model || requestedModel,
            usage: adapter.normalizeUsage(chunk.usage),
            durationMs: Math.round(performance.now() - startedAt),
            streaming: true,
          });
        } catch {
          // Tracking failures must not interrupt OpenAI streaming.
        }
      }

      yield chunk;
    }
  }

  return new Stream(iterator, stream.controller);
}


}

