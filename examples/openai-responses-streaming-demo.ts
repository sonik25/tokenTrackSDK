import type OpenAI from 'openai';
import { Stream } from 'openai/core/streaming';

import { MemoryStorage, OperationContext, UsageTracker } from '@tokentrack/core';

import { OpenAIResponsesWrapper } from '@tokentrack/openai';

async function main() {
  const storage = new MemoryStorage();

  const tracker = new UsageTracker(storage, new OperationContext());

  const finalResponse = {
    id: 'resp-stream-demo-001',
    object: 'response',
    model: 'gpt-4o',
    status: 'completed',
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
      input_tokens_details: {
        cached_tokens: 10,
        cache_write_tokens: 0,
      },
      output_tokens_details: {
        reasoning_tokens: 5,
      },
    },
  } as OpenAI.Responses.Response;

  const events = [
    {
      type: 'response.output_text.delta',
      delta: 'Hello',
    },
    {
      type: 'response.output_text.delta',
      delta: ' from',
    },
    {
      type: 'response.output_text.delta',
      delta: ' streaming!',
    },
    {
      type: 'response.completed',
      response: finalResponse,
    },
  ] as OpenAI.Responses.ResponseStreamEvent[];

  const mockStream = new Stream(async function* () {
    for (const event of events) {
      yield event;
    }
  }, new AbortController());

  const client = {
    responses: {
      create: async () => mockStream,
    },
  } as unknown as OpenAI;

  const wrapper = new OpenAIResponsesWrapper({
    client,
    usageTracker: tracker,
  });

  const stream = await wrapper.create({
    model: 'gpt-4o',
    input: 'Say hello',
    stream: true,
  });

  console.log('\n=== Streaming Response ===');

  for await (const event of stream) {
    if (event.type === 'response.output_text.delta') {
      process.stdout.write(event.delta);
    }
  }

  console.log('\n\n=== TokenTrack Usage Events ===');

  console.dir(await storage.getUsageEvents(), {
    depth: null,
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
