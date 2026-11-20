
import type OpenAI from 'openai';

import {
  MemoryStorage,
  OperationContext,
  UsageTracker,
} from '@tokentrack/core';

import { OpenAIChatWrapper } from '../src/openai-chat-wrapper.js';

describe('OpenAIChatWrapper', () => {
  let storage: MemoryStorage;
  let usageTracker: UsageTracker;

  const mockResponse = {
    id: 'chatcmpl-test-123',
    object: 'chat.completion',
    created: 1760000000,
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
      prompt_tokens_details: {
        cached_tokens: 20,
      },
      completion_tokens_details: {
        reasoning_tokens: 10,
      },
    },
  } as OpenAI.Chat.ChatCompletion;

  const params = {
    model: 'gpt-4o',
    messages: [{ role: 'user' as const, content: 'Hello!' }],
  };

  beforeEach(() => {
    storage = new MemoryStorage();
    usageTracker = new UsageTracker(storage, new OperationContext());
  });

  function createWrapper(
    create: jest.Mock = jest.fn().mockResolvedValue(mockResponse),
  ) {
    const client = {
      chat: {
        completions: { create },
      },
    } as unknown as OpenAI;

    return {
      wrapper: new OpenAIChatWrapper({ client, usageTracker }),
      create,
    };
  }

  it('records normalized token usage', async () => {
    const { wrapper } = createWrapper();

    await wrapper.create(params);

    const events = await storage.getUsageEvents();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o',
      streaming: false,
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        inputTokenDetails: { cachedTokens: 20 },
        outputTokenDetails: { reasoningTokens: 10 },
      },
    });

    expect(events[0]?.durationMs).toEqual(expect.any(Number));
  });

  it('returns the original OpenAI response unchanged', async () => {
    const { wrapper, create } = createWrapper();

    const response = await wrapper.create(params);

    expect(response).toBe(mockResponse);
    expect(create).toHaveBeenCalledWith(params);
  });

  it('does not record an event when usage is missing', async () => {
    const responseWithoutUsage = {
      ...mockResponse,
      usage: undefined,
    };

    const { wrapper } = createWrapper(
      jest.fn().mockResolvedValue(responseWithoutUsage),
    );

    await wrapper.create(params);

    expect(await storage.getUsageEvents()).toHaveLength(0);
  });

  it('preserves OpenAI API errors', async () => {
    const apiError = new Error('OpenAI request failed');

    const { wrapper } = createWrapper(
      jest.fn().mockRejectedValue(apiError),
    );

    await expect(wrapper.create(params)).rejects.toBe(apiError);

    expect(await storage.getUsageEvents()).toHaveLength(0);
  });

  it('does not break successful requests when tracking fails', async () => {
    const storageError = new Error('Storage unavailable');

    jest
      .spyOn(storage, 'saveUsageEvent')
      .mockRejectedValue(storageError);

    const { wrapper } = createWrapper();

    await expect(wrapper.create(params)).resolves.toBe(mockResponse);
  });
});
