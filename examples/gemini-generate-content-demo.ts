import { GenerateContentResponse, type GoogleGenAI } from '@google/genai';
import { MemoryStorage, OperationContext, UsageTracker } from '@tokentrack/core';
import { GeminiModelsWrapper } from '@tokentrack/gemini';

async function main() {
  const response = Object.assign(new GenerateContentResponse(), {
    modelVersion: 'gemini-2.5-flash',
    responseId: 'demo-response',
    candidates: [
      { content: { role: 'model', parts: [{ text: 'Hello! This is a dummy Gemini response.' }] } },
    ],
    usageMetadata: {
      promptTokenCount: 120,
      candidatesTokenCount: 40,
      totalTokenCount: 170,
      cachedContentTokenCount: 20,
      thoughtsTokenCount: 10,
    },
  });
  const client = { models: { generateContent: async () => response } } as unknown as GoogleGenAI;
  const storage = new MemoryStorage();
  const wrapper = new GeminiModelsWrapper({
    client,
    usageTracker: new UsageTracker(storage, new OperationContext()),
  });
  const result = await wrapper.generateContent({
    model: 'gemini-2.5-flash',
    contents: 'Say hello.',
  });
  console.log('=== Dummy Gemini Response ===');
  console.log(result.text);
  console.log('\n=== TokenTrack Usage Events ===');
  console.dir(await storage.getUsageEvents(), { depth: null });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
