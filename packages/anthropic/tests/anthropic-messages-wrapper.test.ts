import type Anthropic from '@anthropic-ai/sdk';
import { MemoryStorage, OperationContext, UsageTracker } from '@tokentrack/core';

import { AnthropicMessagesWrapper } from '../src/index.js';

const params: Anthropic.MessageCreateParamsNonStreaming = {
  model: 'claude-sonnet-4-5',
  max_tokens: 100,
  messages: [{ role: 'user', content: 'private prompt' }],
  system: 'private instructions',
};
const response = Object.freeze({
  id: 'msg_123',
  model: 'claude-sonnet-4-5-20250929',
  content: [{ type: 'text', text: 'private response' }],
  usage: { input_tokens: 10, output_tokens: 5 },
});

function setup() {
  const storage = new MemoryStorage();
  const create = jest.fn().mockResolvedValue(response);
  const client = { messages: { create } } as unknown as Anthropic;
  const wrapper = new AnthropicMessagesWrapper({
    client,
    usageTracker: new UsageTracker(storage, new OperationContext()),
  });
  return { storage, create, wrapper };
}

it('forwards request options and tracks metadata without storing content', async () => {
  const { storage, create, wrapper } = setup();
  const options = { signal: new AbortController().signal, timeout: 500 };
  await expect(wrapper.create(params, options)).resolves.toBe(response);
  expect(create).toHaveBeenCalledWith(params, options);
  expect(create.mock.calls[0]?.[0]).toBe(params);
  const events = await storage.getUsageEvents();
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    provider: 'anthropic',
    model: response.model,
    requestId: response.id,
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    durationMs: expect.any(Number),
    streaming: false,
  });
  expect(events[0]?.durationMs).toBeGreaterThanOrEqual(0);
  expect(JSON.stringify(events)).not.toContain('private');
});

it('propagates provider errors by identity', async () => {
  const { storage, create, wrapper } = setup();
  const error = new Error('Provider rejected request');
  create.mockRejectedValueOnce(error);
  await expect(wrapper.create(params)).rejects.toBe(error);
  expect(await storage.getUsageEvents()).toHaveLength(0);
});

it('preserves success when storage fails', async () => {
  const { storage, wrapper } = setup();
  const save = jest.spyOn(storage, 'saveUsageEvent').mockRejectedValue(new Error('Storage failed'));
  await expect(wrapper.create(params)).resolves.toBe(response);
  expect(save).toHaveBeenCalledTimes(1);
});
