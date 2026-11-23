import { GenerateContentResponse, type GoogleGenAI } from '@google/genai';
import { MemoryStorage, OperationContext, UsageTracker } from '@tokentrack/core';
import { GeminiModelsWrapper } from '@tokentrack/gemini';

async function main() {
  async function* chunks() {
    for (const [text, candidatesTokenCount] of [
      ['Hello! ', 2],
      ['This is a dummy Gemini stream.', 10],
    ] as const) {
      await new Promise<void>((resolve) => setTimeout(resolve, 60));
      yield Object.assign(new GenerateContentResponse(), {
        modelVersion: 'gemini-2.5-flash',
        responseId: 'demo-stream',
        candidates: [{ content: { role: 'model', parts: [{ text }] } }],
        usageMetadata: {
          promptTokenCount: 12,
          candidatesTokenCount,
          totalTokenCount: 12 + candidatesTokenCount,
        },
      });
    }
  }
  const client = {
    models: { generateContentStream: async () => chunks() },
  } as unknown as GoogleGenAI;
  const storage = new MemoryStorage();
  const wrapper = new GeminiModelsWrapper({
    client,
    usageTracker: new UsageTracker(storage, new OperationContext()),
  });
  const stream = await wrapper.generateContentStream({
    model: 'gemini-2.5-flash',
    contents: 'Say hello.',
  });
  console.log('=== Dummy Gemini Stream ===');
  for await (const chunk of stream) process.stdout.write(chunk.text ?? '');
  const events = await storage.getUsageEvents();
  if (events.length !== 1 || !events[0]?.streaming)
    throw new Error('Expected one streaming usage event');
  console.log('\n\n=== TokenTrack Usage Events (1) ===');
  console.dir(events, { depth: null });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
