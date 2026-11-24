import Anthropic from '@anthropic-ai/sdk';
import { AnthropicMessagesWrapper } from '@tokentrack/anthropic';
import { MemoryStorage, OperationContext, UsageTracker } from '@tokentrack/core';

async function main() {
  const storage = new MemoryStorage();
  const client = new Anthropic({
    apiKey: 'mock-only',
    fetch: async () =>
      Response.json({
        id: 'msg_demo',
        type: 'message',
        role: 'assistant',
        model: 'mock-claude',
        content: [{ type: 'text', text: 'Hello! This is a dummy Claude response.' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 8 },
      }),
  });
  const messages = new AnthropicMessagesWrapper({
    client,
    usageTracker: new UsageTracker(storage, new OperationContext()),
  });
  const response = await messages.create({
    model: 'mock-claude',
    max_tokens: 100,
    messages: [{ role: 'user', content: 'Say hello.' }],
  });
  console.log('=== Dummy Anthropic Response ===');
  for (const block of response.content) {
    if (block.type === 'text') console.log(block.text);
  }
  console.log('\n=== TokenTrack Usage Events ===');
  console.dir(await storage.getUsageEvents(), { depth: null });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
