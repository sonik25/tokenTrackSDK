
import type OpenAI from 'openai';

import {
  MemoryStorage,
  OperationContext,
  UsageTracker,
} from '@tokentrack/core';

import { OpenAIChatWrapper } from '@tokentrack/openai';

async function main() {
  const storage = new MemoryStorage();
  const context = new OperationContext();
  const usageTracker = new UsageTracker(storage, context);

  // Mock response from OpenAI.
  const mockResponse = {
    id: 'chatcmpl-demo-123',
    object: 'chat.completion',
    created: Date.now(),
    model: 'gpt-4o',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'Hello from OpenAI!',
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    },
  } as OpenAI.Chat.ChatCompletion;

  // Only the API method is mocked.
  const mockClient = {
    chat: {
      completions: {
        create: async () => mockResponse,
      },
    },
  } as unknown as OpenAI;

  const wrapper = new OpenAIChatWrapper({
    client: mockClient,
    usageTracker,
  });

  const response = await wrapper.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Hello!' }],
  });

  console.log('\nOpenAI Response:');
  console.log(response.choices[0]?.message.content);

  console.log('\nTokenTrack Usage Events:');
  console.dir(await storage.getUsageEvents(), { depth: null });
}

main().catch(console.error);
