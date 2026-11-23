# tokenTrackSDK

TokenTrack is a lightweight TypeScript SDK for developers and organizations who want to track AI-provider usage from their Node.js applications.

## Anthropic Messages

Pass an initialized Anthropic client and a Core usage tracker to the wrapper.

```ts
import { AnthropicMessagesWrapper } from '@tokentrack/anthropic';

const messages = new AnthropicMessagesWrapper({ client, usageTracker });
const params = {
  model: configuredClaudeModel,
  max_tokens: 100,
  messages: [{ role: 'user' as const, content: 'Say hello.' }],
};

const message = await messages.create(params);
const stream = await messages.create({ ...params, stream: true });
for await (const event of stream) {
  if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
    process.stdout.write(event.delta.text);
  }
}
```

Pass SDK request options, including an abort signal, as the second argument to `create`.
The wrapper returns a native promise and supports the raw SSE stream from
`messages.create({ stream: true })`. The higher-level SDK `messages.stream()` helper
and the SDK's `APIPromise` helpers `asResponse()` and `withResponse()` are outside
the wrapper API.

TokenTrack includes uncached, cache-read, and cache-write tokens in `inputTokens`
and exposes the cache counts separately. Streaming records usage after a
`message_stop` and clean stream exhaustion when at least one count is known.
It keeps the latest reported cumulative counts and takes final output usage from
`message_delta`. Without that count, output remains undefined. Consume the
stream to exhaustion to record usage, or use the shared controller to abort.
With `tee()`, each branch can finish independently and closing both branches
early closes the source. Prompts, system instructions, and generated content
are excluded from stored usage events.

Run the demos locally without credentials.

```sh
pnpm --filter @tokentrack/anthropic... build
pnpm exec tsx examples/anthropic-messages-demo.ts
pnpm exec tsx examples/anthropic-messages-streaming-demo.ts
```
