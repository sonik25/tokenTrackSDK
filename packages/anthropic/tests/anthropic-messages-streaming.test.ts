import type Anthropic from '@anthropic-ai/sdk';
import { Stream } from '@anthropic-ai/sdk/streaming';
import { MemoryStorage, OperationContext, UsageTracker } from '@tokentrack/core';

import { AnthropicMessagesWrapper, type AnthropicUsage } from '../src/index.js';

type Event = Anthropic.RawMessageStreamEvent;
const params: Anthropic.MessageCreateParamsStreaming = {
  model: 'claude-sonnet-4-5',
  max_tokens: 100,
  messages: [{ role: 'user', content: 'Hello' }],
  stream: true,
};
const start: Event = {
  type: 'message_start',
  message: {
    id: 'msg_123',
    model: 'claude-sonnet-4-5-20250929',
    role: 'assistant',
    type: 'message',
    stop_reason: null,
    stop_sequence: null,
    content: [],
    usage: {
      input_tokens: 10,
      output_tokens: 1,
      cache_read_input_tokens: 20,
      cache_creation_input_tokens: 0,
    },
  },
} as Anthropic.RawMessageStartEvent;

// The SDK parses JSON without validating required usage fields.
const startWith = (usage: AnthropicUsage): Event =>
  ({ ...start, message: { ...start.message, usage } }) as Anthropic.RawMessageStartEvent;
const content = [
  {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '', citations: null },
  },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
  { type: 'content_block_stop', index: 0 },
] satisfies Event[];
const delta = (output_tokens: number, input_tokens: number | null): Event =>
  ({
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: {
      output_tokens,
      input_tokens,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: null,
      output_tokens_details: null,
      server_tool_use: null,
    },
  }) as Event;
const stop = { type: 'message_stop' } satisfies Event;
const sequence = [start, ...content, delta(3, 12), delta(5, null), stop];

async function collect(stream: AsyncIterable<Event>): Promise<Event[]> {
  const events: Event[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function setup(events: Event[], error?: Error) {
  const storage = new MemoryStorage();
  const controller = new AbortController();
  const close = jest.fn();
  const source = new Stream(async function* () {
    try {
      for (const event of events) {
        if (controller.signal.aborted) throw controller.signal.reason;
        yield event;
      }
      if (error) throw error;
    } finally {
      close();
    }
  }, controller);
  const create = jest.fn().mockResolvedValue(source);
  const client = { messages: { create } } as unknown as Anthropic;
  const wrapper = new AnthropicMessagesWrapper({
    client,
    usageTracker: new UsageTracker(storage, new OperationContext()),
  });
  return { controller, close, storage, create, stream: () => wrapper.create(params) };
}

it('forwards every event by identity and replaces cumulative usage counts', async () => {
  const { storage, create, stream } = setup([...sequence, stop]);
  const received = await collect(await stream());
  expect(create).toHaveBeenCalledWith(params, undefined);
  expect(received).toHaveLength(sequence.length + 1);
  received.forEach((event, index) => expect(event).toBe([...sequence, stop][index]));
  const events = await storage.getUsageEvents();
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    provider: 'anthropic',
    model: 'claude-sonnet-4-5-20250929',
    requestId: 'msg_123',
    streaming: true,
    durationMs: expect.any(Number),
    usage: {
      inputTokens: 32,
      outputTokens: 5,
      totalTokens: 37,
      inputTokenDetails: { cachedTokens: 20, cacheWriteTokens: 0 },
    },
  });
});

it('tracks once when the SDK stream is split with tee', async () => {
  const { close, storage, stream } = setup(sequence);
  const [left, right] = (await stream()).tee();
  await expect(Promise.all([collect(left), collect(right)])).resolves.toEqual([sequence, sequence]);
  expect(await storage.getUsageEvents()).toHaveLength(1);
  expect(close).toHaveBeenCalledTimes(1);
});

it('keeps the source available when only one tee branch closes', async () => {
  const { close, storage, stream } = setup(sequence);
  const [left, right] = (await stream()).tee();
  for await (const event of left) {
    expect(event).toBe(start);
    break;
  }
  expect(close).not.toHaveBeenCalled();
  await expect(collect(right)).resolves.toEqual(sequence);
  expect(close).toHaveBeenCalledTimes(1);
  expect(await storage.getUsageEvents()).toHaveLength(1);
});

it('closes the source once when both tee branches return early', async () => {
  const { close, storage, stream } = setup(sequence);
  const [left, right] = (await stream()).tee();
  const leftIterator = left[Symbol.asyncIterator]();
  const rightIterator = right[Symbol.asyncIterator]();
  await leftIterator.next();
  await rightIterator.next();
  await leftIterator.return?.();
  expect(close).not.toHaveBeenCalled();
  await rightIterator.return?.();
  await rightIterator.return?.();
  expect(close).toHaveBeenCalledTimes(1);
  expect(await storage.getUsageEvents()).toHaveLength(0);
});

it('closes the source when the consumer stops early', async () => {
  const { close, storage, stream } = setup(sequence);
  for await (const event of await stream()) {
    expect(event).toBe(start);
    break;
  }
  expect(close).toHaveBeenCalledTimes(1);
  expect(await storage.getUsageEvents()).toHaveLength(0);
});

it('closes the source once on explicit iterator return', async () => {
  const { close, storage, stream } = setup(sequence);
  const iterator = (await stream())[Symbol.asyncIterator]();
  await iterator.next();
  await expect(iterator.return?.()).resolves.toMatchObject({ done: true });
  await iterator.return?.();
  expect(close).toHaveBeenCalledTimes(1);
  expect(await storage.getUsageEvents()).toHaveLength(0);
});

it('preserves iteration errors', async () => {
  const error = new Error('Stream failed');
  const { close, storage, stream } = setup([startWith({ input_tokens: 10 })], error);
  await expect(collect(await stream())).rejects.toBe(error);
  expect(close).toHaveBeenCalledTimes(1);
  expect(await storage.getUsageEvents()).toHaveLength(0);
});

it('skips tracking when the transport errors after message_stop', async () => {
  const error = new Error('Trailing stream failure');
  const { storage, stream } = setup([startWith({ input_tokens: 10 }), stop], error);
  await expect(collect(await stream())).rejects.toBe(error);
  expect(await storage.getUsageEvents()).toHaveLength(0);
});

it('skips tracking when cancelled after message_stop but before exhaustion', async () => {
  const { close, storage, stream } = setup([startWith({ input_tokens: 10 }), stop]);
  for await (const event of await stream()) {
    if (event === stop) break;
  }
  expect(close).toHaveBeenCalledTimes(1);
  expect(await storage.getUsageEvents()).toHaveLength(0);
});

it.each([
  [
    'input only without a message_delta',
    [startWith({ input_tokens: 10 }), stop],
    { inputTokens: 10 },
  ],
  ['output only', [startWith({}), delta(5, null), stop], { outputTokens: 5 }],
  [
    'cache only',
    [startWith({ cache_read_input_tokens: 20, cache_creation_input_tokens: 10 }), stop],
    {
      inputTokenDetails: { cachedTokens: 20, cacheWriteTokens: 10 },
    },
  ],
  ['explicit zero output', [startWith({}), delta(0, null), stop], { outputTokens: 0 }],
])('records partial usage for %s', async (_label, events, expected) => {
  const { storage, stream } = setup(events);
  await expect(collect(await stream())).resolves.toEqual(events);
  const recorded = await storage.getUsageEvents();
  expect(recorded).toHaveLength(1);
  expect(recorded[0]?.usage).toEqual(expected);
  expect(recorded[0]?.usage.totalTokens).toBeUndefined();
});

it.each([
  ['missing message_stop', sequence.slice(0, -1)],
  ['missing all usage counts', [startWith({}), stop]],
  ['only provisional output', [startWith({ output_tokens: 1 }), stop]],
  ['missing message_start', [delta(0, 0), stop]],
] satisfies [string, Event[]][])('skips tracking with %s', async (_name, events) => {
  const { storage, stream } = setup(events);
  await expect(collect(await stream())).resolves.toEqual(events);
  expect(await storage.getUsageEvents()).toHaveLength(0);
});

it('preserves the SDK abort controller and propagates source abort errors', async () => {
  const { close, controller, storage, stream } = setup(sequence);
  const result = await stream();
  expect(result.controller).toBe(controller);
  const iterator = result[Symbol.asyncIterator]();
  await iterator.next();
  const error = new Error('Aborted');
  result.controller.abort(error);
  await expect(iterator.next()).rejects.toBe(error);
  expect(close).toHaveBeenCalledTimes(1);
  expect(await storage.getUsageEvents()).toHaveLength(0);
});

it('forwards the final event even when tracking storage fails', async () => {
  const { close, storage, stream } = setup(sequence);
  const save = jest.spyOn(storage, 'saveUsageEvent').mockRejectedValue(new Error('Storage failed'));
  await expect(collect(await stream())).resolves.toEqual(sequence);
  expect(save).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);
});
