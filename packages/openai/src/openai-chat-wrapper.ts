import type OpenAI from 'openai';
import type { TrackUsageInput, UsageTracker } from '@tokentrack/core';

import { OpenAIUsageAdapter } from './openai-usage-adapter.js';
import { Stream } from 'openai/core/streaming';

type RequestOptions = Parameters<OpenAI['chat']['completions']['create']>[1];

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
    ...options: [options?: RequestOptions]
  ): Promise<OpenAI.Chat.ChatCompletion>;

  create(
    params: OpenAI.Chat.ChatCompletionCreateParamsStreaming,
    ...options: [options?: RequestOptions]
  ): Promise<Stream<OpenAI.Chat.ChatCompletionChunk>>;

  create(
    params: OpenAI.Chat.ChatCompletionCreateParams,
    ...options: [options?: RequestOptions]
  ): Promise<OpenAI.Chat.ChatCompletion | Stream<OpenAI.Chat.ChatCompletionChunk>>;

  async create(
    params: OpenAI.Chat.ChatCompletionCreateParams,
    ...options: [options?: RequestOptions]
  ): Promise<OpenAI.Chat.ChatCompletion | Stream<OpenAI.Chat.ChatCompletionChunk>> {
    const startedAt = performance.now();

    if (params.stream === true) {
      const stream = await this.client.chat.completions.create(
        {
          ...params,
          stream: true,
          stream_options: {
            ...params.stream_options,
            include_usage: true,
          },
        },
        ...options,
      );

      return this.trackStream(stream, startedAt, params.model);
    }

    const response = await this.client.chat.completions.create(params, ...options);

    if (response.usage) {
      try {
        const usage = this.adapter.normalizeUsage(response.usage);
        if (!Object.values(usage).some((value) => value !== undefined)) return response;
        await this.usageTracker.track({
          provider: this.adapter.provider,
          model: response.model,
          requestId: response.id,
          usage,
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
      let finalUsage: Pick<TrackUsageInput, 'usage' | 'model' | 'requestId'> | undefined;
      for await (const chunk of stream) {
        if (chunk.choices.length > 0) {
          finalUsage = undefined;
        } else if (chunk.usage) {
          finalUsage = {
            usage: adapter.normalizeUsage(chunk.usage),
            model: chunk.model || requestedModel,
            requestId: chunk.id,
          };
        }
        yield chunk;
      }
      if (finalUsage && !stream.controller.signal.aborted) {
        try {
          if (!Object.values(finalUsage.usage).some((value) => value !== undefined)) return;
          await tracker.track({
            ...finalUsage,
            provider: adapter.provider,
            status: 'completed',
            durationMs: Math.round(performance.now() - startedAt),
            streaming: true,
          });
        } catch {
          // Tracking failures must not interrupt OpenAI streaming.
        }
      }
    }

    return new Stream(iterator, stream.controller);
  }
}
