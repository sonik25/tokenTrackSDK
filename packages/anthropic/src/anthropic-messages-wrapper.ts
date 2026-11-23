import type Anthropic from '@anthropic-ai/sdk';
import type { Stream } from '@anthropic-ai/sdk/streaming';
import type { TrackUsageInput, UsageTracker } from '@tokentrack/core';

import { AnthropicUsageAdapter, type AnthropicUsage } from './anthropic-usage-adapter.js';
import { TrackedMessageStream } from './tracked-message-stream.js';

type RequestOptions = Parameters<Anthropic['messages']['create']>[1];
type MessageStream = Stream<Anthropic.RawMessageStreamEvent>;

export interface AnthropicMessagesWrapperOptions {
  client: Anthropic;
  usageTracker: UsageTracker;
}

/** Wraps Messages API calls with best-effort usage tracking. */
export class AnthropicMessagesWrapper {
  private readonly adapter = new AnthropicUsageAdapter();

  constructor(private readonly options: AnthropicMessagesWrapperOptions) {}

  create(
    params: Anthropic.MessageCreateParamsNonStreaming,
    options?: RequestOptions,
  ): Promise<Anthropic.Message>;
  create(
    params: Anthropic.MessageCreateParamsStreaming,
    options?: RequestOptions,
  ): Promise<MessageStream>;
  create(
    params: Anthropic.MessageCreateParams,
    options?: RequestOptions,
  ): Promise<Anthropic.Message | MessageStream>;
  async create(
    params: Anthropic.MessageCreateParams,
    options?: RequestOptions,
  ): Promise<Anthropic.Message | MessageStream> {
    const startedAt = performance.now();
    const response = await this.options.client.messages.create(params, options);
    if (Symbol.asyncIterator in response) {
      return this.trackStream(response, startedAt);
    }
    if (response.usage) {
      await this.record(response.usage, {
        model: response.model,
        requestId: response.id,
        streaming: false,
        durationMs: Math.round(performance.now() - startedAt),
      });
    }
    return response;
  }

  private trackStream(stream: MessageStream, startedAt: number): MessageStream {
    const record = this.record.bind(this);

    async function* iterator() {
      let message: Pick<Anthropic.Message, 'id' | 'model'> | undefined;
      let usage: AnthropicUsage = {};
      let completed:
        | { usage: AnthropicUsage; metadata: Omit<TrackUsageInput, 'provider' | 'usage'> }
        | undefined;

      for await (const event of stream) {
        if (event.type === 'message_start') {
          message = { id: event.message.id, model: event.message.model };
          usage = {
            input_tokens: event.message.usage?.input_tokens,
            cache_read_input_tokens: event.message.usage?.cache_read_input_tokens,
            cache_creation_input_tokens: event.message.usage?.cache_creation_input_tokens,
          };
        } else if (event.type === 'message_delta' && event.usage) {
          // Each delta reports cumulative counts. Null fields leave prior counts intact.
          usage = {
            input_tokens: event.usage.input_tokens ?? usage.input_tokens,
            output_tokens: event.usage.output_tokens ?? usage.output_tokens,
            cache_read_input_tokens:
              event.usage.cache_read_input_tokens ?? usage.cache_read_input_tokens,
            cache_creation_input_tokens:
              event.usage.cache_creation_input_tokens ?? usage.cache_creation_input_tokens,
          };
        } else if (event.type === 'message_stop' && message) {
          if (Object.values(usage).some((count) => count != null)) {
            completed = {
              usage,
              metadata: {
                model: message.model,
                requestId: message.id,
                streaming: true,
                durationMs: Math.round(performance.now() - startedAt),
              },
            };
          }
          message = undefined;
          usage = {};
        }
        yield event;
      }

      // A trailing transport error or cancellation must not persist a completed event.
      if (completed && !stream.controller.signal.aborted) {
        await record(completed.usage, completed.metadata);
      }
    }

    return new TrackedMessageStream(iterator, stream.controller);
  }

  private async record(
    usage: AnthropicUsage,
    metadata: Omit<TrackUsageInput, 'provider' | 'usage'>,
  ) {
    try {
      await this.options.usageTracker.track({
        ...metadata,
        provider: this.adapter.provider,
        usage: this.adapter.normalizeUsage(usage),
      });
    } catch {
      // Tracking failures must not interrupt successful provider calls.
    }
  }
}
