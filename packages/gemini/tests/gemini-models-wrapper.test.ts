import {
  GenerateContentResponse,
  type GenerateContentParameters,
  type GoogleGenAI,
} from '@google/genai';
import { MemoryStorage, OperationContext, OperationManager, UsageTracker } from '@tokentrack/core';

import { GeminiModelsWrapper } from '../src/index.js';

const params = {
  model: 'gemini-2.5-flash',
  contents: 'private prompt',
  config: {
    systemInstruction: 'private system instruction',
    candidateCount: 2,
    httpOptions: { timeout: 500 },
    abortSignal: new AbortController().signal,
  },
} satisfies GenerateContentParameters;

function setup() {
  const storage = new MemoryStorage();
  const context = new OperationContext();
  const response = Object.freeze(
    Object.assign(new GenerateContentResponse(), {
      responseId: 'response-123',
      modelVersion: 'gemini-2.5-flash-001',
      candidates: [
        { content: { parts: [{ text: 'private response' }] } },
        { content: { parts: [{ functionCall: { name: 'private_tool' } }] } },
      ],
      usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 40, totalTokenCount: 170 },
    }),
  );
  const generateContent = jest.fn().mockResolvedValue(response);
  const client = { models: { generateContent } } as unknown as GoogleGenAI;
  const wrapper = new GeminiModelsWrapper({
    client,
    usageTracker: new UsageTracker(storage, context),
  });
  return { storage, context, response, generateContent, wrapper };
}

it('preserves the request and response and records exactly one content-free event', async () => {
  const { storage, response, generateContent, wrapper } = setup();
  await expect(wrapper.generateContent(params)).resolves.toBe(response);
  expect(generateContent).toHaveBeenCalledTimes(1);
  expect(generateContent.mock.calls[0]?.[0]).toBe(params);
  const events = await storage.getUsageEvents();
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    provider: 'gemini',
    model: 'gemini-2.5-flash-001',
    requestId: 'response-123',
    usage: { inputTokens: 120, outputTokens: 40, totalTokens: 170 },
    durationMs: expect.any(Number),
    streaming: false,
  });
  expect(events[0]?.durationMs).toBeGreaterThanOrEqual(0);
  expect(JSON.stringify(events)).not.toContain('private');
});

it('tracks reported input for blocked responses with no candidates', async () => {
  const { storage, generateContent, wrapper } = setup();
  const blocked = Object.assign(new GenerateContentResponse(), {
    promptFeedback: { blockReason: 'SAFETY' },
    usageMetadata: { promptTokenCount: 12 },
  });
  generateContent.mockResolvedValueOnce(blocked);
  await expect(wrapper.generateContent(params)).resolves.toBe(blocked);
  expect(await storage.getUsageEvents()).toEqual([
    expect.objectContaining({
      model: params.model,
      requestId: undefined,
      usage: { inputTokens: 12 },
    }),
  ]);
});

it.each([undefined, {}, { trafficType: 'ON_DEMAND' }])(
  'skips metadata without supported token counts (%j)',
  async (usageMetadata) => {
    const { storage, generateContent, wrapper } = setup();
    generateContent.mockResolvedValueOnce({ usageMetadata });
    await wrapper.generateContent(params);
    expect(await storage.getUsageEvents()).toHaveLength(0);
  },
);

it('propagates the original provider error', async () => {
  const { storage, generateContent, wrapper } = setup();
  const error = new Error('Gemini rejected the request');
  generateContent.mockRejectedValueOnce(error);
  await expect(wrapper.generateContent(params)).rejects.toBe(error);
  expect(await storage.getUsageEvents()).toHaveLength(0);
});

it('preserves the response when storage fails', async () => {
  const { storage, response, wrapper } = setup();
  const save = jest.spyOn(storage, 'saveUsageEvent').mockRejectedValue(new Error('Storage failed'));
  await expect(wrapper.generateContent(params)).resolves.toBe(response);
  expect(save).toHaveBeenCalledTimes(1);
});

it('contributes to operation summaries through the shared operation context', async () => {
  const { storage, context, wrapper } = setup();
  const operations = new OperationManager(storage, context);
  const operationId = await operations.start('Generate content');
  await context.run(operationId, () => wrapper.generateContent(params));
  await operations.complete(operationId);
  const events = await storage.getUsageEvents();
  expect(events[0]?.operationId).toBe(operationId);
  expect(await storage.getOperations()).toHaveLength(1);
  expect(await operations.getSummary(operationId)).toMatchObject({
    usageEventCount: 1,
    usage: { inputTokens: 120, outputTokens: 40, totalTokens: 170 },
  });
});
