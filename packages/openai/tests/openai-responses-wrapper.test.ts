
import type OpenAI from 'openai';

import {
  MemoryStorage,
  OperationContext,
  UsageTracker,
} from '@tokentrack/core';

import { OpenAIResponsesWrapper } from '../src/openai-responses-wrapper.js';

describe('OpenAIResponsesWrapper', () => {
  let storage: MemoryStorage;
  let usageTracker: UsageTracker;
  let create: jest.Mock;
  let wrapper: OpenAIResponsesWrapper;

  const params = {
    model: 'gpt-4o',
    input: 'Hello!',
  } satisfies OpenAI.Responses.ResponseCreateParamsNonStreaming;

  const mockResponse = {
    id: 'resp-123',
    object: 'response',
    model: 'gpt-4o',
    status: 'completed',
    usage: {
      input_tokens: 200,
      output_tokens: 80,
      total_tokens: 280,
      input_tokens_details: {
        cached_tokens: 50,
        cache_write_tokens: 30,
      },
      output_tokens_details: {
        reasoning_tokens: 20,
      },
    },
  } as OpenAI.Responses.Response;

  beforeEach(() => {
    storage = new MemoryStorage();
    usageTracker = new UsageTracker(storage, new OperationContext());

    create = jest.fn();

    const client = {
      responses: { create },
    } as unknown as OpenAI;

    wrapper = new OpenAIResponsesWrapper({
      client,
      usageTracker,
    });
  });

  it('tracks usage from a successful response', async () => {
    create.mockResolvedValue(mockResponse);

    await wrapper.create(params);

    const events = await storage.getUsageEvents();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o',
      streaming: false,
      usage: {
        inputTokens: 200,
        outputTokens: 80,
        totalTokens: 280,
        inputTokenDetails: {
          cachedTokens: 50,
          cacheWriteTokens: 30,
        },
        outputTokenDetails: {
          reasoningTokens: 20,
        },
      },
    });
  });

  it('returns the original OpenAI response unchanged', async () => {
    create.mockResolvedValue(mockResponse);

    const response = await wrapper.create(params);

    expect(response).toBe(mockResponse);
    expect(create).toHaveBeenCalledWith(params);
  });

  it('does not record usage when it is missing', async () => {
    create.mockResolvedValue({
      ...mockResponse,
      usage: undefined,
    });

    await wrapper.create(params);

    expect(await storage.getUsageEvents()).toHaveLength(0);
  });

  it('propagates OpenAI API errors', async () => {
    const apiError = new Error('OpenAI request failed');
    create.mockRejectedValue(apiError);

    await expect(wrapper.create(params)).rejects.toBe(apiError);

    expect(await storage.getUsageEvents()).toHaveLength(0);
  });

  it('does not fail when usage storage throws an error', async () => {
    create.mockResolvedValue(mockResponse);

    jest
      .spyOn(storage, 'saveUsageEvent')
      .mockRejectedValue(new Error('Storage unavailable'));

    await expect(wrapper.create(params)).resolves.toBe(mockResponse);
  });
});
