
import type OpenAI from 'openai';
import { Stream } from 'openai/core/streaming';

import {
  MemoryStorage,
  OperationContext,
  UsageTracker,
} from '@tokentrack/core';

import { OpenAIResponsesWrapper } from '../src/openai-responses-wrapper.js';

describe('OpenAIResponsesWrapper streaming', () => {
  let storage: MemoryStorage;
  let usageTracker: UsageTracker;

  beforeEach(() => {
    storage = new MemoryStorage();
    usageTracker = new UsageTracker(
      storage,
      new OperationContext(),
    );
  });

  const params = {
    model: 'gpt-4o',
    input: 'Hello!',
    stream: true as const,
  };

  const completedEvent = {
    type: 'response.completed',
    sequence_number: 1,
    response: {
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
    },
  } as OpenAI.Responses.ResponseCompletedEvent;

  function createMockStream(
    events: OpenAI.Responses.ResponseStreamEvent[],
  ): Stream<OpenAI.Responses.ResponseStreamEvent> {
    async function* iterator() {
      for (const event of events) {
        yield event;
      }
    }

    return new Stream(iterator, new AbortController());
  }

  function createWrapper(
    stream: Stream<OpenAI.Responses.ResponseStreamEvent>,
  ) {
    const create = jest.fn().mockResolvedValue(stream);

    const client = {
      responses: { create },
    } as unknown as OpenAI;

    return {
      wrapper: new OpenAIResponsesWrapper({
        client,
        usageTracker,
      }),
      create,
    };
  }

  it('tracks usage from response.completed', async () => {
    const { wrapper, create } = createWrapper(
      createMockStream([completedEvent]),
    );

    const stream = await wrapper.create(params);

    const received: OpenAI.Responses.ResponseStreamEvent[] = [];

    for await (const event of stream) {
      received.push(event);
    }

    expect(received).toEqual([completedEvent]);
    expect(create).toHaveBeenCalledWith(params);

    const events = await storage.getUsageEvents();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o',
      streaming: true,
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


it.each([
  ['response.incomplete', 'incomplete'],
  ['response.failed', 'failed'],
] as const)(
  'tracks reported usage from %s',
  async (eventType, status) => {
    const terminalEvent = {
      ...completedEvent,
      type: eventType,
      response: {
        ...completedEvent.response,
        status,
      },
    } as OpenAI.Responses.ResponseStreamEvent;

    const { wrapper } = createWrapper(
      createMockStream([terminalEvent]),
    );

    const stream = await wrapper.create(params);

    const received: OpenAI.Responses.ResponseStreamEvent[] = [];

    for await (const event of stream) {
      received.push(event);
    }

    expect(received).toEqual([terminalEvent]);

    const events = await storage.getUsageEvents();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o',
      streaming: true,
      usage: {
        inputTokens: 200,
        outputTokens: 80,
        totalTokens: 280,
      },
    });
  },
);


it('does not record usage when the response has no usage data', async () => {
  const eventWithoutUsage = {
    ...completedEvent,
    response: {
      ...completedEvent.response,
      usage: undefined,
    },
  } as OpenAI.Responses.ResponseCompletedEvent;

  const { wrapper } = createWrapper(
    createMockStream([eventWithoutUsage]),
  );

  const stream = await wrapper.create(params);

  const received: OpenAI.Responses.ResponseStreamEvent[] = [];

  for await (const event of stream) {
    received.push(event);
  }

  expect(received).toEqual([eventWithoutUsage]);

  const events = await storage.getUsageEvents();

  expect(events).toHaveLength(0);
});


it('does not track duplicate terminal events for the same response', async () => {
  const duplicateEvent = {
    ...completedEvent,
    sequence_number: 2,
  } as OpenAI.Responses.ResponseCompletedEvent;

  const { wrapper } = createWrapper(
    createMockStream([completedEvent, duplicateEvent]),
  );

  const stream = await wrapper.create(params);

  const received: OpenAI.Responses.ResponseStreamEvent[] = [];

  for await (const event of stream) {
    received.push(event);
  }

  expect(received).toEqual([completedEvent, duplicateEvent]);

  const events = await storage.getUsageEvents();

  expect(events).toHaveLength(1);
  expect(events[0]?.usage.totalTokens).toBe(280);
});


it('continues streaming when usage storage fails', async () => {
  jest
    .spyOn(storage, 'saveUsageEvent')
    .mockRejectedValue(new Error('Storage unavailable'));

  const { wrapper } = createWrapper(
    createMockStream([completedEvent]),
  );

  const stream = await wrapper.create(params);

  const received: OpenAI.Responses.ResponseStreamEvent[] = [];

  for await (const event of stream) {
    received.push(event);
  }

  expect(received).toEqual([completedEvent]);
  expect(await storage.getUsageEvents()).toHaveLength(0);
});


it('propagates errors that occur during streaming', async () => {
  const streamError = new Error('OpenAI stream interrupted');

  const partialEvent = {
    type: 'response.created',
    sequence_number: 0,
    response: completedEvent.response,
  } as OpenAI.Responses.ResponseStreamEvent;

  async function* failingIterator(): AsyncGenerator<
    OpenAI.Responses.ResponseStreamEvent
  > {
    yield partialEvent;
    throw streamError;
  }

  const failingStream = new Stream(
    failingIterator,
    new AbortController(),
  );

  const { wrapper } = createWrapper(failingStream);
  const stream = await wrapper.create(params);

  const received: OpenAI.Responses.ResponseStreamEvent[] = [];

  await expect(
    (async () => {
      for await (const event of stream) {
        received.push(event);
      }
    })(),
  ).rejects.toBe(streamError);

  expect(received).toEqual([partialEvent]);
  expect(await storage.getUsageEvents()).toHaveLength(0);
});


it('records usage only once when the stream is split with tee()', async () => {
  const { wrapper } = createWrapper(
    createMockStream([completedEvent]),
  );

  const stream = await wrapper.create(params);
  const [branchA, branchB] = stream.tee();

  const consume = async (
    branch: Stream<OpenAI.Responses.ResponseStreamEvent>,
  ) => {
    const received: OpenAI.Responses.ResponseStreamEvent[] = [];

    for await (const event of branch) {
      received.push(event);
    }

    return received;
  };

  const [eventsA, eventsB] = await Promise.all([
    consume(branchA),
    consume(branchB),
  ]);

  expect(eventsA).toEqual([completedEvent]);
  expect(eventsB).toEqual([completedEvent]);

  const events = await storage.getUsageEvents();

  expect(events).toHaveLength(1);
  expect(events[0]?.streaming).toBe(true);
});


it('propagates cancellation to the underlying OpenAI stream', async () => {
  const controller = new AbortController();

  const partialEvent = {
    type: 'response.created',
    sequence_number: 0,
    response: completedEvent.response,
  } as OpenAI.Responses.ResponseStreamEvent;

  async function* iterator(): AsyncGenerator<
    OpenAI.Responses.ResponseStreamEvent
  > {
    yield partialEvent;
    yield completedEvent;
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
