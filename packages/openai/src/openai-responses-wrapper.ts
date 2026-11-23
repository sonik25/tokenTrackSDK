
import type OpenAI from 'openai';
import type { UsageTracker } from '@tokentrack/core';

import { OpenAIResponsesUsageAdapter } from './openai-responses-usage-adapter.js';
import { Stream } from 'openai/core/streaming';

export interface OpenAIResponsesWrapperOptions {
  client: OpenAI;
  usageTracker: UsageTracker;
}

/**
 * Wraps OpenAI Responses API calls with best-effort usage tracking.
 */
export class OpenAIResponsesWrapper {
  private readonly client: OpenAI;
  private readonly usageTracker: UsageTracker;
  private readonly adapter = new OpenAIResponsesUsageAdapter();

  constructor(options: OpenAIResponsesWrapperOptions) {
    this.client = options.client;
    this.usageTracker = options.usageTracker;
  }

  
  create(
    params: OpenAI.Responses.ResponseCreateParamsNonStreaming,
  ): Promise<OpenAI.Responses.Response>;

  create(
    params: OpenAI.Responses.ResponseCreateParamsStreaming,
  ): Promise<Stream<OpenAI.Responses.ResponseStreamEvent>>;

  create(
    params: OpenAI.Responses.ResponseCreateParams,
  ): Promise<
    OpenAI.Responses.Response |
    Stream<OpenAI.Responses.ResponseStreamEvent>
  >;

  async create(
    params: OpenAI.Responses.ResponseCreateParams,
  ): Promise<
    OpenAI.Responses.Response |
    Stream<OpenAI.Responses.ResponseStreamEvent>
  > {
    const startedAt = performance.now();

    if (params.stream === true) {
      const stream = await this.client.responses.create(params);

      return this.trackStream(stream, startedAt);
    }

    const response = await this.client.responses.create(params);

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
        // Tracking failures must not break successful API calls.
      }
    }

    return response;
  }



private trackStream(
  stream: Stream<OpenAI.Responses.ResponseStreamEvent>,
  startedAt: number,
): Stream<OpenAI.Responses.ResponseStreamEvent> {
  const tracker = this.usageTracker;
  const adapter = this.adapter;

  async function* iterator(): AsyncGenerator<
    OpenAI.Responses.ResponseStreamEvent
  > {
    const trackedResponseIds = new Set<string>();

    for await (const event of stream) {
      if (
        event.type === 'response.completed' ||
        event.type === 'response.incomplete' ||
        event.type === 'response.failed'
      ) {
        const response = event.response;

        if (
          response.usage &&
          !trackedResponseIds.has(response.id)
        ) {
          trackedResponseIds.add(response.id);

          try {
            await tracker.track({
              provider: adapter.provider,
              model: response.model,
              usage: adapter.normalizeUsage(response.usage),
              durationMs: Math.round(performance.now() - startedAt),
              streaming: true,
            });
          } catch {
            // Tracking failures must not interrupt streaming.
          }
        }
      }

      yield event;
    }
  }

  return new Stream(iterator, stream.controller);
}

}
