
import type OpenAI from 'openai';
import { Stream } from 'openai/core/streaming';

import {
  MemoryStorage,
  OperationContext,
  UsageTracker,
} from '@tokentrack/core';

import { OpenAIChatWrapper } from '../src/openai-chat-wrapper.js';

describe('OpenAIChatWrapper streaming', () => {
  let storage: MemoryStorage;
  let usageTracker: UsageTracker;

  beforeEach(() => {
    storage = new MemoryStorage();
    usageTracker = new UsageTracker(storage, new OperationContext());
  });

  const params = {
    model: 'gpt-4o',
    messages: [{ role: 'user' as const, content: 'Hello!' }],
    stream: true as const,
  };

  function createMockStream(
    chunks: OpenAI.Chat.ChatCompletionChunk[],
  ): Stream<OpenAI.Chat.ChatCompletionChunk> {
    async function* iterator() {
      for (const chunk of chunks) {
        yield chunk;
      }
    }

    return new Stream(iterator, new AbortController());
  }

  function createWrapper(
    stream: Stream<OpenAI.Chat.ChatCompletionChunk>,
  ) {
    const create = jest.fn().mockResolvedValue(stream);

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

  const contentChunk = {
    id: 'chatcmpl-stream-123',
    object: 'chat.completion.chunk',
    created: 1760000000,
    model: 'gpt-4o',
    choices: [
      {
        index: 0,
        delta: { content: 'Hello!' },
        finish_reason: null,
      },
    ],
    usage: null,
  } as OpenAI.Chat.ChatCompletionChunk;

  const usageChunk = {
    id: 'chatcmpl-stream-123',
    object: 'chat.completion.chunk',
    created: 1760000000,
    model: 'gpt-4o',
    choices: [],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    },
  } as OpenAI.Chat.ChatCompletionChunk;

  it('records usage from the final streaming chunk', async () => {
    const { wrapper, create } = createWrapper(
      createMockStream([contentChunk, usageChunk]),
    );

    const stream = await wrapper.create(params);

    const received = [];
    for await (const chunk of stream) {
      received.push(chunk);
    }

    expect(received).toEqual([contentChunk, usageChunk]);

    expect(create).toHaveBeenCalledWith({
      ...params,
      stream_options: { include_usage: true },
    });

    const events = await storage.getUsageEvents();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o',
      streaming: true,
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      },
    });
  });

  it('does not record usage when the final chunk is missing', async () => {
    const { wrapper } = createWrapper(createMockStream([contentChunk]));

    const stream = await wrapper.create(params);

    for await (const chunk of stream) {
        void chunk;
    }

    expect(await storage.getUsageEvents()).toHaveLength(0);
  });

  it('does not interrupt streaming when storage fails', async () => {
    jest
      .spyOn(storage, 'saveUsageEvent')
      .mockRejectedValue(new Error('Storage unavailable'));

    const { wrapper } = createWrapper(
      createMockStream([contentChunk, usageChunk]),
    );

    const stream = await wrapper.create(params);

    const received = [];
    for await (const chunk of stream) {
      received.push(chunk);
    }

    expect(received).toEqual([contentChunk, usageChunk]);
  });

  it('preserves the Stream interface', async () => {
    const { wrapper } = createWrapper(createMockStream([contentChunk]));

    const stream = await wrapper.create(params);

    expect(stream).toBeInstanceOf(Stream);
    expect(typeof stream.tee).toBe('function');
    expect(typeof stream.toReadableStream).toBe('function');
  });

  it('does not record usage when consumption stops early', async () => {
    const { wrapper } = createWrapper(
      createMockStream([contentChunk, usageChunk]),
    );

    const stream = await wrapper.create(params);

    for await (const chunk of stream) {
    void chunk;
    break;
    }

    expect(await storage.getUsageEvents()).toHaveLength(0);
  });


it('propagates errors that occur during streaming', async () => {
  const streamError = new Error('OpenAI stream interrupted');

  async function* failingIterator(): AsyncGenerator<
    OpenAI.Chat.ChatCompletionChunk
  > {
    yield contentChunk;
    throw streamError;
  }

  const failingStream = new Stream(
    failingIterator,
    new AbortController(),
  );

  const { wrapper } = createWrapper(failingStream);
  const stream = await wrapper.create(params);

  const received: OpenAI.Chat.ChatCompletionChunk[] = [];

  await expect(
    (async () => {
      for await (const chunk of stream) {
        received.push(chunk);
      }
    })(),
  ).rejects.toBe(streamError);

  expect(received).toEqual([contentChunk]);
  expect(await storage.getUsageEvents()).toHaveLength(0);
});


it('records usage only once when a stream is split with tee()', async () => {
  const { wrapper } = createWrapper(
    createMockStream([contentChunk, usageChunk]),
  );

  const stream = await wrapper.create(params);

  const [branchA, branchB] = stream.tee();

  const consume = async (
    branch: Stream<OpenAI.Chat.ChatCompletionChunk>,
  ) => {
    const chunks: OpenAI.Chat.ChatCompletionChunk[] = [];

    for await (const chunk of branch) {
      chunks.push(chunk);
    }

    return chunks;
  };

  const [chunksA, chunksB] = await Promise.all([
    consume(branchA),
    consume(branchB),
  ]);

  expect(chunksA).toEqual([contentChunk, usageChunk]);
  expect(chunksB).toEqual([contentChunk, usageChunk]);

  const events = await storage.getUsageEvents();

  expect(events).toHaveLength(1);
  expect(events[0]?.streaming).toBe(true);
});


it('preserves usage tracking through toReadableStream()', async () => {
  const { wrapper } = createWrapper(
    createMockStream([contentChunk, usageChunk]),
  );

  const stream = await wrapper.create(params);
  const readable = stream.toReadableStream();
  const reader = readable.getReader();

  const received: OpenAI.Chat.ChatCompletionChunk[] = [];
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    const text = decoder.decode(value);
    const lines = text.split('\n').filter(Boolean);

    for (const line of lines) {
      received.push(
        JSON.parse(line) as OpenAI.Chat.ChatCompletionChunk,
      );
    }
  }

  expect(received).toEqual([contentChunk, usageChunk]);

  const events = await storage.getUsageEvents();

  expect(events).toHaveLength(1);
  expect(events[0]?.streaming).toBe(true);
});


it('propagates cancellation to the underlying OpenAI stream', async () => {
  const controller = new AbortController();

  async function* iterator(): AsyncGenerator<
    OpenAI.Chat.ChatCompletionChunk
  > {
    yield contentChunk;
    yield usageChunk;
  }

  const sourceStream = new Stream(iterator, controller);
  const { wrapper } = createWrapper(sourceStream);

  const stream = await wrapper.create(params);

  const readable = stream.toReadableStream();
  const reader = readable.getReader();

  await reader.read();
  await reader.cancel();

  expect(controller.signal.aborted).toBe(true);
  expect(await storage.getUsageEvents()).toHaveLength(0);
});

});
