import {
  GenerateContentResponse,
  type GenerateContentParameters,
  type GoogleGenAI,
} from '@google/genai';
import { MemoryStorage, OperationContext, OperationManager, UsageTracker } from '@tokentrack/core';

import { GeminiModelsWrapper } from '../src/index.js';

const params = { model: 'gemini-2.5-flash', contents: 'Hello' } satisfies GenerateContentParameters;
const first = Object.freeze(
  Object.assign(new GenerateContentResponse(), {
    modelVersion: 'gemini-2.5-flash-001',
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 2, totalTokenCount: 14 },
  }),
);
const latest = Object.freeze(
  Object.assign(new GenerateContentResponse(), {
    responseId: 'stream-123',
    usageMetadata: {
      candidatesTokenCount: 5,
      totalTokenCount: 20,
      thoughtsTokenCount: 3,
    },
  }),
);
const empty = Object.assign(new GenerateContentResponse(), { usageMetadata: {} });

async function collect(stream: AsyncIterable<GenerateContentResponse>) {
  const chunks: GenerateContentResponse[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

function setup(chunks: GenerateContentResponse[] = [first, latest, empty], error?: Error) {
  const storage = new MemoryStorage();
  const context = new OperationContext();
  const close = jest.fn();
  async function* source() {
    try {
      yield* chunks;
      if (error) throw error;
    } finally {
      close();
    }
  }
  const generateContentStream = jest.fn().mockImplementation(async () => source());
  const client = { models: { generateContentStream } } as unknown as GoogleGenAI;
  const wrapper = new GeminiModelsWrapper({
    client,
    usageTracker: new UsageTracker(storage, context),
  });
  return { storage, context, close, generateContentStream, wrapper };
}

it('forwards chunks unchanged and records only the latest usable cumulative snapshot', async () => {
  const { storage, close, generateContentStream, wrapper } = setup();
  const stream = await wrapper.generateContentStream(params);
  expect(generateContentStream).toHaveBeenCalledTimes(1);
  expect(generateContentStream.mock.calls[0]?.[0]).toBe(params);
  const chunks = await collect(stream);
  expect(chunks).toHaveLength(3);
  expect(chunks[0]).toBe(first);
  expect(chunks[1]).toBe(latest);
  expect(chunks[2]).toBe(empty);
  const events = await storage.getUsageEvents();
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    provider: 'gemini',
    model: first.modelVersion,
    requestId: latest.responseId,
    durationMs: expect.any(Number),
    streaming: true,
    usage: {
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
      outputTokenDetails: { reasoningTokens: 3 },
    },
  });
  expect(close).toHaveBeenCalledTimes(1);
});

it('cleans up after early iteration break without tracking', async () => {
  const { storage, close, wrapper } = setup();
  for await (const chunk of await wrapper.generateContentStream(params)) {
    expect(chunk).toBe(first);
    break;
  }
  expect(close).toHaveBeenCalledTimes(1);
  expect(await storage.getUsageEvents()).toHaveLength(0);
});

it('cleans up after explicit return without tracking', async () => {
  const { storage, close, wrapper } = setup();
  const stream = await wrapper.generateContentStream(params);
  await stream.next();
  await stream.return(undefined);
  expect(close).toHaveBeenCalledTimes(1);
  expect(await storage.getUsageEvents()).toHaveLength(0);
});

it('propagates provider stream errors after receiving usage', async () => {
  const error = new Error('Gemini stream failed');
  const { storage, close, wrapper } = setup([first], error);
  await expect(collect(await wrapper.generateContentStream(params))).rejects.toBe(error);
  expect(close).toHaveBeenCalledTimes(1);
  expect(await storage.getUsageEvents()).toHaveLength(0);
});

it('propagates a stream setup error unchanged', async () => {
  const { storage, generateContentStream, wrapper } = setup();
  const error = new Error('Gemini rejected the stream');
  generateContentStream.mockRejectedValueOnce(error);
  await expect(wrapper.generateContentStream(params)).rejects.toBe(error);
  expect(await storage.getUsageEvents()).toHaveLength(0);
});

it('skips tracking when an aborted stream ends without throwing', async () => {
  const { storage, wrapper } = setup([first]);
  const controller = new AbortController();
  const stream = await wrapper.generateContentStream({
    ...params,
    config: { abortSignal: controller.signal },
  });
  await stream.next();
  controller.abort();
  await expect(stream.next()).resolves.toMatchObject({ done: true });
  expect(await storage.getUsageEvents()).toHaveLength(0);
});

it('skips streams with no usable token counts', async () => {
  const { storage, wrapper } = setup([new GenerateContentResponse(), empty]);
  await collect(await wrapper.generateContentStream(params));
  expect(await storage.getUsageEvents()).toHaveLength(0);
});

it('preserves successful completion when tracking storage fails', async () => {
  const { storage, close, wrapper } = setup([first]);
  const save = jest.spyOn(storage, 'saveUsageEvent').mockRejectedValue(new Error('Storage failed'));
  await expect(collect(await wrapper.generateContentStream(params))).resolves.toEqual([first]);
  expect(save).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);
});

it('uses the active operation context when the stream is consumed', async () => {
  const { storage, context, wrapper } = setup([latest]);
  const operations = new OperationManager(storage, context);
  const stream = await wrapper.generateContentStream(params);
  await operations.run('Stream content', () => collect(stream));
  const [operation] = await storage.getOperations();
  expect(await storage.getUsageEvents()).toEqual([
    expect.objectContaining({ operationId: operation?.id, model: params.model, streaming: true }),
  ]);
  expect(await operations.getAllSummaries()).toEqual([
    expect.objectContaining({ usageEventCount: 1 }),
  ]);
});
