
import type OpenAI from 'openai';

import {
  MemoryStorage,
  OperationContext,
  UsageTracker,
} from '@tokentrack/core';

import { OpenAIResponsesWrapper } from '@tokentrack/openai';

async function main() {
  const storage = new MemoryStorage();
  const tracker = new UsageTracker(
    storage,
    new OperationContext(),
  );

  const mockResponse = {
    id: 'resp-demo-001',
    object: 'response',
    model: 'gpt-4o',
    status: 'completed',
    output_text: 'Hello! This is a dummy AI response.',
    usage: {
      input_tokens: 120,
      output_tokens: 40,
      total_tokens: 160,
      input_tokens_details: {
        cached_tokens: 20,
        cache_write_tokens: 10,
      },
      output_tokens_details: {
        reasoning_tokens: 0,
      },
    },
  } as OpenAI.Responses.Response;

  const client = {
    responses: {
      create: async () => mockResponse,
    },
  } as unknown as OpenAI;

  const wrapper = new OpenAIResponsesWrapper({
    client,
    usageTracker: tracker,
  });

  const response = await wrapper.create({
    model: 'gpt-4o',
    input: 'Say hello',
  });

  console.log('\n=== Dummy OpenAI Response ===');
  console.log(response.output_text);

  console.log('\n=== TokenTrack Usage Events ===');
  console.dir(await storage.getUsageEvents(), {
    depth: null,
  });
}

main().catch(console.error);
