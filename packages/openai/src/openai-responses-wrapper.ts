import type OpenAI from 'openai';
import type { UsageTracker } from '@tokentrack/core';

import { OpenAIResponsesUsageAdapter } from './openai-responses-usage-adapter.js';
import { Stream } from 'openai/core/streaming';

type RequestOptions = Parameters<OpenAI['responses']['create']>[1];

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
    ...options: [options?: RequestOptions]
  ): Promise<OpenAI.Responses.Response>;

  create(
    params: OpenAI.Responses.ResponseCreateParamsStreaming,
    ...options: [options?: RequestOptions]
  ): Promise<Stream<OpenAI.Responses.ResponseStreamEvent>>;

  create(
    params: OpenAI.Responses.ResponseCreateParams,
    ...options: [options?: RequestOptions]
  ): Promise<OpenAI.Responses.Response | Stream<OpenAI.Responses.ResponseStreamEvent>>;

  async create(
    params: OpenAI.Responses.ResponseCreateParams,
    ...options: [options?: RequestOptions]
  ): Promise<OpenAI.Responses.Response | Stream<OpenAI.Responses.ResponseStreamEvent>> {
    const startedAt = performance.now();

    if (params.stream === true) {
      const stream = await this.client.responses.create(params, ...options);

      return this.trackStream(stream, startedAt);
    }

    const response = await this.client.responses.create(params, ...options);

    if (response.usage) {
      try {
        const usage = this.adapter.normalizeUsage(response.usage);
        if (!Object.values(usage).some((value) => value !== undefined)) return response;
        await this.usageTracker.track({
          provider: this.adapter.provider,
          model: response.model,
          requestId: response.id,
          status:
            response.status === 'completed' ||
            response.status === 'incomplete' ||
            response.status === 'failed'
              ? response.status
              : undefined,
          usage,
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

    async function* iterator(): AsyncGenerator<OpenAI.Responses.ResponseStreamEvent> {
      const trackedResponseIds = new Set<string>();

      for await (const event of stream) {
        if (
          event.type === 'response.completed' ||
          event.type === 'response.incomplete' ||
          event.type === 'response.failed'
        ) {
          const response = event.response;

          if (response.usage && !trackedResponseIds.has(response.id)) {
            try {
              const usage = adapter.normalizeUsage(response.usage);
              if (Object.values(usage).some((value) => value !== undefined)) {
                trackedResponseIds.add(response.id);
                await tracker.track({
                  provider: adapter.provider,
                  model: response.model,
                  requestId: response.id,
                  status:
                    event.type === 'response.completed'
                      ? 'completed'
                      : event.type === 'response.incomplete'
                        ? 'incomplete'
                        : 'failed',
                  usage,
                  durationMs: Math.round(performance.now() - startedAt),
                  streaming: true,
                });
              }
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
