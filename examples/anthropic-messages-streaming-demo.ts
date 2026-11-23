import Anthropic from '@anthropic-ai/sdk';
import { AnthropicMessagesWrapper } from '@tokentrack/anthropic';
import { MemoryStorage, OperationContext, UsageTracker } from '@tokentrack/core';

async function main() {
  const events = [
    {
      type: 'message_start',
      message: {
        id: 'msg_stream_demo',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-5',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 20 },
      },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello! ' } },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'This is a dummy Claude stream.' },
    },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 8 },
    },
    { type: 'message_stop' },
  ];
  const client = new Anthropic({
    apiKey: 'mock-only',
    fetch: async () => {
      const encoder = new TextEncoder();
      const chunks = events.values();
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const { done, value } = chunks.next();
          if (done) {
            controller.close();
            return;
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 60));
          controller.enqueue(
            encoder.encode(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`),
          );
        },
      });
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  const storage = new MemoryStorage();
  const messages = new AnthropicMessagesWrapper({
    client,
    usageTracker: new UsageTracker(storage, new OperationContext()),
  });
  const stream = await messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 100,
    messages: [{ role: 'user', content: 'Say hello.' }],
    stream: true,
  });
  console.log('=== Dummy Anthropic Stream ===');
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      process.stdout.write(event.delta.text);
    }
  }
  const usage = await storage.getUsageEvents();
  if (usage.length !== 1) throw new Error(`Expected one usage event, received ${usage.length}`);
  console.log('\n\n=== TokenTrack Usage Events (1) ===');
  console.dir(usage, { depth: null });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
